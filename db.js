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

function createConnectionStringForDatabase(database) {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

function createDbConfig() {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    return {
      connectionString: process.env.DATABASE_URL,
      database: url.pathname.replace(/^\//, ''),
      max: Number(envValue('DB_POOL_MAX', 10)),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      query_timeout: Number(envValue('DB_QUERY_TIMEOUT_MS', 30000)),
      statement_timeout: Number(envValue('DB_STATEMENT_TIMEOUT_MS', 30000)),
      ssl: envValue('DB_SSL', 'false') === 'true' ? { rejectUnauthorized: false } : false,
    };
  }

  return {
    host: envValue('DB_HOST', 'localhost'),
    port: Number(envValue('DB_PORT', 5432)),
    user: envValue('DB_USER', 'groxenin_saurabh'),
    password: envValue('DB_PASSWORD', 'saurabh@17842006'),
    database: envValue('DB_NAME', 'groxenin_jaipurgro'),
    max: Number(envValue('DB_POOL_MAX', 10)),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    query_timeout: Number(envValue('DB_QUERY_TIMEOUT_MS', 30000)),
    statement_timeout: Number(envValue('DB_STATEMENT_TIMEOUT_MS', 30000)),
    ssl: envValue('DB_SSL', 'false') === 'true' ? { rejectUnauthorized: false } : false,
  };
}

const dbConfig = createDbConfig();
let activePool = null;

async function getActivePool() {
  if (!activePool) {
    activePool = new Pool(dbConfig);
    activePool.on('error', (err) => {
      console.error('[DB Pool Error]', err.message);
    });
  }
  return activePool;
}

function describeConfig() {
  return {
    source: '.env Environment Configuration',
    host: dbConfig.host || 'localhost',
    port: dbConfig.port || 5432,
    database: dbConfig.database || 'groxenin_jaipurgro',
    user: dbConfig.user || 'groxenin_saurabh',
    ssl: Boolean(dbConfig.ssl),
  };
}

function formatError(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;

  const parts = [];
  const primary = error.message || error.name || String(error);
  if (primary && primary !== '[object Object]') {
    parts.push(primary);
  }

  for (const key of ['code', 'errno', 'syscall', 'host', 'address', 'port', 'database', 'detail', 'hint']) {
    if (error[key]) {
      parts.push(`${key}=${error[key]}`);
    }
  }

  return parts.length ? parts.join('; ') : JSON.stringify(error);
}

function enhanceConnectionError(error) {
  const message = formatError(error);
  if (!error.message) {
    error.message = message;
  }
  return error;
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
  const pool = await getActivePool();
  const exec = executor === dbConfig ? pool : executor;
  const normalizedSql = normalizeSql(sql);
  const result = await exec.query(normalizedSql, params).catch((error) => {
    throw enhanceConnectionError(error);
  });
  return formatResult(result, normalizedSql);
}

async function query(sql, params = []) {
  const pool = await getActivePool();
  return runQuery(pool, sql, params);
}

async function getConnection() {
  const pool = await getActivePool();
  const client = await pool.connect().catch((error) => {
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

async function ensureDatabase() {
  return true;
}

async function addEssentialIndexes() {
  const uniqueIndexes = [
    { table: 'delivery_person_profiles', name: 'uniq_dpp_user_id', columns: 'user_id' },
    { table: 'vendor_profiles', name: 'uniq_vp_user_id', columns: 'user_id' },
    { table: 'client_profiles', name: 'uniq_cp_user_id', columns: 'user_id' },
  ];

  for (const { table, name, columns } of uniqueIndexes) {
    try {
      await query(`CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON ${table} (${columns})`);
    } catch (e) {
      // Ignore
    }
  }

  const indexDefinitions = [
    { table: 'client_orders', name: 'idx_co_client_status', columns: 'client_id, status' },
    { table: 'client_orders', name: 'idx_co_vendor_status', columns: 'vendor_id, status' },
    { table: 'client_orders', name: 'idx_co_dp_status', columns: 'delivery_partner_id, status' },
    { table: 'client_orders', name: 'idx_co_created', columns: 'created_at' },
    { table: 'vendor_profiles', name: 'idx_vp_user', columns: 'user_id' },
    { table: 'vendor_profiles', name: 'idx_vp_city_area', columns: 'city, area' },
    { table: 'support_tickets', name: 'idx_st_dp', columns: 'delivery_partner_id' },
    { table: 'support_tickets', name: 'idx_st_order', columns: 'order_id' },
    { table: 'wallet_transactions', name: 'idx_wt_user_type', columns: 'user_id, type' },
    { table: 'ratings', name: 'idx_ratings_target', columns: 'target_id, rating_type' },
  ];

  for (const { table, name, columns } of indexDefinitions) {
    try {
      await query(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${columns})`);
    } catch (e) {
      // Ignore
    }
  }
}

module.exports = {
  query,
  getConnection,
  ensureDatabase,
  describeConfig,
  formatError,
  addEssentialIndexes,
  end: async () => {
    if (activePool) await activePool.end();
  },
  connect: async () => {
    const pool = await getActivePool();
    return pool.connect();
  },
  config: dbConfig,
};
