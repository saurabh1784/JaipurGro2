const db = require('../db');
const Settlement = require('../services/orderWalletSettlementService');

const apply = process.argv.includes('--apply');

async function mapLegacyDeliveryTransactions() {
  if (!apply) return 0;
  const [result] = await db.query(`
    UPDATE wallet_transactions wt
    SET component = 'delivery_person_earning',
        ledger_key = 'ORDER:' || wt.order_id || ':DELIVERY_PERSON:EARNING',
        reference = 'ORDER_' || wt.order_id
    WHERE wt.order_id IS NOT NULL
      AND wt.component IS NULL
      AND wt.reference LIKE 'DELIVERY_ORDER_%'
      AND NOT EXISTS (
        SELECT 1 FROM wallet_transactions existing
        WHERE existing.ledger_key = 'ORDER:' || wt.order_id || ':DELIVERY_PERSON:EARNING'
      )
  `);
  return Number(result.affectedRows || result.rowCount || 0);
}

async function candidateOrders() {
  const [rows] = await db.query(`
    SELECT o.id, o.order_number, o.user_id, o.vendor_id, o.delivery_partner_id,
           o.total_amount, o.delivery_charge, o.status, o.delivery_status,
           o.wallet_settled_at, o.delivery_wallet_settled_at,
           client_tx.id AS client_payment_tx_id,
           vendor_tx.id AS vendor_earning_tx_id,
           platform_tx.id AS platform_fee_tx_id,
           order_commission_tx.id AS order_commission_tx_id,
           delivery_tx.id AS delivery_earning_tx_id,
           delivery_commission_tx.id AS delivery_commission_tx_id
    FROM client_orders o
    LEFT JOIN wallet_transactions client_tx ON client_tx.order_id = o.id AND client_tx.component = 'client_order_payment'
    LEFT JOIN wallet_transactions vendor_tx ON vendor_tx.order_id = o.id AND vendor_tx.component = 'vendor_order_earning'
    LEFT JOIN wallet_transactions platform_tx ON platform_tx.order_id = o.id AND platform_tx.component = 'admin_platform_fee'
    LEFT JOIN wallet_transactions order_commission_tx ON order_commission_tx.order_id = o.id AND order_commission_tx.component = 'admin_order_commission'
    LEFT JOIN wallet_transactions delivery_tx ON delivery_tx.order_id = o.id AND delivery_tx.component = 'delivery_person_earning'
    LEFT JOIN wallet_transactions delivery_commission_tx ON delivery_commission_tx.order_id = o.id AND delivery_commission_tx.component = 'admin_delivery_commission'
    WHERE client_tx.id IS NULL
       OR ((o.status IN ('delivered', 'completed') OR o.delivery_status = 'delivered')
           AND (vendor_tx.id IS NULL OR platform_tx.id IS NULL OR order_commission_tx.id IS NULL
             OR (o.delivery_partner_id IS NOT NULL AND (delivery_tx.id IS NULL OR delivery_commission_tx.id IS NULL))))
    ORDER BY o.id
  `);
  return rows;
}

async function reconcileOrder(order) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = { orderId: Number(order.id), placement: null, completion: null, delivery: null };
    if (!order.client_payment_tx_id) {
      result.placement = await Settlement.settleOrderPlacement({
        orderId: order.id,
        actorId: order.user_id,
        connection,
      });
    }
    const completed = ['delivered', 'completed'].includes(String(order.status || '').toLowerCase())
      || String(order.delivery_status || '').toLowerCase() === 'delivered';
    if (completed) {
      if (!order.vendor_earning_tx_id || !order.platform_fee_tx_id || !order.order_commission_tx_id) {
        result.completion = await Settlement.settleOrderCompletion({
          orderId: order.id,
          actorId: order.delivery_partner_id || order.user_id,
          connection,
        });
      }
      if (order.delivery_partner_id && (!order.delivery_earning_tx_id || !order.delivery_commission_tx_id)) {
        result.delivery = await Settlement.settleDeliveryCompletion({
          orderId: order.id,
          deliveryPersonId: order.delivery_partner_id,
          actorId: order.delivery_partner_id,
          connection,
        });
      }
    }
    await connection.commit();
    return { ...result, status: 'reconciled' };
  } catch (error) {
    await connection.rollback();
    return { orderId: Number(order.id), status: 'skipped', error: error.message };
  } finally {
    connection.release();
  }
}

async function run() {
  const candidates = await candidateOrders();
  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, candidateOrders: candidates }, null, 2));
    await db.end();
    return;
  }
  const mappedLegacyDeliveryTransactions = await mapLegacyDeliveryTransactions();
  const results = [];
  for (const order of candidates) results.push(await reconcileOrder(order));
  console.log(JSON.stringify({ dryRun: false, mappedLegacyDeliveryTransactions, results }, null, 2));
  await db.end();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
