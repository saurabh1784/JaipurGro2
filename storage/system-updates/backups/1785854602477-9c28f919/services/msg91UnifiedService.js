const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../db');

const CHANNEL_CODES = { sms: 11, whatsapp: 12 };

function normalizeMobile(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!raw.startsWith('+') || !/^\d{11,15}$/.test(digits)) {
    const error = new Error('This mobile number is not valid. Include the country code.');
    error.code = 'INVALID_MOBILE';
    throw error;
  }
  return digits;
}

function localEnvironmentValue(name) {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find(item => item.startsWith(name + '='));
    return line ? line.slice(name.length + 1).trim() : '';
  } catch (_) { return ''; }
}

function encryptionKeys() {
  const sources = [
    process.env.SETTINGS_ENCRYPTION_KEY,
    localEnvironmentValue('SETTINGS_ENCRYPTION_KEY'),
    process.env.SESSION_SECRET,
    localEnvironmentValue('SESSION_SECRET'),
    'change-me',
  ].filter(Boolean);
  return [...new Set(sources)].map(source => crypto.createHash('sha256').update(String(source)).digest());
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKeys()[0], iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

function decryptSecret(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) return '';
  for (const key of encryptionKeys()) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'base64'));
      decipher.setAuthTag(Buffer.from(parts[1], 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64')), decipher.final()]).toString('utf8');
    } catch (_) { /* Try the legacy key used before the restart-safe key existed. */ }
  }
  return '';
}

async function setting(key, fallback = '') {
  const [rows] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1', [key]);
  return rows[0] && rows[0].setting_value != null ? String(rows[0].setting_value) : fallback;
}

async function saveSetting(key, value) {
  const normalizedValue = String(value == null ? '' : value);
  await pool.query(
    `WITH updated AS (
       UPDATE app_settings
       SET setting_value = ?, updated_at = CURRENT_TIMESTAMP
       WHERE setting_key = ?
       RETURNING id
     )
     INSERT INTO app_settings (setting_key, setting_value)
     SELECT ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM updated)`,
    [normalizedValue, key, key, normalizedValue]
  );
}

async function persistEnvironmentSecret(name, value) {
  const secret = String(value || '').trim();
  if (!secret || /[\r\n]/.test(secret)) throw new Error('Invalid secret value.');
  const envPath = path.join(__dirname, '..', '.env');
  let content = '';
  try { content = await fs.promises.readFile(envPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const line = name + '=' + secret;
  const expression = new RegExp('^' + name + '=.*$', 'm');
  content = expression.test(content) ? content.replace(expression, line) : content.replace(/\s*$/, '') + '\n' + line + '\n';
  const temporaryPath = envPath + '.tmp-' + process.pid;
  await fs.promises.writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
  await fs.promises.rename(temporaryPath, envPath);
  process.env[name] = secret;
}

async function getAuthKey() {
  const envVal = process.env.MSG91_AUTH_KEY || localEnvironmentValue('MSG91_AUTH_KEY');
  if (envVal) return envVal;
  const savedKey = decryptSecret(await setting('msg91_auth_key_encrypted', ''));
  return savedKey || '';
}

async function getWidgetToken() {
  const envVal = process.env.MSG91_WIDGET_TOKEN || localEnvironmentValue('MSG91_WIDGET_TOKEN');
  if (envVal) return envVal;
  const savedToken = decryptSecret(await setting('msg91_widget_token_encrypted', ''));
  return savedToken || '';
}

async function getConfig() {
  const key = await getAuthKey();
  const widgetToken = await getWidgetToken();
  const rawMethod = await setting('msg91_delivery_method', 'whatsapp');
  const deliveryMethod = rawMethod === 'sms' ? 'sms' : 'whatsapp';
  return {
    enabled: (await setting('msg91_enabled', 'true')) !== 'false',
    whatsappEnabled: (await setting('msg91_whatsapp_enabled', 'true')) !== 'false',
    authKey: key,
    authKeyConfigured: Boolean(key),
    authKeyMasked: key, // Full unmasked value from .env
    widgetToken: widgetToken,
    widgetTokenConfigured: Boolean(widgetToken),
    widgetTokenMasked: widgetToken, // Full unmasked value from .env
    widgetId: await setting('msg91_widget_id', '') || process.env.MSG91_WIDGET_ID || localEnvironmentValue('MSG91_WIDGET_ID') || '',
    whatsappTemplateId: await setting('msg91_whatsapp_template_id', ''),
    smsTemplateId: await setting('msg91_sms_template_id', '') || process.env.MSG91_TEMPLATE_ID || localEnvironmentValue('MSG91_TEMPLATE_ID') || '',
    senderId: await setting('msg91_sender_id', '') || process.env.MSG91_SENDER_ID || localEnvironmentValue('MSG91_SENDER_ID') || 'STYLECAB',
    whatsappNumber: await setting('msg91_whatsapp_number', ''),
    otpExpiryMinutes: Number(await setting('msg91_otp_expiry_minutes', '5')),
    otpLength: Number(await setting('msg91_otp_length', '4')),
    resendSeconds: Number(await setting('msg91_resend_seconds', '30')),
    maximumAttempts: Number(await setting('msg91_maximum_attempts', '5')),
    deliveryMethod: deliveryMethod,
    webhookSecretConfigured: Boolean(process.env.MSG91_WEBHOOK_SECRET || localEnvironmentValue('MSG91_WEBHOOK_SECRET')),
  };
}

function validateChannelConfiguration(config, channel) {
  if (!config.enabled) {
    const err = new Error('Master OTP System is disabled in message settings. Enable MSG91 integration to send OTPs.');
    err.status = 400;
    throw err;
  }
  if (!config.authKey) {
    const err = new Error('MSG91 Auth Key is missing or not configured in backend settings.');
    err.status = 400;
    throw err;
  }

  if (channel === 'whatsapp') {
    if (config.whatsappEnabled === false) {
      const err = new Error('Selected OTP channel (WhatsApp OTP) is disabled in settings. Enable WhatsApp Messaging Gateway.');
      err.status = 400;
      throw err;
    }
    if (!config.whatsappNumber) {
      const err = new Error('Selected OTP channel (WhatsApp OTP) is not properly configured: Integrated WhatsApp Number is missing.');
      err.status = 400;
      throw err;
    }
    if (!config.whatsappTemplateId) {
      const err = new Error('Selected OTP channel (WhatsApp OTP) is not properly configured: WhatsApp OTP Template ID is missing.');
      err.status = 400;
      throw err;
    }
  } else if (channel === 'sms') {
    if (!config.senderId) {
      const err = new Error('Selected OTP channel (SMS OTP) is not properly configured: SMS Sender ID / Header is missing.');
      err.status = 400;
      throw err;
    }
    if (!config.smsTemplateId) {
      const err = new Error('Selected OTP channel (SMS OTP) is not properly configured: DLT SMS Template ID is missing.');
      err.status = 400;
      throw err;
    }
  } else {
    const err = new Error('Invalid OTP channel selected.');
    err.status = 400;
    throw err;
  }
}

async function saveConfig(input) {
  const method = String(input.deliveryMethod || '').trim();
  if (!['whatsapp', 'sms'].includes(method)) throw new Error('Select a valid OTP channel: WhatsApp OTP or SMS OTP.');
  const ranges = { otpExpiryMinutes: [1, 30], otpLength: [4, 8], resendSeconds: [15, 600], maximumAttempts: [1, 10] };
  for (const [field, range] of Object.entries(ranges)) {
    const value = Number(input[field]);
    if (!Number.isInteger(value) || value < range[0] || value > range[1]) throw new Error('Invalid value for ' + field + '.');
  }
  const submittedAuthKey = String(input.authKey || '').trim();
  if (submittedAuthKey) {
    await saveSetting('msg91_auth_key_encrypted', encryptSecret(submittedAuthKey));
    await persistEnvironmentSecret('MSG91_AUTH_KEY', submittedAuthKey);
  }
  const submittedWidgetToken = String(input.widgetToken || '').trim();
  if (submittedWidgetToken) {
    await saveSetting('msg91_widget_token_encrypted', encryptSecret(submittedWidgetToken));
    await persistEnvironmentSecret('MSG91_WIDGET_TOKEN', submittedWidgetToken);
  }
  const mobile = normalizeMobile(input.whatsappNumber);
  const values = {
    msg91_enabled: input.enabled === true || input.enabled === 'true' || input.enabled === 'on',
    msg91_whatsapp_enabled: input.whatsappEnabled === true || input.whatsappEnabled === 'true' || input.whatsappEnabled === 'on',
    msg91_widget_id: String(input.widgetId || '').trim(),
    msg91_whatsapp_template_id: String(input.whatsappTemplateId || '').trim(),
    msg91_sms_template_id: String(input.smsTemplateId || '').trim(),
    msg91_sender_id: String(input.senderId || '').trim().toUpperCase(),
    msg91_whatsapp_number: mobile,
    msg91_otp_expiry_minutes: input.otpExpiryMinutes,
    msg91_otp_length: input.otpLength,
    msg91_resend_seconds: input.resendSeconds,
    msg91_maximum_attempts: input.maximumAttempts,
    msg91_delivery_method: method,
  };
  for (const [key, value] of Object.entries(values)) await saveSetting(key, value);
  return getConfig();
}

function friendlyError(error, channel) {
  const value = String(error && error.message || '');
  const providerCode = String(error && error.provider && (error.provider.code || error.provider.error_code) || '');
  const providerMsg = String(error && error.provider && (error.provider.message || error.provider.error || error.provider.msg) || '');

  if (/whatsapp messaging is currently/i.test(value)) return value;
  if (/mobile|identifier/i.test(value)) return 'This mobile number is not valid.';
  if (/template|flow/i.test(value)) return 'The selected message template is not configured correctly.';
  if (/IPBlocked|whitelist/i.test(value) || providerCode === '408') return 'MSG91 rejected this backend server IP. Add the server IP to the MSG91 IP whitelist.';
  if (providerCode === '708' || /error in fetching records/i.test(value)) return 'MSG91 could not start the requested retry channel. Verify that this channel is enabled in the OTP Widget.';
  if (/balance|credit/i.test(value)) return 'MSG91 balance is insufficient.';
  if (/rate|limit|too many/i.test(value)) return 'Too many requests. Please try again later.';
  if (/timeout|network|connect|fetch/i.test(value)) return 'MSG91 is temporarily unavailable. Please try again.';

  if (providerMsg && providerMsg !== '[object Object]' && providerMsg.length < 200) return providerMsg;
  if (value && !/rejected|failed|msg91 request rejected/i.test(value) && value.length < 150) return value;

  return channel === 'whatsapp' ? 'WhatsApp messaging is temporarily unavailable.' : 'Unable to send OTP right now. Please try again.';
}

function extractRequestId(data) {
  const values = [
    data && data.request_id, data && data.requestId, data && data.reqId,
    data && data.message_id, data && data.messageId,
    data && data.data && data.data.request_id,
    data && data.data && data.data.requestId,
    data && data.data && data.data.reqId,
    data && data.data && data.data.message_id,
    data && data.message && typeof data.message === 'object' ? data.message.request_id : undefined,
    data && data.message && typeof data.message === 'object' ? data.message.reqId : undefined,
    data && typeof data.message === 'string' ? data.message : undefined,
  ];
  const value = values.find(item => (typeof item === 'string' || typeof item === 'number') && String(item).trim() && !/^(success|sent|queued)$/i.test(String(item).trim()));
  return value == null ? '' : String(value).trim();
}

async function widgetRequest(endpoint, payload) {
  let response;
  try {
    response = await fetch('https://control.msg91.com/api/v5/widget/' + endpoint, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'STYLECAB-Backend/1.0' },
      body: JSON.stringify(payload), redirect: 'follow', signal: AbortSignal.timeout(15000),
    });
  } catch (error) { throw new Error('Network error: ' + error.message); }
  const data = await response.json().catch(() => null);
  if (!data) throw new Error('MSG91 server returned HTTP ' + response.status);
  if (!response.ok || data.type !== 'success') {
    const error = new Error(String(data.message || data.error || 'MSG91 request rejected'));
    error.provider = data;
    throw error;
  }
  return data;
}

async function createLog(data) {
  const dbResult = await pool.query(
    `INSERT INTO msg91_message_logs
     (idempotency_key, mobile, user_role, app_name, message_type, channel, template_name, status, attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', 0)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [data.idempotencyKey, data.mobile, data.userRole || 'Admin', data.appName || 'Admin', data.messageType, data.channel, data.templateName || '']
  );
  const insertedRow = dbResult.rows && dbResult.rows[0];
  if (!insertedRow) throw new Error('Duplicate message request.');
  return insertedRow.id;
}

async function updateLog(id, fields) {
  const allowed = ['msg91_request_id', 'status', 'attempts', 'error_message', 'provider_response'];
  const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
  if (!entries.length) return;
  const sets = entries.map(([key]) => key + ' = ?').concat('updated_at = CURRENT_TIMESTAMP');
  await pool.query('UPDATE msg91_message_logs SET ' + sets.join(', ') + ' WHERE id = ?', [...entries.map((entry) => entry[1]), id]);
}

async function sendTestOtp({ mobile, channel, userId }) {
  if (!CHANNEL_CODES[channel]) throw new Error('Select WhatsApp or SMS.');
  const config = await getConfig();
  validateChannelConfiguration(config, channel);
  const widgetToken = await getWidgetToken();
  if (!config.widgetId || !widgetToken) throw new Error('MSG91 Widget ID or Widget Token is missing.');
  const normalized = normalizeMobile(mobile);
  const idempotencyKey = crypto.createHash('sha256').update(['test-otp', normalized, channel, Math.floor(Date.now() / 30000)].join(':')).digest('hex');
  const logId = await createLog({
    idempotencyKey, mobile: normalized, messageType: 'OTP', channel,
    templateName: channel === 'whatsapp' ? config.whatsappTemplateId : config.smsTemplateId,
  });
  try {
    const sent = await widgetRequest('sendOtpMobile', { widgetId: config.widgetId, tokenAuth: widgetToken, identifier: normalized });
    const reqId = extractRequestId(sent);
    if (!reqId) throw new Error('MSG91 did not return a request ID.');
    // The configured widget's primary channel sends WhatsApp on sendOtpMobile.
    // Calling retryOtp immediately creates a second delivery and MSG91 rejects it
    // with code 708 because the retry record is not yet available.
    const provider = channel === 'whatsapp'
      ? sent
      : await widgetRequest('retryOtp', { widgetId: config.widgetId, tokenAuth: widgetToken, reqId, retryChannel: CHANNEL_CODES[channel] });
    await pool.query(
      `INSERT INTO msg91_test_otp_sessions (req_id, mobile, channel, expires_at, created_by)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP + (? * INTERVAL '1 minute'), ?)
       ON CONFLICT (req_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, attempts = 0, verified_at = NULL`,
      [reqId, normalized, channel, config.otpExpiryMinutes, userId || null]
    );
    await updateLog(logId, { msg91_request_id: reqId, status: 'Sent', attempts: 1, provider_response: provider });
    return { success: true, message: 'OTP sent successfully', reqId, channel, mobile: normalized };
  } catch (error) {
    await updateLog(logId, { status: /reject|invalid|blocked/i.test(error.message) ? 'Rejected' : 'Failed', attempts: 1, error_message: error.message, provider_response: error.provider || {} });
    const safe = new Error(friendlyError(error, channel));
    safe.detail = error.message;
    throw safe;
  }
}

async function verifyTestOtp({ reqId, otp }) {
  const normalizedReqId = String(reqId || '').trim();
  const normalizedOtp = String(otp || '').trim();
  if (!normalizedReqId) throw new Error('MSG91 request ID is required.');
  if (!normalizedOtp) throw new Error('OTP is required.');
  const [rows] = await pool.query('SELECT * FROM msg91_test_otp_sessions WHERE req_id = ? LIMIT 1', [normalizedReqId]);
  const session = rows[0];
  if (!session) {
    const config = await getConfig();
    const data = await widgetRequest('verifyOtp', {
      widgetId: config.widgetId,
      tokenAuth: await getWidgetToken(),
      reqId: normalizedReqId,
      otp: normalizedOtp,
    });
    return { success: true, message: 'OTP verified successfully', accessToken: data.message || null };
  }
  if (session.verified_at) return { success: true, message: 'OTP verified successfully' };
  if (new Date(session.expires_at) < new Date()) throw new Error('OTP has expired');
  const config = await getConfig();
  if (Number(session.attempts) >= config.maximumAttempts) throw new Error('Maximum OTP attempts reached.');
  await pool.query('UPDATE msg91_test_otp_sessions SET attempts = attempts + 1 WHERE req_id = ?', [normalizedReqId]);
  if (session.otp_hash) {
    const receivedHash = crypto.createHmac('sha256', encryptionKeys()[0]).update(normalizedOtp).digest('hex');
    const valid = receivedHash.length === session.otp_hash.length && crypto.timingSafeEqual(Buffer.from(receivedHash), Buffer.from(session.otp_hash));
    if (!valid) throw new Error('OTP is incorrect');
    await pool.query('UPDATE msg91_test_otp_sessions SET verified_at = CURRENT_TIMESTAMP WHERE req_id = ?', [normalizedReqId]);
    return { success: true, message: 'OTP verified successfully' };
  }
  try {
    const data = await widgetRequest('verifyOtp', {
      widgetId: config.widgetId, tokenAuth: await getWidgetToken(), reqId: normalizedReqId, otp: normalizedOtp,
    });
    await pool.query('UPDATE msg91_test_otp_sessions SET verified_at = CURRENT_TIMESTAMP WHERE req_id = ?', [normalizedReqId]);
    return { success: true, message: 'OTP verified successfully', accessToken: data.message || null };
  } catch (error) {
    if (/expired/i.test(error.message)) throw new Error('OTP has expired');
    throw new Error('OTP is incorrect');
  }
}

async function sendTestMessage({ mobile, channel, templateName, variables }) {
  if (!['whatsapp', 'sms'].includes(channel)) throw new Error('Select WhatsApp or SMS.');
  const config = await getConfig();
  if (channel === 'whatsapp' && !config.whatsappEnabled) {
    throw new Error('WhatsApp messaging is currently turned OFF in settings. Please enable WhatsApp messaging to send WhatsApp messages.');
  }
  const normalized = normalizeMobile(mobile);
  const key = await getAuthKey();
  if (!key) throw new Error('MSG91 configuration is incomplete.');
  if (!templateName) throw new Error('The selected message template is not configured correctly.');
  let vars;
  try { vars = variables ? JSON.parse(variables) : {}; } catch (_) { throw new Error('Template variables must be valid JSON.'); }
  const hashSource = ['test-message', normalized, channel, templateName, JSON.stringify(vars), Math.floor(Date.now() / 60000)].join(':');
  const logId = await createLog({
    idempotencyKey: crypto.createHash('sha256').update(hashSource).digest('hex'),
    mobile: normalized, messageType: 'Message', channel, templateName,
  });
  try {
    let response;
    if (channel === 'whatsapp') {
      if (!config.whatsappNumber) throw new Error('WhatsApp number not connected.');
      const components = {};
      Object.entries(vars).forEach(([name, value]) => { components[name] = { type: 'text', value: String(value) }; });
      response = await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
        method: 'POST', headers: { authkey: key, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrated_number: config.whatsappNumber, content_type: 'template', payload: { type: 'template', template: { name: templateName, language: { code: 'en', policy: 'deterministic' }, to_and_components: [{ to: [normalized], components }] } } }),
        signal: AbortSignal.timeout(15000),
      });
    } else {
      const query = new URLSearchParams({ mobile: '+' + normalized, authkey: key, template_id: templateName });
      response = await fetch('https://control.msg91.com/api/v5/otp?' + query, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(vars), signal: AbortSignal.timeout(15000),
      });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.type === 'error') {
      const error = new Error(data.message || 'MSG91 request rejected.');
      error.provider = data;
      throw error;
    }
    const requestId = extractRequestId(data);
    await updateLog(logId, { msg91_request_id: requestId, status: 'Queued', attempts: 1, provider_response: data });
    return { success: true, message: 'Test message accepted by MSG91', requestId, providerResponse: data };
  } catch (error) {
    await updateLog(logId, { status: 'Failed', attempts: 1, error_message: error.message, provider_response: error.provider || {} });
    const safe = new Error(friendlyError(error, channel));
    safe.detail = error.message;
    throw safe;
  }
}

async function sendPlatformOtp({ mobile, otp, appName = 'Customer App', userRole = 'Customer' }) {
  const normalized = normalizeMobile(String(mobile || '').startsWith('+') ? mobile : '+' + String(mobile || ''));
  const config = await getConfig();
  const key = await getAuthKey();

  // Enforce single admin-selected OTP channel (whatsapp or sms)
  const channel = config.deliveryMethod === 'sms' ? 'sms' : 'whatsapp';
  validateChannelConfiguration(config, channel);

  const templateName = channel === 'whatsapp' ? config.whatsappTemplateId : config.smsTemplateId;
  const idempotencyKey = crypto.createHash('sha256').update(['platform-otp', normalized, channel, otp].join(':')).digest('hex');
  let logId;
  try {
    logId = await createLog({ idempotencyKey, mobile: normalized, userRole, appName, messageType: 'OTP', channel, templateName });
    let response;
    if (channel === 'whatsapp') {
      response = await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
        method: 'POST', headers: { authkey: key, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrated_number: config.whatsappNumber, content_type: 'template', payload: { type: 'template', template: { name: templateName, language: { code: 'en', policy: 'deterministic' }, to_and_components: [{ to: [normalized], components: { body_1: { type: 'text', value: String(otp) }, button_1: { type: 'text', sub_type: 'url', value: String(otp) } } }] } } }),
        signal: AbortSignal.timeout(15000),
      });
    } else {
      const query = new URLSearchParams({ template_id: templateName, mobile: '+' + normalized, authkey: key });
      response = await fetch('https://control.msg91.com/api/v5/otp?' + query, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ Param1: String(otp), Param2: String(config.otpExpiryMinutes), Param3: 'STYLECAB' }),
        signal: AbortSignal.timeout(15000),
      });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.type === 'error') { const error = new Error(data.message || data.error || 'MSG91 request rejected.'); error.provider = data; throw error; }
    const requestId = extractRequestId(data);
    if (!requestId) throw new Error('MSG91 did not return a request ID.');
    await updateLog(logId, { msg91_request_id: requestId, status: 'Queued', attempts: 1, provider_response: data });
    return { success: true, channel, requestId };
  } catch (error) {
    if (logId) await updateLog(logId, { status: /reject|invalid|blocked|template/i.test(error.message) ? 'Rejected' : 'Failed', attempts: 1, error_message: error.message, provider_response: error.provider || {} });
    const safe = new Error(friendlyError(error, channel));
    safe.detail = error.message;
    throw safe;
  }
}

async function syncWhatsappStatuses() {
  const key = await getAuthKey();
  if (!key) return { updated: 0 };
  const end = new Date();
  const start = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const date = value => value.toISOString().slice(0, 10);
  const url = new URL('https://control.msg91.com/api/v5/report/logs/wa');
  url.searchParams.set('startDate', date(start));
  url.searchParams.set('endDate', date(end));
  const response = await fetch(url, { headers: { Accept: 'application/json', authkey: key }, signal: AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(body.data)) throw new Error(body.message || 'Unable to read MSG91 WhatsApp delivery reports.');
  const statusMap = { queued: 'Queued', submitted: 'Queued', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed', rejected: 'Rejected', expired: 'Expired' };
  let updated = 0;
  for (const report of body.data) {
    const requestId = String(report.requestId || report.request_id || '').trim();
    const status = statusMap[String(report.status || '').toLowerCase()];
    if (!requestId || !status) continue;
    const failure = ['Failed', 'Rejected', 'Expired'].includes(status) ? String(report.failureReason || report.failure_reason || status) : null;
    const [result] = await pool.query(
      `UPDATE msg91_message_logs SET status=?, error_message=?,
       delivered_at=CASE WHEN ? IN ('Delivered','Read') THEN COALESCE(delivered_at, ?::timestamp, CURRENT_TIMESTAMP) ELSE delivered_at END,
       read_at=CASE WHEN ?='Read' THEN COALESCE(read_at, ?::timestamp, CURRENT_TIMESTAMP) ELSE read_at END,
       updated_at=CURRENT_TIMESTAMP WHERE msg91_request_id=? AND status IS DISTINCT FROM ?`,
      [status, failure, status, report.deliveryTime || null, status, report.readTime || null, requestId, status]
    );
    updated += Number(result.affectedRows || 0);
  }
  return { updated };
}

async function listLogs(filters = {}) {
  const clauses = [];
  const params = [];
  const mappings = { channel: 'channel', messageType: 'message_type', status: 'status', appName: 'app_name' };
  Object.entries(mappings).forEach(([field, column]) => {
    if (filters[field]) {
      clauses.push(column + ' = ?');
      params.push(filters[field]);
    }
  });
  if (filters.dateFrom) { clauses.push('created_at >= ?'); params.push(filters.dateFrom); }
  if (filters.dateTo) { clauses.push("created_at < (?::date + INTERVAL '1 day')"); params.push(filters.dateTo); }
  const sql = 'SELECT * FROM msg91_message_logs ' + (clauses.length ? 'WHERE ' + clauses.join(' AND ') : '') + ' ORDER BY created_at DESC LIMIT 200';
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function handleWebhook(payload) {
  const requestId = extractRequestId({ ...payload, reqId: payload.req_id, data: payload.data || payload.response });
  if (!requestId) throw new Error('Webhook request ID is missing.');
  const raw = String(payload.status || payload.event || payload.eventName || payload.delivery_status || (payload.data && payload.data.status) || '').toLowerCase().replace(/[ _-]+/g, '');
  const statusMap = { pending: 'Pending', queued: 'Queued', submitted: 'Queued', accepted: 'Queued', sent: 'Sent', delivered: 'Delivered', delivery: 'Delivered', read: 'Read', seen: 'Read', failed: 'Failed', undelivered: 'Failed', rejected: 'Rejected', expired: 'Expired' };
  const status = statusMap[raw];
  if (!status) throw new Error('Webhook status is invalid.');
  const eventKey = crypto.createHash('sha256').update([requestId, raw, payload.timestamp || ''].join(':')).digest('hex');
  const insertedResult = await pool.query(
    'INSERT INTO msg91_webhook_events (event_key, payload) VALUES (?, ?) ON CONFLICT (event_key) DO NOTHING RETURNING event_key',
    [eventKey, payload]
  );
  if (!insertedResult.rows || !insertedResult.rows.length) return { duplicate: true };
  const fields = ['status = ?', 'provider_response = ?', 'updated_at = CURRENT_TIMESTAMP'];
  const params = [status, payload];
  if (status === 'Delivered') fields.push('delivered_at = CURRENT_TIMESTAMP');
  if (status === 'Read') fields.push('read_at = CURRENT_TIMESTAMP');
  if (['Failed', 'Rejected', 'Expired'].includes(status)) {
    fields.push('error_message = ?');
    params.push(String(payload.reason || payload.message || status));
  }
  params.push(requestId);
  await pool.query('UPDATE msg91_message_logs SET ' + fields.join(', ') + ' WHERE msg91_request_id = ?', params);
  return { duplicate: false };
}

module.exports = {
  getConfig, saveConfig, saveSetting, sendTestOtp, verifyTestOtp,
  sendTestMessage, sendPlatformOtp, syncWhatsappStatuses, listLogs, handleWebhook, normalizeMobile,
};
