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
           o.wallet_settled_at, o.delivery_wallet_settled_at
    FROM client_orders o
    WHERE o.wallet_settled_at IS NULL
       OR ((o.status IN ('delivered', 'completed') OR o.delivery_status = 'delivered')
           AND o.delivery_partner_id IS NOT NULL AND o.delivery_wallet_settled_at IS NULL)
    ORDER BY o.id
  `);
  return rows;
}

async function reconcileOrder(order) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = { orderId: Number(order.id), placement: null, delivery: null };
    if (!order.wallet_settled_at) {
      result.placement = await Settlement.settleOrderPlacement({
        orderId: order.id,
        actorId: order.user_id,
        connection,
      });
    }
    const completed = ['delivered', 'completed'].includes(String(order.status || '').toLowerCase())
      || String(order.delivery_status || '').toLowerCase() === 'delivered';
    if (completed && order.delivery_partner_id && !order.delivery_wallet_settled_at) {
      result.delivery = await Settlement.settleDeliveryCompletion({
        orderId: order.id,
        deliveryPersonId: order.delivery_partner_id,
        actorId: order.delivery_partner_id,
        connection,
      });
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
