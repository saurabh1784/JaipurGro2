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
  const { rows } = await pool.query('SELECT * FROM users WHERE (email = $1 OR phone = $2) AND is_deleted = 0 LIMIT 1', [email, phone]);
  return rows[0] || null;
}

async function findByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 AND is_deleted = 0 LIMIT 1', [email]);
  return rows[0] || null;
}

async function findByEmailOrPhoneIdentifier(identifier) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE (LOWER(email) = LOWER($1) OR phone = $2) AND is_deleted = 0 LIMIT 1',
    [identifier, identifier]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query(
    'SELECT id, name, email, phone, role, status, theme_mode, is_deleted, created_at, updated_at FROM users WHERE id = $1 AND is_deleted = 0 LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

async function create({ name, email, phone, password, role, status = 'active' }, connection = pool) {
  const { rows } = await connection.query(
    'INSERT INTO users (name, email, phone, password, role, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [name, email, phone, password, role, status]
  );
  return rows[0].id;
}

async function updateBasic(id, data) {
  const fields = [];
  const values = [];
  const allowedFields = ['name', 'email', 'phone', 'role', 'status'];

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      fields.push(`${field} = $${values.length + 1}`);
      values.push(data[field]);
    }
  }

  if (fields.length === 0) {
    return;
  }

  values.push(id);
  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
}

async function list({ page = 1, limit = 10, search = '', role = '', isSuperAdmin = true, adminCity = '' } = {}) {
  const currentPage = Math.max(parseInt(page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const offset = (currentPage - 1) * pageSize;
  const where = ['u.is_deleted = 0'];
  const values = [];

  if (!isSuperAdmin) {
    where.push("LOWER(u.role) NOT IN ('superadmin', 'super admin')");
  }

  if (search) {
    where.push('(u.name ILIKE $' + (values.length + 1) + ' OR u.email ILIKE $' + (values.length + 2) + ')');
    values.push(`%${search}%`, `%${search}%`);
  }

  if (role) {
    where.push('u.role = $' + (values.length + 1));
    values.push(role);
  }

  if (!isSuperAdmin && adminCity) {
    where.push('LOWER(TRIM(COALESCE(ap.city, cp.city, vp.city, dpp.city, \'\'))) = LOWER(TRIM($' + (values.length + 1) + '))');
    values.push(adminCity);
  }

  const whereSql = where.join(' AND ');
  const fromJoinSql = `
    FROM users u
    LEFT JOIN admin_profiles ap ON ap.user_id = u.id
    LEFT JOIN client_profiles cp ON cp.user_id = u.id
    LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
    LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
  `;

  const { rows: countRows } = await pool.query(`SELECT COUNT(DISTINCT u.id) as total ${fromJoinSql} WHERE ${whereSql}`, values);
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id, u.name, u.email, u.phone, u.role, u.status, u.theme_mode, u.is_deleted, u.created_at, u.updated_at,
            COALESCE(ap.city, cp.city, vp.city, dpp.city, '') AS city
     FROM users u
     LEFT JOIN admin_profiles ap ON ap.user_id = u.id
     LEFT JOIN client_profiles cp ON cp.user_id = u.id
     LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
     LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
     WHERE ${whereSql}
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, offset]
  );

  return {
    users: rows.map((r) => ({ ...publicUser(r), city: r.city || '' })),
    pagination: {
      page: currentPage,
      limit: pageSize,
      total: parseInt(countRows[0].total, 10),
      totalPages: Math.max(Math.ceil(parseInt(countRows[0].total, 10) / pageSize), 1),
    },
  };
}

async function softDelete(id) {
  await pool.query("UPDATE users SET is_deleted = 1, status = 'inactive' WHERE id = $1", [id]);
}

async function updateTheme(id, themeMode) {
  await pool.query('UPDATE users SET theme_mode = $1 WHERE id = $2 AND is_deleted = 0', [themeMode, id]);
}

async function emailOrPhoneTaken({ id, email, phone }) {
  const { rows } = await pool.query(
    'SELECT id, email, phone FROM users WHERE is_deleted = 0 AND id != $1 AND (email = $2 OR phone = $3) LIMIT 1',
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
