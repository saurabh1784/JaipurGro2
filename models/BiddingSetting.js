const pool = require('../db');

function boolValue(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1 || value === '1') return true;
  const text = String(value).trim().toLowerCase();
  if (['true', 'yes', 'on', 'enabled'].includes(text)) return true;
  if (['false', 'no', 'off', 'disabled', '0'].includes(text)) return false;
  return fallback;
}

function cleanCity(value) {
  return String(value || '').trim();
}

function cleanTime(value, fallback) {
  const text = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

function normalize(row) {
  if (!row) return null;
  return {
    id: row.id,
    city: row.city || '',
    timer_minutes: Number(row.timer_minutes || 30),
    daily_start_time: String(row.daily_start_time || '00:00').slice(0, 5),
    daily_end_time: String(row.daily_end_time || '23:59').slice(0, 5),
    is_enabled: row.is_enabled === true || row.is_enabled === 1 || row.is_enabled === '1' || row.is_enabled === 'true',
    auto_close_on_expiry: row.auto_close_on_expiry === true || row.auto_close_on_expiry === 1 || row.auto_close_on_expiry === '1' || row.auto_close_on_expiry === 'true',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function ensureTable(connection = pool) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS bidding_settings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      city VARCHAR(120) NOT NULL,
      timer_minutes INT UNSIGNED NOT NULL DEFAULT 30,
      daily_start_time TIME NOT NULL DEFAULT '00:00:00',
      daily_end_time TIME NOT NULL DEFAULT '23:59:00',
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      auto_close_on_expiry TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_bidding_settings_city (city),
      KEY idx_bidding_settings_lookup (city, is_enabled)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await connection.query('CREATE UNIQUE INDEX IF NOT EXISTS uniq_bidding_settings_city ON bidding_settings (city)');
}

async function list(connection = pool) {
  await ensureTable(connection);
  const [rows] = await connection.query('SELECT * FROM bidding_settings ORDER BY city');
  return rows.map(normalize);
}

async function saveOne(payload, connection = pool) {
  await ensureTable(connection);
  const city = cleanCity(payload.city);
  const timerMinutes = Math.max(1, Math.min(10080, Math.round(Number(payload.timer_minutes || payload.timerMinutes || 30))));
  const startTime = cleanTime(payload.daily_start_time || payload.dailyStartTime, '00:00');
  const endTime = cleanTime(payload.daily_end_time || payload.dailyEndTime, '23:59');
  const enabled = boolValue(payload.is_enabled ?? payload.isEnabled, true) ? 1 : 0;
  const autoClose = boolValue(payload.auto_close_on_expiry ?? payload.autoCloseOnExpiry, true) ? 1 : 0;
  if (!city) {
    const error = new Error('City is required');
    error.status = 422;
    throw error;
  }
  await connection.query(
    `INSERT INTO bidding_settings
     (city, timer_minutes, daily_start_time, daily_end_time, is_enabled, auto_close_on_expiry)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (city) DO UPDATE SET
       timer_minutes = EXCLUDED.timer_minutes,
       daily_start_time = EXCLUDED.daily_start_time,
       daily_end_time = EXCLUDED.daily_end_time,
       is_enabled = EXCLUDED.is_enabled,
       auto_close_on_expiry = EXCLUDED.auto_close_on_expiry,
       updated_at = CURRENT_TIMESTAMP`,
    [city, timerMinutes, `${startTime}:00`, `${endTime}:00`, enabled, autoClose]
  );
}

async function remove(id) {
  await ensureTable();
  const [result] = await pool.query('DELETE FROM bidding_settings WHERE id = ?', [Number(id)]);
  if (result.affectedRows === 0) {
    const error = new Error('Bidding setting not found');
    error.status = 404;
    throw error;
  }
}

async function resolveForCity(city, connection = pool) {
  await ensureTable(connection);
  const cityValue = cleanCity(city);
  if (!cityValue) return defaultSetting(cityValue);
  const [rows] = await connection.query(
    `SELECT * FROM bidding_settings
     WHERE LOWER(TRIM(city)) = LOWER(TRIM(?))
     LIMIT 1`,
    [cityValue]
  );
  return normalize(rows[0]) || defaultSetting(cityValue);
}

function defaultSetting(city = '') {
  return {
    id: null,
    city,
    timer_minutes: 1440,
    daily_start_time: '00:00',
    daily_end_time: '23:59',
    is_enabled: true,
    auto_close_on_expiry: true,
  };
}

function isWithinDailyWindow(setting, now = new Date()) {
  if (!setting || !setting.is_enabled) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const [startHour, startMinute] = String(setting.daily_start_time || '00:00').split(':').map(Number);
  const [endHour, endMinute] = String(setting.daily_end_time || '23:59').split(':').map(Number);
  const start = (startHour || 0) * 60 + (startMinute || 0);
  const end = (endHour || 0) * 60 + (endMinute || 0);
  return start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end;
}

module.exports = {
  ensureTable,
  list,
  saveOne,
  remove,
  resolveForCity,
  isWithinDailyWindow,
};
