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
  return String(value || '').trim().toLowerCase();
}

function uniqueList(value) {
  return [...new Set(parseJsonList(value))];
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
    start_at: row.start_at,
    end_at: row.end_at,
    countdown_seconds: Number(row.countdown_seconds || 0),
    target_platforms: parseJsonList(row.target_platforms),
    city_scope: row.city_scope || 'all',
    city: row.city || '',
    areas: parseJsonList(row.areas),
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

  const paymentStatus = normalizeKey(data.payment_status || 'pending');
  const approvalStatus = normalizeKey(data.approval_status || 'pending');
  const status = normalizeKey(data.status || 'draft');
  if (!PAYMENT_STATUSES.includes(paymentStatus) || !APPROVAL_STATUSES.includes(approvalStatus) || !STATUS_VALUES.includes(status)) {
    const error = new Error('Invalid advertisement status value');
    error.status = 422;
    throw error;
  }

  return {
    title,
    description: String(data.description || '').trim(),
    image_path: data.image_path || null,
    start_at: data.start_at || data.campaign_start_at || null,
    end_at: data.end_at || data.campaign_end_at || null,
    countdown_seconds: Math.max(0, Math.min(120, Number(data.countdown_seconds || 0))),
    target_platforms: targetPlatforms,
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
     (title, description, image_path, start_at, end_at, countdown_seconds, target_platforms,
      city_scope, city, areas, status, advertiser_name, advertiser_email, advertiser_phone,
      package_name, payment_amount, payment_status, invoice_number, receipt_path,
      approval_status, campaign_start_at, campaign_end_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.title,
      payload.description || null,
      payload.image_path,
      payload.start_at,
      payload.end_at,
      payload.countdown_seconds,
      JSON.stringify(payload.target_platforms),
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
     SET title = ?, description = ?, image_path = COALESCE(?, image_path), start_at = ?, end_at = ?,
         countdown_seconds = ?, target_platforms = ?, city_scope = ?, city = ?, areas = ?,
         status = ?, advertiser_name = ?, advertiser_email = ?, advertiser_phone = ?, package_name = ?,
         payment_amount = ?, payment_status = ?, invoice_number = ?, receipt_path = ?,
         approval_status = ?, campaign_start_at = ?, campaign_end_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      payload.title,
      payload.description || null,
      payload.image_path,
      payload.start_at,
      payload.end_at,
      payload.countdown_seconds,
      JSON.stringify(payload.target_platforms),
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

async function activeForDisplay({ platform = 'client_app', userId = null, query = {} } = {}) {
  await expireEnded();
  const normalizedPlatform = normalizeKey(platform || 'client_app');
  if (!PLATFORM_VALUES.includes(normalizedPlatform)) return null;
  const location = await locationForUser(userId, normalizedPlatform, query);
  const [rows] = await pool.query(
    `SELECT *
     FROM advertisements
     WHERE status = 'active'
       AND payment_status = 'paid'
       AND approval_status = 'approved'
       AND (start_at IS NULL OR start_at <= CURRENT_TIMESTAMP)
       AND (end_at IS NULL OR end_at >= CURRENT_TIMESTAMP)
     ORDER BY created_at DESC, id DESC
     LIMIT 50`
  );
  return rows
    .map(normalizeAdvertisement)
    .find((ad) => ad.target_platforms.includes(normalizedPlatform) && matchesLocation(ad, location)) || null;
}

module.exports = {
  PLATFORM_VALUES,
  list,
  create,
  update,
  updateStatus,
  remove,
  activeForDisplay,
  expireEnded,
};
