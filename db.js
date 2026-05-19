const fs = require('fs');
const path = require('path');
const { Client, Pool } = require('pg');

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match || match[1].startsWith('#') || Object.prototype.hasOwnProperty.call(process.env, match[1])) {
      continue;
    }

    let value = match[2] || '';
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function envValue(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

loadLocalEnv();

function isLocalHost(host) {
  return ['localhost', '127.0.0.1', '::1'].includes(String(host || '').toLowerCase());
}

function shouldUseSsl(host) {
  const sslValue = String(process.env.DB_SSL || '').toLowerCase();
  if (['true', '1', 'yes', 'require'].includes(sslValue)) {
    return true;
  }
  if (['false', '0', 'no', 'disable'].includes(sslValue)) {
    return false;
  }
  return Boolean(process.env.DATABASE_URL && !isLocalHost(host));
}

function createConnectionStringForDatabase(database) {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

function createDbConfig(databaseOverride) {
  const connectionString = databaseOverride ? createConnectionStringForDatabase(databaseOverride) : process.env.DATABASE_URL;
  if (connectionString) {
    const url = new URL(connectionString);
    return {
      connectionString,
      database: url.pathname.replace(/^\//, ''),
      max: Number(envValue('DB_POOL_MAX', 10)),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: shouldUseSsl(url.hostname) ? { rejectUnauthorized: false } : false,
    };
  }

  return {
    host: envValue('DB_HOST', 'localhost'),
    port: Number(envValue('DB_PORT', 5432)),
    user: envValue('DB_USER', 'postgres'),
    password: envValue('DB_PASSWORD', ''),
    database: envValue('DB_NAME', 'jaipur_db_node'),
    max: Number(envValue('DB_POOL_MAX', 10)),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: shouldUseSsl(envValue('DB_HOST', 'localhost')) ? { rejectUnauthorized: false } : false,
  };
}

const dbConfig = createDbConfig();
const pgPool = new Pool(dbConfig);

function enhanceConnectionError(error) {
  if (/password authentication failed/i.test(error.message)) {
    const user = dbConfig.user || (dbConfig.connectionString ? new URL(dbConfig.connectionString).username : 'configured user');
    error.message = `${error.message}. Update DB_PASSWORD in JaipurGro2\\.env to match the PostgreSQL password for user "${user}", or set a valid DATABASE_URL.`;
  }
  if (/client password must be a string|sasl/i.test(error.message) && !dbConfig.password && !dbConfig.connectionString) {
    error.message = 'PostgreSQL DB_PASSWORD is missing. Create JaipurGro2\\.env and set DB_PASSWORD to your PostgreSQL password, or set DATABASE_URL.';
  }
  return error;
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function ensureDatabase() {
  const adminDatabase = process.env.DB_ADMIN_DATABASE || 'postgres';
  const adminClient = new Client(createDbConfig(adminDatabase));

  await adminClient.connect().catch((error) => {
    throw enhanceConnectionError(error);
  });
  try {
    const result = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbConfig.database]);
    if (result.rowCount === 0) {
      await adminClient.query(`CREATE DATABASE ${quoteIdentifier(dbConfig.database)}`);
    }
  } finally {
    await adminClient.end();
  }
}

function convertPlaceholders(sql) {
  if (/\$\d+/.test(sql) || !sql.includes('?')) {
    return sql;
  }

  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function normalizeInsertIgnore(sql) {
  return sql.replace(/^(\s*)INSERT\s+IGNORE\s+INTO/i, '$1INSERT INTO');
}

function shouldAddDoNothing(sql) {
  return /^\s*INSERT\s+INTO/i.test(sql)
    && !/\bON\s+CONFLICT\b/i.test(sql)
    && !/\bON\s+DUPLICATE\s+KEY\b/i.test(sql)
    && !/\bRETURNING\b/i.test(sql);
}

function normalizeSql(sql) {
  let normalized = normalizeInsertIgnore(sql).replace(/`/g, '"');

  normalized = normalized
    .replace(/\bINT\s+UNSIGNED\s+NOT\s+NULL\s+AUTO_INCREMENT\b/gi, 'SERIAL')
    .replace(/\bINT\s+NOT\s+NULL\s+AUTO_INCREMENT\b/gi, 'SERIAL')
    .replace(/\bINT\s+UNSIGNED\b/gi, 'INTEGER')
    .replace(/\bTINYINT\s*\(\s*1\s*\)/gi, 'SMALLINT')
    .replace(/\bJSON\b/gi, 'JSONB')
    .replace(/\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP\b/gi, '')
    .replace(/\s+AFTER\s+\w+/gi, '')
    .replace(/\)\s*ENGINE\s*=\s*InnoDB\s+DEFAULT\s+CHARSET\s*=\s*utf8mb4\s*;?/gi, ');')
    .replace(/DEFAULT\s+""/g, "DEFAULT ''")
    .replace(/UNIQUE\s+KEY\s+(\w+)\s*\(([^)]+)\)/gi, 'CONSTRAINT $1 UNIQUE ($2)')
    .replace(/,\s*KEY\s+\w+\s*\([^)]+\)/gi, '')
    .replace(/\s+KEY\s+\w+\s*\([^)]+\),?/gi, '');

  if (/^\s*INSERT\s+IGNORE\s+INTO/i.test(sql) && !/\bON\s+CONFLICT\b/i.test(normalized)) {
    normalized += ' ON CONFLICT DO NOTHING';
  }

  if (shouldAddDoNothing(normalized)) {
    normalized += ' RETURNING id';
  }

  normalized = normalized.replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP');
  return convertPlaceholders(normalized);
}

function formatResult(result, sql) {
  const command = String(result.command || '').toUpperCase();
  const insertId = result.rows && result.rows[0] && result.rows[0].id;
  const info = {
    affectedRows: result.rowCount || 0,
    rowCount: result.rowCount || 0,
    insertId,
  };

  const formatted = command === 'SELECT' || /^\s*WITH\b/i.test(sql)
    ? [result.rows, info]
    : [info, result.rows];

  formatted.rows = result.rows;
  formatted.rowCount = result.rowCount;
  formatted.command = result.command;
  formatted.insertId = insertId;
  return formatted;
}

async function runQuery(executor, sql, params) {
  const normalizedSql = normalizeSql(sql);
  const result = await executor.query(normalizedSql, params).catch((error) => {
    throw enhanceConnectionError(error);
  });
  return formatResult(result, normalizedSql);
}

async function query(sql, params = []) {
  return runQuery(pgPool, sql, params);
}

async function getConnection() {
  const client = await pgPool.connect().catch((error) => {
    throw enhanceConnectionError(error);
  });

  return {
    query: (sql, params = []) => runQuery(client, sql, params),
    beginTransaction: () => client.query('BEGIN'),
    commit: () => client.query('COMMIT'),
    rollback: () => client.query('ROLLBACK'),
    release: () => client.release(),
  };
}

module.exports = {
  ...pgPool,
  query,
  getConnection,
  ensureDatabase,
  end: () => pgPool.end(),
  connect: () => pgPool.connect(),
  config: dbConfig,
};
