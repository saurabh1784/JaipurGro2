const crypto = require('crypto');
const Order = require('../models/Order');
const User = require('../models/User');
const pool = require('../db');
const { ensureInvoice } = require('../services/invoiceService');
const AreaDefinition = require('../models/AreaDefinition');

function wantsJson(req) {
  return req.baseUrl.startsWith('/api') || req.query.format === 'json' || req.accepts(['html', 'json']) === 'json';
}

function invoiceLinks(req, order) {
  const origin = `${req.protocol}://${req.get('host')}`;
  const basePath = `${origin}${req.baseUrl}/${order.id}/invoice`;
  const accessToken = req.token ? `&access_token=${encodeURIComponent(req.token)}` : '';
  const publicInvoiceUrl = publicInvoiceLink(req, order);
  return {
    invoice_url: `${basePath}?disposition=inline${accessToken}`,
    invoice_download_url: `${basePath}?download=1${accessToken}`,
    public_invoice_url: publicInvoiceUrl,
  };
}

async function attachInvoice(req, order, items) {
  await ensureInvoice(order, items, { publicInvoiceUrl: publicInvoiceLink(req, order) });
  return {
    ...order,
    ...invoiceLinks(req, order),
  };
}

function invoicePublicSecret() {
  return process.env.INVOICE_PUBLIC_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET ||
    'jaipurgro2-invoice-public-secret';
}

function invoiceNumberFor(order) {
  return order.invoice_number || `INV-${String(order.id).padStart(6, '0')}`;
}

function invoicePublicToken(order) {
  const invoiceNumber = invoiceNumberFor(order);
  const payload = `${order.id}:${invoiceNumber}`;
  const signature = crypto
    .createHmac('sha256', invoicePublicSecret())
    .update(payload)
    .digest('base64url');
  return `${invoiceNumber}.${signature}`;
}

function isValidPublicInvoiceToken(order, token) {
  const expected = invoicePublicToken(order);
  const actual = String(token || '');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function publicInvoiceLink(req, order) {
  const origin = `${req.protocol}://${req.get('host')}`;
  return `${origin}/public/invoices/${order.id}/${encodeURIComponent(invoicePublicToken(order))}`;
}

// Admin/Staff - List all orders with filters
async function index(req, res) {
  if (!wantsJson(req)) {
    return res.render('orders', {
      user: req.session.user,
      shell: res.locals.shell,
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
    const history = await Order.getStatusHistory(req.params.id);
    const orderWithInvoice = await attachInvoice(req, order, items);
    return res.json({ success: true, order: orderWithInvoice, items, history });
  } catch (error) {
    console.error('Order show error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch order' });
  }
}

// Admin/Staff - Assign delivery partner with OTP
async function assignDelivery(req, res) {
  const { partner_id } = req.body;
  const otp = String(req.body.otp || Math.floor(100000 + Math.random() * 900000)).trim();
  const deliveryCharge = Number(req.body.delivery_charge || 0);

  if (!partner_id) {
    return res.status(422).json({ success: false, message: 'Delivery partner is required' });
  }

  if (!/^\d{4,6}$/.test(otp)) {
    return res.status(422).json({ success: false, message: 'OTP must be 4 to 6 digits' });
  }

  if (!Number.isFinite(deliveryCharge) || deliveryCharge < 0) {
    return res.status(422).json({ success: false, message: 'Delivery charge must be zero or more' });
  }

  try {
    const result = await Order.assignDeliveryPartner(req.params.id, partner_id, otp, deliveryCharge, req.authUser || req.session.user);
    return res.json({ success: true, message: 'Delivery partner assigned', ...result });
  } catch (error) {
    console.error('Assign delivery error:', error);
    return res.status(400).json({ success: false, message: error.message });
  }
}

// Admin/Staff - Mark order as ready to deliver
async function readyToDeliver(req, res) {
  try {
    const result = await Order.updateStatus({
      orderId: Number(req.params.id),
      actorUser: req.authUser || req.session.user,
      newStatus: 'ready_for_pickup',
      note: 'Marked ready from admin order panel',
    });
    return res.json({ success: true, message: 'Order marked as ready to deliver', ...result });
  } catch (error) {
    console.error('Ready to deliver error:', error);
    return res.status(400).json({ success: false, message: error.message });
  }
}

// Vendor - List orders for this vendor
async function vendorOrders(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!wantsJson(req)) {
    return res.render('vendor-orders', {
      user: currentUser,
      shell: res.locals.shell,
    });
  }

  try {
    if (!currentUser || currentUser.role !== 'Vendor') {
      return res.status(403).json({ success: false, message: 'Vendor access required' });
    }

    const orders = await Order.listByVendor(currentUser.id, {
      status: req.query.status,
      search: req.query.search,
    });
    const ordersWithItems = [];
    for (const order of orders) {
      const items = await Order.getOrderItems(order.id);
      const history = await Order.getStatusHistory(order.id);
      const orderWithInvoice = await attachInvoice(req, order, items);
      ordersWithItems.push({ ...orderWithInvoice, items, history, next_statuses: Order.getAllowedNextStatusesForOrder(order, 'Vendor') });
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
    const currentUser = req.authUser || req.session.user;
    if (!currentUser || currentUser.role !== 'Vendor') {
      return res.status(403).json({ success: false, message: 'Vendor access required' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Verify this order belongs to the vendor
    if (Number(order.vendor_id) !== Number(currentUser.id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const items = await Order.getOrderItems(order.id);
    const history = await Order.getStatusHistory(order.id);
    const orderWithInvoice = await attachInvoice(req, order, items);
    return res.json({ success: true, order: orderWithInvoice, items, history, next_statuses: Order.getAllowedNextStatusesForOrder(order, 'Vendor') });
  } catch (error) {
    console.error('Vendor order detail error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch order' });
  }
}

// Client - List my orders
async function clientOrders(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!wantsJson(req)) {
    return res.render('client-orders', {
      user: currentUser,
      shell: res.locals.shell,
    });
  }

  try {
    if (!currentUser || currentUser.role !== 'Client') {
      return res.status(403).json({ success: false, message: 'Client access required' });
    }

    const orders = await Order.listByClient(currentUser.id);
    const ordersWithItems = [];
    for (const order of orders) {
      const items = await Order.getOrderItems(order.id);
      const history = await Order.getStatusHistory(order.id);
      const orderWithInvoice = await attachInvoice(req, order, items);
      ordersWithItems.push({ ...orderWithInvoice, items, history });
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
    const currentUser = req.authUser || req.session.user;
    if (!currentUser || currentUser.role !== 'Client') {
      return res.status(403).json({ success: false, message: 'Client access required' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Verify this order belongs to the client
    if (Number(order.user_id) !== Number(currentUser.id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const items = await Order.getOrderItems(order.id);
    const history = await Order.getStatusHistory(order.id);
    const orderWithInvoice = await attachInvoice(req, order, items);
    return res.json({ success: true, order: orderWithInvoice, items, history });
  } catch (error) {
    console.error('Client order detail error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch order' });
  }
}

function isDeliveryPartnerUser(user) {
  return user && String(user.role || '').toLowerCase() === 'staff';
}

async function deliveryProfile(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!isDeliveryPartnerUser(currentUser)) {
    return res.status(403).json({ success: false, message: 'Delivery partner access required' });
  }

  try {
    const [areas] = await pool.query(
      `SELECT city, COALESCE(NULLIF(TRIM(area), ''), '*') AS area, is_active
       FROM delivery_partner_settings
       WHERE user_id = ? AND is_active = 1
       ORDER BY city, area`,
      [currentUser.id]
    );
    return res.json({
      success: true,
      user: User.publicUser(currentUser),
      service_areas: areas,
      service_enabled: areas.length > 0,
    });
  } catch (error) {
    console.error('Delivery profile error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load delivery profile' });
  }
}

async function deliveryOrders(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!isDeliveryPartnerUser(currentUser)) {
    return res.status(403).json({ success: false, message: 'Delivery partner access required' });
  }

  try {
    const result = await Order.listAll({
      page: req.query.page || 1,
      limit: req.query.limit || 100,
      search: req.query.search,
      status: req.query.status,
      deliveryStatus: req.query.delivery_status,
      deliveryPartnerId: currentUser.id,
    });
    return res.json({ success: true, orders: result.orders, pagination: result.pagination });
  } catch (error) {
    console.error('Delivery orders error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch delivery orders' });
  }
}

async function ensureAssignedDeliveryOrder(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!isDeliveryPartnerUser(currentUser)) {
    res.status(403).json({ success: false, message: 'Delivery partner access required' });
    return null;
  }

  const order = await Order.findById(req.params.id);
  if (!order) {
    res.status(404).json({ success: false, message: 'Order not found' });
    return null;
  }

  if (Number(order.delivery_partner_id) !== Number(currentUser.id)) {
    res.status(403).json({ success: false, message: 'This order is not assigned to you' });
    return null;
  }

  return order;
}

async function deliveryOrderDetail(req, res) {
  try {
    const order = await ensureAssignedDeliveryOrder(req, res);
    if (!order) return;

    const items = await Order.getOrderItems(order.id);
    const history = await Order.getStatusHistory(order.id);
    return res.json({
      success: true,
      order,
      items,
      history,
      next_statuses: Order.getAllowedNextStatusesForOrder(order, 'staff'),
    });
  } catch (error) {
    console.error('Delivery order detail error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch delivery order' });
  }
}

async function deliveryUpdateStatus(req, res) {
  try {
    const order = await ensureAssignedDeliveryOrder(req, res);
    if (!order) return;

    const result = await Order.updateStatus({
      orderId: Number(req.params.id),
      actorUser: req.authUser || req.session.user,
      newStatus: req.body.status,
      note: req.body.note || 'Updated from delivery partner app',
    });
    return res.json({ success: true, message: `Order status changed to ${result.statusLabel}`, ...result });
  } catch (error) {
    console.error('Delivery order status update error:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update delivery order status' });
  }
}

async function deliveryVerifyOtp(req, res) {
  try {
    const order = await ensureAssignedDeliveryOrder(req, res);
    if (!order) return;

    const otp = String(req.body.otp || '').trim();
    if (!/^\d{4,6}$/.test(otp)) {
      return res.status(422).json({ success: false, message: 'Enter a valid 4 to 6 digit OTP' });
    }

    const result = await Order.verifyOTP(req.params.id, otp);
    return res.json({ success: true, message: 'Delivery OTP verified', ...result });
  } catch (error) {
    console.error('Delivery OTP verify error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Unable to verify OTP' });
  }
}

async function deliveryMarkDelivered(req, res) {
  try {
    const order = await ensureAssignedDeliveryOrder(req, res);
    if (!order) return;

    const result = await Order.markDelivered(req.params.id);
    return res.json({ success: true, message: 'Order marked delivered', ...result });
  } catch (error) {
    console.error('Delivery delivered error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Unable to mark order delivered' });
  }
}

async function updateVendorStatus(req, res) {
  try {
    const result = await Order.updateStatus({
      orderId: Number(req.params.id),
      actorUser: req.authUser || req.session.user,
      newStatus: req.body.status,
      note: req.body.note,
    });
    return res.json({ success: true, message: `Order status changed to ${result.statusLabel}`, ...result });
  } catch (error) {
    console.error('Vendor order status update error:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update order status' });
  }
}

async function updateAdminStatus(req, res) {
  try {
    const result = await Order.updateStatus({
      orderId: Number(req.params.id),
      actorUser: req.authUser || req.session.user,
      newStatus: req.body.status,
      note: req.body.note,
    });
    return res.json({ success: true, message: `Order status changed to ${result.statusLabel}`, ...result });
  } catch (error) {
    console.error('Admin order status update error:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update order status' });
  }
}

async function streamInvoice(req, res, role) {
  try {
    const currentUser = req.authUser || req.session.user;
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (role === 'Vendor' && (!currentUser || currentUser.role !== 'Vendor' || Number(order.vendor_id) !== Number(currentUser.id))) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (role === 'Client' && (!currentUser || currentUser.role !== 'Client' || Number(order.user_id) !== Number(currentUser.id))) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const items = await Order.getOrderItems(order.id);
    const invoice = await ensureInvoice(order, items, { publicInvoiceUrl: publicInvoiceLink(req, order) });
    const inline = req.query.download !== '1' && req.query.disposition !== 'attachment';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${invoice.fileName}"`);
    return res.sendFile(invoice.absolutePath);
  } catch (error) {
    console.error('Invoice stream error:', error);
    return res.status(500).json({ success: false, message: 'Unable to generate invoice' });
  }
}

function adminInvoice(req, res) {
  return streamInvoice(req, res, 'Admin');
}

function vendorInvoice(req, res) {
  return streamInvoice(req, res, 'Vendor');
}

function clientInvoice(req, res) {
  return streamInvoice(req, res, 'Client');
}

async function publicInvoice(req, res) {
  try {
    const order = await Order.findById(req.params.id);
    if (!order || !isValidPublicInvoiceToken(order, req.params.token)) {
      return res.status(404).send('Invoice not found');
    }

    const items = await Order.getOrderItems(order.id);
    const invoice = await ensureInvoice(order, items, { publicInvoiceUrl: publicInvoiceLink(req, order) });
    const inline = req.query.download !== '1' && req.query.disposition !== 'attachment';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${invoice.fileName}"`);
    return res.sendFile(invoice.absolutePath);
  } catch (error) {
    console.error('Public invoice stream error:', error);
    return res.status(500).send('Unable to generate invoice');
  }
}

// Admin/Staff - Get available delivery partners (staff users)
async function getDeliveryPartners(req, res) {
  try {
    const city = String(req.query.city || '').trim();
    const area = String(req.query.area || req.query.pincode || '').trim();
    const latitude = Number(req.query.latitude ?? req.query.lat);
    const longitude = Number(req.query.longitude ?? req.query.lng);
    const params = city ? [city, city, area || '*'] : [];
    const cityFilter = city
      ? `AND LOWER(TRIM(dps.city)) = LOWER(TRIM(?))
         AND (TRIM(COALESCE(dps.area, '*')) = '*' OR LOWER(TRIM(dps.area)) = LOWER(TRIM(?)))`
      : '';

    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone,
              ${city ? "COALESCE(MIN(CASE WHEN LOWER(TRIM(dps.city)) = LOWER(TRIM(?)) THEN dps.city END), MIN(dps.city), '') AS city" : "COALESCE(MIN(dps.city), '') AS city"},
              COALESCE(MIN(dps.area), '*') AS area
       FROM users u
       INNER JOIN delivery_partner_settings dps ON dps.user_id = u.id AND dps.is_active = 1
       WHERE LOWER(u.role) = 'staff'
         AND LOWER(u.status) = 'active'
         AND u.is_deleted = 0
         ${cityFilter}
       GROUP BY u.id, u.name, u.email, u.phone
       ORDER BY u.name`,
      params
    );
    const ownDelivery = await AreaDefinition.isOwnDeliveryActiveForLocation({
      latitude,
      longitude,
      city,
      area,
    });
    const partners = ownDelivery.active
      ? [{
        id: 'own_delivery',
        name: 'Own Delivery',
        email: '',
        phone: '',
        city: ownDelivery.area ? ownDelivery.area.city : city,
        area: ownDelivery.area ? ownDelivery.area.name : area,
        is_own_delivery: true,
      }, ...rows]
      : rows;
    return res.json({
      success: true,
      partners,
      own_delivery_available: ownDelivery.active,
      matched_area: ownDelivery.area || null,
    });
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
  updateVendorStatus,
  updateAdminStatus,
  adminInvoice,
  vendorInvoice,
  clientInvoice,
  publicInvoice,
  vendorOrders,
  vendorOrderDetail,
  clientOrders,
  clientOrderDetail,
  deliveryProfile,
  deliveryOrders,
  deliveryOrderDetail,
  deliveryUpdateStatus,
  deliveryVerifyOtp,
  deliveryMarkDelivered,
  getDeliveryPartners,
  dashboardStats,
};
