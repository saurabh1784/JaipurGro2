const pool = require('../db');
const AreaDefinition = require('./AreaDefinition');
const DeliveryType = require('./DeliveryType');
const OrderWalletSettlement = require('../services/orderWalletSettlementService');
const DELIVERY_OTP_MAX_ATTEMPTS = 8;
const DELIVERY_OFFER_EXPIRY_MINUTES = Math.max(1, Number(process.env.DELIVERY_OFFER_EXPIRY_MINUTES || 30));
const NEARBY_BATCH_RADIUS_KM = 1;

const ORDER_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  PROCESSING: 'processing',
  READY_FOR_PICKUP: 'ready_for_pickup',
  PICKED_UP: 'picked_up',
  ON_THE_WAY: 'on_the_way',
  DELIVERED: 'delivered',
};

const STATUS_LABELS = {
  pending: 'Pending',
  accepted: 'Accepted',
  processing: 'Processing',
  ready_for_pickup: 'Ready for Pickup',
  picked_up: 'Picked Up',
  on_the_way: 'On the Way',
  delivered: 'Delivered',
  completed: 'Delivered',
};

const VENDOR_TRANSITIONS = {
  pending: ['accepted'],
  accepted: ['processing'],
  processing: ['ready_for_pickup'],
  ready_for_pickup: ['picked_up'],
  picked_up: ['on_the_way'],
};

const ADMIN_TRANSITIONS = {
  pending: ['accepted', 'processing', 'ready_for_pickup', 'picked_up', 'on_the_way', 'delivered'],
  accepted: ['processing', 'ready_for_pickup', 'picked_up', 'on_the_way', 'delivered'],
  processing: ['ready_for_pickup', 'picked_up', 'on_the_way', 'delivered'],
  ready_for_pickup: ['picked_up', 'on_the_way', 'delivered'],
  picked_up: ['on_the_way', 'delivered'],
  on_the_way: ['delivered'],
};

const DELIVERY_TRANSITIONS = {
  pending: ['on_the_way'],
  accepted: ['on_the_way'],
  processing: ['on_the_way'],
  ready_for_pickup: ['on_the_way'],
  picked_up: ['on_the_way'],
};

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'completed') return ORDER_STATUS.DELIVERED;
  return value;
}

function statusLabel(status) {
  return STATUS_LABELS[normalizeStatus(status)] || String(status || '').replace(/_/g, ' ');
}

function orderDisplayNumber(order) {
  return order.order_number || `ORD${Number(order.id || 0).toString(36).toUpperCase().padStart(7, '0').slice(-7)}`;
}

function validCoordinate(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function distanceKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  if (!validCoordinate(latitudeA, longitudeA) || !validCoordinate(latitudeB, longitudeB)) return null;
  const toRadians = (degrees) => Number(degrees) * Math.PI / 180;
  const latA = toRadians(latitudeA);
  const latB = toRadians(latitudeB);
  const latDelta = latB - latA;
  const lngDelta = toRadians(longitudeB) - toRadians(longitudeA);
  const haversine = Math.sin(latDelta / 2) ** 2
    + Math.cos(latA) * Math.cos(latB) * Math.sin(lngDelta / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

async function findNearbyBatchPartner(order, connection) {
  if (!validCoordinate(order.vendor_latitude, order.vendor_longitude)) return null;

  const [candidateRows] = await connection.query(
    `SELECT DISTINCT u.id, u.name, u.phone, p.area,
            busy.id AS source_order_id, busy.order_number AS source_order_number,
            busy.shipping_latitude, busy.shipping_longitude, busy.assigned_at
     FROM client_orders busy
     INNER JOIN users u ON u.id = busy.delivery_partner_id
     INNER JOIN delivery_person_profiles p ON p.user_id = u.id
     INNER JOIN delivery_order_offers accepted_offer
       ON accepted_offer.order_id = busy.id
      AND accepted_offer.delivery_person_id = busy.delivery_partner_id
      AND accepted_offer.status = 'accepted'
      AND (accepted_offer.response_note IS NULL OR accepted_offer.response_note NOT LIKE 'Automatically batched:%')
     WHERE busy.id <> ?
       AND busy.delivery_status IN ('assigned', 'ready_to_deliver')
       AND LOWER(COALESCE(busy.status, '')) NOT IN ('picked_up', 'on_the_way', 'delivered', 'completed', 'cancelled', 'canceled')
       AND busy.shipping_latitude IS NOT NULL
       AND busy.shipping_longitude IS NOT NULL
       AND COALESCE(p.is_available, 1) = 1
       AND u.is_deleted = 0
       AND LOWER(u.status) = 'active'
       AND ${deliveryRoleSql('u')}
     ORDER BY busy.assigned_at DESC NULLS LAST, busy.id DESC
     LIMIT 100`,
    [order.id]
  );

  const nearby = candidateRows
    .map((candidate) => ({
      ...candidate,
      batch_distance_km: distanceKm(
        order.vendor_latitude,
        order.vendor_longitude,
        candidate.shipping_latitude,
        candidate.shipping_longitude
      ),
    }))
    .filter((candidate) => candidate.batch_distance_km !== null
      && candidate.batch_distance_km <= NEARBY_BATCH_RADIUS_KM)
    .sort((left, right) => left.batch_distance_km - right.batch_distance_km);

  for (const candidate of nearby) {
    const [lockedRows] = await connection.query(
      `SELECT busy.id
       FROM client_orders busy
       WHERE busy.id = ?
         AND busy.delivery_partner_id = ?
         AND busy.delivery_status IN ('assigned', 'ready_to_deliver')
         AND LOWER(COALESCE(busy.status, '')) NOT IN ('picked_up', 'on_the_way', 'delivered', 'completed', 'cancelled', 'canceled')
         AND EXISTS (
           SELECT 1 FROM delivery_order_offers accepted_offer
           WHERE accepted_offer.order_id = busy.id
             AND accepted_offer.delivery_person_id = busy.delivery_partner_id
             AND accepted_offer.status = 'accepted'
             AND (accepted_offer.response_note IS NULL OR accepted_offer.response_note NOT LIKE 'Automatically batched:%')
         )
       FOR UPDATE`,
      [candidate.source_order_id, candidate.id]
    );
    if (lockedRows.length) return candidate;
  }
  return null;
}

function normalizeOrder(row, includeItems = false) {
  if (!row) return null;
  const order = {
    id: row.id,
    order_number: row.order_number || '',
    user_id: row.user_id,
    vendor_id: row.vendor_id || null,
    client_name: row.client_name || '',
    client_phone: row.client_phone || '',
    client_address: row.client_address || '',
    client_city: row.client_city || '',
    shipping_address_id: row.shipping_address_id || null,
    shipping_name: row.shipping_name || row.client_name || '',
    shipping_phone: row.shipping_phone || row.client_phone || '',
    shipping_address: row.shipping_address || row.client_address || '',
    shipping_area: row.shipping_area || '',
    shipping_city: row.shipping_city || '',
    shipping_state: row.shipping_state || '',
    shipping_country: row.shipping_country || '',
    shipping_pincode: row.shipping_pincode || '',
    shipping_latitude: row.shipping_latitude === null || row.shipping_latitude === undefined ? null : Number(row.shipping_latitude),
    shipping_longitude: row.shipping_longitude === null || row.shipping_longitude === undefined ? null : Number(row.shipping_longitude),
    vendor_name: row.vendor_name || '',
    vendor_email: row.vendor_email || '',
    vendor_phone: row.vendor_phone || '',
    vendor_business_name: row.vendor_business_name || '',
    vendor_gst_number: row.vendor_gst_number || '',
    vendor_signature_path: row.vendor_signature_path || '',
    vendor_address: row.vendor_address || '',
    pickup_latitude: row.pickup_latitude === null || row.pickup_latitude === undefined ? null : Number(row.pickup_latitude),
    pickup_longitude: row.pickup_longitude === null || row.pickup_longitude === undefined ? null : Number(row.pickup_longitude),
    vendor_country: row.vendor_country || '',
    vendor_state: row.vendor_state || '',
    vendor_city: row.vendor_city || '',
    vendor_services: row.vendor_services || '',
    subtotal_amount: Number(row.subtotal_amount || row.total_amount || 0),
    discount_amount: Number(row.discount_amount || 0),
    savings_amount: Number(row.savings_amount || row.discount_amount || 0),
    delivery_charge: Number(row.delivery_charge || 0),
    platform_charge: Number(row.platform_charge || 0),
    vendor_earning: Number(row.vendor_earning || 0),
    delivery_earning: Number(row.delivery_earning || 0),
    wallet_settled_at: row.wallet_settled_at,
    delivery_wallet_settled_at: row.delivery_wallet_settled_at,
    coupon_id: row.coupon_id || null,
    coupon_code: row.coupon_code || '',
    discount_id: row.discount_id || null,
    discount_label: row.discount_label || '',
    order_type: row.order_type || 'direct',
    invoice_number: row.invoice_number || '',
    invoice_pdf_path: row.invoice_pdf_path || '',
    invoice_generated_at: row.invoice_generated_at,
    total_amount: Number(row.total_amount || 0),
    status: normalizeStatus(row.status),
    status_label: statusLabel(row.status),
    delivery_status: row.delivery_status || 'pending',
    delivery_method: row.delivery_method || 'partner',
    delivery_type: row.delivery_type || DeliveryType.typeForMethod(row.delivery_method || 'partner'),
    delivery_partner_id: row.delivery_partner_id || null,
    external_delivery_provider_id: row.external_delivery_provider_id || null,
    external_delivery_provider_name: row.external_delivery_provider_name || '',
    delivery_partner_name: row.external_delivery_provider_name || (row.delivery_method === 'own_delivery' ? 'Own Delivery' : row.delivery_partner_name || ''),
    delivery_otp: row.delivery_otp || '',
    delivery_otp_attempts: Number(row.delivery_otp_attempts || 0),
    delivery_otp_max_attempts: DELIVERY_OTP_MAX_ATTEMPTS,
    delivery_otp_remaining_attempts: Math.max(DELIVERY_OTP_MAX_ATTEMPTS - Number(row.delivery_otp_attempts || 0), 0),
    delivery_otp_locked: Boolean(row.delivery_otp_locked_at) || Number(row.delivery_otp_attempts || 0) >= DELIVERY_OTP_MAX_ATTEMPTS,
    delivery_otp_locked_at: row.delivery_otp_locked_at,
    delivery_otp_verified_at: row.delivery_otp_verified_at,
    pickup_otp: row.pickup_otp || '',
    auto_delivery_offer_id: row.auto_delivery_offer_id || null,
    otp_set_by: row.otp_set_by || null,
    otp_set_by_name: row.otp_set_by_name || '',
    otp_set_by_role: row.otp_set_by_role || '',
    otp_set_at: row.otp_set_at,
    assigned_at: row.assigned_at,
    ready_at: row.ready_at,
    delivered_at: row.delivered_at,
    status_updated_at: row.status_updated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  if (includeItems && row.items) {
    order.items = row.items.map(item => ({
      id: item.id,
      vendor_product_id: item.vendor_product_id,
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: Number(item.quantity || 0),
      unit_price: Number(item.unit_price || 0),
      line_total: Number(item.line_total || 0),
      tax_name: item.tax_name || '',
      tax_percentage: Number(item.tax_percentage || 0),
      tax_amount: Number(item.tax_amount || 0),
      taxable_amount: Number(item.taxable_amount || 0),
      vendor_name: item.vendor_name || '',
      vendor_business_name: item.vendor_business_name || '',
    }));
  }

  return order;
}

async function listAll({ page = 1, limit = 10, search = '', status = '', deliveryStatus = '', vendorId = '', clientId = '', deliveryPartnerId = '' } = {}) {
  const currentPage = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(Math.max(1, parseInt(limit, 10) || 10), 100);
  const offset = (currentPage - 1) * pageSize;

  const where = [];
  const params = [];

  if (search) {
    where.push('(o.order_number LIKE ? OR o.client_name LIKE ? OR o.client_phone LIKE ? OR o.client_address LIKE ? OR o.shipping_name LIKE ? OR o.shipping_phone LIKE ? OR o.shipping_address LIKE ?)');
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term, term, term, term, term);
  }
  if (status) {
    if (normalizeStatus(status) === ORDER_STATUS.DELIVERED) {
      where.push("o.status IN ('delivered', 'completed')");
    } else {
      where.push('o.status = ?');
      params.push(normalizeStatus(status));
    }
  }
  if (deliveryStatus) {
    where.push('o.delivery_status = ?');
    params.push(deliveryStatus);
  }
  if (vendorId) {
    where.push('o.vendor_id = ?');
    params.push(vendorId);
  }
  if (clientId) {
    where.push('o.user_id = ?');
    params.push(clientId);
  }
  if (deliveryPartnerId) {
    where.push('o.delivery_partner_id = ?');
    params.push(deliveryPartnerId);
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM client_orders o ${whereSql}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT o.*,
            COALESCE(o.vendor_id, item_vendor.vendor_id) AS vendor_id,
            v.name AS vendor_name,
            v.email AS vendor_email,
            v.phone AS vendor_phone,
            vp.business_name AS vendor_business_name,
            vp.gst_number AS vendor_gst_number,
            vp.signature_path AS vendor_signature_path,
            vp.address AS vendor_address, vp.pickup_latitude, vp.pickup_longitude,
            vp.country AS vendor_country,
            vp.state AS vendor_state,
            vp.city AS vendor_city,
            vp.services AS vendor_services,
            cp.city AS client_city,
            dp.name AS delivery_partner_name
            , otp_user.name AS otp_set_by_name,
            otp_user.role AS otp_set_by_role
     FROM client_orders o
     LEFT JOIN (
       SELECT coi.order_id, MIN(vpi.vendor_id) AS vendor_id
       FROM client_order_items coi
       INNER JOIN vendor_products vpi ON vpi.id = coi.vendor_product_id
       GROUP BY coi.order_id
     ) item_vendor ON item_vendor.order_id = o.id
     LEFT JOIN users v ON v.id = COALESCE(o.vendor_id, item_vendor.vendor_id)
     LEFT JOIN vendor_profiles vp ON vp.user_id = COALESCE(o.vendor_id, item_vendor.vendor_id)
     LEFT JOIN client_profiles cp ON cp.user_id = o.user_id
     LEFT JOIN users dp ON dp.id = o.delivery_partner_id
     LEFT JOIN users otp_user ON otp_user.id = o.otp_set_by
     ${whereSql}
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return {
    orders: rows.map(normalizeOrder),
    pagination: {
      page: currentPage,
      limit: pageSize,
      total: countRows[0].total,
      totalPages: Math.max(Math.ceil(countRows[0].total / pageSize), 1),
    },
  };
}

async function listByVendor(vendorId, { status = '', search = '' } = {}) {
  const where = ['COALESCE(o.vendor_id, item_vendor.vendor_id) = ?'];
  const params = [vendorId];
  if (status) {
    if (normalizeStatus(status) === ORDER_STATUS.DELIVERED) {
      where.push("o.status IN ('delivered', 'completed')");
    } else {
      where.push('o.status = ?');
      params.push(normalizeStatus(status));
    }
  }
  if (search) {
    where.push('(o.order_number ILIKE ? OR o.client_name ILIKE ? OR o.client_phone ILIKE ? OR o.client_address ILIKE ? OR o.shipping_name ILIKE ? OR o.shipping_phone ILIKE ? OR o.shipping_address ILIKE ?)');
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term, term, term, term, term);
  }

  const [rows] = await pool.query(
    `SELECT o.*,
            COALESCE(o.vendor_id, item_vendor.vendor_id) AS vendor_id,
            v.name AS vendor_name,
            v.email AS vendor_email,
            v.phone AS vendor_phone,
            vp.business_name AS vendor_business_name,
            vp.gst_number AS vendor_gst_number,
            vp.signature_path AS vendor_signature_path,
            vp.address AS vendor_address, vp.pickup_latitude, vp.pickup_longitude,
            vp.country AS vendor_country,
            vp.state AS vendor_state,
            vp.city AS vendor_city,
            vp.services AS vendor_services,
            cp.city AS client_city,
            dp.name AS delivery_partner_name
            , otp_user.name AS otp_set_by_name,
            otp_user.role AS otp_set_by_role
     FROM client_orders o
     LEFT JOIN (
       SELECT coi.order_id, MIN(vpi.vendor_id) AS vendor_id
       FROM client_order_items coi
       INNER JOIN vendor_products vpi ON vpi.id = coi.vendor_product_id
       GROUP BY coi.order_id
     ) item_vendor ON item_vendor.order_id = o.id
     LEFT JOIN users v ON v.id = COALESCE(o.vendor_id, item_vendor.vendor_id)
     LEFT JOIN vendor_profiles vp ON vp.user_id = COALESCE(o.vendor_id, item_vendor.vendor_id)
     LEFT JOIN client_profiles cp ON cp.user_id = o.user_id
     LEFT JOIN users dp ON dp.id = o.delivery_partner_id
     LEFT JOIN users otp_user ON otp_user.id = o.otp_set_by
     WHERE ${where.join(' AND ')}
     ORDER BY o.created_at DESC, o.id DESC`,
    params
  );

  return rows.map(normalizeOrder);
}

async function listByClient(clientId) {
  const [rows] = await pool.query(
    `SELECT o.*,
            COALESCE(o.vendor_id, item_vendor.vendor_id) AS vendor_id,
            v.name AS vendor_name,
            v.email AS vendor_email,
            v.phone AS vendor_phone,
            vp.business_name AS vendor_business_name,
            vp.gst_number AS vendor_gst_number,
            vp.signature_path AS vendor_signature_path,
            vp.address AS vendor_address, vp.pickup_latitude, vp.pickup_longitude,
            vp.country AS vendor_country,
            vp.state AS vendor_state,
            vp.city AS vendor_city,
            vp.services AS vendor_services,
            cp.city AS client_city,
            dp.name AS delivery_partner_name
            , otp_user.name AS otp_set_by_name,
            otp_user.role AS otp_set_by_role
     FROM client_orders o
     LEFT JOIN (
       SELECT coi.order_id, MIN(vpi.vendor_id) AS vendor_id
       FROM client_order_items coi
       INNER JOIN vendor_products vpi ON vpi.id = coi.vendor_product_id
       GROUP BY coi.order_id
     ) item_vendor ON item_vendor.order_id = o.id
     LEFT JOIN users v ON v.id = COALESCE(o.vendor_id, item_vendor.vendor_id)
     LEFT JOIN vendor_profiles vp ON vp.user_id = COALESCE(o.vendor_id, item_vendor.vendor_id)
     LEFT JOIN client_profiles cp ON cp.user_id = o.user_id
     LEFT JOIN users dp ON dp.id = o.delivery_partner_id
     LEFT JOIN users otp_user ON otp_user.id = o.otp_set_by
     WHERE o.user_id = ?
     ORDER BY o.created_at DESC, o.id DESC`,
    [clientId]
  );

  return rows.map(normalizeOrder);
}

async function findById(orderId) {
  const [rows] = await pool.query(
    `SELECT o.*,
            COALESCE(o.vendor_id, item_vendor.vendor_id) AS vendor_id,
            v.name AS vendor_name,
            v.email AS vendor_email,
            v.phone AS vendor_phone,
            vp.business_name AS vendor_business_name,
            vp.gst_number AS vendor_gst_number,
            vp.signature_path AS vendor_signature_path,
            vp.address AS vendor_address, vp.pickup_latitude, vp.pickup_longitude,
            vp.country AS vendor_country,
            vp.state AS vendor_state,
            vp.city AS vendor_city,
            vp.services AS vendor_services,
            cp.city AS client_city,
            dp.name AS delivery_partner_name
            , otp_user.name AS otp_set_by_name,
            otp_user.role AS otp_set_by_role
     FROM client_orders o
     LEFT JOIN (
       SELECT coi.order_id, MIN(vpi.vendor_id) AS vendor_id
       FROM client_order_items coi
       INNER JOIN vendor_products vpi ON vpi.id = coi.vendor_product_id
       GROUP BY coi.order_id
     ) item_vendor ON item_vendor.order_id = o.id
     LEFT JOIN users v ON v.id = COALESCE(o.vendor_id, item_vendor.vendor_id)
     LEFT JOIN vendor_profiles vp ON vp.user_id = COALESCE(o.vendor_id, item_vendor.vendor_id)
     LEFT JOIN client_profiles cp ON cp.user_id = o.user_id
     LEFT JOIN users dp ON dp.id = o.delivery_partner_id
     LEFT JOIN users otp_user ON otp_user.id = o.otp_set_by
     WHERE o.id = ?
     LIMIT 1`,
    [orderId]
  );

  return normalizeOrder(rows[0]);
}

async function getOrderItems(orderId) {
  const [rows] = await pool.query(
    `SELECT oi.*,
            p.id AS product_id,
            p.name AS product_name,
            p.weight_value,
            p.weight_unit,
            vp.vendor_id,
            v.name AS vendor_name,
            vprof.business_name AS vendor_business_name
     FROM client_order_items oi
     INNER JOIN vendor_products vp ON vp.id = oi.vendor_product_id
     INNER JOIN users v ON v.id = vp.vendor_id
     LEFT JOIN vendor_profiles vprof ON vprof.user_id = vp.vendor_id
     INNER JOIN products p ON p.id = vp.product_id
     WHERE oi.order_id = ?`,
    [orderId]
  );

  return rows.map(row => ({
    id: row.id,
    order_id: row.order_id,
    vendor_product_id: row.vendor_product_id,
    product_id: row.product_id,
    product_name: row.product_name,
    weight_value: row.weight_value === undefined || row.weight_value === null ? null : Number(row.weight_value || 0),
    weight_unit: row.weight_unit || '',
    quantity: Number(row.quantity || 0),
    unit_price: Number(row.unit_price || 0),
    line_total: Number(row.unit_price * row.quantity || 0).toFixed(2),
    tax_name: row.tax_name || '',
    tax_percentage: Number(row.tax_percentage || 0),
    tax_amount: Number(row.tax_amount || 0),
    taxable_amount: Number(row.taxable_amount || 0),
    vendor_name: row.vendor_name,
    vendor_business_name: row.vendor_business_name,
  }));
}

async function getStatusHistory(orderId) {
  const [rows] = await pool.query(
    `SELECT osh.*,
            u.name AS changed_by_name
     FROM order_status_history osh
     LEFT JOIN users u ON u.id = osh.changed_by
     WHERE osh.order_id = ?
     ORDER BY osh.created_at ASC, osh.id ASC`,
    [orderId]
  );

  return rows.map((row) => ({
    id: row.id,
    order_id: row.order_id,
    old_status: normalizeStatus(row.old_status),
    new_status: normalizeStatus(row.new_status),
    old_status_label: row.old_status ? statusLabel(row.old_status) : '',
    new_status_label: statusLabel(row.new_status),
    changed_by: row.changed_by,
    changed_by_name: row.changed_by_name || row.changed_by_role || 'System',
    changed_by_role: row.changed_by_role || '',
    note: row.note || '',
    created_at: row.created_at,
  }));
}

function getAllowedNextStatuses(currentStatus, actorRole) {
  const status = normalizeStatus(currentStatus);
  const role = String(actorRole || '').toLowerCase();
  if (role === 'vendor') return VENDOR_TRANSITIONS[status] || [];
  if (role === 'deliveryperson') return DELIVERY_TRANSITIONS[status] || [];
  if (role === 'admin' || role === 'superadmin' || role === 'staff') return ADMIN_TRANSITIONS[status] || [];
  return [];
}

function getAllowedNextStatusesForOrder(order, actorRole) {
  const role = String(actorRole || '').toLowerCase();
  let statuses = getAllowedNextStatuses(order.status, role);
  if (role === 'vendor') {
    const hasDeliveryPartner = Boolean(order.delivery_partner_id);
    const vendorHandledDelivery = ['own_delivery', 'counter_pickup'].includes(String(order.delivery_method || '').toLowerCase())
      || ['delivered_by_vendor', 'counter_pickup'].includes(String(order.delivery_type || '').toLowerCase());
    statuses = statuses.filter((status) => {
      if ([ORDER_STATUS.PICKED_UP, ORDER_STATUS.ON_THE_WAY].includes(status)) {
        return hasDeliveryPartner || vendorHandledDelivery;
      }
      return status !== ORDER_STATUS.DELIVERED;
    });
  }
  return statuses;
}

function syncedDeliveryStatus(status, currentDeliveryStatus) {
  const value = normalizeStatus(status);
  if (value === ORDER_STATUS.READY_FOR_PICKUP) return 'ready_to_deliver';
  if (value === ORDER_STATUS.PICKED_UP || value === ORDER_STATUS.ON_THE_WAY) return 'out_for_delivery';
  if (value === ORDER_STATUS.DELIVERED) return 'delivered';
  return currentDeliveryStatus || 'pending';
}

async function insertClientNotification(connection, order, newStatus) {
  const displayOrderNumber = orderDisplayNumber(order);
  await connection.query(
    `INSERT INTO user_notifications (user_id, title, message, link)
     VALUES (?, ?, ?, ?)`,
    [
      order.user_id,
      `Order #${displayOrderNumber} ${statusLabel(newStatus)}`,
      `Your order #${displayOrderNumber} status changed to ${statusLabel(newStatus)}.`,
      '/orders/client',
    ]
  );
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function deliveryRoleSql(alias = 'u') {
  return `LOWER(${alias}.role) = 'deliveryperson'`;
}

function money(value) {
  return Number(Math.max(Number(value || 0), 0).toFixed(2));
}

function effectiveDeliveryCharge(value) {
  return money(value);
}

function externalProviderToken(id) {
  return -Math.abs(Number(id) || 0);
}

function externalProviderId(value) {
  const text = String(value || '').trim().toLowerCase();
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric < 0) return Math.abs(numeric);
  if (!text.startsWith('external:')) return 0;
  return Number(text.slice('external:'.length)) || 0;
}

function deliveryOfferExpirySql() {
  return `CURRENT_TIMESTAMP + INTERVAL '${DELIVERY_OFFER_EXPIRY_MINUTES} minutes'`;
}

async function deliveryPlatformFee(deliveryCharge, connection = pool) {
  return 0;
}

async function deliveryFinancials(deliveryCharges, connection = pool) {
  return deliveryCharges.map((value) => {
    const deliveryCharge = money(value);
    return {
      deliveryCharge,
      platformFee: 0,
      deliveryEarning: deliveryCharge,
    };
  });
}

async function releaseDeliveryPersonIfIdle(connection, deliveryPersonId) {
  await connection.query(
    `UPDATE delivery_person_profiles
     SET updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
    [deliveryPersonId]
  );
}

async function updateStatus({ orderId, actorUser, newStatus, note = '' }) {
  const targetStatus = normalizeStatus(newStatus);
  const actorRole = actorUser && actorUser.role ? actorUser.role : '';
  const allowedStatuses = Object.values(ORDER_STATUS);
  if (!allowedStatuses.includes(targetStatus)) {
    const error = new Error('Invalid order status');
    error.status = 422;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [orderRows] = await connection.query(
      'SELECT * FROM client_orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    if (!orderRows.length) {
      const error = new Error('Order not found');
      error.status = 404;
      throw error;
    }

    const order = orderRows[0];
    const currentStatus = normalizeStatus(order.status);
    const allowedNext = getAllowedNextStatusesForOrder(order, actorRole);
    if (!allowedNext.includes(targetStatus)) {
      const error = new Error(`Cannot change order from ${statusLabel(currentStatus)} to ${statusLabel(targetStatus)}`);
      error.status = 422;
      throw error;
    }

    if (String(actorRole).toLowerCase() === 'vendor' && Number(order.vendor_id) !== Number(actorUser.id)) {
      const error = new Error('Access denied');
      error.status = 403;
      throw error;
    }

    const deliveryStatus = syncedDeliveryStatus(targetStatus, order.delivery_status);
    await connection.query(
      `UPDATE client_orders
       SET status = ?,
           delivery_status = ?,
           status_updated_at = CURRENT_TIMESTAMP,
           ready_at = CASE WHEN ? = 'ready_for_pickup' THEN CURRENT_TIMESTAMP ELSE ready_at END,
           delivered_at = CASE WHEN ? = 'delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [targetStatus, deliveryStatus, targetStatus, targetStatus, orderId]
    );

    if (deliveryStatus === 'out_for_delivery' && String(order.delivery_status || '').toLowerCase() !== 'out_for_delivery') {
      await connection.query(
        `UPDATE client_orders
         SET delivery_otp = ?, delivery_otp_attempts = 0,
             delivery_otp_locked_at = NULL, delivery_otp_verified_at = NULL,
             otp_set_by = ?, otp_set_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [generateOtp(), actorUser ? actorUser.id : null, orderId]
      );
    }
    if (deliveryStatus === 'delivered' && order.delivery_partner_id) {
      await OrderWalletSettlement.settleDeliveryCompletion({
        orderId,
        deliveryPersonId: order.delivery_partner_id,
        actorId: actorUser ? actorUser.id : order.delivery_partner_id,
        connection,
      });
      await releaseDeliveryPersonIfIdle(connection, order.delivery_partner_id);
    }

    await connection.query(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orderId, currentStatus, targetStatus, actorUser ? actorUser.id : null, actorRole || null, note || null]
    );

    await insertClientNotification(connection, order, targetStatus);
    await connection.commit();
    return { orderId, status: targetStatus, statusLabel: statusLabel(targetStatus), deliveryStatus };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function assignDeliveryPartner(orderId, partnerId, otp, deliveryCharge = 0, actorUser = null) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Verify order exists
    const [orderRows] = await connection.query(
      `SELECT id, order_number, user_id, status, delivery_status, shipping_city, shipping_area,
              vendor_id, shipping_pincode, shipping_latitude, shipping_longitude,
              delivery_charge, wallet_settled_at
       FROM client_orders
       WHERE id = ? FOR UPDATE`,
      [orderId]
    );
    if (!orderRows.length) {
      throw new Error('Order not found');
    }

    const order = orderRows[0];
    const assignedDeliveryCharge = order.wallet_settled_at
      ? money(order.delivery_charge)
      : effectiveDeliveryCharge(Number(deliveryCharge || order.delivery_charge || 0));
    const assignableDeliveryStatuses = ['pending', 'assigned', 'ready_to_deliver'];
    const deliveryStatus = String(order.delivery_status || 'pending').toLowerCase();
    const orderStatus = String(order.status || '').toLowerCase();
    if (!assignableDeliveryStatuses.includes(deliveryStatus) || ['delivered', 'completed'].includes(orderStatus)) {
      throw new Error('Delivery partner can be assigned before the order is out for delivery or delivered');
    }

    if (String(partnerId) === 'own_delivery') {
      const ownDelivery = await DeliveryType.isTypeAvailable('delivered_by_vendor', {
        latitude: order.shipping_latitude,
        longitude: order.shipping_longitude,
        city: order.shipping_city,
        area: order.shipping_area || order.shipping_pincode,
        vendorId: order.vendor_id,
      }, connection);
      if (!ownDelivery.active) {
        throw new Error('Delivered by Vendor is not active for this order area/vendor');
      }

      await connection.query(
        `UPDATE client_orders
         SET delivery_partner_id = NULL,
             external_delivery_provider_id = NULL,
             external_delivery_provider_name = NULL,
             delivery_method = 'own_delivery',
             delivery_type = 'delivered_by_vendor',
             delivery_otp = ?,
             pickup_otp = COALESCE(pickup_otp, ?),
             delivery_charge = ?,
             auto_delivery_offer_id = NULL,
             otp_set_by = ?,
             otp_set_at = CURRENT_TIMESTAMP,
             delivery_status = CASE WHEN delivery_status = 'ready_to_deliver' THEN delivery_status ELSE 'assigned' END,
             assigned_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      [otp, generateOtp(), assignedDeliveryCharge, actorUser ? actorUser.id : null, orderId]
      );

      await connection.query(
        `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          order.delivery_status,
          'assigned',
          actorUser ? actorUser.id : null,
          actorUser ? actorUser.role : null,
          `OTP set, delivery charge ${assignedDeliveryCharge}, and Own Delivery assigned`,
        ]
      );

      await connection.query(
        `INSERT INTO user_notifications (user_id, title, message, link)
         VALUES (?, ?, ?, ?)`,
        [
          order.user_id,
          `Order #${orderDisplayNumber(order)} delivery assigned`,
          `Own Delivery assigned and OTP generated for order #${orderDisplayNumber(order)}.`,
          '/orders/client',
        ]
      );

      await connection.commit();
      return { orderId, partnerId: 'own_delivery', otp, deliveryCharge: assignedDeliveryCharge, otpSetBy: actorUser ? actorUser.id : null };
    }

    const selectedExternalProviderId = externalProviderId(partnerId);
    if (selectedExternalProviderId) {
      const [providerRows] = await connection.query(
        `SELECT id, name, slug, phone, email, city, area
         FROM external_delivery_providers
         WHERE id = ?
           AND is_active = 1
           AND (TRIM(COALESCE(city, '*')) = '*' OR LOWER(TRIM(city)) = LOWER(TRIM(CAST(? AS TEXT))))
           AND (
             TRIM(COALESCE(area, '*')) = '*'
             OR LOWER(TRIM(area)) = LOWER(TRIM(CAST(? AS TEXT)))
             OR LOWER(TRIM(area)) = LOWER(TRIM(CAST(? AS TEXT)))
           )
         LIMIT 1`,
        [
          selectedExternalProviderId,
          order.shipping_city || '',
          order.shipping_area || '',
          order.shipping_pincode || '',
        ]
      );
      if (!providerRows.length) {
        const error = new Error('External delivery provider is not active for this order area');
        error.status = 422;
        throw error;
      }
      const provider = providerRows[0];

      await connection.query(
        `UPDATE client_orders
         SET delivery_partner_id = NULL,
             external_delivery_provider_id = ?,
             external_delivery_provider_name = ?,
             delivery_method = 'external_provider',
             delivery_type = 'delivery_partner',
             delivery_otp = ?,
             pickup_otp = COALESCE(pickup_otp, ?),
             delivery_charge = ?,
             auto_delivery_offer_id = NULL,
             otp_set_by = ?,
             otp_set_at = CURRENT_TIMESTAMP,
             delivery_status = CASE WHEN delivery_status = 'ready_to_deliver' THEN delivery_status ELSE 'assigned' END,
             assigned_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [provider.id, provider.name, otp, generateOtp(), assignedDeliveryCharge, actorUser ? actorUser.id : null, orderId]
      );

      await connection.query(
        `UPDATE delivery_order_offers
         SET status = 'expired',
             response_note = COALESCE(response_note, 'Superseded by manual external provider assignment'),
             responded_at = COALESCE(responded_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE order_id = ? AND status = 'pending'`,
        [orderId]
      );

      await connection.query(
        `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          order.delivery_status,
          'assigned',
          actorUser ? actorUser.id : null,
          actorUser ? actorUser.role : null,
          `OTP set, delivery charge ${assignedDeliveryCharge}, and external delivery provider ${provider.name} assigned`,
        ]
      );

      await connection.query(
        `INSERT INTO user_notifications (user_id, title, message, link)
         VALUES (?, ?, ?, ?)`,
        [
          order.user_id,
          `Order #${orderDisplayNumber(order)} delivery assigned`,
          `${provider.name} has been assigned for order #${orderDisplayNumber(order)}.`,
          '/orders/client',
        ]
      );

      await connection.commit();
      return {
        orderId,
        partnerId: externalProviderToken(provider.id),
        externalProviderId: Number(provider.id),
        externalProviderName: provider.name,
        otp,
        deliveryCharge: assignedDeliveryCharge,
        otpSetBy: actorUser ? actorUser.id : null,
      };
    }

    // Admin/staff manual assignment can use any active, available, free delivery partner.
    const [partnerRows] = await connection.query(
      `SELECT u.id, u.name, u.role
       FROM users u
       INNER JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
       WHERE u.id = ?
         AND LOWER(u.status) = 'active'
         AND u.is_deleted = 0
         AND ${deliveryRoleSql('u')}
         AND COALESCE(dpp.is_available, 1) = 1
         AND NOT EXISTS (
           SELECT 1 FROM client_orders busy
           WHERE busy.delivery_partner_id = u.id
             AND busy.delivery_status IN ('assigned', 'ready_to_deliver', 'out_for_delivery')
             AND LOWER(COALESCE(busy.status, '')) NOT IN ('delivered', 'completed', 'cancelled', 'canceled')
         )
         AND NOT EXISTS (
           SELECT 1 FROM delivery_order_offers open_offer
           WHERE open_offer.delivery_person_id = u.id
             AND open_offer.status = 'pending'
             AND open_offer.expires_at > CURRENT_TIMESTAMP
         )
         AND NOT EXISTS (
           SELECT 1 FROM delivery_order_offers rejected_offer
           WHERE rejected_offer.order_id = ?
             AND rejected_offer.delivery_person_id = u.id
             AND rejected_offer.status = 'rejected'
         )
         AND NOT EXISTS (
           SELECT 1 FROM delivery_person_activity_logs rejected_log
           WHERE rejected_log.delivery_person_id = u.id
             AND rejected_log.action = 'order_rejected'
             AND rejected_log.metadata->>'order_id' = CAST(? AS TEXT)
         )
       LIMIT 1`,
      [partnerId, orderId, orderId]
    );
    if (!partnerRows.length) {
      throw new Error('Delivery partner is not active, available, or free');
    }

    // Update order
    await connection.query(
      `UPDATE client_orders
       SET delivery_partner_id = ?,
           external_delivery_provider_id = NULL,
           external_delivery_provider_name = NULL,
           delivery_method = 'partner',
           delivery_type = 'delivery_partner',
           delivery_otp = ?,
           pickup_otp = COALESCE(pickup_otp, ?),
           delivery_charge = ?,
           auto_delivery_offer_id = NULL,
           otp_set_by = ?,
           otp_set_at = CURRENT_TIMESTAMP,
           delivery_status = CASE WHEN delivery_status = 'ready_to_deliver' THEN delivery_status ELSE 'assigned' END,
           assigned_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [partnerId, otp, generateOtp(), assignedDeliveryCharge, actorUser ? actorUser.id : null, orderId]
    );
    await connection.query(
      `UPDATE delivery_order_offers
       SET status = 'expired',
           response_note = COALESCE(response_note, 'Superseded by manual admin assignment'),
           responded_at = COALESCE(responded_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE order_id = ? AND status = 'pending'`,
      [orderId]
    );

    await connection.query(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        order.delivery_status,
        'assigned',
        actorUser ? actorUser.id : null,
        actorUser ? actorUser.role : null,
        `OTP set, delivery charge ${assignedDeliveryCharge}, and delivery partner #${partnerId} assigned`,
      ]
    );

    await connection.query(
      `INSERT INTO user_notifications (user_id, title, message, link)
       VALUES (?, ?, ?, ?)`,
      [
        partnerId,
        `Delivery assigned for order #${orderDisplayNumber(order)}`,
        `Admin assigned order #${orderDisplayNumber(order)} to you. Please proceed with pickup.`,
        '/api/orders/delivery',
      ]
    );

    await connection.query(
      `INSERT INTO user_notifications (user_id, title, message, link)
       VALUES (?, ?, ?, ?)`,
      [
        order.user_id,
        `Order #${orderDisplayNumber(order)} delivery assigned`,
        `Delivery partner assigned and OTP generated for order #${orderDisplayNumber(order)}.`,
        '/orders/client',
      ]
    );

    await connection.commit();
    return { orderId, partnerId, otp, deliveryCharge: assignedDeliveryCharge, otpSetBy: actorUser ? actorUser.id : null };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listFreeDeliveryPartnersForOrder(orderId) {
  const [orderRows] = await pool.query(
    `SELECT o.id, o.vendor_id, o.shipping_city, o.shipping_area, o.shipping_pincode,
            o.shipping_latitude, o.shipping_longitude,
            vp.address AS vendor_address, vp.city AS vendor_city, vp.area AS vendor_area,
            vp.pickup_latitude, vp.pickup_longitude
     FROM client_orders o
     LEFT JOIN vendor_profiles vp ON vp.user_id = o.vendor_id
     WHERE o.id = ?
     LIMIT 1`,
    [orderId]
  );
  if (!orderRows.length) {
    const error = new Error('Order not found');
    error.status = 404;
    throw error;
  }

  const order = orderRows[0];
  const pickupLatitude = order.pickup_latitude === null || order.pickup_latitude === undefined ? null : Number(order.pickup_latitude);
  const pickupLongitude = order.pickup_longitude === null || order.pickup_longitude === undefined ? null : Number(order.pickup_longitude);

  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone,
            dpp.current_latitude, dpp.current_longitude, dpp.last_seen_at,
            COALESCE(MIN(dps.city), dpp.city, '') AS city,
            COALESCE(MIN(dps.area), dpp.area, '*') AS area,
            COALESCE(recent_rejections.rejected_count_7d, 0) AS rejected_count_7d,
            CASE
              WHEN CAST(? AS DECIMAL) IS NOT NULL AND CAST(? AS DECIMAL) IS NOT NULL
               AND dpp.current_latitude IS NOT NULL AND dpp.current_longitude IS NOT NULL
              THEN ROUND((SQRT(
                POWER(CAST(dpp.current_latitude AS DECIMAL) - CAST(? AS DECIMAL), 2)
                + POWER((CAST(dpp.current_longitude AS DECIMAL) - CAST(? AS DECIMAL)) * COS(RADIANS(CAST(? AS DECIMAL))), 2)
              ) * 111)::numeric, 2)
              ELSE NULL
            END AS distance_km
     FROM users u
     INNER JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
     LEFT JOIN delivery_partner_settings dps ON dps.user_id = u.id AND dps.is_active = 1
     LEFT JOIN (
       SELECT delivery_person_id, COUNT(*) AS rejected_count_7d
       FROM delivery_person_activity_logs
       WHERE action = 'order_rejected'
         AND created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
       GROUP BY delivery_person_id
     ) recent_rejections ON recent_rejections.delivery_person_id = u.id
     WHERE u.is_deleted = 0
       AND LOWER(u.status) = 'active'
       AND ${deliveryRoleSql('u')}
       AND COALESCE(dpp.is_available, 1) = 1
       AND NOT EXISTS (
         SELECT 1 FROM client_orders busy
         WHERE busy.delivery_partner_id = u.id
           AND busy.delivery_status IN ('assigned', 'ready_to_deliver', 'out_for_delivery')
           AND LOWER(COALESCE(busy.status, '')) NOT IN ('delivered', 'completed', 'cancelled', 'canceled')
       )
       AND NOT EXISTS (
         SELECT 1 FROM delivery_order_offers open_offer
         WHERE open_offer.delivery_person_id = u.id
           AND open_offer.status = 'pending'
           AND open_offer.expires_at > CURRENT_TIMESTAMP
       )
       AND NOT EXISTS (
         SELECT 1 FROM delivery_order_offers rejected_offer
         WHERE rejected_offer.order_id = ?
           AND rejected_offer.delivery_person_id = u.id
           AND rejected_offer.status = 'rejected'
       )
       AND NOT EXISTS (
         SELECT 1 FROM delivery_person_activity_logs rejected_log
         WHERE rejected_log.delivery_person_id = u.id
           AND rejected_log.action = 'order_rejected'
           AND rejected_log.metadata->>'order_id' = CAST(? AS TEXT)
       )
     GROUP BY u.id, u.name, u.email, u.phone, dpp.city, dpp.area, dpp.current_latitude, dpp.current_longitude, dpp.last_seen_at, recent_rejections.rejected_count_7d
     ORDER BY distance_km ASC NULLS LAST, u.name ASC`,
    [
      pickupLatitude,
      pickupLongitude,
      pickupLatitude,
      pickupLongitude,
      pickupLatitude,
      orderId,
      orderId,
    ]
  );

  const [externalRows] = await pool.query(
    `SELECT id, name, slug, phone, email, city, area
     FROM external_delivery_providers
     WHERE is_active = 1
       AND (TRIM(COALESCE(city, '*')) = '*' OR LOWER(TRIM(city)) = LOWER(TRIM(CAST(? AS TEXT))))
       AND (
         TRIM(COALESCE(area, '*')) = '*'
         OR LOWER(TRIM(area)) = LOWER(TRIM(CAST(? AS TEXT)))
         OR LOWER(TRIM(area)) = LOWER(TRIM(CAST(? AS TEXT)))
       )
     ORDER BY CASE WHEN TRIM(COALESCE(city, '*')) = '*' THEN 1 ELSE 0 END,
              CASE WHEN TRIM(COALESCE(area, '*')) = '*' THEN 1 ELSE 0 END,
              name ASC`,
    [
      order.shipping_city || '',
      order.shipping_area || '',
      order.shipping_pincode || '',
    ]
  );

  return {
    orderId: Number(orderId),
    pickup: {
      location: [order.vendor_address, order.vendor_city].filter(Boolean).join(', ') || '-',
      latitude: pickupLatitude,
      longitude: pickupLongitude,
    },
    partners: [
      ...rows.map((row) => ({
      id: Number(row.id),
      type: 'internal',
      name: row.name || '',
      email: row.email || '',
      phone: row.phone || '',
      city: row.city || '',
      area: row.area || '*',
      current_latitude: row.current_latitude === null || row.current_latitude === undefined ? null : Number(row.current_latitude),
      current_longitude: row.current_longitude === null || row.current_longitude === undefined ? null : Number(row.current_longitude),
      distance_km: row.distance_km === null || row.distance_km === undefined ? null : Number(row.distance_km),
      last_seen_at: row.last_seen_at,
      rejected_count_7d: Number(row.rejected_count_7d || 0),
      current_status: 'Free',
    })),
      ...externalRows.map((row) => ({
        id: externalProviderToken(row.id),
        provider_id: Number(row.id),
        type: 'external',
        name: row.name || '',
        slug: row.slug || '',
        email: row.email || '',
        phone: row.phone || '',
        city: row.city || '*',
        area: row.area || '*',
        current_latitude: null,
        current_longitude: null,
        distance_km: null,
        last_seen_at: null,
        rejected_count_7d: 0,
        current_status: 'External Provider',
      })),
    ],
  };
}

async function createAutoDeliveryOffer(orderId, actorUser = null, options = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [orderRows] = await connection.query(
      `SELECT o.id, o.order_number, o.user_id, o.status, o.delivery_status, o.delivery_partner_id,
              o.client_name, o.client_phone, o.client_address, o.delivery_charge, o.total_amount,
              o.shipping_city, o.shipping_area, o.shipping_pincode, o.shipping_latitude, o.shipping_longitude,
              o.shipping_name, o.shipping_phone, o.shipping_address,
              COALESCE(o.delivery_otp, '') AS delivery_otp, COALESCE(o.pickup_otp, '') AS pickup_otp,
              v.name AS vendor_name, v.phone AS vendor_phone,
              vprof.business_name AS vendor_business_name, vprof.address AS vendor_address,
              vprof.city AS vendor_city, vprof.area AS vendor_area,
              vprof.pickup_latitude AS vendor_latitude, vprof.pickup_longitude AS vendor_longitude,
              COALESCE((
                SELECT SUM(COALESCE(coi.quantity, 0) * COALESCE(p.weight_kg, 0))
                FROM client_order_items coi
                INNER JOIN vendor_products vp ON vp.id = coi.vendor_product_id
                INNER JOIN products p ON p.id = vp.product_id
                WHERE coi.order_id = o.id
              ), 0) AS approx_total_weight_kg
       FROM client_orders o
       LEFT JOIN users v ON v.id = o.vendor_id
       LEFT JOIN vendor_profiles vprof ON vprof.user_id = o.vendor_id
       WHERE o.id = ? FOR UPDATE OF o`,
      [orderId]
    );
    if (!orderRows.length) {
      const error = new Error('Order not found');
      error.status = 404;
      throw error;
    }
    const order = orderRows[0];
    if (order.delivery_partner_id) {
      throw new Error('Order already has a delivery partner');
    }
    const [liveOffers] = await connection.query(
      `SELECT id FROM delivery_order_offers
       WHERE order_id = ? AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
      [orderId]
    );
    if (liveOffers.length) {
      throw new Error('A delivery offer is already awaiting response');
    }
    if (['delivered', 'completed'].includes(String(order.status || '').toLowerCase())) {
      throw new Error('Delivered orders cannot be auto assigned');
    }

    const ownDelivery = await DeliveryType.isTypeAvailable('in_house_delivery', {
      latitude: order.shipping_latitude,
      longitude: order.shipping_longitude,
      city: order.shipping_city,
      area: order.shipping_area || order.shipping_pincode,
      vendorId: order.vendor_id,
    }, connection);
    if (!ownDelivery.active) {
      throw new Error('Auto in-house delivery is not active for this order city/area');
    }

    const matchedCity = (ownDelivery.area && ownDelivery.area.city) || order.shipping_city || order.vendor_city;
    const matchedArea = (ownDelivery.area && ownDelivery.area.name) || order.shipping_area || order.shipping_pincode || order.vendor_area || '*';
    const retryAttemptedDeliveryPeople = Boolean(options.retryAttemptedDeliveryPeople);
    const debugDeliveryPersonName = String(process.env.DEBUG_DELIVERY_PERSON_NAME || '').trim();
    const nearbyBatchPartner = await findNearbyBatchPartner(order, connection);
    let partnerRows = nearbyBatchPartner ? [nearbyBatchPartner] : [];
    if (!partnerRows.length && debugDeliveryPersonName) {
      const [debugRows] = await connection.query(
        `SELECT u.id, u.name, u.phone, p.area, 0 AS distance_score
         FROM users u
         INNER JOIN delivery_person_profiles p ON p.user_id = u.id
         INNER JOIN delivery_partner_settings dps ON dps.user_id = u.id AND dps.is_active = 1
         WHERE u.is_deleted = 0
           AND LOWER(u.status) = 'active'
           AND ${deliveryRoleSql('u')}
           AND COALESCE(p.is_available, 1) = 1
           AND p.last_seen_at >= CURRENT_TIMESTAMP - INTERVAL '45 seconds'
           AND LOWER(TRIM(u.name)) = LOWER(TRIM(CAST(? AS TEXT)))
           AND LOWER(TRIM(dps.city)) = LOWER(TRIM(CAST(? AS TEXT)))
           AND (TRIM(COALESCE(dps.area, '*')) = '*' OR LOWER(TRIM(dps.area)) = LOWER(TRIM(CAST(? AS TEXT))))
           AND NOT EXISTS (
             SELECT 1 FROM delivery_order_offers rejected_offer
             WHERE rejected_offer.order_id = ?
               AND rejected_offer.delivery_person_id = u.id
               AND rejected_offer.status = 'rejected'
           )
           AND NOT EXISTS (
             SELECT 1 FROM delivery_person_activity_logs rejected_log
             WHERE rejected_log.delivery_person_id = u.id
               AND rejected_log.action = 'order_rejected'
               AND rejected_log.metadata->>'order_id' = CAST(? AS TEXT)
           )
         ORDER BY u.id ASC
         LIMIT 1`,
        [debugDeliveryPersonName, matchedCity, matchedArea, orderId, orderId]
      );
      partnerRows = debugRows;
    }
    if (!partnerRows.length) {
      [partnerRows] = await connection.query(
        `SELECT u.id, u.name, u.phone, p.area,
                CASE
                  WHEN p.current_latitude IS NOT NULL AND p.current_longitude IS NOT NULL
                   AND CAST(? AS DECIMAL) IS NOT NULL AND CAST(? AS DECIMAL) IS NOT NULL
                  THEN POWER(CAST(p.current_latitude AS DECIMAL) - CAST(? AS DECIMAL), 2)
                     + POWER((CAST(p.current_longitude AS DECIMAL) - CAST(? AS DECIMAL)) * COS(RADIANS(CAST(? AS DECIMAL))), 2)
                  ELSE 999999
                END AS distance_score
         FROM users u
         INNER JOIN delivery_person_profiles p ON p.user_id = u.id
         INNER JOIN delivery_partner_settings dps ON dps.user_id = u.id AND dps.is_active = 1
         WHERE u.is_deleted = 0
           AND LOWER(u.status) = 'active'
           AND ${deliveryRoleSql('u')}
           AND COALESCE(p.is_available, 1) = 1
           AND p.last_seen_at >= CURRENT_TIMESTAMP - INTERVAL '45 seconds'
           AND LOWER(TRIM(dps.city)) = LOWER(TRIM(CAST(? AS TEXT)))
           AND (TRIM(COALESCE(dps.area, '*')) = '*' OR LOWER(TRIM(dps.area)) = LOWER(TRIM(CAST(? AS TEXT))))
           AND NOT EXISTS (
             SELECT 1 FROM client_orders busy
             WHERE busy.delivery_partner_id = u.id
               AND busy.delivery_status IN ('assigned', 'ready_to_deliver', 'out_for_delivery')
           )
           AND NOT EXISTS (
             SELECT 1 FROM delivery_order_offers open_offer
             WHERE open_offer.delivery_person_id = u.id
               AND open_offer.status = 'pending'
               AND open_offer.expires_at > CURRENT_TIMESTAMP
           )
           AND NOT EXISTS (
             SELECT 1 FROM delivery_order_offers rejected_offer
             WHERE rejected_offer.order_id = ?
               AND rejected_offer.delivery_person_id = u.id
               AND rejected_offer.status = 'rejected'
           )
           AND NOT EXISTS (
             SELECT 1 FROM delivery_person_activity_logs rejected_log
             WHERE rejected_log.delivery_person_id = u.id
               AND rejected_log.action = 'order_rejected'
               AND rejected_log.metadata->>'order_id' = CAST(? AS TEXT)
           )
           AND (? = 1 OR NOT EXISTS (
             SELECT 1 FROM delivery_order_offers attempted_offer
             WHERE attempted_offer.order_id = ? AND attempted_offer.delivery_person_id = u.id
           ))
         ORDER BY distance_score ASC, u.id ASC
         LIMIT 1`,
        [
          order.vendor_latitude,
          order.vendor_longitude,
          order.vendor_latitude,
          order.vendor_longitude,
          order.vendor_latitude,
          matchedCity,
          matchedArea,
          orderId,
          orderId,
          retryAttemptedDeliveryPeople ? 1 : 0,
          orderId,
        ]
      );
    }
    if (!partnerRows.length) {
      const waitingDeliveryCharge = effectiveDeliveryCharge(order.delivery_charge);
      await connection.query(
        `UPDATE client_orders
         SET delivery_method = 'in_house_auto', delivery_type = 'in_house_delivery',
             delivery_status = 'offer_pending',
             delivery_charge = ?
         WHERE id = ? AND delivery_partner_id IS NULL`,
        [waitingDeliveryCharge, orderId]
      );
      await connection.commit();
      return { orderId, pending: true, message: 'Waiting for an online available delivery person in the delivery area' };
    }
    const partner = partnerRows[0];
    const pickupOtp = order.pickup_otp || generateOtp();
    const deliveryOtp = order.delivery_otp || generateOtp();
    const grossDeliveryCharge = effectiveDeliveryCharge(order.delivery_charge);
    const platformFee = Math.min(await deliveryPlatformFee(grossDeliveryCharge, connection), grossDeliveryCharge);
    const deliveryPartnerEarning = money(grossDeliveryCharge - platformFee);
    const pickupAddress = [order.vendor_address, order.vendor_city].filter(Boolean).join(', ') || order.vendor_city || 'Pickup location';
    const deliveryAddress = [order.shipping_address || order.client_address, order.shipping_area, order.shipping_city, order.shipping_pincode].filter(Boolean).join(', ') || matchedArea || 'Delivery area';
    const notificationPayload = {
      order_id: order.id,
      order_number: orderDisplayNumber(order),
      vendor_name: order.vendor_business_name || order.vendor_name || 'Vendor',
      vendor_phone: order.vendor_phone || '',
      vendor_address: pickupAddress,
      client_name: order.shipping_name || order.client_name || 'Client',
      client_phone: order.shipping_phone || order.client_phone || '',
      client_address: deliveryAddress,
      pickup_area: order.vendor_city || pickupAddress,
      delivery_area: matchedArea || order.shipping_area || order.shipping_city || '',
      delivery_charge: grossDeliveryCharge,
      platform_fee: platformFee,
      delivery_partner_earning: deliveryPartnerEarning,
      approx_total_weight_kg: Number(order.approx_total_weight_kg || 0),
      debug_delivery_person: debugDeliveryPersonName && partner.name === debugDeliveryPersonName,
      nearby_batch: Boolean(nearbyBatchPartner),
      batch_source_order_id: nearbyBatchPartner ? Number(nearbyBatchPartner.source_order_id) : null,
      batch_distance_km: nearbyBatchPartner ? Number(nearbyBatchPartner.batch_distance_km.toFixed(3)) : null,
    };

    if (nearbyBatchPartner) {
      const batchNote = `Automatically batched: vendor pickup is ${nearbyBatchPartner.batch_distance_km.toFixed(3)} km from the delivery address of order #${orderDisplayNumber({ id: nearbyBatchPartner.source_order_id, order_number: nearbyBatchPartner.source_order_number })}`;
      await connection.query(
        `UPDATE client_orders
         SET delivery_partner_id = ?,
             delivery_method = 'in_house_auto',
             delivery_type = 'in_house_delivery',
             delivery_otp = ?,
             pickup_otp = ?,
             delivery_charge = ?,
             delivery_status = 'assigned',
             assigned_at = CURRENT_TIMESTAMP,
             otp_set_by = ?,
             otp_set_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND delivery_partner_id IS NULL`,
        [partner.id, deliveryOtp, pickupOtp, grossDeliveryCharge, actorUser ? actorUser.id : null, orderId]
      );
      const [offerResult] = await connection.query(
        `INSERT INTO delivery_order_offers
         (order_id, delivery_person_id, status, pickup_area, delivery_area, delivery_charge, platform_fee, delivery_partner_earning, notification_payload, response_note, responded_at, expires_at)
         VALUES (?, ?, 'accepted', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ${deliveryOfferExpirySql()})`,
        [orderId, partner.id, pickupAddress, deliveryAddress, grossDeliveryCharge, platformFee, deliveryPartnerEarning, JSON.stringify(notificationPayload), batchNote]
      );
      await connection.query(
        `UPDATE client_orders SET auto_delivery_offer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [offerResult.insertId, orderId]
      );
      await connection.query(
        `INSERT INTO user_notifications (user_id, title, message, link)
         VALUES (?, ?, ?, ?)`,
        [
          partner.id,
          `Nearby delivery #${orderDisplayNumber(order)} automatically assigned`,
          `${batchNote}. Pickup: ${pickupAddress} | Delivery: ${deliveryAddress} | Delivery earning: ₹${deliveryPartnerEarning.toFixed(2)}`,
          '/api/orders/delivery',
        ]
      );
      await connection.query(
        `INSERT INTO delivery_person_activity_logs (delivery_person_id, actor_id, action, description, metadata)
         VALUES (?, ?, 'order_batched', ?, ?)`,
        [partner.id, actorUser ? actorUser.id : null, batchNote, JSON.stringify({
          order_id: Number(orderId),
          source_order_id: Number(nearbyBatchPartner.source_order_id),
          distance_km: Number(nearbyBatchPartner.batch_distance_km.toFixed(3)),
        })]
      );
      await connection.query(
        `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
         VALUES (?, ?, 'assigned', ?, ?, ?)`,
        [orderId, order.delivery_status, actorUser ? actorUser.id : null, actorUser ? actorUser.role : 'system', batchNote]
      );
      await connection.commit();
      return {
        orderId,
        offerId: offerResult.insertId,
        deliveryPersonId: partner.id,
        deliveryPersonName: partner.name,
        automaticallyAssigned: true,
        nearbyBatch: true,
        batchSourceOrderId: Number(nearbyBatchPartner.source_order_id),
        batchDistanceKm: Number(nearbyBatchPartner.batch_distance_km.toFixed(3)),
        notification: notificationPayload,
      };
    }

    await connection.query(
      `UPDATE client_orders
       SET delivery_method = 'in_house_auto',
           delivery_type = 'in_house_delivery',
           delivery_otp = ?,
           pickup_otp = ?,
           delivery_charge = ?,
           delivery_status = CASE WHEN delivery_status = 'pending' THEN 'offer_pending' ELSE delivery_status END,
           otp_set_by = ?,
           otp_set_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [deliveryOtp, pickupOtp, grossDeliveryCharge, actorUser ? actorUser.id : null, orderId]
    );

    const [offerResult] = await connection.query(
      `INSERT INTO delivery_order_offers
       (order_id, delivery_person_id, status, pickup_area, delivery_area, delivery_charge, platform_fee, delivery_partner_earning, notification_payload, expires_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ${deliveryOfferExpirySql()})`,
      [orderId, partner.id, pickupAddress, deliveryAddress, grossDeliveryCharge, platformFee, deliveryPartnerEarning, JSON.stringify(notificationPayload)]
    );
    await connection.query(
      `UPDATE client_orders SET auto_delivery_offer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [offerResult.insertId, orderId]
    );

    await connection.query(
      `INSERT INTO user_notifications (user_id, title, message, link)
       VALUES (?, ?, ?, ?)`,
      [
        partner.id,
        `New delivery order #${orderDisplayNumber(order)}`,
        `Order #${orderDisplayNumber(order)} | Vendor: ${notificationPayload.vendor_name}, ${pickupAddress} | Client: ${notificationPayload.client_name}, ${deliveryAddress} | Delivery earning: ₹${deliveryPartnerEarning.toFixed(2)}`,
        '/api/orders/delivery/offers',
      ]
    );

    await connection.query(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orderId, order.delivery_status, 'offer_pending', actorUser ? actorUser.id : null, actorUser ? actorUser.role : 'system', `Auto delivery offer sent to delivery person #${partner.id}`]
    );

    await connection.commit();
    return { orderId, offerId: offerResult.insertId, deliveryPersonId: partner.id, deliveryPersonName: partner.name, expiresInMinutes: DELIVERY_OFFER_EXPIRY_MINUTES, notification: notificationPayload };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function refreshDeliveryOffersForPerson(deliveryPersonId) {
  const charge = effectiveDeliveryCharge(0);
  const [result] = await pool.query(
    `UPDATE delivery_order_offers dof
     SET status = 'pending',
         response_note = NULL,
         responded_at = NULL,
         expires_at = ${deliveryOfferExpirySql()},
         delivery_charge = CASE WHEN COALESCE(dof.delivery_charge, 0) > 0 THEN dof.delivery_charge ELSE ? END,
         delivery_partner_earning = CASE
           WHEN COALESCE(dof.delivery_partner_earning, 0) > 0 THEN dof.delivery_partner_earning
           ELSE ?
         END,
         updated_at = CURRENT_TIMESTAMP
     FROM client_orders o
     WHERE o.id = dof.order_id
       AND dof.delivery_person_id = ?
       AND dof.status IN ('pending', 'expired')
       AND o.delivery_partner_id IS NULL
       AND o.delivery_status = 'offer_pending'`,
    [charge, charge, deliveryPersonId]
  );
  return Number(result.affectedRows || result.rowCount || 0);
}

async function ensureWaitingOfferForPerson(deliveryPersonId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [busyRows] = await connection.query(
      `SELECT id FROM client_orders
       WHERE delivery_partner_id = ?
         AND delivery_status IN ('assigned', 'ready_to_deliver', 'out_for_delivery')
       LIMIT 1`,
      [deliveryPersonId]
    );
    if (busyRows.length) {
      await connection.commit();
      return { created: false, reason: 'delivery_person_busy' };
    }

    const [orderRows] = await connection.query(
      `SELECT o.id, o.order_number, o.user_id, o.status, o.delivery_status, o.delivery_partner_id,
              o.client_name, o.client_phone, o.client_address, o.delivery_charge, o.total_amount,
              o.shipping_city, o.shipping_area, o.shipping_pincode, o.shipping_latitude, o.shipping_longitude,
              o.shipping_name, o.shipping_phone, o.shipping_address,
              COALESCE(o.delivery_otp, '') AS delivery_otp, COALESCE(o.pickup_otp, '') AS pickup_otp,
              v.name AS vendor_name, v.phone AS vendor_phone,
              vprof.business_name AS vendor_business_name, vprof.address AS vendor_address,
              vprof.city AS vendor_city, vprof.area AS vendor_area,
              COALESCE((
                SELECT SUM(COALESCE(coi.quantity, 0) * COALESCE(p.weight_kg, 0))
                FROM client_order_items coi
                INNER JOIN vendor_products vp ON vp.id = coi.vendor_product_id
                INNER JOIN products p ON p.id = vp.product_id
                WHERE coi.order_id = o.id
              ), 0) AS approx_total_weight_kg
       FROM client_orders o
       LEFT JOIN users v ON v.id = o.vendor_id
       LEFT JOIN vendor_profiles vprof ON vprof.user_id = o.vendor_id
       WHERE o.delivery_partner_id IS NULL
         AND (
           o.delivery_status = 'offer_pending'
           OR (
             o.delivery_status = 'pending'
             AND o.order_type = 'quotation'
             AND o.delivery_type = 'in_house_delivery'
           )
         )
         AND LOWER(COALESCE(o.status, '')) NOT IN ('delivered', 'completed', 'cancelled', 'canceled')
         AND EXISTS (
           SELECT 1
           FROM delivery_partner_settings dps
           WHERE dps.user_id = ?
             AND dps.is_active = 1
             AND LOWER(TRIM(dps.city)) = LOWER(COALESCE(NULLIF(TRIM(o.shipping_city), ''), NULLIF(TRIM(vprof.city), '')))
             AND (
               TRIM(COALESCE(dps.area, '*')) = '*'
               OR LOWER(TRIM(dps.area)) = LOWER(NULLIF(TRIM(o.shipping_area), ''))
               OR LOWER(TRIM(dps.area)) = LOWER(NULLIF(TRIM(o.shipping_pincode), ''))
               OR LOWER(TRIM(dps.area)) = LOWER(NULLIF(TRIM(o.shipping_city), ''))
               OR LOWER(TRIM(dps.area)) = LOWER(NULLIF(TRIM(vprof.area), ''))
             )
         )
       ORDER BY o.updated_at DESC, o.id DESC
       LIMIT 1
       FOR UPDATE OF o`,
      [deliveryPersonId]
    );
    if (!orderRows.length) {
      await connection.commit();
      return { created: false, reason: 'no_waiting_order' };
    }

    const order = orderRows[0];
    const pickupOtp = order.pickup_otp || generateOtp();
    const deliveryOtp = order.delivery_otp || generateOtp();
    const grossDeliveryCharge = effectiveDeliveryCharge(order.delivery_charge);
    const platformFee = Math.min(await deliveryPlatformFee(grossDeliveryCharge, connection), grossDeliveryCharge);
    const deliveryPartnerEarning = money(grossDeliveryCharge - platformFee);
    const pickupAddress = [order.vendor_address, order.vendor_city].filter(Boolean).join(', ') || order.vendor_city || 'Pickup location';
    const deliveryAddress = [order.shipping_address || order.client_address, order.shipping_area, order.shipping_city, order.shipping_pincode].filter(Boolean).join(', ') || order.shipping_area || 'Delivery area';
    const notificationPayload = {
      order_id: order.id,
      order_number: orderDisplayNumber(order),
      vendor_name: order.vendor_business_name || order.vendor_name || 'Vendor',
      vendor_phone: order.vendor_phone || '',
      vendor_address: pickupAddress,
      client_name: order.shipping_name || order.client_name || 'Client',
      client_phone: order.shipping_phone || order.client_phone || '',
      client_address: deliveryAddress,
      pickup_area: order.vendor_city || pickupAddress,
      delivery_area: order.vendor_area || order.shipping_area || order.shipping_city || '',
      delivery_charge: grossDeliveryCharge,
      platform_fee: platformFee,
      delivery_partner_earning: deliveryPartnerEarning,
      approx_total_weight_kg: Number(order.approx_total_weight_kg || 0),
    };

    await connection.query(
      `UPDATE client_orders
       SET delivery_method = 'in_house_auto',
           delivery_type = 'in_house_delivery',
           delivery_otp = ?,
           pickup_otp = ?,
           delivery_charge = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [deliveryOtp, pickupOtp, grossDeliveryCharge, order.id]
    );

    const [existingRows] = await connection.query(
      `SELECT id FROM delivery_order_offers
       WHERE order_id = ? AND delivery_person_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [order.id, deliveryPersonId]
    );

    let offerId;
    if (existingRows.length) {
      offerId = existingRows[0].id;
      await connection.query(
        `UPDATE delivery_order_offers
         SET status = 'pending',
             pickup_area = ?,
             delivery_area = ?,
             delivery_charge = ?,
             platform_fee = ?,
             delivery_partner_earning = ?,
             notification_payload = ?,
             response_note = NULL,
             responded_at = NULL,
             expires_at = ${deliveryOfferExpirySql()},
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [pickupAddress, deliveryAddress, grossDeliveryCharge, platformFee, deliveryPartnerEarning, JSON.stringify(notificationPayload), offerId]
      );
    } else {
      const [offerResult] = await connection.query(
        `INSERT INTO delivery_order_offers
         (order_id, delivery_person_id, status, pickup_area, delivery_area, delivery_charge, platform_fee, delivery_partner_earning, notification_payload, expires_at)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ${deliveryOfferExpirySql()})`,
        [order.id, deliveryPersonId, pickupAddress, deliveryAddress, grossDeliveryCharge, platformFee, deliveryPartnerEarning, JSON.stringify(notificationPayload)]
      );
      offerId = offerResult.insertId;
    }

    await connection.query(
      `UPDATE client_orders
       SET auto_delivery_offer_id = ?,
           delivery_status = 'offer_pending',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [offerId, order.id]
    );

    await connection.query(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
       VALUES (?, ?, 'offer_pending', ?, 'deliveryPerson', ?)`,
      [order.id, order.delivery_status, deliveryPersonId, `Delivery app made waiting offer visible to delivery person #${deliveryPersonId}`]
    );

    await connection.commit();
    return { created: true, orderId: Number(order.id), offerId: Number(offerId) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listDeliveryOffers(deliveryPersonId) {
  const [rows] = await pool.query(
    `SELECT dof.*, o.order_number, o.total_amount, o.status AS order_status, o.delivery_status,
            o.pickup_otp, o.delivery_otp, o.shipping_name, o.shipping_phone, o.shipping_address, o.shipping_area, o.shipping_city,
            v.name AS vendor_name, v.phone AS vendor_phone,
            vprof.business_name AS vendor_business_name, vprof.address AS pickup_address, vprof.city AS pickup_city
     FROM delivery_order_offers dof
     INNER JOIN client_orders o ON o.id = dof.order_id
     LEFT JOIN users v ON v.id = o.vendor_id
     LEFT JOIN vendor_profiles vprof ON vprof.user_id = o.vendor_id
     WHERE dof.delivery_person_id = ?
       AND (dof.status <> 'pending' OR dof.expires_at > CURRENT_TIMESTAMP)
     ORDER BY dof.created_at DESC, dof.id DESC`,
    [deliveryPersonId]
  );
  return rows.map((row) => ({
    ...row,
    total_amount: Number(row.total_amount || 0),
    delivery_charge: Number(row.delivery_charge || 0),
    platform_fee: Number(row.platform_fee || 0),
    delivery_partner_earning: Number(row.delivery_partner_earning || 0),
  }));
}

async function decideDeliveryOffer({ orderId, deliveryPersonId, decision, note = '' }) {
  const action = String(decision || '').toLowerCase();
  if (!['accept', 'reject'].includes(action)) {
    const error = new Error('Decision must be accept or reject');
    error.status = 422;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [offerRows] = await connection.query(
      `SELECT dof.*, o.order_number, o.delivery_status, o.delivery_partner_id,
              COALESCE(dpp.is_available, 0) AS person_is_available, dpp.last_seen_at
       FROM delivery_order_offers dof
       INNER JOIN client_orders o ON o.id = dof.order_id
       INNER JOIN delivery_person_profiles dpp ON dpp.user_id = dof.delivery_person_id
       WHERE dof.order_id = ? AND dof.delivery_person_id = ?
       ORDER BY dof.id DESC
       LIMIT 1 FOR UPDATE`,
      [orderId, deliveryPersonId]
    );
    if (!offerRows.length) {
      throw new Error('Delivery offer not found');
    }
    const offer = offerRows[0];
    if (offer.status !== 'pending') {
      throw new Error(`Delivery offer already ${offer.status}`);
    }
    if (new Date(offer.expires_at).getTime() < Date.now()) {
      await connection.query(`UPDATE delivery_order_offers SET status = 'expired', responded_at = CURRENT_TIMESTAMP WHERE id = ?`, [offer.id]);
      throw new Error('Delivery offer expired');
    }
    if (offer.delivery_partner_id) {
      throw new Error('Order already assigned');
    }

    if (action === 'reject') {
      await connection.query(`UPDATE delivery_order_offers SET status = 'rejected', response_note = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?`, [note || null, offer.id]);
      await connection.query(
        `UPDATE client_orders
         SET delivery_partner_id = NULL,
             delivery_status = 'pending',
             assigned_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [orderId]
      );
      await connection.query(
        `INSERT INTO delivery_person_activity_logs (delivery_person_id, actor_id, action, description, metadata)
         VALUES (?, ?, 'order_rejected', ?, ?)`,
        [deliveryPersonId, deliveryPersonId, note || `Rejected delivery offer for order #${orderDisplayNumber(offer)}`, JSON.stringify({ order_id: Number(orderId), offer_id: Number(offer.id) })]
      );
      await connection.query(
        `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
         VALUES (?, ?, 'pending', ?, 'deliveryPerson', ?)`,
        [orderId, offer.delivery_status, deliveryPersonId, note || `Delivery partner #${deliveryPersonId} rejected the order`]
      );
      await connection.commit();
      return { orderId, status: 'rejected' };
    }
    if (!Number(offer.person_is_available)) {
      throw new Error('You are not currently available for delivery');
    }

    await connection.query(
      `UPDATE delivery_order_offers SET status = 'accepted', response_note = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [note || null, offer.id]
    );
    await connection.query(
      `UPDATE client_orders
       SET delivery_partner_id = ?,
           delivery_method = 'in_house_auto',
           delivery_type = 'in_house_delivery',
           delivery_charge = CASE WHEN COALESCE(delivery_charge, 0) > 0 THEN delivery_charge ELSE ? END,
           delivery_earning = CASE WHEN COALESCE(delivery_earning, 0) > 0 THEN delivery_earning ELSE ? END,
           auto_delivery_offer_id = ?,
           delivery_status = 'assigned',
           assigned_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND delivery_partner_id IS NULL`,
      [
        deliveryPersonId,
        Number(offer.delivery_charge || 0),
        Number(offer.delivery_partner_earning || offer.delivery_charge || 0),
        offer.id,
        orderId,
      ]
    );
    await connection.query(
      `INSERT INTO delivery_person_activity_logs (delivery_person_id, actor_id, action, description, metadata)
       VALUES (?, ?, 'order_accepted', ?, ?)`,
      [deliveryPersonId, deliveryPersonId, `Accepted delivery offer for order #${orderDisplayNumber(offer)}`, JSON.stringify({ order_id: Number(orderId), offer_id: Number(offer.id) })]
    );
    await connection.query(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
       VALUES (?, ?, 'assigned', ?, 'deliveryPerson', ?)`,
      [orderId, offer.delivery_status, deliveryPersonId, 'Delivery partner accepted auto delivery offer']
    );
    await connection.commit();
    return { orderId, status: 'accepted', deliveryPartnerId: deliveryPersonId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function rejectAssignedDeliveryOrder(orderId, deliveryPersonId, note = '') {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [orderRows] = await connection.query(
      `SELECT id, order_number, delivery_status, delivery_partner_id
       FROM client_orders
       WHERE id = ? FOR UPDATE`,
      [orderId]
    );
    if (!orderRows.length) {
      const error = new Error('Order not found');
      error.status = 404;
      throw error;
    }
    const order = orderRows[0];
    if (Number(order.delivery_partner_id) !== Number(deliveryPersonId)) {
      const error = new Error('This order is not assigned to this delivery partner');
      error.status = 403;
      throw error;
    }
    if (['out_for_delivery', 'delivered'].includes(String(order.delivery_status || '').toLowerCase())) {
      const error = new Error('This order can no longer be rejected by the delivery partner');
      error.status = 409;
      throw error;
    }

    await connection.query(
      `UPDATE client_orders
       SET delivery_partner_id = NULL,
           delivery_status = 'pending',
           assigned_at = NULL,
           auto_delivery_offer_id = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [orderId]
    );
    await connection.query(
      `INSERT INTO delivery_person_activity_logs (delivery_person_id, actor_id, action, description, metadata)
       VALUES (?, ?, 'order_rejected', ?, ?)`,
      [
        deliveryPersonId,
        deliveryPersonId,
        note || `Rejected assigned order #${orderDisplayNumber(order)}`,
        JSON.stringify({ order_id: Number(orderId), rejected_assigned_order: true }),
      ]
    );
    await connection.query(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
       VALUES (?, ?, 'pending', ?, 'deliveryPerson', ?)`,
      [orderId, order.delivery_status, deliveryPersonId, note || `Delivery partner #${deliveryPersonId} rejected the assigned order`]
    );
    await connection.commit();
    return { orderId: Number(orderId), status: 'rejected', deliveryStatus: 'pending' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function processExpiredDeliveryOffers() {
  const [expiredOffers] = await pool.query(
    `SELECT id, order_id, delivery_person_id
     FROM delivery_order_offers
     WHERE status = 'pending' AND expires_at <= CURRENT_TIMESTAMP
     ORDER BY expires_at ASC
     LIMIT 100`
  );

  for (const offer of expiredOffers) {
    const [result] = await pool.query(
      `UPDATE delivery_order_offers
       SET status = 'expired', response_note = 'No response within 1 minute', responded_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
      [offer.id]
    );
    if (!result.affectedRows) continue;
    await pool.query(
      `INSERT INTO delivery_person_activity_logs (delivery_person_id, actor_id, action, description, metadata)
       VALUES (?, NULL, 'order_unaccepted', ?, ?)`,
      [offer.delivery_person_id, `No response within 1 minute for order #${offer.order_id}`, JSON.stringify({ order_id: Number(offer.order_id), offer_id: Number(offer.id) })]
    ).catch(() => {});
  }

  const [waitingOrders] = await pool.query(
    `SELECT o.id
     FROM client_orders o
     WHERE o.delivery_partner_id IS NULL
       AND o.delivery_status = 'offer_pending'
       AND NOT EXISTS (
         SELECT 1 FROM delivery_order_offers pending
         WHERE pending.order_id = o.id AND pending.status = 'pending' AND pending.expires_at > CURRENT_TIMESTAMP
       )
     ORDER BY o.updated_at ASC
     LIMIT 100`
  );
  const results = [];
  for (const order of waitingOrders) {
    try {
      results.push(await createAutoDeliveryOffer(order.id));
    } catch (error) {
      results.push({ orderId: order.id, pending: true, message: error.message });
    }
  }
  return results;
}

async function resendDeliveryOffer(orderId, actorUser = null) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [orderRows] = await connection.query(
      `SELECT id, order_number, status, delivery_status, delivery_partner_id, auto_delivery_offer_id,
              created_at, updated_at
       FROM client_orders
       WHERE id = ?
       FOR UPDATE`,
      [orderId]
    );
    if (!orderRows.length) {
      const error = new Error('Order not found');
      error.status = 404;
      throw error;
    }

    const order = orderRows[0];
    const orderStatus = String(order.status || '').toLowerCase();
    const deliveryStatus = String(order.delivery_status || '').toLowerCase();
    if (order.delivery_partner_id || ['accepted', 'assigned', 'ready_to_deliver', 'out_for_delivery', 'delivered'].includes(deliveryStatus)) {
      const error = new Error('This delivery has already been accepted or assigned');
      error.status = 409;
      throw error;
    }
    if (['delivered', 'completed', 'cancelled', 'canceled'].includes(orderStatus) || ['cancelled', 'canceled'].includes(deliveryStatus)) {
      const error = new Error('This delivery can no longer be resent');
      error.status = 409;
      throw error;
    }
    if (!order.auto_delivery_offer_id) {
      const lastAttemptAt = new Date(order.updated_at || order.created_at).getTime();
      const availableAt = lastAttemptAt + (2 * 60 * 1000);
      const remainingSeconds = Math.max(Math.ceil((availableAt - Date.now()) / 1000), 0);
      if (remainingSeconds > 0) {
        const error = new Error(`You can resend this delivery in ${remainingSeconds} seconds`);
        error.status = 429;
        error.retryAfter = remainingSeconds;
        throw error;
      }

      await connection.query(
        `UPDATE client_orders SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [orderId]
      );
      await connection.commit();
      const result = await createAutoDeliveryOffer(orderId, actorUser, {
        retryAttemptedDeliveryPeople: true,
      });
      return {
        ...result,
        resendAvailableAt: new Date(Date.now() + (2 * 60 * 1000)).toISOString(),
      };
    }

    const [offerRows] = await connection.query(
      `SELECT dof.*, u.name AS delivery_person_name
       FROM delivery_order_offers dof
       INNER JOIN users u ON u.id = dof.delivery_person_id
       WHERE dof.id = ? AND dof.order_id = ?
       FOR UPDATE OF dof`,
      [order.auto_delivery_offer_id, orderId]
    );
    if (!offerRows.length) {
      const error = new Error('The latest delivery offer could not be found');
      error.status = 409;
      throw error;
    }

    const offer = offerRows[0];
    if (String(offer.status || '').toLowerCase() === 'accepted') {
      const error = new Error('This delivery offer has already been accepted');
      error.status = 409;
      throw error;
    }

    const lastSentAt = new Date(offer.updated_at || offer.created_at).getTime();
    const availableAt = lastSentAt + (2 * 60 * 1000);
    const remainingSeconds = Math.max(Math.ceil((availableAt - Date.now()) / 1000), 0);
    if (remainingSeconds > 0) {
      const error = new Error(`You can resend this delivery in ${remainingSeconds} seconds`);
      error.status = 429;
      error.retryAfter = remainingSeconds;
      throw error;
    }

    const offerStatus = String(offer.status || '').toLowerCase();
    const offerExpiresAt = offer.expires_at ? new Date(offer.expires_at).getTime() : 0;
    const isLivePendingOffer = offerStatus === 'pending' && offerExpiresAt > Date.now();
    if (!isLivePendingOffer) {
      await connection.query(
        `UPDATE delivery_order_offers
         SET status = CASE WHEN status = 'accepted' THEN status ELSE 'expired' END,
             response_note = COALESCE(response_note, 'Superseded by admin resend'),
             responded_at = COALESCE(responded_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE order_id = ? AND status <> 'accepted'`,
        [orderId]
      );
      await connection.query(
        `UPDATE client_orders
         SET auto_delivery_offer_id = NULL,
             delivery_status = 'offer_pending',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [orderId]
      );
      await connection.query(
        `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
         VALUES (?, ?, 'offer_pending', ?, ?, ?)`,
        [
          orderId,
          order.delivery_status,
          actorUser ? actorUser.id : null,
          actorUser ? actorUser.role : 'system',
          `Admin requested a fresh delivery resend after ${offerStatus || 'stale'} offer #${offer.id}`,
        ]
      );
      await connection.commit();
      const result = await createAutoDeliveryOffer(orderId, actorUser, {
        retryAttemptedDeliveryPeople: true,
      });
      return {
        ...result,
        resendAvailableAt: new Date(Date.now() + (2 * 60 * 1000)).toISOString(),
      };
    }

    const grossDeliveryCharge = effectiveDeliveryCharge(order.delivery_charge);
    const platformFee = Math.min(await deliveryPlatformFee(grossDeliveryCharge, connection), grossDeliveryCharge);
    const deliveryPartnerEarning = money(grossDeliveryCharge - platformFee);

    await connection.query(
      `UPDATE delivery_order_offers
       SET status = 'pending', response_note = NULL, responded_at = NULL,
           delivery_charge = ?,
           platform_fee = ?,
           delivery_partner_earning = ?,
           expires_at = ${deliveryOfferExpirySql()}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [grossDeliveryCharge, platformFee, deliveryPartnerEarning, offer.id]
    );
    await connection.query(
      `UPDATE client_orders
       SET delivery_status = 'offer_pending',
           delivery_charge = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [grossDeliveryCharge, orderId]
    );
    await connection.query(
      `INSERT INTO user_notifications (user_id, title, message, link)
       VALUES (?, ?, ?, ?)`,
      [
        offer.delivery_person_id,
        `Delivery reminder for order #${orderDisplayNumber(order)}`,
        `Order #${orderDisplayNumber(order)} is still awaiting your response. Please accept or reject the delivery offer.`,
        '/api/orders/delivery/offers',
      ]
    );
    await connection.query(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
       VALUES (?, ?, 'offer_pending', ?, ?, ?)`,
      [
        orderId,
        order.delivery_status,
        actorUser ? actorUser.id : null,
        actorUser ? actorUser.role : 'system',
        `Delivery offer resent to delivery person #${offer.delivery_person_id}`,
      ]
    );

    await connection.commit();
    return {
      orderId: Number(orderId),
      offerId: Number(offer.id),
      deliveryPersonId: Number(offer.delivery_person_id),
      deliveryPersonName: offer.delivery_person_name,
      resendAvailableAt: new Date(Date.now() + (2 * 60 * 1000)).toISOString(),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function verifyPickupOTP(orderId, otp, actorUser = null) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT id, status, delivery_status, pickup_otp, delivery_partner_id FROM client_orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    if (!rows.length) throw new Error('Order not found');
    const order = rows[0];
    if (!order.delivery_partner_id) throw new Error('No delivery partner assigned');
    if (String(order.pickup_otp || '') !== String(otp || '').trim()) throw new Error('Invalid pickup OTP');

    await connection.query(
      `UPDATE client_orders
       SET status = 'on_the_way',
           delivery_status = 'out_for_delivery',
           delivery_otp = ?,
           delivery_otp_attempts = 0,
           delivery_otp_locked_at = NULL,
           delivery_otp_verified_at = NULL,
           ready_at = CURRENT_TIMESTAMP,
           status_updated_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [generateOtp(), orderId]
    );
    await connection.query(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
       VALUES (?, ?, 'on_the_way', ?, ?, ?)`,
      [orderId, order.status, actorUser ? actorUser.id : null, actorUser ? actorUser.role : null, 'Pickup verified; delivery is now on the way and tracking started']
    );
    await connection.commit();
    return { orderId, status: 'on_the_way', deliveryStatus: 'out_for_delivery', verified: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function markReadyToDeliver(orderId) {
  const [result] = await pool.query(
    `UPDATE client_orders
     SET delivery_status = 'ready_to_deliver',
         ready_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND delivery_status = 'assigned'`,
    [orderId]
  );

  if (result.affectedRows === 0) {
    throw new Error('Order not found or not in assigned status');
  }

  return { orderId, status: 'ready_to_deliver' };
}

async function markDelivered(orderId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id, delivery_partner_id FROM client_orders
       WHERE id = ? AND delivery_status IN ('assigned', 'ready_to_deliver', 'out_for_delivery')
       FOR UPDATE`,
      [orderId]
    );
    if (!rows.length) throw new Error('Order not found or cannot be delivered');
    await connection.query(
      `UPDATE client_orders
       SET delivery_status = 'delivered', delivered_at = CURRENT_TIMESTAMP,
           status = 'completed', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [orderId]
    );
    if (rows[0].delivery_partner_id) {
      await OrderWalletSettlement.settleDeliveryCompletion({
        orderId,
        deliveryPersonId: rows[0].delivery_partner_id,
        actorId: rows[0].delivery_partner_id,
        connection,
      });
      await releaseDeliveryPersonIfIdle(connection, rows[0].delivery_partner_id);
    }
    await connection.commit();
    return { orderId, status: 'completed', deliveryStatus: 'delivered' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getDeliveryTracking(orderId) {
  const [rows] = await pool.query(
    `SELECT o.id, o.order_number, o.user_id, o.status, o.delivery_status,
            o.delivery_partner_id, o.shipping_address, o.shipping_area, o.shipping_city,
            o.shipping_latitude, o.shipping_longitude,
            dp.name AS delivery_person_name, dp.phone AS delivery_person_phone,
            dpp.current_latitude AS delivery_person_latitude,
            dpp.current_longitude AS delivery_person_longitude,
            dpp.last_seen_at AS delivery_person_last_seen_at,
            vp.address AS pickup_address, vp.pickup_latitude, vp.pickup_longitude
     FROM client_orders o
     LEFT JOIN users dp ON dp.id = o.delivery_partner_id
     LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = o.delivery_partner_id
     LEFT JOIN vendor_profiles vp ON vp.user_id = o.vendor_id
     WHERE o.id = ?
     LIMIT 1`,
    [orderId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    order_id: Number(row.id),
    order_number: row.order_number || orderDisplayNumber(row),
    client_id: Number(row.user_id),
    status: normalizeStatus(row.status),
    delivery_status: row.delivery_status || 'pending',
    tracking_active: String(row.delivery_status || '').toLowerCase() === 'out_for_delivery',
    delivery_person_id: row.delivery_partner_id ? Number(row.delivery_partner_id) : null,
    delivery_person_name: row.delivery_person_name || '',
    delivery_person_phone: row.delivery_person_phone || '',
    delivery_person_latitude: row.delivery_person_latitude === null ? null : Number(row.delivery_person_latitude),
    delivery_person_longitude: row.delivery_person_longitude === null ? null : Number(row.delivery_person_longitude),
    delivery_person_last_seen_at: row.delivery_person_last_seen_at,
    pickup_address: row.pickup_address || '',
    pickup_latitude: row.pickup_latitude === null ? null : Number(row.pickup_latitude),
    pickup_longitude: row.pickup_longitude === null ? null : Number(row.pickup_longitude),
    delivery_address: [row.shipping_address, row.shipping_area, row.shipping_city].filter(Boolean).join(', '),
    delivery_latitude: row.shipping_latitude === null ? null : Number(row.shipping_latitude),
    delivery_longitude: row.shipping_longitude === null ? null : Number(row.shipping_longitude),
  };
}

async function verifyOTP(orderId, otp, { manualVerification = false, actorUser = null } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT o.id, o.order_number, o.user_id, o.status, o.delivery_otp, o.delivery_status, o.delivery_partner_id,
              COALESCE(o.delivery_otp_attempts, 0) AS delivery_otp_attempts,
              o.delivery_otp_locked_at,
              COALESCE(dof.delivery_charge, o.delivery_charge, 0) AS wallet_credit
       FROM client_orders o
       LEFT JOIN delivery_order_offers dof ON dof.id = o.auto_delivery_offer_id AND dof.status = 'accepted'
       WHERE o.id = ? FOR UPDATE OF o`,
      [orderId]
    );
    if (!rows.length) throw new Error('Order not found');
    const order = rows[0];
    if (['delivered', 'completed'].includes(String(order.status || '').toLowerCase()) || String(order.delivery_status || '').toLowerCase() === 'delivered') {
      const error = new Error('This order is already completed');
      error.status = 409;
      throw error;
    }
    if (String(order.delivery_status || '').toLowerCase() !== 'out_for_delivery') {
      const error = new Error('OTP can only be verified when the order is out for delivery');
      error.status = 409;
      throw error;
    }

    const attempts = Number(order.delivery_otp_attempts || 0);
    if (!manualVerification && (order.delivery_otp_locked_at || attempts >= DELIVERY_OTP_MAX_ATTEMPTS)) {
      const error = new Error('OTP attempt limit reached. Contact admin support for manual verification');
      error.status = 423;
      error.otpLocked = true;
      error.attempts = attempts;
      error.remainingAttempts = 0;
      throw error;
    }

    const nextAttempts = manualVerification ? attempts : attempts + 1;
    const otpMatches = manualVerification || String(order.delivery_otp || '') === String(otp || '').trim();
    if (!otpMatches) {
      const locked = nextAttempts >= DELIVERY_OTP_MAX_ATTEMPTS;
      await connection.query(
        `UPDATE client_orders
         SET delivery_otp_attempts = ?,
             delivery_otp_locked_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE delivery_otp_locked_at END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextAttempts, locked ? 1 : 0, orderId]
      );
      await connection.commit();
      return {
        orderId: Number(orderId),
        verified: false,
        otpAttempts: nextAttempts,
        maxAttempts: DELIVERY_OTP_MAX_ATTEMPTS,
        remainingAttempts: Math.max(DELIVERY_OTP_MAX_ATTEMPTS - nextAttempts, 0),
        otpLocked: locked,
      };
    }

    await connection.query(
      `UPDATE client_orders
       SET delivery_status = 'delivered', status = 'completed', delivered_at = CURRENT_TIMESTAMP,
           delivery_otp_attempts = ?, delivery_otp_verified_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextAttempts, orderId]
    );

    const deliverySettlement = await OrderWalletSettlement.settleDeliveryCompletion({
      orderId,
      deliveryPersonId: order.delivery_partner_id,
      actorId: actorUser ? actorUser.id : order.delivery_partner_id,
      connection,
    });
    const credit = deliverySettlement.deliveryEarning;
    if (order.delivery_partner_id) {
      await releaseDeliveryPersonIfIdle(connection, order.delivery_partner_id);
    }
    await connection.query(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
       VALUES (?, ?, 'completed', ?, ?, ?)`,
      [
        orderId,
        order.status,
        actorUser ? actorUser.id : order.delivery_partner_id,
        actorUser ? actorUser.role : 'deliveryPerson',
        manualVerification ? 'Delivery manually verified by admin/support after OTP lockout' : 'Customer delivery OTP verified',
      ]
    );
    await insertClientNotification(connection, order, 'completed');
    await connection.commit();
    return {
      orderId: Number(orderId),
      status: 'completed',
      deliveryStatus: 'delivered',
      verified: true,
      walletCredit: credit,
      otpAttempts: nextAttempts,
      maxAttempts: DELIVERY_OTP_MAX_ATTEMPTS,
      remainingAttempts: Math.max(DELIVERY_OTP_MAX_ATTEMPTS - nextAttempts, 0),
      otpLocked: false,
      manuallyVerified: manualVerification,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function countByStatus() {
  const [rows] = await pool.query(
    `SELECT delivery_status, COUNT(*) AS count
     FROM client_orders
     GROUP BY delivery_status`
  );

  const result = {};
  for (const row of rows) {
    result[row.delivery_status] = Number(row.count);
  }
  return result;
}

async function countByVendor(vendorId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM client_orders WHERE vendor_id = ?`,
    [vendorId]
  );
  return Number(rows[0].total || 0);
}

function deliveryProgressLabel(row) {
  const offerStatus = String(row.offer_status || '').toLowerCase();
  const deliveryStatus = String(row.delivery_status || '').toLowerCase();
  const orderStatus = normalizeStatus(row.status);
  if (orderStatus === 'delivered' || deliveryStatus === 'delivered') return 'Delivered';
  if (['cancelled', 'canceled'].includes(orderStatus) || ['cancelled', 'canceled'].includes(deliveryStatus)) return 'Cancelled';
  if (deliveryStatus === 'out_for_delivery') return 'Out for delivery';
  if (orderStatus === 'picked_up') return 'Picked up';
  if (deliveryStatus === 'ready_to_deliver') return 'Pickup pending';
  if (row.external_delivery_provider_id) return 'Delivery partner assigned';
  if (row.delivery_partner_id) return 'Delivery person assigned';
  if (!row.delivery_partner_id && row.latest_rejection_at) return 'Rejected';
  if (offerStatus === 'rejected') return 'Rejected';
  if (offerStatus === 'accepted') return 'Accepted';
  return 'Waiting for delivery person';
}

async function listInHouseDeliveryDashboard({ page = 1, limit = 20, search = '', status = '', city = '', deliveryPersonId = '', date = '' } = {}) {
  const currentPage = Math.max(parseInt(page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const offset = (currentPage - 1) * pageSize;
  const where = [
    `(o.delivery_method IN ('in_house_auto', 'own_delivery')
      OR o.external_delivery_provider_id IS NOT NULL
      OR dof.id IS NOT NULL
      OR dpp.user_id IS NOT NULL
      OR latest_rejection.delivery_person_id IS NOT NULL)`,
  ];
  const params = [];

  if (search) {
    const term = `%${String(search).trim()}%`;
    where.push(`(o.order_number ILIKE ? OR o.client_name ILIKE ? OR v.name ILIKE ? OR dp.name ILIKE ? OR o.shipping_address ILIKE ?)`);
    params.push(term, term, term, term, term);
  }
  if (city) {
    where.push(`LOWER(COALESCE(NULLIF(TRIM(o.shipping_city), ''), NULLIF(TRIM(vp.city), ''))) = LOWER(?)`);
    params.push(String(city).trim());
  }
  if (deliveryPersonId) {
    where.push(`COALESCE(o.delivery_partner_id, dof.delivery_person_id) = ?`);
    params.push(Number(deliveryPersonId));
  }
  if (date) {
    where.push(`DATE(o.created_at) = ?`);
    params.push(String(date).slice(0, 10));
  }
  if (status) {
    const value = String(status).trim().toLowerCase();
    if (value === 'waiting') {
      where.push(`o.delivery_partner_id IS NULL AND o.external_delivery_provider_id IS NULL AND COALESCE(dof.status, 'pending') = 'pending' AND o.delivery_status NOT IN ('delivered', 'cancelled')`);
    } else if (value === 'assigned') {
      where.push(`(o.delivery_partner_id IS NOT NULL OR o.external_delivery_provider_id IS NOT NULL) AND o.delivery_status = 'assigned'`);
    } else if (value === 'rejected') {
      where.push(`(dof.status = 'rejected' OR latest_rejection.created_at IS NOT NULL)`);
    } else if (value === 'accepted') {
      where.push(`dof.status = ?`);
      params.push(value);
    } else if (value === 'pickup_pending') {
      where.push(`o.delivery_status IN ('assigned', 'ready_to_deliver') AND o.status NOT IN ('picked_up', 'delivered', 'completed')`);
    } else if (value === 'picked_up') {
      where.push(`o.status = 'picked_up'`);
    } else if (value === 'out_for_delivery') {
      where.push(`o.delivery_status = 'out_for_delivery'`);
    } else if (value === 'delivered') {
      where.push(`(o.delivery_status = 'delivered' OR o.status IN ('delivered', 'completed'))`);
    } else if (value === 'cancelled') {
      where.push(`(o.delivery_status IN ('cancelled', 'canceled') OR o.status IN ('cancelled', 'canceled'))`);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const baseFrom = `
    FROM client_orders o
    LEFT JOIN users v ON v.id = o.vendor_id
    LEFT JOIN vendor_profiles vp ON vp.user_id = o.vendor_id
    LEFT JOIN users dp ON dp.id = o.delivery_partner_id
    LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = o.delivery_partner_id
    LEFT JOIN delivery_order_offers dof ON dof.id = o.auto_delivery_offer_id
    LEFT JOIN users offer_dp ON offer_dp.id = dof.delivery_person_id
    LEFT JOIN LATERAL (
      SELECT l.delivery_person_id, l.description, l.created_at
      FROM delivery_person_activity_logs l
      WHERE l.action = 'order_rejected'
        AND l.metadata->>'order_id' = CAST(o.id AS TEXT)
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 1
    ) latest_rejection ON TRUE
    LEFT JOIN users rejection_dp ON rejection_dp.id = latest_rejection.delivery_person_id
    LEFT JOIN area_definitions ad ON LOWER(TRIM(ad.city)) = LOWER(TRIM(o.shipping_city))
      AND LOWER(TRIM(ad.name)) = LOWER(TRIM(o.shipping_area))
  `;

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total ${baseFrom} ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT o.id, o.order_number, o.total_amount, o.status, o.delivery_status, o.delivery_method,
            o.delivery_partner_id, o.external_delivery_provider_id, o.external_delivery_provider_name,
            o.client_name, o.client_phone, o.shipping_address, o.shipping_area,
            o.shipping_city, o.shipping_pincode, o.shipping_latitude, o.shipping_longitude,
            o.delivery_otp, COALESCE(o.delivery_otp_attempts, 0) AS delivery_otp_attempts,
            o.delivery_otp_locked_at, o.delivery_otp_verified_at,
            o.assigned_at, o.ready_at, o.delivered_at, o.created_at, o.updated_at,
            v.name AS vendor_name, vp.business_name AS vendor_business_name, vp.address AS vendor_address,
            vp.city AS vendor_city,
            COALESCE(dp.name, offer_dp.name, rejection_dp.name) AS delivery_person_name,
            COALESCE(dp.email, offer_dp.email, rejection_dp.email) AS delivery_person_login,
            COALESCE(dp.phone, offer_dp.phone, rejection_dp.phone) AS delivery_person_phone,
            dof.delivery_person_id AS offered_delivery_person_id,
            latest_rejection.delivery_person_id AS latest_rejected_delivery_person_id,
            latest_rejection.description AS latest_rejection_reason,
            latest_rejection.created_at AS latest_rejection_at,
            dof.status AS offer_status, dof.pickup_area, dof.delivery_area,
            dof.expires_at AS offer_expires_at, dof.responded_at AS offer_responded_at,
            dof.created_at AS offer_created_at, dof.updated_at AS offer_updated_at,
            CASE
              WHEN ad.center_lat IS NOT NULL AND ad.center_lng IS NOT NULL
               AND o.shipping_latitude IS NOT NULL AND o.shipping_longitude IS NOT NULL
              THEN ROUND((SQRT(POWER(CAST(ad.center_lat AS DECIMAL) - CAST(o.shipping_latitude AS DECIMAL), 2) + POWER(CAST(ad.center_lng AS DECIMAL) - CAST(o.shipping_longitude AS DECIMAL), 2)) * 111)::numeric, 2)
              ELSE NULL
            END AS distance_km
     ${baseFrom}
     ${whereSql}
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const orders = rows.map((row) => ({
    id: row.id,
    order_number: row.order_number || orderDisplayNumber(row),
    vendor_name: row.vendor_business_name || row.vendor_name || '-',
    client_name: row.client_name || '-',
    pickup_location: row.pickup_area || [row.vendor_address, row.vendor_city].filter(Boolean).join(', ') || '-',
    delivery_location: row.delivery_area || [row.shipping_address, row.shipping_area, row.shipping_city, row.shipping_pincode].filter(Boolean).join(', ') || '-',
    distance_km: row.distance_km === null || row.distance_km === undefined ? null : Number(row.distance_km),
    order_value: Number(row.total_amount || 0),
    delivery_person_id: row.delivery_partner_id || row.offered_delivery_person_id || row.latest_rejected_delivery_person_id || null,
    external_delivery_provider_id: row.external_delivery_provider_id || null,
    external_delivery_provider_name: row.external_delivery_provider_name || '',
    delivery_person_assigned: Boolean(row.delivery_partner_id || row.external_delivery_provider_id),
    delivery_person_name: row.external_delivery_provider_name || row.delivery_person_name || '',
    delivery_provider_type: row.external_delivery_provider_id ? 'external' : 'internal',
    delivery_person_phone: row.delivery_person_phone || '',
    order_status: deliveryProgressLabel(row),
    raw_status: row.status,
    delivery_status: row.delivery_status,
    offer_status: row.offer_status || '',
    latest_rejected_delivery_person_id: row.latest_rejected_delivery_person_id || null,
    latest_rejection_reason: row.latest_rejection_reason || '',
    latest_rejection_at: row.latest_rejection_at || null,
    delivery_otp: row.delivery_otp || '',
    delivery_otp_attempts: Number(row.delivery_otp_attempts || 0),
    delivery_otp_max_attempts: DELIVERY_OTP_MAX_ATTEMPTS,
    delivery_otp_remaining_attempts: Math.max(DELIVERY_OTP_MAX_ATTEMPTS - Number(row.delivery_otp_attempts || 0), 0),
    delivery_otp_locked: Boolean(row.delivery_otp_locked_at) || Number(row.delivery_otp_attempts || 0) >= DELIVERY_OTP_MAX_ATTEMPTS,
    resend_available_at: !row.delivery_partner_id && !row.external_delivery_provider_id
      ? new Date(new Date(row.offer_updated_at || row.offer_created_at || row.updated_at || row.created_at).getTime() + (2 * 60 * 1000)).toISOString()
      : null,
    assigned_at: row.assigned_at,
    ready_at: row.ready_at,
    delivered_at: row.delivered_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  const [cityRows] = await pool.query(
    `SELECT DISTINCT COALESCE(NULLIF(TRIM(shipping_city), ''), NULLIF(TRIM(vp.city), '')) AS city
     FROM client_orders o
     LEFT JOIN vendor_profiles vp ON vp.user_id = o.vendor_id
     WHERE COALESCE(NULLIF(TRIM(shipping_city), ''), NULLIF(TRIM(vp.city), '')) IS NOT NULL
     ORDER BY city`
  );
  const [personRows] = await pool.query(
    `SELECT DISTINCT u.id, u.name
     FROM users u
     INNER JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
     WHERE u.is_deleted = 0
     ORDER BY u.name`
  );

  const total = Number(countRows[0] && countRows[0].total || 0);
  return {
    orders,
    filters: {
      cities: cityRows.map((row) => row.city).filter(Boolean),
      deliveryPersons: personRows,
    },
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    },
  };
}

async function listDeliveryPartnerStatuses({ search = '', status = '' } = {}) {
  const where = ["u.is_deleted = 0", "LOWER(u.role) = 'deliveryperson'"];
  const params = [];
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (search) {
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term);
    where.push(`(u.name ILIKE ? OR u.email ILIKE ? OR u.phone ILIKE ?)`);
  }

  const statusSql = `
    CASE
      WHEN active_order.delivery_status = 'out_for_delivery' THEN 'On Ride'
      WHEN active_order.id IS NOT NULL THEN 'On Order'
      WHEN LOWER(COALESCE(u.status, '')) <> 'active' OR COALESCE(dpp.is_available, 1) = 0 THEN 'Offline'
      ELSE 'Free'
    END`;

  if (['free', 'on order', 'on_order', 'on ride', 'on_ride', 'offline'].includes(normalizedStatus)) {
    params.push(normalizedStatus.replace('_', ' '));
    where.push(`LOWER(${statusSql}) = LOWER(?)`);
  }

  const [rows] = await pool.query(
    `WITH active_orders AS (
       SELECT o.id, o.order_number, o.delivery_partner_id, o.client_name, o.shipping_name,
              o.shipping_address, o.shipping_area, o.shipping_city, o.shipping_pincode,
              o.delivery_status, o.status, o.assigned_at, o.ready_at, o.status_updated_at, o.updated_at,
              v.name AS vendor_name, vp.business_name AS vendor_business_name,
              vp.address AS vendor_address, vp.city AS vendor_city,
              ROW_NUMBER() OVER (
                PARTITION BY o.delivery_partner_id
                ORDER BY
                  CASE WHEN o.delivery_status = 'out_for_delivery' THEN 1 ELSE 2 END,
                  COALESCE(o.status_updated_at, o.ready_at, o.assigned_at, o.updated_at) DESC,
                  o.id DESC
              ) AS rn
       FROM client_orders o
       LEFT JOIN users v ON v.id = o.vendor_id
       LEFT JOIN vendor_profiles vp ON vp.user_id = o.vendor_id
       WHERE o.delivery_partner_id IS NOT NULL
         AND o.delivery_status IN ('assigned', 'ready_to_deliver', 'out_for_delivery')
         AND LOWER(COALESCE(o.status, '')) NOT IN ('delivered', 'completed', 'cancelled', 'canceled')
     )
     SELECT u.id AS delivery_partner_id, u.name AS delivery_partner_name,
            ${statusSql} AS current_status,
            active_order.id AS current_order_id,
            active_order.order_number AS current_order_number,
            COALESCE(NULLIF(TRIM(active_order.shipping_name), ''), active_order.client_name, '') AS customer_name,
            COALESCE(
              NULLIF(TRIM(CONCAT_WS(', ', NULLIF(active_order.vendor_business_name, ''), NULLIF(active_order.vendor_address, ''), NULLIF(active_order.vendor_city, ''))), ''),
              NULLIF(TRIM(CONCAT_WS(', ', NULLIF(active_order.vendor_name, ''), NULLIF(active_order.vendor_city, ''))), ''),
              '-'
            ) AS pickup_location,
            COALESCE(
              NULLIF(TRIM(CONCAT_WS(', ', NULLIF(active_order.shipping_address, ''), NULLIF(active_order.shipping_area, ''), NULLIF(active_order.shipping_city, ''), NULLIF(active_order.shipping_pincode, ''))), ''),
              '-'
            ) AS delivery_location,
            COALESCE(
              active_order.status_updated_at,
              active_order.ready_at,
              active_order.assigned_at,
              active_order.updated_at,
              dpp.updated_at,
              dpp.last_seen_at,
              u.updated_at
            ) AS last_status_update_time
     FROM users u
     LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
     LEFT JOIN active_orders active_order ON active_order.delivery_partner_id = u.id AND active_order.rn = 1
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE ${statusSql}
         WHEN 'On Ride' THEN 1
         WHEN 'On Order' THEN 2
         WHEN 'Free' THEN 3
         ELSE 4
       END,
       u.name ASC`,
    params
  );

  const partners = rows.map((row) => ({
    delivery_partner_id: row.delivery_partner_id,
    delivery_partner_name: row.delivery_partner_name || '',
    current_status: row.current_status || 'Offline',
    current_order_id: row.current_order_id || null,
    current_order_number: row.current_order_number || (row.current_order_id ? orderDisplayNumber({ id: row.current_order_id }) : ''),
    customer_name: row.customer_name || '',
    pickup_location: row.current_order_id ? row.pickup_location || '-' : '',
    delivery_location: row.current_order_id ? row.delivery_location || '-' : '',
    last_status_update_time: row.last_status_update_time || null,
  }));

  return {
    partners,
    summary: partners.reduce((acc, partner) => {
      acc[partner.current_status] = (acc[partner.current_status] || 0) + 1;
      return acc;
    }, { Free: 0, 'On Order': 0, 'On Ride': 0, Offline: 0 }),
  };
}

async function getDeliveryPartnerRejectionDetails(deliveryPersonId) {
  const id = Number(deliveryPersonId || 0);
  if (!id) {
    const error = new Error('Valid delivery partner is required');
    error.status = 422;
    throw error;
  }

  const [personRows] = await pool.query(
    `SELECT u.id, u.name, u.phone, u.email, u.status,
            COALESCE(dpp.is_available, 1) AS is_available
     FROM users u
     LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
     WHERE u.id = ?
       AND u.is_deleted = 0
       AND ${deliveryRoleSql('u')}
     LIMIT 1`,
    [id]
  );
  if (!personRows.length) {
    const error = new Error('Delivery partner not found');
    error.status = 404;
    throw error;
  }

  const [rows] = await pool.query(
    `SELECT l.id AS log_id, l.description, l.created_at,
            COALESCE(NULLIF(l.metadata->>'order_id', ''), '0') AS order_id,
            o.order_number, o.client_name,
            dof.response_note
     FROM delivery_person_activity_logs l
     LEFT JOIN client_orders o ON CAST(o.id AS TEXT) = l.metadata->>'order_id'
     LEFT JOIN LATERAL (
       SELECT response_note
       FROM delivery_order_offers dof
       WHERE dof.order_id = o.id
         AND dof.delivery_person_id = l.delivery_person_id
         AND dof.status = 'rejected'
       ORDER BY dof.responded_at DESC NULLS LAST, dof.id DESC
       LIMIT 1
     ) dof ON TRUE
     WHERE l.delivery_person_id = ?
       AND l.action = 'order_rejected'
       AND l.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
     ORDER BY l.created_at DESC, l.id DESC`,
    [id]
  );

  const person = personRows[0];
  return {
    partner: {
      id: Number(person.id),
      name: person.name || '',
      phone: person.phone || '',
      email: person.email || '',
      status: person.status || '',
      is_blocked: String(person.status || '').toLowerCase() !== 'active',
      is_available: Boolean(Number(person.is_available)),
    },
    total_rejected_orders_7d: rows.length,
    rejected_orders: rows.map((row) => ({
      order_id: Number(row.order_id || 0) || null,
      order_number: row.order_number || (Number(row.order_id || 0) ? orderDisplayNumber({ id: row.order_id }) : ''),
      customer_name: row.client_name || '',
      date: row.created_at,
      reason: row.response_note || row.description || '',
    })),
  };
}

async function setDeliveryPartnerBlockStatus(deliveryPersonId, blocked, actorUser = null) {
  const id = Number(deliveryPersonId || 0);
  if (!id) {
    const error = new Error('Valid delivery partner is required');
    error.status = 422;
    throw error;
  }
  const status = blocked ? 'blocked' : 'active';
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [personRows] = await connection.query(
      `SELECT id FROM users
       WHERE id = ?
         AND is_deleted = 0
         AND ${deliveryRoleSql('users')}
       LIMIT 1`,
      [id]
    );
    if (!personRows.length) {
      const error = new Error('Delivery partner not found');
      error.status = 404;
      throw error;
    }
    await connection.query('UPDATE users SET status = ? WHERE id = ?', [status, id]);
    await connection.query('UPDATE delivery_partner_settings SET is_active = ? WHERE user_id = ?', [blocked ? 0 : 1, id]);
    await connection.query('UPDATE delivery_person_profiles SET is_available = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [blocked ? 0 : 1, id]);
    if (blocked) {
      await connection.query(
        `UPDATE delivery_order_offers
         SET status = 'expired',
             response_note = COALESCE(response_note, 'Delivery partner blocked by admin'),
             responded_at = COALESCE(responded_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE delivery_person_id = ?
           AND status = 'pending'`,
        [id]
      );
    }
    await connection.query(
      `INSERT INTO delivery_person_activity_logs (delivery_person_id, actor_id, action, description, metadata)
       VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        actorUser ? actorUser.id : null,
        blocked ? 'account_blocked' : 'account_unblocked',
        blocked ? 'Account blocked from delivery dashboard rejection popup' : 'Account unblocked from delivery dashboard rejection popup',
        JSON.stringify({ source: 'delivery_dashboard_rejections' }),
      ]
    );
    await connection.commit();
    return getDeliveryPartnerRejectionDetails(id);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  listAll,
  listByVendor,
  listByClient,
  findById,
  getOrderItems,
  assignDeliveryPartner,
  listFreeDeliveryPartnersForOrder,
  createAutoDeliveryOffer,
  ensureWaitingOfferForPerson,
  refreshDeliveryOffersForPerson,
  listDeliveryOffers,
  decideDeliveryOffer,
  rejectAssignedDeliveryOrder,
  processExpiredDeliveryOffers,
  resendDeliveryOffer,
  verifyPickupOTP,
  markReadyToDeliver,
  markDelivered,
  verifyOTP,
  getDeliveryTracking,
  listInHouseDeliveryDashboard,
  listDeliveryPartnerStatuses,
  getDeliveryPartnerRejectionDetails,
  setDeliveryPartnerBlockStatus,
  deliveryFinancials,
  countByStatus,
  countByVendor,
  getStatusHistory,
  getAllowedNextStatuses,
  getAllowedNextStatusesForOrder,
  updateStatus,
  statusLabel,
  normalizeOrder,
};
