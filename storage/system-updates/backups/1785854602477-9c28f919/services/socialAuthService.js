const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../db');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Wallet = require('../models/Wallet');
const DeliveryPerson = require('../models/DeliveryPerson');

const googleClient = new OAuth2Client();
const defaultWebClientId = '437730360569-kft890puoh0m2f861q8k2mg2intqbur5.apps.googleusercontent.com';

async function getSettingValue(key, defaultValue = '') {
  try {
    const [rows] = await pool.query(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
      [key]
    );
    if (rows && rows.length > 0 && rows[0].setting_value !== null && rows[0].setting_value !== undefined) {
      return String(rows[0].setting_value);
    }
  } catch (err) {
    // Ignore error if table not ready
  }
  return defaultValue;
}

async function saveSettingValue(key, value, isSecret = 0) {
  const cleanVal = String(value || '').trim();
  const [existing] = await pool.query(
    'SELECT setting_key FROM app_settings WHERE setting_key = ? LIMIT 1',
    [key]
  );
  if (existing && existing.length > 0) {
    await pool.query(
      'UPDATE app_settings SET setting_value = ?, is_secret = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
      [cleanVal, isSecret ? 1 : 0, key]
    );
  } else {
    await pool.query(
      'INSERT INTO app_settings (setting_key, setting_value, is_secret) VALUES (?, ?, ?)',
      [key, cleanVal, isSecret ? 1 : 0]
    );
  }
}

async function getSocialSettings() {
  const googleEnabledStr = await getSettingValue('social_login_google_enabled', process.env.GOOGLE_LOGIN_ENABLED || 'true');
  const googleClientId = await getSettingValue('social_login_google_client_id', process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || defaultWebClientId);

  const facebookEnabledStr = await getSettingValue('social_login_facebook_enabled', process.env.FACEBOOK_LOGIN_ENABLED || 'false');
  const facebookAppId = await getSettingValue('social_login_facebook_app_id', process.env.FACEBOOK_APP_ID || '');
  const facebookAppSecret = await getSettingValue('social_login_facebook_app_secret', process.env.FACEBOOK_APP_SECRET || '');

  return {
    googleEnabled: googleEnabledStr === 'true' || googleEnabledStr === '1',
    googleClientId: googleClientId.trim(),
    facebookEnabled: facebookEnabledStr === 'true' || facebookEnabledStr === '1',
    facebookAppId: facebookAppId.trim(),
    facebookAppSecret: facebookAppSecret.trim(),
  };
}

async function getPublicSocialConfig(appType = 'client') {
  const settings = await getSocialSettings();
  const otpAuthService = require('./otpAuthService');
  const otpSettings = await otpAuthService.getOtpSettings();

  const normApp = String(appType || 'client').trim().toLowerCase();
  const otpEnabled = normApp === 'vendor' ? otpSettings.vendorEnabled : (normApp === 'delivery' ? otpSettings.deliveryEnabled : otpSettings.clientEnabled);

  const availableMethods = ['password'];
  if (settings.googleEnabled) availableMethods.push('google');
  if (settings.facebookEnabled) availableMethods.push('facebook');
  if (otpEnabled) availableMethods.push('otp');

  return {
    google: {
      enabled: settings.googleEnabled,
      clientId: settings.googleClientId,
    },
    facebook: {
      enabled: settings.facebookEnabled,
      appId: settings.facebookAppId,
    },
    otp: {
      enabled: otpEnabled,
      defaultCountryCode: otpSettings.defaultCountryCode,
      resendCooldown: otpSettings.resendCooldown,
      expiryMinutes: otpSettings.expiryMinutes,
    },
    appType: normApp,
    availableLoginMethods: availableMethods,
  };
}

async function saveSocialSettings({ googleEnabled, googleClientId, facebookEnabled, facebookAppId, facebookAppSecret }) {
  await saveSettingValue('social_login_google_enabled', googleEnabled ? 'true' : 'false', 0);
  await saveSettingValue('social_login_google_client_id', googleClientId || '', 0);

  await saveSettingValue('social_login_facebook_enabled', facebookEnabled ? 'true' : 'false', 0);
  await saveSettingValue('social_login_facebook_app_id', facebookAppId || '', 0);
  if (facebookAppSecret !== undefined && facebookAppSecret !== '*****') {
    await saveSettingValue('social_login_facebook_app_secret', facebookAppSecret || '', 1);
  }
  return await getSocialSettings();
}

async function verifyGoogleIdToken(idToken) {
  const settings = await getSocialSettings();
  if (!settings.googleEnabled) {
    const error = new Error('Google Login is currently disabled by administrator.');
    error.status = 403;
    throw error;
  }

  const clientIds = [
    settings.googleClientId,
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    ...(process.env.GOOGLE_CLIENT_IDS || '').split(','),
    defaultWebClientId,
  ].map((v) => String(v || '').trim()).filter(Boolean);

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: clientIds,
  });
  const payload = ticket.getPayload();

  if (!payload || !payload.email || payload.email_verified !== true) {
    const error = new Error('Google account email is not verified.');
    error.status = 401;
    throw error;
  }

  return {
    provider: 'google',
    providerUserId: String(payload.sub || ''),
    email: String(payload.email).trim().toLowerCase(),
    name: String(payload.name || payload.email.split('@')[0] || 'Google User').trim(),
    picture: String(payload.picture || ''),
  };
}

async function verifyFacebookAccessToken(accessToken) {
  const settings = await getSocialSettings();
  if (!settings.facebookEnabled) {
    const error = new Error('Facebook Login is currently disabled by administrator.');
    error.status = 403;
    throw error;
  }

  if (!accessToken) {
    const error = new Error('Facebook access token is required.');
    error.status = 422;
    throw error;
  }

  let url = `https://graph.facebook.com/v19.0/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(accessToken)}`;
  if (settings.facebookAppSecret) {
    const appSecretProof = crypto.createHmac('sha256', settings.facebookAppSecret).update(accessToken).digest('hex');
    url += `&appsecret_proof=${appSecretProof}`;
  }

  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    const error = new Error(data.error.message || 'Invalid or expired Facebook access token.');
    error.status = 401;
    throw error;
  }

  const providerUserId = String(data.id || '');
  const email = data.email ? String(data.email).trim().toLowerCase() : '';
  const name = String(data.name || 'Facebook User').trim();
  const picture = data.picture && data.picture.data && data.picture.data.url ? String(data.picture.data.url) : '';

  return {
    provider: 'facebook',
    providerUserId,
    email,
    name,
    picture,
  };
}

function normalizeRole(role) {
  const value = String(role || 'Client').trim().toLowerCase();
  if (value === 'vendor') return 'Vendor';
  if (['deliveryperson', 'delivery_partner', 'deliverypersonnel', 'delivery'].includes(value)) {
    return 'deliveryPerson';
  }
  return 'Client';
}

function formatRoleLabel(role) {
  const norm = String(role || '').trim().toLowerCase();
  if (norm === 'vendor') return 'Vendor';
  if (['deliveryperson', 'delivery_partner', 'deliverypersonnel', 'delivery', 'staff'].includes(norm)) return 'Delivery Partner';
  return 'Customer';
}

function formatRoleApp(role) {
  const norm = String(role || '').trim().toLowerCase();
  if (norm === 'vendor') return 'Vendor App';
  if (['deliveryperson', 'delivery_partner', 'deliverypersonnel', 'delivery', 'staff'].includes(norm)) return 'Delivery Partner App';
  return 'Customer App';
}

async function handleSocialAuth({ provider, providerUserId, email, name, picture, role = 'Client', appType }) {
  const requestedRole = normalizeRole(role);

  let existingUser = null;
  if (provider && providerUserId) {
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE social_provider = ? AND social_provider_id = ? AND is_deleted = 0 LIMIT 1',
      [provider, providerUserId]
    );
    if (rows && rows.length > 0) {
      existingUser = rows[0];
    }
  }

  if (!existingUser && email) {
    existingUser = await User.findByEmail(email);
  }

  if (existingUser && (existingUser.is_deleted === 1 || existingUser.status === 'deleted')) {
    existingUser = null;
  }

  if (existingUser) {
    const targetApp = appType || (requestedRole === 'Vendor' ? 'vendor' : (requestedRole === 'deliveryPerson' ? 'delivery' : 'customer'));
    const { validateAppRoleAccess } = require('../utils/roleAccessValidator');
    const accessCheck = validateAppRoleAccess(existingUser.role, targetApp);

    if (!accessCheck.allowed) {
      const error = new Error(accessCheck.message);
      error.status = 403;
      throw error;
    }

    if (existingUser.status !== 'active' && existingUser.status !== 'pending') {
      const error = new Error(`Your account status is ${existingUser.status || 'inactive'}. Please contact your administrator.`);
      error.status = 403;
      throw error;
    }

    // Link provider and update profile picture if missing
    await pool.query(
      'UPDATE users SET social_provider = COALESCE(social_provider, ?), social_provider_id = COALESCE(social_provider_id, ?), profile_image = COALESCE(profile_image, ?) WHERE id = ?',
      [provider, providerUserId, picture || null, existingUser.id]
    );

    await Profile.createEmptyForRole(existingUser.id, requestedRole);
    await Wallet.ensureForUser(existingUser.id);
    return await User.findById(existingUser.id);
  }

  if (!email) {
    const error = new Error('Your social account did not provide an email address. Please enter and verify an email address to create your account.');
    error.status = 422;
    error.code = 'EMAIL_REQUIRED';
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(`${provider}:${providerUserId}:${randomPassword}`, 10);
    const isVendorOrDelivery = requestedRole === 'Vendor' || requestedRole === 'deliveryPerson';
    const initialStatus = isVendorOrDelivery ? 'pending' : 'active';

    const [res] = await connection.query(
      `INSERT INTO users (name, email, phone, password, role, status, social_provider, social_provider_id, profile_image)
       VALUES (?, ?, null, ?, ?, ?, ?, ?, ?)`,
      [name, email, hashedPassword, requestedRole, initialStatus, provider, providerUserId, picture || null]
    );
    const userId = res.insertId;

    await Profile.createEmptyForRole(userId, requestedRole, connection);
    if (requestedRole === 'deliveryPerson') {
      await DeliveryPerson.upsertProfile(userId, { city: '', area: '*', status: 'pending', is_available: false }, connection);
    }
    await Wallet.ensureForUser(userId, connection);
    await connection.commit();

    return await User.findById(userId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  getSocialSettings,
  getPublicSocialConfig,
  saveSocialSettings,
  verifyGoogleIdToken,
  verifyFacebookAccessToken,
  handleSocialAuth,
};
