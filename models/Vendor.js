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
            vp.business_name, vp.address, vp.country, vp.state, vp.city, vp.area, vp.gst_number, vp.services
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
            vp.business_name, vp.address, vp.country, vp.state, vp.city, vp.area, vp.gst_number, vp.services
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
      `INSERT INTO vendor_profiles (user_id, business_name, address, country, state, city, area, gst_number, services)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ]
    );
    await VendorProduct.ensureVendorHasAllProducts(userId, connection);
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
      `INSERT INTO vendor_profiles (user_id, business_name, address, country, state, city, area, gst_number, services)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE
       SET business_name = EXCLUDED.business_name,
           address = EXCLUDED.address,
           country = EXCLUDED.country,
           state = EXCLUDED.state,
           city = EXCLUDED.city,
           area = EXCLUDED.area,
           gst_number = EXCLUDED.gst_number,
           services = EXCLUDED.services`,
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
  setCategories,
  assignedCategories,
  normalizeCategoryIds,
};
