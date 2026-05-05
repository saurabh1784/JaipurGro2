const pool = require('../db');

async function createEmpty(userId, connection = pool) {
  await connection.query('INSERT IGNORE INTO vendor_profiles (user_id) VALUES (?)', [userId]);
}

async function findByUserId(userId) {
  const [rows] = await pool.query('SELECT * FROM vendor_profiles WHERE user_id = ? LIMIT 1', [userId]);
  return rows[0] || null;
}

async function update(userId, data) {
  const fields = [];
  const values = [];
  const allowedFields = [
    'business_name',
    'address',
    'country',
    'state',
    'city',
    'gst_number',
    'services',
    'aadhaar_front_path',
    'aadhaar_back_path',
    'store_image_path',
    'profile_image_path',
  ];

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      fields.push(`${field} = ?`);
      values.push(field === 'services' && Array.isArray(data[field]) ? JSON.stringify(data[field]) : data[field]);
    }
  }

  if (fields.length === 0) return;

  values.push(userId);
  await pool.query(`UPDATE vendor_profiles SET ${fields.join(', ')} WHERE user_id = ?`, values);
}

module.exports = { createEmpty, findByUserId, update };
