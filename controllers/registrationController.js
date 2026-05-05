const bcrypt = require('bcryptjs');
const Vendor = require('../models/Vendor');
const Client = require('../models/Client');
const { validateVendor } = require('./vendorController');
const { validateClient } = require('./clientController');
const { flattenLocationOptions } = require('../utils/locationOptions');

function roleConfig(role) {
  if (role === 'vendor') {
    return {
      role: 'Vendor',
      title: 'Vendor Registration',
      action: '/register/vendor',
      loginPath: '/login/vendor',
      dashboardPath: '/vendor/dashboard',
      accent: 'vendor',
    };
  }

  return {
    role: 'Client',
    title: 'Client Registration',
    action: '/register/client',
    loginPath: '/login/client',
    dashboardPath: '/client/dashboard',
    accent: 'client',
  };
}

function renderRegister(res, role, options = {}) {
  return res.render('register', {
    ...roleConfig(role),
    locationOptions: flattenLocationOptions(),
    values: options.values || {},
    errors: options.errors || [],
  });
}

function sessionUser(account, role) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    themeMode: 'light',
    role,
    roleName: role,
    roles: [{ id: null, name: role, slug: role, level: 99, permissions: ['dashboard.view', 'wallets.view'] }],
    permissions: ['dashboard.view', 'wallets.view'],
  };
}

function safeValues(body) {
  const values = { ...body };
  delete values.password;
  delete values.confirm_password;
  return values;
}

async function showVendor(req, res) {
  return renderRegister(res, 'vendor');
}

async function showClient(req, res) {
  return renderRegister(res, 'client');
}

async function storeVendor(req, res) {
  const { errors, data } = validateVendor({ ...req.body, status: 'active' }, { requirePassword: true });
  if (req.body.password !== req.body.confirm_password) {
    errors.push('Passwords must match');
  }

  if (errors.length) {
    return renderRegister(res, 'vendor', { values: safeValues(req.body), errors });
  }

  const duplicate = await Vendor.emailOrPhoneTaken({ email: data.email, phone: data.phone });
  if (duplicate) {
    return renderRegister(res, 'vendor', {
      values: safeValues(req.body),
      errors: ['A user with this email or phone already exists'],
    });
  }

  try {
    data.status = 'active';
    data.password = await bcrypt.hash(data.password, 10);
    const id = await Vendor.create(data);
    const vendor = await Vendor.findById(id);
    req.session.user = sessionUser(vendor, 'Vendor');
    return res.redirect('/vendor/dashboard');
  } catch (error) {
    console.error('Vendor registration error:', error);
    return renderRegister(res, 'vendor', {
      values: safeValues(req.body),
      errors: ['Unable to create vendor account. Please try again later.'],
    });
  }
}

async function storeClient(req, res) {
  const { errors, data } = validateClient({ ...req.body, status: 'active' }, { requirePassword: true });
  if (req.body.password !== req.body.confirm_password) {
    errors.push('Passwords must match');
  }

  if (errors.length) {
    return renderRegister(res, 'client', { values: safeValues(req.body), errors });
  }

  const duplicate = await Client.emailOrPhoneTaken({ email: data.email, phone: data.phone });
  if (duplicate) {
    return renderRegister(res, 'client', {
      values: safeValues(req.body),
      errors: ['A user with this email or phone already exists'],
    });
  }

  try {
    data.status = 'active';
    data.password = await bcrypt.hash(data.password, 10);
    const id = await Client.create(data);
    const client = await Client.findById(id);
    req.session.user = sessionUser(client, 'Client');
    return res.redirect('/client/dashboard');
  } catch (error) {
    console.error('Client registration error:', error);
    return renderRegister(res, 'client', {
      values: safeValues(req.body),
      errors: ['Unable to create client account. Please try again later.'],
    });
  }
}

module.exports = {
  showVendor,
  showClient,
  storeVendor,
  storeClient,
};
