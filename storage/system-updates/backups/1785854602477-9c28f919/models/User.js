const pool = require('../db');

function isProfileCompleted(row) {
  if (!row) return false;
  const name = String(row.name || '').trim();
  const email = String(row.email || '').trim();
  const city = String(row.city || '').trim();

  // If placeholder name e.g. "User 1234" or empty
  if (!name || /^User\s+\d+/i.test(name) || name.length < 2) {
    return false;
  }
  // Email and city are mandatory
  if (!email || !city) {
    return false;
  }
  return true;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    rejection_reason: row.rejection_reason || row.rejectionReason || '',
    theme_mode: row.theme_mode || 'light',
    is_deleted: Boolean(row.is_deleted),
    country: row.country || '',
    state: row.state || '',
    city: row.city || '',
    area: row.area || '',
    assigned_admin_id: row.assigned_admin_id || null,
    assigned_admin_name: row.assigned_admin_name || '',
    is_profile_completed: isProfileCompleted(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function locationSelectSql() {
  return `COALESCE(NULLIF(u.country, ''), ap.country, cp.country, vp.country, '') AS country,
          COALESCE(NULLIF(u.state, ''), ap.state, cp.state, vp.state, '') AS state,
          COALESCE(NULLIF(u.city, ''), ap.city, cp.city, vp.city, dpp.city, '') AS city,
          COALESCE(NULLIF(u.area, ''), ap.area, cp.area, vp.area, dpp.area, '') AS area`;
}

function profileJoinSql() {
  return `LEFT JOIN admin_profiles ap ON ap.user_id = u.id
          LEFT JOIN client_profiles cp ON cp.user_id = u.id
          LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
          LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
          LEFT JOIN users au ON au.id = u.assigned_admin_id`;
}

function normalizedRoleSql(column) {
  return `LOWER(REPLACE(REPLACE(REPLACE(${column}, ' ', ''), '_', ''), '-', ''))`;
}

async function findByEmailOrPhone(email, phone) {
  const cleanEmail = email ? String(email).trim().toLowerCase() : '';
  const cleanPhone = phone ? String(phone).trim() : '';

  if (cleanEmail && cleanPhone) {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE (LOWER(email) = $1 OR phone = $2) AND is_deleted = 0 LIMIT 1',
      [cleanEmail, cleanPhone]
    );
    return rows[0] || null;
  }
  if (cleanEmail) {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = $1 AND is_deleted = 0 LIMIT 1',
      [cleanEmail]
    );
    return rows[0] || null;
  }
  if (cleanPhone) {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE phone = $1 AND is_deleted = 0 LIMIT 1',
      [cleanPhone]
    );
    return rows[0] || null;
  }
  return null;
}

async function findByEmail(email) {
  const cleanEmail = email ? String(email).trim().toLowerCase() : '';
  if (!cleanEmail) return null;
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1 AND is_deleted = 0 LIMIT 1', [cleanEmail]);
  return rows[0] || null;
}

async function findByEmailOrPhoneIdentifier(identifier) {
  const clean = String(identifier || '').trim();
  if (!clean) return null;
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE (LOWER(email) = LOWER($1) OR phone = $2 OR LOWER(name) = LOWER($1)) AND is_deleted = 0 ORDER BY id ASC LIMIT 1',
    [clean, clean]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.theme_mode, u.is_deleted,
            u.assigned_admin_id, au.name AS assigned_admin_name, ${locationSelectSql()},
            u.created_at, u.updated_at
     FROM users u
     ${profileJoinSql()}
     WHERE u.id = $1 AND u.is_deleted = 0
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function create({
  name,
  email,
  phone,
  password,
  role,
  status = 'active',
  country = null,
  state = null,
  city = null,
  area = null,
  assigned_admin_id = null,
  created_by = null,
}, connection = pool) {
  const cleanEmail = email && String(email).trim() ? String(email).trim().toLowerCase() : null;
  const cleanPhone = phone && String(phone).trim() ? String(phone).trim() : null;

  const { rows } = await connection.query(
    `INSERT INTO users
      (name, email, phone, password, role, status, country, state, city, area, assigned_admin_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [name, cleanEmail, cleanPhone, password, role, status, country, state, city, area, assigned_admin_id, created_by]
  );
  return rows[0].id;
}

async function updateBasic(id, data) {
  const fields = [];
  const values = [];
  const allowedFields = ['name', 'email', 'phone', 'role', 'status', 'country', 'state', 'city', 'area', 'assigned_admin_id'];

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      fields.push(`${field} = $${values.length + 1}`);
      values.push(data[field]);
    }
  }

  if (fields.length === 0) return;

  values.push(id);
  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
}

async function list({
  page = 1,
  limit = 10,
  search = '',
  role = '',
  status = '',
  city = '',
  area = '',
  assignedAdminId = '',
  isSuperAdmin = true,
  adminCity = '',
  adminArea = '',
  adminId = null,
} = {}) {
  const currentPage = Math.max(parseInt(page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const offset = (currentPage - 1) * pageSize;
  const where = ['u.is_deleted = 0'];
  const values = [];

  if (!isSuperAdmin) {
    where.push(`${normalizedRoleSql('u.role')} NOT IN ('superadmin', 'admin')`);
  }

  if (search) {
    where.push('(u.name ILIKE $' + (values.length + 1) + ' OR u.email ILIKE $' + (values.length + 2) + ' OR u.phone ILIKE $' + (values.length + 3) + ')');
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (role) {
    where.push('u.role = $' + (values.length + 1));
    values.push(role);
  }

  if (status) {
    where.push('LOWER(u.status) = LOWER($' + (values.length + 1) + ')');
    values.push(status);
  }

  const scopedCity = !isSuperAdmin ? adminCity : city;
  if (scopedCity) {
    where.push('LOWER(TRIM(COALESCE(NULLIF(u.city, \'\'), ap.city, cp.city, vp.city, dpp.city, \'\'))) = LOWER(TRIM($' + (values.length + 1) + '))');
    values.push(scopedCity);
  }

  const scopedArea = !isSuperAdmin && adminArea && adminArea !== '*' ? adminArea : area;
  if (scopedArea) {
    where.push('LOWER(TRIM(COALESCE(NULLIF(u.area, \'\'), ap.area, cp.area, vp.area, dpp.area, \'\'))) = LOWER(TRIM($' + (values.length + 1) + '))');
    values.push(scopedArea);
  }

  if (!isSuperAdmin && adminId) {
    where.push('u.assigned_admin_id = $' + (values.length + 1));
    values.push(Number(adminId));
  } else if (assignedAdminId) {
    where.push('u.assigned_admin_id = $' + (values.length + 1));
    values.push(Number(assignedAdminId));
  }
  const whereSql = where.join(' AND ');
  const fromJoinSql = `
    FROM users u
    ${profileJoinSql()}
  `;

  const { rows: countRows } = await pool.query(`SELECT COUNT(DISTINCT u.id) as total ${fromJoinSql} WHERE ${whereSql}`, values);
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id, u.name, u.email, u.phone, u.role, u.status, u.theme_mode, u.is_deleted, u.created_at, u.updated_at,
            u.assigned_admin_id, au.name AS assigned_admin_name, ${locationSelectSql()}
     FROM users u
     ${profileJoinSql()}
     WHERE ${whereSql}
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, offset]
  );

  return {
    users: rows.map(publicUser),
    pagination: {
      page: currentPage,
      limit: pageSize,
      total: parseInt(countRows[0].total, 10),
      totalPages: Math.max(Math.ceil(parseInt(countRows[0].total, 10) / pageSize), 1),
    },
  };
}

async function activeSuperadminCount(excludeUserId = null) {
  const values = [];
  let where = `is_deleted = 0 AND status = 'active' AND ${normalizedRoleSql('role')} = 'superadmin'`;
  if (excludeUserId) {
    values.push(excludeUserId);
    where += ` AND id != $${values.length}`;
  }
  const { rows } = await pool.query(`SELECT COUNT(*) AS total FROM users WHERE ${where}`, values);
  return Number(rows[0] && rows[0].total || 0);
}

async function softDelete(id) {
  await pool.query("UPDATE users SET is_deleted = 1, status = 'inactive' WHERE id = $1", [id]);
}

async function updateTheme(id, themeMode) {
  await pool.query('UPDATE users SET theme_mode = $1 WHERE id = $2 AND is_deleted = 0', [themeMode, id]);
}

async function emailOrPhoneTaken({ id, email, phone }) {
  const values = [id || 0];
  const checks = [];
  if (email) {
    values.push(email);
    checks.push(`LOWER(email) = LOWER($${values.length})`);
  }
  if (phone) {
    values.push(phone);
    checks.push(`phone = $${values.length}`);
  }
  if (checks.length === 0) return null;

  const { rows } = await pool.query(
    `SELECT id, email, phone FROM users WHERE is_deleted = 0 AND id != $1 AND (${checks.join(' OR ')}) LIMIT 1`,
    values
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
  activeSuperadminCount,
  softDelete,
  updateTheme,
  emailOrPhoneTaken,
};


