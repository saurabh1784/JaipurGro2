const pool = require('../db');
const Vendor = require('./Vendor');

async function createEmpty(userId, connection = pool) {
  await connection.query('INSERT INTO vendor_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
}

async function findByUserId(userId) {
  const { rows } = await pool.query('SELECT * FROM vendor_profiles WHERE user_id = $1 LIMIT 1', [userId]);
  const profile = rows[0] || null;
  const categoriesByVendor = await Vendor.assignedCategories([userId]);
  const categories = categoriesByVendor.get(Number(userId)) || [];
  return {
    ...(profile || { user_id: Number(userId) }),
    categories,
    category_ids: categories.map((category) => Number(category.id)).filter(Boolean),
  };
}

async function update(userId, data) {
  const fields = [];
  const values = [];
  const allowedFields = [
    'business_name',
    'logo_path',
    'storefront_image_path',
    'signature_path',
    'address',
    'country',
    'state',
    'city',
    'gst_number',
    'services',
  ];

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      fields.push(`${field} = $${values.length + 1}`);
      values.push(field === 'services' && Array.isArray(data[field]) ? JSON.stringify(data[field]) : data[field]);
    }
  }

  if (fields.length === 0) return;

  values.push(userId);
  await pool.query(`UPDATE vendor_profiles SET ${fields.join(', ')} WHERE user_id = $${values.length}`, values);
}

async function updateCategories(userId, categoryIds) {
  await Vendor.setCategories(userId, categoryIds);
}

module.exports = { createEmpty, findByUserId, update, updateCategories };
