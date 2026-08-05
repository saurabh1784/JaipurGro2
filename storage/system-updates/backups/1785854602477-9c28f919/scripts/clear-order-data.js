const pool = require('../db');

const directTables = [
  'delivery_order_offers',
  'order_status_history',
  'client_order_items',
  'client_orders',
];

const quotationTables = [
  'quotation_vendor_response_items',
  'quotation_vendor_recipients',
  'quotation_request_items',
  'quotation_requests',
];

async function tableExists(connection, table) {
  const [rows] = await connection.query('SELECT to_regclass(?) AS name', [
    table,
  ]);
  return Boolean(rows[0] && rows[0].name);
}

async function countRows(connection, table) {
  if (!(await tableExists(connection, table))) return null;
  const [rows] = await connection.query(`SELECT COUNT(*) AS total FROM ${table}`);
  return Number(rows[0] && rows[0].total || 0);
}

async function deleteIfExists(connection, table) {
  if (!(await tableExists(connection, table))) return null;
  const [result] = await connection.query(`DELETE FROM ${table}`);
  return Number(result.affectedRows || result.rowCount || 0);
}

async function clearOrderData() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const before = {};
    for (const table of [...directTables, ...quotationTables]) {
      before[table] = await countRows(connection, table);
    }

    let couponHistoryResult = { affectedRows: 0, rowCount: 0 };
    if (await tableExists(connection, 'coupon_usage_history')) {
      [couponHistoryResult] = await connection.query(
        'UPDATE coupon_usage_history SET order_id = NULL WHERE order_id IS NOT NULL'
      );
    }

    let walletTransactionResult = { affectedRows: 0, rowCount: 0 };
    if (await tableExists(connection, 'wallet_transactions')) {
      [walletTransactionResult] = await connection.query(
        "DELETE FROM wallet_transactions WHERE reference LIKE 'delivery-order-%' OR reference LIKE 'order-%' OR LOWER(COALESCE(note, '')) LIKE '%order #%'"
      );
    }

    let notificationResult = { affectedRows: 0, rowCount: 0 };
    if (await tableExists(connection, 'user_notifications')) {
      [notificationResult] = await connection.query(
        "DELETE FROM user_notifications WHERE link LIKE '%/orders/%' OR link LIKE '%/api/orders/%' OR LOWER(title) LIKE '%order%' OR LOWER(message) LIKE '%order%'"
      );
    }

    const deleted = {
      coupon_usage_history_order_links: Number(
        couponHistoryResult.affectedRows || couponHistoryResult.rowCount || 0,
      ),
      wallet_transactions: Number(
        walletTransactionResult.affectedRows || walletTransactionResult.rowCount || 0,
      ),
      user_notifications: Number(
        notificationResult.affectedRows || notificationResult.rowCount || 0,
      ),
    };

    for (const table of directTables) {
      deleted[table] = await deleteIfExists(connection, table);
    }
    for (const table of quotationTables) {
      deleted[table] = await deleteIfExists(connection, table);
    }

    if (
      (await tableExists(connection, 'wallets')) &&
      (await tableExists(connection, 'wallet_transactions'))
    ) {
      await connection.query(
        `UPDATE wallets
         SET balance = COALESCE(ledger.balance, 0),
             updated_at = CURRENT_TIMESTAMP
         FROM (
           SELECT w.id,
                  COALESCE(SUM(
                    CASE
                      WHEN wt.type = 'credit' THEN wt.net_amount
                      WHEN wt.type = 'debit' THEN -wt.net_amount
                      ELSE 0
                    END
                  ), 0) AS balance
           FROM wallets w
           LEFT JOIN wallet_transactions wt ON wt.wallet_id = w.id
           GROUP BY w.id
         ) ledger
         WHERE wallets.id = ledger.id`
      );
    }

    if (await tableExists(connection, 'delivery_person_profiles')) {
      await connection.query(
        `UPDATE delivery_person_profiles
         SET is_available = 1, updated_at = CURRENT_TIMESTAMP
         WHERE is_available = 0`
      );
    }

    await connection.commit();
    return { before, deleted };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

clearOrderData()
  .then(({ before, deleted }) => {
    console.log('Order data cleared.');
    console.log('Before:');
    for (const [table, count] of Object.entries(before)) {
      console.log(`${table}: ${count === null ? 'missing' : count}`);
    }
    console.log('Deleted/updated:');
    for (const [table, count] of Object.entries(deleted)) {
      console.log(`${table}: ${count === null ? 'missing' : count}`);
    }
  })
  .catch((error) => {
    console.error(`Unable to clear order data: ${pool.formatError(error)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
