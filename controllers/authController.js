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

async function buildPublicUserWithStatus(user) {
  const publicData = User.publicUser(user);
  try {
    const { getProfileCompletionStatus } = require('../services/profileCompletionService');
    const statusInfo = await getProfileCompletionStatus(user.id);
    return {
      ...publicData,
      is_profile_complete: statusInfo.isComplete,
      is_approved: statusInfo.isApproved,
      approval_status: statusInfo.approvalStatus,
      status_message: statusInfo.statusMessage,
      banner_message: statusInfo.bannerMessage,
      missing_fields: statusInfo.missingFields,
    };
  } catch (_) {
    return publicData;
  }
}

async function signup(req, res) {
  const errors = validateSignup(req.body);
  if (errors.length > 0) {
    return res.status(422).json({ success: false, message: errors.join(', '), errors });
  }

  const name = String(req.body.name).trim();
  const email = String(req.body.email).trim().toLowerCase();
  const phone = String(req.body.phone).trim();
  const password = String(req.body.password);
  
  let role = req.body.role;
  const roleLower = String(role || '').trim().toLowerCase();
  if (['deliveryperson', 'delivery_partner', 'delivery'].includes(roleLower)) {
    role = 'deliveryPerson';
  } else if (roleLower === 'vendor') {
    role = 'Vendor';
  } else if (roleLower === 'client') {
    role = 'Client';
  }

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
    const isVendorOrDelivery = role === 'Vendor' || ['staff', 'deliveryperson', 'delivery_partner'].includes(String(role).toLowerCase());
    const initialStatus = isVendorOrDelivery ? 'pending' : 'active';
    const userId = await User.create({
      name,
      email,
      phone,
      password: hashedPassword,
      role,
      status: initialStatus,
      city: city || null,
      area: area || null,
    }, connection);

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
    if (['staff', 'deliveryperson', 'delivery_partner'].includes(String(role).toLowerCase())) {
      await DeliveryPerson.upsertProfile(userId, { city: city || '', area: area || '*', status: 'pending', is_available: false }, connection);
    }
    await Wallet.ensureForUser(userId, connection);
    await connection.commit();

    try {
      const adminNotificationService = require('../services/adminNotificationService');
      const roleStr = String(role).toLowerCase();
      if (roleStr === 'vendor') {
        adminNotificationService.notifyAdmin({
          type: 'new_vendor_register',
          title: 'New Vendor Registered',
          message: `${name} registered as Vendor Partner (${city || 'Jaipur'}).`,
          link: '/vendors',
        });
      } else if (roleStr === 'deliveryperson' || roleStr === 'delivery_partner' || roleStr === 'staff') {
        adminNotificationService.notifyAdmin({
          type: 'new_delivery_partner_register',
          title: 'New Delivery Partner Registered',
          message: `${name} registered as Delivery Partner.`,
          link: '/delivery-dashboard',
        });
      } else {
        adminNotificationService.notifyAdmin({
          type: 'new_client_register',
          title: 'New Client Registered',
          message: `${name} (${phone || email}) registered as Client.`,
          link: '/clients',
        });
      }
    } catch (notifErr) {
      console.error('Error broadcasting admin registration notification:', notifErr);
    }

    try {
      const { notifyUserEvent } = require('../services/notificationDispatcher');
      notifyUserEvent({
        phone: phone || '',
        email: email || '',
        name: name || 'User',
        eventType: 'welcome',
        data: {
          storeName: 'Groxen',
          otpCode: 'VERIFIED',
        },
      }).catch((err) => console.error('[Auth Controller] Error dispatching Welcome notification:', err));
    } catch (notifErr) {
      console.error('[Auth Controller] Error triggering Welcome notification:', notifErr);
    }

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
    return res.status(500).json({ success: false, message: error.message || 'Unable to create user' });
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

  const appType = req.body.appType || req.body.app_type || req.body.login_portal || req.headers['x-app-type'] || 'customer';
  const { validateAppRoleAccess } = require('../utils/roleAccessValidator');
  const accessCheck = validateAppRoleAccess(user.role, appType);
  if (!accessCheck.allowed) {
    return res.status(403).json({ success: false, message: accessCheck.message });
  }

  const isSuperadminUser = String(user.role || '').toLowerCase() === 'superadmin';
  const isSuperadminRoute = req.headers['x-login-portal'] === 'superadmin' || req.body.login_portal === 'superadmin' || req.originalUrl === '/superadmin' || req.path === '/superadmin';
  if (isSuperadminUser && !isSuperadminRoute) {
    return res.status(403).json({ success: false, message: 'Superadmin accounts must log in exclusively via the /superadmin portal.' });
  }

  const passwordMatches = await bcrypt.compare(String(req.body.password), user.password);
  if (!passwordMatches) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  if (user.status === 'inactive' || user.status === 'suspended' || user.status === 'blocked' || user.status === 'deleted' || user.is_deleted === 1) {
    return res.status(403).json({ success: false, message: `Your account status is ${user.status || 'inactive'}. Please contact your administrator.` });
  }

  const token = sign(tokenPayload(user));
  const publicUserData = await buildPublicUserWithStatus(user);

  if (req.session) {
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

  return res.json({
    success: true,
    message: 'Login successful',
    token,
    user: publicUserData,
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
  const roleInput = String(req.body.role || 'Client').trim().toLowerCase();
  const appType = req.body.appType || req.body.app_type || req.headers['x-app-type'] || (roleInput === 'vendor' ? 'vendor' : (['deliveryperson', 'delivery_partner', 'delivery'].includes(roleInput) ? 'delivery' : 'customer'));

  try {
    const socialAuthService = require('../services/socialAuthService');
    const googleUser = await socialAuthService.verifyGoogleIdToken(idToken);
    const user = await socialAuthService.handleSocialAuth({
      provider: 'google',
      providerUserId: googleUser.providerUserId,
      email: googleUser.email,
      name: googleUser.name,
      picture: googleUser.picture,
      role: roleInput,
      appType,
    });
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
      user: await buildPublicUserWithStatus(user),
    });
  } catch (error) {
    console.error('Google client login error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Unable to process Google login',
      code: error.code,
    });
  }
}

async function facebookClientLogin(req, res) {
  const accessToken = String(req.body.accessToken || req.body.token || '').trim();
  if (!accessToken) {
    return res.status(422).json({ success: false, message: 'Facebook access token is required' });
  }
  const roleInput = String(req.body.role || 'Client').trim().toLowerCase();
  const providedEmail = String(req.body.email || '').trim().toLowerCase();
  const appType = req.body.appType || req.body.app_type || req.headers['x-app-type'] || (roleInput === 'vendor' ? 'vendor' : (['deliveryperson', 'delivery_partner', 'delivery'].includes(roleInput) ? 'delivery' : 'customer'));

  try {
    const socialAuthService = require('../services/socialAuthService');
    const fbUser = await socialAuthService.verifyFacebookAccessToken(accessToken);
    const user = await socialAuthService.handleSocialAuth({
      provider: 'facebook',
      providerUserId: fbUser.providerUserId,
      email: fbUser.email || providedEmail,
      name: fbUser.name,
      picture: fbUser.picture,
      role: roleInput,
      appType,
    });
    const token = sign(tokenPayload(user));

    const referralCode = req.body.referral_code || req.body.referralCode;
    if (referralCode && referralCode.trim()) {
      const referralController = require('./referralController');
      await referralController.processReferralOnSignup(user, referralCode.trim());
    }

    return res.json({
      success: true,
      message: 'Facebook login successful',
      token,
      user: User.publicUser(user),
    });
  } catch (error) {
    console.error('Facebook client login error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Unable to process Facebook login',
      code: error.code,
    });
  }
}

async function socialPublicConfig(req, res) {
  try {
    const appType = String(req.query.app || req.query.appType || req.query.role || 'client').trim();
    const socialAuthService = require('../services/socialAuthService');
    const socialConfig = await socialAuthService.getPublicSocialConfig(appType);
    return res.json({
      success: true,
      social: socialConfig,
      google: socialConfig.google,
      facebook: socialConfig.facebook,
      otp: socialConfig.otp,
      availableLoginMethods: socialConfig.availableLoginMethods,
    });
  } catch (error) {
    console.error('Social public config error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load social login configuration',
    });
  }
}

async function googlePublicConfig(req, res) {
  return socialPublicConfig(req, res);
}

async function sendOtp(req, res) {
  try {
    const { phone, countryCode, appType } = req.body || {};
    const otpAuthService = require('../services/otpAuthService');
    const result = await otpAuthService.sendOtp({
      phoneInput: phone,
      countryCodeInput: countryCode,
      appType: appType || req.query.app || 'client',
    });
    return res.json(result);
  } catch (error) {
    console.error('Send OTP error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to send OTP',
      resendCooldownSeconds: error.resendCooldownSeconds,
    });
  }
}

async function verifyOtp(req, res) {
  try {
    const { phone, countryCode, otp, appType, referralCode, referral_code } = req.body || {};
    const otpAuthService = require('../services/otpAuthService');
    const user = await otpAuthService.verifyOtp({
      phoneInput: phone,
      countryCodeInput: countryCode,
      otp,
      appType: appType || req.query.app || 'client',
      referralCode: referralCode || referral_code,
    });
    const token = sign(tokenPayload(user));

    return res.json({
      success: true,
      message: 'OTP verification successful',
      token,
      user: await buildPublicUserWithStatus(user),
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'OTP verification failed',
      isNewPending: error.isNewPending,
    });
  }
}

async function forgotPassword(req, res) {
  try {
    const identifier = String(req.body.email || req.body.phone || req.body.identifier || '').trim();
    if (!identifier) {
      return res.status(422).json({ success: false, message: 'Email or phone number is required' });
    }

    const user = await User.findByEmailOrPhoneIdentifier(identifier);
    if (!user) {
      return res.json({ success: true, message: 'If an account exists with this email/phone, a password reset code has been sent.' });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    const pool = require('../db');
    await pool.query(
      'UPDATE users SET reset_token = ?, reset_token_expires_at = ? WHERE id = ?',
      [otpCode, otpExpiry, user.id]
    );

    const { notifyUserEvent } = require('../services/notificationDispatcher');
    notifyUserEvent({
      email: user.email,
      phone: user.phone,
      name: user.name || 'User',
      eventType: 'password_reset',
      data: {
        otpCode,
        resetCode: otpCode,
        resetLink: `https://jaipurgro.com/reset-password?code=${otpCode}`,
        otpExpiry: '10',
      },
    }).catch((err) => console.error('[Auth] Error dispatching password reset notification:', err));

    return res.json({
      success: true,
      message: 'Password reset verification code dispatched successfully via Email / SMS / WhatsApp.',
      otpCodeSent: true,
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ success: false, message: 'Unable to process password reset request' });
  }
}

async function resetPasswordWithOtp(req, res) {
  try {
    const identifier = String(req.body.email || req.body.phone || req.body.identifier || '').trim();
    const otpCode = String(req.body.otpCode || req.body.otp || req.body.code || '').trim();
    const newPassword = String(req.body.newPassword || req.body.password || '').trim();

    if (!identifier || !otpCode || !newPassword) {
      return res.status(422).json({ success: false, message: 'Identifier, OTP code, and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(422).json({ success: false, message: 'Password must be at least 6 characters long' });
    }

    const user = await User.findByEmailOrPhoneIdentifier(identifier);
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid request or user not found' });
    }

    const pool = require('../db');
    const [rows] = await pool.query(
      'SELECT reset_token, reset_token_expires_at FROM users WHERE id = ? LIMIT 1',
      [user.id]
    );

    if (!rows.length || !rows[0].reset_token || rows[0].reset_token !== otpCode) {
      return res.status(400).json({ success: false, message: 'Invalid or incorrect OTP code' });
    }

    if (new Date(rows[0].reset_token_expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP code has expired. Please request a new code.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password = ?, reset_token = NULL, reset_token_expires_at = NULL WHERE id = ?',
      [hashedPassword, user.id]
    );

    return res.json({
      success: true,
      message: 'Password reset successful! You can now log in with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ success: false, message: 'Unable to reset password' });
  }
}

module.exports = {
  signup,
  login,
  logout,
  googleClientLogin,
  facebookClientLogin,
  googlePublicConfig,
  socialPublicConfig,
  sendOtp,
  verifyOtp,
  forgotPassword,
  resetPasswordWithOtp,
};
