const mysql = require('mysql2/promise');
const targetPool = require('../db');
const initializeSchema = require('../dbSchema');

const tables = [
  'users',
  'roles',
  'user_roles',
  'wallets',
  'commission_settings',
  'wallet_transactions',
  'vendor_profiles',
  'client_profiles',
  'admin_profiles',
  'categories',
  'sub_categories',
  'brands',
  'products',
  'vendor_products',
  'vendor_client_product_prices',
  'client_orders',
  'client_order_items',
  'quotation_requests',
  'quotation_request_items',
  'quotation_vendor_recipients',
  'quotation_vendor_response_items',
];

const jsonColumns = {
  roles: ['permissions'],
  vendor_profiles: ['services'],
  admin_profiles: ['permissions'],
};

function buildPublicRailwayUrl() {
  const host = process.env.RAILWAY_TCP_PROXY_DOMAIN;
  const port = process.env.RAILWAY_TCP_PROXY_PORT;
  const user = process.env.MYSQLUSER || process.env.DATABASE_USER || process.env.DB_USER || 'root';
  const password = process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD || process.env.DATABASE_PASSWORD || process.env.DB_PASSWORD || '';
  const database = process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || process.env.DATABASE_NAME || process.env.DB_NAME;

  if (!host || !port || !database) return null;
  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

function sourceMysqlUrl() {
  return process.env.MYSQL_PUBLIC_URL || buildPublicRailwayUrl() || process.env.MYSQL_MIGRATION_URL || null;
}

function valueForColumn(table, column, value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if ((jsonColumns[table] || []).includes(column) && typeof value !== 'string') {
    return JSON.stringify(value);
  }
  return value;
}

async function tableColumns(mysqlPool, table) {
  const [rows] = await mysqlPool.query(`SHOW COLUMNS FROM ${table}`);
  return rows.map((row) => row.Field);
}

async function copyTable(mysqlPool, table) {
  const columns = await tableColumns(mysqlPool, table);
  const [rows] = await mysqlPool.query(`SELECT ${columns.join(', ')} FROM ${table}`);

  if (!rows.length) {
    console.log(`Migration: ${table} has no rows`);
    return;
  }

  const columnList = columns.join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const insertSql = `INSERT IGNORE INTO ${table} (${columnList}) VALUES (${placeholders})`;

  for (const row of rows) {
    await targetPool.query(
      insertSql,
      columns.map((column) => valueForColumn(table, column, row[column]))
    );
  }

  if (columns.includes('id')) {
    await targetPool.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 1), 1), true)`
    );
  }

  console.log(`Migration: copied ${rows.length} row(s) into ${table}`);
}

async function migrate() {
  const url = sourceMysqlUrl();
  const skipIfMissing = process.argv.includes('--if-configured');

  if (targetPool.dbType !== 'postgres') {
    console.log('Migration: target database is not PostgreSQL, skipping');
    return;
  }

  if (!url) {
    if (skipIfMissing) {
      console.log('Migration: no MySQL source configured, skipping');
      return;
    }
    throw new Error('Missing MySQL source. Set MYSQL_PUBLIC_URL, MYSQL_MIGRATION_URL, or Railway TCP proxy variables.');
  }

  await initializeSchema(targetPool);
  const mysqlPool = mysql.createPool(url);

  try {
    for (const table of tables) {
      await copyTable(mysqlPool, table);
    }
  } finally {
    await mysqlPool.end();
  }
}

migrate()
  .then(() => {
    if (targetPool.end) return targetPool.end();
    return null;
  })
  .catch(async (error) => {
    console.error('Migration failed:', error);
    if (targetPool.end) await targetPool.end().catch(() => {});
    process.exit(1);
  });
