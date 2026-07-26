const bcrypt = require('bcryptjs');
const pool = require('../db');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Wallet = require('../models/Wallet');
const VendorProduct = require('../models/VendorProduct');
const DeliveryPerson = require('../models/DeliveryPerson');
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
  const area = String(req.body.area || '').trim().slice(0, 120);

  const existingUser = await User.findByEmailOrPhone(email, phone);
  if (existingUser) {
    const field = existingUser.email === email ? 'email' : 'phone';
    return res.status(409).json({ success: false, message: `A user with this ${field} already exists` });
  }

  const gstNumber = String(req.body.gst_number || req.body.gstNumber || '').trim();
  const gstNotApplicable = Boolean(req.body.gst_not_applicable || req.body.gstNotApplicable);

  if (role === 'Vendor') {
    const appSettingsController = require('./appSettingsController');
    const Vendor = require('../models/Vendor');
    const isGstMandatory = await appSettingsController.getGstMandatory();

    if (isGstMandatory && !gstNumber) {
      return res.status(422).json({ success: false, message: 'GST Number is required for vendor registration.' });
    }

    if (!isGstMandatory && !gstNotApplicable && !gstNumber) {
      return res.status(422).json({ success: false, message: 'GST Number is required unless GST Not Applicable is checked.' });
    }

    if (gstNumber) {
      const existingGst = await Vendor.gstNumberTaken({ gst_number: gstNumber });
      if (existingGst) {
        return res.status(422).json({ success: false, message: 'A vendor with this GST Number is already registered.' });
      }
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const hashedPassword = await bcrypt.hash(password, 10);
    const initialStatus = role === 'Vendor' ? 'pending' : 'active';
    const userId = await User.create({ name, email, phone, password: hashedPassword, role, status: initialStatus }, connection);
    await Profile.createEmptyForRole(userId, role, connection);
    if (city && role === 'Client') {
      await connection.query(
        'UPDATE client_profiles SET city = $1, area = $2 WHERE user_id = $3',
        [city, area || null, userId]
      );
    }
    if (role === 'Vendor') {
      await connection.query(
        'UPDATE vendor_profiles SET city = $1, gst_number = $2 WHERE user_id = $3',
        [city || null, gstNumber || null, userId]
      );
    }
    if (city && ['staff', 'deliveryperson'].includes(String(role).toLowerCase())) {
      await connection.query(
        `INSERT INTO delivery_partner_settings (user_id, city, area, is_active)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, city, area) DO UPDATE SET is_active = EXCLUDED.is_active`,
        [userId, city, '*', 1]
      );
      await DeliveryPerson.upsertProfile(userId, { city, area: '*', status: 'active', is_available: true }, connection);
    }
    await Wallet.ensureForUser(userId, connection);
    await connection.commit();

    const user = await User.findById(userId);
    const token = sign(tokenPayload(user));

    const referralCode = req.body.referral_code || req.body.referralCode;
    if (referralCode && referralCode.trim()) {
      const referralController = require('./referralController');
      await referralController.processReferralOnSignup(user, referralCode.trim());
    }

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

  const identifier = String(req.body.identifier || req.body.email || req.body.phone || '').trim();
  const user = await User.findByEmailOrPhoneIdentifier(identifier);

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

    const referralCode = req.body.referral_code || req.body.referralCode;
    if (referralCode && referralCode.trim()) {
      const referralController = require('./referralController');
      await referralController.processReferralOnSignup(user, referralCode.trim());
    }

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
