const pool = require('../db');

const APPLY_SCOPES = ['direct', 'quotation', 'both'];
const VALUE_TYPES = ['fixed', 'percentage'];

function normalizePromotion(row) {
  if (!row) return null;
  const cities = parseCities(row.cities);
  return {
    id: row.id,
    promo_type: row.promo_type || (row.code ? 'coupon' : 'discount'),
    name: row.name,
    vendor_id: row.vendor_id === null || row.vendor_id === undefined ? null : Number(row.vendor_id),
    vendor_name: row.vendor_name || '',
    vendor_store_name: row.vendor_store_name || row.vendor_business_name || '',
    vendor_logo_path: row.vendor_logo_path || '',
    vendor_storefront_image_path: row.vendor_storefront_image_path || '',
    code: row.code,
    description: row.description || '',
    value_type: row.value_type,
    value: Number(row.value || 0),
    min_order_amount: Number(row.min_order_amount || 0),
    start_at: row.start_at,
    expires_at: row.expires_at,
    is_active: Boolean(Number(row.is_active)),
    apply_on: row.apply_on || 'both',
    usage_limit: row.usage_limit === null || row.usage_limit === undefined ? null : Number(row.usage_limit),
    per_customer_limit: row.per_customer_limit === null || row.per_customer_limit === undefined ? null : Number(row.per_customer_limit),
    auto_generate: Boolean(Number(row.auto_generate)),
    image_path: row.image_path || '',
    background_color: row.background_color || '#0f766e',
    text_color: row.text_color || '#ffffff',
    scroll_message: row.scroll_message || '',
    city_scope: row.city_scope || 'all',
    cities,
    usage_count: Number(row.usage_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseCities(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : [];
  } catch {
    return String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function normalizeCity(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCityScope(data) {
  const cities = parseCities(data.cities);
  return {
    city_scope: String(data.city_scope || 'all').toLowerCase() === 'specific' && cities.length ? 'specific' : 'all',
    cities,
  };
}

function matchesCity(promotion, clientCity) {
  if (!promotion || promotion.city_scope !== 'specific') return true;
  const city = normalizeCity(clientCity);
  if (!city) return false;
  return promotion.cities.some((item) => normalizeCity(item) === city);
}

async function cityForClient(userId, connection = pool) {
  const [rows] = await connection.query(
    `SELECT COALESCE(
       NULLIF(TRIM(cp.city), ''),
       (SELECT NULLIF(TRIM(cda.city), '')
        FROM client_delivery_addresses cda
        WHERE cda.user_id = ?
        ORDER BY cda.is_default DESC, cda.updated_at DESC, cda.id DESC
        LIMIT 1)
     ) AS city
     FROM users u
     LEFT JOIN client_profiles cp ON cp.user_id = u.id
     WHERE u.id = ?
     LIMIT 1`,
    [userId, userId]
  );
  return rows[0] ? rows[0].city || '' : '';
}

function makeCode(prefix = 'CPN') {
  return `${prefix}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function calculateDiscount(promotion, amount) {
  const base = Number(amount || 0);
  if (promotion.value_type === 'percentage') {
    return Math.min(base, Number(((base * promotion.value) / 100).toFixed(2)));
  }
  return Math.min(base, Number(promotion.value || 0));
}

function storeOfferMessage(promotion) {
  const storeName = promotion.vendor_store_name || promotion.vendor_name || '';
  if (!storeName) return promotion.scroll_message || '';
  const variants = [
    `${storeName}'s new offer`,
    `New offer from ${storeName}`,
    `Fresh savings at ${storeName}`,
  ];
  return variants[Number(promotion.id || 0) % variants.length];
}

function validateShape(data, { requireCode = false } = {}) {
  const valueType = String(data.value_type || 'fixed').toLowerCase();
  const applyOn = String(data.apply_on || 'both').toLowerCase();
  if (!VALUE_TYPES.includes(valueType)) {
    const error = new Error('Discount type must be fixed or percentage');
    error.status = 422;
    throw error;
  }
  if (!APPLY_SCOPES.includes(applyOn)) {
    const error = new Error('Apply on must be direct, quotation, or both');
    error.status = 422;
    throw error;
  }
  if (requireCode && !String(data.code || '').trim()) {
    const error = new Error('Coupon code is required');
    error.status = 422;
    throw error;
  }
}

async function listDiscounts() {
  const [rows] = await pool.query(
    `SELECT d.*, u.name AS vendor_name
     FROM discounts d
     LEFT JOIN users u ON u.id = d.vendor_id
     ORDER BY d.created_at DESC, d.id DESC`
  );
  return rows.map(normalizePromotion);
}

async function listVendorDiscounts(vendorId) {
  const [rows] = await pool.query(
    `SELECT d.*, u.name AS vendor_name
     FROM discounts d
     LEFT JOIN users u ON u.id = d.vendor_id
     WHERE d.vendor_id = ?
     ORDER BY d.created_at DESC, d.id DESC`,
    [vendorId]
  );
  return rows.map(normalizePromotion);
}

async function listCoupons() {
  const [rows] = await pool.query('SELECT * FROM coupons ORDER BY created_at DESC, id DESC');
  return rows.map(normalizePromotion);
}

async function createDiscount(data) {
  validateShape(data);
  const cityTarget = normalizeCityScope(data);
  const [result] = await pool.query(
    `INSERT INTO discounts
     (name, vendor_id, description, value_type, value, min_order_amount, start_at, expires_at, is_active, apply_on, usage_limit, per_customer_limit, image_path, background_color, text_color, scroll_message, city_scope, cities)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name,
      data.vendor_id || null,
      data.description || null,
      data.value_type,
      Number(data.value || 0),
      Number(data.min_order_amount || 0),
      data.start_at || null,
      data.expires_at || null,
      data.is_active ? 1 : 0,
      data.apply_on || 'both',
      data.usage_limit || null,
      data.per_customer_limit || null,
      data.image_path || null,
      data.background_color || '#0f766e',
      data.text_color || '#ffffff',
      data.scroll_message || null,
      cityTarget.city_scope,
      JSON.stringify(cityTarget.cities),
    ]
  );
  return result.insertId;
}

async function updateDiscount(id, data) {
  validateShape(data);
  const cityTarget = normalizeCityScope(data);
  await pool.query(
    `UPDATE discounts
     SET name = ?, description = ?, value_type = ?, value = ?, min_order_amount = ?,
         start_at = ?, expires_at = ?, is_active = ?, apply_on = ?, usage_limit = ?, per_customer_limit = ?,
         image_path = COALESCE(?, image_path), background_color = ?, text_color = ?, scroll_message = ?,
         city_scope = ?, cities = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      data.name,
      data.description || null,
      data.value_type,
      Number(data.value || 0),
      Number(data.min_order_amount || 0),
      data.start_at || null,
      data.expires_at || null,
      data.is_active ? 1 : 0,
      data.apply_on || 'both',
      data.usage_limit || null,
      data.per_customer_limit || null,
      data.image_path || null,
      data.background_color || '#0f766e',
      data.text_color || '#ffffff',
      data.scroll_message || null,
      cityTarget.city_scope,
      JSON.stringify(cityTarget.cities),
      id,
    ]
  );
}

async function deleteDiscount(id) {
  await pool.query('DELETE FROM discounts WHERE id = ?', [id]);
}

async function createCoupon(data) {
  const code = String(data.auto_generate ? makeCode() : data.code || '').trim().toUpperCase();
  validateShape({ ...data, code }, { requireCode: true });
  const cityTarget = normalizeCityScope(data);
  const [result] = await pool.query(
    `INSERT INTO coupons
     (name, code, description, value_type, value, min_order_amount, start_at, expires_at, is_active, apply_on, usage_limit, per_customer_limit, auto_generate, image_path, background_color, text_color, scroll_message, city_scope, cities)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name,
      code,
      data.description || null,
      data.value_type,
      Number(data.value || 0),
      Number(data.min_order_amount || 0),
      data.start_at || null,
      data.expires_at || null,
      data.is_active ? 1 : 0,
      data.apply_on || 'both',
      data.usage_limit || null,
      data.per_customer_limit || null,
      data.auto_generate ? 1 : 0,
      data.image_path || null,
      data.background_color || '#1d4ed8',
      data.text_color || '#ffffff',
      data.scroll_message || null,
      cityTarget.city_scope,
      JSON.stringify(cityTarget.cities),
    ]
  );
  return result.insertId;
}

async function updateCoupon(id, data) {
  const code = String(data.auto_generate ? makeCode() : data.code || '').trim().toUpperCase();
  validateShape({ ...data, code }, { requireCode: true });
  const cityTarget = normalizeCityScope(data);
  await pool.query(
    `UPDATE coupons
     SET name = ?, code = ?, description = ?, value_type = ?, value = ?, min_order_amount = ?,
         start_at = ?, expires_at = ?, is_active = ?, apply_on = ?, usage_limit = ?, per_customer_limit = ?,
         auto_generate = ?, image_path = COALESCE(?, image_path), background_color = ?, text_color = ?, scroll_message = ?,
         city_scope = ?, cities = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      data.name,
      code,
      data.description || null,
      data.value_type,
      Number(data.value || 0),
      Number(data.min_order_amount || 0),
      data.start_at || null,
      data.expires_at || null,
      data.is_active ? 1 : 0,
      data.apply_on || 'both',
      data.usage_limit || null,
      data.per_customer_limit || null,
      data.auto_generate ? 1 : 0,
      data.image_path || null,
      data.background_color || '#1d4ed8',
      data.text_color || '#ffffff',
      data.scroll_message || null,
      cityTarget.city_scope,
      JSON.stringify(cityTarget.cities),
      id,
    ]
  );
}

async function deleteCoupon(id) {
  await pool.query('DELETE FROM coupons WHERE id = ?', [id]);
}

async function findActiveDiscount(orderType, subtotal, userId, connection = pool, vendorId = null) {
  const clientCity = await cityForClient(userId, connection);
  const vendorClause = vendorId ? '(d.vendor_id IS NULL OR d.vendor_id = ?)' : 'd.vendor_id IS NULL';
  const [rows] = await connection.query(
    `SELECT d.*,
            (SELECT COUNT(*) FROM coupon_history ch WHERE ch.discount_id = d.id) AS usage_count,
            (SELECT COUNT(*) FROM coupon_history ch WHERE ch.discount_id = d.id AND ch.user_id = ?) AS customer_usage_count
     FROM discounts d
     WHERE d.is_active = 1
       AND ${vendorClause}
       AND d.min_order_amount <= ?
       AND d.apply_on IN (?, 'both')
       AND (d.start_at IS NULL OR d.start_at <= CURRENT_TIMESTAMP)
       AND (d.expires_at IS NULL OR d.expires_at >= CURRENT_TIMESTAMP)
     ORDER BY CASE d.value_type WHEN 'percentage' THEN (? * d.value / 100) ELSE d.value END DESC, d.id DESC
     LIMIT 25`,
    vendorId ? [userId, vendorId, subtotal, orderType, subtotal] : [userId, subtotal, orderType, subtotal]
  );

  for (const row of rows) {
    const discount = normalizePromotion(row);
    if (!matchesCity(discount, clientCity)) continue;
    if (discount.usage_limit && Number(row.usage_count || 0) >= discount.usage_limit) continue;
    if (discount.per_customer_limit && Number(row.customer_usage_count || 0) >= discount.per_customer_limit) continue;
    return discount;
  }
  return null;
}

async function validateCoupon({ code, orderType, subtotal, userId }, connection = pool) {
  const couponCode = String(code || '').trim().toUpperCase();
  if (!couponCode) return null;

  const [rows] = await connection.query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM coupon_history ch WHERE ch.coupon_id = c.id) AS usage_count,
            (SELECT COUNT(*) FROM coupon_history ch WHERE ch.coupon_id = c.id AND ch.user_id = ?) AS customer_usage_count
     FROM coupons c
     WHERE UPPER(c.code) = ?
     LIMIT 1`,
    [userId, couponCode]
  );

  const coupon = normalizePromotion(rows[0]);
  if (!coupon) {
    const error = new Error('Coupon not found');
    error.status = 422;
    throw error;
  }
  if (!coupon.is_active) {
    const error = new Error('Coupon is disabled');
    error.status = 422;
    throw error;
  }
  const clientCity = await cityForClient(userId, connection);
  if (!matchesCity(coupon, clientCity)) {
    const error = new Error('Coupon is not available in your city');
    error.status = 422;
    throw error;
  }
  if (!['both', orderType].includes(coupon.apply_on)) {
    const error = new Error('Coupon cannot be applied to this order type');
    error.status = 422;
    throw error;
  }
  const now = Date.now();
  if (coupon.start_at && new Date(coupon.start_at).getTime() > now) {
    const error = new Error('Coupon is not active yet');
    error.status = 422;
    throw error;
  }
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < now) {
    const error = new Error('Coupon has expired');
    error.status = 422;
    throw error;
  }
  if (subtotal < coupon.min_order_amount) {
    const error = new Error(`Minimum order amount for this coupon is INR ${coupon.min_order_amount.toFixed(2)}`);
    error.status = 422;
    throw error;
  }
  if (coupon.usage_limit && Number(rows[0].usage_count || 0) >= coupon.usage_limit) {
    const error = new Error('Coupon usage limit reached');
    error.status = 422;
    throw error;
  }
  if (coupon.per_customer_limit && Number(rows[0].customer_usage_count || 0) >= coupon.per_customer_limit) {
    const error = new Error('Coupon per-customer limit reached');
    error.status = 422;
    throw error;
  }

  return coupon;
}

async function resolveOrderPromotion({ couponCode, orderType, subtotal, userId, vendorId = null }, connection = pool) {
  if (couponCode) {
    const coupon = await validateCoupon({ code: couponCode, orderType, subtotal, userId }, connection);
    return {
      source: 'coupon',
      coupon,
      discount: null,
      discountAmount: calculateDiscount(coupon, subtotal),
      code: coupon.code,
    };
  }

  const discount = await findActiveDiscount(orderType, subtotal, userId, connection, vendorId);
  if (!discount) {
    return { source: null, coupon: null, discount: null, discountAmount: 0, code: null };
  }
  return {
    source: 'discount',
    coupon: null,
    discount,
    discountAmount: calculateDiscount(discount, subtotal),
    code: null,
  };
}

async function recordUsage({ orderId, userId, orderType, subtotal, discountAmount, coupon = null, discount = null }, connection = pool) {
  if (!coupon && !discount) return;
  await connection.query(
    `INSERT INTO coupon_history
     (coupon_id, discount_id, order_id, user_id, order_type, code, subtotal_amount, discount_amount, final_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      coupon ? coupon.id : null,
      discount ? discount.id : null,
      orderId,
      userId,
      orderType,
      coupon ? coupon.code : null,
      subtotal,
      discountAmount,
      Math.max(subtotal - discountAmount, 0),
    ]
  );
}

async function listHistory() {
  const [rows] = await pool.query(
    `SELECT ch.*, u.name AS user_name, u.email AS user_email, c.name AS coupon_name, d.name AS discount_name
     FROM coupon_history ch
     LEFT JOIN users u ON u.id = ch.user_id
     LEFT JOIN coupons c ON c.id = ch.coupon_id
     LEFT JOIN discounts d ON d.id = ch.discount_id
     ORDER BY ch.created_at DESC, ch.id DESC
     LIMIT 300`
  );
  return rows.map((row) => ({
    ...row,
    subtotal_amount: Number(row.subtotal_amount || 0),
    discount_amount: Number(row.discount_amount || 0),
    final_amount: Number(row.final_amount || 0),
  }));
}

async function activeDisplayPromotions(userId, options = {}) {
  const vendorOnly = Boolean(options.vendorOnly);
  const offersOnly = Boolean(options.offersOnly);
  const clientCity = userId ? await cityForClient(userId) : '';
  const discountVendorClause = vendorOnly
    ? 'AND vendor_id IS NOT NULL'
    : offersOnly
      ? 'AND vendor_id IS NULL'
      : '';
  const includeCoupons = !vendorOnly;
  const [discountRows] = await pool.query(
    `SELECT id, 'discount' AS promo_type, name, NULL AS code, value_type, value, min_order_amount,
            image_path, background_color, text_color, scroll_message, apply_on, expires_at, start_at, city_scope, cities,
            vendor_id, vendor_name, vendor_store_name, vendor_logo_path, vendor_storefront_image_path
     FROM (
       SELECT d.*, u.name AS vendor_name, vp.business_name AS vendor_store_name,
              vp.logo_path AS vendor_logo_path,
              vp.storefront_image_path AS vendor_storefront_image_path
       FROM discounts d
       LEFT JOIN users u ON u.id = d.vendor_id
       LEFT JOIN vendor_profiles vp ON vp.user_id = d.vendor_id
     ) discounts
     WHERE is_active = 1
       AND (start_at IS NULL OR start_at <= CURRENT_TIMESTAMP)
       AND (expires_at IS NULL OR expires_at >= CURRENT_TIMESTAMP)
       AND COALESCE(scroll_message, '') <> ''
       ${discountVendorClause}
     ORDER BY created_at DESC, id DESC
     LIMIT 5`
  );
  const [couponRows] = includeCoupons
    ? await pool.query(
        `SELECT id, 'coupon' AS promo_type, name, code, value_type, value, min_order_amount,
                image_path, background_color, text_color, scroll_message, apply_on, expires_at, start_at, city_scope, cities
         FROM coupons
         WHERE is_active = 1
           AND (start_at IS NULL OR start_at <= CURRENT_TIMESTAMP)
           AND (expires_at IS NULL OR expires_at >= CURRENT_TIMESTAMP)
           AND COALESCE(scroll_message, '') <> ''
         ORDER BY created_at DESC, id DESC
         LIMIT 5`
      )
    : [[]];

  return [...discountRows, ...couponRows]
    .map(normalizePromotion)
    .filter((promotion) => matchesCity(promotion, clientCity))
    .map((promotion) => ({
      ...promotion,
      promo_type: promotion.vendor_id ? 'vendor_ad' : promotion.promo_type,
      content_priority: promotion.vendor_id ? 2 : 3,
      value: Number(promotion.value || 0),
      min_order_amount: Number(promotion.min_order_amount || 0),
      scroll_message: storeOfferMessage(promotion),
      image_path: promotion.image_path || promotion.vendor_storefront_image_path || promotion.vendor_logo_path,
      background_color: promotion.background_color || '#0f766e',
      text_color: promotion.text_color || '#ffffff',
    }));
}

module.exports = {
  listDiscounts,
  listVendorDiscounts,
  listCoupons,
  listHistory,
  createDiscount,
  updateDiscount,
  deleteDiscount,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  resolveOrderPromotion,
  recordUsage,
  activeDisplayPromotions,
};
