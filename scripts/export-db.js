const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
const pool = require('../db');

const outputDir = path.join(__dirname, '..', 'database', 'railway');
const outputFile = path.join(outputDir, 'railway-export.sql');
const tableOrder = [
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

function sqlValue(value) {
  if (value instanceof Date) {
    return mysql.escape(value.toISOString().slice(0, 19).replace('T', ' '));
  }

  return mysql.escape(value);
}

async function main() {
  const connection = await pool.getConnection();

  try {
    const [[databaseRow]] = await connection.query('SELECT DATABASE() AS database_name');
    const databaseName = databaseRow.database_name;

    if (!databaseName) {
      throw new Error('No database is selected. Check MYSQL_URL or DATABASE_NAME.');
    }

    const [tableRows] = await connection.query(
      `SELECT table_name AS tableName
         FROM information_schema.tables
        WHERE table_schema = ?
          AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
      [databaseName]
    );
    const tables = tableRows
      .map((table) => table.tableName)
      .sort((left, right) => {
        const leftIndex = tableOrder.indexOf(left);
        const rightIndex = tableOrder.indexOf(right);
        const normalizedLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
        const normalizedRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;

        if (normalizedLeftIndex !== normalizedRightIndex) {
          return normalizedLeftIndex - normalizedRightIndex;
        }

        return left.localeCompare(right);
      });

    fs.mkdirSync(outputDir, { recursive: true });

    const lines = [
      '-- Railway MySQL export',
      `-- Database: ${databaseName}`,
      `-- Generated: ${new Date().toISOString()}`,
      '',
      'SET FOREIGN_KEY_CHECKS=0;',
      'SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";',
      '',
    ];

    for (const tableName of [...tables].reverse()) {
      lines.push(`DROP TABLE IF EXISTS \`${tableName}\`;`);
    }
    lines.push('');

    for (const tableName of tables) {
      const [[createRow]] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
      const createSql = createRow['Create Table'];

      lines.push(`${createSql};`);
      lines.push('');

      const [rows] = await connection.query(`SELECT * FROM \`${tableName}\``);
      if (!rows.length) {
        continue;
      }

      const columns = Object.keys(rows[0]);
      lines.push(`LOCK TABLES \`${tableName}\` WRITE;`);

      for (const row of rows) {
        const columnSql = columns.map((column) => `\`${column}\``).join(', ');
        const valueSql = columns.map((column) => sqlValue(row[column])).join(', ');
        lines.push(`INSERT INTO \`${tableName}\` (${columnSql}) VALUES (${valueSql});`);
      }

      lines.push(`UNLOCK TABLES;`);
      lines.push('');
    }

    lines.push('SET FOREIGN_KEY_CHECKS=1;');
    lines.push('');

    fs.writeFileSync(outputFile, lines.join('\n'), 'utf8');
    console.log(`Database export written to ${outputFile}`);
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
