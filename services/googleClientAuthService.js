const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../db');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Wallet = require('../models/Wallet');

const googleClient = new OAuth2Client();

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

async function findOrCreateGoogleClient(idToken) {
  const googleUser = await verifyGoogleIdToken(idToken);
  const existingUser = await User.findByEmail(googleUser.email);

  if (existingUser) {
    if (existingUser.role !== 'Client') {
      const error = new Error('This Google account is already registered for another portal.');
      error.status = 409;
      throw error;
    }
    if (existingUser.status !== 'active') {
      const error = new Error('Your account is inactive.');
      error.status = 403;
      throw error;
    }

    await Profile.createEmptyForRole(existingUser.id, 'Client');
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
      role: 'Client',
    }, connection);
    await Profile.createEmptyForRole(userId, 'Client', connection);
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
  findOrCreateGoogleClient,
  publicGoogleConfig,
};
