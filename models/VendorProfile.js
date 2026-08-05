const pool = require('../db');
const Vendor = require('./Vendor');

async function createEmpty(userId, connection = pool) {
  const { rows } = await connection.query('SELECT id FROM vendor_profiles WHERE user_id = $1 LIMIT 1', [userId]);
  if (!rows || rows.length === 0) {
    await connection.query('INSERT INTO vendor_profiles (user_id, account_health) VALUES ($1, 500)', [userId]);
  }
}

async function findByUserId(userId) {
  const { rows } = await pool.query('SELECT * FROM vendor_profiles WHERE user_id = $1 LIMIT 1', [userId]);
  const profile = rows[0] || null;
  const categoriesByVendor = await Vendor.assignedCategories([userId]);
  const categories = categoriesByVendor.get(Number(userId)) || [];
  const accountHealth = Number(profile && profile.account_health !== undefined && profile.account_health !== null ? profile.account_health : 500);
  return {
    account_health: accountHealth,
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
    'pickup_latitude',
    'pickup_longitude',
    'country',
    'state',
    'city',
    'area',
    'pincode',
    'area_definition_id',
    'zone_id',
    'zone_code',
    'gst_number',
    'services',
    'account_health',
    'pan_card_path',
    'aadhaar_card_path',
    'gst_certificate_path',
    'food_license_path',
    'cancelled_cheque_path',
    'shop_front_photo_path',
    'shop_inside_photo_1_path',
    'shop_inside_photo_2_path',
    'shop_inside_photo_3_path',
    'kyc_status',
    'kyc_submitted_at',
    'kyc_rejection_reason',
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

async function deductAccountHealth(vendorId, penaltyPoints, reason = '', connection = pool) {
  if (!vendorId || penaltyPoints <= 0) return 500;

  await connection.query(
    'INSERT INTO vendor_profiles (user_id, account_health) VALUES ($1, 500) ON CONFLICT (user_id) DO NOTHING',
    [vendorId]
  ).catch(() => {});

  await connection.query(
    `UPDATE vendor_profiles
     SET account_health = GREATEST(0, COALESCE(account_health, 500) - $1)
     WHERE user_id = $2`,
    [penaltyPoints, vendorId]
  );

  const { rows } = await connection.query(
    'SELECT account_health FROM vendor_profiles WHERE user_id = $1 LIMIT 1',
    [vendorId]
  );

  const currentHealth = Number(rows[0] && rows[0].account_health !== undefined ? rows[0].account_health : 500);

  if (currentHealth < 180) {
    await connection.query(
      "UPDATE users SET status = 'on_hold' WHERE id = $1 AND role = 'Vendor'",
      [vendorId]
    );
  }

  return currentHealth;
}

module.exports = { createEmpty, findByUserId, update, updateCategories, deductAccountHealth };
