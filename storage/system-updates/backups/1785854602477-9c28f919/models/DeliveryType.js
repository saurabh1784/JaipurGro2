const pool = require('../db');
const AreaDefinition = require('./AreaDefinition');

const TYPES = [
  { slug: 'in_house_delivery', label: 'In-house Delivery', method: 'in_house_auto', priority: 1 },
  { slug: 'delivery_partner', label: 'Delivery Partner', method: 'partner', priority: 2 },
  { slug: 'counter_pickup', label: 'Client Self Pickup', method: 'counter_pickup', priority: 3 },
  { slug: 'delivered_by_vendor', label: 'Vendor Delivery', method: 'own_delivery', priority: 4 },
];

const TYPE_BY_SLUG = new Map(TYPES.map((type) => [type.slug, type]));
const TYPE_BY_METHOD = new Map(TYPES.map((type) => [type.method, type]));
let schemaReady = false;

function clean(value) {
  return String(value || '').trim();
}

async function ensureSchema(connection = pool) {
  if (schemaReady) return;
  await connection.query(`
    CREATE TABLE IF NOT EXISTS delivery_type_area_settings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      city VARCHAR(120) NOT NULL,
      area VARCHAR(150) NOT NULL DEFAULT '*',
      delivery_type VARCHAR(40) NOT NULL,
      label VARCHAR(120) NOT NULL,
      priority INT UNSIGNED NOT NULL DEFAULT 99,
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_delivery_type_area (city, area, delivery_type),
      KEY idx_delivery_type_area_lookup (city, area, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  schemaReady = true;
}

function normalizeType(value) {
  const raw = clean(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (TYPE_BY_SLUG.has(raw)) return raw;
  if (TYPE_BY_METHOD.has(raw)) return TYPE_BY_METHOD.get(raw).slug;
  if (raw === 'inhouse' || raw === 'in_house') return 'in_house_delivery';
  if (raw === 'partner') return 'delivery_partner';
  if (raw === 'own_delivery' || raw === 'vendor_delivery') return 'delivered_by_vendor';
  if (raw === 'pickup') return 'counter_pickup';
  return '';
}

function methodForType(type) {
  return (TYPE_BY_SLUG.get(normalizeType(type)) || TYPE_BY_SLUG.get('delivery_partner')).method;
}

function typeForMethod(method) {
  return (TYPE_BY_METHOD.get(clean(method).toLowerCase()) || TYPE_BY_SLUG.get('delivery_partner')).slug;
}

function parseServices(value) {
  if (Array.isArray(value)) return value.map((item) => clean(item).toLowerCase()).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) return parseServices(parsed);
  } catch {
    // fall through to comma split
  }
  return String(value).split(',').map((item) => clean(item).toLowerCase()).filter(Boolean);
}

function vendorAllows(type, services) {
  const values = parseServices(services);
  if (!['counter_pickup', 'delivered_by_vendor'].includes(type)) return true;
  if (type === 'counter_pickup') {
    return values.some((service) => service === 'counter pickup' || service === 'counter_pickup');
  }
  return values.some((service) => (
    service === 'delivered by vendor'
    || service === 'delivered_by_vendor'
    || service === 'own delivery'
    || service === 'own_delivery'
    || service === 'home delivery'
  ));
}

async function vendorServices(vendorId, connection = pool) {
  if (!vendorId) return [];
  const [rows] = await connection.query('SELECT services FROM vendor_profiles WHERE user_id = ? LIMIT 1', [vendorId]);
  return parseServices(rows[0] && rows[0].services);
}

async function hasActiveDeliveryPartner({ city = '', area = '' } = {}, connection = pool) {
  const cityValue = clean(city);
  const areaValue = clean(area) || '*';
  if (!cityValue) return false;
  const [rows] = await connection.query(
    `SELECT dps.id
     FROM delivery_partner_settings dps
     INNER JOIN users u ON u.id = dps.user_id
     WHERE dps.is_active = 1
       AND LOWER(TRIM(dps.city)) = LOWER(TRIM(CAST(? AS TEXT)))
       AND (TRIM(COALESCE(dps.area, '*')) = '*' OR LOWER(TRIM(dps.area)) = LOWER(TRIM(CAST(? AS TEXT))))
       AND LOWER(u.status) = 'active'
       AND u.is_deleted = 0
       AND LOWER(u.role) = 'deliveryperson'
     LIMIT 1`,
    [cityValue, areaValue]
  );
  return rows.length > 0;
}

async function areaSettings({ city = '', area = '' } = {}, connection = pool) {
  await ensureSchema(connection);
  const cityValue = clean(city);
  const areaValue = clean(area) || '*';
  if (!cityValue) return new Map();
  const [rows] = await connection.query(
    `SELECT delivery_type, is_enabled, is_active, priority, area
     FROM delivery_type_area_settings
     WHERE is_active = 1
       AND LOWER(TRIM(city)) = LOWER(TRIM(CAST(? AS TEXT)))
       AND (TRIM(COALESCE(area, '*')) = '*' OR LOWER(TRIM(area)) = LOWER(TRIM(CAST(? AS TEXT))))
     ORDER BY CASE WHEN LOWER(TRIM(area)) = LOWER(TRIM(CAST(? AS TEXT))) THEN 0 ELSE 1 END`,
    [cityValue, areaValue, areaValue]
  );
  const map = new Map();
  for (const row of rows) {
    const slug = normalizeType(row.delivery_type);
    if (slug && !map.has(slug)) {
      map.set(slug, {
        enabled: Boolean(row.is_enabled) && Boolean(row.is_active),
        priority: Math.max(Number(row.priority) || TYPE_BY_SLUG.get(slug).priority, 1),
      });
    }
  }
  return map;
}

function fallbackEnabled(type, { matchedArea, deliveryPartnerActive, hasAreaSettings }) {
  if (type === 'in_house_delivery') return Boolean(matchedArea && matchedArea.own_delivery_active);
  if (type === 'delivery_partner') return Boolean(deliveryPartnerActive || !hasAreaSettings);
  if (type === 'delivered_by_vendor') return Boolean(matchedArea && matchedArea.own_delivery_active);
  if (type === 'counter_pickup') return !hasAreaSettings;
  return false;
}

async function availableForLocation(location = {}, connection = pool) {
  const matchedArea = await AreaDefinition.findMatchingArea(location, connection);
  const city = clean((matchedArea && matchedArea.city) || location.city);
  const area = clean((matchedArea && matchedArea.name) || location.area || location.pincode) || '*';
  const settings = await areaSettings({ city, area }, connection);
  const services = await vendorServices(location.vendorId || location.vendor_id, connection);
  const deliveryPartnerActive = await hasActiveDeliveryPartner({ city, area }, connection);
  const hasAreaSettings = settings.size > 0;

  const deliveryTypes = TYPES.map((type) => {
    const configured = settings.get(type.slug);
    const areaEnabled = configured
      ? configured.enabled
      : fallbackEnabled(type.slug, { matchedArea, deliveryPartnerActive, hasAreaSettings });
    const vendorEnabled = vendorAllows(type.slug, services);
    const enabled = Boolean(areaEnabled && vendorEnabled);
    return {
      ...type,
      priority: configured ? configured.priority : type.priority,
      enabled,
      area_enabled: Boolean(areaEnabled),
      vendor_enabled: Boolean(vendorEnabled),
      disabled_reason: enabled ? '' : (!areaEnabled ? 'disabled_for_area' : 'disabled_for_vendor'),
    };
  });
  const available = deliveryTypes.filter((type) => type.enabled).sort((a, b) => a.priority - b.priority);
  const requested = normalizeType(location.requestedType || location.deliveryType || location.delivery_method || location.delivery_type);
  const requestedType = requested ? deliveryTypes.find((type) => type.slug === requested) : null;
  if (requestedType && !requestedType.enabled) {
    const error = new Error(`${requestedType.label} is not available for this vendor/area`);
    error.status = 422;
    throw error;
  }
  const selected = requestedType || available[0] || {
    ...TYPE_BY_SLUG.get('delivery_partner'),
    enabled: false,
  };

  return {
    city,
    area,
    matched_area: matchedArea || null,
    delivery_types: deliveryTypes,
    available_delivery_types: available,
    selected_delivery_type: selected,
    selected_type: selected.slug,
    selected_method: selected.method,
  };
}

async function isTypeAvailable(type, location = {}, connection = pool) {
  const slug = normalizeType(type);
  const result = await availableForLocation(location, connection);
  return {
    active: result.delivery_types.some((entry) => entry.slug === slug && entry.enabled),
    ...result,
  };
}

async function listSettings({ city = '', area = '' } = {}) {
  await ensureSchema();
  const params = [];
  const where = [];
  if (clean(city)) {
    where.push('LOWER(TRIM(city)) = LOWER(TRIM(?))');
    params.push(clean(city));
  }
  if (clean(area)) {
    where.push('LOWER(TRIM(area)) = LOWER(TRIM(?))');
    params.push(clean(area));
  }
  const [rows] = await pool.query(
    `SELECT *
     FROM delivery_type_area_settings
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY city, area, priority, delivery_type`,
    params
  );
  return rows.map((row) => ({
    ...row,
    label: (TYPE_BY_SLUG.get(normalizeType(row.delivery_type)) || {}).label || row.delivery_type,
    is_enabled: Boolean(row.is_enabled),
    is_active: Boolean(row.is_active),
  }));
}

async function saveSetting(payload) {
  await ensureSchema();
  const city = clean(payload.city);
  const area = clean(payload.area) || '*';
  const deliveryType = normalizeType(payload.delivery_type || payload.deliveryType);
  if (!city) {
    const error = new Error('City is required');
    error.status = 422;
    throw error;
  }
  if (!deliveryType) {
    const error = new Error('Valid delivery type is required');
    error.status = 422;
    throw error;
  }
  const meta = TYPE_BY_SLUG.get(deliveryType);
  const priority = Math.max(parseInt(payload.priority, 10) || meta.priority, 1);
  const enabled = payload.is_enabled === undefined ? 1 : (payload.is_enabled || payload.enabled ? 1 : 0);
  const active = payload.is_active === undefined ? 1 : (payload.is_active || payload.active ? 1 : 0);
  const [result] = await pool.query(
    `INSERT INTO delivery_type_area_settings
     (city, area, delivery_type, label, priority, is_enabled, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (city, area, delivery_type) DO UPDATE SET
       label = EXCLUDED.label,
       priority = EXCLUDED.priority,
       is_enabled = EXCLUDED.is_enabled,
       is_active = EXCLUDED.is_active,
       updated_at = CURRENT_TIMESTAMP`,
    [city, area, deliveryType, meta.label, priority, enabled, active]
  );
  return result.insertId;
}

async function saveAreaTypes(payload) {
  const city = clean(payload.city);
  const area = clean(payload.area) || '*';
  const types = payload.types && typeof payload.types === 'object' ? payload.types : {};
  if (payload.replace) {
    await removeAreaSettings({ city, area });
  }
  for (const type of TYPES) {
    if (Object.prototype.hasOwnProperty.call(types, type.slug) || Object.prototype.hasOwnProperty.call(types, type.method)) {
      const setting = types[type.slug] ?? types[type.method];
      const config = setting && typeof setting === 'object' ? setting : { enabled: Boolean(setting) };
      await saveSetting({
        city,
        area,
        delivery_type: type.slug,
        is_enabled: Boolean(config.enabled),
        is_active: config.active === undefined ? true : Boolean(config.active),
        priority: config.priority,
      });
    }
  }
}

async function removeSetting({ city = '', area = '', delivery_type: deliveryType = '', deliveryType: camelType = '' } = {}) {
  await ensureSchema();
  const cityValue = clean(city);
  const areaValue = clean(area) || '*';
  const normalizedType = normalizeType(deliveryType || camelType);
  if (!cityValue || !normalizedType) {
    const error = new Error('City and delivery type are required');
    error.status = 422;
    throw error;
  }
  const [result] = await pool.query(
    'DELETE FROM delivery_type_area_settings WHERE LOWER(TRIM(city)) = LOWER(TRIM(?)) AND LOWER(TRIM(area)) = LOWER(TRIM(?)) AND delivery_type = ?',
    [cityValue, areaValue, normalizedType]
  );
  return result.affectedRows || 0;
}

async function removeAreaSettings({ city = '', area = '' } = {}) {
  await ensureSchema();
  const cityValue = clean(city);
  const areaValue = clean(area) || '*';
  if (!cityValue) {
    const error = new Error('City is required');
    error.status = 422;
    throw error;
  }
  const [result] = await pool.query(
    'DELETE FROM delivery_type_area_settings WHERE LOWER(TRIM(city)) = LOWER(TRIM(?)) AND LOWER(TRIM(area)) = LOWER(TRIM(?))',
    [cityValue, areaValue]
  );
  return result.affectedRows || 0;
}

module.exports = {
  TYPES,
  availableForLocation,
  isTypeAvailable,
  listSettings,
  methodForType,
  normalizeType,
  removeAreaSettings,
  removeSetting,
  saveAreaTypes,
  saveSetting,
  typeForMethod,
};
