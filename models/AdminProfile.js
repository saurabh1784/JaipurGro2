const pool = require('../db');

async function createEmpty(userId, connection = pool) {
  await connection.query('INSERT IGNORE INTO admin_profiles (user_id) VALUES (?)', [userId]);
}

async function findByUserId(userId) {
  const [rows] = await pool.query('SELECT * FROM admin_profiles WHERE user_id = ? LIMIT 1', [userId]);
  return rows[0] || null;
}

async function update(userId, data) {
  if (!Object.prototype.hasOwnProperty.call(data, 'permissions')) return;

  const permissions = Array.isArray(data.permissions) ? JSON.stringify(data.permissions) : data.permissions;
  await pool.query('UPDATE admin_profiles SET permissions = ? WHERE user_id = ?', [permissions, userId]);
}

module.exports = { createEmpty, findByUserId, update };
