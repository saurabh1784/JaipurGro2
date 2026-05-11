const pool = require('../db');
const CommissionSetting = require('./CommissionSetting');

function normalizeWallet(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    balance: Number(row.balance || 0),
    currency: row.currency || 'INR',
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    user_name: row.user_name,
    user_email: row.user_email,
    user_role: row.user_role,
  };
}

function normalizeTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    wallet_id: row.wallet_id,
    user_id: row.user_id,
    type: row.type,
    amount: Number(row.amount || 0),
    commission_setting_id: row.commission_setting_id,
    commission_amount: Number(row.commission_amount || 0),
    net_amount: Number(row.net_amount || 0),
    balance_before: Number(row.balance_before || 0),
    balance_after: Number(row.balance_after || 0),
    reference: row.reference,
    note: row.note,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
  };
}

async function ensureForUser(userId, connection = pool) {
  await connection.query(
    `INSERT INTO wallets (user_id, balance, currency, status)
     VALUES (?, 0.00, 'INR', 'active')
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
    [userId]
  );

  const [rows] = await connection.query('SELECT * FROM wallets WHERE user_id = ? LIMIT 1', [userId]);
  return normalizeWallet(rows[0]);
}

async function ensureForAllUsers(connection = pool) {
  await connection.query(
    `INSERT INTO wallets (user_id, balance, currency, status)
     SELECT u.id, 0.00, 'INR', 'active'
     FROM users u
     LEFT JOIN wallets w ON w.user_id = u.id
     WHERE u.is_deleted = 0 AND w.id IS NULL`
  );
}

async function findByUserId(userId) {
  await ensureForUser(userId);
  const [rows] = await pool.query(
    `SELECT w.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM wallets w
     INNER JOIN users u ON u.id = w.user_id
     WHERE w.user_id = ? AND u.is_deleted = 0
     LIMIT 1`,
    [userId]
  );
  return normalizeWallet(rows[0]);
}

async function list({ page = 1, limit = 10, search = '', role = '', status = '' }) {
  await ensureForAllUsers();
  const currentPage = Math.max(parseInt(page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const offset = (currentPage - 1) * pageSize;
  const where = ['u.is_deleted = 0'];
  const values = [];

  if (search) {
    where.push('(u.name LIKE ? OR u.email LIKE ?)');
    values.push(`%${search}%`, `%${search}%`);
  }

  if (role) {
    where.push('u.role = ?');
    values.push(role);
  }

  if (status) {
    where.push('w.status = ?');
    values.push(status);
  }

  const whereSql = where.join(' AND ');
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM wallets w
     INNER JOIN users u ON u.id = w.user_id
     WHERE ${whereSql}`,
    values
  );
  const [rows] = await pool.query(
    `SELECT w.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM wallets w
     INNER JOIN users u ON u.id = w.user_id
     WHERE ${whereSql}
     ORDER BY w.updated_at DESC, w.id DESC
     LIMIT ? OFFSET ?`,
    [...values, pageSize, offset]
  );

  return {
    wallets: rows.map(normalizeWallet),
    pagination: {
      page: currentPage,
      limit: pageSize,
      total: countRows[0].total,
      totalPages: Math.max(Math.ceil(countRows[0].total / pageSize), 1),
    },
  };
}

async function transactionsByUserId(userId, { page = 1, limit = 20 } = {}) {
  const wallet = await findByUserId(userId);
  const currentPage = Math.max(parseInt(page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const offset = (currentPage - 1) * pageSize;

  const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM wallet_transactions WHERE wallet_id = ?', [wallet.id]);
  const [rows] = await pool.query(
    `SELECT wt.*, u.name AS created_by_name
     FROM wallet_transactions wt
     LEFT JOIN users u ON u.id = wt.created_by
     WHERE wt.wallet_id = ?
     ORDER BY wt.created_at DESC, wt.id DESC
     LIMIT ? OFFSET ?`,
    [wallet.id, pageSize, offset]
  );

  return {
    wallet,
    transactions: rows.map(normalizeTransaction),
    pagination: {
      page: currentPage,
      limit: pageSize,
      total: countRows[0].total,
      totalPages: Math.max(Math.ceil(countRows[0].total / pageSize), 1),
    },
  };
}

async function adjustBalance({ userId, type, amount, note, reference, createdBy }) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    const error = new Error('Amount must be greater than zero');
    error.status = 422;
    throw error;
  }

  if (!['credit', 'debit'].includes(type)) {
    const error = new Error('Transaction type must be credit or debit');
    error.status = 422;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await ensureForUser(userId, connection);
    const [walletRows] = await connection.query('SELECT * FROM wallets WHERE user_id = ? FOR UPDATE', [userId]);
    const wallet = walletRows[0];
    if (!wallet || wallet.status !== 'active') {
      const error = new Error('Wallet is not active');
      error.status = 422;
      throw error;
    }

    const transactionType = type === 'credit' ? 'wallet_credit' : 'wallet_debit';
    const [userRows] = await connection.query('SELECT role FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1', [userId]);
    const roleSlug = userRows[0] && userRows[0].role;
    const commissionSetting = await CommissionSetting.findForRoleAndTransaction(roleSlug, transactionType, connection);
    const commissionAmount = CommissionSetting.calculateAmount(commissionSetting, numericAmount);
    const netAmount = type === 'credit'
      ? Math.max(numericAmount - commissionAmount, 0)
      : numericAmount + commissionAmount;
    const balanceBefore = Number(wallet.balance || 0);
    const balanceAfter = type === 'credit' ? balanceBefore + netAmount : balanceBefore - netAmount;
    if (balanceAfter < 0) {
      const error = new Error('Insufficient wallet balance');
      error.status = 422;
      throw error;
    }

    await connection.query('UPDATE wallets SET balance = ? WHERE id = ?', [balanceAfter, wallet.id]);
    await connection.query(
      `INSERT INTO wallet_transactions
       (wallet_id, user_id, type, amount, commission_setting_id, commission_amount, net_amount, balance_before, balance_after, reference, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        wallet.id,
        userId,
        type,
        numericAmount,
        commissionSetting ? commissionSetting.id : null,
        commissionAmount,
        Number(netAmount.toFixed(2)),
        balanceBefore,
        balanceAfter,
        reference || null,
        note || null,
        createdBy || null,
      ]
    );

    await connection.commit();
    return findByUserId(userId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateStatus(userId, status) {
  if (!['active', 'blocked'].includes(status)) {
    const error = new Error('Wallet status must be active or blocked');
    error.status = 422;
    throw error;
  }

  await ensureForUser(userId);
  await pool.query('UPDATE wallets SET status = ? WHERE user_id = ?', [status, userId]);
  return findByUserId(userId);
}

module.exports = {
  ensureForUser,
  ensureForAllUsers,
  findByUserId,
  list,
  transactionsByUserId,
  adjustBalance,
  updateStatus,
};
