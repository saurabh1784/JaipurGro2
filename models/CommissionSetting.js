const pool = require('../db');

const transactionTypes = ['wallet_credit', 'wallet_debit', 'order_payment', 'refund'];
const commissionTypes = ['percentage', 'fixed'];

function normalize(row) {
  if (!row) return null;
  return {
    id: row.id,
    role_slug: row.role_slug,
    role_name: row.role_name,
    transaction_type: row.transaction_type,
    commission_type: row.commission_type,
    commission_value: Number(row.commission_value || 0),
    min_commission: Number(row.min_commission || 0),
    max_commission: row.max_commission === null || row.max_commission === undefined ? null : Number(row.max_commission),
    is_active: Boolean(row.is_active),
    updated_at: row.updated_at,
  };
}

function calculateAmount(setting, amount) {
  const numericAmount = Number(amount);
  if (!setting || !setting.is_active || !Number.isFinite(numericAmount) || numericAmount <= 0) {
    return 0;
  }

  let commission = setting.commission_type === 'percentage'
    ? (numericAmount * Number(setting.commission_value || 0)) / 100
    : Number(setting.commission_value || 0);

  commission = Math.max(commission, Number(setting.min_commission || 0));
  if (setting.max_commission !== null && setting.max_commission !== undefined && setting.max_commission !== '') {
    commission = Math.min(commission, Number(setting.max_commission));
  }

  return Number(Math.max(commission, 0).toFixed(2));
}

async function seedForRoles(connection = pool) {
  const [roles] = await connection.query(`
    SELECT name, slug FROM roles
    UNION
    SELECT role AS name, role AS slug FROM users WHERE role IS NOT NULL AND role != ''
    ORDER BY name ASC
  `);
  for (const role of roles) {
    for (const transactionType of transactionTypes) {
      await connection.query(
        `INSERT INTO commission_settings
         (role_slug, role_name, transaction_type, commission_type, commission_value, min_commission, max_commission, is_active)
         VALUES (?, ?, ?, 'percentage', 0.00, 0.00, NULL, 0)
         ON CONFLICT (role_slug, transaction_type) DO UPDATE
         SET role_name = EXCLUDED.role_name`,
        [role.slug, role.name, transactionType]
      );
    }
  }
}

async function list() {
  await seedForRoles();
  const [rows] = await pool.query(
    `SELECT *
     FROM commission_settings
     ORDER BY CASE transaction_type
       WHEN 'wallet_credit' THEN 1
       WHEN 'wallet_debit' THEN 2
       WHEN 'order_payment' THEN 3
       WHEN 'refund' THEN 4
       ELSE 5
     END, role_name ASC`
  );
  return rows.map(normalize);
}

async function findForRoleAndTransaction(roleSlug, transactionType, connection = pool) {
  if (!roleSlug || !transactionTypes.includes(transactionType)) {
    return null;
  }

  const [rows] = await connection.query(
    `SELECT *
     FROM commission_settings
     WHERE role_slug = ? AND transaction_type = ? AND is_active = 1
     LIMIT 1`,
    [roleSlug, transactionType]
  );
  return normalize(rows[0]);
}

async function updateMany(settings) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await seedForRoles(connection);

    for (const item of settings) {
      if (!item.id) continue;
      if (!transactionTypes.includes(item.transaction_type)) {
        const error = new Error('Invalid transaction type');
        error.status = 422;
        throw error;
      }
      if (!commissionTypes.includes(item.commission_type)) {
        const error = new Error('Invalid commission type');
        error.status = 422;
        throw error;
      }

      const value = Number(item.commission_value);
      const min = Number(item.min_commission || 0);
      const max = item.max_commission === '' || item.max_commission === null || item.max_commission === undefined
        ? null
        : Number(item.max_commission);

      if (!Number.isFinite(value) || value < 0 || !Number.isFinite(min) || min < 0 || (max !== null && (!Number.isFinite(max) || max < 0))) {
        const error = new Error('Commission values must be valid positive numbers');
        error.status = 422;
        throw error;
      }
      if (max !== null && min > max) {
        const error = new Error('Minimum commission cannot be greater than maximum commission');
        error.status = 422;
        throw error;
      }

      await connection.query(
        `UPDATE commission_settings
         SET commission_type = ?,
             commission_value = ?,
             min_commission = ?,
             max_commission = ?,
             is_active = ?
         WHERE id = ? AND transaction_type = ?`,
        [
          item.commission_type,
          value,
          min,
          max,
          item.is_active ? 1 : 0,
          item.id,
          item.transaction_type,
        ]
      );
    }

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
  transactionTypes,
  commissionTypes,
  calculateAmount,
  seedForRoles,
  findForRoleAndTransaction,
  list,
  updateMany,
};
