const db = require('../db');

async function run() {
  const [summaryRows] = await db.query(`
    SELECT
      COUNT(*) AS total_orders,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM wallet_transactions wt
        WHERE wt.order_id = client_orders.id AND wt.component = 'client_order_payment'
      )) AS client_payment_captured,
      COUNT(*) FILTER (WHERE wallet_settled_at IS NOT NULL) AS completion_split_settled,
      COUNT(*) FILTER (WHERE delivery_wallet_settled_at IS NOT NULL) AS delivery_settled,
      COUNT(*) FILTER (WHERE status IN ('delivered', 'completed') OR delivery_status = 'delivered') AS completed_orders
    FROM client_orders
  `);
  const [missingRows] = await db.query(`
    SELECT o.id, o.order_number, o.user_id, o.vendor_id, o.delivery_partner_id,
           o.total_amount, o.delivery_charge, o.status, o.delivery_status,
           ARRAY_REMOVE(ARRAY[
             CASE WHEN client_tx.id IS NULL THEN 'client_order_payment' END,
             CASE WHEN (o.status IN ('delivered', 'completed') OR o.delivery_status = 'delivered')
                        AND vendor_tx.id IS NULL THEN 'vendor_order_earning' END,
             CASE WHEN (o.status IN ('delivered', 'completed') OR o.delivery_status = 'delivered')
                        AND platform_fee_tx.id IS NULL THEN 'admin_platform_fee' END,
             CASE WHEN (o.status IN ('delivered', 'completed') OR o.delivery_status = 'delivered')
                        AND order_commission_tx.id IS NULL THEN 'admin_order_commission' END,
             CASE WHEN (o.status IN ('delivered', 'completed') OR o.delivery_status = 'delivered')
                        AND o.delivery_partner_id IS NOT NULL AND delivery_tx.id IS NULL
                  THEN 'delivery_person_earning' END
             CASE WHEN (o.status IN ('delivered', 'completed') OR o.delivery_status = 'delivered')
                        AND o.delivery_partner_id IS NOT NULL AND delivery_commission_tx.id IS NULL
                  THEN 'admin_delivery_commission' END
           ], NULL) AS missing_components
    FROM client_orders o
    LEFT JOIN wallet_transactions client_tx ON client_tx.order_id = o.id AND client_tx.component = 'client_order_payment'
    LEFT JOIN wallet_transactions vendor_tx ON vendor_tx.order_id = o.id AND vendor_tx.component = 'vendor_order_earning'
    LEFT JOIN wallet_transactions platform_fee_tx ON platform_fee_tx.order_id = o.id AND platform_fee_tx.component = 'admin_platform_fee'
    LEFT JOIN wallet_transactions order_commission_tx ON order_commission_tx.order_id = o.id AND order_commission_tx.component = 'admin_order_commission'
    LEFT JOIN wallet_transactions delivery_commission_tx ON delivery_commission_tx.order_id = o.id AND delivery_commission_tx.component = 'admin_delivery_commission'
    LEFT JOIN wallet_transactions delivery_tx ON delivery_tx.order_id = o.id AND delivery_tx.component = 'delivery_person_earning'
    WHERE client_tx.id IS NULL
       OR ((o.status IN ('delivered', 'completed') OR o.delivery_status = 'delivered')
           AND (vendor_tx.id IS NULL OR platform_fee_tx.id IS NULL OR order_commission_tx.id IS NULL
             OR (o.delivery_partner_id IS NOT NULL AND (delivery_tx.id IS NULL OR delivery_commission_tx.id IS NULL))))
    ORDER BY o.id DESC
  `);
  const [duplicateRows] = await db.query(`
    SELECT ledger_key, COUNT(*) AS total
    FROM wallet_transactions
    WHERE ledger_key IS NOT NULL
    GROUP BY ledger_key HAVING COUNT(*) > 1
  `);
  const [legacyRows] = await db.query(`
    SELECT wt.id, wt.user_id, u.role, wt.type, wt.amount, wt.reference, wt.note, wt.order_id
    FROM wallet_transactions wt
    INNER JOIN users u ON u.id = wt.user_id
    WHERE wt.component IS NULL
    ORDER BY wt.id
  `);
  const [conservationRows] = await db.query(`
    SELECT o.id, o.order_number, o.total_amount, o.delivery_charge,
           COALESCE(client_tx.amount, 0) AS client_debit,
           COALESCE(platform_fee_tx.amount, 0) + COALESCE(order_commission_tx.amount, 0) AS admin_credit,
           COALESCE(vendor_tx.amount, 0) AS vendor_credit,
           COALESCE(delivery_commission_tx.amount, 0) AS delivery_commission_credit,
           COALESCE(delivery_tx.amount, 0) AS delivery_credit
    FROM client_orders o
    LEFT JOIN wallet_transactions client_tx ON client_tx.order_id = o.id AND client_tx.component = 'client_order_payment'
    LEFT JOIN wallet_transactions platform_fee_tx ON platform_fee_tx.order_id = o.id AND platform_fee_tx.component = 'admin_platform_fee'
    LEFT JOIN wallet_transactions order_commission_tx ON order_commission_tx.order_id = o.id AND order_commission_tx.component = 'admin_order_commission'
    LEFT JOIN wallet_transactions delivery_commission_tx ON delivery_commission_tx.order_id = o.id AND delivery_commission_tx.component = 'admin_delivery_commission'
    LEFT JOIN wallet_transactions vendor_tx ON vendor_tx.order_id = o.id AND vendor_tx.component = 'vendor_order_earning'
    LEFT JOIN wallet_transactions delivery_tx ON delivery_tx.order_id = o.id AND delivery_tx.component = 'delivery_person_earning'
    WHERE o.wallet_settled_at IS NOT NULL
      AND (
        ABS(COALESCE(client_tx.amount, 0) - o.total_amount) > 0.009
        OR ABS((COALESCE(platform_fee_tx.amount, 0) + COALESCE(order_commission_tx.amount, 0) + COALESCE(vendor_tx.amount, 0)) - (o.total_amount - o.delivery_charge)) > 0.009
        OR (o.delivery_wallet_settled_at IS NOT NULL AND ABS((COALESCE(delivery_tx.amount, 0) + COALESCE(delivery_commission_tx.amount, 0)) - o.delivery_charge) > 0.009)
      )
  `);
  console.log(JSON.stringify({
    summary: summaryRows[0],
    historical_orders_missing_systematic_ledger: missingRows,
    duplicate_ledger_keys: duplicateRows,
    legacy_transactions_without_components: legacyRows,
    conservation_errors: conservationRows,
  }, null, 2));
  await db.end();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
