const pool = require('../db');

/**
 * Standard System Default Templates Definitions
 */
const DEFAULT_TEMPLATES = [
  // ===============================================
  // EMAIL TEMPLATES
  // ===============================================
  {
    channel: 'email',
    template_key: 'user_welcome',
    name: 'User Welcome & Registration Email',
    subject: 'Welcome to Groxen, {{userName}}! 🎉',
    content: `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #1e293b;">
  <div style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center; color: #ffffff;">
    <h1 style="margin: 0; font-size: 24px; font-weight: 800;">Welcome to Groxen!</h1>
    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Your Fresh Grocery Shopping Partner</p>
  </div>
  <div style="padding: 24px; line-height: 1.6;">
    <h2 style="color: #0f172a; margin-top: 0;">Hello {{userName}},</h2>
    <p>We are super thrilled to welcome you to <strong>{{storeName}}</strong>!</p>
    <p>Your account has been successfully created with email: <strong>{{userEmail}}</strong>.</p>
    <div style="background: #f0f9ff; border-left: 4px solid #0284c7; padding: 14px; margin: 20px 0; border-radius: 0 8px 8px 0;">
      <p style="margin: 0; font-weight: 600; color: #0369a1;">🛍️ Start Shopping Now</p>
      <p style="margin: 4px 0 0 0; font-size: 13px; color: #334155;">Enjoy farm-fresh vegetables, organic staples, and daily essential groceries delivered to your doorstep in minutes.</p>
    </div>
    <p>If you have any questions, feel free to contact us at <strong>{{supportEmail}}</strong>.</p>
    <p style="margin-bottom: 0;">Warm regards,<br><strong>The {{storeName}} Team</strong></p>
  </div>
  <div style="border-top: 1px solid #e2e8f0; padding: 14px 24px; font-size: 12px; color: #94a3b8; text-align: center;">
    &copy; Groxen Online Supermarket. All rights reserved.
  </div>
</div>`,
    variables: JSON.stringify(['userName', 'userEmail', 'storeName', 'supportEmail']),
    status: 'active',
    is_system: 1,
  },

  {
    channel: 'email',
    template_key: 'order_invoice',
    name: 'Order Confirmation & Invoice Email',
    subject: 'Order Confirmed #{{orderId}} - Groxen E-Invoice',
    content: `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #1e293b;">
  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center; color: #ffffff;">
    <h1 style="margin: 0; font-size: 24px; font-weight: 800;">Order Confirmed! 🎉</h1>
    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.95;">Order #{{orderId}} • {{orderDate}}</p>
  </div>
  <div style="padding: 24px; line-height: 1.6;">
    <h2 style="color: #0f172a; margin-top: 0;">Thank you for your order, {{userName}}!</h2>
    <p>Your order <strong>#{{orderId}}</strong> has been received and is now being packed by our fulfillment team.</p>
    
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin: 20px 0;">
      <h3 style="margin: 0 0 12px 0; font-size: 15px; color: #0f172a;">📋 Order Summary</h3>
      <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
        <tr><td style="padding: 6px 0; color: #64748b;">Subtotal (Items):</td><td style="text-align: right; font-weight: 600; color: #1e293b;">₹{{itemsTotal}}</td></tr>
        <tr><td style="padding: 6px 0; color: #64748b;">Delivery Charge:</td><td style="text-align: right; font-weight: 600; color: #1e293b;">₹{{deliveryFee}}</td></tr>
        <tr style="border-top: 1px solid #cbd5e1;"><td style="padding: 10px 0; font-weight: 700; color: #0f172a; font-size: 16px;">Grand Total:</td><td style="text-align: right; font-weight: 800; color: #059669; font-size: 18px;">₹{{totalAmount}}</td></tr>
      </table>
    </div>

    <div style="background: #fff7ed; border-left: 4px solid #f97316; padding: 14px; margin: 16px 0; border-radius: 0 8px 8px 0;">
      <p style="margin: 0; font-weight: 700; color: #9a3412;">📍 Shipping Address:</p>
      <p style="margin: 4px 0 0 0; font-size: 13px; color: #431407;">{{deliveryAddress}}</p>
    </div>

    <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">You will receive an update as soon as your order is out for delivery.</p>
  </div>
</div>`,
    variables: JSON.stringify(['userName', 'orderId', 'orderDate', 'itemsTotal', 'deliveryFee', 'totalAmount', 'deliveryAddress']),
    status: 'active',
    is_system: 1,
  },

  {
    channel: 'email',
    template_key: 'delivery_status',
    name: 'Order Delivery Status Update Email',
    subject: 'Update on Order #{{orderId}} - {{deliveryStatus}}',
    content: `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #1e293b;">
  <div style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center; color: #ffffff;">
    <h1 style="margin: 0; font-size: 22px; font-weight: 800;">🚚 Delivery Update</h1>
    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.95;">Order #{{orderId}}</p>
  </div>
  <div style="padding: 24px; line-height: 1.6;">
    <h2>Hello {{userName}},</h2>
    <p>Your order status has been updated to: <strong style="color: #ea580c; font-size: 16px;">{{deliveryStatus}}</strong>.</p>
    
    <div style="background: #fff7ed; border: 1px dashed #fdba74; padding: 18px; border-radius: 12px; text-align: center; margin: 20px 0;">
      <p style="margin: 0; font-size: 13px; color: #9a3412; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Delivery Verification OTP</p>
      <div style="font-size: 28px; font-weight: 900; color: #c2410c; letter-spacing: 4px; margin: 8px 0;">{{otpCode}}</div>
      <p style="margin: 0; font-size: 12px; color: #7c2d12;">Share this OTP with rider <strong>{{riderName}}</strong> ({{riderPhone}}) upon arrival.</p>
    </div>

    <p style="margin-bottom: 0;">Thank you for shopping with Groxen!</p>
  </div>
</div>`,
    variables: JSON.stringify(['userName', 'orderId', 'deliveryStatus', 'otpCode', 'riderName', 'riderPhone']),
    status: 'active',
    is_system: 1,
  },

  {
    channel: 'email',
    template_key: 'password_reset',
    name: 'Password Reset Email',
    subject: 'Reset Your Groxen Password',
    content: `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #1e293b;">
  <div style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center; color: #ffffff;">
    <h1 style="margin: 0; font-size: 22px; font-weight: 800;">🔑 Password Reset Request</h1>
  </div>
  <div style="padding: 24px; line-height: 1.6;">
    <h2>Hello {{userName}},</h2>
    <p>We received a request to reset the password for your Groxen account.</p>
    
    <div style="background: #e0e7ff; border-left: 4px solid #6366f1; padding: 18px; border-radius: 0 10px 10px 0; margin: 20px 0; text-align: center;">
      <p style="margin: 0; font-size: 13px; color: #3730a3; font-weight: 700;">Your Verification OTP Code:</p>
      <div style="font-size: 30px; font-weight: 900; color: #312e81; letter-spacing: 4px; margin: 8px 0;">{{resetCode}}</div>
      <p style="margin: 0; font-size: 12px; color: #4338ca;">Valid for {{otpExpiry}} minutes.</p>
    </div>

    <p style="font-size: 13px; color: #64748b;">If you did not request a password reset, please secure your account immediately or contact support.</p>
  </div>
</div>`,
    variables: JSON.stringify(['userName', 'resetCode', 'resetLink', 'otpExpiry']),
    status: 'active',
    is_system: 1,
  },

  {
    channel: 'email',
    template_key: 'vendor_new_order',
    name: 'Vendor New Order Alert Email',
    subject: '⚡ New Order Received #{{orderId}} - Action Required',
    content: `<div style="font-family: Arial, sans-serif; max-width: 600px; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <h2 style="color: #0284c7; margin-top: 0;">Hello {{vendorName}},</h2>
  <p>You have received a new customer order <strong>#{{orderId}}</strong> for store <strong>{{storeName}}</strong>.</p>
  <p><strong>Total Order Amount:</strong> ₹{{totalAmount}} (Items Count: {{itemCount}})</p>
  <p>Please log in to your Vendor Portal to accept and fulfill this order promptly.</p>
</div>`,
    variables: JSON.stringify(['vendorName', 'storeName', 'orderId', 'totalAmount', 'itemCount']),
    status: 'active',
    is_system: 1,
  },

  {
    channel: 'email',
    template_key: 'vendor_approval',
    name: 'Vendor Account Approval Email',
    subject: '🎉 Congratulations! Your Vendor Account is Approved',
    content: `<div style="font-family: Arial, sans-serif; max-width: 600px; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <h2 style="color: #166534; margin-top: 0;">Welcome Partner {{vendorName}}!</h2>
  <p>Great news! Your vendor registration for <strong>{{storeName}}</strong> has been reviewed and APPROVED by Groxen Admin.</p>
  <p>You can now add your products, set up pricing, and start accepting online orders from nearby customers.</p>
</div>`,
    variables: JSON.stringify(['vendorName', 'storeName', 'loginUrl']),
    status: 'active',
    is_system: 1,
  },

  // ===============================================
  // WHATSAPP TEMPLATES
  // ===============================================
  {
    channel: 'whatsapp',
    template_key: 'user_welcome_wa',
    name: 'Welcome Message WhatsApp',
    subject: 'Welcome WhatsApp',
    content: `Hello {{userName}} 👋 Welcome to Groxen! 🛒

We are thrilled to have you onboard! Explore 1000+ fresh fruits, vegetables, dairy & daily grocery essentials delivered fast to your doorstep.

Reply HELP if you have any questions or need order assistance.`,
    variables: JSON.stringify(['userName', 'storeName']),
    status: 'active',
    is_system: 1,
  },

  {
    channel: 'whatsapp',
    template_key: 'order_status_wa',
    name: 'Order Status Update WhatsApp',
    subject: 'Order Status Update',
    content: `Hi {{userName}}! 📦

Your Groxen Order *#{{orderId}}* status is now: *{{orderStatus}}*.

💰 Total Amount: ₹{{totalAmount}}
🛵 Rider Name: {{riderName}} ({{riderPhone}})
🔐 Delivery OTP: *{{otpCode}}*

Share the Delivery OTP with our rider upon arrival. Thank you for choosing Groxen!`,
    variables: JSON.stringify(['userName', 'orderId', 'orderStatus', 'totalAmount', 'riderName', 'riderPhone', 'otpCode']),
    status: 'active',
    is_system: 1,
  },

  {
    channel: 'whatsapp',
    template_key: 'auth_otp_wa',
    name: 'Authentication OTP Code WhatsApp',
    subject: 'Auth OTP Code',
    content: `Your Groxen OTP verification code is: *{{otpCode}}* 🔐

This code is valid for {{otpExpiry}} minutes. For your security, do NOT share this OTP with anyone, including support staff.`,
    variables: JSON.stringify(['userName', 'otpCode', 'otpExpiry']),
    status: 'active',
    is_system: 1,
  },

  {
    channel: 'whatsapp',
    template_key: 'vendor_order_alert_wa',
    name: 'Vendor Order Notification WhatsApp',
    subject: 'Vendor Order Alert',
    content: `🔔 *New Order Alert for {{storeName}}!*

Order ID: #{{orderId}}
Total Amount: ₹{{totalAmount}}

Please open your Groxen Vendor app immediately to accept and pack this order.`,
    variables: JSON.stringify(['vendorName', 'storeName', 'orderId', 'totalAmount']),
    status: 'active',
    is_system: 1,
  },

  {
    channel: 'whatsapp',
    template_key: 'promotional_wa',
    name: 'Promotional Offer Broadcast WhatsApp',
    subject: 'Promotional Offer WhatsApp',
    content: `🎉 *Mega Savings Deal for {{userName}}!*

Get flat *{{discountPercent}}% OFF* on all fresh grocery & organic items today at Groxen! 🍎🥦

Use Coupon Code: *{{couponCode}}*
Shop now: {{shopUrl}}`,
    variables: JSON.stringify(['userName', 'discountPercent', 'couponCode', 'shopUrl']),
    status: 'active',
    is_system: 1,
  },

  // ===============================================
  // SMS TEMPLATES
  // ===============================================
  {
    channel: 'sms',
    template_key: 'registration_otp_sms',
    name: 'User Registration OTP SMS',
    subject: 'Registration OTP SMS',
    content: `Groxen: Your registration OTP verification code is {{otpCode}}. Valid for {{otpExpiry}} minutes. Do not share code.`,
    variables: JSON.stringify(['otpCode', 'otpExpiry']),
    status: 'active',
    is_system: 1,
  },

  {
    channel: 'sms',
    template_key: 'login_otp_sms',
    name: 'User Login 2FA OTP SMS',
    subject: 'Login OTP SMS',
    content: `Groxen: Your 2FA login OTP code is {{otpCode}}. Expires in {{otpExpiry}} mins. Keep your account safe.`,
    variables: JSON.stringify(['otpCode', 'otpExpiry']),
    status: 'active',
    is_system: 1,
  },

  {
    channel: 'sms',
    template_key: 'delivery_otp_sms',
    name: 'Order Delivery Handover OTP SMS',
    subject: 'Delivery OTP SMS',
    content: `Groxen: Your Order #{{orderId}} is out for delivery. Share OTP {{otpCode}} with rider {{riderName}} upon arrival. Total: RS. {{totalAmount}}.`,
    variables: JSON.stringify(['orderId', 'otpCode', 'riderName', 'totalAmount']),
    status: 'active',
    is_system: 1,
  },

  {
    channel: 'sms',
    template_key: 'order_update_sms',
    name: 'Order Status Notification SMS',
    subject: 'Order Status SMS',
    content: `Groxen: Order #{{orderId}} status updated to {{orderStatus}}. Track live details in your Groxen app.`,
    variables: JSON.stringify(['orderId', 'orderStatus']),
    status: 'active',
    is_system: 1,
  },

  {
    channel: 'sms',
    template_key: 'password_reset_sms',
    name: 'Password Reset OTP SMS',
    subject: 'Password Reset SMS',
    content: `Groxen: Your password reset verification code is {{otpCode}}. Valid for {{otpExpiry}} minutes.`,
    variables: JSON.stringify(['otpCode', 'otpExpiry']),
    status: 'active',
    is_system: 1,
  },

  {
    channel: 'sms',
    template_key: 'wallet_otp_sms',
    name: 'Wallet Withdrawal OTP SMS',
    subject: 'Wallet OTP SMS',
    content: `Groxen: OTP for wallet withdrawal of RS. {{amount}} is {{otpCode}}. Valid for {{otpExpiry}} mins. Do not share.`,
    variables: JSON.stringify(['amount', 'otpCode', 'otpExpiry']),
    status: 'active',
    is_system: 1,
  },
];

/**
 * Ensures table existence and seeds missing default templates
 */
async function ensureTableAndDefaults() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_templates (
        id SERIAL PRIMARY KEY,
        channel VARCHAR(20) NOT NULL,
        template_key VARCHAR(100) NOT NULL,
        name VARCHAR(150) NOT NULL,
        subject VARCHAR(255) DEFAULT NULL,
        content TEXT NOT NULL,
        variables TEXT DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        is_system SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uniq_notif_tpl_channel_key UNIQUE (channel, template_key)
      );
    `);

    // Insert missing default system templates
    for (const tpl of DEFAULT_TEMPLATES) {
      try {
        const [existing] = await pool.query(
          'SELECT id FROM notification_templates WHERE channel = ? AND template_key = ? LIMIT 1',
          [tpl.channel, tpl.template_key]
        );
        if (!existing || existing.length === 0) {
          await pool.query(
            `INSERT INTO notification_templates 
             (channel, template_key, name, subject, content, variables, status, is_system)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              tpl.channel,
              tpl.template_key,
              tpl.name,
              tpl.subject,
              tpl.content,
              tpl.variables,
              tpl.status,
              tpl.is_system,
            ]
          );
        }
      } catch (err) {
        console.error(`[TemplateEngine] Error seeding default template ${tpl.channel}:${tpl.template_key}:`, err.message);
      }
    }

    // Auto-migrate any existing templates in DB that still have legacy JaipurGro brand name
    await pool.query(`
      UPDATE notification_templates
      SET 
        name = REPLACE(REPLACE(name, 'JaipurGro', 'Groxen'), 'jaipurgro', 'groxen'),
        subject = REPLACE(REPLACE(subject, 'JaipurGro', 'Groxen'), 'jaipurgro', 'groxen'),
        content = REPLACE(REPLACE(REPLACE(content, 'JaipurGro', 'Groxen'), 'jaipurgro.com', 'groxen.in'), 'jaipurgro', 'groxen')
      WHERE LOWER(name) LIKE '%jaipurgro%' OR LOWER(subject) LIKE '%jaipurgro%' OR LOWER(content) LIKE '%jaipurgro%'
    `).catch(() => {});
  } catch (err) {
    console.error('[TemplateEngine] Error creating notification_templates table:', err.message);
  }
}

/**
 * Retrieve all templates or templates filtered by channel
 */
async function getAllTemplates(channel = null) {
  await ensureTableAndDefaults();
  try {
    let sql = 'SELECT * FROM notification_templates';
    let params = [];
    if (channel) {
      sql += ' WHERE channel = ?';
      params.push(channel);
    }
    sql += ' ORDER BY channel ASC, is_system DESC, id ASC';
    const [rows] = await pool.query(sql, params);
    return rows.map((r) => ({
      ...r,
      variables: r.variables ? (typeof r.variables === 'string' ? JSON.parse(r.variables) : r.variables) : [],
    }));
  } catch (err) {
    console.error('[TemplateEngine] Error getting templates:', err.message);
    return DEFAULT_TEMPLATES.filter((t) => !channel || t.channel === channel);
  }
}

/**
 * Retrieve template by ID
 */
async function getTemplateById(id) {
  await ensureTableAndDefaults();
  try {
    const [rows] = await pool.query('SELECT * FROM notification_templates WHERE id = ? LIMIT 1', [id]);
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      ...r,
      variables: r.variables ? (typeof r.variables === 'string' ? JSON.parse(r.variables) : r.variables) : [],
    };
  } catch (err) {
    console.error('[TemplateEngine] Error getting template by ID:', err.message);
    return null;
  }
}

/**
 * Retrieve template by channel & key
 */
async function getTemplateByKey(channel, templateKey) {
  await ensureTableAndDefaults();
  try {
    const [rows] = await pool.query(
      'SELECT * FROM notification_templates WHERE channel = ? AND template_key = ? LIMIT 1',
      [channel, templateKey]
    );
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      ...r,
      variables: r.variables ? (typeof r.variables === 'string' ? JSON.parse(r.variables) : r.variables) : [],
    };
  } catch (err) {
    console.error('[TemplateEngine] Error getting template by key:', err.message);
    return null;
  }
}

/**
 * Save or update template
 */
async function saveTemplate(data = {}) {
  await ensureTableAndDefaults();
  const { id, channel, template_key, name, subject, content, variables, status } = data;

  if (!channel || !template_key || !name || !content) {
    throw new Error('Channel, Template Key, Name, and Content are required fields.');
  }

  const varsJson = Array.isArray(variables) ? JSON.stringify(variables) : (variables || '[]');
  const tplStatus = status || 'active';

  if (id) {
    // Update existing
    await pool.query(
      `UPDATE notification_templates 
       SET channel = ?, template_key = ?, name = ?, subject = ?, content = ?, variables = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [channel.toLowerCase().trim(), template_key.trim(), name.trim(), subject ? subject.trim() : null, content, varsJson, tplStatus, id]
    );
    return getTemplateById(id);
  } else {
    // Insert new
    const [res] = await pool.query(
      `INSERT INTO notification_templates 
       (channel, template_key, name, subject, content, variables, status, is_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [channel.toLowerCase().trim(), template_key.trim(), name.trim(), subject ? subject.trim() : null, content, varsJson, tplStatus]
    );
    return getTemplateById(res.insertId || res.id);
  }
}

/**
 * Delete or deactivate template
 */
async function deleteTemplate(id) {
  await ensureTableAndDefaults();
  const tpl = await getTemplateById(id);
  if (!tpl) throw new Error('Template not found');

  if (tpl.is_system) {
    // System templates are deactivated rather than hard deleted
    await pool.query('UPDATE notification_templates SET status = "inactive" WHERE id = ?', [id]);
    return { success: true, message: 'System template deactivated' };
  } else {
    await pool.query('DELETE FROM notification_templates WHERE id = ?', [id]);
    return { success: true, message: 'Custom template deleted successfully' };
  }
}

/**
 * Reset system template to default factory content
 */
async function resetTemplateToDefault(channel, templateKey) {
  await ensureTableAndDefaults();
  const def = DEFAULT_TEMPLATES.find((t) => t.channel === channel && t.template_key === templateKey);
  if (!def) throw new Error('Default template definition not found');

  await pool.query(
    `UPDATE notification_templates 
     SET name = ?, subject = ?, content = ?, variables = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
     WHERE channel = ? AND template_key = ?`,
    [def.name, def.subject, def.content, def.variables, channel, templateKey]
  );
  return getTemplateByKey(channel, templateKey);
}

/**
 * Render template with dynamic data interpolation: {{variableName}} -> data.variableName
 */
async function renderTemplate(channel, templateKey, data = {}) {
  let tpl = await getTemplateByKey(channel, templateKey);

  // Fallback to default definition if DB not found
  if (!tpl) {
    const def = DEFAULT_TEMPLATES.find((t) => t.channel === channel && t.template_key === templateKey);
    if (def) {
      tpl = {
        ...def,
        variables: JSON.parse(def.variables),
      };
    }
  }

  if (!tpl) {
    return {
      subject: data.subject || `${channel.toUpperCase()} Notification`,
      content: data.customMessage || data.content || '',
      rendered: false,
      isEnabled: false,
    };
  }

  const isEnabled = String(tpl.status || 'active').toLowerCase() === 'active';
  if (!isEnabled) {
    return {
      templateId: tpl.id,
      channel: tpl.channel,
      templateKey: tpl.template_key,
      name: tpl.name,
      subject: null,
      content: null,
      status: 'inactive',
      isEnabled: false,
      rendered: false,
      reason: `Template '${tpl.template_key}' on channel '${tpl.channel}' is disabled.`,
    };
  }

  // Perform placeholder interpolation {{variable}}
  const interpolate = (str) => {
    if (!str) return '';
    return str.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, varName) => {
      if (data[varName] !== undefined && data[varName] !== null) {
        return String(data[varName]);
      }
      return match; // keep {{varName}} if missing or replace with fallback
    });
  };

  return {
    templateId: tpl.id,
    channel: tpl.channel,
    templateKey: tpl.template_key,
    name: tpl.name,
    subject: interpolate(tpl.subject || ''),
    content: interpolate(tpl.content || ''),
    status: tpl.status,
    isEnabled: true,
    rendered: true,
  };
}

/**
 * Toggle template enable/disable status immediately
 */
async function toggleTemplateStatus(id, newStatus) {
  await ensureTableAndDefaults();
  const cleanStatus = (String(newStatus || '').toLowerCase() === 'active' || newStatus === true || newStatus === 1 || newStatus === '1') ? 'active' : 'inactive';
  await pool.query(
    'UPDATE notification_templates SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [cleanStatus, id]
  );
  return getTemplateById(id);
}

module.exports = {
  DEFAULT_TEMPLATES,
  ensureTableAndDefaults,
  getAllTemplates,
  getTemplateById,
  getTemplateByKey,
  saveTemplate,
  deleteTemplate,
  resetTemplateToDefault,
  toggleTemplateStatus,
  renderTemplate,
};
