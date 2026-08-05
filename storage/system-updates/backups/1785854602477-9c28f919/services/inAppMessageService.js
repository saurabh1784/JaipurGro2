const pool = require('../db');

/**
 * Default System In-App Message Templates
 */
const DEFAULT_INAPP_TEMPLATES = [
  {
    template_key: 'inapp_user_registration',
    name: 'User Registration Welcome In-App Message',
    target_app: 'client',
    event_type: 'registration',
    title: 'Welcome to Groxen, {{userName}}! 🎉',
    content: 'Welcome aboard {{userName}}! Your account has been registered successfully. Enjoy fresh groceries delivered fast to your doorstep.',
    variables: JSON.stringify(['userName']),
    status: 'active',
    is_system: 1,
  },
  {
    template_key: 'inapp_order_update',
    name: 'Order Status Update In-App Notification',
    target_app: 'client',
    event_type: 'order_update',
    title: 'Order #{{orderId}} Update 📦',
    content: 'Hi {{userName}}, your order #{{orderId}} status has changed to: {{status}}. Total amount: ₹{{amount}}.',
    variables: JSON.stringify(['userName', 'orderId', 'status', 'amount']),
    status: 'active',
    is_system: 1,
  },
  {
    template_key: 'inapp_payment_received',
    name: 'Payment Confirmation In-App Message',
    target_app: 'client',
    event_type: 'payment',
    title: 'Payment Received for Order #{{orderId}} 💳',
    content: 'Hi {{userName}}, we have received your payment of ₹{{amount}} for order #{{orderId}}. Status: {{status}}.',
    variables: JSON.stringify(['userName', 'orderId', 'amount', 'status']),
    status: 'active',
    is_system: 1,
  },
  {
    template_key: 'inapp_vendor_approval',
    name: 'Vendor Account Approval In-App Alert',
    target_app: 'vendor',
    event_type: 'approval',
    title: 'Vendor Account Approved! 🎉',
    content: 'Hello {{userName}}, your vendor store profile has been reviewed and APPROVED. Status: {{status}}. You can now start managing your store.',
    variables: JSON.stringify(['userName', 'status']),
    status: 'active',
    is_system: 1,
  },
  {
    template_key: 'inapp_order_rejection',
    name: 'Order Rejection / Cancellation Alert',
    target_app: 'client',
    event_type: 'rejection',
    title: 'Update Regarding Order #{{orderId}} ⚠️',
    content: 'Dear {{userName}}, your request for order #{{orderId}} could not be processed. Current status: {{status}}.',
    variables: JSON.stringify(['userName', 'orderId', 'status']),
    status: 'active',
    is_system: 1,
  },
  {
    template_key: 'inapp_wallet_update',
    name: 'Wallet Balance Update In-App Alert',
    target_app: 'client',
    event_type: 'wallet_update',
    title: 'Wallet Balance Updated 💰',
    content: 'Hi {{userName}}, your wallet balance has been updated by ₹{{amount}}. Status: {{status}}.',
    variables: JSON.stringify(['userName', 'amount', 'status']),
    status: 'active',
    is_system: 1,
  },
  {
    template_key: 'inapp_delivery_status',
    name: 'Delivery Status & Verification OTP In-App Notification',
    target_app: 'delivery',
    event_type: 'delivery_status',
    title: 'Delivery Order #{{orderId}} OTP Code 🚚',
    content: 'Delivery Verification OTP for order #{{orderId}} is {{otp}}. Share with customer {{userName}} upon arrival. Status: {{status}}.',
    variables: JSON.stringify(['userName', 'orderId', 'otp', 'status']),
    status: 'active',
    is_system: 1,
  },
];

/**
 * Ensures in_app_message_templates table exists and seeds missing default templates
 */
async function ensureTableAndDefaults() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS in_app_message_templates (
        id SERIAL PRIMARY KEY,
        template_key VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(150) NOT NULL,
        target_app VARCHAR(50) NOT NULL DEFAULT 'all',
        event_type VARCHAR(50) NOT NULL DEFAULT 'order_update',
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        variables TEXT DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        is_system SMALLINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert missing default system templates
    for (const tpl of DEFAULT_INAPP_TEMPLATES) {
      try {
        const [existing] = await pool.query(
          'SELECT id FROM in_app_message_templates WHERE template_key = ? LIMIT 1',
          [tpl.template_key]
        );
        if (!existing || existing.length === 0) {
          await pool.query(
            `INSERT INTO in_app_message_templates 
             (template_key, name, target_app, event_type, title, content, variables, status, is_system)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              tpl.template_key,
              tpl.name,
              tpl.target_app,
              tpl.event_type,
              tpl.title,
              tpl.content,
              tpl.variables,
              tpl.status,
              tpl.is_system,
            ]
          );
        }
      } catch (err) {
        console.error(`[InAppTemplateEngine] Error seeding default template ${tpl.template_key}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[InAppTemplateEngine] Error initializing table:', err.message);
  }
}

/**
 * Fetch all in-app templates with optional targetApp or eventType filtering
 */
async function getAllTemplates(filters = {}) {
  await ensureTableAndDefaults();
  try {
    let sql = 'SELECT * FROM in_app_message_templates WHERE 1=1';
    const params = [];

    if (filters.target_app && filters.target_app !== 'all') {
      sql += " AND (target_app = ? OR target_app = 'all')";
      params.push(filters.target_app);
    }
    if (filters.event_type && filters.event_type !== 'all') {
      sql += ' AND event_type = ?';
      params.push(filters.event_type);
    }

    sql += ' ORDER BY is_system DESC, id ASC';
    const [rows] = await pool.query(sql, params);
    return rows.map((r) => ({
      ...r,
      variables: r.variables ? (typeof r.variables === 'string' ? JSON.parse(r.variables) : r.variables) : [],
    }));
  } catch (err) {
    console.error('[InAppTemplateEngine] Error fetching templates:', err.message);
    return DEFAULT_INAPP_TEMPLATES.map((t) => ({
      ...t,
      variables: JSON.parse(t.variables),
    }));
  }
}

/**
 * Get template by ID
 */
async function getTemplateById(id) {
  await ensureTableAndDefaults();
  try {
    const [rows] = await pool.query('SELECT * FROM in_app_message_templates WHERE id = ? LIMIT 1', [id]);
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      ...r,
      variables: r.variables ? (typeof r.variables === 'string' ? JSON.parse(r.variables) : r.variables) : [],
    };
  } catch (err) {
    console.error('[InAppTemplateEngine] Error getting template by ID:', err.message);
    return null;
  }
}

/**
 * Get active template for an event & target app
 */
async function getActiveTemplateForEvent(eventType, targetApp = 'all') {
  await ensureTableAndDefaults();
  try {
    const [rows] = await pool.query(
      `SELECT * FROM in_app_message_templates 
       WHERE status = 'active' AND event_type = ? AND (target_app = ? OR target_app = 'all')
       ORDER BY CASE WHEN target_app = ? THEN 1 ELSE 2 END, id DESC LIMIT 1`,
      [eventType, targetApp, targetApp]
    );
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      ...r,
      variables: r.variables ? (typeof r.variables === 'string' ? JSON.parse(r.variables) : r.variables) : [],
    };
  } catch (err) {
    console.error('[InAppTemplateEngine] Error getting active template for event:', err.message);
    return null;
  }
}

/**
 * Save or update in-app template
 */
async function saveTemplate(data = {}) {
  await ensureTableAndDefaults();
  const { id, template_key, name, target_app, event_type, title, content, variables, status } = data;

  if (!name || !title || !content || !event_type) {
    throw new Error('Name, Event Type, Title, and Content are required fields.');
  }

  const cleanKey = String(template_key || '').trim() || `inapp_${String(event_type).trim()}_${Date.now()}`;
  const cleanTarget = String(target_app || 'all').trim();
  const cleanEvent = String(event_type || 'order_update').trim();
  const varsJson = Array.isArray(variables) ? JSON.stringify(variables) : (variables || '[]');
  const tplStatus = status === 'active' || status === '1' || status === true ? 'active' : 'inactive';

  if (id) {
    await pool.query(
      `UPDATE in_app_message_templates 
       SET template_key = ?, name = ?, target_app = ?, event_type = ?, title = ?, content = ?, variables = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [cleanKey, name.trim(), cleanTarget, cleanEvent, title.trim(), content.trim(), varsJson, tplStatus, id]
    );
    return getTemplateById(id);
  } else {
    const [res] = await pool.query(
      `INSERT INTO in_app_message_templates 
       (template_key, name, target_app, event_type, title, content, variables, status, is_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [cleanKey, name.trim(), cleanTarget, cleanEvent, title.trim(), content.trim(), varsJson, tplStatus]
    );
    return getTemplateById(res.insertId || res.id);
  }
}

/**
 * Delete template (or deactivate if system built-in)
 */
async function deleteTemplate(id) {
  await ensureTableAndDefaults();
  const tpl = await getTemplateById(id);
  if (!tpl) throw new Error('In-App Template not found');

  if (tpl.is_system) {
    await pool.query("UPDATE in_app_message_templates SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
    return { success: true, message: 'System template deactivated' };
  } else {
    await pool.query('DELETE FROM in_app_message_templates WHERE id = ?', [id]);
    return { success: true, message: 'In-App template deleted successfully' };
  }
}

/**
 * Toggle template active/inactive status
 */
async function toggleTemplateStatus(id, newStatus) {
  await ensureTableAndDefaults();
  const cleanStatus = (String(newStatus || '').toLowerCase() === 'active' || newStatus === true || newStatus === 1 || newStatus === '1') ? 'active' : 'inactive';
  await pool.query(
    'UPDATE in_app_message_templates SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [cleanStatus, id]
  );
  return getTemplateById(id);
}

/**
 * Render template with sample/live variable interpolation
 */
function renderContent(templateStr, data = {}) {
  if (!templateStr) return '';
  return templateStr.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, varName) => {
    if (data[varName] !== undefined && data[varName] !== null) {
      return String(data[varName]);
    }
    return match;
  });
}

/**
 * Render In-App template by event type & target app
 */
async function renderInAppTemplate(eventType, targetApp, data = {}) {
  const tpl = await getActiveTemplateForEvent(eventType, targetApp);
  if (!tpl) {
    return {
      isEnabled: false,
      title: data.title || 'Notification',
      content: data.content || data.message || '',
      rendered: false,
    };
  }

  return {
    templateId: tpl.id,
    templateKey: tpl.template_key,
    name: tpl.name,
    targetApp: tpl.target_app,
    eventType: tpl.event_type,
    title: renderContent(tpl.title, data),
    content: renderContent(tpl.content, data),
    status: tpl.status,
    isEnabled: true,
    rendered: true,
  };
}

/**
 * Trigger In-App Notification and persist in user_notifications table for target user
 */
async function triggerInAppNotification({ userId, targetApp = 'client', eventType = 'order_update', data = {} }) {
  if (!userId) return null;
  try {
    const rendered = await renderInAppTemplate(eventType, targetApp, data);
    if (!rendered || !rendered.isEnabled) {
      console.log(`[InAppMessageService] Skipping disabled or missing in-app template for event '${eventType}' and app '${targetApp}'`);
      return null;
    }

    const link = data.link || (data.orderId ? `/orders/${data.orderId}` : '/notifications');
    const [res] = await pool.query(
      `INSERT INTO user_notifications (user_id, title, message, link)
       VALUES (?, ?, ?, ?) RETURNING id`,
      [userId, rendered.title, rendered.content, link]
    );

    console.log(`[InAppMessageService] In-App Notification created for user ${userId} (Event: ${eventType}, App: ${targetApp})`);
    return {
      success: true,
      notificationId: res && res[0] ? res[0].id : (res && res.insertId ? res.insertId : null),
      title: rendered.title,
      content: rendered.content,
    };
  } catch (err) {
    console.error('[InAppMessageService] Error dispatching in-app notification:', err.message);
    return null;
  }
}

module.exports = {
  DEFAULT_INAPP_TEMPLATES,
  ensureTableAndDefaults,
  getAllTemplates,
  getTemplateById,
  getActiveTemplateForEvent,
  saveTemplate,
  deleteTemplate,
  toggleTemplateStatus,
  renderContent,
  renderInAppTemplate,
  triggerInAppNotification,
};
