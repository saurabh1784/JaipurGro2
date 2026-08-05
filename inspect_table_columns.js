const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'saurabh',
    database: 'postgres',
    ssl: false,
  });

  try {
    await client.connect();
    console.log('Connected to DB');

    // Get column types of sponsored_products
    const resColumns = await client.query(`
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'sponsored_products'
    `);
    console.log('sponsored_products Columns:');
    console.table(resColumns.rows);

  } catch (err) {
    console.error('Error running query:', err);
  } finally {
    await client.end();
  }
}

main();
