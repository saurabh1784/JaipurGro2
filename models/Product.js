const pool = require('../db');

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeProduct(row) {
  return {
    ...row,
    price: Number(row.price),
    weight_kg: Number(row.weight_kg || 0),
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

   if (filters.name) {
     conditions.push('p.name LIKE ?');
     params.push(`%${String(filters.name).trim()}%`);
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
     conditions.push('p.approval_status = ?');
     params.push(filters.approval_status);
   }

  const where = conditions.join(' AND ');
  const fromSql = `
     FROM products p
     INNER JOIN categories c ON c.id = p.category_id
     INNER JOIN sub_categories s ON s.id = p.sub_category_id
     INNER JOIN brands b ON b.id = p.brand_id`;
  const [countRows] = await pool.query(`SELECT COUNT(*) AS total ${fromSql} WHERE ${where}`, params);
  const total = countRows[0].total;
  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.description, p.price, p.weight_kg, p.image_url, p.tax_name, p.tax_percentage, p.category_id, p.sub_category_id, p.brand_id,
            p.approval_status, p.created_by_vendor_id, p.approved_by, p.approved_at, p.rejection_reason,
            p.created_at, p.updated_at,
            c.name AS category_name, c.tax_name AS category_tax_name, c.tax_percentage AS category_tax_percentage,
            s.name AS sub_category_name, b.name AS brand_name, b.logo_path AS brand_logo_path,
            COALESCE(sp.is_sponsored, 0) AS is_sponsored,
            COALESCE(sp.priority_order, 0) AS sponsored_priority,
            COALESCE(STRING_AGG(DISTINCT pk.keyword, ', '), '') AS keywords
     ${fromSql}
     LEFT JOIN sponsored_products sp ON sp.product_id = p.id
     LEFT JOIN product_keywords pk ON pk.product_id = p.id
     WHERE ${where}
     GROUP BY p.id, c.name, c.tax_name, c.tax_percentage, s.name, b.name, b.logo_path, sp.is_sponsored, sp.priority_order
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
            s.name AS sub_category_name, b.name AS brand_name, b.logo_path AS brand_logo_path,
            COALESCE(sp.is_sponsored, 0) AS is_sponsored,
            COALESCE(sp.priority_order, 0) AS sponsored_priority,
            COALESCE(STRING_AGG(DISTINCT pk.keyword, ', '), '') AS keywords
     FROM products p
     INNER JOIN categories c ON c.id = p.category_id
     INNER JOIN sub_categories s ON s.id = p.sub_category_id
     INNER JOIN brands b ON b.id = p.brand_id
     LEFT JOIN sponsored_products sp ON sp.product_id = p.id
     LEFT JOIN product_keywords pk ON pk.product_id = p.id
     WHERE p.id = ? AND p.is_deleted = 0
     GROUP BY p.id, c.name, c.tax_name, c.tax_percentage, s.name, b.name, b.logo_path, sp.is_sponsored, sp.priority_order
     LIMIT 1`,
    [id]
  );
  return rows[0] ? normalizeProduct(rows[0]) : null;
}

async function create(data) {
  const [result] = await pool.query(
    `INSERT INTO products (name, description, price, weight_kg, image_url, tax_name, tax_percentage, category_id, sub_category_id, brand_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.name, data.description || null, data.price, data.weight_kg || 0, data.image_url || null, data.tax_name || null, data.tax_percentage ?? null, data.category_id, data.sub_category_id, data.brand_id]
  );
  return result.insertId;
}

async function update(id, data) {
  const fields = [
    'name = ?',
    'description = ?',
    'price = ?',
    'weight_kg = ?',
    'tax_name = ?',
    'tax_percentage = ?',
    'category_id = ?',
    'sub_category_id = ?',
    'brand_id = ?',
  ];
  const values = [data.name, data.description || null, data.price, data.weight_kg || 0, data.tax_name || null, data.tax_percentage ?? null, data.category_id, data.sub_category_id, data.brand_id];

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

async function softDelete(id) {
   await pool.query('UPDATE products SET is_deleted = 1 WHERE id = ?', [id]);
 }

 async function listApproved(limit = 100) {
   const [rows] = await pool.query(
     `SELECT p.id, p.name, p.description, p.price, p.weight_kg, p.image_url, p.tax_name, p.tax_percentage, p.category_id, p.sub_category_id, p.brand_id,
             c.name AS category_name, c.tax_name AS category_tax_name, c.tax_percentage AS category_tax_percentage,
             s.name AS sub_category_name, b.name AS brand_name
      FROM products p
      INNER JOIN categories c ON c.id = p.category_id
      INNER JOIN sub_categories s ON s.id = p.sub_category_id
      INNER JOIN brands b ON b.id = p.brand_id
      WHERE p.is_deleted = 0 AND p.approval_status = 'approved'
      ORDER BY p.name ASC
      LIMIT ?`,
     [limit]
   );
   return rows.map(normalizeProduct);
 }

module.exports = {
   list,
   findById,
   create,
   update,
   updatePrice,
   softDelete,
   validateRelation,
   resolveRelation,
   listApproved,
 };
