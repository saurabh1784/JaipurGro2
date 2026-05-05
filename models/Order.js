const pool = require('../db');

function normalizeOrder(row, includeItems = false) {
  if (!row) return null;
  const order = {
    id: row.id,
    user_id: row.user_id,
    vendor_id: row.vendor_id || null,
    client_name: row.client_name || '',
    client_phone: row.client_phone || '',
    client_address: row.client_address || '',
    total_amount: Number(row.total_amount || 0),
    status: row.status,
    delivery_status: row.delivery_status || 'pending',
    delivery_partner_id: row.delivery_partner_id || null,
    delivery_partner_name: row.delivery_partner_name || '',
    delivery_otp: row.delivery_otp || '',
    assigned_at: row.assigned_at,
    ready_at: row.ready_at,
    delivered_at: row.delivered_at,
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
      vendor_name: item.vendor_name || '',
      vendor_business_name: item.vendor_business_name || '',
    }));
  }

  return order;
}

async function listAll({ page = 1, limit = 10, search = '', status = '', deliveryStatus = '', vendorId = '', clientId = '' } = {}) {
  const currentPage = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(Math.max(1, parseInt(limit, 10) || 10), 100);
  const offset = (currentPage - 1) * pageSize;

  const where = [];
  const params = [];

  if (search) {
    where.push('(o.client_name LIKE ? OR o.client_phone LIKE ? OR o.client_address LIKE ?)');
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term);
  }
  if (status) {
    where.push('o.status = ?');
    params.push(status);
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

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM client_orders o ${whereSql}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT o.*,
            v.name AS vendor_name,
            vp.business_name AS vendor_business_name,
            dp.name AS delivery_partner_name
     FROM client_orders o
     LEFT JOIN users v ON v.id = o.vendor_id
     LEFT JOIN vendor_profiles vp ON vp.user_id = o.vendor_id
     LEFT JOIN users dp ON dp.id = o.delivery_partner_id
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

async function listByVendor(vendorId) {
  const [rows] = await pool.query(
    `SELECT o.*,
            v.name AS vendor_name,
            vp.business_name AS vendor_business_name,
            dp.name AS delivery_partner_name
     FROM client_orders o
     LEFT JOIN users v ON v.id = o.vendor_id
     LEFT JOIN vendor_profiles vp ON vp.user_id = o.vendor_id
     LEFT JOIN users dp ON dp.id = o.delivery_partner_id
     WHERE o.vendor_id = ?
     ORDER BY o.created_at DESC, o.id DESC`,
    [vendorId]
  );

  return rows.map(normalizeOrder);
}

async function listByClient(clientId) {
  const [rows] = await pool.query(
    `SELECT o.*,
            v.name AS vendor_name,
            vp.business_name AS vendor_business_name,
            dp.name AS delivery_partner_name
     FROM client_orders o
     LEFT JOIN users v ON v.id = o.vendor_id
     LEFT JOIN vendor_profiles vp ON vp.user_id = o.vendor_id
     LEFT JOIN users dp ON dp.id = o.delivery_partner_id
     WHERE o.user_id = ?
     ORDER BY o.created_at DESC, o.id DESC`,
    [clientId]
  );

  return rows.map(normalizeOrder);
}

async function findById(orderId) {
  const [rows] = await pool.query(
    `SELECT o.*,
            v.name AS vendor_name,
            vp.business_name AS vendor_business_name,
            dp.name AS delivery_partner_name
     FROM client_orders o
     LEFT JOIN users v ON v.id = o.vendor_id
     LEFT JOIN vendor_profiles vp ON vp.user_id = o.vendor_id
     LEFT JOIN users dp ON dp.id = o.delivery_partner_id
     WHERE o.id = ?
     LIMIT 1`,
    [orderId]
  );

  return normalizeOrder(rows[0]);
}

async function getOrderItems(orderId) {
  const [rows] = await pool.query(
    `SELECT oi.*,
            p.name AS product_name,
            vp.vendor_id,
            v.name AS vendor_name,
            vp.business_name AS vendor_business_name
     FROM client_order_items oi
     INNER JOIN vendor_products vp ON vp.id = oi.vendor_product_id
     INNER JOIN users v ON v.id = vp.vendor_id
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
    quantity: Number(row.quantity || 0),
    unit_price: Number(row.unit_price || 0),
    line_total: Number(row.unit_price * row.quantity || 0).toFixed(2),
    vendor_name: row.vendor_name,
    vendor_business_name: row.vendor_business_name,
  }));
}

async function assignDeliveryPartner(orderId, partnerId, otp) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Verify order exists
    const [orderRows] = await connection.query(
      'SELECT id, status, delivery_status FROM client_orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    if (!orderRows.length) {
      throw new Error('Order not found');
    }

    const order = orderRows[0];
    if (order.status !== 'pending' && order.delivery_status !== 'pending') {
      throw new Error('Only orders in pending status can be assigned a delivery partner');
    }

    // Verify partner exists and is Staff role
    const [partnerRows] = await connection.query(
      `SELECT id, name, role FROM users 
       WHERE id = ? AND status = 'active' AND is_deleted = 0 AND LOWER(role) = 'staff'`,
      [partnerId]
    );

    // Update order
    await connection.query(
      `UPDATE client_orders
       SET delivery_partner_id = ?,
           delivery_otp = ?,
           delivery_status = 'assigned',
           assigned_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [partnerId, otp, orderId]
    );

    await connection.commit();
    return { orderId, partnerId, otp };
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
  normalizeOrder,
};
