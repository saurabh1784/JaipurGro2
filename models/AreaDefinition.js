const pool = require('../db');

function parsePolygon(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed && parsed.type === 'Polygon' && Array.isArray(parsed.coordinates)) {
      return (parsed.coordinates[0] || []).map((point) => ({ lng: point[0], lat: point[1] }));
    }
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizePoint(point) {
  if (!point || typeof point !== 'object') return null;
  const lat = Number(point.lat ?? point.latitude ?? (Array.isArray(point) ? point[1] : null));
  const lng = Number(point.lng ?? point.longitude ?? (Array.isArray(point) ? point[0] : null));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function normalizePolygon(value) {
  const points = parsePolygon(value).map(normalizePoint).filter(Boolean);
  if (points.length > 3) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) points.pop();
  }
  return points;
}

function polygonGeoJson(polygon) {
  const points = normalizePolygon(polygon);
  if (points.length < 3) return null;
  const ring = points.map((point) => [point.lng, point.lat]);
  ring.push([...ring[0]]);
  return { type: 'Polygon', coordinates: [ring] };
}

function normalizeArea(row) {
  const polygon = normalizePolygon(row.boundary_geojson || row.polygon);
  const boundaryStatus = row.boundary_status || (polygon.length >= 3 ? 'created' : 'not_created');
  return {
    id: Number(row.id),
    country_id: row.country_id ? Number(row.country_id) : null,
    state_id: row.state_id ? Number(row.state_id) : null,
    city_id: row.city_id ? Number(row.city_id) : null,
    country: row.country_name || row.country || '',
    state: row.state_name || row.state || '',
    city: row.city_name || row.city || '',
    name: row.name || '',
    code: row.code || '',
    description: row.description || '',
    polygon,
    boundary_geojson: polygonGeoJson(polygon),
    boundary_status: boundaryStatus,
    boundary_status_label: boundaryStatus === 'created' ? 'Boundary created' : boundaryStatus === 'needs_update' ? 'Boundary needs update' : 'Boundary not created',
    center_lat: row.center_lat == null ? null : Number(row.center_lat),
    center_lng: row.center_lng == null ? null : Number(row.center_lng),
    platform_fee: Number(row.platform_fee || 0),
    delivery_charge: Number(row.delivery_charge || 0),
    order_commission_percentage: Number(row.order_commission_percentage || 0),
    delivery_commission_percentage: Number(row.delivery_commission_percentage || 0),
    cod_enabled: Boolean(row.cod_enabled),
    delivery_enabled: row.delivery_enabled === undefined ? true : Boolean(row.delivery_enabled),
    own_delivery_active: Boolean(row.own_delivery_active),
    is_active: Boolean(row.is_active),
    created_by: row.created_by ? Number(row.created_by) : null,
    updated_by: row.updated_by ? Number(row.updated_by) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function money(value) {
  return Number(Math.max(Number(value || 0), 0).toFixed(2));
}

function pointInPolygon(point, polygon) {
  const normalizedPoint = normalizePoint(point);
  const vertices = normalizePolygon(polygon);
  if (!normalizedPoint || vertices.length < 3) return false;
  const x = normalizedPoint.lng;
  const y = normalizedPoint.lat;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].lng;
    const yi = vertices[i].lat;
    const xj = vertices[j].lng;
    const yj = vertices[j].lat;
    const intersects = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

async function resolveHierarchy(payload, connection = pool) {
  const cityId = Number(payload.city_id || payload.cityId || 0);
  const cityName = String(payload.city || '').trim();
  const params = [];
  let where = '';
  if (cityId) {
    where = 'ci.id = ?';
    params.push(cityId);
  } else if (cityName) {
    where = 'LOWER(TRIM(ci.name)) = LOWER(TRIM(?))';
    params.push(cityName);
  } else {
    const error = new Error('Select a city before saving the area');
    error.status = 422;
    throw error;
  }
  if (payload.state_id || payload.stateId) {
    where += ' AND s.id = ?';
    params.push(Number(payload.state_id || payload.stateId));
  }
  if (payload.country_id || payload.countryId) {
    where += ' AND c.id = ?';
    params.push(Number(payload.country_id || payload.countryId));
  }
  const [rows] = await connection.query(
    `SELECT ci.id AS city_id, ci.name AS city_name, ci.is_active AS city_active,
            s.id AS state_id, s.name AS state_name, s.is_active AS state_active,
            c.id AS country_id, c.name AS country_name, c.is_active AS country_active
     FROM cities ci
     INNER JOIN states s ON s.id = ci.state_id
     INNER JOIN countries c ON c.id = s.country_id
     WHERE ${where}
     LIMIT 1`,
    params
  );
  if (!rows.length) {
    const error = new Error('Selected country, state and city combination is invalid');
    error.status = 422;
    throw error;
  }
  return rows[0];
}

function areaSelect() {
  return `SELECT ad.*, c.name AS country_name, s.name AS state_name, ci.name AS city_name
          FROM area_definitions ad
          LEFT JOIN countries c ON c.id = ad.country_id
          LEFT JOIN states s ON s.id = ad.state_id
          LEFT JOIN cities ci ON ci.id = ad.city_id`;
}

async function list({ includeInactive = false, countryId, stateId, cityId, country, state, city, search, status, adminCity } = {}, connection = pool) {
  const where = [];
  const params = [];
  if (!includeInactive) where.push('ad.is_active = 1');
  if (countryId) { where.push('ad.country_id = ?'); params.push(Number(countryId)); }
  if (stateId) { where.push('ad.state_id = ?'); params.push(Number(stateId)); }
  if (cityId) { where.push('ad.city_id = ?'); params.push(Number(cityId)); }
  if (country) { where.push('LOWER(TRIM(c.name)) = LOWER(TRIM(?))'); params.push(country); }
  if (state) { where.push('LOWER(TRIM(s.name)) = LOWER(TRIM(?))'); params.push(state); }
  if (city) { where.push('LOWER(TRIM(COALESCE(ci.name, ad.city))) = LOWER(TRIM(?))'); params.push(city); }
  if (adminCity) { where.push('LOWER(TRIM(COALESCE(ci.name, ad.city))) = LOWER(TRIM(?))'); params.push(adminCity); }
  if (search) { where.push('(ad.name ILIKE ? OR ad.code ILIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (status === 'active') where.push('ad.is_active = 1');
  if (status === 'inactive') where.push('ad.is_active = 0');
  const [rows] = await connection.query(
    `${areaSelect()} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY c.name, s.name, COALESCE(ci.name, ad.city), ad.name`,
    params
  );
  return rows.map(normalizeArea);
}

async function findById(id, connection = pool) {
  const [rows] = await connection.query(`${areaSelect()} WHERE ad.id = ? LIMIT 1`, [id]);
  return rows.length ? normalizeArea(rows[0]) : null;
}

async function findMatchingArea({ latitude, longitude, city = '', area = '' } = {}, connection = pool) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const areas = await list({ includeInactive: false, city: String(city || '').trim() || undefined }, connection);
  const selectable = areas.filter((candidate) => candidate.delivery_enabled && candidate.boundary_status === 'created');
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const match = selectable.find((candidate) => pointInPolygon({ lat, lng }, candidate.polygon));
    if (match) return match;
  }
  const areaValue = String(area || '').trim();
  if (areaValue) return areas.find((candidate) => candidate.delivery_enabled && candidate.name.toLowerCase() === areaValue.toLowerCase()) || null;
  return null;
}

async function save(payload, actor = {}, connection = pool) {
  const id = Number(payload.id || 0);
  const name = String(payload.name || '').trim().replace(/\s+/g, ' ');
  let code = String(payload.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const hierarchy = await resolveHierarchy(payload, connection);
  const existing = id ? await findById(id, connection) : null;
  if (name.length < 2) { const error = new Error('Area name is required'); error.status = 422; throw error; }
  if (!code && existing && existing.code) code = existing.code;
  if (!code) code = `${hierarchy.city_name}-${name}`.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  if (code.length < 2) { const error = new Error('Area code is required'); error.status = 422; throw error; }
  const [duplicateRows] = await connection.query(
    `SELECT id FROM area_definitions
     WHERE id <> ? AND (UPPER(TRIM(code)) = UPPER(TRIM(?)) OR (city_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))))
     LIMIT 1`,
    [id, code, hierarchy.city_id, name]
  );
  if (duplicateRows.length) { const error = new Error('Area code must be unique and area name must be unique inside the selected city'); error.status = 409; throw error; }
  const polygonProvided = payload.polygon !== undefined || payload.boundary_geojson !== undefined || payload.boundaryGeojson !== undefined;
  const polygon = polygonProvided ? normalizePolygon(payload.boundary_geojson || payload.boundaryGeojson || payload.polygon) : (existing ? existing.polygon : []);
  if (polygonProvided && polygon.length > 0 && polygon.length < 3) { const error = new Error('Please draw a valid polygon with at least three points.'); error.status = 422; throw error; }
  const center = polygon.length ? polygon.reduce((sum, point) => ({ lat: sum.lat + point.lat, lng: sum.lng + point.lng }), { lat: 0, lng: 0 }) : null;
  const centerLat = center ? center.lat / polygon.length : null;
  const centerLng = center ? center.lng / polygon.length : null;
  const requestedBoundaryStatus = String(payload.boundary_status || payload.boundaryStatus || '').trim();
  const boundaryStatus = polygon.length >= 3 ? (requestedBoundaryStatus === 'needs_update' ? 'needs_update' : 'created') : 'not_created';
  const isActive = payload.is_active === undefined && payload.isActive === undefined ? 1 : (payload.is_active || payload.isActive ? 1 : 0);
  const deliveryEnabled = payload.delivery_enabled === undefined && payload.deliveryEnabled === undefined ? 1 : (payload.delivery_enabled || payload.deliveryEnabled ? 1 : 0);
  const values = [
    hierarchy.country_id, hierarchy.state_id, hierarchy.city_id, name, code, String(payload.description || '').trim() || null,
    hierarchy.city_name, JSON.stringify(polygon), JSON.stringify(polygonGeoJson(polygon)), boundaryStatus, centerLat, centerLng,
    money(payload.platform_fee), money(payload.delivery_charge), Math.min(money(payload.order_commission_percentage), 100),
    Math.min(money(payload.delivery_commission_percentage), 100), payload.cod_enabled || payload.codEnabled ? 1 : 0,
    deliveryEnabled, payload.own_delivery_active || payload.ownDeliveryActive ? 1 : 0, isActive,
  ];
  if (id) {
    const [result] = await connection.query(
      `UPDATE area_definitions SET country_id=?, state_id=?, city_id=?, name=?, code=?, description=?, city=?, polygon=?, boundary_geojson=?, boundary_status=?, center_lat=?, center_lng=?, platform_fee=?, delivery_charge=?, order_commission_percentage=?, delivery_commission_percentage=?, cod_enabled=?, delivery_enabled=?, own_delivery_active=?, is_active=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [...values, actor.id || null, id]
    );
    if (!Number(result.affectedRows ?? result.rowCount ?? 0)) { const error = new Error('Area not found'); error.status = 404; throw error; }
    await require('../services/deliveryPricingService').ensureAreaRules(id, connection);
    return id;
  }
  const [result] = await connection.query(
    `INSERT INTO area_definitions (country_id,state_id,city_id,name,code,description,city,polygon,boundary_geojson,boundary_status,center_lat,center_lng,platform_fee,delivery_charge,order_commission_percentage,delivery_commission_percentage,cod_enabled,delivery_enabled,own_delivery_active,is_active,created_by,updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [...values, actor.id || null, actor.id || null]
  );
  await require('../services/deliveryPricingService').ensureAreaRules(result.insertId, connection);
  return result.insertId;
}

async function saveBoundary(id, boundary, actor = {}, connection = pool) {
  const polygon = normalizePolygon(boundary);
  if (polygon.length < 3) { const error = new Error('Please draw a valid polygon with at least three points.'); error.status = 422; throw error; }
  const center = polygon.reduce((sum, point) => ({ lat: sum.lat + point.lat, lng: sum.lng + point.lng }), { lat: 0, lng: 0 });
  const [result] = await connection.query(
    `UPDATE area_definitions SET polygon=?, boundary_geojson=?, boundary_status='created', center_lat=?, center_lng=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [JSON.stringify(polygon), JSON.stringify(polygonGeoJson(polygon)), center.lat / polygon.length, center.lng / polygon.length, actor.id || null, id]
  );
  if (!Number(result.affectedRows ?? result.rowCount ?? 0)) { const error = new Error('Area not found'); error.status = 404; throw error; }
  return findById(id, connection);
}

async function removeBoundary(id, actor = {}, connection = pool) {
  const [result] = await connection.query(
    `UPDATE area_definitions SET polygon='[]', boundary_geojson=NULL, boundary_status='not_created', center_lat=NULL, center_lng=NULL, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [actor.id || null, id]
  );
  if (!Number(result.affectedRows ?? result.rowCount ?? 0)) { const error = new Error('Area not found'); error.status = 404; throw error; }
}

async function setActive(id, isActive, actor = {}, connection = pool) {
  const [result] = await connection.query('UPDATE area_definitions SET is_active=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [isActive ? 1 : 0, actor.id || null, id]);
  if (!Number(result.affectedRows ?? result.rowCount ?? 0)) { const error = new Error('Area not found'); error.status = 404; throw error; }
}

async function linkedRecordCounts(area, connection = pool) {
  const params = [area.city, area.name];
  const [rows] = await connection.query(
    `SELECT
      (SELECT COUNT(*) FROM vendor_profiles WHERE LOWER(TRIM(city))=LOWER(TRIM(?)) AND LOWER(TRIM(area))=LOWER(TRIM(?))) AS vendors,
      (SELECT COUNT(*) FROM client_profiles WHERE LOWER(TRIM(city))=LOWER(TRIM(?)) AND LOWER(TRIM(area))=LOWER(TRIM(?))) AS clients,
      (SELECT COUNT(*) FROM client_orders WHERE LOWER(TRIM(COALESCE(shipping_city,'')))=LOWER(TRIM(?)) AND LOWER(TRIM(COALESCE(shipping_area,'')))=LOWER(TRIM(?))) AS orders,
      (SELECT COUNT(*) FROM delivery_type_area_settings WHERE LOWER(TRIM(city))=LOWER(TRIM(?)) AND LOWER(TRIM(area))=LOWER(TRIM(?)) AND is_active=1) AS settings`,
    [...params, ...params, ...params, ...params]
  );
  return Object.fromEntries(Object.entries(rows[0] || {}).map(([key, value]) => [key, Number(value || 0)]));
}

async function remove(id, { force = false } = {}, connection = pool) {
  const area = await findById(id, connection);
  if (!area) { const error = new Error('Area not found'); error.status = 404; throw error; }
  const links = await linkedRecordCounts(area, connection);
  if (!force && Object.values(links).some((count) => count > 0)) {
    const error = new Error('Area is linked with active vendors, clients, orders, or settings. Confirm deletion to continue.');
    error.status = 409;
    error.links = links;
    throw error;
  }
  await connection.query('DELETE FROM area_delivery_rules WHERE area_definition_id = ?', [id]);
  await connection.query('DELETE FROM area_definitions WHERE id = ?', [id]);
  return links;
}

async function pricingForLocation(location = {}, connection = pool) {
  const area = await findMatchingArea(location, connection);
  return { area, area_definition_id: area ? area.id : null, area_name: area ? area.name : String(location.area || ''), city: area ? area.city : String(location.city || ''), platform_fee: area ? money(area.platform_fee) : 0, delivery_charge: area ? money(area.delivery_charge) : null, order_commission_percentage: area ? money(area.order_commission_percentage) : null, delivery_commission_percentage: area ? money(area.delivery_commission_percentage) : null, cod_enabled: Boolean(area && area.cod_enabled) };
}

async function isOwnDeliveryActiveForLocation(location = {}, connection = pool) {
  const area = await findMatchingArea(location, connection);
  return { active: Boolean(area && area.own_delivery_active), area };
}

module.exports = { findById, findMatchingArea, isOwnDeliveryActiveForLocation, linkedRecordCounts, list, normalizeArea, pointInPolygon, pricingForLocation, remove, removeBoundary, save, saveBoundary, setActive };

