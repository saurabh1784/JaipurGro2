const pool = require('../db');

/**
 * Fetch comprehensive detailed statistics & audit information for an order
 */
async function getOrderDetailedStats(orderId) {
  if (!orderId) return null;

  // 1. Fetch main order row with vendor, client, delivery partner details
  const [orders] = await pool.query(
    `SELECT 
        o.*,
        u_client.name AS client_user_name,
        u_client.email AS client_user_email,
        u_client.phone AS client_user_phone,
        u_vendor.name AS vendor_owner_name,
        u_vendor.phone AS vendor_phone,
        u_vendor.email AS vendor_email,
        vprof.business_name AS vendor_store_name,
        vprof.address AS vendor_address,
        vprof.city AS vendor_city,
        vprof.gst_number AS vendor_gst_number,
        u_rider.name AS rider_name,
        u_rider.phone AS rider_phone,
        u_rider.email AS rider_email,
        dpp.vehicle_number AS rider_vehicle_number,
        dpp.vehicle_type AS rider_vehicle_type
     FROM client_orders o
     LEFT JOIN users u_client ON u_client.id = o.user_id
     LEFT JOIN users u_vendor ON u_vendor.id = o.vendor_id
     LEFT JOIN vendor_profiles vprof ON vprof.user_id = o.vendor_id
     LEFT JOIN users u_rider ON u_rider.id = o.delivery_partner_id
     LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = o.delivery_partner_id
     WHERE o.id = ? LIMIT 1`,
    [orderId]
  );

  if (!orders || !orders.length) return null;
  const order = orders[0];

  // 2. Fetch Order Status History timestamps (Pickup & Delivery exact times)
  const [history] = await pool.query(
    `SELECT new_status, created_at, note 
     FROM order_status_history 
     WHERE order_id = ? 
     ORDER BY id ASC`,
    [orderId]
  );

  let pickupTime = null;
  let deliveredTime = null;
  let acceptedTime = order.ready_at || null;

  if (history && history.length) {
    for (const h of history) {
      const st = String(h.new_status || '').toLowerCase();
      if (st === 'accepted' || st === 'processing') {
        acceptedTime = acceptedTime || h.created_at;
      }
      if (st === 'picked_up' || st === 'out_for_delivery') {
        pickupTime = pickupTime || h.created_at;
      }
      if (st === 'delivered' || st === 'completed') {
        deliveredTime = deliveredTime || h.created_at;
      }
    }
  }

  // Fallback for timestamps if missing in history
  if (!deliveredTime && order.delivery_otp_verified_at) {
    deliveredTime = order.delivery_otp_verified_at;
  }
  if (!deliveredTime && String(order.delivery_status || '').toLowerCase() === 'delivered') {
    deliveredTime = order.updated_at;
  }

  // 3. Fetch Product Item List with Base Price, Bid Price, and HSN Code
  const [items] = await pool.query(
    `SELECT 
        coi.*,
        p.name AS catalog_product_name,
        p.hsn_code AS product_hsn_code,
        p.price AS catalog_base_price,
        p.mrp AS catalog_mrp,
        vp.product_name AS vendor_product_name,
        vp.price AS vendor_base_price,
        vp.image_url AS vendor_image_url,
        p.image_url AS product_image_url
     FROM client_order_items coi
     LEFT JOIN vendor_products vp ON vp.id = coi.vendor_product_id
     LEFT JOIN products p ON p.id = vp.product_id
     WHERE coi.order_id = ?`,
    [orderId]
  );

  const formattedItems = (items || []).map((item) => {
    const qty = Number(item.quantity || 1);
    const bidUnitPrice = Number(item.unit_price || 0); // Agreed / Bid Price
    const baseUnitPrice = Number(item.catalog_base_price || item.catalog_mrp || item.vendor_base_price || bidUnitPrice); // Original Base MRP/Price
    const itemTotal = qty * bidUnitPrice;
    const hsnCode = item.product_hsn_code || '1006';
    const productName = item.catalog_product_name || item.vendor_product_name || item.variant_name || 'Grocery Item';
    const imageUrl = item.vendor_image_url || item.product_image_url || '/default.png';

    return {
      id: item.id,
      productName,
      unit: item.unit || 'unit',
      quantity: qty,
      hsnCode,
      baseUnitPrice,
      bidUnitPrice,
      itemTotal,
      imageUrl,
    };
  });

  return {
    orderId: order.id,
    orderNumber: order.order_number || `#${order.id}`,
    status: order.status || 'pending',
    deliveryStatus: order.delivery_status || 'pending',
    paymentMethod: String(order.payment_method || 'COD').toUpperCase(),
    paymentStatus: String(order.payment_status || 'pending').toUpperCase(),
    deliveryOtp: order.delivery_otp || '-',

    // Timestamps
    createdAt: order.created_at,
    acceptedAt: acceptedTime,
    pickedUpAt: pickupTime,
    deliveredAt: deliveredTime,

    // Vendor Details
    vendor: {
      id: order.vendor_id,
      storeName: order.vendor_store_name || order.vendor_owner_name || 'Groxen Vendor Store',
      ownerName: order.vendor_owner_name || 'N/A',
      phone: order.vendor_phone || 'N/A',
      email: order.vendor_email || 'N/A',
      address: order.vendor_address || 'N/A',
      city: order.vendor_city || 'Jaipur',
      gstNumber: order.vendor_gst_number || 'N/A',
    },

    // Client Details
    client: {
      id: order.user_id,
      name: order.shipping_name || order.client_name || order.client_user_name || 'Customer',
      phone: order.shipping_phone || order.client_phone || order.client_user_phone || 'N/A',
      email: order.client_user_email || 'N/A',
      address: order.shipping_address || order.client_address || 'N/A',
      area: order.shipping_area || '',
      city: order.shipping_city || 'Jaipur',
      pincode: order.shipping_pincode || '',
    },

    // Delivery Partner Details
    deliveryPartner: {
      id: order.delivery_partner_id,
      name: order.rider_name || (order.delivery_partner_id ? 'Assigned Rider' : 'Unassigned'),
      phone: order.rider_phone || 'N/A',
      email: order.rider_email || 'N/A',
      vehicleNumber: order.rider_vehicle_number || 'N/A',
      vehicleType: order.rider_vehicle_type || 'Two Wheeler',
    },

    // Financial Totals
    financials: {
      subtotalAmount: Number(order.subtotal_amount || 0),
      discountAmount: Number(order.discount_amount || order.savings_amount || 0),
      deliveryCharge: Number(order.delivery_charge || 0),
      platformFee: Number(order.platform_fee || 0),
      totalAmount: Number(order.total_amount || 0),
    },

    // Product List
    items: formattedItems,
  };
}

/**
 * List orders with search, date range, status filters, and pagination
 */
async function searchOrderInfoList({ search = '', startDate = '', endDate = '', status = '', page = 1, limit = 25 }) {
  const pageNum = Math.max(1, Number(page || 1));
  const limitNum = Math.max(1, Math.min(100, Number(limit || 25)));
  const offset = (pageNum - 1) * limitNum;

  let whereClauses = [];
  let params = [];

  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    whereClauses.push(`(
      CAST(o.id AS VARCHAR) LIKE ? OR 
      o.order_number LIKE ? OR 
      o.client_name LIKE ? OR 
      o.shipping_name LIKE ? OR 
      o.shipping_phone LIKE ? OR 
      u_client.name LIKE ? OR 
      u_client.phone LIKE ? OR 
      vprof.business_name LIKE ? OR 
      u_vendor.name LIKE ? OR 
      u_rider.name LIKE ?
    )`);
    params.push(q, q, q, q, q, q, q, q, q, q);
  }

  if (status && status.trim()) {
    whereClauses.push(`(LOWER(o.status) = ? OR LOWER(o.delivery_status) = ?)`);
    params.push(status.trim().toLowerCase(), status.trim().toLowerCase());
  }

  if (startDate && startDate.trim()) {
    whereClauses.push(`o.created_at >= ?`);
    params.push(`${startDate.trim()} 00:00:00`);
  }

  if (endDate && endDate.trim()) {
    whereClauses.push(`o.created_at <= ?`);
    params.push(`${endDate.trim()} 23:59:59`);
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Count total matching rows
  const [countRows] = await pool.query(
    `SELECT COUNT(o.id) AS total
     FROM client_orders o
     LEFT JOIN users u_client ON u_client.id = o.user_id
     LEFT JOIN users u_vendor ON u_vendor.id = o.vendor_id
     LEFT JOIN vendor_profiles vprof ON vprof.user_id = o.vendor_id
     LEFT JOIN users u_rider ON u_rider.id = o.delivery_partner_id
     ${whereSql}`,
    params
  );

  const totalCount = Number(countRows && countRows[0] ? countRows[0].total : 0);

  // Fetch page orders
  const [orders] = await pool.query(
    `SELECT 
        o.id,
        o.order_number,
        o.created_at,
        o.status,
        o.delivery_status,
        o.payment_method,
        o.payment_status,
        o.total_amount,
        o.delivery_otp,
        COALESCE(o.shipping_name, o.client_name, u_client.name) AS client_name,
        COALESCE(o.shipping_phone, o.client_phone, u_client.phone) AS client_phone,
        COALESCE(vprof.business_name, u_vendor.name) AS vendor_name,
        u_rider.name AS rider_name
     FROM client_orders o
     LEFT JOIN users u_client ON u_client.id = o.user_id
     LEFT JOIN users u_vendor ON u_vendor.id = o.vendor_id
     LEFT JOIN vendor_profiles vprof ON vprof.user_id = o.vendor_id
     LEFT JOIN users u_rider ON u_rider.id = o.delivery_partner_id
     ${whereSql}
     ORDER BY o.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limitNum, offset]
  );

  return {
    orders: orders || [],
    totalCount,
    currentPage: pageNum,
    totalPages: Math.ceil(totalCount / limitNum),
  };
}

module.exports = {
  getOrderDetailedStats,
  searchOrderInfoList,
};
