const pool = require('../db');
const Product = require('./Product');

function normalize(row) {
  if (!row) return null;
  return {
    id: row.id,
    product_id: row.product_id,
    vendor_id: row.vendor_id,
    quantity: Number(row.quantity || 0),
    price: row.price === undefined ? undefined : Number(row.price || 0),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    product_name: row.product_name,
    description: row.description,
    default_price: row.default_price === undefined ? undefined : Number(row.default_price || 0),
    approval_status: row.approval_status,
    rejection_reason: row.rejection_reason,
    category_id: row.category_id,
    sub_category_id: row.sub_category_id,
    brand_id: row.brand_id,
    category_name: row.category_name,
    sub_category_name: row.sub_category_name,
    brand_name: row.brand_name,
    vendor_name: row.vendor_name,
    vendor_email: row.vendor_email,
    image_url: row.image_url || '/default.png',
    client_id: row.client_id,
    custom_price: row.custom_price === undefined || row.custom_price === null ? null : Number(row.custom_price),
    visible_price: row.visible_price === undefined ? undefined : Number(row.visible_price || 0),
  };
}

function toPositiveInt(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
}

async function vendorExists(vendorId) {
  const [rows] = await pool.query("SELECT id FROM users WHERE id = ? AND role = 'Vendor' AND is_deleted = 0 LIMIT 1", [vendorId]);
  return rows.length > 0;
}

async function clientExists(clientId) {
  const [rows] = await pool.query("SELECT id FROM users WHERE id = ? AND role = 'Client' AND is_deleted = 0 LIMIT 1", [clientId]);
  return rows.length > 0;
}

async function list({ vendor_id, approval_status, status, search, category_id, sub_category_id, brand_id, brand_name } = {}) {
  const where = ['p.is_deleted = 0'];
  const params = [];

  if (vendor_id) {
    where.push('vp.vendor_id = ?');
    params.push(vendor_id);
  }
  if (approval_status) {
    where.push('p.approval_status = ?');
    params.push(approval_status);
  }
  if (status) {
    where.push('vp.status = ?');
    params.push(status);
  }
  if (category_id) {
    where.push('p.category_id = ?');
    params.push(category_id);
  }
  if (sub_category_id) {
    where.push('p.sub_category_id = ?');
    params.push(sub_category_id);
  }
  if (brand_id) {
    where.push('p.brand_id = ?');
    params.push(brand_id);
  }
  if (brand_name) {
    where.push('LOWER(TRIM(b.name)) = LOWER(TRIM(?))');
    params.push(brand_name);
  }
  if (search) {
    where.push('(p.name LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term);
  }

  const [rows] = await pool.query(
    `SELECT vp.*, COALESCE(vp.image_url, p.image_url, '/default.png') AS image_url,
            p.name AS product_name, p.description, p.price AS default_price,
            p.approval_status, p.rejection_reason, p.category_id, p.sub_category_id, p.brand_id,
            c.name AS category_name, s.name AS sub_category_name, b.name AS brand_name,
            u.name AS vendor_name, u.email AS vendor_email
     FROM vendor_products vp
     INNER JOIN products p ON p.id = vp.product_id
     INNER JOIN users u ON u.id = vp.vendor_id
     INNER JOIN categories c ON c.id = p.category_id
     INNER JOIN sub_categories s ON s.id = p.sub_category_id
     INNER JOIN brands b ON b.id = p.brand_id
     WHERE ${where.join(' AND ')}
     ORDER BY vp.updated_at DESC, vp.id DESC`,
    params
  );
  return rows.map(normalize);
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT vp.*, COALESCE(vp.image_url, p.image_url, '/default.png') AS image_url,
            p.name AS product_name, p.description, p.price AS default_price,
            p.approval_status, p.rejection_reason, p.category_id, p.sub_category_id, p.brand_id,
            c.name AS category_name, s.name AS sub_category_name, b.name AS brand_name,
            u.name AS vendor_name, u.email AS vendor_email
     FROM vendor_products vp
     INNER JOIN products p ON p.id = vp.product_id
     INNER JOIN users u ON u.id = vp.vendor_id
     INNER JOIN categories c ON c.id = p.category_id
     INNER JOIN sub_categories s ON s.id = p.sub_category_id
     INNER JOIN brands b ON b.id = p.brand_id
     WHERE vp.id = ?
     LIMIT 1`,
    [id]
  );
  return normalize(rows[0]);
}

async function create(data) {
  const vendorId = toPositiveInt(data.vendor_id);
  if (!vendorId || !(await vendorExists(vendorId))) {
    const error = new Error('Valid vendor is required');
    error.status = 422;
    throw error;
  }

  const quantity = toNonNegativeNumber(data.quantity || 0);
  const price = toNonNegativeNumber(data.price || 0);
  if (!Number.isFinite(quantity)) {
    const error = new Error('Quantity must be a non-negative number');
    error.status = 422;
    throw error;
  }
  if (!Number.isFinite(price)) {
    const error = new Error('Price must be a non-negative number');
    error.status = 422;
    throw error;
  }

  let productId = toPositiveInt(data.product_id);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (!productId) {
      const productData = {
        name: data.name && String(data.name).trim(),
        description: data.description ? String(data.description).trim() : '',
        price: 0,
        category_id: toPositiveInt(data.category_id),
        sub_category_id: toPositiveInt(data.sub_category_id || data.subcategory_id),
        brand_id: toPositiveInt(data.brand_id),
      };

      if (!productData.name || productData.name.length < 2 || !productData.category_id || !productData.sub_category_id || !productData.brand_id) {
        const error = new Error('Name, category, subcategory, and brand are required for a new product');
        error.status = 422;
        throw error;
      }

      if (!(await Product.validateRelation(productData))) {
        const error = new Error('Selected category, subcategory, and brand do not match');
        error.status = 422;
        throw error;
      }

      const [result] = await connection.query(
        `INSERT INTO products
         (name, description, price, category_id, sub_category_id, brand_id, approval_status, created_by_vendor_id)
         VALUES (?, ?, 0.00, ?, ?, ?, 'pending', ?)`,
        [
          productData.name,
          productData.description || null,
          productData.category_id,
          productData.sub_category_id,
          productData.brand_id,
          vendorId,
        ]
      );
      productId = result.insertId;
    } else {
      const [productRows] = await connection.query(
        "SELECT id FROM products WHERE id = ? AND is_deleted = 0 LIMIT 1",
        [productId]
      );
      if (!productRows.length) {
        const error = new Error('Product not found');
        error.status = 404;
        throw error;
      }
    }

    const [result] = await connection.query(
      `INSERT INTO vendor_products (product_id, vendor_id, quantity, price, image_url, status)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         quantity = VALUES(quantity),
         price = VALUES(price),
         image_url = COALESCE(VALUES(image_url), image_url),
         status = VALUES(status)`,
      [productId, vendorId, quantity, price, data.image_url || null, data.status === 'inactive' ? 'inactive' : 'active']
    );
    await connection.commit();
    return findById(result.insertId || (await findExistingId(productId, vendorId)));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function findExistingId(productId, vendorId) {
  const [rows] = await pool.query('SELECT id FROM vendor_products WHERE product_id = ? AND vendor_id = ? LIMIT 1', [productId, vendorId]);
  return rows[0] && rows[0].id;
}

async function update(id, data) {
  const fields = [];
  const values = [];

  if (Object.prototype.hasOwnProperty.call(data, 'quantity')) {
    const quantity = toNonNegativeNumber(data.quantity);
    if (!Number.isFinite(quantity)) {
      const error = new Error('Quantity must be a non-negative number');
      error.status = 422;
      throw error;
    }
    fields.push('quantity = ?');
    values.push(quantity);
  }

  if (Object.prototype.hasOwnProperty.call(data, 'price')) {
    const price = toNonNegativeNumber(data.price);
    if (!Number.isFinite(price)) {
      const error = new Error('Price must be a non-negative number');
      error.status = 422;
      throw error;
    }
    fields.push('price = ?');
    values.push(price);
  }

  if (Object.prototype.hasOwnProperty.call(data, 'status')) {
    if (!['active', 'inactive'].includes(data.status)) {
      const error = new Error('Status must be active or inactive');
      error.status = 422;
      throw error;
    }
    fields.push('status = ?');
    values.push(data.status);
  }

  if (data.image_url) {
    fields.push('image_url = ?');
    values.push(data.image_url);
  }

  if (!fields.length) return findById(id);
  values.push(id);
  await pool.query(`UPDATE vendor_products SET ${fields.join(', ')} WHERE id = ?`, values);
  return findById(id);
}

async function remove(id) {
  await pool.query('DELETE FROM vendor_products WHERE id = ?', [id]);
}

async function setClientPrice({ product_id, vendor_id, client_id, custom_price }) {
  const productId = toPositiveInt(product_id);
  const vendorId = toPositiveInt(vendor_id);
  const clientId = toPositiveInt(client_id);
  const price = toNonNegativeNumber(custom_price);

  if (!productId || !vendorId || !clientId || !Number.isFinite(price)) {
    const error = new Error('Product, vendor, client, and valid custom price are required');
    error.status = 422;
    throw error;
  }
  if (!(await vendorExists(vendorId)) || !(await clientExists(clientId))) {
    const error = new Error('Valid vendor and client are required');
    error.status = 422;
    throw error;
  }

  await pool.query(
    `INSERT INTO vendor_client_product_prices (product_id, vendor_id, client_id, custom_price)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE custom_price = VALUES(custom_price)`,
    [productId, vendorId, clientId, price]
  );
}

async function deleteClientPrice({ product_id, vendor_id, client_id }) {
  await pool.query(
    'DELETE FROM vendor_client_product_prices WHERE product_id = ? AND vendor_id = ? AND client_id = ?',
    [product_id, vendor_id, client_id]
  );
}

async function approveProduct({ product_id, approved_by, default_price }) {
  const price = toNonNegativeNumber(default_price);
  if (!Number.isFinite(price)) {
    const error = new Error('Approved product needs a valid default price');
    error.status = 422;
    throw error;
  }
  await pool.query(
    `UPDATE products
     SET approval_status = 'approved', price = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, rejection_reason = NULL
     WHERE id = ? AND is_deleted = 0`,
    [price, approved_by || null, product_id]
  );
}

async function rejectProduct({ product_id, rejected_by, reason }) {
  await pool.query(
    `UPDATE products
     SET approval_status = 'rejected', approved_by = ?, approved_at = CURRENT_TIMESTAMP, rejection_reason = ?
     WHERE id = ? AND is_deleted = 0`,
    [rejected_by || null, reason || null, product_id]
  );
}

async function visibleForClient({ client_id, vendor_id, search, category_id, sub_category_id, brand_id, brand_name } = {}) {
  const where = [
    "p.approval_status = 'approved'",
    "vp.status = 'active'",
    'vp.quantity > 0',
    'p.is_deleted = 0',
    "u.status = 'active'",
    'u.is_deleted = 0',
  ];
  const params = [];

  if (client_id) {
    where.push('cp.city IS NOT NULL');
    where.push("TRIM(cp.city) <> ''");
    where.push('LOWER(TRIM(vprof.city)) = LOWER(TRIM(cp.city))');
  }
  if (vendor_id) {
    where.push('vp.vendor_id = ?');
    params.push(vendor_id);
  }
  if (category_id) {
    where.push('p.category_id = ?');
    params.push(category_id);
  }
  if (sub_category_id) {
    where.push('p.sub_category_id = ?');
    params.push(sub_category_id);
  }
  if (brand_id) {
    where.push('p.brand_id = ?');
    params.push(brand_id);
  }
  if (brand_name) {
    where.push('LOWER(TRIM(b.name)) = LOWER(TRIM(?))');
    params.push(brand_name);
  }
  if (search) {
    where.push('(p.name LIKE ? OR p.description LIKE ? OR b.name LIKE ?)');
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term);
  }

  const [rows] = await pool.query(
    `SELECT MIN(vp.id) AS id,
            p.id AS product_id,
            NULL AS vendor_id,
            MIN(vp.quantity) AS quantity,
            'active' AS status,
            MIN(vp.created_at) AS created_at,
            MAX(vp.updated_at) AS updated_at,
            COALESCE(MAX(vp.image_url), p.image_url, '/default.png') AS image_url,
            p.name AS product_name, p.description, p.price AS default_price,
            p.approval_status, p.category_id, p.sub_category_id, p.brand_id,
            c.name AS category_name, s.name AS sub_category_name, b.name AS brand_name,
            NULL AS vendor_name,
            NULL AS vendor_email,
            NULL AS client_id,
            NULL AS custom_price,
            p.price AS visible_price
     FROM vendor_products vp
     INNER JOIN products p ON p.id = vp.product_id
     INNER JOIN users u ON u.id = vp.vendor_id
     INNER JOIN vendor_profiles vprof ON vprof.user_id = vp.vendor_id
     ${client_id ? 'INNER JOIN client_profiles cp ON cp.user_id = ?' : ''}
     INNER JOIN categories c ON c.id = p.category_id
     INNER JOIN sub_categories s ON s.id = p.sub_category_id
     INNER JOIN brands b ON b.id = p.brand_id
     WHERE ${where.join(' AND ')}
     GROUP BY p.id, p.image_url, p.name, p.description, p.price, p.approval_status,
              p.category_id, p.sub_category_id, p.brand_id,
              c.name, s.name, b.name
     ORDER BY p.name ASC`,
    client_id ? [client_id, ...params] : params
  );
  return rows.map(normalize);
}

module.exports = {
  list,
  findById,
  create,
  update,
  remove,
  setClientPrice,
  deleteClientPrice,
  approveProduct,
  rejectProduct,
  visibleForClient,
};
