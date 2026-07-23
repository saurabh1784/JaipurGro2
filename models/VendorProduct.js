const pool = require('../db');
const Product = require('./Product');

function normalize(row) {
  if (!row) return null;
  const weightValue = Number(row.weight_value ?? row.weight_kg ?? 0);
  const weightUnit = row.weight_unit || 'kg';
  const defaultPrice = row.default_price === undefined ? undefined : Number(row.default_price || 0);
  return {
    id: row.id,
    product_id: row.product_id,
    vendor_id: row.vendor_id,
    quantity: Number(row.quantity || 0),
    price: defaultPrice === undefined ? (row.price === undefined ? undefined : Number(row.price || 0)) : defaultPrice,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    product_name: row.product_name,
    description: row.description,
    default_price: defaultPrice,
    weight_value: weightValue,
    weight_unit: weightUnit,
    weight_kg: Number(row.weight_kg || 0),
    weight_label: weightValue > 0 ? `${Number(weightValue.toFixed(3))} ${weightUnit}` : 'Not set',
    approval_status: row.approval_status,
    rejection_reason: row.rejection_reason,
    category_id: row.category_id,
    sub_category_id: row.sub_category_id,
    brand_id: row.brand_id,
    category_name: row.category_name,
    sub_category_name: row.sub_category_name,
    sub_category_image_path: row.sub_category_image_path || '',
    brand_name: row.brand_name,
    vendor_name: row.vendor_name,
    vendor_email: row.vendor_email,
    is_sponsored: Boolean(row.is_sponsored),
    sponsored_priority: Number(row.sponsored_priority || 0),
    ranking_score: row.ranking_score === undefined ? 0 : Number(row.ranking_score || 0),
    image_url: row.image_url || '/default.png',
    vendor_image_url: row.vendor_image_url || '',
    product_image_url: row.product_image_url || '',
    image_version: Number(row.image_version || 0) || new Date(row.vendor_product_updated_at || row.product_updated_at || row.updated_at || 0).getTime() || 0,
    client_id: row.client_id,
    custom_price: row.custom_price === undefined || row.custom_price === null ? null : Number(row.custom_price),
    visible_price: defaultPrice === undefined
      ? (row.visible_price === undefined ? undefined : Number(row.visible_price || 0))
      : defaultPrice,
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

function normalizeStatus(value) {
  if (value === undefined || value === null || value === '') return 'active';
  if (['active', 'inactive', 'unavailable'].includes(value)) return value;
  const error = new Error('Status must be active, inactive, or unavailable');
  error.status = 422;
  throw error;
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
    where.push('EXISTS (SELECT 1 FROM vendor_categories vc WHERE vc.vendor_id = vp.vendor_id AND vc.category_id = p.category_id)');
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
    `SELECT vp.*,
            COALESCE(
              NULLIF(NULLIF(vp.image_url, ''), '/default.png'),
              NULLIF(NULLIF(p.image_url, ''), '/default.png'),
              '/default.png'
            ) AS image_url,
            NULLIF(NULLIF(vp.image_url, ''), '/default.png') AS vendor_image_url,
            NULLIF(NULLIF(p.image_url, ''), '/default.png') AS product_image_url,
            p.updated_at AS product_updated_at, vp.updated_at AS vendor_product_updated_at,
            p.name AS product_name, p.description, p.price AS default_price,
            p.weight_value, p.weight_unit, p.weight_kg,
            p.approval_status, p.rejection_reason, p.category_id, p.sub_category_id, p.brand_id,
            c.name AS category_name, s.name AS sub_category_name, s.image_path AS sub_category_image_path, b.name AS brand_name,
            u.name AS vendor_name, u.email AS vendor_email,
            COALESCE(sp.is_sponsored, 0) AS is_sponsored,
            COALESCE(sp.priority_order, 0) AS sponsored_priority
     FROM vendor_products vp
     INNER JOIN products p ON p.id = vp.product_id
     INNER JOIN users u ON u.id = vp.vendor_id
     ${vendor_id ? '' : 'LEFT JOIN vendor_categories vc ON vc.vendor_id = vp.vendor_id AND vc.category_id = p.category_id'}
     INNER JOIN categories c ON c.id = p.category_id
     INNER JOIN sub_categories s ON s.id = p.sub_category_id
     INNER JOIN brands b ON b.id = p.brand_id
     LEFT JOIN sponsored_products sp ON sp.product_id = p.id
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(sp.is_sponsored, 0) DESC,
              COALESCE(sp.priority_order, 0) DESC,
              vp.updated_at DESC,
              vp.id DESC`,
    params
  );
  return rows.map(normalize);
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT vp.*,
            COALESCE(
              NULLIF(NULLIF(vp.image_url, ''), '/default.png'),
              NULLIF(NULLIF(p.image_url, ''), '/default.png'),
              '/default.png'
            ) AS image_url,
            NULLIF(NULLIF(vp.image_url, ''), '/default.png') AS vendor_image_url,
            NULLIF(NULLIF(p.image_url, ''), '/default.png') AS product_image_url,
            p.updated_at AS product_updated_at, vp.updated_at AS vendor_product_updated_at,
            p.name AS product_name, p.description, p.price AS default_price,
            p.weight_value, p.weight_unit, p.weight_kg,
            p.approval_status, p.rejection_reason, p.category_id, p.sub_category_id, p.brand_id,
            c.name AS category_name, s.name AS sub_category_name, s.image_path AS sub_category_image_path, b.name AS brand_name,
            u.name AS vendor_name, u.email AS vendor_email,
            COALESCE(sp.is_sponsored, 0) AS is_sponsored,
            COALESCE(sp.priority_order, 0) AS sponsored_priority
     FROM vendor_products vp
     INNER JOIN products p ON p.id = vp.product_id
     INNER JOIN users u ON u.id = vp.vendor_id
     INNER JOIN categories c ON c.id = p.category_id
     INNER JOIN sub_categories s ON s.id = p.sub_category_id
     INNER JOIN brands b ON b.id = p.brand_id
     LEFT JOIN sponsored_products sp ON sp.product_id = p.id
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

  const status = normalizeStatus(data.status);
  const quantity = status === 'unavailable' ? 0 : toNonNegativeNumber(data.quantity || 0);
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
  if (!productId) {
    const error = new Error('Please select a product from the master product list');
    error.status = 422;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [productRows] = await connection.query(
      `SELECT p.id
       FROM products p
       INNER JOIN vendor_categories vc ON vc.category_id = p.category_id AND vc.vendor_id = ?
       WHERE p.id = ? AND p.is_deleted = 0 AND p.approval_status = 'approved'
       LIMIT 1`,
      [vendorId, productId]
    );
    if (!productRows.length) {
      const error = new Error('Product not found in your approved categories');
      error.status = 404;
      throw error;
    }

    const [result] = await connection.query(
      `INSERT INTO vendor_products (product_id, vendor_id, quantity, price, status)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (product_id, vendor_id) DO UPDATE
       SET quantity = EXCLUDED.quantity,
           price = EXCLUDED.price,
           status = EXCLUDED.status
       RETURNING id`,
      [productId, vendorId, quantity, price, status]
    );
    await connection.commit();
    invalidateVisibleProductsCache();
    return findById(result.insertId || (await findExistingId(productId, vendorId)));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function createProductRequest(data) {
  const vendorId = toPositiveInt(data.vendor_id);
  if (!vendorId || !(await vendorExists(vendorId))) {
    const error = new Error('Valid vendor is required');
    error.status = 422;
    throw error;
  }
  if (!(await Product.validateRelation(data))) {
    const error = new Error('Selected category, subcategory, and brand do not match');
    error.status = 422;
    throw error;
  }

  const price = toNonNegativeNumber(data.price || 0);
  const quantity = toNonNegativeNumber(data.quantity || 0);
  if (!Number.isFinite(price)) {
    const error = new Error('Price must be a non-negative number');
    error.status = 422;
    throw error;
  }
  if (!Number.isFinite(quantity)) {
    const error = new Error('Quantity must be a non-negative number');
    error.status = 422;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const productId = await Product.create({
      ...data,
      price,
      approval_status: 'pending',
      created_by_vendor_id: vendorId,
    });
    await connection.query(
      `INSERT INTO vendor_products (product_id, vendor_id, quantity, price, status, image_url)
       VALUES (?, ?, ?, ?, 'active', ?)
       ON CONFLICT (product_id, vendor_id) DO UPDATE
       SET quantity = EXCLUDED.quantity,
           price = EXCLUDED.price,
           status = EXCLUDED.status,
           image_url = EXCLUDED.image_url`,
      [productId, vendorId, quantity, price, data.image_url || null]
    );
    await connection.commit();
    invalidateVisibleProductsCache();
    return findById(await findExistingId(productId, vendorId));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function resubmitProductRequest(productId, data) {
  const vendorId = toPositiveInt(data.vendor_id);
  const id = toPositiveInt(productId);
  if (!vendorId || !id) {
    const error = new Error('Valid vendor and product are required');
    error.status = 422;
    throw error;
  }
  const existing = await Product.findById(id);
  if (!existing || Number(existing.created_by_vendor_id || 0) !== Number(vendorId)) {
    const error = new Error('Product request not found for this vendor');
    error.status = 404;
    throw error;
  }
  if (!['rejected', 'pending', 'in_review'].includes(existing.approval_status)) {
    const error = new Error('Only pending, in-review, or rejected product requests can be updated');
    error.status = 422;
    throw error;
  }
  if (!(await Product.validateRelation(data))) {
    const error = new Error('Selected category, subcategory, and brand do not match');
    error.status = 422;
    throw error;
  }

  const price = toNonNegativeNumber(data.price || 0);
  const quantity = toNonNegativeNumber(data.quantity || 0);
  if (!Number.isFinite(price) || !Number.isFinite(quantity)) {
    const error = new Error('Price and quantity must be valid non-negative numbers');
    error.status = 422;
    throw error;
  }

  await Product.update(id, { ...data, price });
  await Product.updateApprovalStatus(id, { status: 'pending', actor_id: vendorId });
  invalidateVisibleProductsCache();
  const vendorProductId = await findExistingId(id, vendorId);
  if (vendorProductId) {
    await update(vendorProductId, {
      price,
      quantity,
      status: 'active',
      image_url: data.image_url,
    });
  } else {
    await pool.query(
      `INSERT INTO vendor_products (product_id, vendor_id, quantity, price, status, image_url)
       VALUES (?, ?, ?, ?, 'active', ?)`,
      [id, vendorId, quantity, price, data.image_url || null]
    );
  }
  return findById(await findExistingId(id, vendorId));
}

async function findExistingId(productId, vendorId) {
  const [rows] = await pool.query('SELECT id FROM vendor_products WHERE product_id = ? AND vendor_id = ? LIMIT 1', [productId, vendorId]);
  return rows[0] && rows[0].id;
}

async function update(id, data) {
  const fields = [];
  const values = [];

  const hasStatus = Object.prototype.hasOwnProperty.call(data, 'status');
  const nextStatus = hasStatus ? normalizeStatus(data.status) : null;

  if (Object.prototype.hasOwnProperty.call(data, 'quantity') && data.quantity !== '' && data.quantity !== null && data.quantity !== undefined && nextStatus !== 'unavailable') {
    const quantity = toNonNegativeNumber(data.quantity);
    if (!Number.isFinite(quantity)) {
      const error = new Error('Quantity must be a non-negative number');
      error.status = 422;
      throw error;
    }
    fields.push('quantity = ?');
    values.push(quantity);
  }

  if (Object.prototype.hasOwnProperty.call(data, 'price') && data.price !== '' && data.price !== null && data.price !== undefined) {
    const price = toNonNegativeNumber(data.price);
    if (!Number.isFinite(price)) {
      const error = new Error('Price must be a non-negative number');
      error.status = 422;
      throw error;
    }
    fields.push('price = ?');
    values.push(price);
  }

  if (hasStatus) {
    fields.push('status = ?');
    values.push(nextStatus);
    if (nextStatus === 'unavailable') {
      fields.push('quantity = ?');
      values.push(0);
    }
  }

  if (data.image_url) {
    fields.push('image_url = ?');
    values.push(data.image_url);
  }

  if (!fields.length) return findById(id);
  values.push(id);
  await pool.query(`UPDATE vendor_products SET ${fields.join(', ')} WHERE id = ?`, values);
  invalidateVisibleProductsCache();
  return findById(id);
}

async function remove(id) {
  await pool.query('DELETE FROM vendor_products WHERE id = ?', [id]);
  invalidateVisibleProductsCache();
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
     ON CONFLICT (product_id, vendor_id, client_id) DO UPDATE
     SET custom_price = EXCLUDED.custom_price`,
    [productId, vendorId, clientId, price]
  );
}

async function deleteClientPrice({ product_id, vendor_id, client_id }) {
  await pool.query(
    'DELETE FROM vendor_client_product_prices WHERE product_id = ? AND vendor_id = ? AND client_id = ?',
    [product_id, vendor_id, client_id]
  );
}

async function ensureAllProductsForAllVendors(connection = pool) {
  const [result] = await connection.query(
    `INSERT INTO vendor_products (product_id, vendor_id, quantity, price, status)
     SELECT p.id, u.id, 10, COALESCE(p.price, 0), 'active'
     FROM products p
     INNER JOIN users u ON u.role = 'Vendor' AND u.is_deleted = 0
     INNER JOIN vendor_categories vc ON vc.vendor_id = u.id AND vc.category_id = p.category_id
     WHERE p.is_deleted = 0
     ON CONFLICT (product_id, vendor_id) DO NOTHING`
  );
  invalidateVisibleProductsCache();
  return Number(result.affectedRows || result.rowCount || 0);
}

async function ensureProductForAllVendors(productId, connection = pool) {
  const [result] = await connection.query(
    `INSERT INTO vendor_products (product_id, vendor_id, quantity, price, status)
     SELECT p.id, u.id, 10, COALESCE(p.price, 0), 'active'
     FROM products p
     INNER JOIN users u ON u.role = 'Vendor' AND u.is_deleted = 0
     INNER JOIN vendor_categories vc ON vc.vendor_id = u.id AND vc.category_id = p.category_id
     WHERE p.id = ? AND p.is_deleted = 0
     ON CONFLICT (product_id, vendor_id) DO NOTHING`,
    [productId]
  );
  invalidateVisibleProductsCache();
  return Number(result.affectedRows || result.rowCount || 0);
}

async function ensureVendorHasAllProducts(vendorId, connection = pool) {
  const [result] = await connection.query(
    `INSERT INTO vendor_products (product_id, vendor_id, quantity, price, status)
     SELECT p.id, u.id, 10, COALESCE(p.price, 0), 'active'
     FROM users u
     INNER JOIN products p ON p.is_deleted = 0
     INNER JOIN vendor_categories vc ON vc.vendor_id = u.id AND vc.category_id = p.category_id
     WHERE u.id = ? AND u.role = 'Vendor' AND u.is_deleted = 0
     ON CONFLICT (product_id, vendor_id) DO NOTHING`,
    [vendorId]
  );
  invalidateVisibleProductsCache();
  return Number(result.affectedRows || result.rowCount || 0);
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

const _visibleProductsCache = new Map();
const VISIBLE_PRODUCTS_CACHE_TTL = 10000;

function invalidateVisibleProductsCache() {
  _visibleProductsCache.clear();
}

async function visibleForClient({ client_id, vendor_id, search, category_id, sub_category_id, brand_id, brand_name } = {}) {
  const cacheKey = JSON.stringify({ client_id, vendor_id, search, category_id, sub_category_id, brand_id, brand_name });
  const cached = _visibleProductsCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.time < VISIBLE_PRODUCTS_CACHE_TTL)) {
    return cached.data;
  }

  const where = [
    "p.approval_status = 'approved'",
    "vp.status = 'active'",
    'vp.quantity > 0',
    'p.is_deleted = 0',
    "u.status = 'active'",
    'u.is_deleted = 0',
    'vc.vendor_id IS NOT NULL',
  ];
  const params = [];
  const term = search ? `%${String(search).trim()}%` : null;

  if (client_id) {
    where.push('cp.city IS NOT NULL');
    where.push("TRIM(cp.city) <> ''");
    where.push('LOWER(TRIM(vprof.city)) = LOWER(TRIM(cp.city))');
    where.push("(cp.area IS NULL OR TRIM(cp.area) = '' OR LOWER(TRIM(vprof.area)) = LOWER(TRIM(cp.area)))");
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
    where.push('p.name ILIKE ?');
    params.push(term);
  }

  const [rows] = await pool.query(
    `SELECT MIN(vp.id) AS id,
            p.id AS product_id,
            NULL AS vendor_id,
            MIN(vp.quantity) AS quantity,
            'active' AS status,
            MIN(vp.created_at) AS created_at,
            MAX(vp.updated_at) AS updated_at,
            COALESCE(
              MAX(NULLIF(NULLIF(vp.image_url, ''), '/default.png')),
              NULLIF(NULLIF(p.image_url, ''), '/default.png'),
              '/default.png'
            ) AS image_url,
            MAX(NULLIF(NULLIF(vp.image_url, ''), '/default.png')) AS vendor_image_url,
            NULLIF(NULLIF(p.image_url, ''), '/default.png') AS product_image_url,
            GREATEST(
              EXTRACT(EPOCH FROM COALESCE(MAX(vp.updated_at), MAX(p.updated_at))),
              EXTRACT(EPOCH FROM COALESCE(MAX(p.updated_at), MAX(vp.updated_at)))
            )::BIGINT AS image_version,
            p.name AS product_name, p.description, p.price AS default_price,
            p.weight_value, p.weight_unit, p.weight_kg,
            p.approval_status, p.category_id, p.sub_category_id, p.brand_id,
            c.name AS category_name, s.name AS sub_category_name, s.image_path AS sub_category_image_path, b.name AS brand_name,
            NULL AS vendor_name,
            NULL AS vendor_email,
            NULL AS client_id,
            NULL AS custom_price,
            MIN(vp.price) AS visible_price,
            COALESCE(sp.is_sponsored, 0) AS is_sponsored,
            COALESCE(sp.priority_order, 0) AS sponsored_priority,
            (
              COALESCE(MAX(prs.popularity_score), 0)
              + COALESCE(MAX(prs.click_score), 0)
              + COALESCE(MAX(prs.purchase_score), 0)
              + COALESCE(MAX(prs.search_score), 0)
              + CASE WHEN COUNT(DISTINCT ura.id) > 0 THEN 12 ELSE 0 END
              + CASE WHEN COUNT(DISTINCT coi.id) > 0 THEN 20 ELSE 0 END
              + CASE WHEN CAST(? AS TEXT) IS NOT NULL AND p.name ILIKE ? THEN 120 ELSE 0 END
              + CASE WHEN CAST(? AS TEXT) IS NOT NULL AND EXISTS (
                  SELECT 1 FROM product_keywords pk
                  WHERE pk.product_id = p.id AND pk.keyword ILIKE ?
                ) THEN 55 ELSE 0 END
              + CASE WHEN CAST(? AS TEXT) IS NOT NULL AND c.name ILIKE ? THEN 35 ELSE 0 END
            ) AS ranking_score
     FROM vendor_products vp
     INNER JOIN products p ON p.id = vp.product_id
     INNER JOIN users u ON u.id = vp.vendor_id
     INNER JOIN vendor_profiles vprof ON vprof.user_id = vp.vendor_id
     INNER JOIN vendor_categories vc ON vc.vendor_id = vp.vendor_id AND vc.category_id = p.category_id
     ${client_id ? 'INNER JOIN client_profiles cp ON cp.user_id = ?' : ''}
     INNER JOIN categories c ON c.id = p.category_id
     INNER JOIN sub_categories s ON s.id = p.sub_category_id
     INNER JOIN brands b ON b.id = p.brand_id
     LEFT JOIN sponsored_products sp ON sp.product_id = p.id
     LEFT JOIN product_ranking_scores prs ON prs.product_id = p.id
     LEFT JOIN user_recent_activity ura ON ura.product_id = p.id AND ura.user_id = ? AND ura.activity_type IN ('view', 'click', 'search')
     LEFT JOIN client_orders co ON co.user_id = ?
     LEFT JOIN client_order_items coi ON coi.order_id = co.id AND coi.vendor_product_id = vp.id
     WHERE ${where.join(' AND ')}
     GROUP BY p.id, p.image_url, p.name, p.description, p.price, p.weight_value, p.weight_unit, p.weight_kg, p.approval_status,
              p.category_id, p.sub_category_id, p.brand_id,
              c.name, s.name, s.image_path, b.name, sp.is_sponsored, sp.priority_order
     ORDER BY COALESCE(sp.is_sponsored, 0) DESC,
              COALESCE(sp.priority_order, 0) DESC,
              ranking_score DESC,
              CASE WHEN CAST(? AS TEXT) IS NOT NULL AND LOWER(p.name) = LOWER(?) THEN 0 ELSE 1 END,
              p.name ASC`,
    [
      term, term,
      term, term,
      term, term,
      ...(client_id ? [client_id] : []),
      client_id || null,
      client_id || null,
      ...params,
      term,
      search ? String(search).trim() : null,
    ]
  );
  const result = rows.map(normalize);
  _visibleProductsCache.set(cacheKey, { data: result, time: now });
  return result;
}

module.exports = {
  list,
  findById,
  create,
  createProductRequest,
  resubmitProductRequest,
  update,
  remove,
  setClientPrice,
  deleteClientPrice,
  ensureAllProductsForAllVendors,
  ensureProductForAllVendors,
  ensureVendorHasAllProducts,
  approveProduct,
  rejectProduct,
  visibleForClient,
  invalidateVisibleProductsCache,
};





