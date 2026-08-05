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

function normalizeCategoryIds(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw
    .map((item) => parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item > 0))];
}

async function assignedCategories(vendorIds, connection = pool) {
  const ids = [...new Set([].concat(vendorIds || []).map((id) => parseInt(id, 10)).filter(Boolean))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await connection.query(
    `SELECT vc.vendor_id, c.id, c.name, c.slug, c.status
     FROM vendor_categories vc
     INNER JOIN categories c ON c.id = vc.category_id
     WHERE vc.vendor_id IN (${placeholders})
       AND c.is_deleted = 0
     ORDER BY c.name ASC`,
    ids
  );
  const map = new Map(ids.map((id) => [Number(id), []]));
  for (const row of rows) {
    const vendorId = Number(row.vendor_id);
    if (!map.has(vendorId)) map.set(vendorId, []);
    map.get(vendorId).push({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
    });
  }
  return map;
}

function publicVendor(row) {
  if (!row) return null;
  const categories = Array.isArray(row.categories) ? row.categories : [];
  const health = Number(row.account_health !== undefined && row.account_health !== null ? row.account_health : 500);
  const hasWarning = health < 250;
  const isOnHold = health < 180 || String(row.status || '').toLowerCase() === 'on_hold';
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
    area: row.area || '',
    gst_number: row.gst_number || '',
    services: normalizeServices(row.services),
    is_premium_vendor: Boolean(Number(row.is_premium_vendor || 0)),
    premium_commission_percent: Number(row.premium_commission_percent || 0),
    pan_card_path: row.pan_card_path || '',
    aadhaar_card_path: row.aadhaar_card_path || '',
    gst_certificate_path: row.gst_certificate_path || '',
    food_license_path: row.food_license_path || '',
    cancelled_cheque_path: row.cancelled_cheque_path || '',
    shop_front_photo_path: row.shop_front_photo_path || '',
    shop_inside_photo_1_path: row.shop_inside_photo_1_path || '',
    shop_inside_photo_2_path: row.shop_inside_photo_2_path || '',
    shop_inside_photo_3_path: row.shop_inside_photo_3_path || '',
    kyc_status: row.kyc_status || 'pending_documents',
    kyc_submitted_at: row.kyc_submitted_at || null,
    kyc_rejection_reason: row.kyc_rejection_reason || '',
    account_health: health,
    unique_product_count: Number(row.unique_product_count || 0),
    has_health_warning: hasWarning,
    health_warning_message: hasWarning
      ? `Account Health Warning: Your account health is low (${health}/500). Please fulfill orders and bid promptly to avoid account suspension.`
      : null,
    is_on_hold: isOnHold,
    categories,
    category_ids: categories.map((category) => Number(category.id)).filter(Boolean),
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
            vp.business_name, vp.address, vp.country, vp.state, vp.city, vp.area, vp.gst_number, vp.services, vp.is_premium_vendor, vp.premium_commission_percent,
            vp.pan_card_path, vp.aadhaar_card_path, vp.gst_certificate_path, vp.food_license_path, vp.cancelled_cheque_path,
            vp.shop_front_photo_path, vp.shop_inside_photo_1_path, vp.shop_inside_photo_2_path, vp.shop_inside_photo_3_path,
            COALESCE(vp.kyc_status, 'pending_documents') AS kyc_status, vp.kyc_submitted_at, vp.kyc_rejection_reason,
            COALESCE(vp.account_health, 500) AS account_health,
            (SELECT COUNT(DISTINCT inventory.product_id) FROM vendor_products inventory WHERE inventory.vendor_id = u.id AND inventory.product_id IS NOT NULL) AS unique_product_count
     FROM users u
     LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
     WHERE ${whereSql}
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const categoriesByVendor = await assignedCategories(rows.map((row) => row.id));
  return {
    vendors: rows.map((row) => publicVendor({ ...row, categories: categoriesByVendor.get(Number(row.id)) || [] })),
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
            vp.business_name, vp.address, vp.country, vp.state, vp.city, vp.area, vp.gst_number, vp.services, vp.is_premium_vendor, vp.premium_commission_percent,
            vp.pan_card_path, vp.aadhaar_card_path, vp.gst_certificate_path, vp.food_license_path, vp.cancelled_cheque_path,
            vp.shop_front_photo_path, vp.shop_inside_photo_1_path, vp.shop_inside_photo_2_path, vp.shop_inside_photo_3_path,
            COALESCE(vp.kyc_status, 'pending_documents') AS kyc_status, vp.kyc_submitted_at, vp.kyc_rejection_reason,
            COALESCE(vp.account_health, 500) AS account_health,
            (SELECT COUNT(DISTINCT inventory.product_id) FROM vendor_products inventory WHERE inventory.vendor_id = u.id AND inventory.product_id IS NOT NULL) AS unique_product_count
     FROM users u
     LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
     WHERE u.id = ? AND u.role = 'Vendor' AND u.is_deleted = 0
     LIMIT 1`,
    [id]
  );
  if (!rows[0]) return null;
  const categoriesByVendor = await assignedCategories([rows[0].id]);
  return publicVendor({ ...rows[0], categories: categoriesByVendor.get(Number(rows[0].id)) || [] });
}

async function emailOrPhoneTaken({ id = 0, email, phone }) {
  const [rows] = await pool.query(
    `SELECT id FROM users WHERE is_deleted = 0 AND id != ? AND (email = ? OR (phone = ? AND LOWER(role) = 'vendor')) LIMIT 1`,
    [id, email, phone]
  );
  return rows[0] || null;
}

async function gstNumberTaken({ id = 0, gst_number }, connection = pool) {
  const cleanGst = String(gst_number || '').trim().toUpperCase();
  if (!cleanGst) return null;
  const [rows] = await connection.query(
    `SELECT vp.user_id
     FROM vendor_profiles vp
     INNER JOIN users u ON u.id = vp.user_id
     WHERE u.is_deleted = 0 AND vp.user_id != ? AND UPPER(TRIM(vp.gst_number)) = ?
     LIMIT 1`,
    [id, cleanGst]
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
      `INSERT INTO vendor_profiles (user_id, business_name, address, country, state, city, area, gst_number, services, is_premium_vendor, premium_commission_percent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        data.business_name || null,
        data.address || null,
        data.country || null,
        data.state || null,
        data.city || null,
        data.area || null,
        data.gst_number || null,
        JSON.stringify(data.services || []),
        data.is_premium_vendor ? 1 : 0,
        Number(data.premium_commission_percent || 0),
      ]
    );
    await setCategories(userId, data.category_ids || data.categories || [], connection);
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
      `INSERT INTO vendor_profiles (user_id, business_name, address, country, state, city, area, gst_number, services, is_premium_vendor, premium_commission_percent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE
       SET business_name = EXCLUDED.business_name,
           address = EXCLUDED.address,
           country = EXCLUDED.country,
           state = EXCLUDED.state,
           city = EXCLUDED.city,
           area = EXCLUDED.area,
           gst_number = EXCLUDED.gst_number,
           services = EXCLUDED.services,
           is_premium_vendor = EXCLUDED.is_premium_vendor,
           premium_commission_percent = EXCLUDED.premium_commission_percent`,
      [
        id,
        data.business_name || null,
        data.address || null,
        data.country || null,
        data.state || null,
        data.city || null,
        data.area || null,
        data.gst_number || null,
        JSON.stringify(data.services || []),
        data.is_premium_vendor ? 1 : 0,
        Number(data.premium_commission_percent || 0),
      ]
    );
    if (Object.prototype.hasOwnProperty.call(data, 'category_ids') || Object.prototype.hasOwnProperty.call(data, 'categories')) {
      await setCategories(id, data.category_ids || data.categories || [], connection);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function setCategories(vendorId, categoryIds, connection = pool) {
  const ids = normalizeCategoryIds(categoryIds);
  await connection.query('DELETE FROM vendor_categories WHERE vendor_id = ?', [vendorId]);
  for (const categoryId of ids) {
    await connection.query(
      `INSERT INTO vendor_categories (vendor_id, category_id)
       SELECT ?, c.id
       FROM categories c
       WHERE c.id = ? AND c.is_deleted = 0 AND c.status = 'active'
       ON CONFLICT (vendor_id, category_id) DO NOTHING`,
      [vendorId, categoryId]
    );
  }
}

async function updateStatus(id, status, rejectionReason = null) {
  await pool.query("UPDATE users SET status = ? WHERE id = ? AND role = 'Vendor' AND is_deleted = 0", [status, id]);
  const isApp = ['active', 'approved'].includes(String(status).toLowerCase());
  if (isApp) {
    await pool.query("UPDATE vendor_profiles SET kyc_status = 'approved' WHERE user_id = ?", [id]).catch(() => {});
    try {
      const { notifyVendorEvent } = require('../services/notificationDispatcher');
      const [vRows] = await pool.query('SELECT name, email, phone FROM users WHERE id = ? LIMIT 1', [id]);
      if (vRows && vRows[0]) {
        notifyVendorEvent({
          vendorEmail: vRows[0].email,
          vendorPhone: vRows[0].phone,
          vendorName: vRows[0].name || 'Vendor Partner',
          eventType: 'approval',
          data: {
            storeName: 'JaipurGro',
            loginUrl: 'https://jaipurgro.com/vendor/login',
          },
        }).catch((err) => console.error('[Vendor Model] Error dispatching Vendor approval notification:', err));
      }
    } catch (err) {
      console.error('[Vendor Model] Error triggering Vendor approval notification:', err);
    }
  } else if (status === 'rejected' || status === 'inactive') {
    if (rejectionReason) {
      await pool.query("UPDATE vendor_profiles SET kyc_status = 'rejected', kyc_rejection_reason = ? WHERE user_id = ?", [rejectionReason, id]).catch(() => {});
    }
  }
}

async function softDelete(id) {
  await pool.query("UPDATE users SET is_deleted = 1, status = 'inactive' WHERE id = ? AND role = 'Vendor'", [id]);
}

module.exports = {
  list,
  findById,
  emailOrPhoneTaken,
  gstNumberTaken,
  create,
  update,
  updateStatus,
  softDelete,
  setCategories,
  assignedCategories,
  normalizeCategoryIds,
};
