const pool = require('../db');

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function activeToStatus(isActive) {
  return isActive === false || isActive === 'false' || isActive === 0 || isActive === '0' ? 'inactive' : 'active';
}

function row(row) {
  return {
    ...row,
    tax_name: row.tax_name || '',
    tax_percentage: row.tax_percentage === null || row.tax_percentage === undefined ? null : Number(row.tax_percentage || 0),
    is_active: row.status === 'active',
  };
}

async function listCategories() {
  const { rows } = await pool.query(
    `SELECT id, name, slug, tax_name, tax_percentage, status, created_at, updated_at
     FROM categories
     WHERE is_deleted = 0
     ORDER BY name ASC`
  );
  return rows.map(row);
}

async function listSubcategories() {
  const { rows } = await pool.query(
    `SELECT s.id, s.category_id, s.name, s.slug, s.image_path, s.status, s.created_at, s.updated_at, c.name AS category_name
     FROM sub_categories s
     INNER JOIN categories c ON c.id = s.category_id
     WHERE s.is_deleted = 0 AND c.is_deleted = 0
     ORDER BY c.name ASC, s.name ASC`
  );
  return rows.map(row);
}

async function listBrands() {
  const { rows } = await pool.query(
    `SELECT b.id, b.category_id, b.sub_category_id, b.name, b.slug, b.logo_path, b.status, b.created_at, b.updated_at,
            s.name AS sub_category_name, c.name AS category_name
     FROM brands b
     INNER JOIN categories c ON c.id = b.category_id
     INNER JOIN sub_categories s ON s.id = b.sub_category_id
     WHERE b.is_deleted = 0 AND c.is_deleted = 0 AND s.is_deleted = 0
     ORDER BY c.name ASC, s.name ASC, b.name ASC`
  );
  return rows.map((item) => ({
    ...row(item),
    subcategory_id: item.sub_category_id,
    subcategory_name: item.sub_category_name,
  }));
}

async function getTree() {
  const [rows] = await pool.query(
    `SELECT c.id AS category_id, c.name AS category_name, c.slug AS category_slug, c.status AS category_status,
            s.id AS sub_category_id, s.name AS sub_category_name, s.slug AS sub_category_slug, s.image_path AS sub_category_image_path, s.status AS sub_category_status,
            c.tax_name AS category_tax_name, c.tax_percentage AS category_tax_percentage,
            b.id AS brand_id, b.name AS brand_name, b.slug AS brand_slug, b.logo_path AS brand_logo_path, b.status AS brand_status
     FROM categories c
     LEFT JOIN sub_categories s ON s.category_id = c.id AND s.is_deleted = 0
     LEFT JOIN brands b ON b.sub_category_id = s.id AND b.is_deleted = 0
     WHERE c.is_deleted = 0
     ORDER BY c.name ASC, s.name ASC, b.name ASC`
  );

  const map = new Map();
  for (const item of rows) {
    if (!map.has(item.category_id)) {
      map.set(item.category_id, {
        id: item.category_id,
        name: item.category_name,
        slug: item.category_slug,
        tax_name: item.category_tax_name || '',
        tax_percentage: item.category_tax_percentage === null || item.category_tax_percentage === undefined ? null : Number(item.category_tax_percentage || 0),
        status: item.category_status,
        is_active: item.category_status === 'active',
        subcategories: [],
        subMap: new Map(),
      });
    }
    const category = map.get(item.category_id);
    if (item.sub_category_id && !category.subMap.has(item.sub_category_id)) {
      const subcategory = {
        id: item.sub_category_id,
        category_id: item.category_id,
        name: item.sub_category_name,
        slug: item.sub_category_slug,
        image_path: item.sub_category_image_path || '',
        status: item.sub_category_status,
        is_active: item.sub_category_status === 'active',
        brands: [],
      };
      category.subMap.set(item.sub_category_id, subcategory);
      category.subcategories.push(subcategory);
    }
    if (item.sub_category_id && item.brand_id) {
      category.subMap.get(item.sub_category_id).brands.push({
        id: item.brand_id,
        category_id: item.category_id,
        sub_category_id: item.sub_category_id,
        subcategory_id: item.sub_category_id,
        name: item.brand_name,
        slug: item.brand_slug,
        logo_path: item.brand_logo_path,
        status: item.brand_status,
        is_active: item.brand_status === 'active',
      });
    }
  }
  return [...map.values()].map((category) => {
    delete category.subMap;
    return category;
  });
}

async function createCategory({ name, slug, is_active, tax_name, tax_percentage }) {
  const status = activeToStatus(is_active);
  const [result] = await pool.query(
    'INSERT INTO categories (name, slug, tax_name, tax_percentage, status, is_active) VALUES (?, ?, ?, ?, ?, ?)',
    [name, slugify(slug || name), tax_name || null, tax_percentage ?? null, status, status === 'active' ? 1 : 0]
  );
  return result.insertId;
}

async function updateCategory(id, { name, slug, is_active, tax_name, tax_percentage }) {
  const status = activeToStatus(is_active);
  await pool.query('UPDATE categories SET name = ?, slug = ?, tax_name = ?, tax_percentage = ?, status = ?, is_active = ? WHERE id = ? AND is_deleted = 0', [
    name,
    slugify(slug || name),
    tax_name || null,
    tax_percentage ?? null,
    status,
    status === 'active' ? 1 : 0,
    id,
  ]);
}

async function deleteCategory(id) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query(
      "UPDATE categories SET is_deleted = 1, status = 'inactive', is_active = 0 WHERE id = ?",
      [id]
    );
    await connection.query(
      "UPDATE sub_categories SET is_deleted = 1, status = 'inactive', is_active = 0 WHERE category_id = ?",
      [id]
    );
    await connection.query(
      "UPDATE brands SET is_deleted = 1, status = 'inactive', is_active = 0 WHERE category_id = ?",
      [id]
    );
    await connection.query(
      "UPDATE products SET is_deleted = 1 WHERE category_id = ?",
      [id]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function createSubcategory({ category_id, name, slug, image_path, is_active }) {
  const status = activeToStatus(is_active);
  const [result] = await pool.query(
    'INSERT INTO sub_categories (category_id, name, slug, image_path, status, is_active) VALUES (?, ?, ?, ?, ?, ?)',
    [category_id, name, slugify(slug || name), image_path || null, status, status === 'active' ? 1 : 0]
  );
  return result.insertId;
}

async function updateSubcategory(id, { category_id, name, slug, image_path, is_active }) {
  const status = activeToStatus(is_active);
  await pool.query(
    'UPDATE sub_categories SET category_id = ?, name = ?, slug = ?, image_path = COALESCE(?, image_path), status = ?, is_active = ? WHERE id = ? AND is_deleted = 0',
    [category_id, name, slugify(slug || name), image_path || null, status, status === 'active' ? 1 : 0, id]
  );
}

async function deleteSubcategory(id) {
  await pool.query("UPDATE sub_categories SET is_deleted = 1, status = 'inactive', is_active = 0 WHERE id = ?", [id]);
  await pool.query("UPDATE brands SET is_deleted = 1, status = 'inactive', is_active = 0 WHERE sub_category_id = ?", [id]);
}

async function createBrand({ category_id, sub_category_id, subcategory_id, name, slug, logo_path, is_active }) {
  const status = activeToStatus(is_active);
  const subId = sub_category_id || subcategory_id;
  const [result] = await pool.query(
    'INSERT INTO brands (category_id, sub_category_id, name, slug, logo_path, status, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [category_id, subId, name, slugify(slug || name), logo_path || null, status, status === 'active' ? 1 : 0]
  );
  return result.insertId;
}

async function updateBrand(id, { category_id, sub_category_id, subcategory_id, name, slug, logo_path, is_active }) {
  const status = activeToStatus(is_active);
  await pool.query(
    'UPDATE brands SET category_id = ?, sub_category_id = ?, name = ?, slug = ?, logo_path = COALESCE(?, logo_path), status = ?, is_active = ? WHERE id = ? AND is_deleted = 0',
    [category_id, sub_category_id || subcategory_id, name, slugify(slug || name), logo_path || null, status, status === 'active' ? 1 : 0, id]
  );
}

async function deleteBrand(id) {
  await pool.query("UPDATE brands SET is_deleted = 1, status = 'inactive', is_active = 0 WHERE id = ?", [id]);
}

module.exports = {
  slugify,
  listCategories,
  listSubcategories,
  listBrands,
  getTree,
  createCategory,
  updateCategory,
  deleteCategory,
  createSubcategory,
  updateSubcategory,
  deleteSubcategory,
  createBrand,
  updateBrand,
  deleteBrand,
};
