const { Client, Pool } = require('pg');

const dbConfig = { 
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5434),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'admin',
  database: process.env.DB_NAME || 'jaipur_db_node',
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

const pgPool = new Pool(dbConfig);

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function ensureDatabase() {
  const adminClient = new Client({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: process.env.DB_ADMIN_DATABASE || 'postgres',
  });

  await adminClient.connect();
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
  const result = await executor.query(normalizedSql, params);
  return formatResult(result, normalizedSql);
}

async function query(sql, params = []) {
  return runQuery(pgPool, sql, params);
}

async function getConnection() {
  const client = await pgPool.connect();

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
