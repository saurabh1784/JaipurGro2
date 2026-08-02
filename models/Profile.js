const VendorProfile = require('./VendorProfile');
const ClientProfile = require('./ClientProfile');
const AdminProfile = require('./AdminProfile');
const DeliveryPerson = require('./DeliveryPerson');

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
  const normRole = String(role || '').trim().toLowerCase();
  if (role === 'Vendor' || normRole === 'vendor') return VendorProfile.createEmpty(userId, connection);
  if (role === 'Client' || normRole === 'client') return ClientProfile.createEmpty(userId, connection);
  if (role === 'Admin' || normRole === 'admin') return AdminProfile.createEmpty(userId, connection);
  if (normRole === 'deliveryperson' || normRole === 'delivery_partner' || normRole === 'staff') {
    return DeliveryPerson.upsertProfile(userId, { city: '', area: '*', status: 'active', is_available: true }, connection);
  }
  return null;
}

async function findByRole(userId, role) {
  let profile = null;
  const normRole = String(role || '').trim().toLowerCase();

  if (normRole === 'vendor') profile = await VendorProfile.findByUserId(userId);
  if (normRole === 'client') profile = await ClientProfile.findByUserId(userId);
  if (normRole === 'admin') profile = await AdminProfile.findByUserId(userId);
  if (['deliveryperson', 'delivery_partner', 'delivery', 'driver', 'staff', 'rider'].includes(normRole)) {
    profile = await DeliveryPerson.findById(userId);
  }

  if (profile && Object.prototype.hasOwnProperty.call(profile, 'services')) {
    profile.services = normalizeJsonField(profile.services);
  }

  if (profile && Object.prototype.hasOwnProperty.call(profile, 'permissions')) {
    profile.permissions = normalizeJsonField(profile.permissions);
  }

  return profile;
}

async function updateByRole(userId, role, data) {
  const normRole = String(role || '').trim().toLowerCase();
  if (normRole === 'vendor') return VendorProfile.update(userId, data);
  if (normRole === 'client') return ClientProfile.update(userId, data);
  if (normRole === 'admin') return AdminProfile.update(userId, data);
  if (['deliveryperson', 'delivery_partner', 'delivery', 'driver', 'staff', 'rider'].includes(normRole)) {
    return DeliveryPerson.upsertProfile(userId, data);
  }
  return null;
}

module.exports = { createEmptyForRole, findByRole, updateByRole };
