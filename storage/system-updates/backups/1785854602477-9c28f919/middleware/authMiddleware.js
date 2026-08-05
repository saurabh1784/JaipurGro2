const { verify } = require('../utils/jwt');
const { isTokenRevoked } = require('./tokenBlacklist');
const User = require('../models/User');

async function authenticateJwt(req, res, next) {
  if (req.session && req.session.user) {
    req.user = req.session.user;
    req.authUser = req.session.user;
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

    if (isTokenRevoked(token)) {
      return res.status(401).json({ success: false, message: 'Token has been logged out' });
    }

    const payload = verify(token);
    const user = await User.findById(payload.id);

    if (!user || user.status === 'inactive' || user.status === 'suspended' || user.status === 'blocked' || user.status === 'deleted' || user.is_deleted === 1) {
      return res.status(401).json({ success: false, message: 'User is not active or no longer exists' });
    }

    req.token = token;
    req.user = user;
    req.authUser = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: error.message || 'Invalid token' });
  }
}

module.exports = authenticateJwt;
