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
  apiKey: 'AIzaSyB_YbeZvGqMNJDk3IcEAWGhOq8owrcAl60',
  authDomain: 'grosio-3f991.firebaseapp.com',
  projectId: 'grosio-3f991',
  storageBucket: 'grosio-3f991.firebasestorage.app',
  messagingSenderId: '1012871345847',
  appId: '1:1012871345847:web:068d4fe52c8f16b3307f32',
  measurementId: 'G-9JVGSTHVNQ',
};

function googleClientIds() {
  return [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    ...(process.env.GOOGLE_CLIENT_IDS || '').split(','),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function publicGoogleConfig() {
  return {
    webClientId: process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
    firebase: {
      apiKey: process.env.FIREBASE_WEB_API_KEY || defaultFirebaseWebConfig.apiKey,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || defaultFirebaseWebConfig.authDomain,
      projectId: process.env.FIREBASE_PROJECT_ID || defaultFirebaseWebConfig.projectId,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || defaultFirebaseWebConfig.storageBucket,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || defaultFirebaseWebConfig.messagingSenderId,
      appId: process.env.FIREBASE_WEB_APP_ID || defaultFirebaseWebConfig.appId,
      measurementId: process.env.FIREBASE_MEASUREMENT_ID || defaultFirebaseWebConfig.measurementId,
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
    name: String(payload.name || payload.email.split('@')[0] || 'Client User').trim(),
    subject: String(payload.sub || ''),
  };
}

function normalizeGoogleRole(role) {
  const value = String(role || 'Client').trim().toLowerCase();
  return value === 'vendor' ? 'Vendor' : 'Client';
}

async function findOrCreateGoogleUser(idToken, role = 'Client') {
  const requestedRole = normalizeGoogleRole(role);
  const googleUser = await verifyGoogleIdToken(idToken);
  const existingUser = await User.findByEmail(googleUser.email);

  if (existingUser) {
    if (existingUser.role !== requestedRole) {
      const error = new Error('This Google account is already registered for another portal.');
      error.status = 409;
      throw error;
    }
    if (existingUser.status !== 'active') {
      const error = new Error('Your account is inactive.');
      error.status = 403;
      throw error;
    }

    await Profile.createEmptyForRole(existingUser.id, requestedRole);
    await Wallet.ensureForUser(existingUser.id);
    if (requestedRole === 'Vendor') {
      await VendorProduct.ensureVendorHasAllProducts(existingUser.id);
    }
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
    }, connection);
    await Profile.createEmptyForRole(userId, requestedRole, connection);
    await Wallet.ensureForUser(userId, connection);
    if (requestedRole === 'Vendor') {
      await VendorProduct.ensureVendorHasAllProducts(userId, connection);
    }
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
};
