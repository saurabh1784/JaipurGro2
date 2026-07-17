const crypto = require('crypto');
const Order = require('../models/Order');
const User = require('../models/User');
const DeliveryPerson = require('../models/DeliveryPerson');
const Wallet = require('../models/Wallet');
const pool = require('../db');
const { ensureInvoice } = require('../services/invoiceService');
const { deliveryProfileImagePath } = require('../middleware/deliveryProfileImageUpload');
const DeliveryType = require('../models/DeliveryType');
const Rating = require('../models/Rating');

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

function clientSafeOrder(order) {
  if (!order) return order;
  const clone = { ...order };
  delete clone.pickup_otp;
  if (String(clone.delivery_status || '').toLowerCase() !== 'out_for_delivery') {
    delete clone.delivery_otp;
  }
  return clone;
}

function deliveryPartnerSafeOrder(order, financial, offerFinancial) {
  if (!order) return order;
  const clone = { ...order };
  const offerDeliveryCharge = Number(offerFinancial && offerFinancial.delivery_charge || 0);
  const deliveryCharge = Number(order.delivery_charge || offerDeliveryCharge || (financial && financial.deliveryCharge) || 0);
  const settledEarning = order.delivery_wallet_settled_at ? Number(order.delivery_earning || 0) : 0;
  const storedDeliveryCommission = Number(order.delivery_commission_amount || 0);
  const calculatedEarning = Number(financial && financial.deliveryEarning || 0);
  const deliveryEarning = settledEarning > 0
    ? settledEarning
    : (storedDeliveryCommission > 0 ? Math.max(deliveryCharge - storedDeliveryCommission, 0) : calculatedEarning);
  const rawNotificationPayload = clone.notification_payload;
  clone.order_amount = Number(order.total_amount || 0);
  delete clone.delivery_otp;
  delete clone.pickup_otp;
  delete clone.total_amount;
  delete clone.subtotal_amount;
  delete clone.discount_amount;
  delete clone.savings_amount;
  delete clone.platform_fee;
  delete clone.delivery_partner_earning;
  delete clone.coupon_id;
  delete clone.coupon_code;
  delete clone.discount_id;
  delete clone.discount_label;
  clone.delivery_charge = deliveryCharge;
  clone.delivery_earning = deliveryEarning;
  if (rawNotificationPayload) {
    let notificationPayload = rawNotificationPayload;
    if (typeof rawNotificationPayload === 'string') {
      try {
        notificationPayload = JSON.parse(rawNotificationPayload);
      } catch (_) {
        notificationPayload = null;
      }
    }
    if (notificationPayload && typeof notificationPayload === 'object' && !Array.isArray(notificationPayload)) {
      clone.notification_payload = { ...notificationPayload };
    }
  }
  if (clone.notification_payload && typeof clone.notification_payload === 'object') {
    delete clone.notification_payload.platform_fee;
    delete clone.notification_payload.delivery_partner_earning;
    clone.notification_payload.delivery_charge = deliveryCharge;
    clone.notification_payload.delivery_earning = deliveryEarning;
  }
  return clone;
}

async function deliveryPartnerSafeOrders(orders) {
  const rows = Array.isArray(orders) ? orders : [];
  const financials = await Order.deliveryFinancials(rows.map((order) => order.delivery_charge));
  const offerFinancials = await deliveryPartnerOfferFinancials(rows);
  return rows.map((order, index) => deliveryPartnerSafeOrder(order, financials[index], offerFinancials.get(Number(order.id))));
}

async function deliveryPartnerOfferFinancials(orders) {
  const ids = [...new Set((orders || []).map((order) => Number(order && order.id)).filter((id) => id > 0))];
  const result = new Map();
  if (!ids.length) return result;

  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT order_id, delivery_charge, delivery_partner_earning
     FROM (
       SELECT dof.order_id,
              dof.delivery_charge,
              dof.delivery_partner_earning,
              ROW_NUMBER() OVER (
                PARTITION BY dof.order_id
                ORDER BY
                  CASE dof.status
                    WHEN 'accepted' THEN 0
                    WHEN 'assigned' THEN 1
                    WHEN 'pending' THEN 2
                    ELSE 3
                  END,
                  dof.id DESC
              ) AS rn
       FROM delivery_order_offers dof
       WHERE dof.order_id IN (${placeholders})
         AND dof.status IN ('accepted', 'assigned', 'pending')
     ) ranked
     WHERE rn = 1`,
    ids
  );
  for (const row of rows) {
    result.set(Number(row.order_id), {
      delivery_charge: Number(row.delivery_charge || 0),
      delivery_partner_earning: Number(row.delivery_partner_earning || 0),
    });
  }
  return result;
}

function deliveryPartnerSafeItems(items) {
  return items.map((item) => {
    const clone = { ...item };
    delete clone.unit_price;
    delete clone.line_total;
    delete clone.tax_percentage;
    delete clone.tax_amount;
    delete clone.taxable_amount;
    return clone;
  });
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
      orderType: req.query.order_type,
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

async function freeDeliveryPartnersForOrder(req, res) {
  try {
    const result = await Order.listFreeDeliveryPartnersForOrder(Number(req.params.id));
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Free delivery partners error:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to fetch free delivery partners' });
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
    const autoDelivery = await Order.createAutoDeliveryOffer(Number(req.params.id), req.authUser || req.session.user, {
      autoAssignFirstAvailable: true,
    }).catch((error) => ({ skipped: true, message: error.message }));
    return res.json({ success: true, message: 'Order marked as ready to deliver', ...result, autoDelivery });
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
      ordersWithItems.push(clientSafeOrder({ ...orderWithInvoice, items, history }));
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
    const ratingContext = await Rating.contextForOrder(order, currentUser.id);
    return res.json({
      success: true,
      order: { ...clientSafeOrder(orderWithInvoice), rating_context: ratingContext },
      items,
      history,
    });
  } catch (error) {
    console.error('Client order detail error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch order' });
  }
}

async function rateCompletedOrder(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!currentUser || String(currentUser.role || '').toLowerCase() !== 'client') {
    return res.status(403).json({ success: false, message: 'Client access required' });
  }
  try {
    const ratingContext = await Rating.saveForOrder({
      orderId: Number(req.params.id),
      clientId: currentUser.id,
      vendorScores: req.body.vendor,
      deliveryPersonScores: req.body.delivery_person,
    });
    return res.json({ success: true, message: 'Thank you for sharing your ratings', rating_context: ratingContext });
  } catch (error) {
    console.error('Order rating error:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to save ratings' });
  }
}

function isDeliveryPartnerUser(user) {
  return user && String(user.role || '').toLowerCase() === 'deliveryperson';
}

function canResendDeliveryOffer(user) {
  if (!user || isDeliveryPartnerUser(user)) return false;
  const role = String(user.role || user.roleName || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (['admin', 'superadmin', 'staff', 'staffl1', 'staffl2', 'staffl3', 'supportstaff'].includes(role)) return true;
  return Array.isArray(user.permissions)
    && (user.permissions.includes('all') || user.permissions.includes('orders.manage'));
}

async function activeDeliveryPerson(user) {
  if (!isDeliveryPartnerUser(user)) return false;
  const freshUser = await User.findById(user.id);
  if (freshUser && String(freshUser.status).toLowerCase() === 'active') {
    await pool.query(
      `INSERT INTO delivery_person_profiles (user_id, is_available, last_seen_at)
       VALUES (?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         last_seen_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      [user.id]
    );
  }
  return Boolean(freshUser && String(freshUser.status).toLowerCase() === 'active');
}

async function deliveryHeartbeat(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!isDeliveryPartnerUser(currentUser)) {
    return res.status(403).json({ success: false, message: 'Delivery partner access required' });
  }
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  await pool.query(
    `INSERT INTO delivery_person_profiles
       (user_id, is_available, last_seen_at, current_latitude, current_longitude)
     VALUES (?, 1, CURRENT_TIMESTAMP, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       last_seen_at = CURRENT_TIMESTAMP,
       current_latitude = CASE WHEN ? = 1 THEN EXCLUDED.current_latitude ELSE delivery_person_profiles.current_latitude END,
       current_longitude = CASE WHEN ? = 1 THEN EXCLUDED.current_longitude ELSE delivery_person_profiles.current_longitude END,
       updated_at = CURRENT_TIMESTAMP`,
    [
      currentUser.id,
      hasCoordinates ? latitude : null,
      hasCoordinates ? longitude : null,
      hasCoordinates ? 1 : 0,
      hasCoordinates ? 1 : 0,
    ]
  );
  return res.json({ success: true, online: true });
}

async function updateDeliveryAvailability(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!isDeliveryPartnerUser(currentUser)) {
    return res.status(403).json({ success: false, message: 'Delivery partner access required' });
  }

  const value = req.body.is_available ?? req.body.available ?? req.body.availability_status;
  const normalized = String(value).trim().toLowerCase();
  if (![true, false].includes(value) && !['1', '0', 'true', 'false', 'available', 'unavailable', 'online', 'offline'].includes(normalized)) {
    return res.status(422).json({ success: false, message: 'A valid availability status is required' });
  }
  const isAvailable = value === true || ['1', 'true', 'available', 'online'].includes(normalized);

  try {
    await pool.query(
      `INSERT INTO delivery_person_profiles (user_id, is_available, last_seen_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         is_available = EXCLUDED.is_available,
         last_seen_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      [currentUser.id, isAvailable ? 1 : 0]
    );
    await DeliveryPerson.log({
      deliveryPersonId: currentUser.id,
      actorId: currentUser.id,
      action: isAvailable ? 'availability_online' : 'availability_offline',
      description: `Delivery partner went ${isAvailable ? 'online' : 'offline'} from the app`,
    }).catch(() => {});
    return res.json({
      success: true,
      is_available: isAvailable,
      message: isAvailable ? 'You are now online' : 'You are now offline',
    });
  } catch (error) {
    console.error('Delivery availability update error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update availability' });
  }
}

async function deliveryProfile(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!isDeliveryPartnerUser(currentUser)) {
    return res.status(403).json({ success: false, message: 'Delivery partner access required' });
  }

  try {
    const [profileRows] = await pool.query(
      `SELECT city, area, address, address_proof_id, address_proof_type, profile_image_path,
              vehicle_type, vehicle_number, document_notes, is_available,
              current_latitude, current_longitude
       FROM delivery_person_profiles
       WHERE user_id = ?
       LIMIT 1`,
      [currentUser.id]
    );
    const [areas] = await pool.query(
      `SELECT city, COALESCE(NULLIF(TRIM(area), ''), '*') AS area, is_active
       FROM delivery_partner_settings
       WHERE user_id = ? AND is_active = 1
       ORDER BY city, area`,
      [currentUser.id]
    );
    const walletData = await Wallet.transactionsByUserId(currentUser.id, { limit: 50 });
    return res.json({
      success: true,
      user: User.publicUser(currentUser),
      profile: profileRows[0] || null,
      service_areas: areas,
      service_enabled: areas.length > 0,
      wallet: walletData.wallet,
      wallet_transactions: walletData.transactions,
      rating_summary: await Rating.summary('delivery_person', currentUser.id),
    });
  } catch (error) {
    console.error('Delivery profile error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load delivery profile' });
  }
}

async function uploadDeliveryProfileImage(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!isDeliveryPartnerUser(currentUser)) {
    return res.status(403).json({ success: false, message: 'Delivery partner access required' });
  }

  const imagePath = deliveryProfileImagePath(req.file);
  if (!imagePath) {
    return res.status(422).json({ success: false, message: 'Profile picture is required' });
  }

  try {
    await pool.query(
      `INSERT INTO delivery_person_profiles (user_id, profile_image_path)
       VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET profile_image_path = EXCLUDED.profile_image_path, updated_at = CURRENT_TIMESTAMP`,
      [currentUser.id, imagePath]
    );
    await DeliveryPerson.log({
      deliveryPersonId: currentUser.id,
      actorId: currentUser.id,
      action: 'profile_picture_updated',
      description: 'Delivery partner updated profile picture from app',
    }).catch(() => {});
    return res.json({ success: true, message: 'Profile picture updated', profile_image_path: imagePath });
  } catch (error) {
    console.error('Delivery profile image upload error:', error);
    return res.status(500).json({ success: false, message: 'Unable to upload profile picture' });
  }
}

async function updateDeliveryProfile(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!isDeliveryPartnerUser(currentUser)) {
    return res.status(403).json({ success: false, message: 'Delivery partner access required' });
  }

  const name = String(req.body.name || '').trim();
  const city = String(req.body.city || '').trim();
  const area = String(req.body.area || '*').trim() || '*';
  const address = String(req.body.address || '').trim();
  const addressProofType = String(req.body.address_proof_type || '').trim();
  const addressProofId = String(req.body.address_proof_id || '').trim();
  const documentNotes = String(req.body.document_notes || '').trim();
  const availability = String(req.body.availability_status || '').trim().toLowerCase();
  const isAvailable = availability === 'unavailable' || availability === 'false' ? 0 : 1;

  if (name.length < 2) {
    return res.status(422).json({ success: false, message: 'Name is required' });
  }
  if (!city) {
    return res.status(422).json({ success: false, message: 'City is required' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('UPDATE users SET name = ? WHERE id = ? AND LOWER(role) = ?', [name, currentUser.id, 'deliveryperson']);
    await connection.query(
      `INSERT INTO delivery_person_profiles
        (user_id, city, area, address, address_proof_id, address_proof_type, document_notes, is_available)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         city = EXCLUDED.city,
         area = EXCLUDED.area,
         address = EXCLUDED.address,
         address_proof_id = EXCLUDED.address_proof_id,
         address_proof_type = EXCLUDED.address_proof_type,
         document_notes = EXCLUDED.document_notes,
         is_available = EXCLUDED.is_available,
         updated_at = CURRENT_TIMESTAMP`,
      [currentUser.id, city, area, address || null, addressProofId || null, addressProofType || null, documentNotes || null, isAvailable]
    );
    await connection.query('DELETE FROM delivery_partner_settings WHERE user_id = ?', [currentUser.id]);
    await connection.query(
      'INSERT INTO delivery_partner_settings (user_id, city, area, is_active) VALUES (?, ?, ?, ?)',
      [currentUser.id, city, area, isAvailable]
    );
    await DeliveryPerson.log({
      deliveryPersonId: currentUser.id,
      actorId: currentUser.id,
      action: 'profile_self_updated',
      description: 'Delivery partner updated profile from app',
    }, connection).catch(() => {});
    await connection.commit();

    const updatedUser = await User.findById(currentUser.id);
    return res.json({
      success: true,
      message: 'Profile updated successfully',
      user: User.publicUser(updatedUser),
    });
  } catch (error) {
    await connection.rollback();
    console.error('Delivery profile update error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update profile' });
  } finally {
    connection.release();
  }
}

async function deliveryOrders(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!isDeliveryPartnerUser(currentUser)) {
    return res.status(403).json({ success: false, message: 'Delivery partner access required' });
  }
  if (!(await activeDeliveryPerson(currentUser))) {
    return res.status(403).json({ success: false, message: 'Your delivery account is blocked. Contact an administrator.' });
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
    const orders = await deliveryPartnerSafeOrders(result.orders);
    for (const order of orders) {
      const items = await Order.getOrderItems(order.id);
      order.items = deliveryPartnerSafeItems(items);
    }
    return res.json({ success: true, orders, pagination: result.pagination });
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
  if (!(await activeDeliveryPerson(currentUser))) {
    res.status(403).json({ success: false, message: 'Your delivery account is blocked and cannot accept or update orders.' });
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
    const [safeOrder] = await deliveryPartnerSafeOrders([order]);
    return res.json({
      success: true,
      order: safeOrder,
      items: deliveryPartnerSafeItems(items),
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

    const requestedStatus = req.body.status;
    const result = await Order.updateStatus({
      orderId: Number(req.params.id),
      actorUser: req.authUser || req.session.user,
      newStatus: requestedStatus,
      note: req.body.note || (String(requestedStatus || '').toLowerCase() === 'picked_up'
        ? 'Order picked up; delivery tracking started'
        : 'Updated from delivery partner app'),
    });
    return res.json({ success: true, message: `Order status changed to ${result.statusLabel}`, ...result });
  } catch (error) {
    console.error('Delivery order status update error:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update delivery order status' });
  }
}

async function clientDeliveryTracking(req, res) {
  try {
    const currentUser = req.authUser || req.session.user;
    if (!currentUser || String(currentUser.role || '').toLowerCase() !== 'client') {
      return res.status(403).json({ success: false, message: 'Client access required' });
    }
    const tracking = await Order.getDeliveryTracking(Number(req.params.id));
    if (!tracking) return res.status(404).json({ success: false, message: 'Order not found' });
    if (Number(tracking.client_id) !== Number(currentUser.id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    delete tracking.client_id;
    return res.json({ success: true, tracking });
  } catch (error) {
    console.error('Client delivery tracking error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load delivery tracking' });
  }
}

async function deliveryPartnerTracking(req, res) {
  try {
    const order = await ensureAssignedDeliveryOrder(req, res);
    if (!order) return;
    const tracking = await Order.getDeliveryTracking(Number(req.params.id));
    if (!tracking) return res.status(404).json({ success: false, message: 'Order not found' });
    delete tracking.client_id;
    return res.json({ success: true, tracking });
  } catch (error) {
    console.error('Delivery partner tracking error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load delivery route' });
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

    const currentUser = req.authUser || req.session.user;
    const result = await Order.verifyOTP(req.params.id, otp, { actorUser: currentUser });
    if (!result.verified) {
      await DeliveryPerson.log({
        deliveryPersonId: currentUser.id,
        actorId: currentUser.id,
        action: 'otp_conflict',
        description: `Incorrect delivery OTP for order #${req.params.id} (attempt ${result.otpAttempts}/${result.maxAttempts})`,
        metadata: { order_id: Number(req.params.id), attempts: result.otpAttempts, remaining_attempts: result.remainingAttempts, locked: result.otpLocked },
      }).catch(() => {});
      return res.status(result.otpLocked ? 423 : 400).json({
        success: false,
        message: result.otpLocked
          ? 'OTP attempt limit reached. Contact admin support for manual verification'
          : `OTP incorrect. ${result.remainingAttempts} attempt${result.remainingAttempts === 1 ? '' : 's'} remaining`,
        ...result,
      });
    }
    return res.json({ success: true, message: 'Delivery OTP verified', ...result });
  } catch (error) {
    const currentUser = req.authUser || req.session.user;
    if (currentUser && currentUser.id && /otp/i.test(String(error.message || ''))) {
      await DeliveryPerson.log({ deliveryPersonId: currentUser.id, actorId: currentUser.id, action: 'otp_conflict', description: `OTP conflict on order #${req.params.id}` }).catch(() => {});
    }
    console.error('Delivery OTP verify error:', error);
    return res.status(error.status || 400).json({
      success: false,
      message: error.message || 'Unable to verify OTP',
      otpLocked: Boolean(error.otpLocked),
      otpAttempts: error.attempts,
      remainingAttempts: error.remainingAttempts,
    });
  }
}

async function deliveryOffers(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!isDeliveryPartnerUser(currentUser)) {
    return res.status(403).json({ success: false, message: 'Delivery partner access required' });
  }
  if (!(await activeDeliveryPerson(currentUser))) {
    return res.status(403).json({ success: false, message: 'Your delivery account is blocked. Contact an administrator.' });
  }

  try {
    await Order.ensureWaitingOfferForPerson(currentUser.id);
    await Order.refreshDeliveryOffersForPerson(currentUser.id);
    const offers = await Order.listDeliveryOffers(currentUser.id);
    const safeOffers = await deliveryPartnerSafeOrders(offers);
    return res.json({ success: true, offers: safeOffers });
  } catch (error) {
    console.error('Delivery offers error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch delivery offers' });
  }
}

async function deliveryOfferDecision(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!isDeliveryPartnerUser(currentUser)) {
    return res.status(403).json({ success: false, message: 'Delivery partner access required' });
  }
  if (!(await activeDeliveryPerson(currentUser))) {
    return res.status(403).json({ success: false, message: 'Your delivery account is blocked. Contact an administrator.' });
  }

  try {
    const result = await Order.decideDeliveryOffer({
      orderId: Number(req.params.id),
      deliveryPersonId: currentUser.id,
      decision: req.params.decision,
      note: req.body.note,
    });
    return res.json({ success: true, message: result.status === 'accepted' ? 'Delivery order accepted' : 'Delivery order rejected; order is now unassigned', ...result });
  } catch (error) {
    console.error('Delivery offer decision error:', error);
    return res.status(error.status || 400).json({ success: false, message: error.message || 'Unable to update delivery offer' });
  }
}

async function verifyPickupOtp(req, res) {
  const otp = String(req.body.otp || '').trim();
  if (!/^\d{4,6}$/.test(otp)) {
    return res.status(422).json({ success: false, message: 'Enter a valid 4 to 6 digit pickup OTP' });
  }

  try {
    const result = await Order.verifyPickupOTP(Number(req.params.id), otp, req.authUser || req.session.user);
    return res.json({ success: true, message: 'Pickup OTP verified. Order marked picked up.', ...result });
  } catch (error) {
    const order = await Order.findById(req.params.id).catch(() => null);
    if (order && order.delivery_partner_id && /otp/i.test(String(error.message || ''))) {
      await DeliveryPerson.log({ deliveryPersonId: order.delivery_partner_id, actorId: (req.authUser || req.session.user || {}).id || null, action: 'otp_conflict', description: `Pickup OTP conflict on order #${req.params.id}` }).catch(() => {});
    }
    console.error('Pickup OTP verify error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Unable to verify pickup OTP' });
  }
}

async function deliveryActivity(req, res) {
  try {
    const order = await ensureAssignedDeliveryOrder(req, res);
    if (!order) return;
    const currentUser = req.authUser || req.session.user;
    const action = String(req.body.action || '').trim().toLowerCase();
    const allowed = ['order_accepted', 'order_rejected', 'order_unaccepted', 'delivery_failed'];
    if (!allowed.includes(action)) return res.status(422).json({ success: false, message: 'Invalid delivery activity' });
    if (action === 'order_accepted' && order.delivery_status === 'assigned') await Order.markReadyToDeliver(order.id);
    if (action === 'order_rejected') {
      const result = await Order.rejectAssignedDeliveryOrder(Number(order.id), Number(currentUser.id), String(req.body.note || '').trim());
      return res.json({ success: true, message: 'Delivery order rejected; order is now unassigned', ...result });
    }
    await DeliveryPerson.log({ deliveryPersonId: currentUser.id, actorId: currentUser.id, action, description: String(req.body.note || action.replaceAll('_', ' ')), metadata: { order_id: Number(order.id) } });
    return res.json({ success: true, message: 'Delivery activity recorded' });
  } catch (error) {
    return res.status(error.status || 400).json({ success: false, message: error.message || 'Unable to record delivery activity' });
  }
}

async function deliveryMarkDelivered(req, res) {
  try {
    const order = await ensureAssignedDeliveryOrder(req, res);
    if (!order) return;

    const otp = String(req.body.otp || '').trim();
    if (!/^\d{4,6}$/.test(otp)) {
      return res.status(422).json({ success: false, message: 'Customer delivery OTP is required to mark delivered' });
    }
    const result = await Order.verifyOTP(req.params.id, otp, { actorUser: req.authUser || req.session.user });
    if (!result.verified) {
      return res.status(result.otpLocked ? 423 : 400).json({
        success: false,
        message: result.otpLocked
          ? 'OTP attempt limit reached. Contact admin support for manual verification'
          : `OTP incorrect. ${result.remainingAttempts} attempt${result.remainingAttempts === 1 ? '' : 's'} remaining`,
        ...result,
      });
    }
    return res.json({ success: true, message: 'Customer OTP verified. Order marked delivered', ...result });
  } catch (error) {
    console.error('Delivery delivered error:', error);
    return res.status(error.status || 400).json({ success: false, message: error.message || 'Unable to mark order delivered' });
  }
}

async function manualVerifyDelivery(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!canResendDeliveryOffer(currentUser)) {
    return res.status(403).json({ success: false, message: 'Admin or staff access is required for manual delivery verification' });
  }
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (!order.delivery_otp_locked) {
      return res.status(409).json({ success: false, message: 'Manual verification is available only after all 8 OTP attempts are used' });
    }
    const result = await Order.verifyOTP(req.params.id, '', { manualVerification: true, actorUser: currentUser });
    return res.json({ success: true, message: 'Delivery manually verified and completed', ...result });
  } catch (error) {
    console.error('Manual delivery verification error:', error);
    return res.status(error.status || 400).json({ success: false, message: error.message || 'Unable to manually verify delivery' });
  }
}

async function updateVendorStatus(req, res) {
  try {
    const requestedStatus = String(req.body.status || '').toLowerCase();
    const result = await Order.updateStatus({
      orderId: Number(req.params.id),
      actorUser: req.authUser || req.session.user,
      newStatus: req.body.status,
      note: req.body.note,
    });
    let autoDelivery = null;
    if (requestedStatus === 'ready_for_pickup') {
      autoDelivery = await Order.createAutoDeliveryOffer(Number(req.params.id), req.authUser || req.session.user, {
        autoAssignFirstAvailable: true,
      })
        .catch((error) => ({ skipped: true, message: error.message }));
    }
    return res.json({ success: true, message: `Order status changed to ${result.statusLabel}`, ...result, autoDelivery });
  } catch (error) {
    console.error('Vendor order status update error:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update order status' });
  }
}

async function updateAdminStatus(req, res) {
  try {
    const requestedStatus = String(req.body.status || '').toLowerCase();
    const result = await Order.updateStatus({
      orderId: Number(req.params.id),
      actorUser: req.authUser || req.session.user,
      newStatus: req.body.status,
      note: req.body.note,
    });
    const autoDelivery = requestedStatus === 'ready_for_pickup'
      ? await Order.createAutoDeliveryOffer(Number(req.params.id), req.authUser || req.session.user, {
          autoAssignFirstAvailable: true,
        }).catch((error) => ({ skipped: true, message: error.message }))
      : null;
    return res.json({ success: true, message: `Order status changed to ${result.statusLabel}`, ...result, autoDelivery });
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
    const ownDelivery = await DeliveryType.isTypeAvailable('delivered_by_vendor', {
      latitude,
      longitude,
      city,
      area,
      vendorId: req.query.vendor_id || req.query.vendorId,
    });
    const matchedCity = ownDelivery.area && ownDelivery.area.city ? ownDelivery.area.city : city;
    const matchedArea = ownDelivery.area && ownDelivery.area.name ? ownDelivery.area.name : area;

    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone,
              COALESCE(MIN(dps.city), dpp.city, '') AS city,
              COALESCE(MIN(dps.area), dpp.area, '*') AS area
       FROM users u
       INNER JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
       LEFT JOIN delivery_partner_settings dps ON dps.user_id = u.id AND dps.is_active = 1
       WHERE LOWER(u.role) = 'deliveryperson'
         AND LOWER(u.status) = 'active'
         AND u.is_deleted = 0
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
       GROUP BY u.id, u.name, u.email, u.phone, dpp.city, dpp.area
       ORDER BY u.name`,
      []
    );
    const deliveryRatings = await Rating.summaries('delivery_person', rows.map((row) => row.id));
    const ratedRows = rows.map((row) => ({
      ...row,
      rating_summary: deliveryRatings.get(Number(row.id)),
    }));
    const ownVendorId = Number(req.query.vendor_id || req.query.vendorId || 0);
    const partners = ownDelivery.active
      ? [{
        id: 'own_delivery',
        name: 'Delivered by Vendor',
        email: '',
        phone: '',
        city: ownDelivery.area ? ownDelivery.area.city : matchedCity,
        area: ownDelivery.area ? ownDelivery.area.name : matchedArea,
        is_own_delivery: true,
        rating_summary: ownVendorId ? await Rating.summary('vendor', ownVendorId) : null,
      }, ...ratedRows]
      : ratedRows;
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

async function deliveryDashboardPage(req, res) {
  return res.render('delivery-dashboard', {
    user: req.session.user,
    shell: res.locals.shell,
  });
}

async function deliveryDashboardOrders(req, res) {
  try {
    const result = await Order.listInHouseDeliveryDashboard({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      status: req.query.status,
      city: req.query.city,
      deliveryPersonId: req.query.delivery_person_id,
      date: req.query.date,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Delivery dashboard orders error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load delivery dashboard orders' });
  }
}

async function deliveryPartnerStatusPage(req, res) {
  return res.render('delivery-partner-status', {
    user: req.session.user,
    shell: res.locals.shell,
  });
}

async function deliveryPartnerStatuses(req, res) {
  try {
    const result = await Order.listDeliveryPartnerStatuses({
      search: req.query.search,
      status: req.query.status,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Delivery partner status error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load delivery partner statuses' });
  }
}

async function deliveryPartnerRejectionDetails(req, res) {
  try {
    const result = await Order.getDeliveryPartnerRejectionDetails(Number(req.params.partnerId));
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Delivery partner rejection details error:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to load rejection details' });
  }
}

async function setDeliveryPartnerBlockStatus(req, res) {
  try {
    const action = String(req.body.action || req.body.status || '').trim().toLowerCase();
    const blocked = action === 'block' || action === 'blocked';
    const unblocked = action === 'unblock' || action === 'active';
    if (!blocked && !unblocked) {
      return res.status(422).json({ success: false, message: 'Action must be block or unblock' });
    }
    const result = await Order.setDeliveryPartnerBlockStatus(Number(req.params.partnerId), blocked, req.authUser || req.session.user);
    return res.json({
      success: true,
      message: blocked ? 'Delivery partner blocked' : 'Delivery partner unblocked',
      ...result,
    });
  } catch (error) {
    console.error('Delivery partner block status error:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update delivery partner status' });
  }
}

async function resendDeliveryOffer(req, res) {
  const currentUser = req.authUser || req.session.user;
  if (!canResendDeliveryOffer(currentUser)) {
    return res.status(403).json({ success: false, message: 'Admin or staff access is required to resend deliveries' });
  }
  try {
    const result = await Order.resendDeliveryOffer(
      Number(req.params.id),
      currentUser
    );
    return res.json({
      success: true,
      message: result.deliveryPersonName
        ? `Delivery resent to ${result.deliveryPersonName}`
        : (result.message || 'Delivery resend requested; waiting for an available delivery person'),
      ...result,
    });
  } catch (error) {
    console.error('Resend delivery offer error:', error);
    if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    return res.status(error.status || 400).json({ success: false, message: error.message || 'Unable to resend delivery' });
  }
}

module.exports = {
  index,
  show,
  assignDelivery,
  freeDeliveryPartnersForOrder,
  readyToDeliver,
  updateVendorStatus,
  deliveryHeartbeat,
  updateDeliveryAvailability,
  updateAdminStatus,
  adminInvoice,
  vendorInvoice,
  clientInvoice,
  publicInvoice,
  vendorOrders,
  vendorOrderDetail,
  clientOrders,
  clientOrderDetail,
  rateCompletedOrder,
  deliveryProfile,
  updateDeliveryProfile,
  uploadDeliveryProfileImage,
  deliveryOrders,
  deliveryOrderDetail,
  deliveryUpdateStatus,
  deliveryVerifyOtp,
  deliveryOffers,
  deliveryOfferDecision,
  verifyPickupOtp,
  deliveryMarkDelivered,
  deliveryActivity,
  getDeliveryPartners,
  dashboardStats,
  deliveryDashboardPage,
  deliveryDashboardOrders,
  deliveryPartnerStatusPage,
  deliveryPartnerStatuses,
  deliveryPartnerRejectionDetails,
  setDeliveryPartnerBlockStatus,
  resendDeliveryOffer,
  manualVerifyDelivery,
  clientDeliveryTracking,
  deliveryPartnerTracking,
};
