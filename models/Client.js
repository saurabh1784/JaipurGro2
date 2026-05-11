const pool = require('../db');

function publicClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id || row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    address: row.address || '',
    country: row.country || '',
    state: row.state || '',
    city: row.city || '',
    age: row.age || '',
    gender: row.gender || '',
    notes: row.notes || '',
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
  const where = ["u.role = 'Client'", 'u.is_deleted = 0'];
  const params = [];

  if (search) {
    where.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term);
  }
  if (status) {
    where.push('u.status = ?');
    params.push(status);
  }
  if (country) {
    where.push('cp.country = ?');
    params.push(country);
  }
  if (state) {
    where.push('cp.state = ?');
    params.push(state);
  }
  if (city) {
    where.push('cp.city = ?');
    params.push(city);
  }

  const whereSql = where.join(' AND ');
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM users u
     LEFT JOIN client_profiles cp ON cp.user_id = u.id
     WHERE ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT u.id, u.id AS user_id, u.name, u.email, u.phone, u.status, u.created_at, u.updated_at,
            cp.address, cp.country, cp.state, cp.city, cp.age, cp.gender, cp.notes
     FROM users u
     LEFT JOIN client_profiles cp ON cp.user_id = u.id
     WHERE ${whereSql}
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return {
    clients: rows.map(publicClient),
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
            cp.address, cp.country, cp.state, cp.city, cp.age, cp.gender, cp.notes
     FROM users u
     LEFT JOIN client_profiles cp ON cp.user_id = u.id
     WHERE u.id = ? AND u.role = 'Client' AND u.is_deleted = 0
     LIMIT 1`,
    [id]
  );
  return publicClient(rows[0]);
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
       VALUES (?, ?, ?, ?, 'Client', ?)`,
      [data.name, data.email, data.phone, data.password, data.status]
    );
    const userId = result.insertId;
    await connection.query(
      `INSERT INTO client_profiles (user_id, address, country, state, city, age, gender, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, data.address || null, data.country || null, data.state || null, data.city || null, data.age || null, data.gender || null, data.notes || null]
    );
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
    await connection.query(`UPDATE users SET ${userFields.join(', ')} WHERE id = ? AND role = 'Client' AND is_deleted = 0`, userValues);
    await connection.query(
      `INSERT INTO client_profiles (user_id, address, country, state, city, age, gender, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         address = VALUES(address),
         country = VALUES(country),
         state = VALUES(state),
         city = VALUES(city),
         age = VALUES(age),
         gender = VALUES(gender),
         notes = VALUES(notes)`,
      [id, data.address || null, data.country || null, data.state || null, data.city || null, data.age || null, data.gender || null, data.notes || null]
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
  await pool.query("UPDATE users SET status = ? WHERE id = ? AND role = 'Client' AND is_deleted = 0", [status, id]);
}

async function softDelete(id) {
  await pool.query("UPDATE users SET is_deleted = 1, status = 'inactive' WHERE id = ? AND role = 'Client'", [id]);
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
