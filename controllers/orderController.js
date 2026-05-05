const Order = require('../models/Order');
const User = require('../models/User');
const pool = require('../db');

function wantsJson(req) {
  return req.baseUrl.startsWith('/api') || req.query.format === 'json' || req.accepts(['html', 'json']) === 'json';
}

// Admin/Staff - List all orders with filters
async function index(req, res) {
  if (!wantsJson(req)) {
    return res.render('orders', {
      user: req.session.user,
      shell: req.session.shell || null, // shell may be set by middleware
    });
  }

  try {
    const result = await Order.listAll({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      status: req.query.status,
      deliveryStatus: req.query.delivery_status,
      vendorId: req.query.vendor_id,
      clientId: req.query.client_id,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Order list error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch orders' });
  }
}

// Admin/Staff - Get order details
async function show(req, res) {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const items = await Order.getOrderItems(req.params.id);
    return res.json({ success: true, order, items });
  } catch (error) {
    console.error('Order show error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch order' });
  }
}

// Admin/Staff - Assign delivery partner with OTP
async function assignDelivery(req, res) {
  const { partner_id, otp } = req.body;

  if (!partner_id || !otp) {
    return res.status(422).json({ success: false, message: 'Partner ID and OTP are required' });
  }

  try {
    const result = await Order.assignDeliveryPartner(req.params.id, partner_id, otp);
    return res.json({ success: true, message: 'Delivery partner assigned', ...result });
  } catch (error) {
    console.error('Assign delivery error:', error);
    return res.status(400).json({ success: false, message: error.message });
  }
}

// Admin/Staff - Mark order as ready to deliver
async function readyToDeliver(req, res) {
  try {
    const result = await Order.markReadyToDeliver(req.params.id);
    return res.json({ success: true, message: 'Order marked as ready to deliver', ...result });
  } catch (error) {
    console.error('Ready to deliver error:', error);
    return res.status(400).json({ success: false, message: error.message });
  }
}

// Vendor - List orders for this vendor
async function vendorOrders(req, res) {
  if (!wantsJson(req)) {
    return res.render('vendor-orders', {
      user: req.session.user,
    });
  }

  try {
    const orders = await Order.listByVendor(req.session.user.id);
    const ordersWithItems = [];
    for (const order of orders) {
      const items = await Order.getOrderItems(order.id);
      ordersWithItems.push({ ...order, items });
    }
    return res.json({ success: true, orders: ordersWithItems });
  } catch (error) {
    console.error('Vendor orders error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch orders' });
  }
}

// Vendor - Get single order details
async function vendorOrderDetail(req, res) {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Verify this order belongs to the vendor
    if (order.vendor_id !== req.session.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const items = await Order.getOrderItems(order.id);
    return res.json({ success: true, order, items });
  } catch (error) {
    console.error('Vendor order detail error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch order' });
  }
}

// Client - List my orders
async function clientOrders(req, res) {
  if (!wantsJson(req)) {
    return res.render('client-orders', {
      user: req.session.user,
    });
  }

  try {
    const orders = await Order.listByClient(req.session.user.id);
    const ordersWithItems = [];
    for (const order of orders) {
      const items = await Order.getOrderItems(order.id);
      ordersWithItems.push({ ...order, items });
    }
    return res.json({ success: true, orders: ordersWithItems });
  } catch (error) {
    console.error('Client orders error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch orders' });
  }
}

// Client - Get single order details
async function clientOrderDetail(req, res) {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Verify this order belongs to the client
    if (order.user_id !== req.session.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const items = await Order.getOrderItems(order.id);
    return res.json({ success: true, order, items });
  } catch (error) {
    console.error('Client order detail error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch order' });
  }
}

// Admin/Staff - Get available delivery partners (staff users)
async function getDeliveryPartners(req, res) {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, phone FROM users WHERE role = "Staff" AND status = "active" AND is_deleted = 0 ORDER BY name'
    );
    return res.json({ success: true, partners: rows });
  } catch (error) {
    console.error('Get partners error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch partners' });
  }
}

// Admin dashboard stats
async function dashboardStats(req, res) {
  try {
    const statusCounts = await Order.countByStatus();
    const [recentOrders] = await pool.query(
      `SELECT o.id, o.total_amount, o.status, o.delivery_status, o.client_name, o.created_at,
              v.name AS vendor_name
       FROM client_orders o
       LEFT JOIN users v ON v.id = o.vendor_id
       ORDER BY o.created_at DESC
       LIMIT 10`
    );

    return res.json({ success: true, statusCounts, recentOrders });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch stats' });
  }
}

module.exports = {
  index,
  show,
  assignDelivery,
  readyToDeliver,
  vendorOrders,
  vendorOrderDetail,
  clientOrders,
  clientOrderDetail,
  getDeliveryPartners,
  dashboardStats,
};
