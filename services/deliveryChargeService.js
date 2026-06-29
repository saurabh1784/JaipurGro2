const https = require('https');
const pool = require('../db');

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Number(Math.max(0, toNumber(value)).toFixed(2));
}

function coordinateAddress(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `${lat},${lng}`;
}

function normalizeRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    city: row.city || '',
    rule_name: row.rule_name || '',
    min_weight_kg: toNumber(row.min_weight_kg),
    max_weight_kg: row.max_weight_kg === null || row.max_weight_kg === undefined ? null : toNumber(row.max_weight_kg),
    base_delivery_price: toNumber(row.base_delivery_price),
    price_per_km: toNumber(row.price_per_km),
    price_per_kg: toNumber(row.price_per_kg),
    additional_charge: toNumber(row.additional_charge),
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function extractWeightKg(name) {
  const text = String(name || '').toLowerCase();
  const kgMatch = text.match(/(\d+(?:\.\d+)?)\s*kg\b/);
  if (kgMatch) return toNumber(kgMatch[1]);
  const gramMatch = text.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (gramMatch) return toNumber(gramMatch[1]) / 1000;
  const litreMatch = text.match(/(\d+(?:\.\d+)?)\s*l\b/);
  if (litreMatch) return toNumber(litreMatch[1]);
  const mlMatch = text.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  if (mlMatch) return toNumber(mlMatch[1]) / 1000;
  return 0;
}

function itemWeightKg(item) {
  const configuredWeight = toNumber(item.weight_kg);
  const unitWeight = configuredWeight > 0 ? configuredWeight : extractWeightKg(item.product_name || item.name);
  return unitWeight * Math.max(1, toNumber(item.quantity, 1));
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

function googleDistanceDiagnostic(data, element) {
  const status = (element && element.status) || (data && data.status) || 'UNKNOWN_ERROR';
  const rawMessage = String((data && data.error_message) || status || '');
  const normalized = rawMessage.toLowerCase();
  const diagnostic = {
    service: 'Distance Matrix API',
    status,
    rawMessage,
    action: 'Check the Distance API Server Key, billing, API restrictions, and origin/destination addresses.',
  };

  if (status === 'REQUEST_DENIED') {
    if (normalized.includes('not authorized') || normalized.includes('not enabled') || normalized.includes('api has not been used')) {
      diagnostic.action = 'Enable Distance Matrix API for this Google Cloud project.';
    } else if (normalized.includes('billing')) {
      diagnostic.action = 'Enable billing for this Google Cloud project.';
    } else if (normalized.includes('referer') || normalized.includes('ip') || normalized.includes('restriction')) {
      diagnostic.action = 'Fix API key restrictions. The backend server key should allow Distance Matrix API and your server IP.';
    } else {
      diagnostic.action = 'Distance Matrix API request was denied. Enable Distance Matrix API and verify the server key restrictions.';
    }
  } else if (status === 'OVER_QUERY_LIMIT') {
    diagnostic.action = 'Distance Matrix API quota is exhausted. Increase quota or wait for quota reset.';
  } else if (status === 'OVER_DAILY_LIMIT') {
    diagnostic.action = 'Distance Matrix API daily limit or billing limit is reached. Check billing and quotas.';
  } else if (['INVALID_REQUEST', 'NOT_FOUND', 'ZERO_RESULTS'].includes(status)) {
    diagnostic.action = 'Check the test origin and destination addresses.';
  }

  return diagnostic;
}

async function settingValue(key) {
  try {
    const [rows] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1', [key]);
    return rows[0] && rows[0].setting_value ? String(rows[0].setting_value) : '';
  } catch {
    return '';
  }
}

async function googleDistanceApiKey() {
  return (await settingValue('google_distance_api_key'))
    || process.env.GOOGLE_DISTANCE_API_KEY
    || '';
}

async function googleDistanceKm(origin, destination) {
  const key = await googleDistanceApiKey();
  if (!key) {
    const error = new Error('Distance Matrix API failed: MISSING_KEY. Add a dedicated Distance API Server Key in Settings > Google Maps, or set GOOGLE_DISTANCE_API_KEY on the backend.');
    error.status = 422;
    error.googleDiagnostic = {
      service: 'Distance Matrix API',
      status: 'MISSING_KEY',
      rawMessage: 'Dedicated backend Distance Matrix API key is not configured.',
      action: 'Add a server key with Distance Matrix API enabled. Do not use the Android or browser map key for backend distance calculation.',
    };
    throw error;
  }
  if (!origin || !destination) {
    return { distanceKm: 0, source: 'missing_address' };
  }

  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', origin);
  url.searchParams.set('destinations', destination);
  url.searchParams.set('units', 'metric');
  url.searchParams.set('key', key);

  const data = await requestJson(url);
  const element = data && data.rows && data.rows[0] && data.rows[0].elements && data.rows[0].elements[0];
  if (!element || element.status !== 'OK' || !element.distance) {
    const diagnostic = googleDistanceDiagnostic(data, element);
    const error = new Error(`${diagnostic.service} failed: ${diagnostic.status}. ${diagnostic.action}`);
    error.status = 422;
    error.googleDiagnostic = diagnostic;
    throw error;
  }

  return {
    distanceKm: Number((Number(element.distance.value || 0) / 1000).toFixed(2)),
    source: 'google_distance_api',
    diagnostics: [
      {
        service: 'Distance Matrix API',
        ok: true,
        status: 'OK',
        action: 'Enabled and working for backend delivery distance.',
      },
    ],
  };
}

async function testDistance(origin, destination) {
  return googleDistanceKm(origin, destination);
}

function isAddressResolutionDistanceError(error) {
  const status = error && error.googleDiagnostic && error.googleDiagnostic.status;
  return ['INVALID_REQUEST', 'NOT_FOUND', 'ZERO_RESULTS'].includes(status);
}

async function listRules() {
  const [rows] = await pool.query(
    `SELECT *
     FROM delivery_charge_rules
     ORDER BY LOWER(city), min_weight_kg, COALESCE(max_weight_kg, 999999), id`
  );
  return rows.map(normalizeRule);
}

async function saveRule(data) {
  const id = Number(data.id || 0);
  const payload = {
    city: String(data.city || '').trim(),
    rule_name: String(data.rule_name || '').trim(),
    min_weight_kg: Math.max(0, toNumber(data.min_weight_kg)),
    max_weight_kg: data.max_weight_kg === '' || data.max_weight_kg === null || data.max_weight_kg === undefined
      ? null
      : Math.max(0, toNumber(data.max_weight_kg)),
    base_delivery_price: Math.max(0, toNumber(data.base_delivery_price)),
    price_per_km: Math.max(0, toNumber(data.price_per_km)),
    price_per_kg: Math.max(0, toNumber(data.price_per_kg)),
    additional_charge: Math.max(0, toNumber(data.additional_charge)),
    is_active: data.is_active === true || data.is_active === 'true' || data.is_active === '1' || data.is_active === 1,
  };

  if (!payload.city) {
    const error = new Error('City is required');
    error.status = 422;
    throw error;
  }
  if (payload.max_weight_kg !== null && payload.max_weight_kg <= payload.min_weight_kg) {
    const error = new Error('Maximum weight must be greater than minimum weight');
    error.status = 422;
    throw error;
  }

  if (id) {
    await pool.query(
      `UPDATE delivery_charge_rules
       SET city = ?, rule_name = ?, min_weight_kg = ?, max_weight_kg = ?,
           base_delivery_price = ?, price_per_km = ?, price_per_kg = ?,
           additional_charge = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        payload.city,
        payload.rule_name || null,
        payload.min_weight_kg,
        payload.max_weight_kg,
        payload.base_delivery_price,
        payload.price_per_km,
        payload.price_per_kg,
        payload.additional_charge,
        payload.is_active ? 1 : 0,
        id,
      ]
    );
    return id;
  }

  const [result] = await pool.query(
    `INSERT INTO delivery_charge_rules
     (city, rule_name, min_weight_kg, max_weight_kg, base_delivery_price, price_per_km, price_per_kg, additional_charge, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.city,
      payload.rule_name || null,
      payload.min_weight_kg,
      payload.max_weight_kg,
      payload.base_delivery_price,
      payload.price_per_km,
      payload.price_per_kg,
      payload.additional_charge,
      payload.is_active ? 1 : 0,
    ]
  );
  return result.insertId;
}

async function deleteRule(id) {
  await pool.query('DELETE FROM delivery_charge_rules WHERE id = ?', [id]);
}

async function matchingRule(city, totalWeightKg, connection = pool) {
  const [rows] = await connection.query(
    `SELECT *
     FROM delivery_charge_rules
     WHERE is_active = 1
       AND LOWER(TRIM(city)) = LOWER(TRIM(?))
       AND ? >= min_weight_kg
       AND (max_weight_kg IS NULL OR ? <= max_weight_kg)
     ORDER BY min_weight_kg DESC, COALESCE(max_weight_kg, 999999) ASC, id ASC
     LIMIT 1`,
    [city, totalWeightKg, totalWeightKg]
  );
  return normalizeRule(rows[0]);
}

async function calculateCharge({
  city,
  origin,
  destination,
  originLatitude,
  originLongitude,
  destinationLatitude,
  destinationLongitude,
  items = [],
  totalWeightKg,
}, connection = pool) {
  const weightKg = roundMoney(totalWeightKg === undefined ? items.reduce((sum, item) => sum + itemWeightKg(item), 0) : totalWeightKg);
  const rule = await matchingRule(city, weightKg, connection);
  if (!rule) {
    return {
      applicable: false,
      delivery_charge: 0,
      distance_km: 0,
      total_weight_kg: weightKg,
      rule: null,
      distance_source: 'no_matching_rule',
    };
  }

  const distanceOrigin = coordinateAddress(originLatitude, originLongitude) || origin;
  const distanceDestination = coordinateAddress(destinationLatitude, destinationLongitude) || destination;
  let distance;
  try {
    distance = await googleDistanceKm(distanceOrigin, distanceDestination);
  } catch (error) {
    if (!isAddressResolutionDistanceError(error)) {
      throw error;
    }
    distance = {
      distanceKm: 0,
      source: 'address_resolution_fallback',
      diagnostics: [
        {
          ...(error.googleDiagnostic || {}),
          ok: false,
          action: 'Delivery charge used the base/weight rule because Google could not resolve the pickup or delivery address.',
        },
      ],
    };
  }
  const charge = roundMoney(
    rule.base_delivery_price
      + (distance.distanceKm * rule.price_per_km)
      + (weightKg * rule.price_per_kg)
      + rule.additional_charge
  );

  return {
    applicable: true,
    delivery_charge: charge,
    distance_km: distance.distanceKm,
    total_weight_kg: weightKg,
    rule,
    distance_source: distance.source,
  };
}

module.exports = {
  listRules,
  saveRule,
  deleteRule,
  calculateCharge,
  testDistance,
  extractWeightKg,
  itemWeightKg,
};
