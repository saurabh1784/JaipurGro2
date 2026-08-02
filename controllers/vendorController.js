const bcrypt = require('bcryptjs');
const pool = require('../db');
const Vendor = require('../models/Vendor');
const Catalog = require('../models/Catalog');
const VendorProfile = require('../models/VendorProfile');
const Wallet = require('../models/Wallet');
const Order = require('../models/Order');
const Quotation = require('../models/Quotation');
const { validateStatus } = require('../middleware/validators');
const { flattenLocationOptionsFromDb, isValidLocation, locationTree } = require('../utils/locationOptions');
const { isSuperAdminUser, getAssignedUserCity } = require('./userController');

function canViewVendorDetails(user) {
  if (!user) return false;
  const role = String(user.role || user.roleName || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (['superadmin', 'admin', 'staff', 'staffl1', 'staffl2', 'staffl3', 'supportstaff', 'manager'].includes(role)) return true;
  if (isSuperAdminUser(user)) return true;
  if (Array.isArray(user.roles)) {
    return user.roles.some((r) => ['superadmin', 'admin', 'staff', 'staffl1', 'staffl2', 'staffl3', 'supportstaff', 'manager'].includes(String(r.slug || r.name || '').toLowerCase().replace(/[\s_-]+/g, '')));
  }
  return false;
}

function wantsJson(req) {
  return req.baseUrl.startsWith('/api') || req.query.format === 'json' || req.accepts(['html', 'json']) === 'json';
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhone(value) {
  return /^[0-9+\-\s()]{7,20}$/.test(value);
}

function normalizeServices(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCategoryIds(value) {
  return Vendor.normalizeCategoryIds(value);
}

function isAdminUser(user) {
  const role = String((user && (user.role || user.roleName)) || '').toLowerCase().replace(/[\s_-]+/g, '');
  return role === 'admin' || role === 'superadmin';
}

function canManagePremiumVendors(req) {
  return isAdminUser(req.authUser || (req.session && req.session.user));
}

function validateVendor(body, { requirePassword = false, locationOptions = null } = {}) {
  const errors = [];
  const password = body.password ? String(body.password) : '';
  const data = {
    name: body.name ? String(body.name).trim() : '',
    email: body.email ? String(body.email).trim().toLowerCase() : '',
    phone: body.phone ? String(body.phone).trim() : '',
    password,
    status: body.status || 'active',
    business_name: body.business_name ? String(body.business_name).trim() : '',
    address: body.address ? String(body.address).trim() : '',
    country: body.country ? String(body.country).trim() : '',
    state: body.state ? String(body.state).trim() : '',
    city: body.city ? String(body.city).trim() : '',
    area: body.area ? String(body.area).trim() : '',
    gst_number: body.gst_number ? String(body.gst_number).trim() : '',
    services: normalizeServices(body.services),
    category_ids: normalizeCategoryIds(body.category_ids || body.categories),
    is_premium_vendor: body.is_premium_vendor === true || body.is_premium_vendor === 'true' || body.is_premium_vendor === '1' || body.is_premium_vendor === 1,
    premium_commission_percent: Math.max(0, Math.min(100, Number(body.premium_commission_percent || 0))),
  };

  if (data.name.length < 2) errors.push('Name must be at least 2 characters');
  if (!isEmail(data.email)) errors.push('Valid email is required');
  if (!isPhone(data.phone)) errors.push('Valid phone is required');
  if (requirePassword && data.password.length < 6) errors.push('Password must be at least 6 characters');
  if (!requirePassword && data.password && data.password.length < 6) errors.push('Password must be at least 6 characters');
  if (!validateStatus(data.status)) errors.push('Status must be active or inactive');
  if (data.business_name.length < 2) errors.push('Business name must be at least 2 characters');
  const optionTree = (locationOptions && locationOptions.tree) || locationTree;
  if (!optionTree[data.country]) errors.push('Country is required');
  if (!data.country || !optionTree[data.country] || !optionTree[data.country][data.state]) {
    errors.push('State is required');
  }
  if (!isValidLocation(data, locationOptions || { tree: optionTree })) {
    errors.push('City is required');
  }
  if (!Number.isFinite(data.premium_commission_percent)) {
    errors.push('Premium commission percentage must be a valid number');
  }

  return { errors, data };
}

async function index(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const adminCity = await getAssignedUserCity(currentUser);
  const filterCity = isSuper ? (req.query.city || '') : adminCity;

  if (!wantsJson(req)) {
    return res.render('vendors', {
      user: req.session.user,
      isSuperAdmin: isSuper,
      adminCity,
      locationOptions: await flattenLocationOptionsFromDb(),
      categories: await Catalog.listCategories(),
      canManagePremiumVendors: canManagePremiumVendors(req),
      canViewVendorDetails: canViewVendorDetails(currentUser),
    });
  }

  try {
    const result = await Vendor.list({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      status: req.query.status,
      country: req.query.country,
      state: req.query.state,
      city: filterCity,
    });
    if (!canManagePremiumVendors(req)) {
      result.vendors = (result.vendors || []).map((vendor) => {
        const clone = { ...vendor };
        delete clone.is_premium_vendor;
        delete clone.premium_commission_percent;
        return clone;
      });
    }
    return res.json({ success: true, isSuperAdmin: isSuper, adminCity, ...result });
  } catch (error) {
    console.error('Vendor list error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch vendors' });
  }
}

async function show(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const adminCity = await getAssignedUserCity(currentUser);

  const vendor = await Vendor.findById(Number(req.params.id));
  if (!vendor) {
    return res.status(404).json({ success: false, message: 'Vendor not found' });
  }

  if (!isSuper && adminCity && vendor.city && vendor.city.toLowerCase() !== adminCity.toLowerCase()) {
    return res.status(403).json({ success: false, message: `Admins can only view vendors in their assigned city (${adminCity}).` });
  }

  if (!canManagePremiumVendors(req)) {
    delete vendor.is_premium_vendor;
    delete vendor.premium_commission_percent;
  }
  return res.json({ success: true, vendor });
}

async function create(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const adminCity = await getAssignedUserCity(currentUser);

  if (!isSuper && adminCity) {
    if (req.body.city && String(req.body.city).trim().toLowerCase() !== adminCity.toLowerCase()) {
      return res.status(403).json({ success: false, message: `Admins can only create vendors for their assigned city (${adminCity}).` });
    }
    req.body.city = adminCity;
  }

  const locationOptions = await flattenLocationOptionsFromDb();
  const { errors, data } = validateVendor(req.body, { requirePassword: true, locationOptions });
  if (!canManagePremiumVendors(req)) {
    data.is_premium_vendor = false;
    data.premium_commission_percent = 0;
  }
  if (errors.length) {
    return res.status(422).json({ success: false, message: 'Validation failed', errors });
  }

  const duplicate = await Vendor.emailOrPhoneTaken({ email: data.email, phone: data.phone });
  if (duplicate) {
    return res.status(409).json({ success: false, message: 'A user with this email or phone already exists' });
  }

  try {
    data.password = await bcrypt.hash(data.password, 10);
    const id = await Vendor.create(data);
    return res.status(201).json({ success: true, message: 'Vendor created', vendor: await Vendor.findById(id) });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A user with this email or phone already exists' });
    }
    console.error('Vendor create error:', error);
    return res.status(500).json({ success: false, message: 'Unable to create vendor' });
  }
}

async function update(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const adminCity = await getAssignedUserCity(currentUser);
  const id = Number(req.params.id);

  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid vendor ID is required' });
  }

  const existing = await Vendor.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Vendor not found' });
  }

  if (!isSuper && adminCity) {
    if (existing.city && existing.city.toLowerCase() !== adminCity.toLowerCase()) {
      return res.status(403).json({ success: false, message: `Admins can only manage vendors in their assigned city (${adminCity}).` });
    }
    req.body.city = adminCity;
  }

  if (Object.keys(req.body).length === 1 && req.body.status !== undefined) {
    if (!validateStatus(req.body.status)) {
      return res.status(422).json({ success: false, message: 'Status must be active or inactive' });
    }
    await Vendor.updateStatus(id, req.body.status);
    return res.json({ success: true, message: 'Vendor status updated', vendor: await Vendor.findById(id) });
  }

  const locationOptions = await flattenLocationOptionsFromDb();
  const { errors, data } = validateVendor(req.body, { locationOptions });
  if (!canManagePremiumVendors(req)) {
    data.is_premium_vendor = existing.is_premium_vendor;
    data.premium_commission_percent = existing.premium_commission_percent;
  }
  if (errors.length) {
    return res.status(422).json({ success: false, message: 'Validation failed', errors });
  }

  const duplicate = await Vendor.emailOrPhoneTaken({ id, email: data.email, phone: data.phone });
  if (duplicate) {
    return res.status(409).json({ success: false, message: 'A user with this email or phone already exists' });
  }

  if (data.password) {
    data.password = await bcrypt.hash(data.password, 10);
  }

  try {
    await Vendor.update(id, data);
    return res.json({ success: true, message: 'Vendor updated', vendor: await Vendor.findById(id) });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A user with this email or phone already exists' });
    }
    console.error('Vendor update error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update vendor' });
  }
}

async function destroy(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const adminCity = await getAssignedUserCity(currentUser);
  const id = Number(req.params.id);

  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid vendor ID is required' });
  }

  const existing = await Vendor.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Vendor not found' });
  }

  if (!isSuper && adminCity) {
    if (existing.city && existing.city.toLowerCase() !== adminCity.toLowerCase()) {
      return res.status(403).json({ success: false, message: `Admins can only delete vendors in their assigned city (${adminCity}).` });
    }
  }

  await Vendor.softDelete(id);
  return res.json({ success: true, message: 'Vendor deleted' });
}

async function fullDetails(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  if (!canViewVendorDetails(currentUser)) {
    return res.status(403).json({ success: false, message: 'Only Superadmin, Admin, and Staff are allowed to view vendor details' });
  }

  const id = Number(req.params.id);
  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid vendor ID is required' });
  }

  const vendor = await Vendor.findById(id);
  if (!vendor) {
    return res.status(404).json({ success: false, message: 'Vendor not found' });
  }

  const isSuper = isSuperAdminUser(currentUser);
  const adminCity = await getAssignedUserCity(currentUser);
  if (!isSuper && adminCity && vendor.city && vendor.city.toLowerCase() !== adminCity.toLowerCase()) {
    return res.status(403).json({ success: false, message: `Admins can only view vendors in their assigned city (${adminCity}).` });
  }

  try {
    const profile = await VendorProfile.findByUserId(id).catch(() => null);
    const wallet = await Wallet.findByUserId(id).catch(() => ({ balance: 0 }));

    // Stat Totals
    const [orderStatsRows] = await pool.query(
      `SELECT COUNT(*) AS total_served,
              COALESCE(SUM(o.total_amount), 0) AS total_earned
       FROM orders o
       LEFT JOIN (
         SELECT DISTINCT order_id, vendor_id FROM order_items WHERE vendor_id IS NOT NULL
       ) item_vendor ON item_vendor.order_id = o.id
       WHERE COALESCE(o.vendor_id, item_vendor.vendor_id) = ?
         AND LOWER(o.status) IN ('delivered', 'completed')`,
      [id]
    ).catch(() => [[{ total_served: 0, total_earned: 0 }]]);

    const totalOrdersServed = Number(orderStatsRows[0]?.total_served || 0);
    const totalAmountEarned = Number(orderStatsRows[0]?.total_earned || 0);

    const [bidsRows] = await pool.query(
      `SELECT COUNT(*) AS total_bids
       FROM quotation_vendor_recipients
       WHERE vendor_id = ?`,
      [id]
    ).catch(() => [[{ total_bids: 0 }]]);
    const totalBidsAssigned = Number(bidsRows[0]?.total_bids || 0);

    // Fetch Vendor Orders
    const rawOrders = await Order.listByVendor(id).catch(() => []);
    const orders = (rawOrders || []).map((o) => ({
      id: o.id,
      order_number: o.order_number || `#${o.id}`,
      created_at: o.created_at,
      client_name: o.client_name || o.shipping_name || 'Client',
      client_phone: o.client_phone || o.shipping_phone || '-',
      total_amount: Number(o.total_amount || 0),
      payment_method: o.payment_method || 'wallet',
      status: o.status || 'pending',
    }));

    // Fetch Vendor Quotations / Bids
    const rawQuotations = await Quotation.listForVendor(id, { includeAll: true }).catch(() => []);
    const quotations = (rawQuotations || []).map((q) => ({
      id: q.id || q.quotation_request_id,
      quotation_request_id: q.quotation_request_id || q.id,
      created_at: q.created_at,
      client_city: q.client_city || q.city || '-',
      client_area: q.client_area || q.area || '-',
      total_amount: Number(q.total_amount || q.expected_price || 0),
      status: q.status || q.recipient_status || 'new',
      expires_at: q.expires_at,
      item_count: Array.isArray(q.items) ? q.items.length : 0,
    }));

    // Tax detail summary
    const gstNumber = profile?.gst_number || vendor.gst_number || 'Not Provided';
    const gstRate = 5;
    const estimatedGstAmount = Number(((totalAmountEarned * gstRate) / 100).toFixed(2));

    const accountHealth = Number(vendor.account_health !== undefined ? vendor.account_health : (profile?.account_health ?? 500));
    const hasWarning = accountHealth < 250;
    const isOnHold = accountHealth < 180 || String(vendor.status || '').toLowerCase() === 'on_hold';
    const warningMessage = hasWarning
      ? `Account Health Warning: Your account health is low (${accountHealth}/500). Please fulfill orders and bid promptly to avoid account suspension.`
      : null;

    const fullVendorDetails = {
      profile: {
        ...vendor,
        account_health: accountHealth,
        has_health_warning: hasWarning,
        health_warning_message: warningMessage,
        is_on_hold: isOnHold,
        logo_path: profile?.logo_path || null,
        storefront_image_path: profile?.storefront_image_path || null,
        signature_path: profile?.signature_path || null,
        pincode: profile?.pincode || null,
        pickup_latitude: profile?.pickup_latitude || null,
        pickup_longitude: profile?.pickup_longitude || null,
      },
      stats: {
        total_orders_served: totalOrdersServed,
        total_amount_earned: totalAmountEarned,
        wallet_balance: Number(wallet?.balance || 0),
        total_bids_assigned: totalBidsAssigned,
        account_health: accountHealth,
        has_health_warning: hasWarning,
        health_warning_message: warningMessage,
        is_on_hold: isOnHold,
      },
      orders,
      quotations,
      tax: {
        gst_number: gstNumber,
        business_name: vendor.business_name || profile?.business_name || vendor.name,
        gst_status: gstNumber && gstNumber !== 'Not Provided' ? 'Active / Registered' : 'Not Registered',
        taxable_turnover: totalAmountEarned,
        estimated_gst_rate: `${gstRate}%`,
        estimated_gst_amount: estimatedGstAmount,
        commission_percent: Number(vendor.premium_commission_percent || 0),
        is_premium: Boolean(vendor.is_premium_vendor),
      },
    };

    return res.json({ success: true, vendor: fullVendorDetails });
  } catch (error) {
    console.error('Full vendor details error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch vendor full details' });
  }
}

module.exports = {
  index,
  show,
  fullDetails,
  create,
  update,
  destroy,
};


