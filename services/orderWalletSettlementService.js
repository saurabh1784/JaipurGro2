const Wallet = require('../models/Wallet');
const CommissionSetting = require('../models/CommissionSetting');

const money = (value) => Number(Math.max(Number(value || 0), 0).toFixed(2));

function hasAreaPricingSnapshot(order) {
  return Boolean(order && order.area_pricing_snapshot);
}

function resolvedCommissionAmount({ order, storedAmount, setting, basisAmount }) {
  const stored = money(storedAmount);
  if (stored > 0) {
    return stored;
  }

  const calculated = CommissionSetting.calculateAmount(setting, basisAmount);
  if (calculated > 0) {
    return calculated;
  }

  return hasAreaPricingSnapshot(order) ? stored : calculated;
}

async function platformAdmin(connection) {
  const configuredId = Number(process.env.PLATFORM_ADMIN_USER_ID || 0);
  const params = configuredId > 0 ? [configuredId] : [];
  const configuredFilter = configuredId > 0 ? 'AND id = ?' : '';
  const [rows] = await connection.query(
    `SELECT id, name, email, role
     FROM users
     WHERE is_deleted = 0
       AND LOWER(role) IN ('superadmin', 'admin')
       ${configuredFilter}
     ORDER BY CASE WHEN LOWER(role) = 'superadmin' THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    params
  );
  if (!rows.length) {
    const error = new Error(configuredId > 0
      ? 'Configured platform admin wallet user was not found'
      : 'No active platform admin user is available for portal settlement');
    error.status = 500;
    throw error;
  }
  return rows[0];
}

async function assertSufficientBalance(userId, requiredAmount, connection) {
  const wallet = await Wallet.lockForUser(userId, connection);
  if (wallet.status !== 'active') {
    const error = new Error('Client wallet is not active');
    error.status = 422;
    throw error;
  }
  if (money(wallet.balance) < money(requiredAmount)) {
    const error = new Error('Insufficient wallet balance');
    error.status = 400;
    throw error;
  }
  return wallet;
}

async function settleOrderPlacement({ orderId, actorId, connection }) {
  const [rows] = await connection.query(
    `SELECT id, order_number, user_id, vendor_id, total_amount, subtotal_amount,
            discount_amount, delivery_charge, platform_fee, order_commission_amount, area_pricing_snapshot
     FROM client_orders WHERE id = ? FOR UPDATE`,
    [orderId]
  );
  if (!rows.length) throw new Error('Order not found for wallet settlement');
  const order = rows[0];

  const totalPaid = money(order.total_amount);
  const deliveryCharge = Math.min(money(order.delivery_charge), totalPaid);
  const platformFee = Math.min(money(order.platform_fee), totalPaid);
  const displayOrder = order.order_number || order.id;

  await Wallet.applyLedgerEntry({
    userId: order.user_id,
    orderId: order.id,
    type: 'debit',
    amount: totalPaid,
    component: 'client_order_payment',
    ledgerKey: `ORDER:${order.id}:CLIENT:PAYMENT`,
    reference: `ORDER_${order.id}`,
    note: `Payment for order #${displayOrder}, including delivery charge INR ${deliveryCharge.toFixed(2)}`,
    createdBy: actorId || order.user_id,
    connection,
  });

  return { totalPaid, deliveryCharge, platformFee };
}

async function settleOrderCompletion({ orderId, actorId, connection }) {
  const [rows] = await connection.query(
    `SELECT id, order_number, user_id, vendor_id, total_amount, subtotal_amount,
            discount_amount, delivery_charge, platform_fee, order_commission_amount,
            area_pricing_snapshot, wallet_settled_at, platform_charge, vendor_earning
     FROM client_orders WHERE id = ? FOR UPDATE`,
    [orderId]
  );
  if (!rows.length) throw new Error('Order not found for completion settlement');
  const order = rows[0];
  if (!order.vendor_id) throw new Error('Order vendor is required for completion settlement');

  const totalPaid = money(order.total_amount);
  const deliveryCharge = Math.min(money(order.delivery_charge), totalPaid);
  const platformFee = Math.min(money(order.platform_fee), totalPaid);
  const vendorGross = money(Math.max(totalPaid - deliveryCharge - platformFee, 0));
  const setting = await CommissionSetting.getOrderCommission(connection);
  const orderCommission = Math.min(
    resolvedCommissionAmount({
      order,
      storedAmount: order.order_commission_amount,
      setting,
      basisAmount: vendorGross,
    }),
    vendorGross
  );
  const vendorEarning = money(vendorGross - orderCommission);
  const admin = await platformAdmin(connection);
  const displayOrder = order.order_number || order.id;

  if (order.wallet_settled_at) {
    return {
      totalPaid,
      deliveryCharge,
      platformFee,
      vendorGross,
      orderCommission: money(order.platform_charge || orderCommission),
      vendorEarning: money(order.vendor_earning || vendorEarning),
      adminUserId: admin.id,
      skipped: 'already_settled',
    };
  }

  await Wallet.applyLedgerEntry({
    userId: admin.id,
    orderId: order.id,
    type: 'credit',
    amount: platformFee,
    component: 'admin_platform_fee',
    ledgerKey: `ORDER:${order.id}:ADMIN:PLATFORM_FEE`,
    reference: `ORDER_${order.id}`,
    note: `Platform fee for order #${displayOrder}`,
    createdBy: actorId || order.user_id,
    allowZero: true,
    connection,
  });

  await Wallet.applyLedgerEntry({
    userId: admin.id,
    orderId: order.id,
    type: 'credit',
    amount: orderCommission,
    component: 'admin_order_commission',
    ledgerKey: `ORDER:${order.id}:ADMIN:ORDER_COMMISSION`,
    reference: `ORDER_${order.id}`,
    note: `Order commission for order #${displayOrder}`,
    createdBy: actorId || order.user_id,
    commissionSettingId: setting ? setting.id : null,
    commissionAmount: orderCommission,
    allowZero: true,
    connection,
  });

  await Wallet.applyLedgerEntry({
    userId: order.vendor_id,
    orderId: order.id,
    type: 'credit',
    amount: vendorEarning,
    component: 'vendor_order_earning',
    ledgerKey: `ORDER:${order.id}:VENDOR:EARNING`,
    reference: `ORDER_${order.id}`,
    note: `Vendor earning for order #${displayOrder} after order commission INR ${orderCommission.toFixed(2)}`,
    createdBy: actorId || order.user_id,
    commissionSettingId: setting ? setting.id : null,
    commissionAmount: orderCommission,
    allowZero: true,
    connection,
  });

  await connection.query(
    `UPDATE client_orders
     SET platform_charge = ?, vendor_earning = ?, wallet_settled_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [orderCommission, vendorEarning, order.id]
  );

  return { totalPaid, deliveryCharge, platformFee, vendorGross, orderCommission, vendorEarning, adminUserId: admin.id };
}

async function settleDeliveryCompletion({ orderId, deliveryPersonId, actorId, connection }) {
  const [rows] = await connection.query(
    `SELECT o.id, o.order_number, o.status, o.delivery_status, o.delivery_partner_id,
            o.delivery_wallet_settled_at, o.delivery_earning AS settled_delivery_earning,
            o.delivery_commission_amount, o.area_pricing_snapshot,
            COALESCE(accepted_offer.delivery_charge, o.delivery_charge, 0) AS gross_delivery_charge,
            COALESCE(accepted_offer.delivery_partner_earning, o.delivery_charge, 0) AS offered_delivery_earning
     FROM client_orders o
     LEFT JOIN delivery_order_offers accepted_offer
       ON accepted_offer.order_id = o.id
      AND accepted_offer.delivery_person_id = o.delivery_partner_id
      AND accepted_offer.status = 'accepted'
     WHERE o.id = ?
     ORDER BY accepted_offer.id DESC
     LIMIT 1
     FOR UPDATE OF o`,
    [orderId]
  );
  if (!rows.length) throw new Error('Order not found for delivery settlement');
  const order = rows[0];
  const orderDelivered = ['delivered', 'completed'].includes(String(order.status || '').toLowerCase())
    || String(order.delivery_status || '').toLowerCase() === 'delivered';
  if (!orderDelivered) {
    return { deliveryPersonId: deliveryPersonId || order.delivery_partner_id || null, deliveryEarning: 0, skipped: 'not_delivered' };
  }
  const orderSettlement = await settleOrderCompletion({ orderId, actorId, connection });
  if (order.delivery_wallet_settled_at) {
    return {
      deliveryPersonId: deliveryPersonId || order.delivery_partner_id || null,
      deliveryEarning: money(order.settled_delivery_earning),
      orderSettlement,
      skipped: 'already_settled',
    };
  }
  const partnerId = Number(deliveryPersonId || order.delivery_partner_id || 0);
  const deliveryCharge = money(order.gross_delivery_charge);
  const setting = await CommissionSetting.getDeliveryCommission(connection);
  const deliveryCommission = Math.min(
    resolvedCommissionAmount({
      order,
      storedAmount: order.delivery_commission_amount,
      setting,
      basisAmount: deliveryCharge,
    }),
    deliveryCharge
  );
  const deliveryEarning = money(deliveryCharge - deliveryCommission);
  if (!partnerId || deliveryCharge <= 0) {
    return { deliveryPersonId: partnerId || null, deliveryEarning: 0, orderSettlement };
  }
  const admin = await platformAdmin(connection);
  const displayOrder = order.order_number || order.id;
  await Wallet.applyLedgerEntry({
    userId: admin.id,
    orderId: order.id,
    type: 'credit',
    amount: deliveryCommission,
    component: 'admin_delivery_commission',
    ledgerKey: `ORDER:${order.id}:ADMIN:DELIVERY_COMMISSION`,
    reference: `ORDER_${order.id}`,
    note: `Delivery commission for order #${displayOrder}`,
    createdBy: actorId || partnerId,
    commissionSettingId: setting ? setting.id : null,
    commissionAmount: deliveryCommission,
    allowZero: true,
    connection,
  });
  await Wallet.applyLedgerEntry({
    userId: partnerId,
    orderId: order.id,
    type: 'credit',
    amount: deliveryEarning,
    component: 'delivery_person_earning',
    ledgerKey: `ORDER:${order.id}:DELIVERY_PERSON:EARNING`,
    reference: `ORDER_${order.id}`,
    note: `Delivery earning for completed order #${displayOrder} after delivery commission INR ${deliveryCommission.toFixed(2)}`,
    createdBy: actorId || partnerId,
    commissionSettingId: setting ? setting.id : null,
    commissionAmount: deliveryCommission,
    allowZero: true,
    connection,
  });
  await connection.query(
    `UPDATE client_orders SET delivery_earning = ?, delivery_wallet_settled_at = CURRENT_TIMESTAMP,
     updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [deliveryEarning, order.id]
  );
  return { deliveryPersonId: partnerId, deliveryCharge, deliveryCommission, deliveryEarning, adminUserId: admin.id, orderSettlement };
}

module.exports = {
  assertSufficientBalance,
  settleOrderCompletion,
  settleOrderPlacement,
  settleDeliveryCompletion,
};
