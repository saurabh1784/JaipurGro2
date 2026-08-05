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

async function saveSettingValue(key, value, isSecret = 0) {
  try {
    const [existing] = await pool.query('SELECT setting_key FROM app_settings WHERE setting_key = ? LIMIT 1', [key]);
    if (existing && existing.length > 0) {
      await pool.query('UPDATE app_settings SET setting_value = ?, is_secret = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?', [value || '', isSecret, key]);
    } else {
      await pool.query('INSERT INTO app_settings (setting_key, setting_value, is_secret) VALUES (?, ?, ?)', [key, value || '', isSecret]);
    }
  } catch (err) {
    console.error(`Error saving setting ${key}:`, err);
  }
}

function maskSecret(val) {
  if (!val || val.length <= 8) return val ? '••••••••' : '';
  return val.slice(0, 4) + '••••••••' + val.slice(-4);
}

/**
 * Retrieves stored Razorpay payment gateway configurations
 */
async function getRazorpayConfig() {
  const enabled = await getSettingValue('razorpay_enabled', '1');
  const mode = await getSettingValue('razorpay_mode', 'test');
  const keyId = await getSettingValue('razorpay_key_id', process.env.RAZORPAY_KEY_ID || '');
  const keySecret = await getSettingValue('razorpay_key_secret', process.env.RAZORPAY_KEY_SECRET || '');
  const webhookSecret = await getSettingValue('razorpay_webhook_secret', process.env.RAZORPAY_WEBHOOK_SECRET || '');
  const currency = await getSettingValue('razorpay_currency', 'INR');
  const autoCapture = await getSettingValue('razorpay_auto_capture', '1');
  const merchantName = await getSettingValue('razorpay_merchant_name', 'Groxen');
  const themeColor = await getSettingValue('razorpay_theme_color', '#f97316');

  return {
    enabled: enabled === '1' || enabled === 'true',
    mode, // 'test' or 'live'
    keyId,
    keyIdMasked: maskSecret(keyId),
    keySecret,
    keySecretMasked: maskSecret(keySecret),
    webhookSecret,
    webhookSecretMasked: maskSecret(webhookSecret),
    currency,
    autoCapture: autoCapture === '1' || autoCapture === 'true',
    merchantName,
    themeColor,
    keyIdConfigured: Boolean(keyId),
    keySecretConfigured: Boolean(keySecret),
    webhookSecretConfigured: Boolean(webhookSecret),
  };
}

/**
 * Persists Razorpay payment gateway configuration into app_settings table
 */
async function saveRazorpayConfig(data = {}) {
  if (data.enabled !== undefined) {
    await saveSettingValue('razorpay_enabled', data.enabled ? '1' : '0');
  }
  if (data.mode !== undefined) {
    await saveSettingValue('razorpay_mode', data.mode === 'live' ? 'live' : 'test');
  }
  if (data.keyId !== undefined && data.keyId !== '' && !data.keyId.includes('••••')) {
    await saveSettingValue('razorpay_key_id', data.keyId.trim());
  }
  if (data.keySecret !== undefined && data.keySecret !== '' && !data.keySecret.includes('••••')) {
    await saveSettingValue('razorpay_key_secret', data.keySecret.trim(), 1);
  }
  if (data.webhookSecret !== undefined && data.webhookSecret !== '' && !data.webhookSecret.includes('••••')) {
    await saveSettingValue('razorpay_webhook_secret', data.webhookSecret.trim(), 1);
  }
  if (data.currency !== undefined) {
    await saveSettingValue('razorpay_currency', data.currency.trim().toUpperCase());
  }
  if (data.autoCapture !== undefined) {
    await saveSettingValue('razorpay_auto_capture', data.autoCapture ? '1' : '0');
  }
  if (data.merchantName !== undefined) {
    await saveSettingValue('razorpay_merchant_name', data.merchantName.trim());
  }
  if (data.themeColor !== undefined) {
    await saveSettingValue('razorpay_theme_color', data.themeColor.trim());
  }

  return getRazorpayConfig();
}

/**
 * Returns safe public Razorpay credentials for mobile apps & client SDKs
 */
async function getPublicRazorpayConfig() {
  const cfg = await getRazorpayConfig();
  return {
    enabled: cfg.enabled,
    mode: cfg.mode,
    keyId: cfg.keyId,
    currency: cfg.currency,
    merchantName: cfg.merchantName,
    themeColor: cfg.themeColor,
  };
}

/**
 * Tests Razorpay connection by attempting order creation with Razorpay SDK
 */
async function testRazorpayConnection(options = {}) {
  const storedConfig = await getRazorpayConfig();
  const keyId = (options.keyId && !options.keyId.includes('••••')) ? options.keyId.trim() : storedConfig.keyId;
  const keySecret = (options.keySecret && !options.keySecret.includes('••••')) ? options.keySecret.trim() : storedConfig.keySecret;
  const currency = options.currency ? options.currency.toUpperCase() : (storedConfig.currency || 'INR');
  const amount = Number(options.amount || 10);

  if (!keyId || !keyId.trim()) {
    throw new Error('Razorpay Key ID is not configured. Please enter a valid Key ID.');
  }
  if (!keySecret || !keySecret.trim()) {
    throw new Error('Razorpay Key Secret is not configured. Please enter a valid Key Secret.');
  }

  const Razorpay = require('razorpay');
  const instance = new Razorpay({ key_id: keyId, key_secret: keySecret });

  try {
    const order = await instance.orders.create({
      amount: Math.round(amount * 100), // amount in paise
      currency: currency,
      receipt: `test_rzp_${Date.now()}`,
      notes: { test_mode: 'true', origin: 'admin_panel' },
    });

    return {
      success: true,
      message: `Razorpay credentials verified successfully! Test Order created (Order ID: ${order.id}).`,
      orderId: order.id,
      amount: amount,
      currency: currency,
      status: order.status,
      keyId: keyId.slice(0, 6) + '••••••••',
      mode: storedConfig.mode,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Razorpay Test Error]:', error);
    const errMsg = error.error && error.error.description ? error.error.description : error.message;
    throw new Error(`Razorpay API Error: ${errMsg}`);
  }
}

module.exports = {
  getRazorpayConfig,
  saveRazorpayConfig,
  getPublicRazorpayConfig,
  testRazorpayConnection,
};
