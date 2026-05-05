const mysql = require('mysql2/promise');
const { Pool: PgPool, types: pgTypes } = require('pg');

pgTypes.setTypeParser(20, (value) => Number(value));

function buildConfigFromUrl(connectionUrl) {
  if (!connectionUrl) return {};

  const parsedUrl = new URL(connectionUrl);
  return {
    host: parsedUrl.hostname,
    port: Number(parsedUrl.port || 3306),
    user: decodeURIComponent(parsedUrl.username || 'root'),
    password: decodeURIComponent(parsedUrl.password || ''),
    database: decodeURIComponent(parsedUrl.pathname.replace(/^\//, '')),
  };
}

function buildPublicRailwayUrl() {
  const host = process.env.RAILWAY_TCP_PROXY_DOMAIN;
  const port = process.env.RAILWAY_TCP_PROXY_PORT;
  const user = process.env.MYSQLUSER || process.env.DATABASE_USER || process.env.DB_USER || 'root';
  const password = process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD || process.env.DATABASE_PASSWORD || process.env.DB_PASSWORD || '';
  const database = process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || process.env.DATABASE_NAME || process.env.DB_NAME;

  if (!host || !port || !database) return null;
  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

function isRailwayRuntime() {
  return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
}

function isPrivateRailwayUrl(connectionUrl) {
  if (!connectionUrl) return false;

  const { hostname } = new URL(connectionUrl);
  return (
    hostname.endsWith('.railway.internal') ||
    hostname.endsWith('.railway.private') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function getMysqlConnectionUrl() {
  if (isRailwayRuntime()) {
    return process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL;
  }

  if (process.env.MYSQL_PUBLIC_URL) return process.env.MYSQL_PUBLIC_URL;

  const publicRailwayUrl = buildPublicRailwayUrl();
  if (publicRailwayUrl) return publicRailwayUrl;

  if (isPrivateRailwayUrl(process.env.MYSQL_URL)) {
    throw new Error('Render cannot connect to Railway private MYSQL_URL. Set MYSQL_PUBLIC_URL from Railway TCP Proxy and remove MYSQL_URL from Render.');
  }

  return process.env.MYSQL_URL;
}

function shouldUsePostgres() {
  const databaseUrl = process.env.DATABASE_URL || '';
  const wantsPostgres = process.env.DB_CLIENT === 'postgres' || process.env.DB_CLIENT === 'postgresql';
  const hasPostgresUrl = databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://');
  const isRenderRuntime = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
  const hasMysqlConfig = Boolean(getMysqlConnectionUrl() || hasMysqlHostEnv());

  return wantsPostgres || hasPostgresUrl || (isRenderRuntime && !hasMysqlConfig);
}

function hasMysqlHostEnv() {
  return Boolean(process.env.MYSQLHOST || process.env.DATABASE_HOST || process.env.DB_HOST);
}

const conflictTargets = {
  admin_profiles: '(user_id)',
  brands: '(category_id, sub_category_id, name)',
  categories: '(name)',
  client_profiles: '(user_id)',
  commission_settings: '(role_slug, transaction_type)',
  quotation_vendor_recipients: '(quotation_request_id, vendor_id)',
  quotation_vendor_response_items: '(quotation_vendor_recipient_id, quotation_request_item_id)',
  roles: '(slug)',
  sub_categories: '(category_id, name)',
  user_roles: '(user_id, role_id)',
  users: '(email)',
  vendor_client_product_prices: '(product_id, vendor_id, client_id)',
  vendor_products: '(product_id, vendor_id)',
  vendor_profiles: '(user_id)',
  wallets: '(user_id)',
};

const tablesWithId = new Set([
  'admin_profiles',
  'brands',
  'categories',
  'client_order_items',
  'client_orders',
  'client_profiles',
  'commission_settings',
  'products',
  'quotation_request_items',
  'quotation_requests',
  'quotation_vendor_recipients',
  'quotation_vendor_response_items',
  'roles',
  'sub_categories',
  'users',
  'vendor_client_product_prices',
  'vendor_products',
  'vendor_profiles',
  'wallet_transactions',
  'wallets',
]);

function placeholderSql(sql) {
  let index = 0;
  let output = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const previous = sql[i - 1];

    if (char === "'" && !inDouble && previous !== '\\') inSingle = !inSingle;
    if (char === '"' && !inSingle && previous !== '\\') inDouble = !inDouble;

    if (char === '?' && !inSingle && !inDouble) {
      index += 1;
      output += `$${index}`;
    } else {
      output += char;
    }
  }

  return output;
}

function normalizePostgresSchema(sql) {
  return sql
    .replace(/INT\s+AUTO_INCREMENT\s+PRIMARY\s+KEY/gi, 'SERIAL PRIMARY KEY')
    .replace(/\bLONGTEXT\b/gi, 'TEXT')
    .replace(/\bJSON\b/gi, 'JSONB')
    .replace(/\bTINYINT\s*\(\s*1\s*\)/gi, 'INTEGER')
    .replace(/ON\s+UPDATE\s+CURRENT_TIMESTAMP/gi, '');
}

function tableFromInsert(sql) {
  const match = sql.match(/^\s*INSERT(?:\s+IGNORE)?\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
  return match && match[1];
}

function applyInsertIgnore(sql) {
  if (!/^\s*INSERT\s+IGNORE\s+INTO/i.test(sql)) return sql;

  const table = tableFromInsert(sql);
  const target = conflictTargets[table] || '';
  const withoutIgnore = sql.replace(/^\s*INSERT\s+IGNORE\s+INTO/i, 'INSERT INTO');
  return `${withoutIgnore} ON CONFLICT ${target} DO NOTHING`;
}

function applyReplaceInto(sql) {
  const match = sql.match(/^\s*REPLACE\s+INTO\s+sessions\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
  if (!match) return sql;

  return `INSERT INTO sessions (${match[1]}) VALUES (${match[2]})
    ON CONFLICT (sid) DO UPDATE SET expires = EXCLUDED.expires, data = EXCLUDED.data`;
}

function applyOnDuplicateKey(sql) {
  if (!/ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(sql)) return sql;

  const table = tableFromInsert(sql);
  const target = conflictTargets[table];
  if (!target) return sql;

  let translated = sql.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE/i, `ON CONFLICT ${target} DO UPDATE SET`);
  translated = translated.replace(/VALUES\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/gi, 'EXCLUDED.$1');
  return translated;
}

function addReturningId(sql) {
  if (!/^\s*INSERT\s+INTO/i.test(sql)) return sql;
  if (/\bRETURNING\b/i.test(sql)) return sql;
  if (!tablesWithId.has(tableFromInsert(sql))) return sql;
  return `${sql} RETURNING id`;
}

function translatePostgresSql(sql) {
  let translated = normalizePostgresSchema(sql);
  translated = applyReplaceInto(translated);
  translated = applyInsertIgnore(translated);
  translated = applyOnDuplicateKey(translated);
  translated = addReturningId(translated);
  translated = placeholderSql(translated);
  return translated;
}

function mysqlShape(result) {
  const meta = {
    affectedRows: result.rowCount,
    insertId: result.rows && result.rows[0] && result.rows[0].id ? result.rows[0].id : 0,
    rowCount: result.rowCount,
  };

  if (result.command === 'SELECT' || result.command === 'SHOW') {
    return [result.rows, meta];
  }

  return [meta, result.fields || []];
}

class PostgresConnection {
  constructor(client) {
    this.client = client;
  }

  async query(sql, params = []) {
    const result = await this.client.query(translatePostgresSql(sql), params);
    return mysqlShape(result);
  }

  beginTransaction() {
    return this.client.query('BEGIN');
  }

  commit() {
    return this.client.query('COMMIT');
  }

  rollback() {
    return this.client.query('ROLLBACK');
  }

  release() {
    this.client.release();
  }
}

class PostgresCompatPool {
  constructor(config) {
    this.dbType = 'postgres';
    this.pool = new PgPool(config);
  }

  async query(sql, params = []) {
    const result = await this.pool.query(translatePostgresSql(sql), params);
    return mysqlShape(result);
  }

  async getConnection() {
    const client = await this.pool.connect();
    return new PostgresConnection(client);
  }

  end() {
    return this.pool.end();
  }
}

function createPostgresPool() {
  const isRenderRuntime = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
  const renderPostgresFallback = isRenderRuntime
    ? 'postgresql://db_for_jaipur_user:5nk2eySXiJA8gSxd1NsSEm0KknDtaem2@dpg-d7ss7vdckfvc73cnsmk0-a/db_for_jaipur'
    : '';
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || renderPostgresFallback;

  if (!connectionString) {
    throw new Error(
      'Missing PostgreSQL DATABASE_URL on Render. Set DATABASE_URL to the Internal Database URL from your Render PostgreSQL database, and set DB_CLIENT=postgres.'
    );
  }

  return new PostgresCompatPool({
    connectionString,
    ssl: isRenderRuntime ? { rejectUnauthorized: false } : process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.DB_POOL_SIZE || 10),
  });
}

function createMysqlPool() {
  const connectionUrl = getMysqlConnectionUrl();
  const urlConfig = buildConfigFromUrl(connectionUrl);
  const isRenderRuntime = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);

  if (isRenderRuntime && !connectionUrl && !hasMysqlHostEnv()) {
    throw new Error(
      'Missing database configuration on Render. Prefer Render PostgreSQL DATABASE_URL, or set MYSQL_PUBLIC_URL / Railway TCP proxy variables for MySQL.'
    );
  }

  const dbConfig = {
    host: urlConfig.host || process.env.MYSQLHOST || process.env.DATABASE_HOST || process.env.DB_HOST || 'localhost',
    port: Number(urlConfig.port || process.env.MYSQLPORT || process.env.DATABASE_PORT || process.env.DB_PORT || 3306),
    user: urlConfig.user || process.env.MYSQLUSER || process.env.DATABASE_USER || process.env.DB_USER || 'root',
    password:
      urlConfig.password !== undefined
        ? urlConfig.password
        : process.env.MYSQLPASSWORD !== undefined
          ? process.env.MYSQLPASSWORD
          : process.env.DATABASE_PASSWORD !== undefined
            ? process.env.DATABASE_PASSWORD
            : process.env.DB_PASSWORD || '',
    database:
      urlConfig.database ||
      process.env.MYSQLDATABASE ||
      process.env.MYSQL_DATABASE ||
      process.env.DATABASE_NAME ||
      process.env.DB_NAME ||
      'jaipur_db_node',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
    queueLimit: 0,
  };

  if (!isRailwayRuntime() && isPrivateRailwayUrl(`mysql://${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`)) {
    throw new Error('Render cannot connect to Railway private MySQL host. Use MYSQL_PUBLIC_URL with RAILWAY_TCP_PROXY_DOMAIN and RAILWAY_TCP_PROXY_PORT.');
  }

  const pool = mysql.createPool(dbConfig);
  pool.dbType = 'mysql';
  return pool;
}

module.exports = shouldUsePostgres() ? createPostgresPool() : createMysqlPool();
