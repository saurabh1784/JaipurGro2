const { verify } = require('../utils/jwt');
const { isTokenRevoked } = require('./tokenBlacklist');
const User = require('../models/User');

function isSuperAdminUser(user) {
  const value = String((user && (user.role || user.roleName)) || '').toLowerCase().replace(/[\s_-]+/g, '');
  return value === 'superadmin';
}

function hasPermission(user, permission) {
  return Boolean(
    user &&
      (isSuperAdminUser(user) ||
        (Array.isArray(user.permissions) && (user.permissions.includes('all') || user.permissions.includes(permission))))
  );
}

async function webOrJwtAuth(req, res, next) {
  if (req.session && req.session.user) {
    req.authUser = req.session.user;
    req.authType = 'session';
    return next();
  }

  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, headerToken] = authHeader.split(' ');
    const queryToken = typeof req.query.access_token === 'string'
      ? req.query.access_token
      : (typeof req.query.token === 'string' ? req.query.token : '');
    const cookieToken = (req.cookies && (req.cookies.token || req.cookies.jwt)) || '';
    const token = headerToken || queryToken || cookieToken;

    if ((!queryToken && !cookieToken && scheme !== 'Bearer') || !token || isTokenRevoked(token)) {
      return res.status(401).json({ success: false, message: 'Authentication token required' });
    }

    const payload = verify(token);
    const user = await User.findById(payload.id);

    if (!user || user.status === 'inactive' || user.status === 'suspended' || user.status === 'blocked' || user.status === 'deleted' || user.is_deleted === 1) {
      return res.status(401).json({ success: false, message: 'User is not active or no longer exists' });
    }

    req.token = token;
    req.authUser = user;
    req.authType = 'jwt';
    if (req.session && !req.session.user) {
      const fallbackPermissions = user.role === 'Client'
        ? ['dashboard.view', 'wallets.view', 'coupons.apply']
        : ['dashboard.view', 'wallets.view'];
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        themeMode: user.theme_mode || 'light',
        role: user.role,
        roleName: user.role,
        roles: [{ id: null, name: user.role, slug: user.role, level: 99, permissions: user.permissions || fallbackPermissions }],
        permissions: user.permissions || fallbackPermissions,
      };
    }
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: error.message || 'Invalid token' });
  }
}

// KYC is the only authenticated workflow an inactive partner may use. Keep
// regular authentication strict so unapproved users cannot access dashboards.
async function kycPartnerAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token || isTokenRevoked(token)) {
      return res.status(401).json({ success: false, message: 'Authentication token required' });
    }
    const payload = verify(token);
    const user = await User.findById(payload.id);
    const role = String(user && user.role || '').toLowerCase();
    const status = String(user && user.status || '').toLowerCase();
    if (!user || user.is_deleted === 1 || ['suspended', 'blocked', 'deleted'].includes(status)) {
      return res.status(401).json({ success: false, message: 'User is blocked or no longer exists' });
    }
    if (!['vendor', 'deliveryperson'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Partner account required' });
    }
    req.token = token;
    req.user = user;
    req.authUser = user;
    req.authType = 'jwt';
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: error.message || 'Invalid token' });
  }
}
function canManageUsers(user) {
  return Boolean(
    user &&
      (user.role === 'Admin' ||
        hasPermission(user, 'users.manage'))
  );
}

function canManageProducts(user) {
  return Boolean(
    user &&
      (user.role === 'Admin' ||
        hasPermission(user, 'products.manage'))
  );
}

function canManageVendors(user) {
  return Boolean(
    user &&
      (user.role === 'Admin' ||
        hasPermission(user, 'vendors.manage'))
  );
}

function canManageClients(user) {
  return Boolean(
    user &&
      (user.role === 'Admin' ||
        hasPermission(user, 'clients.manage'))
  );
}

function canManageWallets(user) {
  return Boolean(
    user &&
      (user.role === 'Admin' ||
        hasPermission(user, 'wallets.manage'))
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

function requireAuthRole(roleName) {
  return function (req, res, next) {
    const user = req.authUser || (req.session && req.session.user) || req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const userRole = String(user.role || '').toLowerCase();
    const targetRole = String(roleName || '').toLowerCase();
    if (userRole !== targetRole && userRole !== 'superadmin' && userRole !== 'admin') {
      return res.status(403).json({ success: false, message: `${roleName} access required` });
    }
    req.user = user;
    next();
  };
}

async function requireApprovedUser(req, res, next) {
  const user = req.authUser || (req.session && req.session.user) || req.user;
  if (!user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const isSuperAdminOrAdmin = ['superadmin', 'admin'].includes(String(user.role || '').toLowerCase());
  if (isSuperAdminOrAdmin) {
    return next();
  }

  const { getProfileCompletionStatus } = require('../services/profileCompletionService');
  const statusCheck = await getProfileCompletionStatus(user.id);
  if (statusCheck.isApproved) {
    return next();
  }

  return res.status(403).json({
    success: false,
    isApproved: false,
    isProfileComplete: statusCheck.isComplete,
    approvalStatus: statusCheck.approvalStatus,
    message: statusCheck.statusMessage,
    bannerMessage: statusCheck.bannerMessage,
    missingFields: statusCheck.missingFields,
  });
}

module.exports = {
  webOrJwtAuth,
  kycPartnerAuth,
  requireAuthRole,
  requireApprovedUser,
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
