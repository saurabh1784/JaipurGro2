const pool = require('../db');

function parsePolygon(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizePoint(point) {
  if (!point || typeof point !== 'object') return null;
  const lat = Number(point.lat ?? point.latitude);
  const lng = Number(point.lng ?? point.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function normalizeArea(row) {
  const polygon = parsePolygon(row.polygon);
  return {
    id: row.id,
    name: row.name || '',
    city: row.city || '',
    polygon,
    center_lat: row.center_lat === null || row.center_lat === undefined ? null : Number(row.center_lat),
    center_lng: row.center_lng === null || row.center_lng === undefined ? null : Number(row.center_lng),
    platform_fee: Number(row.platform_fee || 0),
    delivery_charge: Number(row.delivery_charge || 0),
    order_commission_percentage: Number(row.order_commission_percentage || 0),
    delivery_commission_percentage: Number(row.delivery_commission_percentage || 0),
    own_delivery_active: Boolean(row.own_delivery_active),
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function money(value) {
  return Number(Math.max(Number(value || 0), 0).toFixed(2));
}

function pointInPolygon(point, polygon) {
  const normalizedPoint = normalizePoint(point);
  const vertices = parsePolygon(polygon).map(normalizePoint).filter(Boolean);
  if (!normalizedPoint || vertices.length < 3) return false;

  const x = normalizedPoint.lng;
  const y = normalizedPoint.lat;
  let inside = false;

  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].lng;
    const yi = vertices[i].lat;
    const xj = vertices[j].lng;
    const yj = vertices[j].lat;
    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }

  return inside;
}

async function list({ includeInactive = false } = {}) {
  const [rows] = await pool.query(
    `SELECT *
     FROM area_definitions
     ${includeInactive ? '' : 'WHERE is_active = 1'}
     ORDER BY city, name`
  );
  return rows.map(normalizeArea);
}

async function findMatchingArea({ latitude, longitude, city = '', area = '' } = {}, connection = pool) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const cityValue = String(city || '').trim();
  const areaValue = String(area || '').trim();
  const params = [];
  let cityFilter = '';

  if (cityValue) {
    cityFilter = 'AND (city IS NULL OR TRIM(city) = \'\' OR LOWER(TRIM(city)) = LOWER(TRIM(?)))';
    params.push(cityValue);
  }

  const [rows] = await connection.query(
    `SELECT *
     FROM area_definitions
     WHERE is_active = 1
       ${cityFilter}
     ORDER BY own_delivery_active DESC, city, name`,
    params
  );

  const areas = rows.map(normalizeArea);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const match = areas.find((candidate) => pointInPolygon({ lat, lng }, candidate.polygon));
    if (match) return match;
  }

  if (areaValue) {
    const textMatch = areas.find((candidate) => candidate.name.toLowerCase() === areaValue.toLowerCase());
    if (textMatch) return textMatch;
  }

  return null;
}

async function save(payload) {
  const id = Number(payload.id || 0);
  const name = String(payload.name || '').trim();
  const city = String(payload.city || '').trim();
  const polygon = parsePolygon(payload.polygon).map(normalizePoint).filter(Boolean);
  const ownDeliveryActive = payload.own_delivery_active || payload.ownDeliveryActive ? 1 : 0;
  const isActive = payload.is_active === undefined || payload.is_active || payload.isActive ? 1 : 0;
  const platformFee = money(payload.platform_fee);
  const deliveryCharge = money(payload.delivery_charge);
  const orderCommissionPercentage = Math.min(money(payload.order_commission_percentage), 100);
  const deliveryCommissionPercentage = Math.min(money(payload.delivery_commission_percentage), 100);

  if (name.length < 2) {
    const error = new Error('Area name is required');
    error.status = 422;
    throw error;
  }
  if (polygon.length < 3) {
    const error = new Error('Mark at least three points on the map');
    error.status = 422;
    throw error;
  }

  const center = polygon.reduce(
    (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
    { lat: 0, lng: 0 }
  );
  const centerLat = center.lat / polygon.length;
  const centerLng = center.lng / polygon.length;

  if (id) {
    const [result] = await pool.query(
      `UPDATE area_definitions
       SET name = ?, city = ?, polygon = ?, center_lat = ?, center_lng = ?,
           platform_fee = ?, delivery_charge = ?, order_commission_percentage = ?, delivery_commission_percentage = ?,
           own_delivery_active = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        name,
        city || null,
        JSON.stringify(polygon),
        centerLat,
        centerLng,
        platformFee,
        deliveryCharge,
        orderCommissionPercentage,
        deliveryCommissionPercentage,
        ownDeliveryActive,
        isActive,
        id,
      ]
    );
    if (result.affectedRows === 0) {
      const error = new Error('Area not found');
      error.status = 404;
      throw error;
    }
    return id;
  }

  const [result] = await pool.query(
    `INSERT INTO area_definitions
     (name, city, polygon, center_lat, center_lng, platform_fee, delivery_charge, order_commission_percentage, delivery_commission_percentage, own_delivery_active, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      city || null,
      JSON.stringify(polygon),
      centerLat,
      centerLng,
      platformFee,
      deliveryCharge,
      orderCommissionPercentage,
      deliveryCommissionPercentage,
      ownDeliveryActive,
      isActive,
    ]
  );
  return result.insertId;
}

async function pricingForLocation(location = {}, connection = pool) {
  const area = await findMatchingArea(location, connection);
  return {
    area,
    area_definition_id: area ? area.id : null,
    area_name: area ? area.name : String(location.area || ''),
    city: area ? area.city : String(location.city || ''),
    platform_fee: area ? money(area.platform_fee) : 0,
    delivery_charge: area ? money(area.delivery_charge) : null,
    order_commission_percentage: area ? money(area.order_commission_percentage) : null,
    delivery_commission_percentage: area ? money(area.delivery_commission_percentage) : null,
  };
}

async function remove(id) {
  const [result] = await pool.query('DELETE FROM area_definitions WHERE id = ?', [id]);
  if (result.affectedRows === 0) {
    const error = new Error('Area not found');
    error.status = 404;
    throw error;
  }
}

async function isOwnDeliveryActiveForLocation(location = {}, connection = pool) {
  const area = await findMatchingArea(location, connection);
  return { active: Boolean(area && area.own_delivery_active), area };
}

module.exports = {
  findMatchingArea,
  isOwnDeliveryActiveForLocation,
  list,
  normalizeArea,
  pointInPolygon,
  pricingForLocation,
  remove,
  save,
};
