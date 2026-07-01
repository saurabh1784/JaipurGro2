const db = require('../db');
const Wallet = require('../models/Wallet');
const CommissionSetting = require('../models/CommissionSetting');

const money = (value) => Number(Math.max(Number(value || 0), 0).toFixed(2));

async function platformAdmin(connection) {
  const configuredId = Number(process.env.PLATFORM_ADMIN_USER_ID || 0);
  const params = configuredId > 0 ? [configuredId] : [];
  const configuredFilter = configuredId > 0 ? 'AND id = ?' : '';
  const [rows] = await connection.query(
    `SELECT id
     FROM users
     WHERE is_deleted = 0
       AND LOWER(role) IN ('superadmin', 'admin')
       ${configuredFilter}
     ORDER BY CASE WHEN LOWER(role) = 'superadmin' THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    params
  );
  if (!rows.length) {
    throw new Error(configuredId > 0
      ? 'Configured platform admin wallet user was not found'
      : 'No active platform admin user is available');
  }
  return Number(rows[0].id);
}

function expectedCommission(storedAmount, setting, basisAmount) {
  const stored = money(storedAmount);
  if (stored > 0) return Math.min(stored, money(basisAmount));
  return Math.min(CommissionSetting.calculateAmount(setting, basisAmount), money(basisAmount));
}

async function existingAdminCredit(connection, orderId, component) {
  const [rows] = await connection.query(
    `SELECT COALESCE(SUM(amount), 0) AS amount
     FROM wallet_transactions
     WHERE order_id = ? AND component IN (?, ?)`,
    [orderId, component, `${component}_repair`]
  );
  return money(rows[0] && rows[0].amount);
}

async function creditMissingIncome({ connection, adminId, actorId, order, component, label, expectedAmount }) {
  const creditedAmount = await existingAdminCredit(connection, order.id, component);
  const delta = money(expectedAmount - creditedAmount);
  if (delta <= 0) return 0;

  const displayOrder = order.order_number || order.id;
  await Wallet.applyLedgerEntry({
    userId: adminId,
    orderId: order.id,
    type: 'credit',
    amount: delta,
    component: `${component}_repair`,
    ledgerKey: `ORDER:${order.id}:ADMIN:${component.toUpperCase()}:REPAIR`,
    reference: `ORDER_${order.id}`,
    note: `${label} repair for order #${displayOrder}`,
    createdBy: actorId || adminId,
    connection,
  });
  return delta;
}

async function run() {
  const connection = await db.getConnection();
  const summary = {
    scannedOrders: 0,
    repairedOrders: 0,
    platformFeeCredited: 0,
    orderCommissionCredited: 0,
    deliveryCommissionCredited: 0,
  };

  try {
    await connection.beginTransaction();
    const adminId = await platformAdmin(connection);
    const orderSetting = await CommissionSetting.getOrderCommission(connection);
    const deliverySetting = await CommissionSetting.getDeliveryCommission(connection);
    const [orders] = await connection.query(
      `SELECT id, order_number, user_id, total_amount, delivery_charge, platform_fee,
              order_commission_amount, delivery_commission_amount,
              wallet_settled_at, delivery_wallet_settled_at
       FROM client_orders
       WHERE wallet_settled_at IS NOT NULL
          OR delivery_wallet_settled_at IS NOT NULL
       ORDER BY id ASC
       FOR UPDATE`
    );

    for (const order of orders) {
      summary.scannedOrders += 1;
      const totalPaid = money(order.total_amount);
      const deliveryCharge = Math.min(money(order.delivery_charge), totalPaid);
      const platformFee = Math.min(money(order.platform_fee), totalPaid);
      const vendorGross = money(Math.max(totalPaid - deliveryCharge - platformFee, 0));
      let repaired = false;

      if (order.wallet_settled_at) {
        const platformDelta = await creditMissingIncome({
          connection,
          adminId,
          actorId: order.user_id,
          order,
          component: 'admin_platform_fee',
          label: 'Platform fee',
          expectedAmount: platformFee,
        });
        const orderCommissionDelta = await creditMissingIncome({
          connection,
          adminId,
          actorId: order.user_id,
          order,
          component: 'admin_order_commission',
          label: 'Order commission',
          expectedAmount: expectedCommission(order.order_commission_amount, orderSetting, vendorGross),
        });
        summary.platformFeeCredited = money(summary.platformFeeCredited + platformDelta);
        summary.orderCommissionCredited = money(summary.orderCommissionCredited + orderCommissionDelta);
        repaired = platformDelta > 0 || orderCommissionDelta > 0;
      }

      if (order.delivery_wallet_settled_at) {
        const deliveryCommissionDelta = await creditMissingIncome({
          connection,
          adminId,
          actorId: order.user_id,
          order,
          component: 'admin_delivery_commission',
          label: 'Delivery commission',
          expectedAmount: expectedCommission(order.delivery_commission_amount, deliverySetting, deliveryCharge),
        });
        summary.deliveryCommissionCredited = money(summary.deliveryCommissionCredited + deliveryCommissionDelta);
        repaired = repaired || deliveryCommissionDelta > 0;
      }

      if (repaired) summary.repairedOrders += 1;
    }

    await connection.commit();
    console.log(JSON.stringify({ success: true, adminId, ...summary }, null, 2));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await db.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
