const bcrypt = require('bcryptjs');
const Client = require('../models/Client');
const { validateStatus } = require('../middleware/validators');
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

function validateClient(body, { requirePassword = false } = {}) {
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
    age: ageValue,
    gender: body.gender ? String(body.gender).trim() : '',
    notes: body.notes ? String(body.notes).trim() : '',
  };

  if (data.name.length < 2) errors.push('Name must be at least 2 characters');
  if (!isEmail(data.email)) errors.push('Valid email is required');
  if (!isPhone(data.phone)) errors.push('Valid phone is required');
  if (requirePassword && data.password.length < 6) errors.push('Password must be at least 6 characters');
  if (!requirePassword && data.password && data.password.length < 6) errors.push('Password must be at least 6 characters');
  if (!validateStatus(data.status)) errors.push('Status must be active or inactive');
  if (!locationTree[data.country]) errors.push('Country is required');
  if (!data.country || !locationTree[data.country] || !locationTree[data.country][data.state]) errors.push('State is required');
  if (!isValidLocation(data)) errors.push('City is required');
  if (data.age !== '' && (!Number.isInteger(data.age) || data.age < 1 || data.age > 120)) {
    errors.push('Age must be between 1 and 120');
  }

  return { errors, data };
}

async function index(req, res) {
  if (!wantsJson(req)) {
    return res.render('clients', {
      user: req.session.user,
      locationOptions: flattenLocationOptions(),
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
      city: req.query.city,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Client list error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch clients' });
  }
}

async function show(req, res) {
  const client = await Client.findById(Number(req.params.id));
  if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
  return res.json({ success: true, client });
}

async function create(req, res) {
  const { errors, data } = validateClient(req.body, { requirePassword: true });
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
  const id = Number(req.params.id);
  if (!id) return res.status(422).json({ success: false, message: 'Valid client ID is required' });

  const existing = await Client.findById(id);
  if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });

  if (Object.keys(req.body).length === 1 && req.body.status !== undefined) {
    if (!validateStatus(req.body.status)) {
      return res.status(422).json({ success: false, message: 'Status must be active or inactive' });
    }
    await Client.updateStatus(id, req.body.status);
    return res.json({ success: true, message: 'Client status updated', client: await Client.findById(id) });
  }

  const { errors, data } = validateClient(req.body);
  if (errors.length) return res.status(422).json({ success: false, message: 'Validation failed', errors });

  const duplicate = await Client.emailOrPhoneTaken({ id, email: data.email, phone: data.phone });
  if (duplicate) return res.status(409).json({ success: false, message: 'A user with this email or phone already exists' });

  if (data.password) data.password = await bcrypt.hash(data.password, 10);
  await Client.update(id, data);
  return res.json({ success: true, message: 'Client updated', client: await Client.findById(id) });
}

async function destroy(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(422).json({ success: false, message: 'Valid client ID is required' });

  const existing = await Client.findById(id);
  if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });

  await Client.softDelete(id);
  return res.json({ success: true, message: 'Client deleted' });
}

module.exports = {
  index,
  show,
  create,
  update,
  destroy,
};
