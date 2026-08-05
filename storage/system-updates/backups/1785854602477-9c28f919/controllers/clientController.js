const bcrypt = require('bcryptjs');
const Client = require('../models/Client');
const { validateStatus } = require('../middleware/validators');
const { flattenLocationOptionsFromDb, isValidLocation, locationTree } = require('../utils/locationOptions');

function wantsJson(req) {
  return req.baseUrl.startsWith('/api') || req.query.format === 'json' || req.accepts(['html', 'json']) === 'json';
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhone(value) {
  return /^[0-9+\-\s()]{7,20}$/.test(value);
}

function validateClient(body, { requirePassword = false, locationOptions = null } = {}) {
  const errors = [];
  const password = body.password ? String(body.password) : '';
  const ageValue = body.age === undefined || body.age === '' ? '' : Number(body.age);
  const data = {
    name: body.name ? String(body.name).trim() : '',
    email: body.email ? String(body.email).trim().toLowerCase() : '',
    phone: body.phone ? String(body.phone).trim() : '',
    password,
    status: body.status || 'active',
    address: body.address ? String(body.address).trim() : '',
    country: body.country ? String(body.country).trim() : '',
    state: body.state ? String(body.state).trim() : '',
    city: body.city ? String(body.city).trim() : '',
    area: body.area ? String(body.area).trim() : '',
    age: ageValue,
    gender: body.gender ? String(body.gender).trim() : '',
    notes: body.notes ? String(body.notes).trim() : '',
    cod_limit: Math.max(0, Number(body.cod_limit || body.codLimit || 0)),
  };

  if (data.name.length < 2) errors.push('Name must be at least 2 characters');
  if (!isEmail(data.email)) errors.push('Valid email is required');
  if (!isPhone(data.phone)) errors.push('Valid phone is required');
  if (requirePassword && data.password.length < 6) errors.push('Password must be at least 6 characters');
  if (!requirePassword && data.password && data.password.length < 6) errors.push('Password must be at least 6 characters');
  if (!validateStatus(data.status)) errors.push('Status must be active or inactive');
  const optionTree = (locationOptions && locationOptions.tree) || locationTree;
  if (!optionTree[data.country]) errors.push('Country is required');
  if (!data.country || !optionTree[data.country] || !optionTree[data.country][data.state]) errors.push('State is required');
  if (!isValidLocation(data, locationOptions || { tree: optionTree })) errors.push('City is required');
  if (!Number.isFinite(data.cod_limit)) errors.push('COD limit must be a valid number');
  if (data.age !== '' && (!Number.isInteger(data.age) || data.age < 1 || data.age > 120)) {
    errors.push('Age must be between 1 and 120');
  }

  return { errors, data };
}

const { isSuperAdminUser, getAssignedUserCity } = require('./userController');

async function index(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const adminCity = await getAssignedUserCity(currentUser);
  const filterCity = isSuper ? (req.query.city || '') : adminCity;

  if (!wantsJson(req)) {
    return res.render('clients', {
      user: req.session.user,
      isSuperAdmin: isSuper,
      adminCity,
      canViewClientDetails: canViewClientDetails(currentUser),
      locationOptions: await flattenLocationOptionsFromDb(),
    });
  }

  try {
    const result = await Client.list({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      status: req.query.status,
      country: req.query.country,
      state: req.query.state,
      city: filterCity,
    });
    return res.json({ success: true, isSuperAdmin: isSuper, adminCity, ...result });
  } catch (error) {
    console.error('Client list error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch clients' });
  }
}

async function show(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const adminCity = await getAssignedUserCity(currentUser);

  const client = await Client.findById(Number(req.params.id));
  if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

  if (!isSuper && adminCity && client.city && client.city.toLowerCase() !== adminCity.toLowerCase()) {
    return res.status(403).json({ success: false, message: `Admins can only view clients in their assigned city (${adminCity}).` });
  }

  return res.json({ success: true, client });
}

async function create(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const adminCity = await getAssignedUserCity(currentUser);

  if (!isSuper && adminCity) {
    if (req.body.city && String(req.body.city).trim().toLowerCase() !== adminCity.toLowerCase()) {
      return res.status(403).json({ success: false, message: `Admins can only create clients for their assigned city (${adminCity}).` });
    }
    req.body.city = adminCity;
  }

  const locationOptions = await flattenLocationOptionsFromDb();
  const { errors, data } = validateClient(req.body, { requirePassword: true, locationOptions });
  if (errors.length) return res.status(422).json({ success: false, message: 'Validation failed', errors });

  const duplicate = await Client.emailOrPhoneTaken({ email: data.email, phone: data.phone });
  if (duplicate) return res.status(409).json({ success: false, message: 'A user with this email or phone already exists' });

  try {
    data.password = await bcrypt.hash(data.password, 10);
    const id = await Client.create(data);
    return res.status(201).json({ success: true, message: 'Client created', client: await Client.findById(id) });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'A user with this email or phone already exists' });
    }
    console.error('Client create error:', error);
    return res.status(500).json({ success: false, message: 'Unable to create client' });
  }
}

async function update(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(422).json({ success: false, message: 'Valid client ID is required' });

    const currentUser = req.authUser || (req.session && req.session.user);
    const isSuper = isSuperAdminUser(currentUser);
    const adminCity = await getAssignedUserCity(currentUser);

    const existing = await Client.findById(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });

    if (!isSuper && adminCity && existing.city && existing.city.toLowerCase() !== adminCity.toLowerCase()) {
      return res.status(403).json({ success: false, message: `Admins can only update clients in their assigned city (${adminCity}).` });
    }

    if (Object.keys(req.body).length === 1 && req.body.status !== undefined) {
      if (!validateStatus(req.body.status)) {
        return res.status(422).json({ success: false, message: 'Status must be active or inactive' });
      }
      await Client.updateStatus(id, req.body.status);
      return res.json({ success: true, message: 'Client status updated', client: await Client.findById(id) });
    }

    if (!isSuper && adminCity) {
      req.body.city = adminCity;
    }

    const locationOptions = await flattenLocationOptionsFromDb();
    const { errors, data } = validateClient(req.body, { locationOptions });
    if (errors.length) return res.status(422).json({ success: false, message: 'Validation failed', errors });

    const duplicate = await Client.emailOrPhoneTaken({ id, email: data.email, phone: data.phone });
    if (duplicate) return res.status(409).json({ success: false, message: 'A user with this email or phone already exists' });

    if (data.password) data.password = await bcrypt.hash(data.password, 10);
    await Client.update(id, data);
    return res.json({ success: true, message: 'Client updated', client: await Client.findById(id) });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A user with this email or phone already exists' });
    }
    console.error('Client update error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update client' });
  }
}

async function destroy(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(422).json({ success: false, message: 'Valid client ID is required' });

  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const adminCity = await getAssignedUserCity(currentUser);

  const existing = await Client.findById(id);
  if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });

  if (!isSuper && adminCity && existing.city && existing.city.toLowerCase() !== adminCity.toLowerCase()) {
    return res.status(403).json({ success: false, message: `Admins can only delete clients in their assigned city (${adminCity}).` });
  }

  await Client.softDelete(id);
  return res.json({ success: true, message: 'Client deleted' });
}

function canViewClientDetails(user) {
  if (!user) return false;
  const role = String(user.role || user.roleName || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (['superadmin', 'admin', 'staff', 'staffl1', 'staffl2', 'staffl3', 'supportstaff', 'manager'].includes(role)) return true;
  if (isSuperAdminUser(user)) return true;
  if (Array.isArray(user.roles)) {
    return user.roles.some((r) => ['superadmin', 'admin', 'staff', 'staffl1', 'staffl2', 'staffl3', 'supportstaff', 'manager'].includes(String(r.slug || r.name || '').toLowerCase().replace(/[\s_-]+/g, '')));
  }
  return false;
}

function vprof_name(row) {
  return row.vendor_business_name || row.vendor_name || 'Vendor';
}

function tryParseJson(value, fallback = []) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

async function fullDetails(req, res) {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid client ID is required' });
  }

  const currentUser = req.authUser || (req.session && req.session.user);
  if (!canViewClientDetails(currentUser)) {
    return res.status(403).json({ success: false, message: 'Access denied. Authorized admin or staff role required.' });
  }

  const isSuper = isSuperAdminUser(currentUser);
  const adminCity = await getAssignedUserCity(currentUser);

  const client = await Client.findById(id);
  if (!client) {
    return res.status(404).json({ success: false, message: 'Client not found' });
  }

  if (!isSuper && adminCity && client.city && client.city.toLowerCase() !== adminCity.toLowerCase()) {
    return res.status(403).json({ success: false, message: `Admins can only view clients in their assigned city (${adminCity}).` });
  }

  try {
    const pool = require('../db');
    const Wallet = require('../models/Wallet');
    const SupportTicket = require('../models/SupportTicket');

    // Wallet Balance
    const wallet = await Wallet.findByUserId(id).catch(() => null);

    // Fetch Client Orders
    const [orderRows] = await pool.query(
      `SELECT o.*,
              v.name AS vendor_name,
              vprof.business_name AS vendor_business_name,
              dp.name AS delivery_partner_name,
              dp.phone AS delivery_partner_phone
       FROM client_orders o
       LEFT JOIN users v ON v.id = o.vendor_id
       LEFT JOIN vendor_profiles vprof ON vprof.user_id = o.vendor_id
       LEFT JOIN users dp ON dp.id = o.delivery_partner_id
       WHERE o.client_id = ?
       ORDER BY o.created_at DESC`,
      [id]
    );

    const orders = orderRows.map((o) => ({
      id: o.id,
      order_number: o.order_number || `#${o.id}`,
      created_at: o.created_at,
      status_updated_at: o.status_updated_at,
      delivered_at: o.delivered_at,
      vendor_id: o.vendor_id,
      vendor_name: vprof_name(o),
      delivery_partner_id: o.delivery_partner_id,
      delivery_partner_name: o.delivery_partner_name || 'Unassigned',
      delivery_partner_phone: o.delivery_partner_phone || '',
      total_amount: Number(o.total_amount || 0),
      payment_method: o.payment_method || 'wallet',
      payment_status: o.payment_status || (['delivered', 'completed'].includes(String(o.status || '').toLowerCase()) ? 'paid' : 'pending'),
      status: o.status || 'pending',
      delivery_status: o.delivery_status || '',
      cancelled_by: o.cancelled_by || (String(o.status || '').toLowerCase() === 'cancelled' ? 'Client' : null),
      cancellation_reason: o.cancellation_reason || (String(o.status || '').toLowerCase() === 'cancelled' ? 'Cancelled by client' : null),
      cancelled_at: o.cancelled_at || (String(o.status || '').toLowerCase() === 'cancelled' ? o.updated_at : null),
      items: tryParseJson(o.items, []),
    }));

    const completedOrders = orders.filter((o) => ['delivered', 'completed'].includes(String(o.status || '').toLowerCase()));
    const cancelledOrders = orders.filter((o) => ['cancelled', 'rejected'].includes(String(o.status || '').toLowerCase()));
    const activePendingOrders = orders.filter((o) => ['pending', 'confirmed', 'processing', 'ready_for_pickup', 'out_for_delivery'].includes(String(o.status || '').toLowerCase()));
    const returnedRefundedOrders = orders.filter((o) => ['returned', 'refunded'].includes(String(o.status || '').toLowerCase()));

    // Fetch Complaints
    const complaints = await SupportTicket.list({ requesterId: id, requesterRole: 'Client' }).catch(() => []);

    const stats = {
      total_orders: orders.length,
      completed_orders: completedOrders.length,
      cancelled_orders: cancelledOrders.length,
      active_pending_orders: activePendingOrders.length,
      returned_refunded_orders: returnedRefundedOrders.length,
      total_complaints: complaints.length,
    };

    const fullClientDetails = {
      profile: {
        ...client,
        wallet_balance: Number(wallet?.balance || 0),
      },
      stats,
      orders,
      completed_orders: completedOrders,
      cancelled_orders: cancelledOrders,
      active_pending_orders: activePendingOrders,
      returned_refunded_orders: returnedRefundedOrders,
      complaints,
    };

    return res.json({ success: true, client: fullClientDetails });
  } catch (error) {
    console.error('Full client details error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch client full details' });
  }
}

async function updateComplaint(req, res) {
  const clientId = Number(req.params.id);
  const ticketId = Number(req.params.ticketId);

  if (!clientId || !ticketId) {
    return res.status(422).json({ success: false, message: 'Client ID and Complaint ID are required' });
  }

  const currentUser = req.authUser || (req.session && req.session.user);
  if (!canViewClientDetails(currentUser)) {
    return res.status(403).json({ success: false, message: 'Access denied. Authorized admin or staff role required.' });
  }

  try {
    const SupportTicket = require('../models/SupportTicket');
    const { status, resolution, assigned_staff_id } = req.body;
    const ticket = await SupportTicket.updateResolution({
      ticketId,
      status: status || 'Resolved',
      resolution: resolution || '',
      assignedStaffId: assigned_staff_id ? Number(assigned_staff_id) : currentUser.id,
    });

    return res.json({ success: true, message: 'Complaint updated successfully', ticket });
  } catch (error) {
    console.error('Update complaint error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Unable to update complaint' });
  }
}

module.exports = {
  index,
  show,
  create,
  update,
  destroy,
  fullDetails,
  updateComplaint,
  canViewClientDetails,
};


