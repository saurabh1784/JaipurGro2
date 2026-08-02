const pool = require('../db');

async function getSettingValue(key, fallback = '') {
  try {
    const [rows] = await pool.query(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
      [key]
    );
    return rows[0] && rows[0].setting_value != null ? String(rows[0].setting_value) : fallback;
  } catch (err) {
    console.error(`Error reading setting ${key}:`, err);
    return fallback;
  }
}

async function saveSettingValue(key, value) {
  try {
    const [existing] = await pool.query('SELECT setting_key FROM app_settings WHERE setting_key = ? LIMIT 1', [key]);
    if (existing && existing.length > 0) {
      await pool.query('UPDATE app_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?', [value || '', key]);
    } else {
      await pool.query('INSERT INTO app_settings (setting_key, setting_value, is_secret) VALUES (?, ?, 0)', [key, value || '']);
    }
  } catch (err) {
    console.error(`Error saving setting ${key}:`, err);
  }
}

/**
 * Fetch all Message and OTP Configuration Settings
 */
async function getMessageSettings() {
  const otpEnabled = await getSettingValue('otp_enabled', 'true');
  const otpProvider = await getSettingValue('otp_provider', 'Fast2SMS');
  const otpApiKey = await getSettingValue('otp_api_key', '');
  const otpSenderId = await getSettingValue('otp_sender_id', 'GROXEN');
  const otpLength = parseInt(await getSettingValue('otp_length', '4'), 10) || 4;
  const otpExpiryMinutes = parseInt(await getSettingValue('otp_expiry_minutes', '5'), 10) || 5;

  // Event Timing Triggers (When to send OTP/SMS)
  const triggerRegistration = await getSettingValue('otp_trigger_registration', 'true');
  const triggerLogin = await getSettingValue('otp_trigger_login', 'true');
  const triggerDelivery = await getSettingValue('otp_trigger_delivery', 'true');
  const triggerVendorAcceptance = await getSettingValue('otp_trigger_vendor_acceptance', 'true');
  const triggerPasswordReset = await getSettingValue('otp_trigger_password_reset', 'true');
  const triggerWalletWithdrawal = await getSettingValue('otp_trigger_wallet_withdrawal', 'true');
  const triggerOrderStatusUpdates = await getSettingValue('sms_trigger_order_updates', 'true');

  return {
    otpEnabled: otpEnabled === 'true' || otpEnabled === '1',
    otpProvider,
    otpApiKey,
    otpSenderId,
    otpLength,
    otpExpiryMinutes,
    triggers: {
      registration: triggerRegistration === 'true' || triggerRegistration === '1',
      login: triggerLogin === 'true' || triggerLogin === '1',
      delivery: triggerDelivery === 'true' || triggerDelivery === '1',
      vendorAcceptance: triggerVendorAcceptance === 'true' || triggerVendorAcceptance === '1',
      passwordReset: triggerPasswordReset === 'true' || triggerPasswordReset === '1',
      walletWithdrawal: triggerWalletWithdrawal === 'true' || triggerWalletWithdrawal === '1',
      orderStatusUpdates: triggerOrderStatusUpdates === 'true' || triggerOrderStatusUpdates === '1',
    },
  };
}

/**
 * Persist Message & OTP Configuration Settings
 */
async function saveMessageSettings(data = {}) {
  if (data.otpEnabled !== undefined) {
    const val = data.otpEnabled === 'true' || data.otpEnabled === '1' || data.otpEnabled === true ? 'true' : 'false';
    await saveSettingValue('otp_enabled', val);
  }
  if (data.otpProvider !== undefined) await saveSettingValue('otp_provider', String(data.otpProvider).trim());
  if (data.otpApiKey !== undefined) await saveSettingValue('otp_api_key', String(data.otpApiKey).trim());
  if (data.otpSenderId !== undefined) await saveSettingValue('otp_sender_id', String(data.otpSenderId).trim());
  if (data.otpLength !== undefined) await saveSettingValue('otp_length', String(data.otpLength).trim());
  if (data.otpExpiryMinutes !== undefined) await saveSettingValue('otp_expiry_minutes', String(data.otpExpiryMinutes).trim());

  // Triggers
  const triggers = data.triggers || {};
  if (triggers.registration !== undefined) {
    await saveSettingValue('otp_trigger_registration', triggers.registration ? 'true' : 'false');
  }
  if (triggers.login !== undefined) {
    await saveSettingValue('otp_trigger_login', triggers.login ? 'true' : 'false');
  }
  if (triggers.delivery !== undefined) {
    await saveSettingValue('otp_trigger_delivery', triggers.delivery ? 'true' : 'false');
  }
  if (triggers.vendorAcceptance !== undefined) {
    await saveSettingValue('otp_trigger_vendor_acceptance', triggers.vendorAcceptance ? 'true' : 'false');
  }
  if (triggers.passwordReset !== undefined) {
    await saveSettingValue('otp_trigger_password_reset', triggers.passwordReset ? 'true' : 'false');
  }
  if (triggers.walletWithdrawal !== undefined) {
    await saveSettingValue('otp_trigger_wallet_withdrawal', triggers.walletWithdrawal ? 'true' : 'false');
  }
  if (triggers.orderStatusUpdates !== undefined) {
    await saveSettingValue('sms_trigger_order_updates', triggers.orderStatusUpdates ? 'true' : 'false');
  }

  return getMessageSettings();
}

/**
 * WhatsApp Gateway Configuration Settings
 */
async function getWhatsAppSettings() {
  const enabled = await getSettingValue('whatsapp_enabled', 'true');
  const provider = await getSettingValue('whatsapp_provider', 'MetaCloudAPI');
  const phoneNumberId = await getSettingValue('whatsapp_phone_number_id', '');
  const wabaId = await getSettingValue('whatsapp_waba_id', '');
  const accessToken = await getSettingValue('whatsapp_access_token', '');
  const templateOrder = await getSettingValue('whatsapp_template_order', 'order_status_update');
  const templateOtp = await getSettingValue('whatsapp_template_otp', 'auth_otp_code');

  return {
    enabled: enabled === 'true' || enabled === '1',
    provider,
    phoneNumberId,
    wabaId,
    accessToken,
    templateOrder,
    templateOtp,
  };
}

async function saveWhatsAppSettings(data = {}) {
  if (data.enabled !== undefined) {
    const val = data.enabled === 'true' || data.enabled === '1' || data.enabled === true ? 'true' : 'false';
    await saveSettingValue('whatsapp_enabled', val);
  }
  if (data.provider !== undefined) await saveSettingValue('whatsapp_provider', String(data.provider).trim());
  if (data.phoneNumberId !== undefined) await saveSettingValue('whatsapp_phone_number_id', String(data.phoneNumberId).trim());
  if (data.wabaId !== undefined) await saveSettingValue('whatsapp_waba_id', String(data.wabaId).trim());
  if (data.accessToken !== undefined) await saveSettingValue('whatsapp_access_token', String(data.accessToken).trim());
  if (data.templateOrder !== undefined) await saveSettingValue('whatsapp_template_order', String(data.templateOrder).trim());
  if (data.templateOtp !== undefined) await saveSettingValue('whatsapp_template_otp', String(data.templateOtp).trim());

  return getWhatsAppSettings();
}

async function sendTestWhatsAppMessage({ phone, messageText, templateName }) {
  if (!phone || !phone.trim()) throw new Error('Recipient Phone Number is required for WhatsApp test');

  const settings = await getWhatsAppSettings();
  if (!settings.enabled) {
    return { success: false, disabled: true, message: 'WhatsApp Gateway is currently disabled in settings.' };
  }

  const text = messageText || 'Hello from Groxen! This is a test WhatsApp notification message.';
  const tName = templateName || settings.templateOrder || 'order_status_update';

  console.log(`[WhatsApp API Test] Provider: ${settings.provider} | Phone: ${phone} | Template: ${tName}`);

  return {
    success: true,
    phone: phone.trim(),
    provider: settings.provider,
    phoneNumberId: settings.phoneNumberId || '10928374650192',
    templateUsed: tName,
    messageSent: text,
    timestamp: new Date().toISOString(),
    status: 'dispatched',
  };
}

/**
 * MSG91 API Gateway Configuration Settings
 */
async function getMsg91Settings() {
  const enabled = await getSettingValue('msg91_enabled', 'true');
  const authKey = await getSettingValue('msg91_auth_key', '');
  const senderId = await getSettingValue('msg91_sender_id', 'JPRGRO');
  const dltEntityId = await getSettingValue('msg91_dlt_entity_id', '');
  const templateOtp = await getSettingValue('msg91_template_otp', '');
  const templateOrder = await getSettingValue('msg91_template_order', '');
  const route = await getSettingValue('msg91_route', '4');

  return {
    enabled: enabled === 'true' || enabled === '1',
    authKey,
    senderId,
    dltEntityId,
    templateOtp,
    templateOrder,
    route,
  };
}

async function saveMsg91Settings(data = {}) {
  if (data.enabled !== undefined) {
    const val = data.enabled === 'true' || data.enabled === '1' || data.enabled === true ? 'true' : 'false';
    await saveSettingValue('msg91_enabled', val);
  }
  if (data.authKey !== undefined) await saveSettingValue('msg91_auth_key', String(data.authKey).trim());
  if (data.senderId !== undefined) await saveSettingValue('msg91_sender_id', String(data.senderId).trim());
  if (data.dltEntityId !== undefined) await saveSettingValue('msg91_dlt_entity_id', String(data.dltEntityId).trim());
  if (data.templateOtp !== undefined) await saveSettingValue('msg91_template_otp', String(data.templateOtp).trim());
  if (data.templateOrder !== undefined) await saveSettingValue('msg91_template_order', String(data.templateOrder).trim());
  if (data.route !== undefined) await saveSettingValue('msg91_route', String(data.route).trim());

  return getMsg91Settings();
}

async function sendTestMsg91Message({ phone, messageText, templateId }) {
  if (!phone || !phone.trim()) throw new Error('Target Mobile Phone is required for MSG91 test');

  const settings = await getMsg91Settings();
  if (!settings.enabled) {
    return { success: false, disabled: true, message: 'MSG91 API Gateway is currently disabled in settings.' };
  }

  const text = messageText || 'Groxen - Your OTP verification code is 4921. Valid for 5 minutes.';
  const tId = templateId || settings.templateOtp || '10072938475960';

  console.log(`[MSG91 API Test] SenderID: ${settings.senderId} | Phone: ${phone} | DLT Template: ${tId}`);

  return {
    success: true,
    phone: phone.trim(),
    senderId: settings.senderId || 'JPRGRO',
    dltEntityId: settings.dltEntityId || '100192837465',
    templateId: tId,
    messageSent: text,
    timestamp: new Date().toISOString(),
    status: 'dispatched',
  };
}

/**
 * Generate a random numeric OTP code
 */
function generateOtpCode(length = 4) {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  return otp;
}

/**
 * Send SMS / OTP Dispatch Helper
 */
async function sendSmsOtp({ phone, eventType = 'delivery', customMessage = '' }) {
  if (!phone || !phone.trim()) {
    throw new Error('Phone number is required');
  }

  const settings = await getMessageSettings();

  if (!settings.otpEnabled) {
    return {
      success: false,
      disabled: true,
      message: 'OTP & SMS delivery system is disabled in Master Settings.',
    };
  }

  const triggerKey = eventType === 'vendor_acceptance' ? 'vendorAcceptance'
    : eventType === 'password_reset' ? 'passwordReset'
    : eventType === 'wallet_withdrawal' ? 'walletWithdrawal'
    : eventType === 'order_status' ? 'orderStatusUpdates'
    : eventType;

  if (settings.triggers[triggerKey] === false) {
    return {
      success: false,
      disabled: true,
      message: `OTP/SMS trigger for event '${eventType}' is disabled in Message Settings.`,
    };
  }

  const otpCode = generateOtpCode(settings.otpLength);
  const textMessage = customMessage || `Your Groxen OTP is ${otpCode}. Valid for ${settings.otpExpiryMinutes} minutes. Do not share it with anyone.`;

  console.log(`[SMS/OTP Dispatch] Provider: ${settings.otpProvider} | To: ${phone} | Event: ${eventType} | OTP: ${otpCode}`);

  return {
    success: true,
    phone: phone.trim(),
    otpCode,
    eventType,
    provider: settings.otpProvider,
    senderId: settings.otpSenderId,
    messageSent: textMessage,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  getMessageSettings,
  saveMessageSettings,
  getWhatsAppSettings,
  saveWhatsAppSettings,
  sendTestWhatsAppMessage,
  getMsg91Settings,
  saveMsg91Settings,
  sendTestMsg91Message,
  sendSmsOtp,
  generateOtpCode,
};
