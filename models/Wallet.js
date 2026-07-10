const pool = require('../db');

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
    transaction_id: row.id,
    order_id: row.order_id === null || row.order_id === undefined ? null : Number(row.order_id),
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
    description: row.note || '',
    component: row.component || '',
    ledger_key: row.ledger_key || '',
    created_by: row.created_by,
    created_by_name: row.transaction_by_name || row.created_by_name,
    transaction_by_name: row.transaction_by_name || row.created_by_name,
    transaction_by_email: row.transaction_by_email,
    transaction_by_role: row.transaction_by_role,
    transaction_at: row.transaction_at || row.created_at,
    date_time: row.transaction_at || row.created_at,
    current_wallet_balance: Number(row.balance_after || 0),
    created_at: row.created_at,
  };
}

function normalizeAdminTransaction(row) {
  const transaction = normalizeTransaction(row);
  if (!transaction) return null;
  return {
    ...transaction,
    admin_name: row.admin_name,
    admin_email: row.admin_email,
    admin_role: row.admin_role,
  };
}

function parseDateInput(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function resolveAdminTransactionRange({ filter = 'today', fromDate = '', toDate = '' } = {}) {
  const now = new Date();
  let start;
  let end;
  const normalizedFilter = String(filter || 'today').toLowerCase();

  if (normalizedFilter === 'custom') {
    start = parseDateInput(fromDate);
    end = parseDateInput(toDate);
    if (end) end = addDays(end, 1);
  } else if (normalizedFilter === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    end = addDays(start, 1);
  }

  return {
    filter: ['today', 'month', 'custom'].includes(normalizedFilter) ? normalizedFilter : 'today',
    start,
    end,
  };
}

function appendTransactionDateWhere(where, values, range) {
  if (range.start) {
    where.push('COALESCE(wt.transaction_at, wt.created_at) >= ?');
    values.push(range.start);
  }
  if (range.end) {
    where.push('COALESCE(wt.transaction_at, wt.created_at) < ?');
    values.push(range.end);
  }
}

async function lockForUser(userId, connection = pool) {
  await ensureForUser(userId, connection);
  const [rows] = await connection.query(
    `SELECT w.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM wallets w INNER JOIN users u ON u.id = w.user_id
     WHERE w.user_id = ? AND u.is_deleted = 0 FOR UPDATE OF w`,
    [userId]
  );
  if (!rows.length) {
    const error = new Error('Wallet user was not found');
    error.status = 404;
    throw error;
  }
  return normalizeWallet(rows[0]);
}

async function applyLedgerEntry({
  userId,
  orderId = null,
  type,
  amount,
  component,
  ledgerKey,
  reference,
  note,
  createdBy = null,
  commissionSettingId = null,
  commissionAmount = 0,
  allowZero = false,
  connection = pool,
}) {
  const numericAmount = Number(Number(amount || 0).toFixed(2));
  if (!Number.isFinite(numericAmount) || numericAmount < 0 || (!allowZero && numericAmount <= 0)) {
    const error = new Error('Ledger amount must be greater than zero');
    error.status = 422;
    throw error;
  }
  if (!['credit', 'debit'].includes(type)) {
    const error = new Error('Ledger transaction type must be credit or debit');
    error.status = 422;
    throw error;
  }
  if (!ledgerKey) throw new Error('Ledger key is required');

  const [existingRows] = await connection.query(
    'SELECT * FROM wallet_transactions WHERE ledger_key = ? LIMIT 1',
    [ledgerKey]
  );
  if (existingRows.length) return normalizeTransaction(existingRows[0]);

  const wallet = await lockForUser(userId, connection);
  const [lockedExistingRows] = await connection.query(
    'SELECT * FROM wallet_transactions WHERE ledger_key = ? LIMIT 1',
    [ledgerKey]
  );
  if (lockedExistingRows.length) return normalizeTransaction(lockedExistingRows[0]);
  if (wallet.status !== 'active') {
    const error = new Error(`Wallet for user #${userId} is not active`);
    error.status = 422;
    throw error;
  }
  const before = Number(wallet.balance.toFixed(2));
  const after = Number((type === 'credit' ? before + numericAmount : before - numericAmount).toFixed(2));
  if (after < 0) {
    const error = new Error('Insufficient wallet balance');
    error.status = 400;
    throw error;
  }
  const [actorRows] = createdBy
    ? await connection.query('SELECT name, email, role FROM users WHERE id = ? LIMIT 1', [createdBy])
    : [[]];
  const actor = actorRows[0] || {};
  await connection.query(
    'UPDATE wallets SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [after, wallet.id]
  );
  const [result] = await connection.query(
    `INSERT INTO wallet_transactions
     (wallet_id, user_id, order_id, type, amount, commission_setting_id, commission_amount,
      net_amount, balance_before, balance_after, reference, note, component, ledger_key,
      created_by, transaction_by_name, transaction_by_email, transaction_by_role, transaction_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (ledger_key) DO NOTHING RETURNING id`,
    [
      wallet.id, userId, orderId, type, numericAmount, commissionSettingId,
      Number(commissionAmount || 0), numericAmount, before, after, reference || null,
      note || null, component || null, ledgerKey, createdBy, actor.name || null,
      actor.email || null, actor.role || null,
    ]
  );
  if (!result.insertId) {
    const [raceRows] = await connection.query(
      'SELECT * FROM wallet_transactions WHERE ledger_key = ? LIMIT 1',
      [ledgerKey]
    );
    return normalizeTransaction(raceRows[0]);
  }
  const [transactionRows] = await connection.query(
    'SELECT * FROM wallet_transactions WHERE id = ? LIMIT 1',
    [result.insertId]
  );
  return normalizeTransaction(transactionRows[0]);
}

async function ensureForUser(userId, connection = pool) {
  await connection.query(
    `INSERT INTO wallets (user_id, balance, currency, status)
     VALUES (?, 0.00, 'INR', 'active')
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
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
    where.push("LOWER(REPLACE(REPLACE(u.role, '_', ''), '-', '')) = ?");
    values.push(String(role).toLowerCase().replace(/[\s_-]+/g, ''));
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
    `SELECT wt.*, COALESCE(wt.transaction_by_name, u.name) AS created_by_name
     FROM wallet_transactions wt
     LEFT JOIN users u ON u.id = wt.created_by
     WHERE wt.wallet_id = ?
     ORDER BY COALESCE(wt.transaction_at, wt.created_at) DESC, wt.id DESC
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

    const [actorRows] = createdBy
      ? await connection.query('SELECT name, email, role FROM users WHERE id = ? LIMIT 1', [createdBy])
      : [[]];
    const actor = actorRows[0] || {};
    const netAmount = numericAmount;
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
       (wallet_id, user_id, type, amount, commission_setting_id, commission_amount, net_amount, balance_before, balance_after, reference, note, created_by, transaction_by_name, transaction_by_email, transaction_by_role, transaction_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        wallet.id,
        userId,
        type,
        numericAmount,
        null,
        0,
        Number(netAmount.toFixed(2)),
        balanceBefore,
        balanceAfter,
        reference || null,
        note || null,
        createdBy || null,
        actor.name || null,
        actor.email || null,
        actor.role || null,
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

async function adminTransactions({ page = 1, limit = 20, filter = 'today', fromDate = '', toDate = '' } = {}) {
  await ensureForAllUsers();
  const currentPage = Math.max(parseInt(page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const offset = (currentPage - 1) * pageSize;
  const range = resolveAdminTransactionRange({ filter, fromDate, toDate });
  const where = ["u.is_deleted = 0", "LOWER(u.role) IN ('admin', 'superadmin')"];
  const values = [];
  appendTransactionDateWhere(where, values, range);
  const whereSql = where.join(' AND ');

  const [balanceRows] = await pool.query(
    `SELECT COALESCE(SUM(w.balance), 0) AS total_balance
     FROM wallets w
     INNER JOIN users u ON u.id = w.user_id
     WHERE u.is_deleted = 0 AND LOWER(u.role) IN ('admin', 'superadmin')`
  );
  const [summaryRows] = await pool.query(
    `SELECT
        COALESCE(SUM(CASE WHEN wt.type = 'credit' THEN wt.amount ELSE 0 END), 0) AS total_credit,
        COALESCE(SUM(CASE WHEN wt.type = 'debit' THEN wt.amount ELSE 0 END), 0) AS total_debit,
        COUNT(*) AS transaction_count
     FROM wallet_transactions wt
     INNER JOIN wallets w ON w.id = wt.wallet_id
     INNER JOIN users u ON u.id = wt.user_id
     WHERE ${whereSql}`,
    values
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM wallet_transactions wt
     INNER JOIN wallets w ON w.id = wt.wallet_id
     INNER JOIN users u ON u.id = wt.user_id
     WHERE ${whereSql}`,
    values
  );
  const [rows] = await pool.query(
    `SELECT wt.*, u.name AS admin_name, u.email AS admin_email, u.role AS admin_role,
            COALESCE(wt.transaction_by_name, actor.name) AS created_by_name
     FROM wallet_transactions wt
     INNER JOIN wallets w ON w.id = wt.wallet_id
     INNER JOIN users u ON u.id = wt.user_id
     LEFT JOIN users actor ON actor.id = wt.created_by
     WHERE ${whereSql}
     ORDER BY COALESCE(wt.transaction_at, wt.created_at) DESC, wt.id DESC
     LIMIT ? OFFSET ?`,
    [...values, pageSize, offset]
  );
  const graph = await adminMonthlyGraph();

  return {
    range: {
      filter: range.filter,
      fromDate: range.start ? range.start.toISOString().slice(0, 10) : '',
      toDate: range.end ? addDays(range.end, -1).toISOString().slice(0, 10) : '',
    },
    summary: {
      total_wallet_balance: Number(balanceRows[0] && balanceRows[0].total_balance || 0),
      total_credit_amount: Number(summaryRows[0] && summaryRows[0].total_credit || 0),
      total_debit_amount: Number(summaryRows[0] && summaryRows[0].total_debit || 0),
      transaction_count: Number(summaryRows[0] && summaryRows[0].transaction_count || 0),
    },
    transactions: rows.map(normalizeAdminTransaction),
    graph,
    pagination: {
      page: currentPage,
      limit: pageSize,
      total: Number(countRows[0] && countRows[0].total || 0),
      totalPages: Math.max(Math.ceil(Number(countRows[0] && countRows[0].total || 0) / pageSize), 1),
    },
  };
}

async function adminMonthlyGraph() {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  start.setMonth(start.getMonth() - 11);

  const [rows] = await pool.query(
    `SELECT DATE_TRUNC('month', COALESCE(wt.transaction_at, wt.created_at)) AS month_start,
            COALESCE(SUM(CASE WHEN wt.type = 'credit' THEN wt.amount ELSE 0 END), 0) AS credit,
            COALESCE(SUM(CASE WHEN wt.type = 'debit' THEN wt.amount ELSE 0 END), 0) AS debit,
            COUNT(*) AS transaction_count
     FROM wallet_transactions wt
     INNER JOIN users u ON u.id = wt.user_id
     WHERE u.is_deleted = 0
       AND LOWER(u.role) IN ('admin', 'superadmin')
       AND COALESCE(wt.transaction_at, wt.created_at) >= ?
     GROUP BY DATE_TRUNC('month', COALESCE(wt.transaction_at, wt.created_at))
     ORDER BY month_start ASC`,
    [start]
  );

  const byMonth = new Map(rows.map((row) => [new Date(row.month_start).toISOString().slice(0, 7), row]));
  return Array.from({ length: 12 }, (_, index) => {
    const month = new Date(start);
    month.setMonth(start.getMonth() + index);
    const key = month.toISOString().slice(0, 7);
    const row = byMonth.get(key) || {};
    const credit = Number(row.credit || 0);
    const debit = Number(row.debit || 0);
    return {
      month: key,
      label: month.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
      credit,
      debit,
      net: Number((credit - debit).toFixed(2)),
      transaction_count: Number(row.transaction_count || 0),
    };
  });
}

module.exports = {
  ensureForUser,
  ensureForAllUsers,
  lockForUser,
  applyLedgerEntry,
  findByUserId,
  list,
  transactionsByUserId,
  adminTransactions,
  adjustBalance,
  updateStatus,
};
