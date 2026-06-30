const pool = require('../db');

const commissionKinds = {
  order: {
    key: 'order_commission',
    label: 'Order Commission',
    basis: 'total_order_amount',
  },
  delivery: {
    key: 'delivery_commission',
    label: 'Delivery Commission',
    basis: 'delivery_charge',
  },
};

function money(value) {
  return Number(Math.max(Number(value || 0), 0).toFixed(2));
}

function normalizePercent(value) {
  const percent = Number(value || 0);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    const error = new Error('Commission percentages must be between 0 and 100');
    error.status = 422;
    throw error;
  }
  return Number(percent.toFixed(2));
}

function normalize(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.transaction_type,
    label: row.role_name,
    basis: row.role_slug === 'delivery' ? commissionKinds.delivery.basis : commissionKinds.order.basis,
    percentage: Number(row.commission_value || 0),
    is_active: Boolean(row.is_active),
    updated_at: row.updated_at,
  };
}

function calculatePercentageAmount(percentage, amount) {
  const numericAmount = Number(amount);
  const percent = Number(percentage || 0);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !Number.isFinite(percent) || percent <= 0) {
    return 0;
  }
  return money((numericAmount * percent) / 100);
}

function calculateAmount(setting, amount) {
  if (!setting || setting.is_active === false) return 0;
  return calculatePercentageAmount(setting.percentage ?? setting.commission_value, amount);
}

async function ensureDefaults(connection = pool) {
  for (const kind of Object.values(commissionKinds)) {
    await connection.query(
      `INSERT INTO commission_settings
       (role_slug, role_name, transaction_type, commission_type, commission_value, min_commission, max_commission, is_active)
       VALUES (?, ?, ?, 'percentage', 0.00, 0.00, NULL, 1)
       ON CONFLICT (role_slug, transaction_type) DO UPDATE
       SET role_name = EXCLUDED.role_name,
           commission_type = 'percentage',
           min_commission = 0.00,
           max_commission = NULL,
           is_active = 1`,
      [kind.key === commissionKinds.order.key ? 'order' : 'delivery', kind.label, kind.key]
    );
  }

  await connection.query(
    `DELETE FROM commission_settings
     WHERE transaction_type NOT IN (?, ?)
        OR role_slug NOT IN ('order', 'delivery')`,
    [commissionKinds.order.key, commissionKinds.delivery.key]
  );
}

async function list(connection = pool) {
  await ensureDefaults(connection);
  const [rows] = await connection.query(
    `SELECT *
     FROM commission_settings
     WHERE transaction_type IN (?, ?)
     ORDER BY CASE transaction_type
       WHEN ? THEN 1
       WHEN ? THEN 2
       ELSE 3
     END`,
    [
      commissionKinds.order.key,
      commissionKinds.delivery.key,
      commissionKinds.order.key,
      commissionKinds.delivery.key,
    ]
  );
  return rows.map(normalize);
}

async function findByKey(key, connection = pool) {
  if (!Object.values(commissionKinds).some((kind) => kind.key === key)) {
    return null;
  }
  await ensureDefaults(connection);
  const [rows] = await connection.query(
    `SELECT *
     FROM commission_settings
     WHERE transaction_type = ?
     LIMIT 1`,
    [key]
  );
  return normalize(rows[0]);
}

async function getOrderCommission(connection = pool) {
  return findByKey(commissionKinds.order.key, connection);
}

async function getDeliveryCommission(connection = pool) {
  return findByKey(commissionKinds.delivery.key, connection);
}

async function update(settings = {}) {
  const orderPercentage = normalizePercent(settings.order_commission_percentage);
  const deliveryPercentage = normalizePercent(settings.delivery_commission_percentage);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ensureDefaults(connection);
    await connection.query(
      `UPDATE commission_settings
       SET commission_value = ?, commission_type = 'percentage', min_commission = 0.00, max_commission = NULL, is_active = 1
       WHERE transaction_type = ?`,
      [orderPercentage, commissionKinds.order.key]
    );
    await connection.query(
      `UPDATE commission_settings
       SET commission_value = ?, commission_type = 'percentage', min_commission = 0.00, max_commission = NULL, is_active = 1
       WHERE transaction_type = ?`,
      [deliveryPercentage, commissionKinds.delivery.key]
    );
    await connection.commit();
    return list();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  commissionKinds,
  calculateAmount,
  calculatePercentageAmount,
  ensureDefaults,
  seedForRoles: ensureDefaults,
  getOrderCommission,
  getDeliveryCommission,
  list,
  update,
};
