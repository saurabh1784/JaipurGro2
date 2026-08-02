const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../db');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Wallet = require('../models/Wallet');
const VendorProduct = require('../models/VendorProduct');

const googleClient = new OAuth2Client();

const defaultFirebaseWebConfig = {
  apiKey: 'AIzaSyCG0FluPYJBUtyKKYNtfVJv--M53I6PJTg',
  authDomain: 'groxen-522fb.firebaseapp.com',
  projectId: 'groxen-522fb',
  storageBucket: 'groxen-522fb.firebasestorage.app',
  messagingSenderId: '437730360569',
  appId: '1:437730360569:web:befe64bac9e8dc49fd3628',
  measurementId: 'G-3CZ4MV7RPS',
};

const defaultWebClientId = '437730360569-kft890puoh0m2f861q8k2mg2intqbur5.apps.googleusercontent.com';

let cachedFirebaseConfig = { ...defaultFirebaseWebConfig };
let cachedGoogleWebClientId = defaultWebClientId;

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

async function getFirebaseSettings() {
  const apiKey = await getSettingValue('firebase_web_api_key', process.env.FIREBASE_WEB_API_KEY || defaultFirebaseWebConfig.apiKey);
  const authDomain = await getSettingValue('firebase_auth_domain', process.env.FIREBASE_AUTH_DOMAIN || defaultFirebaseWebConfig.authDomain);
  const projectId = await getSettingValue('firebase_project_id', process.env.FIREBASE_PROJECT_ID || defaultFirebaseWebConfig.projectId);
  const storageBucket = await getSettingValue('firebase_storage_bucket', process.env.FIREBASE_STORAGE_BUCKET || defaultFirebaseWebConfig.storageBucket);
  const messagingSenderId = await getSettingValue('firebase_messaging_sender_id', process.env.FIREBASE_MESSAGING_SENDER_ID || defaultFirebaseWebConfig.messagingSenderId);
  const appId = await getSettingValue('firebase_web_app_id', process.env.FIREBASE_WEB_APP_ID || defaultFirebaseWebConfig.appId);
  const measurementId = await getSettingValue('firebase_measurement_id', process.env.FIREBASE_MEASUREMENT_ID || defaultFirebaseWebConfig.measurementId);
  const googleWebClientId = await getSettingValue('firebase_google_web_client_id', process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || defaultWebClientId);
  const serverKey = await getSettingValue('firebase_server_key', process.env.FIREBASE_SERVER_KEY || '');
  const pushNotificationsStr = await getSettingValue('firebase_push_notifications', 'true');

  cachedFirebaseConfig = {
    apiKey: apiKey.trim(),
    authDomain: authDomain.trim(),
    projectId: projectId.trim(),
    storageBucket: storageBucket.trim(),
    messagingSenderId: messagingSenderId.trim(),
    appId: appId.trim(),
    measurementId: measurementId.trim(),
    serverKey: serverKey.trim(),
    pushNotifications: pushNotificationsStr === 'true' || pushNotificationsStr === '1',
  };
  cachedGoogleWebClientId = googleWebClientId.trim();

  return {
    ...cachedFirebaseConfig,
    googleWebClientId: cachedGoogleWebClientId,
  };
}

async function saveFirebaseSettings(payload = {}) {
  if (payload.apiKey !== undefined) await saveSettingValue('firebase_web_api_key', payload.apiKey);
  if (payload.authDomain !== undefined) await saveSettingValue('firebase_auth_domain', payload.authDomain);
  if (payload.projectId !== undefined) await saveSettingValue('firebase_project_id', payload.projectId);
  if (payload.storageBucket !== undefined) await saveSettingValue('firebase_storage_bucket', payload.storageBucket);
  if (payload.messagingSenderId !== undefined) await saveSettingValue('firebase_messaging_sender_id', payload.messagingSenderId);
  if (payload.appId !== undefined) await saveSettingValue('firebase_web_app_id', payload.appId);
  if (payload.measurementId !== undefined) await saveSettingValue('firebase_measurement_id', payload.measurementId);
  if (payload.googleWebClientId !== undefined) await saveSettingValue('firebase_google_web_client_id', payload.googleWebClientId);
  if (payload.serverKey !== undefined) await saveSettingValue('firebase_server_key', payload.serverKey, 1);
  if (payload.pushNotifications !== undefined) await saveSettingValue('firebase_push_notifications', payload.pushNotifications ? 'true' : 'false');

  return await getFirebaseSettings();
}

function googleClientIds() {
  return [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    ...(process.env.GOOGLE_CLIENT_IDS || '').split(','),
    cachedGoogleWebClientId,
    defaultWebClientId,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function publicGoogleConfig() {
  return {
    webClientId: cachedGoogleWebClientId || process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || defaultWebClientId,
    firebase: {
      apiKey: cachedFirebaseConfig.apiKey || process.env.FIREBASE_WEB_API_KEY || defaultFirebaseWebConfig.apiKey,
      authDomain: cachedFirebaseConfig.authDomain || process.env.FIREBASE_AUTH_DOMAIN || defaultFirebaseWebConfig.authDomain,
      projectId: cachedFirebaseConfig.projectId || process.env.FIREBASE_PROJECT_ID || defaultFirebaseWebConfig.projectId,
      storageBucket: cachedFirebaseConfig.storageBucket || process.env.FIREBASE_STORAGE_BUCKET || defaultFirebaseWebConfig.storageBucket,
      messagingSenderId: cachedFirebaseConfig.messagingSenderId || process.env.FIREBASE_MESSAGING_SENDER_ID || defaultFirebaseWebConfig.messagingSenderId,
      appId: cachedFirebaseConfig.appId || process.env.FIREBASE_WEB_APP_ID || defaultFirebaseWebConfig.appId,
      measurementId: cachedFirebaseConfig.measurementId || process.env.FIREBASE_MEASUREMENT_ID || defaultFirebaseWebConfig.measurementId,
    },
  };
}

async function verifyGoogleIdToken(idToken) {
  const clientIds = googleClientIds();
  if (!clientIds.length) {
    const error = new Error('Google login is not configured. Set GOOGLE_WEB_CLIENT_ID or GOOGLE_CLIENT_ID.');
    error.status = 503;
    throw error;
  }

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
    email: String(payload.email).trim().toLowerCase(),
    name: String(payload.name || payload.email.split('@')[0] || 'User').trim(),
    subject: String(payload.sub || ''),
  };
}

function normalizeGoogleRole(role) {
  const value = String(role || 'Client').trim().toLowerCase();
  if (value === 'vendor') return 'Vendor';
  if (['deliveryperson', 'delivery_partner', 'deliverypersonnel', 'delivery'].includes(value)) {
    return 'deliveryPerson';
  }
  return 'Client';
}

async function findOrCreateGoogleUser(idToken, role = 'Client') {
  const requestedRole = normalizeGoogleRole(role);
  const googleUser = await verifyGoogleIdToken(idToken);
  const existingUser = await User.findByEmail(googleUser.email);

  if (existingUser) {
    if (String(existingUser.role || '').trim().toLowerCase() !== requestedRole.toLowerCase()) {
      const error = new Error('This Google account is already registered for another portal.');
      error.status = 409;
      throw error;
    }
    if (existingUser.status !== 'active' && existingUser.status !== 'pending') {
      const error = new Error('Your account is inactive.');
      error.status = 403;
      throw error;
    }

    await Profile.createEmptyForRole(existingUser.id, requestedRole);
    await Wallet.ensureForUser(existingUser.id);
    return existingUser;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(`google:${googleUser.subject}:${randomPassword}`, 10);
    const userId = await User.create({
      name: googleUser.name,
      email: googleUser.email,
      phone: null,
      password: hashedPassword,
      role: requestedRole,
      status: 'active',
    }, connection);
    await Profile.createEmptyForRole(userId, requestedRole, connection);
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

async function findOrCreateGoogleClient(idToken) {
  return findOrCreateGoogleUser(idToken, 'Client');
}

module.exports = {
  findOrCreateGoogleClient,
  findOrCreateGoogleUser,
  publicGoogleConfig,
  getFirebaseSettings,
  saveFirebaseSettings,
};
