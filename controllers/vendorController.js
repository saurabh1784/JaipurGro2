const bcrypt = require('bcryptjs');
const Vendor = require('../models/Vendor');
const { validateStatus } = require('../middleware/validators');
const { vendorImagePath } = require('../middleware/vendorImageUpload');
const { flattenLocationOptions, isValidLocation, locationTree } = require('../utils/locationOptions');

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

function validateVendor(body, { requirePassword = false } = {}) {
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
    gst_number: body.gst_number ? String(body.gst_number).trim() : '',
    services: normalizeServices(body.services),
  };

  if (data.name.length < 2) errors.push('Name must be at least 2 characters');
  if (!isEmail(data.email)) errors.push('Valid email is required');
  if (!isPhone(data.phone)) errors.push('Valid phone is required');
  if (requirePassword && data.password.length < 6) errors.push('Password must be at least 6 characters');
  if (!requirePassword && data.password && data.password.length < 6) errors.push('Password must be at least 6 characters');
  if (!validateStatus(data.status)) errors.push('Status must be active or inactive');
  if (data.business_name.length < 2) errors.push('Business name must be at least 2 characters');
  if (!locationTree[data.country]) errors.push('Country is required');
  if (!data.country || !locationTree[data.country] || !locationTree[data.country][data.state]) {
    errors.push('State is required');
  }
  if (!isValidLocation(data)) {
    errors.push('City is required');
  }

  return { errors, data };
}

function applyUploadedImages(data, files = {}) {
  const fieldMap = {
    aadhaar_front: 'aadhaar_front_path',
    aadhaar_back: 'aadhaar_back_path',
    store_image: 'store_image_path',
    profile_image: 'profile_image_path',
  };

  for (const [fileField, dataField] of Object.entries(fieldMap)) {
    const file = Array.isArray(files[fileField]) ? files[fileField][0] : null;
    const imagePath = vendorImagePath(file);
    if (imagePath) {
      data[dataField] = imagePath;
    }
  }

  return data;
}

async function index(req, res) {
  if (!wantsJson(req)) {
    return res.render('vendors', {
      user: req.session.user,
      locationOptions: flattenLocationOptions(),
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
      city: req.query.city,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Vendor list error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch vendors' });
  }
}

async function show(req, res) {
  const vendor = await Vendor.findById(Number(req.params.id));
  if (!vendor) {
    return res.status(404).json({ success: false, message: 'Vendor not found' });
  }
  return res.json({ success: true, vendor });
}

async function create(req, res) {
  const { errors, data } = validateVendor(req.body, { requirePassword: true });
  applyUploadedImages(data, req.files);
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
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'A user with this email or phone already exists' });
    }
    console.error('Vendor create error:', error);
    return res.status(500).json({ success: false, message: 'Unable to create vendor' });
  }
}

async function update(req, res) {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid vendor ID is required' });
  }

  const existing = await Vendor.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Vendor not found' });
  }

  if (Object.keys(req.body).length === 1 && req.body.status !== undefined) {
    if (!validateStatus(req.body.status)) {
      return res.status(422).json({ success: false, message: 'Status must be active or inactive' });
    }
    await Vendor.updateStatus(id, req.body.status);
    return res.json({ success: true, message: 'Vendor status updated', vendor: await Vendor.findById(id) });
  }

  const { errors, data } = validateVendor(req.body);
  applyUploadedImages(data, req.files);
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

  await Vendor.update(id, data);
  return res.json({ success: true, message: 'Vendor updated', vendor: await Vendor.findById(id) });
}

async function destroy(req, res) {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid vendor ID is required' });
  }

  const existing = await Vendor.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Vendor not found' });
  }

  await Vendor.softDelete(id);
  return res.json({ success: true, message: 'Vendor deleted' });
}

module.exports = {
  index,
  show,
  create,
  update,
  destroy,
  validateVendor,
};
