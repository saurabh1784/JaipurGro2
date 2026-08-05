const pool = require('../db');

const tables = [
  'quotation_vendor_response_items',
  'quotation_vendor_recipients',
  'quotation_request_items',
  'quotation_requests',
  'client_order_items',
  'order_status_history',
  'client_orders',
  'vendor_client_product_prices',
  'vendor_products',
  'product_search_history',
  'product_keywords',
  'sponsored_products',
  'user_recent_activity',
  'product_ranking_scores',
  'products',
  'vendor_categories',
  'brands',
  'sub_categories',
  'categories',
];

async function clearProductCatalog() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const deleted = {};
    for (const table of tables) {
      const [result] = await connection.query(`DELETE FROM ${table}`);
      deleted[table] = Number(result.affectedRows || result.rowCount || 0);
    }

    await connection.commit();
    return deleted;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

clearProductCatalog()
  .then((deleted) => {
    console.log('Product catalog data cleared.');
    for (const [table, count] of Object.entries(deleted)) {
      console.log(`${table}: ${count}`);
    }
  })
  .catch((error) => {
    console.error(`Unable to clear product catalog data: ${pool.formatError(error)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
