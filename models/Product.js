const pool = require('../db');

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanWeightUnit(value) {
  const unit = String(value || 'kg').trim();
  if (!unit) return 'kg';
  const lower = unit.toLowerCase();
  if (['gram', 'grams', 'g'].includes(lower)) return 'g';
  if (['kilogram', 'kilograms', 'kg'].includes(lower)) return 'kg';
  if (['liter', 'liters', 'litre', 'litres', 'l'].includes(lower)) return 'L';
  if (['milliliter', 'milliliters', 'millilitre', 'millilitres', 'ml'].includes(lower)) return 'ml';
  return unit.slice(0, 20);
}

function formatWeightLabel(value, unit) {
  const amount = Number(value || 0);
  if (!amount) return 'Not set';
  const normalized = Number(amount.toFixed(3)).toString();
  return `${normalized} ${cleanWeightUnit(unit)}`;
}

function normalizeProduct(row) {
  const weightUnit = cleanWeightUnit(row.weight_unit || 'kg');
  const weightValue = Number(row.weight_value ?? row.weight_kg ?? 0);
  return {
    ...row,
    price: Number(row.price),
    weight_value: weightValue,
    weight_unit: weightUnit,
    weight_kg: Number(row.weight_kg || 0),
    weight_label: formatWeightLabel(weightValue, weightUnit),
    tax_name: row.tax_name || '',
    tax_percentage: row.tax_percentage === null || row.tax_percentage === undefined ? null : Number(row.tax_percentage || 0),
    category_tax_name: row.category_tax_name || '',
    category_tax_percentage: row.category_tax_percentage === null || row.category_tax_percentage === undefined ? null : Number(row.category_tax_percentage || 0),
    applied_tax_name: row.tax_percentage === null || row.tax_percentage === undefined ? (row.category_tax_name || '') : (row.tax_name || row.category_tax_name || ''),
    applied_tax_percentage: Number(row.tax_percentage ?? row.category_tax_percentage ?? 0),
    sponsored_priority: Number(row.sponsored_priority || 0),
    is_sponsored: Boolean(row.is_sponsored),
    keywords: row.keywords || '',
    image_url: row.image_url || '/default.png',
  };
}

async function validateRelation({ category_id, sub_category_id, brand_id }) {
  const [rows] = await pool.query(
    `SELECT b.id
     FROM brands b
     INNER JOIN sub_categories s ON s.id = b.sub_category_id
     INNER JOIN categories c ON c.id = b.category_id
     WHERE b.id = ?
       AND b.sub_category_id = ?
       AND b.category_id = ?
       AND b.is_deleted = 0
       AND s.is_deleted = 0
       AND c.is_deleted = 0
       AND b.status = 'active'
       AND s.status = 'active'
       AND c.status = 'active'`,
    [brand_id, sub_category_id, category_id]
  );
  return rows.length > 0;
}

async function resolveRelation({ category, subcategory, brand }) {
  const [rows] = await pool.query(
    `SELECT c.id AS category_id, s.id AS sub_category_id, b.id AS brand_id
     FROM categories c
     INNER JOIN sub_categories s ON s.category_id = c.id
     INNER JOIN brands b ON b.category_id = c.id AND b.sub_category_id = s.id
     WHERE LOWER(c.name) = LOWER(?)
       AND LOWER(s.name) = LOWER(?)
       AND LOWER(b.name) = LOWER(?)
       AND c.is_deleted = 0
       AND s.is_deleted = 0
       AND b.is_deleted = 0
       AND c.status = 'active'
       AND s.status = 'active'
       AND b.status = 'active'
     LIMIT 1`,
    [category, subcategory, brand]
  );
  return rows[0] || null;
}

async function list(filters = {}) {
   const page = toPositiveInt(filters.page, 1);
   const limit = Math.min(toPositiveInt(filters.limit, 10), 50);
   const offset = (page - 1) * limit;
   const conditions = ['p.is_deleted = 0'];
   const params = [];

   const searchTerm = String(filters.name || filters.search || filters.q || '').trim();
   if (searchTerm) {
     const searchClauses = ['p.name ILIKE ?'];
     const searchParams = [`%${searchTerm}%`];

     const matches = searchTerm.match(/\d+/);
     const numId = matches ? parseInt(matches[0], 10) : parseInt(searchTerm, 10);
     if (Number.isFinite(numId) && numId > 0) {
       searchClauses.push('p.id = ?');
       searchParams.push(numId);
     }

     searchClauses.push('b.name ILIKE ?');
     searchParams.push(`%${searchTerm}%`);

     searchClauses.push('s.name ILIKE ?');
     searchParams.push(`%${searchTerm}%`);

     searchClauses.push('c.name ILIKE ?');
     searchParams.push(`%${searchTerm}%`);

     conditions.push(`(${searchClauses.join(' OR ')})`);
     params.push(...searchParams);
   }
   if (filters.category_id) {
     conditions.push('p.category_id = ?');
     params.push(filters.category_id);
   }
   if (filters.sub_category_id) {
     conditions.push('p.sub_category_id = ?');
     params.push(filters.sub_category_id);
   }
   if (filters.brand_id) {
     conditions.push('p.brand_id = ?');
     params.push(filters.brand_id);
   }
   if (filters.brand_name) {
     conditions.push('LOWER(TRIM(b.name)) = LOWER(TRIM(?))');
     params.push(filters.brand_name);
   }
   if (filters.approval_status) {
     const statuses = String(filters.approval_status)
       .split(',')
       .map((status) => status.trim())
       .filter(Boolean);
     if (statuses.length === 1) {
       conditions.push('p.approval_status = ?');
       params.push(statuses[0]);
     } else if (statuses.length > 1) {
       conditions.push(`p.approval_status IN (${statuses.map(() => '?').join(',')})`);
       params.push(...statuses);
     }
   }

  const where = conditions.join(' AND ');
  const fromSql = `
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN sub_categories s ON s.id = p.sub_category_id
     LEFT JOIN brands b ON b.id = p.brand_id`;
  const [countRows] = await pool.query(`SELECT COUNT(*) AS total ${fromSql} WHERE ${where}`, params);
  const total = countRows[0].total;
  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.description, p.price, p.weight_value, p.weight_unit, p.weight_kg, p.image_url, p.tax_name, p.tax_percentage, p.category_id, p.sub_category_id, p.brand_id,
            p.approval_status, p.created_by_vendor_id, p.approved_by, p.approved_at, p.rejection_reason,
            p.created_at, p.updated_at,
            c.name AS category_name, c.tax_name AS category_tax_name, c.tax_percentage AS category_tax_percentage,
            s.name AS sub_category_name, s.image_path AS sub_category_image_path, b.name AS brand_name, b.logo_path AS brand_logo_path,
            COALESCE(sp.is_sponsored, 0) AS is_sponsored,
            COALESCE(sp.priority_order, 0) AS sponsored_priority,
            COALESCE(STRING_AGG(DISTINCT pk.keyword, ', '), '') AS keywords
     ${fromSql}
     LEFT JOIN sponsored_products sp ON sp.product_id = p.id
     LEFT JOIN product_keywords pk ON pk.product_id = p.id
     WHERE ${where}
     GROUP BY p.id, c.name, c.tax_name, c.tax_percentage, s.name, s.image_path, b.name, b.logo_path, sp.is_sponsored, sp.priority_order
     ORDER BY COALESCE(sp.is_sponsored, 0) DESC, COALESCE(sp.priority_order, 0) DESC, p.updated_at DESC, p.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    products: rows.map(normalizeProduct),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category_name, c.tax_name AS category_tax_name, c.tax_percentage AS category_tax_percentage,
            s.name AS sub_category_name, s.image_path AS sub_category_image_path, b.name AS brand_name, b.logo_path AS brand_logo_path,
            COALESCE(sp.is_sponsored, 0) AS is_sponsored,
            COALESCE(sp.priority_order, 0) AS sponsored_priority,
            COALESCE(STRING_AGG(DISTINCT pk.keyword, ', '), '') AS keywords
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN sub_categories s ON s.id = p.sub_category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN sponsored_products sp ON sp.product_id = p.id
     LEFT JOIN product_keywords pk ON pk.product_id = p.id
     WHERE p.id = ? AND p.is_deleted = 0
     GROUP BY p.id, c.name, c.tax_name, c.tax_percentage, s.name, s.image_path, b.name, b.logo_path, sp.is_sponsored, sp.priority_order
     LIMIT 1`,
    [id]
  );
  return rows[0] ? normalizeProduct(rows[0]) : null;
}

async function findByIdOrSku(identifier) {
  if (identifier === null || identifier === undefined) return null;
  const str = String(identifier).trim();
  if (!str) return null;

  const matches = str.match(/\d+/);
  const numId = matches ? parseInt(matches[0], 10) : parseInt(str, 10);
  if (Number.isFinite(numId) && numId > 0) {
    const product = await findById(numId);
    if (product) return product;
  }

  return findByName(str);
}

async function findByName(name) {
  if (!name || !String(name).trim()) return null;
  const cleanName = String(name).trim();
  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category_name, c.tax_name AS category_tax_name, c.tax_percentage AS category_tax_percentage,
            s.name AS sub_category_name, s.image_path AS sub_category_image_path, b.name AS brand_name, b.logo_path AS brand_logo_path,
            COALESCE(sp.is_sponsored, 0) AS is_sponsored,
            COALESCE(sp.priority_order, 0) AS sponsored_priority,
            COALESCE(STRING_AGG(DISTINCT pk.keyword, ', '), '') AS keywords
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN sub_categories s ON s.id = p.sub_category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN sponsored_products sp ON sp.product_id = p.id
     LEFT JOIN product_keywords pk ON pk.product_id = p.id
     WHERE LOWER(TRIM(p.name)) = LOWER(TRIM(?)) AND p.is_deleted = 0
     GROUP BY p.id, c.name, c.tax_name, c.tax_percentage, s.name, s.image_path, b.name, b.logo_path, sp.is_sponsored, sp.priority_order
     LIMIT 1`,
    [cleanName]
  );
  return rows[0] ? normalizeProduct(rows[0]) : null;
}

async function create(data) {
  const [result] = await pool.query(
    `INSERT INTO products
     (name, description, price, weight_value, weight_unit, weight_kg, image_url, tax_name, tax_percentage, category_id, sub_category_id, brand_id, approval_status, created_by_vendor_id, approved_by, approved_at, rejection_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name,
      data.description || null,
      data.price,
      data.weight_value || 0,
      cleanWeightUnit(data.weight_unit),
      data.weight_kg || 0,
      data.image_url || null,
      data.tax_name || null,
      data.tax_percentage ?? null,
      data.category_id,
      data.sub_category_id,
      data.brand_id,
      data.approval_status || 'approved',
      data.created_by_vendor_id || null,
      data.approved_by || null,
      data.approved_at || (data.approval_status === 'approved' ? new Date() : null),
      data.rejection_reason || null,
    ]
  );
  return result.insertId;
}

async function update(id, data) {
  const fields = [
    'name = ?',
    'description = ?',
    'price = ?',
    'weight_value = ?',
    'weight_unit = ?',
    'weight_kg = ?',
    'tax_name = ?',
    'tax_percentage = ?',
    'category_id = ?',
    'sub_category_id = ?',
    'brand_id = ?',
  ];
  const values = [data.name, data.description || null, data.price, data.weight_value || 0, cleanWeightUnit(data.weight_unit), data.weight_kg || 0, data.tax_name || null, data.tax_percentage ?? null, data.category_id, data.sub_category_id, data.brand_id];

  if (Object.prototype.hasOwnProperty.call(data, 'image_url')) {
    fields.push('image_url = ?');
    values.push(data.image_url || null);
  }

  values.push(id);
  await pool.query(`UPDATE products SET ${fields.join(', ')} WHERE id = ? AND is_deleted = 0`, values);
}

async function updatePrice(id, price) {
  await pool.query('UPDATE products SET price = ? WHERE id = ? AND is_deleted = 0', [price, id]);
}

async function updateApprovalStatus(id, { status, actor_id, rejection_reason }) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!['pending', 'in_review', 'approved', 'rejected'].includes(normalized)) {
    const error = new Error('Status must be Pending, In Review, Approved, or Rejected');
    error.status = 422;
    throw error;
  }

  const result = await pool.query(
    `UPDATE products
     SET approval_status = ?,
         approved_by = ?,
         approved_at = CASE WHEN ? IN ('approved', 'rejected') THEN CURRENT_TIMESTAMP ELSE approved_at END,
         rejection_reason = CASE WHEN ? = 'rejected' THEN ? ELSE NULL END
     WHERE id = ? AND is_deleted = 0`,
    [normalized, actor_id || null, normalized, normalized, rejection_reason || null, id]
  );
  if (!result.affectedRows && !result.rowCount) {
    const error = new Error('Product not found or status was not saved');
    error.status = 404;
    throw error;
  }
}

async function softDelete(id) {
   await pool.query('UPDATE products SET is_deleted = 1 WHERE id = ?', [id]);
 }

 async function listApproved(limit = 100, categoryIds = null) {
   const hasCategoryFilter = Array.isArray(categoryIds);
   const ids = [...new Set([].concat(categoryIds || []).map((id) => parseInt(id, 10)).filter(Boolean))];
   if (hasCategoryFilter && ids.length === 0) return [];
   const categorySql = ids.length ? ` AND p.category_id IN (${ids.map(() => '?').join(',')})` : '';
   const [rows] = await pool.query(
     `SELECT p.id, p.name, p.description, p.price, p.weight_value, p.weight_unit, p.weight_kg, p.image_url, p.tax_name, p.tax_percentage, p.category_id, p.sub_category_id, p.brand_id,
             c.name AS category_name, c.tax_name AS category_tax_name, c.tax_percentage AS category_tax_percentage,
             s.name AS sub_category_name, s.image_path AS sub_category_image_path, b.name AS brand_name,
             COALESCE(sp.is_sponsored, 0) AS is_sponsored,
             COALESCE(sp.priority_order, 0) AS sponsored_priority
      FROM products p
      INNER JOIN categories c ON c.id = p.category_id
      INNER JOIN sub_categories s ON s.id = p.sub_category_id
      INNER JOIN brands b ON b.id = p.brand_id
      LEFT JOIN sponsored_products sp ON sp.product_id = p.id
      WHERE p.is_deleted = 0 AND p.approval_status = 'approved'${categorySql}
      ORDER BY COALESCE(sp.is_sponsored, 0) DESC, COALESCE(sp.priority_order, 0) DESC, p.name ASC
      LIMIT ?`,
     [...ids, limit]
   );
   return rows.map(normalizeProduct);
 }

async function findDuplicate({ category_id, sub_category_id, brand_id, name }) {
  const trimmedName = String(name || '').trim();
  const [rows] = await pool.query(
    `SELECT id, name FROM products
     WHERE category_id = ?
       AND LOWER(TRIM(name)) = LOWER(?)
       AND is_deleted = 0
     LIMIT 1`,
    [category_id, trimmedName]
  );
  return rows[0] || null;
}


async function updateImage(id, image_url) {
  await pool.query(
    'UPDATE products SET image_url = ? WHERE id = ? AND is_deleted = 0',
    [image_url || null, id]
  );
}

async function listForImageTemplate() {
  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.image_url, c.name AS category_name, s.name AS sub_category_name, b.name AS brand_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN sub_categories s ON s.id = p.sub_category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.is_deleted = 0
     ORDER BY p.id ASC`
  );
  return rows;
}

async function cleanProducts() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM client_order_items').catch(() => {});
    await conn.query('DELETE FROM delivery_offer_assignments').catch(() => {});
    await conn.query('DELETE FROM delivery_dashboard_offers').catch(() => {});
    await conn.query('DELETE FROM delivery_partner_audit_logs').catch(() => {});
    await conn.query('DELETE FROM client_orders').catch(() => {});
    await conn.query('DELETE FROM vendor_client_product_prices').catch(() => {});
    await conn.query('DELETE FROM sponsored_products').catch(() => {});
    await conn.query('DELETE FROM product_ranking_scores').catch(() => {});
    await conn.query('DELETE FROM product_keywords').catch(() => {});
    await conn.query('DELETE FROM user_recent_activity WHERE product_id IS NOT NULL').catch(() => {});
    await conn.query('DELETE FROM vendor_products');
    const [result] = await conn.query('DELETE FROM products');
    await conn.commit();
    return {
      deletedProducts: result.affectedRows || result.rowCount || 0,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
   list,
   listForImageTemplate,
   findById,
   findByIdOrSku,
   findByName,
   create,
   findDuplicate,
   update,
   updateImage,
   updatePrice,
   updateApprovalStatus,
   softDelete,
   cleanProducts,
   validateRelation,
   resolveRelation,
   listApproved,
 };


