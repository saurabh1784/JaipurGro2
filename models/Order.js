const pool = require('../db');
const AreaDefinition = require('./AreaDefinition');

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
    vendor_country: row.vendor_country || '',
    vendor_state: row.vendor_state || '',
    vendor_city: row.vendor_city || '',
    vendor_services: row.vendor_services || '',
    subtotal_amount: Number(row.subtotal_amount || row.total_amount || 0),
    discount_amount: Number(row.discount_amount || 0),
    savings_amount: Number(row.savings_amount || row.discount_amount || 0),
    delivery_charge: Number(row.delivery_charge || 0),
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
    delivery_partner_id: row.delivery_partner_id || null,
    delivery_partner_name: row.delivery_method === 'own_delivery' ? 'Own Delivery' : row.delivery_partner_name || '',
    delivery_otp: row.delivery_otp || '',
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
            vp.address AS vendor_address,
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
            vp.address AS vendor_address,
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
            vp.address AS vendor_address,
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
            vp.address AS vendor_address,
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
  if (role === 'admin' || role === 'superadmin' || role === 'staff') return ADMIN_TRANSITIONS[status] || [];
  return [];
}

function getAllowedNextStatusesForOrder(order, actorRole) {
  const role = String(actorRole || '').toLowerCase();
  let statuses = getAllowedNextStatuses(order.status, role);
  if (role === 'vendor') {
    const hasDeliveryPartner = Boolean(order.delivery_partner_id);
    statuses = statuses.filter((status) => {
      if ([ORDER_STATUS.PICKED_UP, ORDER_STATUS.ON_THE_WAY].includes(status)) {
        return hasDeliveryPartner;
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
              shipping_pincode, shipping_latitude, shipping_longitude
       FROM client_orders
       WHERE id = ? FOR UPDATE`,
      [orderId]
    );
    if (!orderRows.length) {
      throw new Error('Order not found');
    }

    const order = orderRows[0];
    const assignableDeliveryStatuses = ['pending', 'assigned', 'ready_to_deliver'];
    const deliveryStatus = String(order.delivery_status || 'pending').toLowerCase();
    const orderStatus = String(order.status || '').toLowerCase();
    if (!assignableDeliveryStatuses.includes(deliveryStatus) || ['delivered', 'completed'].includes(orderStatus)) {
      throw new Error('Delivery partner can be assigned before the order is out for delivery or delivered');
    }

    if (String(partnerId) === 'own_delivery') {
      const ownDelivery = await AreaDefinition.isOwnDeliveryActiveForLocation({
        latitude: order.shipping_latitude,
        longitude: order.shipping_longitude,
        city: order.shipping_city,
        area: order.shipping_area || order.shipping_pincode,
      }, connection);
      if (!ownDelivery.active) {
        throw new Error('Own Delivery is not active for this order area');
      }

      await connection.query(
        `UPDATE client_orders
         SET delivery_partner_id = NULL,
             delivery_method = 'own_delivery',
             delivery_otp = ?,
             delivery_charge = ?,
             otp_set_by = ?,
             otp_set_at = CURRENT_TIMESTAMP,
             delivery_status = CASE WHEN delivery_status = 'ready_to_deliver' THEN delivery_status ELSE 'assigned' END,
             assigned_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [otp, deliveryCharge, actorUser ? actorUser.id : null, orderId]
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
          `OTP set, delivery charge ${deliveryCharge}, and Own Delivery assigned`,
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
      return { orderId, partnerId: 'own_delivery', otp, deliveryCharge, otpSetBy: actorUser ? actorUser.id : null };
    }

    const mappedDeliveryArea = await AreaDefinition.findMatchingArea({
      latitude: order.shipping_latitude,
      longitude: order.shipping_longitude,
      city: order.shipping_city,
      area: order.shipping_area || order.shipping_pincode,
    }, connection);
    const mappedDeliveryCity = mappedDeliveryArea && mappedDeliveryArea.city ? mappedDeliveryArea.city : null;
    const mappedDeliveryAreaName = mappedDeliveryArea && mappedDeliveryArea.name ? mappedDeliveryArea.name : null;

    // Verify partner exists, is Staff role, and is enabled for the order city/area.
    const [partnerRows] = await connection.query(
      `SELECT u.id, u.name, u.role
       FROM users u
       INNER JOIN client_orders o ON o.id = ?
       LEFT JOIN (
         SELECT coi.order_id, MIN(vpi.vendor_id) AS vendor_id
         FROM client_order_items coi
         INNER JOIN vendor_products vpi ON vpi.id = coi.vendor_product_id
         GROUP BY coi.order_id
       ) item_vendor ON item_vendor.order_id = o.id
       LEFT JOIN client_profiles cp ON cp.user_id = o.user_id
       LEFT JOIN vendor_profiles vp ON vp.user_id = COALESCE(o.vendor_id, item_vendor.vendor_id)
       LEFT JOIN delivery_partner_settings dps
         ON dps.user_id = u.id
        AND dps.is_active = 1
        AND LOWER(TRIM(dps.city)) = LOWER(COALESCE(NULLIF(TRIM(?), ''), NULLIF(TRIM(o.shipping_city), ''), NULLIF(TRIM(cp.city), ''), NULLIF(TRIM(vp.city), '')))
        AND (
          TRIM(COALESCE(dps.area, '*')) = '*'
          OR LOWER(TRIM(dps.area)) = LOWER(COALESCE(NULLIF(TRIM(?), ''), NULLIF(TRIM(o.shipping_area), ''), NULLIF(TRIM(o.shipping_pincode), ''), NULLIF(TRIM(o.shipping_address), '')))
        )
       WHERE u.id = ?
         AND LOWER(u.status) = 'active'
         AND u.is_deleted = 0
         AND LOWER(u.role) = 'staff'
         AND dps.id IS NOT NULL
       LIMIT 1`,
      [orderId, mappedDeliveryCity, mappedDeliveryAreaName, partnerId]
    );
    if (!partnerRows.length) {
      throw new Error('Delivery partner service is not active for this order area');
    }

    // Update order
    await connection.query(
      `UPDATE client_orders
       SET delivery_partner_id = ?,
           delivery_method = 'partner',
           delivery_otp = ?,
           delivery_charge = ?,
           otp_set_by = ?,
           otp_set_at = CURRENT_TIMESTAMP,
           delivery_status = CASE WHEN delivery_status = 'ready_to_deliver' THEN delivery_status ELSE 'assigned' END,
           assigned_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [partnerId, otp, deliveryCharge, actorUser ? actorUser.id : null, orderId]
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
        `OTP set, delivery charge ${deliveryCharge}, and delivery partner #${partnerId} assigned`,
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
    return { orderId, partnerId, otp, deliveryCharge, otpSetBy: actorUser ? actorUser.id : null };
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
  const [result] = await pool.query(
    `UPDATE client_orders
     SET delivery_status = 'delivered',
         delivered_at = CURRENT_TIMESTAMP,
         status = 'completed',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND delivery_status IN ('assigned', 'ready_to_deliver', 'out_for_delivery')`,
    [orderId]
  );

  if (result.affectedRows === 0) {
    throw new Error('Order not found or cannot be delivered');
  }

  return { orderId, status: 'delivered' };
}

async function verifyOTP(orderId, otp) {
  const [rows] = await pool.query(
    'SELECT id, delivery_otp, delivery_status FROM client_orders WHERE id = ?',
    [orderId]
  );

  if (!rows.length) {
    throw new Error('Order not found');
  }

  const order = rows[0];
  if (order.delivery_otp !== otp) {
    throw new Error('Invalid OTP');
  }

  // OTP verified - mark as out_for_delivery or delivered based on status
  const newStatus = order.delivery_status === 'assigned' ? 'out_for_delivery' : order.delivery_status;
  
  await pool.query(
    `UPDATE client_orders
     SET delivery_status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [newStatus, orderId]
  );

  return { orderId, status: newStatus, verified: true };
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

module.exports = {
  listAll,
  listByVendor,
  listByClient,
  findById,
  getOrderItems,
  assignDeliveryPartner,
  markReadyToDeliver,
  markDelivered,
  verifyOTP,
  countByStatus,
  countByVendor,
  getStatusHistory,
  getAllowedNextStatuses,
  getAllowedNextStatusesForOrder,
  updateStatus,
  statusLabel,
  normalizeOrder,
};
