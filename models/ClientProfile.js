const pool = require('../db');

async function createEmpty(userId, connection = pool) {
  await connection.query('INSERT INTO client_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
}

async function findByUserId(userId) {
  const { rows } = await pool.query('SELECT * FROM client_profiles WHERE user_id = $1 LIMIT 1', [userId]);
  return rows[0] || null;
}

async function update(userId, data) {
  const fields = [];
  const values = [];
  const allowedFields = ['address', 'country', 'state', 'city', 'age', 'gender', 'notes'];

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      fields.push(`${field} = $${values.length + 1}`);
      values.push(data[field]);
    }
  }

  if (fields.length === 0) return;

  values.push(userId);
  await pool.query(`UPDATE client_profiles SET ${fields.join(', ')} WHERE user_id = $${values.length}`, values);
}

module.exports = { createEmpty, findByUserId, update };
