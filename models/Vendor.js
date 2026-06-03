const pool = require('../db');
const VendorProduct = require('./VendorProduct');

function normalizeServices(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function publicVendor(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id || row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    business_name: row.business_name || '',
    address: row.address || '',
    country: row.country || '',
    state: row.state || '',
    city: row.city || '',
    gst_number: row.gst_number || '',
    services: normalizeServices(row.services),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function list({ page = 1, limit = 10, search = '', status = '', country = '', state = '', city = '' } = {}) {
  const currentPage = toPositiveInt(page, 1);
  const pageSize = Math.min(toPositiveInt(limit, 10), 50);
  const offset = (currentPage - 1) * pageSize;
  const where = ["u.role = 'Vendor'", 'u.is_deleted = 0'];
  const params = [];

  if (search) {
    where.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR vp.business_name LIKE ?)');
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term, term);
  }

  if (status) {
    where.push('u.status = ?');
    params.push(status);
  }

  if (country) {
    where.push('vp.country = ?');
    params.push(country);
  }

  if (state) {
    where.push('vp.state = ?');
    params.push(state);
  }

  if (city) {
    where.push('vp.city = ?');
    params.push(city);
  }

  const whereSql = where.join(' AND ');
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM users u
     LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
     WHERE ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT u.id, u.id AS user_id, u.name, u.email, u.phone, u.status, u.created_at, u.updated_at,
            vp.business_name, vp.address, vp.country, vp.state, vp.city, vp.gst_number, vp.services
     FROM users u
     LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
     WHERE ${whereSql}
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return {
    vendors: rows.map(publicVendor),
    pagination: {
      page: currentPage,
      limit: pageSize,
      total: countRows[0].total,
      totalPages: Math.max(Math.ceil(countRows[0].total / pageSize), 1),
    },
  };
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT u.id, u.id AS user_id, u.name, u.email, u.phone, u.status, u.created_at, u.updated_at,
            vp.business_name, vp.address, vp.country, vp.state, vp.city, vp.gst_number, vp.services
     FROM users u
     LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
     WHERE u.id = ? AND u.role = 'Vendor' AND u.is_deleted = 0
     LIMIT 1`,
    [id]
  );
  return publicVendor(rows[0]);
}

async function emailOrPhoneTaken({ id = 0, email, phone }) {
  const [rows] = await pool.query(
    'SELECT id FROM users WHERE is_deleted = 0 AND id != ? AND (email = ? OR phone = ?) LIMIT 1',
    [id, email, phone]
  );
  return rows[0] || null;
}

async function create(data) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO users (name, email, phone, password, role, status)
       VALUES (?, ?, ?, ?, 'Vendor', ?)`,
      [data.name, data.email, data.phone, data.password, data.status]
    );
    const userId = result.insertId;
    await connection.query(
      `INSERT INTO vendor_profiles (user_id, business_name, address, country, state, city, gst_number, services)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        data.business_name || null,
        data.address || null,
        data.country || null,
        data.state || null,
        data.city || null,
        data.gst_number || null,
        JSON.stringify(data.services || []),
      ]
    );
    await VendorProduct.ensureVendorHasAllProducts(userId, connection);
    await connection.commit();
    return userId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function update(id, data) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const userFields = ['name = ?', 'email = ?', 'phone = ?', 'status = ?'];
    const userValues = [data.name, data.email, data.phone, data.status];
    if (data.password) {
      userFields.push('password = ?');
      userValues.push(data.password);
    }
    userValues.push(id);
    await connection.query(`UPDATE users SET ${userFields.join(', ')} WHERE id = ? AND role = 'Vendor' AND is_deleted = 0`, userValues);
    await connection.query(
      `INSERT INTO vendor_profiles (user_id, business_name, address, country, state, city, gst_number, services)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         business_name = VALUES(business_name),
         address = VALUES(address),
         country = VALUES(country),
         state = VALUES(state),
         city = VALUES(city),
         gst_number = VALUES(gst_number),
         services = VALUES(services)`,
      [
        id,
        data.business_name || null,
        data.address || null,
        data.country || null,
        data.state || null,
        data.city || null,
        data.gst_number || null,
        JSON.stringify(data.services || []),
      ]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateStatus(id, status) {
  await pool.query("UPDATE users SET status = ? WHERE id = ? AND role = 'Vendor' AND is_deleted = 0", [status, id]);
}

async function softDelete(id) {
  await pool.query("UPDATE users SET is_deleted = 1, status = 'inactive' WHERE id = ? AND role = 'Vendor'", [id]);
}

module.exports = {
  list,
  findById,
  emailOrPhoneTaken,
  create,
  update,
  updateStatus,
  softDelete,
};
