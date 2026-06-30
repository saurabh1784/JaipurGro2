const pool = require('../db');
const AreaDefinition = require('./AreaDefinition');

function money(value) {
  return Number(Math.max(Number(value || 0), 0).toFixed(2));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeAreaName(value) {
  const area = normalizeText(value);
  return area || '*';
}

function validatePercent(value, label) {
  const percent = Number(value || 0);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    const error = new Error(`${label} must be between 0 and 100`);
    error.status = 422;
    throw error;
  }
  return money(percent);
}

function normalize(row) {
  if (!row) return null;
  return {
    id: row.id,
    city: row.city || '',
    area: row.area || '*',
    order_commission_percentage: Number(row.order_commission_percentage || 0),
    delivery_commission_percentage: Number(row.delivery_commission_percentage || 0),
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function ensureTable(connection = pool) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS location_commission_settings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      city VARCHAR(120) NOT NULL,
      area VARCHAR(150) NOT NULL DEFAULT '*',
      order_commission_percentage DECIMAL(7,2) NOT NULL DEFAULT 0.00,
      delivery_commission_percentage DECIMAL(7,2) NOT NULL DEFAULT 0.00,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_location_commission_city_area (city, area),
      KEY idx_location_commission_lookup (city, area, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function list(connection = pool) {
  await ensureTable(connection);
  const [rows] = await connection.query(
    `SELECT *
     FROM location_commission_settings
     ORDER BY city, CASE WHEN area = '*' THEN 0 ELSE 1 END, area`
  );
  return rows.map(normalize);
}

async function listPayload() {
  const [settings, mappedAreas] = await Promise.all([
    list(),
    AreaDefinition.list({ includeInactive: true }),
  ]);
  const citySet = new Set();

  mappedAreas.forEach((area) => {
    if (area.city) citySet.add(area.city);
  });
  settings.forEach((setting) => {
    if (setting.city) citySet.add(setting.city);
  });

  return {
    settings,
    cities: Array.from(citySet).sort((a, b) => a.localeCompare(b)),
    areas: mappedAreas
      .filter((area) => area.city && area.name)
      .map((area) => ({
        id: area.id,
        city: area.city,
        area: area.name,
        order_commission_percentage: area.order_commission_percentage,
        delivery_commission_percentage: area.delivery_commission_percentage,
        is_active: area.is_active,
      })),
  };
}

async function saveOne(payload, connection = pool) {
  await ensureTable(connection);
  const city = normalizeText(payload.city);
  const area = normalizeAreaName(payload.area);
  const orderCommission = validatePercent(payload.order_commission_percentage, 'Order commission');
  const deliveryCommission = validatePercent(payload.delivery_commission_percentage, 'Delivery commission');
  const isActive = payload.is_active === undefined || payload.is_active === true || payload.is_active === 'true' || payload.is_active === '1' || payload.is_active === 'on' ? 1 : 0;

  if (!city) {
    const error = new Error('City is required');
    error.status = 422;
    throw error;
  }

  const [result] = await connection.query(
    `INSERT INTO location_commission_settings
     (city, area, order_commission_percentage, delivery_commission_percentage, is_active)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (city, area) DO UPDATE SET
       order_commission_percentage = EXCLUDED.order_commission_percentage,
       delivery_commission_percentage = EXCLUDED.delivery_commission_percentage,
       is_active = EXCLUDED.is_active,
       updated_at = CURRENT_TIMESTAMP`,
    [city, area, orderCommission, deliveryCommission, isActive]
  );
  return result.insertId || null;
}

async function saveMany(entries = []) {
  if (!Array.isArray(entries)) {
    const error = new Error('Commission entries must be an array');
    error.status = 422;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const entry of entries) {
      await saveOne(entry, connection);
    }
    await connection.commit();
    return listPayload();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function remove(id) {
  await ensureTable();
  const [result] = await pool.query('DELETE FROM location_commission_settings WHERE id = ?', [Number(id)]);
  if (result.affectedRows === 0) {
    const error = new Error('Commission setting not found');
    error.status = 404;
    throw error;
  }
}

async function resolveForLocation({ city = '', area = '' } = {}, connection = pool) {
  await ensureTable(connection);
  const cityValue = normalizeText(city);
  const areaValue = normalizeAreaName(area);
  if (!cityValue) return null;

  const [rows] = await connection.query(
    `SELECT *
     FROM location_commission_settings
     WHERE is_active = 1
       AND LOWER(TRIM(city)) = LOWER(TRIM(?))
       AND area IN (?, '*')
     ORDER BY CASE WHEN LOWER(TRIM(area)) = LOWER(TRIM(?)) THEN 0 WHEN area = '*' THEN 1 ELSE 2 END
     LIMIT 1`,
    [cityValue, areaValue, areaValue]
  );
  return normalize(rows[0]);
}

module.exports = {
  ensureTable,
  list,
  listPayload,
  remove,
  resolveForLocation,
  saveMany,
  saveOne,
};
