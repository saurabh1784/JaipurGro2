const pool = require('../db');
const https = require('https');

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
  const otpSenderId = await getSettingValue('otp_sender_id', 'STYLECAB');
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

async function postMsg91Widget(endpoint, payload, stepName) {
  let response;
  try {
    response = await fetch(`https://control.msg91.com/api/v5/widget/${endpoint}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'STYLECAB-Backend/1.0',
      },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
  } catch (cause) {
    throw new Error(`${stepName}: unable to connect to MSG91 (${cause.message}).`);
  }

  const responseBody = await response.text();
  let data;
  try {
    data = JSON.parse(responseBody);
  } catch (_) {
    throw new Error(`${stepName}: MSG91 returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok || data.type !== 'success') {
    const providerMessage = data.message || data.error || `HTTP ${response.status}`;
    const error = new Error(`${stepName}: ${providerMessage}`);
    error.providerResponse = data;
    throw error;
  }
  return data;
}

async function sendTestWhatsAppMessage({ phone }) {
  if (!phone || !phone.trim()) throw new Error('Recipient Phone Number is required for WhatsApp test');

  const settings = await getWhatsAppSettings();
  if (!settings.enabled) {
    return { success: false, disabled: true, message: 'WhatsApp Gateway is currently disabled in settings.' };
  }

  const widgetId = String(process.env.MSG91_WIDGET_ID || '').trim();
  const tokenAuth = String(process.env.MSG91_WIDGET_TOKEN || '').trim();
  if (!widgetId || !tokenAuth) {
    throw new Error('MSG91 WhatsApp OTP is not configured. Set MSG91_WIDGET_ID and MSG91_WIDGET_TOKEN on the backend.');
  }

  const mobile = normalizeMsg91Mobile(phone);
  const sendResponse = await postMsg91Widget('sendOtpMobile', {
    widgetId,
    tokenAuth,
    identifier: mobile,
  }, 'OTP request failed');
  const reqId = String(sendResponse.message || sendResponse.reqId || '').trim();
  if (!reqId) throw new Error('OTP request failed: MSG91 did not return a request ID.');

  const retryResponse = await postMsg91Widget('retryOtp', {
    widgetId,
    tokenAuth,
    reqId,
    retryChannel: 12,
  }, 'WhatsApp delivery request failed');

  console.log(`[MSG91 WhatsApp OTP Test] Phone: ${mobile} | Request ID: ${reqId}`);

  return {
    success: true,
    phone: mobile,
    provider: 'MSG91 OTP Widget',
    channel: 'WhatsApp',
    reqId,
    templateUsed: 'MSG91 Widget WhatsApp OTP',
    phoneNumberId: 'Managed by MSG91',
    messageSent: 'OTP content is managed by the approved MSG91 WhatsApp template.',
    message: 'WhatsApp OTP request accepted by MSG91.',
    timestamp: new Date().toISOString(),
    status: 'accepted',
    providerResponse: retryResponse,
  };
}

/**
 * MSG91 API Gateway Configuration Settings
 */
async function getMsg91Settings() {
  const enabled = await getSettingValue('msg91_enabled', 'true');
  const authKey = process.env.MSG91_AUTH_KEY || await getSettingValue('msg91_auth_key', '');
  const senderId = process.env.MSG91_SENDER_ID || await getSettingValue('msg91_sender_id', 'STYLECAB');
  const dltEntityId = await getSettingValue('msg91_dlt_entity_id', '');
  const templateOtp = process.env.MSG91_TEMPLATE_ID || await getSettingValue('msg91_template_otp', '');
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

function normalizeMsg91Mobile(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 11 || digits.length > 15) {
    throw new Error('Enter a valid mobile number with country code.');
  }
  return digits;
}

async function dispatchMsg91Otp({ phone, otp, authKey, templateId, expiryMinutes = 5 }) {
  if (!authKey) throw new Error('MSG91 Authkey is not configured on the server.');
  if (!templateId) throw new Error('MSG91 OTP Template ID is not configured.');

  const mobile = normalizeMsg91Mobile(phone);
  const query = new URLSearchParams({
    template_id: templateId,
    mobile: `+${mobile}`,
    authkey: authKey,
  });
  const payload = JSON.stringify({
    Param1: String(otp),
    Param2: String(expiryMinutes),
    Param3: 'STYLECAB',
  });

  return new Promise((resolve, reject) => {
    const request = https.request({
      method: 'POST',
      hostname: 'control.msg91.com',
      path: `/api/v5/otp?${query.toString()}`,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        let data;
        try {
          data = JSON.parse(body);
        } catch (_) {
          const error = new Error(`MSG91 returned an invalid response (HTTP ${response.statusCode}).`);
          error.providerResponse = body;
          reject(error);
          return;
        }

        if (response.statusCode < 200 || response.statusCode >= 300 || data.type !== 'success') {
          const error = new Error(data.message || `MSG91 rejected the OTP request (HTTP ${response.statusCode}).`);
          error.providerResponse = data;
          reject(error);
          return;
        }
        resolve({ data, mobile });
      });
    });
    request.on('error', (cause) => {
      reject(new Error(`Unable to connect to MSG91: ${cause.message}`));
    });
    request.write(payload);
    request.end();
  });
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

  const otpCode = generateOtpCode(4);
  const text = messageText || `Your STYLECAB OTP is ${otpCode}. Valid for 5 minutes.`;
  const tId = templateId || settings.templateOtp;

  console.log(`[MSG91 API Test] SenderID: ${settings.senderId} | Phone: ${phone} | DLT Template: ${tId}`);

  const provider = await dispatchMsg91Otp({
    phone,
    otp: otpCode,
    authKey: settings.authKey,
    templateId: tId,
  });

  return {
    success: true,
    phone: provider.mobile,
    otpCode,
    senderId: settings.senderId,
    dltEntityId: settings.dltEntityId,
    templateId: tId,
    messageSent: text,
    timestamp: new Date().toISOString(),
    status: 'dispatched',
    providerResponse: provider.data,
    requestId: provider.data.message || '',
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
  const textMessage = customMessage || `Your STYLECAB OTP is ${otpCode}. Valid for ${settings.otpExpiryMinutes} minutes. Do not share it with anyone.`;

  console.log(`[SMS/OTP Dispatch] Provider: ${settings.otpProvider} | To: ${phone} | Event: ${eventType} | OTP: ${otpCode}`);

  if (String(settings.otpProvider).toUpperCase() !== 'MSG91') {
    throw new Error(`SMS provider '${settings.otpProvider}' is not implemented. Select MSG91 in Message Settings.`);
  }
  const msg91Settings = await getMsg91Settings();
  if (!msg91Settings.enabled) {
    return { success: false, disabled: true, message: 'MSG91 API Gateway is disabled in settings.' };
  }
  const provider = await dispatchMsg91Otp({
    phone,
    otp: otpCode,
    authKey: msg91Settings.authKey,
    templateId: msg91Settings.templateOtp,
    expiryMinutes: settings.otpExpiryMinutes,
  });

  return {
    success: true,
    phone: provider.mobile,
    otpCode,
    eventType,
    provider: settings.otpProvider,
    senderId: msg91Settings.senderId || settings.otpSenderId,
    messageSent: textMessage,
    timestamp: new Date().toISOString(),
    providerResponse: provider.data,
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
