const nodemailer = require('nodemailer');
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
 * Retrieves all stored email configuration settings with audience timing triggers
 */
async function getEmailSettings() {
  const mailDriver = await getSettingValue('email_mail_driver', 'SMTP');
  const host = await getSettingValue('email_host', 'smtp.gmail.com');
  const port = parseInt(await getSettingValue('email_port', '587'), 10) || 587;
  const username = await getSettingValue('email_username', '');
  const password = await getSettingValue('email_password', '');
  const fromEmail = await getSettingValue('email_from_email', '');
  const fromName = await getSettingValue('email_from_name', 'Groxen Admin');
  const encryption = await getSettingValue('email_encryption', 'TLS'); // TLS, SSL, None
  const status = await getSettingValue('email_status', 'active'); // active, inactive

  // User / Customer Email Event Triggers
  const userWelcome = await getSettingValue('email_trigger_user_welcome', 'true');
  const userOrderInvoice = await getSettingValue('email_trigger_user_order_invoice', 'true');
  const userDeliveryStatus = await getSettingValue('email_trigger_user_delivery_status', 'true');
  const userPasswordReset = await getSettingValue('email_trigger_user_password_reset', 'true');

  // Vendor Partner Email Event Triggers
  const vendorNewOrder = await getSettingValue('email_trigger_vendor_new_order', 'true');
  const vendorApproval = await getSettingValue('email_trigger_vendor_approval', 'true');

  // Delivery Partner Email Event Triggers
  const deliveryAssignment = await getSettingValue('email_trigger_delivery_assignment', 'true');
  const deliveryApproval = await getSettingValue('email_trigger_delivery_approval', 'true');

  return {
    mailDriver,
    host,
    port,
    username,
    password,
    fromEmail,
    fromName,
    encryption,
    status,
    triggers: {
      userWelcome: userWelcome === 'true' || userWelcome === '1',
      userOrderInvoice: userOrderInvoice === 'true' || userOrderInvoice === '1',
      userDeliveryStatus: userDeliveryStatus === 'true' || userDeliveryStatus === '1',
      userPasswordReset: userPasswordReset === 'true' || userPasswordReset === '1',
      vendorNewOrder: vendorNewOrder === 'true' || vendorNewOrder === '1',
      vendorApproval: vendorApproval === 'true' || vendorApproval === '1',
      deliveryAssignment: deliveryAssignment === 'true' || deliveryAssignment === '1',
      deliveryApproval: deliveryApproval === 'true' || deliveryApproval === '1',
    },
  };
}

/**
 * Persists email settings & audience timing triggers into app_settings table
 */
async function saveEmailSettings(settings = {}) {
  if (settings.mailDriver !== undefined) await saveSettingValue('email_mail_driver', settings.mailDriver.trim());
  if (settings.host !== undefined) await saveSettingValue('email_host', settings.host.trim());
  if (settings.port !== undefined) await saveSettingValue('email_port', String(settings.port).trim());
  if (settings.username !== undefined) await saveSettingValue('email_username', settings.username.trim());
  if (settings.password !== undefined) await saveSettingValue('email_password', settings.password);
  if (settings.fromEmail !== undefined) await saveSettingValue('email_from_email', settings.fromEmail.trim());
  if (settings.fromName !== undefined) await saveSettingValue('email_from_name', settings.fromName.trim());
  if (settings.encryption !== undefined) await saveSettingValue('email_encryption', settings.encryption.trim());
  if (settings.status !== undefined) await saveSettingValue('email_status', settings.status.trim());

  // Save Triggers
  const triggers = settings.triggers || {};
  if (triggers.userWelcome !== undefined) {
    await saveSettingValue('email_trigger_user_welcome', triggers.userWelcome ? 'true' : 'false');
  }
  if (triggers.userOrderInvoice !== undefined) {
    await saveSettingValue('email_trigger_user_order_invoice', triggers.userOrderInvoice ? 'true' : 'false');
  }
  if (triggers.userDeliveryStatus !== undefined) {
    await saveSettingValue('email_trigger_user_delivery_status', triggers.userDeliveryStatus ? 'true' : 'false');
  }
  if (triggers.userPasswordReset !== undefined) {
    await saveSettingValue('email_trigger_user_password_reset', triggers.userPasswordReset ? 'true' : 'false');
  }
  if (triggers.vendorNewOrder !== undefined) {
    await saveSettingValue('email_trigger_vendor_new_order', triggers.vendorNewOrder ? 'true' : 'false');
  }
  if (triggers.vendorApproval !== undefined) {
    await saveSettingValue('email_trigger_vendor_approval', triggers.vendorApproval ? 'true' : 'false');
  }
  if (triggers.deliveryAssignment !== undefined) {
    await saveSettingValue('email_trigger_delivery_assignment', triggers.deliveryAssignment ? 'true' : 'false');
  }
  if (triggers.deliveryApproval !== undefined) {
    await saveSettingValue('email_trigger_delivery_approval', triggers.deliveryApproval ? 'true' : 'false');
  }

  return getEmailSettings();
}

/**
 * Creates a Nodemailer transporter based on provided or stored settings
 */
function createTransporter(cfg) {
  const host = cfg.host || 'localhost';
  const port = parseInt(cfg.port, 10) || 587;
  const enc = (cfg.encryption || 'TLS').toUpperCase();

  const transportOpts = {
    host,
    port,
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 15000,
  };

  // SSL vs TLS vs None
  if (enc === 'SSL' || port === 465) {
    transportOpts.secure = true;
  } else if (enc === 'NONE') {
    transportOpts.secure = false;
    transportOpts.tls = { rejectUnauthorized: false };
  } else {
    // TLS / STARTTLS default
    transportOpts.secure = false;
    transportOpts.requireTLS = true;
    transportOpts.tls = { rejectUnauthorized: false };
  }

  // Authentication
  if (cfg.username || cfg.password) {
    transportOpts.auth = {
      user: cfg.username || '',
      pass: cfg.password || '',
    };
  }

  return nodemailer.createTransport(transportOpts);
}

/**
 * Sends a test email to the specified target address with detailed diagnostic reporting
 */
async function sendTestEmail({ recipientEmail, subject, customBody, config }) {
  if (!recipientEmail || !recipientEmail.trim()) {
    throw new Error('Recipient email address is required');
  }

  const cfg = config || (await getEmailSettings());

  if (!cfg.host || !cfg.host.trim()) {
    throw new Error('SMTP Host is not configured. Please fill in the SMTP Host.');
  }

  const transporter = createTransporter(cfg);

  // 1. Verify SMTP Connection
  try {
    await transporter.verify();
  } catch (verifyErr) {
    throw new Error(`SMTP Connection/Authentication Failed: ${verifyErr.message}`);
  }

  const fromName = cfg.fromName || 'Groxen Admin';
  const fromEmail = cfg.fromEmail || cfg.username || 'noreply@groxen.com';
  const mailSubject = subject || 'Groxen - Test Email Verification';
  const bodyText = customBody || 'This is a test email sent from Groxen Server to verify SMTP settings and email deliverability.';

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
      <div style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 20px; border-radius: 8px 8px 0 0; text-align: center; color: #ffffff;">
        <h1 style="margin: 0; font-size: 22px; font-weight: 700;">Groxen Email Test</h1>
        <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">SMTP Verification System</p>
      </div>
      
      <div style="padding: 24px; color: #334155; line-height: 1.6;">
        <p style="font-size: 16px; font-weight: 600; color: #0f172a; margin-top: 0;">Email System Test Successful!</p>
        <p style="font-size: 14px; color: #475569;">${bodyText}</p>
        
        <div style="background-color: #f8fafc; border-left: 4px solid #f97316; padding: 14px; margin: 20px 0; border-radius: 0 6px 6px 0;">
          <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Server Configuration Details</h4>
          <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
            <tr><td style="padding: 3px 0; color: #64748b; width: 120px;">Mail Driver:</td><td style="font-weight: 600; color: #1e293b;">${cfg.mailDriver || 'SMTP'}</td></tr>
            <tr><td style="padding: 3px 0; color: #64748b;">SMTP Host:</td><td style="font-weight: 600; color: #1e293b;">${cfg.host}:${cfg.port}</td></tr>
            <tr><td style="padding: 3px 0; color: #64748b;">Encryption:</td><td style="font-weight: 600; color: #1e293b;">${cfg.encryption || 'TLS'}</td></tr>
            <tr><td style="padding: 3px 0; color: #64748b;">Sender:</td><td style="font-weight: 600; color: #1e293b;">"${fromName}" &lt;${fromEmail}&gt;</td></tr>
            <tr><td style="padding: 3px 0; color: #64748b;">Recipient:</td><td style="font-weight: 600; color: #1e293b;">${recipientEmail}</td></tr>
            <tr><td style="padding: 3px 0; color: #64748b;">Timestamp:</td><td style="font-weight: 600; color: #1e293b;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td></tr>
          </table>
        </div>
        
        <p style="font-size: 13px; color: #94a3b8; margin-bottom: 0;">If you received this message, your mail configuration is operational and ready to send customer notifications, invoices, and password resets.</p>
      </div>
      
      <div style="border-top: 1px solid #e2e8f0; padding: 14px 24px; font-size: 12px; color: #94a3b8; text-align: center;">
        &copy; ${new Date().getFullYear()} Groxen Platform. All rights reserved.
      </div>
    </div>
  `;

  // 2. Send Mail
  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: recipientEmail.trim(),
    subject: mailSubject,
    text: bodyText,
    html: htmlContent,
  });

  return {
    success: true,
    messageId: info.messageId,
    response: info.response,
    accepted: info.accepted,
    rejected: info.rejected,
    recipient: recipientEmail.trim(),
  };
}

/**
 * General purpose send mail function with trigger check
 */
async function sendMail({ to, subject, html, text, triggerKey = null }) {
  const cfg = await getEmailSettings();
  if (cfg.status === 'inactive') {
    console.log('[EmailService] Mail service disabled in settings. Skipping email to:', to);
    return { success: false, disabled: true, message: 'Mail service is inactive in settings' };
  }

  // Check specific trigger if specified
  if (triggerKey && cfg.triggers[triggerKey] === false) {
    console.log(`[EmailService] Trigger '${triggerKey}' disabled in settings. Skipping email to:`, to);
    return { success: false, disabled: true, message: `Email trigger '${triggerKey}' is disabled in settings` };
  }

  const transporter = createTransporter(cfg);
  const fromName = cfg.fromName || 'Groxen Admin';
  const fromEmail = cfg.fromEmail || cfg.username || 'noreply@groxen.com';

  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text,
    html,
  });

  return {
    success: true,
    messageId: info.messageId,
    response: info.response,
  };
}

module.exports = {
  getEmailSettings,
  saveEmailSettings,
  createTransporter,
  sendTestEmail,
  sendMail,
};
