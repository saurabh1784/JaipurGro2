const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const https = require('https');
const pool = require('../db');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Wallet = require('../models/Wallet');
const DeliveryPerson = require('../models/DeliveryPerson');

async function getSettingValue(key, defaultValue = '') {
  try {
    const [rows] = await pool.query(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
      [key]
    );
    if (rows && rows.length > 0 && rows[0].setting_value !== null && rows[0].setting_value !== undefined) {
      return String(rows[0].setting_value);
    }
  } catch (_) {}
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

async function getOtpSettings() {
  const clientEnabled = await getSettingValue('otp_client_app_enabled', 'true');
  const vendorEnabled = await getSettingValue('otp_vendor_app_enabled', 'false');
  const deliveryEnabled = await getSettingValue('otp_delivery_app_enabled', 'true');

  const length = parseInt(await getSettingValue('otp_length', '6'), 10) || 6;
  const expiryMinutes = parseInt(await getSettingValue('otp_expiry_minutes', '5'), 10) || 5;
  const resendCooldown = parseInt(await getSettingValue('otp_resend_cooldown_seconds', '60'), 10) || 60;
  const maxAttempts = parseInt(await getSettingValue('otp_max_verification_attempts', '5'), 10) || 5;
  const maxRequestsPerHour = parseInt(await getSettingValue('otp_max_requests_per_hour', '5'), 10) || 5;
  const blockDurationMinutes = parseInt(await getSettingValue('otp_block_duration_minutes', '30'), 10) || 30;
  const defaultCountryCode = await getSettingValue('otp_default_country_code', '+91');

  const smsProvider = await getSettingValue('otp_sms_provider', 'MSG91');
  const msg91AuthKey = await getSettingValue('otp_msg91_auth_key', '');
  const msg91TemplateId = await getSettingValue('otp_msg91_template_id', '');
  const msg91SenderId = await getSettingValue('otp_msg91_sender_id', 'GROXEN');

  const smsApiUrl = await getSettingValue('otp_sms_api_url', '');
  const smsApiKey = await getSettingValue('otp_sms_api_key', '');
  const smsSenderId = await getSettingValue('otp_sms_sender_id', '');
  const smsTemplate = await getSettingValue('otp_sms_template', 'Your OTP verification code for Groxen is {{otp}}. Valid for {{minutes}} minutes.');
  const testMode = await getSettingValue('otp_test_mode', 'false');

  return {
    clientEnabled: clientEnabled === 'true' || clientEnabled === '1',
    vendorEnabled: vendorEnabled === 'true' || vendorEnabled === '1',
    deliveryEnabled: deliveryEnabled === 'true' || deliveryEnabled === '1',
    length,
    expiryMinutes,
    resendCooldown,
    maxAttempts,
    maxRequestsPerHour,
    blockDurationMinutes,
    defaultCountryCode,
    smsProvider,
    msg91AuthKey,
    msg91TemplateId,
    msg91SenderId,
    smsApiUrl,
    smsApiKey,
    smsSenderId,
    smsTemplate,
    testMode: testMode === 'true' || testMode === '1',
  };
}

async function saveOtpSettings(data = {}) {
  if (data.clientEnabled !== undefined) await saveSettingValue('otp_client_app_enabled', data.clientEnabled ? 'true' : 'false', 0);
  if (data.vendorEnabled !== undefined) await saveSettingValue('otp_vendor_app_enabled', data.vendorEnabled ? 'true' : 'false', 0);
  if (data.deliveryEnabled !== undefined) await saveSettingValue('otp_delivery_app_enabled', data.deliveryEnabled ? 'true' : 'false', 0);

  if (data.length) await saveSettingValue('otp_length', String(data.length), 0);
  if (data.expiryMinutes) await saveSettingValue('otp_expiry_minutes', String(data.expiryMinutes), 0);
  if (data.resendCooldown) await saveSettingValue('otp_resend_cooldown_seconds', String(data.resendCooldown), 0);
  if (data.maxAttempts) await saveSettingValue('otp_max_verification_attempts', String(data.maxAttempts), 0);
  if (data.maxRequestsPerHour) await saveSettingValue('otp_max_requests_per_hour', String(data.maxRequestsPerHour), 0);
  if (data.blockDurationMinutes) await saveSettingValue('otp_block_duration_minutes', String(data.blockDurationMinutes), 0);
  if (data.defaultCountryCode) await saveSettingValue('otp_default_country_code', String(data.defaultCountryCode), 0);

  if (data.smsProvider) await saveSettingValue('otp_sms_provider', String(data.smsProvider), 0);
  if (data.msg91AuthKey !== undefined && data.msg91AuthKey !== '*****') await saveSettingValue('otp_msg91_auth_key', String(data.msg91AuthKey), 1);
  if (data.msg91TemplateId !== undefined) await saveSettingValue('otp_msg91_template_id', String(data.msg91TemplateId), 0);
  if (data.msg91SenderId !== undefined) await saveSettingValue('otp_msg91_sender_id', String(data.msg91SenderId), 0);

  if (data.smsApiUrl !== undefined) await saveSettingValue('otp_sms_api_url', String(data.smsApiUrl), 0);
  if (data.smsApiKey !== undefined && data.smsApiKey !== '*****') await saveSettingValue('otp_sms_api_key', String(data.smsApiKey), 1);
  if (data.smsSenderId !== undefined) await saveSettingValue('otp_sms_sender_id', String(data.smsSenderId), 0);
  if (data.smsTemplate !== undefined) await saveSettingValue('otp_sms_template', String(data.smsTemplate), 0);
  if (data.testMode !== undefined) await saveSettingValue('otp_test_mode', data.testMode ? 'true' : 'false', 0);

  return await getOtpSettings();
}

function cleanPhoneNumber(phoneInput, countryCodeInput = '+91') {
  let raw = String(phoneInput || '').trim();
  let code = String(countryCodeInput || '+91').trim();
  if (!code.startsWith('+')) code = '+' + code;

  // Remove spaces, hyphens, brackets
  raw = raw.replace(/[\s\(\)\-]/g, '');

  if (raw.startsWith('+')) {
    return raw;
  }
  if (raw.startsWith('0')) {
    raw = raw.slice(1);
  }
  return `${code}${raw}`;
}

function normalizeAppRole(appType) {
  const norm = String(appType || 'client').trim().toLowerCase();
  if (norm === 'vendor') return { appType: 'vendor', role: 'Vendor' };
  if (['delivery', 'deliveryperson', 'delivery_partner'].includes(norm)) return { appType: 'delivery', role: 'deliveryPerson' };
  return { appType: 'client', role: 'Client' };
}

async function isPhoneBlocked(phone) {
  const now = new Date();
  const [rows] = await pool.query(
    'SELECT blocked_until, reason FROM auth_otp_blocks WHERE phone = ? AND blocked_until > ? ORDER BY blocked_until DESC LIMIT 1',
    [phone, now]
  );
  if (rows && rows.length > 0) {
    return rows[0];
  }
  return null;
}

async function blockPhone(phone, durationMinutes, reason = 'Too many failed OTP attempts') {
  const blockUntil = new Date(Date.now() + durationMinutes * 60 * 1000);
  await pool.query(
    'INSERT INTO auth_otp_blocks (phone, blocked_until, reason) VALUES (?, ?, ?)',
    [phone, blockUntil, reason]
  );
}

async function sendMsg91Otp({ phone, otp, authKey, templateId, senderId }) {
  // MSG91 expects mobile number without '+' sign e.g. '919876543210'
  const mobile = phone.replace(/^\+/, '');
  const payload = JSON.stringify({
    template_id: templateId || '',
    mobile: mobile,
    otp: otp,
    sender: senderId || 'GROXEN',
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      'https://control.msg91.com/api/v5/otp',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'authkey': authKey || '',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            console.log('[MSG91 OTP API Response]:', data);
            resolve(data);
          } catch (e) {
            resolve({ type: 'error', message: body });
          }
        });
      }
    );

    req.on('error', (err) => {
      console.error('[MSG91 Request Error]:', err.message);
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

async function sendOtp({ phoneInput, countryCodeInput, appType = 'client' }) {
  const settings = await getOtpSettings();
  const { appType: normApp } = normalizeAppRole(appType);

  const isEnabled = normApp === 'vendor' ? settings.vendorEnabled : (normApp === 'delivery' ? settings.deliveryEnabled : settings.clientEnabled);
  if (!isEnabled) {
    const error = new Error(`Mobile OTP Login is disabled for the ${normApp.toUpperCase()} app.`);
    error.status = 403;
    throw error;
  }

  const phone = cleanPhoneNumber(phoneInput, countryCodeInput || settings.defaultCountryCode);
  if (phone.length < 10) {
    const error = new Error('Invalid mobile phone number format.');
    error.status = 422;
    throw error;
  }

  // Check if blocked
  const blockInfo = await isPhoneBlocked(phone);
  if (blockInfo) {
    const error = new Error(`This mobile number is temporarily blocked. ${blockInfo.reason || ''}. Please try again later.`);
    error.status = 429;
    throw error;
  }

  // Check hourly request limit using explicit Date object for DB compatibility
  const oneHourAgo = new Date(Date.now() - 3600000);
  const [hourlyRows] = await pool.query(
    'SELECT COUNT(*) AS req_count FROM auth_otps WHERE phone = ? AND created_at > ?',
    [phone, oneHourAgo]
  );
  const reqCount = parseInt(hourlyRows[0]?.req_count || '0', 10);
  if (reqCount >= settings.maxRequestsPerHour) {
    await blockPhone(phone, settings.blockDurationMinutes, 'Exceeded maximum OTP requests per hour');
    const error = new Error('Too many OTP requests from this number. Please wait 30 minutes before trying again.');
    error.status = 429;
    throw error;
  }

  // Check resend cooldown
  const [recentRows] = await pool.query(
    'SELECT created_at FROM auth_otps WHERE phone = ? ORDER BY created_at DESC LIMIT 1',
    [phone]
  );
  if (recentRows && recentRows.length > 0) {
    const lastCreated = new Date(recentRows[0].created_at).getTime();
    const elapsedSeconds = Math.floor((Date.now() - lastCreated) / 1000);
    if (elapsedSeconds < settings.resendCooldown) {
      const waitTime = settings.resendCooldown - elapsedSeconds;
      const error = new Error(`Please wait ${waitTime} seconds before requesting a new OTP.`);
      error.status = 429;
      error.resendCooldownSeconds = waitTime;
      throw error;
    }
  }

  // Generate numeric OTP
  let otp = '';
  for (let i = 0; i < settings.length; i++) {
    otp += Math.floor(Math.random() * 10).toString();
  }

  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + settings.expiryMinutes * 60 * 1000);

  // Invalidate previous OTPs for this phone
  await pool.query(
    'UPDATE auth_otps SET is_verified = 2 WHERE phone = ? AND is_verified = 0',
    [phone]
  );

  // Insert new OTP record
  await pool.query(
    'INSERT INTO auth_otps (phone, otp_hash, app_type, max_attempts, expires_at) VALUES (?, ?, ?, ?, ?)',
    [phone, otpHash, normApp, settings.maxAttempts, expiresAt]
  );

  // Dispatch SMS via MSG91 or log in test mode
  if (settings.testMode) {
    console.log(`[TEST MODE OTP] Mobile: ${phone} | OTP Code: ${otp} | App: ${normApp}`);
  } else if (settings.smsProvider === 'MSG91') {
    try {
      await sendMsg91Otp({
        phone,
        otp,
        authKey: settings.msg91AuthKey,
        templateId: settings.msg91TemplateId,
        senderId: settings.msg91SenderId,
      });
    } catch (smsErr) {
      console.error('[MSG91 Dispatch Failure]:', smsErr.message);
    }
  } else {
    try {
      const { notifyUserEvent } = require('./notificationDispatcher');
      notifyUserEvent({
        phone,
        name: 'User',
        eventType: 'otp_verification',
        data: {
          otpCode: otp,
          otpExpiry: String(settings.expiryMinutes),
        },
      }).catch((err) => console.error('[OTP Dispatch Error]:', err.message));
    } catch (smsErr) {
      console.error('[SMS Dispatch Failure]:', smsErr.message);
    }
  }

  return {
    success: true,
    message: 'OTP sent successfully to your mobile number.',
    phone,
    resendCooldownSeconds: settings.resendCooldown,
    expiryMinutes: settings.expiryMinutes,
  };
}

async function verifyOtp({ phoneInput, countryCodeInput, otp, appType = 'client', referralCode }) {
  const settings = await getOtpSettings();
  const { appType: normApp, role: targetRole } = normalizeAppRole(appType);
  const phone = cleanPhoneNumber(phoneInput, countryCodeInput || settings.defaultCountryCode);
  const otpCode = String(otp || '').trim();

  if (!otpCode) {
    const error = new Error('OTP code is required.');
    error.status = 422;
    throw error;
  }

  // Check if blocked
  const blockInfo = await isPhoneBlocked(phone);
  if (blockInfo) {
    const error = new Error(`Mobile number is blocked. Please try again later.`);
    error.status = 429;
    throw error;
  }

  // Query latest unverified, unexpired OTP using JS Date
  const now = new Date();
  const [rows] = await pool.query(
    `SELECT id, otp_hash, attempts, max_attempts, expires_at FROM auth_otps 
     WHERE phone = ? AND is_verified = 0 AND expires_at > ? 
     ORDER BY id DESC LIMIT 1`,
    [phone, now]
  );

  if (!rows || rows.length === 0) {
    const error = new Error('OTP has expired or is invalid. Please request a new OTP.');
    error.status = 400;
    throw error;
  }

  const record = rows[0];
  const currentAttempts = (record.attempts || 0) + 1;

  // Increment attempts counter
  await pool.query('UPDATE auth_otps SET attempts = ? WHERE id = ?', [currentAttempts, record.id]);

  if (currentAttempts > record.max_attempts) {
    await pool.query('UPDATE auth_otps SET is_verified = 2 WHERE id = ?', [record.id]);
    await blockPhone(phone, settings.blockDurationMinutes, 'Exceeded maximum failed OTP attempts');
    const error = new Error('Too many invalid attempts. Your mobile number has been temporarily blocked for security.');
    error.status = 429;
    throw error;
  }

  const matches = await bcrypt.compare(otpCode, record.otp_hash);
  if (!matches) {
    const remaining = Math.max(0, record.max_attempts - currentAttempts);
    const error = new Error(`Invalid OTP code. ${remaining} attempt(s) remaining.`);
    error.status = 400;
    throw error;
  }

  // Mark OTP as verified
  await pool.query('UPDATE auth_otps SET is_verified = 1 WHERE id = ?', [record.id]);

  // Find user by phone number or email
  let existingUser = await User.findByEmailOrPhoneIdentifier(phone);
  if (!existingUser) {
    const rawDigits = phone.replace(/^\+\d{1,3}/, '');
    existingUser = await User.findByEmailOrPhoneIdentifier(rawDigits);
  }

  if (existingUser) {
    const { validateAppRoleAccess } = require('../utils/roleAccessValidator');
    const accessCheck = validateAppRoleAccess(existingUser.role, normApp);
    if (!accessCheck.allowed) {
      const error = new Error(accessCheck.message);
      error.status = 403;
      throw error;
    }

    if (existingUser.status === 'inactive' || existingUser.status === 'suspended' || existingUser.status === 'blocked' || existingUser.status === 'deleted' || existingUser.is_deleted === 1) {
      const error = new Error(`Your account status is ${existingUser.status || 'inactive'}. Please contact your administrator.`);
      error.status = 403;
      throw error;
    }

    // Update phone number on existing user if needed
    if (!existingUser.phone) {
      await pool.query('UPDATE users SET phone = ? WHERE id = ?', [phone, existingUser.id]);
    }

    return await User.findById(existingUser.id);
  }

  // User does not exist -> Create new account
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(`otp:${phone}:${randomPassword}`, 10);
    const isVendorOrDelivery = targetRole === 'Vendor' || targetRole === 'deliveryPerson';
    const initialStatus = isVendorOrDelivery ? 'pending' : 'active';
    const userName = `User ${phone.slice(-4)}`;

    const [res] = await connection.query(
      `INSERT INTO users (name, email, phone, password, role, status)
       VALUES (?, null, ?, ?, ?, ?)`,
      [userName, phone, hashedPassword, targetRole, initialStatus]
    );
    const userId = res.insertId;

    await Profile.createEmptyForRole(userId, targetRole, connection);
    if (targetRole === 'deliveryPerson') {
      await DeliveryPerson.upsertProfile(userId, { city: '', area: '*', status: 'pending', is_available: false }, connection);
    }
    await Wallet.ensureForUser(userId, connection);
    await connection.commit();

    const newUser = await User.findById(userId);

    if (referralCode && referralCode.trim()) {
      const referralController = require('../controllers/referralController');
      await referralController.processReferralOnSignup(newUser, referralCode.trim()).catch(() => {});
    }

    if (newUser.status === 'pending') {
      const error = new Error('Registration submitted successfully. Your account is pending administrator approval.');
      error.status = 403;
      error.isNewPending = true;
      throw error;
    }
    return newUser;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  getOtpSettings,
  saveOtpSettings,
  sendOtp,
  verifyOtp,
  cleanPhoneNumber,
};
