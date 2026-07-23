const pool = require('../db');

async function createEmpty(userId, connection = pool) {
  await connection.query('INSERT INTO admin_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
}

async function findByUserId(userId) {
  const { rows } = await pool.query('SELECT * FROM admin_profiles WHERE user_id = $1 LIMIT 1', [userId]);
  return rows[0] || null;
}

async function update(userId, data) {
  const fields = [];
  const values = [];
  const allowed = ['permissions', 'city', 'state', 'country', 'area'];

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      let val = data[key];
      if (key === 'permissions' && Array.isArray(val)) {
        val = JSON.stringify(val);
      }
      fields.push(`${key} = $${values.length + 1}`);
      values.push(val);
    }
  }

  if (fields.length === 0) return;
  values.push(userId);
  await pool.query(`UPDATE admin_profiles SET ${fields.join(', ')} WHERE user_id = $${values.length}`, values);
}

module.exports = { createEmpty, findByUserId, update };
