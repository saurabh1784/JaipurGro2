const rolesAllowedForSignup = ['Vendor', 'Client', 'staff', 'deliveryPerson'];
const allApiRoles = ['Admin', 'Vendor', 'Client'];
const editableUserRoles = ['Admin', 'Vendor', 'Client', 'superadmin', 'admin', 'manager', 'staff', 'deliveryPerson', 'staff-l1', 'staff-l2', 'staff-l3', 'support-staff', 'accountant'];
const statuses = ['active', 'inactive'];

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhone(value) {
  return /^[0-9+\-\s()]{7,20}$/.test(value);
}

function validateSignup(body) {
  const errors = [];
  const { name, email, phone, password, role } = body;

  if (!name || String(name).trim().length < 2) errors.push('Name must be at least 2 characters');
  if (!email || !isEmail(email)) errors.push('Valid email is required');
  if (!phone || !isPhone(phone)) errors.push('Valid phone is required');
  if (!password || String(password).length < 6) errors.push('Password must be at least 6 characters');
  if (!rolesAllowedForSignup.includes(role)) errors.push('Signup role must be Vendor, Client, staff, or deliveryPerson');

  return errors;
}

function validateLogin(body) {
  const errors = [];
  const identifier = String(body.identifier || body.email || body.phone || '').trim();
  if (!identifier) errors.push('Email, phone, or login ID is required');
  if (!body.password) errors.push('Password is required');
  return errors;
}

function validateStatus(status) {
  return !status || statuses.includes(status);
}

module.exports = {
  allApiRoles,
  editableUserRoles,
  rolesAllowedForSignup,
  validateSignup,
  validateLogin,
  validateStatus,
};
