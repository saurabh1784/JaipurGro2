const bcrypt = require('bcryptjs');
const pool = require('../db');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Wallet = require('../models/Wallet');
const VendorProduct = require('../models/VendorProduct');
const { sign } = require('../utils/jwt');
const { revokeToken } = require('../middleware/tokenBlacklist');
const { validateSignup, validateLogin } = require('../middleware/validators');
const { findOrCreateGoogleUser, publicGoogleConfig } = require('../services/googleClientAuthService');

function tokenPayload(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
  };
}

async function signup(req, res) {
  const errors = validateSignup(req.body);
  if (errors.length > 0) {
    return res.status(422).json({ success: false, message: 'Validation failed', errors });
  }

  const name = String(req.body.name).trim();
  const email = String(req.body.email).trim().toLowerCase();
  const phone = String(req.body.phone).trim();
  const password = String(req.body.password);
  const role = req.body.role;
  const city = String(req.body.city || '').trim().slice(0, 100);

  const existingUser = await User.findByEmailOrPhone(email, phone);
  if (existingUser) {
    const field = existingUser.email === email ? 'email' : 'phone';
    return res.status(409).json({ success: false, message: `A user with this ${field} already exists` });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = await User.create({ name, email, phone, password: hashedPassword, role }, connection);
    await Profile.createEmptyForRole(userId, role, connection);
    if (city && role === 'Client') {
      await connection.query(
        'UPDATE client_profiles SET city = $1 WHERE user_id = $2',
        [city, userId]
      );
    }
    if (city && role === 'Vendor') {
      await connection.query(
        'UPDATE vendor_profiles SET city = $1 WHERE user_id = $2',
        [city, userId]
      );
    }
    if (city && String(role).toLowerCase() === 'staff') {
      await connection.query(
        `INSERT INTO delivery_partner_settings (user_id, city, area, is_active)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, city, area) DO UPDATE SET is_active = EXCLUDED.is_active`,
        [userId, city, '*', 1]
      );
    }
    await Wallet.ensureForUser(userId, connection);
    if (role === 'Vendor') {
      await VendorProduct.ensureVendorHasAllProducts(userId, connection);
    }
    await connection.commit();

    const user = await User.findById(userId);
    const token = sign(tokenPayload(user));

    return res.status(201).json({
      success: true,
      message: 'Signup successful',
      token,
      user: User.publicUser(user),
    });
  } catch (error) {
    await connection.rollback();
    console.error('Signup error:', error);
    return res.status(500).json({ success: false, message: 'Unable to create user' });
  } finally {
    connection.release();
  }
}

async function login(req, res) {
  const errors = validateLogin(req.body);
  if (errors.length > 0) {
    return res.status(422).json({ success: false, message: 'Validation failed', errors });
  }

  const email = String(req.body.email).trim().toLowerCase();
  const user = await User.findByEmail(email);

  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ success: false, message: 'Your account is inactive' });
  }

  const passwordMatches = await bcrypt.compare(String(req.body.password), user.password);
  if (!passwordMatches) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const token = sign(tokenPayload(user));
  return res.json({
    success: true,
    message: 'Login successful',
    token,
    user: User.publicUser(user),
  });
}

function logout(req, res) {
  if (req.token) {
    revokeToken(req.token);
  }

  return res.json({ success: true, message: 'Logout successful' });
}

async function googleClientLogin(req, res) {
  const idToken = String(req.body.idToken || req.body.credential || '').trim();
  if (!idToken) {
    return res.status(422).json({ success: false, message: 'Google ID token is required' });
  }
  const requestedRole = String(req.body.role || 'Client').trim();
  if (!['Client', 'Vendor'].includes(requestedRole)) {
    return res.status(422).json({ success: false, message: 'Google login role must be Client or Vendor' });
  }

  try {
    const user = await findOrCreateGoogleUser(idToken, requestedRole);
    const token = sign(tokenPayload(user));
    return res.json({
      success: true,
      message: 'Google login successful',
      token,
      user: User.publicUser(user),
    });
  } catch (error) {
    console.error('Google client login error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to process Google login',
    });
  }
}

function googlePublicConfig(req, res) {
  try {
    return res.json({
      success: true,
      google: publicGoogleConfig(),
    });
  } catch (error) {
    console.error('Google public config error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load Google login configuration',
    });
  }
}

module.exports = { signup, login, logout, googleClientLogin, googlePublicConfig };
