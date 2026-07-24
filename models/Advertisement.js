const pool = require('../db');

const STATUS_VALUES = ['draft', 'active', 'paused', 'expired', 'blocked'];
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'];
const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'];
const PLATFORM_VALUES = [
  'client_app',
  'vendor_app',
  'delivery_app',
  'staff_app',
  'admin_dashboard',
  'vendor_dashboard',
  'client_website',
];

const PAGE_VALUES = [
  'all',
  'app_start',
  'home',
  'products',
  'categories',
  'cart',
  'orders',
  'profile',
  'checkout',
  'vendor_products',
  'vendor_orders',
  'delivery_orders',
  'delivery_profile',
];

const AD_TYPE_VALUES = [
  'page_banner',
  'launch_banner',
  'in_app_card',
  'offer_banner',
  'popup_banner',
  'full_page_banner',
  'top_text_ad',
  'other',
];

function parseJsonList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : [];
  } catch {
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function uniqueList(value) {
  return [...new Set(parseJsonList(value))];
}

function normalizedKeyList(value) {
  return uniqueList(value).map((item) => normalizeKey(item)).filter(Boolean);
}

function normalizePageKey(value) {
  const key = normalizeKey(value);
  if (key === 'all_page' || key === 'all_pages') return 'all';
  if (key.endsWith('_page')) return key.slice(0, -5);
  return key;
}

function normalizedPageList(value) {
  return uniqueList(value).map((item) => normalizePageKey(item)).filter(Boolean);
}

function normalizeStatus(row) {
  const now = Date.now();
  const current = normalizeKey(row.status || 'draft');
  if (current === 'active' && row.end_at && new Date(row.end_at).getTime() < now) {
    return 'expired';
  }
  return STATUS_VALUES.includes(current) ? current : 'draft';
}

function normalizeAdvertisement(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || '',
    description: row.description || '',
    image_path: row.image_path || '',
    image_url: row.image_path || '',
    banner_image_url: row.image_path || '',
    media_url: row.image_path || '',
    ad_type: normalizeKey(row.ad_type || 'page_banner'),
    start_at: row.start_at,
    end_at: row.end_at,
    countdown_seconds: Number(row.countdown_seconds || 0),
    priority: Number(row.priority || 0),
    target_platforms: normalizedKeyList(row.target_platforms),
    target_pages: normalizedPageList(row.target_pages),
    target_category_id: Number(row.target_category_id || 0),
    target_category_name: row.target_category_name || '',
    click_action_type: normalizeKey(row.click_action_type || 'none'),
    click_action_value: row.click_action_value || '',
    impression_count: Number(row.impression_count || 0),
    click_count: Number(row.click_count || 0),
    city_scope: row.city_scope || 'all',
    city: row.city || '',
    areas: normalizedKeyList(row.areas),
    status: normalizeStatus(row),
    advertiser_name: row.advertiser_name || '',
    advertiser_email: row.advertiser_email || '',
    advertiser_phone: row.advertiser_phone || '',
    package_name: row.package_name || '',
    payment_amount: Number(row.payment_amount || 0),
    payment_status: normalizeKey(row.payment_status || 'pending'),
    invoice_number: row.invoice_number || '',
    receipt_path: row.receipt_path || '',
    approval_status: normalizeKey(row.approval_status || 'pending'),
    campaign_start_at: row.campaign_start_at || row.start_at,
    campaign_end_at: row.campaign_end_at || row.end_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function expireEnded(connection = pool) {
  await connection.query(
    `UPDATE advertisements
     SET status = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'active' AND end_at IS NOT NULL AND end_at < CURRENT_TIMESTAMP`
  );
}

function validatePayload(data) {
  const title = String(data.title || '').trim();
  if (!title) {
    const error = new Error('Advertisement title is required');
    error.status = 422;
    throw error;
  }

  const targetPlatforms = uniqueList(data.target_platforms)
    .map((platform) => normalizeKey(platform))
    .filter((platform) => PLATFORM_VALUES.includes(platform));
  if (!targetPlatforms.length) {
    const error = new Error('Select at least one target platform');
    error.status = 422;
    throw error;
  }

  const targetPages = uniqueList(data.target_pages)
    .map((page) => normalizePageKey(page))
    .filter((page) => PAGE_VALUES.includes(page));
  if (!targetPages.length) {
    const error = new Error('Select at least one target page');
    error.status = 422;
    throw error;
  }

  const paymentStatus = normalizeKey(data.payment_status || 'pending');
  const approvalStatus = normalizeKey(data.approval_status || 'pending');
  const status = normalizeKey(data.status || 'draft');
  const adType = normalizeKey(data.ad_type || 'page_banner');
  if (!PAYMENT_STATUSES.includes(paymentStatus) || !APPROVAL_STATUSES.includes(approvalStatus) || !STATUS_VALUES.includes(status)) {
    const error = new Error('Invalid advertisement status value');
    error.status = 422;
    throw error;
  }
  if (!AD_TYPE_VALUES.includes(adType)) {
    const error = new Error('Invalid advertisement type');
    error.status = 422;
    throw error;
  }

  return {
    title,
    description: String(data.description || '').trim(),
    image_path: data.image_path || null,
    ad_type: adType,
    start_at: data.start_at || data.campaign_start_at || null,
    end_at: data.end_at || data.campaign_end_at || null,
    countdown_seconds: Math.max(0, Math.min(120, Number(data.countdown_seconds || 0))),
    priority: Math.max(0, Math.min(9999, Number(data.priority || 0))),
    target_platforms: targetPlatforms,
    target_pages: targetPages,
    target_category_id: Math.max(0, Number(data.target_category_id || data.targetCategoryId || 0) || 0),
    target_category_name: String(data.target_category_name || data.targetCategoryName || '').trim(),
    click_action_type: normalizeKey(data.click_action_type || data.clickActionType || 'none'),
    click_action_value: String(data.click_action_value || data.clickActionValue || '').trim(),
    city_scope: normalizeKey(data.city_scope || 'all') === 'specific' ? 'specific' : 'all',
    city: String(data.city || '').trim(),
    areas: uniqueList(data.areas),
    status,
    advertiser_name: String(data.advertiser_name || '').trim(),
    advertiser_email: String(data.advertiser_email || '').trim(),
    advertiser_phone: String(data.advertiser_phone || '').trim(),
    package_name: String(data.package_name || '').trim(),
    payment_amount: Number(data.payment_amount || 0),
    payment_status: paymentStatus,
    invoice_number: String(data.invoice_number || '').trim(),
    receipt_path: String(data.receipt_path || '').trim(),
    approval_status: approvalStatus,
    campaign_start_at: data.campaign_start_at || data.start_at || null,
    campaign_end_at: data.campaign_end_at || data.end_at || null,
  };
}

function activationStatus(payload) {
  if (payload.status === 'blocked' || payload.status === 'paused' || payload.status === 'expired') {
    return payload.status;
  }
  if (payload.status === 'active' && Number(payload.payment_amount || 0) <= 0) {
    return 'active';
  }
  if (payload.payment_status === 'paid' && payload.approval_status === 'approved') {
    return 'active';
  }
  return payload.status === 'active' ? 'draft' : payload.status;
}

async function list() {
  await expireEnded();
  const [rows] = await pool.query('SELECT * FROM advertisements ORDER BY created_at DESC, id DESC');
  return rows.map(normalizeAdvertisement);
}

async function create(data) {
  const payload = validatePayload(data);
  const [result] = await pool.query(
    `INSERT INTO advertisements
     (title, description, image_path, ad_type, start_at, end_at, countdown_seconds, priority, target_platforms, target_pages,
      target_category_id, target_category_name, click_action_type, click_action_value,
      city_scope, city, areas, status, advertiser_name, advertiser_email, advertiser_phone,
      package_name, payment_amount, payment_status, invoice_number, receipt_path,
      approval_status, campaign_start_at, campaign_end_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.title,
      payload.description || null,
      payload.image_path,
      payload.ad_type,
      payload.start_at,
      payload.end_at,
      payload.countdown_seconds,
      payload.priority,
      JSON.stringify(payload.target_platforms),
      JSON.stringify(payload.target_pages),
      payload.target_category_id || null,
      payload.target_category_name || null,
      payload.click_action_type,
      payload.click_action_value || null,
      payload.city_scope,
      payload.city || null,
      JSON.stringify(payload.areas),
      activationStatus(payload),
      payload.advertiser_name || null,
      payload.advertiser_email || null,
      payload.advertiser_phone || null,
      payload.package_name || null,
      payload.payment_amount,
      payload.payment_status,
      payload.invoice_number || null,
      payload.receipt_path || null,
      payload.approval_status,
      payload.campaign_start_at,
      payload.campaign_end_at,
    ]
  );
  return result.insertId;
}

async function update(id, data) {
  const payload = validatePayload(data);
  await pool.query(
    `UPDATE advertisements
     SET title = ?, description = ?, image_path = COALESCE(?, image_path), ad_type = ?, start_at = ?, end_at = ?,
         countdown_seconds = ?, priority = ?, target_platforms = ?, target_pages = ?, target_category_id = ?, target_category_name = ?,
         click_action_type = ?, click_action_value = ?, city_scope = ?, city = ?, areas = ?,
         status = ?, advertiser_name = ?, advertiser_email = ?, advertiser_phone = ?, package_name = ?,
         payment_amount = ?, payment_status = ?, invoice_number = ?, receipt_path = ?,
         approval_status = ?, campaign_start_at = ?, campaign_end_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      payload.title,
      payload.description || null,
      payload.image_path,
      payload.ad_type,
      payload.start_at,
      payload.end_at,
      payload.countdown_seconds,
      payload.priority,
      JSON.stringify(payload.target_platforms),
      JSON.stringify(payload.target_pages),
      payload.target_category_id || null,
      payload.target_category_name || null,
      payload.click_action_type,
      payload.click_action_value || null,
      payload.city_scope,
      payload.city || null,
      JSON.stringify(payload.areas),
      activationStatus(payload),
      payload.advertiser_name || null,
      payload.advertiser_email || null,
      payload.advertiser_phone || null,
      payload.package_name || null,
      payload.payment_amount,
      payload.payment_status,
      payload.invoice_number || null,
      payload.receipt_path || null,
      payload.approval_status,
      payload.campaign_start_at,
      payload.campaign_end_at,
      id,
    ]
  );
}

async function updateStatus(id, status) {
  const normalized = normalizeKey(status);
  if (!STATUS_VALUES.includes(normalized)) {
    const error = new Error('Invalid advertisement status');
    error.status = 422;
    throw error;
  }
  await pool.query('UPDATE advertisements SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [normalized, id]);
}

async function remove(id) {
  await pool.query('DELETE FROM advertisements WHERE id = ?', [id]);
}

async function locationForUser(userId, platform, query = {}) {
  const requestedCity = String(query.city || '').trim();
  const requestedArea = String(query.area || '').trim();
  if (requestedCity || requestedArea) {
    return { city: requestedCity, area: requestedArea };
  }
  if (!userId) return { city: '', area: '' };

  if (platform === 'client_app' || platform === 'client_website') {
    const [rows] = await pool.query(
      `SELECT COALESCE(
          NULLIF(TRIM(cp.city), ''),
          (SELECT NULLIF(TRIM(cda.city), '') FROM client_delivery_addresses cda WHERE cda.user_id = ? ORDER BY cda.is_default DESC, cda.updated_at DESC, cda.id DESC LIMIT 1)
        ) AS city,
        COALESCE(
          (SELECT NULLIF(TRIM(cda.area), '') FROM client_delivery_addresses cda WHERE cda.user_id = ? ORDER BY cda.is_default DESC, cda.updated_at DESC, cda.id DESC LIMIT 1),
          ''
        ) AS area
       FROM users u
       LEFT JOIN client_profiles cp ON cp.user_id = u.id
       WHERE u.id = ?
       LIMIT 1`,
      [userId, userId, userId]
    );
    return { city: rows[0] ? rows[0].city || '' : '', area: rows[0] ? rows[0].area || '' : '' };
  }

  const [rows] = await pool.query(
    `SELECT COALESCE(
        NULLIF(TRIM(vp.city), ''),
        (SELECT NULLIF(TRIM(dps.city), '') FROM delivery_partner_settings dps WHERE dps.user_id = ? AND dps.is_active = 1 ORDER BY dps.id DESC LIMIT 1)
      ) AS city,
      COALESCE(
        (SELECT NULLIF(TRIM(dps.area), '') FROM delivery_partner_settings dps WHERE dps.user_id = ? AND dps.is_active = 1 ORDER BY dps.id DESC LIMIT 1),
        ''
      ) AS area
     FROM users u
     LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
     WHERE u.id = ?
     LIMIT 1`,
    [userId, userId, userId]
  );
  return { city: rows[0] ? rows[0].city || '' : '', area: rows[0] ? rows[0].area || '' : '' };
}

function matchesLocation(ad, location) {
  if (ad.city_scope !== 'specific') return true;
  if (!normalizeKey(ad.city) || normalizeKey(ad.city) !== normalizeKey(location.city)) return false;
  if (!ad.areas.length) return true;
  return ad.areas.some((area) => normalizeKey(area) === '*' || normalizeKey(area) === normalizeKey(location.area));
}

function normalizeAdTypeList(value) {
  return uniqueList(value)
    .map((item) => normalizeKey(item))
    .filter((item) => AD_TYPE_VALUES.includes(item));
}

function randomItem(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)] || null;
}

async function activeForDisplay({ platform = 'client_app', page = null, adType = null, adTypes = null, userId = null, query = {} } = {}) {
  const advertisements = await activeListForDisplay({ platform, page, adType, adTypes, userId, query });
  if (normalizeAdTypeList(adTypes || adType || query.ad_types || query.ad_type).includes('full_page_banner')) {
    return randomItem(advertisements);
  }
  return advertisements[0] || null;
}

async function seedDefaultsIfEmpty() {
  try {
    const [countRows] = await pool.query('SELECT COUNT(*)::int AS count FROM advertisements').catch(() => [[]]);
    const count = Number(countRows && countRows[0] && (countRows[0].count || countRows[0]['count(*)'] || 0));

    if (count === 0) {
      await pool.query(`
        INSERT INTO advertisements
          (title, description, image_path, ad_type, status, target_platforms, target_pages, priority, countdown_seconds)
        VALUES
          ('Fresh Grocery Deals & Savings', 'Up to 40% OFF on Fresh Vegetables, Seasonal Fruits & Daily Staples.', '/uploads/advertisements/full-screen-1784294136287.png', 'offer_banner', 'active', '["client_app", "client_website"]', '["home", "all"]', 100, 5),
          ('Super Savings Week', 'Flat ₹100 Instant Discount on Daily Essentials, Rice, Atta & Spices.', '/uploads/advertisements/test-1783654876226.png', 'page_banner', 'active', '["client_app", "client_website"]', '["home", "all"]', 90, 5),
          ('Express Doorstep Delivery', 'Superfast Delivery for Milk, Butter, Cheese, Eggs & Fresh Bakery.', '/uploads/advertisements/testd-1783664311586.png', 'in_app_card', 'active', '["client_app", "client_website"]', '["home", "all"]', 80, 5)
      `).catch((err) => {
        console.error('Error seeding default advertisements:', err.message);
      });
    }
  } catch (err) {
    console.error('seedDefaultsIfEmpty failed:', err.message);
  }
}

async function activeListForDisplay({ platform = 'client_app', page = null, adType = null, adTypes = null, userId = null, query = {}, limit = 50 } = {}) {
  await expireEnded();
  await seedDefaultsIfEmpty();
  const normalizedPlatform = normalizeKey(platform || 'client_app');
  if (!PLATFORM_VALUES.includes(normalizedPlatform)) return [];
  const normalizedPage = page ? normalizeKey(page) : null;
  const requestedCategoryId = Number(query.category_id || query.categoryId || 0) || 0;
  const requestedAdTypes = normalizeAdTypeList(adTypes || adType || query.ad_types || query.ad_type);
  const location = await locationForUser(userId, normalizedPlatform, query);
  const [rows] = await pool.query(
    `SELECT *
     FROM advertisements
     WHERE status = 'active'
       AND (start_at IS NULL OR start_at <= CURRENT_TIMESTAMP)
       AND (end_at IS NULL OR end_at >= CURRENT_TIMESTAMP)
     ORDER BY priority DESC, created_at DESC, id DESC
     LIMIT 100`
  );
  return rows
    .map(normalizeAdvertisement)
    .filter((ad) => {
      if (!ad.target_platforms.includes(normalizedPlatform)) return false;
      if (requestedAdTypes.length && !requestedAdTypes.includes(ad.ad_type)) return false;
      if (normalizedPage && ad.target_pages.length && !ad.target_pages.includes('all') && !ad.target_pages.includes(normalizedPage)) return false;
      if (ad.target_category_id > 0 && ad.target_category_id !== requestedCategoryId) return false;
      return matchesLocation(ad, location);
    })
    .slice(0, Math.max(1, Number(limit || 50)));
}


async function recordEvent(id, eventType, metadata = {}) {
  const type = normalizeKey(eventType);
  if (!['impression', 'click'].includes(type)) return;
  const column = type === 'click' ? 'click_count' : 'impression_count';
  await pool.query(`UPDATE advertisements SET ${column} = COALESCE(${column}, 0) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
  await pool.query(
    `INSERT INTO advertisement_events (advertisement_id, event_type, platform, page, category_id, user_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      type,
      normalizeKey(metadata.platform || ''),
      normalizeKey(metadata.page || ''),
      Number(metadata.category_id || metadata.categoryId || 0) || null,
      Number(metadata.user_id || metadata.userId || 0) || null,
      JSON.stringify(metadata || {}),
    ]
  ).catch(() => null);
}

async function recordImpression(id, metadata = {}) {
  return recordEvent(id, 'impression', metadata);
}

async function recordClick(id, metadata = {}) {
  return recordEvent(id, 'click', metadata);
}
module.exports = {
  PLATFORM_VALUES,
  AD_TYPE_VALUES,
  list,
  create,
  update,
  updateStatus,
  remove,
  activeForDisplay,
  activeListForDisplay,
  recordImpression,
  recordClick,
  expireEnded,
};



