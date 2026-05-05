const { verify } = require('../utils/jwt');
const { isTokenRevoked } = require('./tokenBlacklist');
const User = require('../models/User');

async function authenticateJwt(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ success: false, message: 'Authentication token required' });
    }

    if (isTokenRevoked(token)) {
      return res.status(401).json({ success: false, message: 'Token has been logged out' });
    }

    const payload = verify(token);
    const user = await User.findById(payload.id);

    if (!user || user.status !== 'active') {
      return res.status(401).json({ success: false, message: 'User is not active or no longer exists' });
    }

    req.token = token;
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: error.message || 'Invalid token' });
  }
}

module.exports = authenticateJwt;
