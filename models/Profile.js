const VendorProfile = require('./VendorProfile');
const ClientProfile = require('./ClientProfile');
const AdminProfile = require('./AdminProfile');

function normalizeJsonField(value) {
  if (!value) return value;
  if (Array.isArray(value)) return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function createEmptyForRole(userId, role, connection) {
  if (role === 'Vendor') return VendorProfile.createEmpty(userId, connection);
  if (role === 'Client') return ClientProfile.createEmpty(userId, connection);
  if (role === 'Admin') return AdminProfile.createEmpty(userId, connection);
  return null;
}

async function findByRole(userId, role) {
  let profile = null;

  if (role === 'Vendor') profile = await VendorProfile.findByUserId(userId);
  if (role === 'Client') profile = await ClientProfile.findByUserId(userId);
  if (role === 'Admin') profile = await AdminProfile.findByUserId(userId);

  if (profile && Object.prototype.hasOwnProperty.call(profile, 'services')) {
    profile.services = normalizeJsonField(profile.services);
  }

  if (profile && Object.prototype.hasOwnProperty.call(profile, 'permissions')) {
    profile.permissions = normalizeJsonField(profile.permissions);
  }

  return profile;
}

async function updateByRole(userId, role, data) {
  if (role === 'Vendor') return VendorProfile.update(userId, data);
  if (role === 'Client') return ClientProfile.update(userId, data);
  if (role === 'Admin') return AdminProfile.update(userId, data);
  return null;
}

module.exports = { createEmptyForRole, findByRole, updateByRole };
