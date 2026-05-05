const pool = require('../db');

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    theme_mode: row.theme_mode || 'light',
    is_deleted: Boolean(row.is_deleted),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function findByEmailOrPhone(email, phone) {
  const [rows] = await pool.query('SELECT * FROM users WHERE (email = ? OR phone = ?) AND is_deleted = 0 LIMIT 1', [email, phone]);
  return rows[0] || null;
}

async function findByEmail(email) {
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ? AND is_deleted = 0 LIMIT 1', [email]);
  return rows[0] || null;
}

async function findByEmailOrPhoneIdentifier(identifier) {
  const [rows] = await pool.query(
    'SELECT * FROM users WHERE (email = ? OR phone = ?) AND is_deleted = 0 LIMIT 1',
    [identifier, identifier]
  );
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.query(
    'SELECT id, name, email, phone, role, status, theme_mode, is_deleted, created_at, updated_at FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

async function create({ name, email, phone, password, role, status = 'active' }, connection = pool) {
  const [result] = await connection.query(
    'INSERT INTO users (name, email, phone, password, role, status) VALUES (?, ?, ?, ?, ?, ?)',
    [name, email, phone, password, role, status]
  );
  return result.insertId;
}

async function updateBasic(id, data) {
  const fields = [];
  const values = [];
  const allowedFields = ['name', 'email', 'phone', 'role', 'status'];

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      fields.push(`${field} = ?`);
      values.push(data[field]);
    }
  }

  if (fields.length === 0) {
    return;
  }

  values.push(id);
  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
}

async function list({ page = 1, limit = 10, search = '', role = '' }) {
  const currentPage = Math.max(parseInt(page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const offset = (currentPage - 1) * pageSize;
  const where = ['is_deleted = 0'];
  const values = [];

  if (search) {
    where.push('(name LIKE ? OR email LIKE ?)');
    values.push(`%${search}%`, `%${search}%`);
  }

  if (role) {
    where.push('role = ?');
    values.push(role);
  }

  const whereSql = where.join(' AND ');
  const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM users WHERE ${whereSql}`, values);
  const [rows] = await pool.query(
    `SELECT id, name, email, phone, role, status, theme_mode, is_deleted, created_at, updated_at
     FROM users
     WHERE ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...values, pageSize, offset]
  );

  return {
    users: rows.map(publicUser),
    pagination: {
      page: currentPage,
      limit: pageSize,
      total: countRows[0].total,
      totalPages: Math.max(Math.ceil(countRows[0].total / pageSize), 1),
    },
  };
}

async function softDelete(id) {
  await pool.query("UPDATE users SET is_deleted = 1, status = 'inactive' WHERE id = ?", [id]);
}

async function updateTheme(id, themeMode) {
  await pool.query('UPDATE users SET theme_mode = ? WHERE id = ? AND is_deleted = 0', [themeMode, id]);
}

async function emailOrPhoneTaken({ id, email, phone }) {
  const [rows] = await pool.query(
    'SELECT id, email, phone FROM users WHERE is_deleted = 0 AND id != ? AND (email = ? OR phone = ?) LIMIT 1',
    [id, email, phone]
  );
  return rows[0] || null;
}

module.exports = {
  publicUser,
  findByEmailOrPhone,
  findByEmail,
  findByEmailOrPhoneIdentifier,
  findById,
  create,
  updateBasic,
  list,
  softDelete,
  updateTheme,
  emailOrPhoneTaken,
};
