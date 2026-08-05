const pool = require('../db');

function normalize(row) {
  if (!row) return null;
  let serviceAreas = row.service_areas || [];
  if (typeof serviceAreas === 'string') {
    try { serviceAreas = JSON.parse(serviceAreas); } catch { serviceAreas = []; }
  }
  return {
    ...row,
    service_areas: Array.isArray(serviceAreas) ? serviceAreas : [],
    wallet_balance: Number(row.wallet_balance || 0),
    total_orders_delivered: Number(row.total_orders_delivered || 0),
    total_accepted_orders: Number(row.total_accepted_orders || 0),
    total_rejected_orders: Number(row.total_rejected_orders || 0),
    total_unaccepted_orders: Number(row.total_unaccepted_orders || 0),
    otp_conflict_count: Number(row.otp_conflict_count || 0),
    failed_delivery_attempts: Number(row.failed_delivery_attempts || 0),
    is_available: row.is_available === undefined || row.is_available === null ? true : Boolean(Number(row.is_available)),
    is_active: String(row.status || '').toLowerCase() === 'active',
  };
}

const summarySelect = `
  SELECT u.id, u.name, u.email AS login_id, u.phone, u.status, u.created_at, u.updated_at,
         COALESCE(p.city, (SELECT dps.city FROM delivery_partner_settings dps WHERE dps.user_id = u.id LIMIT 1), 'Unassigned') AS city,
         COALESCE(p.area, (SELECT dps.area FROM delivery_partner_settings dps WHERE dps.user_id = u.id LIMIT 1), '*') AS area,
         p.address, p.address_proof_id, p.address_proof_type, p.profile_image_path, p.vehicle_type,
         p.vehicle_number, p.document_notes, COALESCE(p.is_available, 1) AS is_available,
         p.current_latitude, p.current_longitude, COALESCE(NULLIF(w.balance::text, ''), '0')::numeric AS wallet_balance,
         COALESCE((
           SELECT JSON_AGG(JSON_BUILD_OBJECT('city', dps.city, 'area', dps.area) ORDER BY dps.city, dps.area)::text
           FROM delivery_partner_settings dps WHERE dps.user_id = u.id
         ), '[]') AS service_areas,
         COALESCE(stats.total_orders_delivered, 0) AS total_orders_delivered,
         COALESCE(stats.total_accepted_orders, 0) AS total_accepted_orders,
         COALESCE(logs.total_rejected_orders, 0) AS total_rejected_orders,
         COALESCE(logs.total_unaccepted_orders, 0) AS total_unaccepted_orders,
         COALESCE(logs.otp_conflict_count, 0) AS otp_conflict_count,
         COALESCE(logs.failed_delivery_attempts, 0) AS failed_delivery_attempts
  FROM users u
  LEFT JOIN delivery_person_profiles p ON p.user_id = u.id
  LEFT JOIN wallets w ON w.user_id = u.id
  LEFT JOIN (
    SELECT delivery_partner_id,
           COUNT(*) FILTER (WHERE status IN ('delivered', 'completed') OR delivery_status = 'delivered') AS total_orders_delivered,
           COUNT(*) FILTER (WHERE delivery_status IN ('ready_to_deliver', 'out_for_delivery', 'delivered')) AS total_accepted_orders
    FROM client_orders WHERE delivery_partner_id IS NOT NULL GROUP BY delivery_partner_id
  ) stats ON stats.delivery_partner_id::text = u.id::text
  LEFT JOIN (
    SELECT delivery_person_id,
           COUNT(*) FILTER (WHERE action = 'order_rejected') AS total_rejected_orders,
           COUNT(*) FILTER (WHERE action = 'order_unaccepted') AS total_unaccepted_orders,
           COUNT(*) FILTER (WHERE action = 'otp_conflict') AS otp_conflict_count,
           COUNT(*) FILTER (WHERE action = 'delivery_failed') AS failed_delivery_attempts
    FROM delivery_person_activity_logs GROUP BY delivery_person_id
  ) logs ON logs.delivery_person_id::text = u.id::text`;

async function list({ page = 1, limit = 12, search = '', city = '', status = '', vehicleType = '' } = {}) {
  const currentPage = Math.max(Number(page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(limit) || 12, 1), 100);
  const where = ["u.is_deleted = 0", "LOWER(u.role) IN ('deliveryperson', 'delivery', 'delivery_partner', 'delivery_person', 'rider')"];
  const values = [];
  if (search) {
    values.push(`%${search}%`);
    where.push(`(u.name ILIKE $${values.length} OR u.email ILIKE $${values.length} OR u.phone ILIKE $${values.length} OR CAST(u.id AS TEXT) ILIKE $${values.length})`);
  }
  if (city) {
    values.push(city);
    where.push(`(LOWER(TRIM(COALESCE(p.city, (SELECT dps.city FROM delivery_partner_settings dps WHERE dps.user_id = u.id LIMIT 1), ''))) = LOWER(TRIM($${values.length})))`);
  }
  if (status) { values.push(status); where.push(`LOWER(u.status) = LOWER($${values.length})`); }
  if (vehicleType) { values.push(vehicleType); where.push(`p.vehicle_type = $${values.length}`); }
  const whereSql = where.join(' AND ');
  const { rows: countRows } = await pool.query(`SELECT COUNT(*) AS total FROM users u LEFT JOIN delivery_person_profiles p ON p.user_id = u.id WHERE ${whereSql}`, values);
  const { rows } = await pool.query(`${summarySelect} WHERE ${whereSql} ORDER BY u.created_at DESC, u.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (currentPage - 1) * pageSize]);
  const total = Number(countRows[0].total || 0);
  return { deliveryPersons: rows.map(normalize), pagination: { page: currentPage, limit: pageSize, total, totalPages: Math.max(Math.ceil(total / pageSize), 1) } };
}

async function findById(id) {
  const { rows } = await pool.query(`${summarySelect} WHERE u.id = $1 AND u.is_deleted = 0 AND LOWER(u.role) IN ('deliveryperson', 'delivery', 'delivery_partner', 'delivery_person', 'rider') LIMIT 1`, [id]);
  return normalize(rows[0]);
}

async function orders(id, limit = 50) {
  const { rows } = await pool.query(
    `SELECT id, order_number, client_name, total_amount, status, delivery_status, assigned_at, ready_at, delivered_at, created_at
     FROM client_orders WHERE delivery_partner_id = $1 ORDER BY created_at DESC LIMIT $2`, [id, limit]
  );
  return rows;
}

async function offers(id, limit = 100) {
  const { rows } = await pool.query(
    `SELECT dof.*, co.order_number, co.client_name, co.shipping_area, co.shipping_city, co.total_amount
     FROM delivery_order_offers dof
     INNER JOIN client_orders co ON co.id = dof.order_id
     WHERE dof.delivery_person_id = $1
     ORDER BY dof.created_at DESC, dof.id DESC
     LIMIT $2`,
    [id, limit]
  );
  return rows;
}

async function activity(id, limit = 100) {
  const { rows } = await pool.query(
    `SELECT l.*, a.name AS actor_name FROM delivery_person_activity_logs l
     LEFT JOIN users a ON a.id = l.actor_id WHERE l.delivery_person_id = $1
     ORDER BY l.created_at DESC, l.id DESC LIMIT $2`, [id, limit]
  );
  return rows;
}

async function log({ deliveryPersonId, actorId = null, action, description, metadata = null }, connection = pool) {
  await connection.query(
    `INSERT INTO delivery_person_activity_logs (delivery_person_id, actor_id, action, description, metadata)
     VALUES ($1, $2, $3, $4, $5)`, [deliveryPersonId, actorId, action, description, metadata ? JSON.stringify(metadata) : null]
  );
}

async function upsertProfile(id, data, connection = pool) {
  const requestedAreas = Array.isArray(data.delivery_areas) ? data.delivery_areas : [];
  const serviceAreas = requestedAreas
    .map((entry) => ({
      city: String(entry && entry.city || '').trim(),
      area: String(entry && (entry.area || entry.name) || '').trim(),
    }))
    .filter((entry) => entry.city && entry.area);
  const primary = serviceAreas[0] || {
    city: String(data.city || '').trim(),
    area: String(data.area || data.location_area || data.service_area || '*').trim() || '*',
  };
  const area = primary.area;
  const isAvailable = data.is_available === false || String(data.is_available).toLowerCase() === 'false' || String(data.availability_status || '').toLowerCase() === 'unavailable' ? 0 : 1;

  const { rows: existingRows } = await connection.query(
    'SELECT id FROM delivery_person_profiles WHERE user_id = $1 LIMIT 1',
    [id]
  );

  if (existingRows && existingRows.length > 0) {
    await connection.query(
      `UPDATE delivery_person_profiles SET
        city = COALESCE($1, city),
        area = COALESCE($2, area),
        address = COALESCE($3, address),
        address_proof_id = COALESCE($4, address_proof_id),
        address_proof_type = COALESCE($5, address_proof_type),
        vehicle_type = COALESCE($6, vehicle_type),
        vehicle_number = COALESCE($7, vehicle_number),
        document_notes = COALESCE($8, document_notes),
        is_available = $9,
        current_latitude = COALESCE($10, current_latitude),
        current_longitude = COALESCE($11, current_longitude),
        updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $12`,
      [
        primary.city || null,
        area || '*',
        data.address || null,
        data.address_proof_id || null,
        data.address_proof_type || null,
        data.vehicle_type || null,
        data.vehicle_number || null,
        data.document_notes || null,
        isAvailable,
        data.current_latitude || data.latitude || null,
        data.current_longitude || data.longitude || null,
        id,
      ]
    );
  } else {
    await connection.query(
      `INSERT INTO delivery_person_profiles
        (user_id, city, area, address, address_proof_id, address_proof_type, vehicle_type, vehicle_number, document_notes, is_available, current_latitude, current_longitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        primary.city || null,
        area || '*',
        data.address || null,
        data.address_proof_id || null,
        data.address_proof_type || null,
        data.vehicle_type || null,
        data.vehicle_number || null,
        data.document_notes || null,
        isAvailable,
        data.current_latitude || data.latitude || null,
        data.current_longitude || data.longitude || null,
      ]
    );
  }

  if (primary.city) {
    await connection.query('DELETE FROM delivery_partner_settings WHERE user_id = $1', [id]);
    const assignments = serviceAreas.length ? serviceAreas : [primary];
    const seen = new Set();
    for (const entry of assignments) {
      const key = `${entry.city.toLowerCase()}::${entry.area.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await connection.query(
        'INSERT INTO delivery_partner_settings (user_id, city, area, is_active) VALUES ($1, $2, $3, $4)',
        [id, entry.city, entry.area, data.status === 'blocked' ? 0 : 1]
      );
    }
  }
}

module.exports = { list, findById, orders, offers, activity, log, upsertProfile };
