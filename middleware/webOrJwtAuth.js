const { verify } = require('../utils/jwt');
const { isTokenRevoked } = require('./tokenBlacklist');
const User = require('../models/User');

async function webOrJwtAuth(req, res, next) {
  if (req.session && req.session.user) {
    req.authUser = req.session.user;
    req.authType = 'session';
    return next();
  }

  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token || isTokenRevoked(token)) {
      return res.status(401).json({ success: false, message: 'Authentication token required' });
    }

    const payload = verify(token);
    const user = await User.findById(payload.id);

    if (!user || user.status !== 'active') {
      return res.status(401).json({ success: false, message: 'User is not active or no longer exists' });
    }

    req.token = token;
    req.authUser = user;
    req.authType = 'jwt';
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: error.message || 'Invalid token' });
  }
}

function canManageUsers(user) {
  return Boolean(
    user &&
      (user.role === 'Admin' ||
        user.role === 'superadmin' ||
        (Array.isArray(user.permissions) && (user.permissions.includes('all') || user.permissions.includes('users.manage'))))
  );
}

function canManageProducts(user) {
  return Boolean(
    user &&
      (user.role === 'Admin' ||
        user.role === 'superadmin' ||
        (Array.isArray(user.permissions) &&
          (user.permissions.includes('all') || user.permissions.includes('products.manage'))))
  );
}

function canManageVendors(user) {
  return Boolean(
    user &&
      (user.role === 'Admin' ||
        user.role === 'superadmin' ||
        (Array.isArray(user.permissions) &&
          (user.permissions.includes('all') || user.permissions.includes('vendors.manage'))))
  );
}

function canManageClients(user) {
  return Boolean(
    user &&
      (user.role === 'Admin' ||
        user.role === 'superadmin' ||
        (Array.isArray(user.permissions) &&
          (user.permissions.includes('all') || user.permissions.includes('clients.manage'))))
  );
}

function canManageWallets(user) {
  return Boolean(
    user &&
      (user.role === 'Admin' ||
        user.role === 'superadmin' ||
        (Array.isArray(user.permissions) &&
          (user.permissions.includes('all') || user.permissions.includes('wallets.manage'))))
  );
}

function requireUserManagement(req, res, next) {
  if (canManageUsers(req.authUser)) {
    return next();
  }

  return res.status(403).json({ success: false, message: 'You do not have permission to manage users' });
}

function requireClientManagement(req, res, next) {
  if (canManageClients(req.authUser)) {
    return next();
  }

  return res.status(403).json({ success: false, message: 'You do not have permission to manage clients' });
}

function requireVendorManagement(req, res, next) {
  if (canManageVendors(req.authUser)) {
    return next();
  }

  return res.status(403).json({ success: false, message: 'You do not have permission to manage vendors' });
}

function requireProductManagement(req, res, next) {
  if (canManageProducts(req.authUser)) {
    return next();
  }

  return res.status(403).json({ success: false, message: 'You do not have permission to manage products' });
}

function requireWalletAccess(req, res, next) {
  if (req.authUser) {
    return next();
  }

  return res.status(403).json({ success: false, message: 'You do not have permission to access wallets' });
}

function requireProfileAccess(req, res, next) {
  if (canManageUsers(req.authUser) || Number(req.params.userId) === Number(req.authUser.id)) {
    return next();
  }

  return res.status(403).json({ success: false, message: 'You do not have permission to access this profile' });
}

module.exports = {
  webOrJwtAuth,
  requireUserManagement,
  requireClientManagement,
  requireVendorManagement,
  requireProductManagement,
  requireWalletAccess,
  requireProfileAccess,
  canManageUsers,
  canManageClients,
  canManageVendors,
  canManageProducts,
  canManageWallets,
};
