const pool = require('../db');

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendor_bank_accounts (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER NOT NULL UNIQUE,
      account_number VARCHAR(100),
      ifsc_code VARCHAR(50),
      bank_name VARCHAR(255),
      account_holder_name VARCHAR(255),
      upi_id VARCHAR(255),
      payout_method VARCHAR(50) DEFAULT 'bank',
      pay_to_phone VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS payout_method VARCHAR(50) DEFAULT 'bank'`);
  await pool.query(`ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS pay_to_phone VARCHAR(50)`);
  await pool.query(`ALTER TABLE vendor_bank_accounts ALTER COLUMN account_number DROP NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE vendor_bank_accounts ALTER COLUMN ifsc_code DROP NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE vendor_bank_accounts ALTER COLUMN bank_name DROP NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE vendor_bank_accounts ALTER COLUMN account_holder_name DROP NOT NULL`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendor_withdrawal_requests (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER NOT NULL,
      vendor_name VARCHAR(255),
      business_name VARCHAR(255),
      city VARCHAR(255) NOT NULL,
      amount NUMERIC(12, 2) NOT NULL,
      bank_details JSONB NOT NULL DEFAULT '{}',
      note TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      admin_remark TEXT,
      processed_by_user_id INTEGER,
      processed_by_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMP
    )
  `);
}

ensureTables().catch(err => console.error('Error creating vendor withdrawal tables:', err));

function normalizeRequest(row) {
  if (!row) return null;
  let bankDetails = row.bank_details || {};
  if (typeof bankDetails === 'string') {
    try { bankDetails = JSON.parse(bankDetails); } catch { bankDetails = {}; }
  }
  return {
    id: row.id,
    vendor_id: Number(row.vendor_id),
    vendor_name: row.vendor_name || row.u_name || '',
    business_name: row.business_name || row.v_business_name || '',
    city: row.city || row.v_city || 'Unassigned',
    amount: Number(row.amount || 0),
    bank_details: bankDetails,
    note: row.note || '',
    status: row.status || 'pending',
    admin_remark: row.admin_remark || '',
    processed_by_user_id: row.processed_by_user_id ? Number(row.processed_by_user_id) : null,
    processed_by_name: row.processed_by_name || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    processed_at: row.processed_at,
  };
}

function normalizeBankAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    vendor_id: Number(row.vendor_id),
    account_number: row.account_number || '',
    ifsc_code: row.ifsc_code || '',
    bank_name: row.bank_name || '',
    account_holder_name: row.account_holder_name || '',
    upi_id: row.upi_id || '',
    payout_method: row.payout_method || 'bank',
    pay_to_phone: row.pay_to_phone || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getBankAccount(vendorId) {
  await ensureTables();
  const { rows } = await pool.query('SELECT * FROM vendor_bank_accounts WHERE vendor_id = $1 LIMIT 1', [vendorId]);
  return normalizeBankAccount(rows[0]);
}

async function saveBankAccount(vendorId, { accountNumber = '', ifscCode = '', bankName = '', accountHolderName = '', upiId = '', payoutMethod = 'bank', payToPhone = '' }) {
  await ensureTables();
  const sql = `
    INSERT INTO vendor_bank_accounts (vendor_id, account_number, ifsc_code, bank_name, account_holder_name, upi_id, payout_method, pay_to_phone, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
    ON CONFLICT (vendor_id) DO UPDATE SET
      account_number = EXCLUDED.account_number,
      ifsc_code = EXCLUDED.ifsc_code,
      bank_name = EXCLUDED.bank_name,
      account_holder_name = EXCLUDED.account_holder_name,
      upi_id = EXCLUDED.upi_id,
      payout_method = EXCLUDED.payout_method,
      pay_to_phone = EXCLUDED.pay_to_phone,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *`;
  const { rows } = await pool.query(sql, [
    vendorId,
    accountNumber || null,
    ifscCode || null,
    bankName || null,
    accountHolderName || null,
    upiId || null,
    payoutMethod || 'bank',
    payToPhone || null,
  ]);
  return normalizeBankAccount(rows[0]);
}

async function createRequest(vendorId, { amount, bankDetails, note = '' }) {
  await ensureTables();
  const { rows: userRows } = await pool.query(
    `SELECT u.name, u.email, vp.business_name, COALESCE(vp.city, u.city, 'Jaipur') AS city
     FROM users u
     LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
     WHERE u.id = $1 LIMIT 1`,
    [vendorId]
  );
  const u = userRows[0] || {};
  const vendorName = u.name || 'Vendor';
  const businessName = u.business_name || u.name || 'Vendor Business';
  const city = u.city || 'Jaipur';

  const sql = `
    INSERT INTO vendor_withdrawal_requests (vendor_id, vendor_name, business_name, city, amount, bank_details, note, status)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'pending')
    RETURNING *`;
  const { rows } = await pool.query(sql, [vendorId, vendorName, businessName, city, Number(amount), JSON.stringify(bankDetails), note]);
  return normalizeRequest(rows[0]);
}

async function listRequests({ vendorId = null, city = '', status = '', search = '', page = 1, limit = 20 } = {}) {
  await ensureTables();
  const currentPage = Math.max(Number(page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const where = [];
  const values = [];

  if (vendorId) {
    values.push(vendorId);
    where.push(`r.vendor_id = $${values.length}`);
  }
  if (city) {
    values.push(city);
    where.push(`LOWER(TRIM(r.city)) = LOWER(TRIM($${values.length}))`);
  }
  if (status) {
    values.push(status);
    where.push(`LOWER(r.status) = LOWER($${values.length})`);
  }
  if (search) {
    values.push(`%${search}%`);
    where.push(`(r.vendor_name ILIKE $${values.length} OR r.business_name ILIKE $${values.length} OR CAST(r.id AS TEXT) ILIKE $${values.length})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countSql = `SELECT COUNT(*) AS total FROM vendor_withdrawal_requests r ${whereSql}`;
  const dataSql = `
    SELECT r.*, u.name AS u_name, vp.business_name AS v_business_name, vp.city AS v_city
    FROM vendor_withdrawal_requests r
    LEFT JOIN users u ON u.id = r.vendor_id
    LEFT JOIN vendor_profiles vp ON vp.user_id = r.vendor_id
    ${whereSql}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;

  const { rows: countRows } = await pool.query(countSql, values);
  const { rows } = await pool.query(dataSql, [...values, pageSize, (currentPage - 1) * pageSize]);
  const total = Number(countRows[0]?.total || 0);

  return {
    requests: rows.map(normalizeRequest),
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    },
  };
}

async function findById(id) {
  await ensureTables();
  const { rows } = await pool.query('SELECT * FROM vendor_withdrawal_requests WHERE id = $1 LIMIT 1', [id]);
  return normalizeRequest(rows[0]);
}

async function approveRequest(id, { adminRemark = '', processedByUserId, processedByName }) {
  await ensureTables();
  const req = await findById(id);
  if (!req) {
    const error = new Error('Withdrawal request not found');
    error.status = 404;
    throw error;
  }
  if (req.status !== 'pending') {
    const error = new Error(`Withdrawal request is already ${req.status}`);
    error.status = 422;
    throw error;
  }

  const sql = `
    UPDATE vendor_withdrawal_requests
    SET status = 'approved',
        admin_remark = $1,
        processed_by_user_id = $2,
        processed_by_name = $3,
        processed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $4
    RETURNING *`;
  const { rows } = await pool.query(sql, [adminRemark || null, processedByUserId, processedByName, id]);
  return normalizeRequest(rows[0]);
}

async function rejectRequest(id, { adminRemark = '', processedByUserId, processedByName }) {
  await ensureTables();
  const req = await findById(id);
  if (!req) {
    const error = new Error('Withdrawal request not found');
    error.status = 404;
    throw error;
  }
  if (req.status !== 'pending') {
    const error = new Error(`Withdrawal request is already ${req.status}`);
    error.status = 422;
    throw error;
  }

  const sql = `
    UPDATE vendor_withdrawal_requests
    SET status = 'rejected',
        admin_remark = $1,
        processed_by_user_id = $2,
        processed_by_name = $3,
        processed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $4
    RETURNING *`;
  const { rows } = await pool.query(sql, [adminRemark || null, processedByUserId, processedByName, id]);
  return normalizeRequest(rows[0]);
}

module.exports = {
  ensureTables,
  getBankAccount,
  saveBankAccount,
  createRequest,
  listRequests,
  findById,
  approveRequest,
  rejectRequest,
};
