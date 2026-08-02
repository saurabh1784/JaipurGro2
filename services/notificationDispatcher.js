const emailService = require('./emailService');
const messageService = require('./messageService');
const pushNotificationService = require('./pushNotificationService');
const notificationTemplateService = require('./notificationTemplateService');
const { firebaseMessaging } = require('./firebaseAdminService');
const pool = require('../db');

/**
 * Dispatch generated Delivery OTP to Customer via enabled Messaging Gateways,
 * with automatic fallback to Standalone Internal Delivery OTP mode if 3rd party messaging is OFF.
 */
async function dispatchDeliveryOtp({ orderId, phone, email, otpCode, customerName = 'Customer' }) {
  if (!orderId || !otpCode) return null;

  // If phone or email not provided, attempt to fetch from DB
  if (!phone || !email) {
    try {
      const [rows] = await pool.query(
        `SELECT o.shipping_phone, u.phone AS user_phone, u.email AS user_email, u.name AS user_name
         FROM client_orders o
         LEFT JOIN users u ON u.id = o.user_id
         WHERE o.id = ? LIMIT 1`,
        [orderId]
      );
      if (rows && rows[0]) {
        phone = phone || rows[0].shipping_phone || rows[0].user_phone || '';
        email = email || rows[0].user_email || '';
        customerName = customerName !== 'Customer' ? customerName : (rows[0].user_name || 'Customer');
      }
    } catch (err) {
      console.error('[Notification Engine] Error fetching order customer details:', err);
    }
  }

  const msgText = `Your Groxen Delivery OTP for Order #${orderId} is ${otpCode}. Share this OTP with the delivery partner upon arrival to complete your delivery. Do not share with anyone else.`;

  const results = { sms: null, whatsapp: null, msg91: null, email: null, standaloneInternalOtp: true };
  let thirdPartySentCount = 0;

  // 1. WhatsApp Channel Check & Dispatch
  try {
    const waSettings = await messageService.getWhatsAppSettings();
    if (waSettings.enabled && phone && phone.trim()) {
      const renderedWa = await notificationTemplateService.renderTemplate('whatsapp', 'order_status_wa', {
        userName: customerName,
        orderId,
        orderStatus: 'Out for Delivery',
        otpCode,
        riderName: 'Delivery Rider',
        riderPhone: 'Support',
      });
      if (renderedWa && renderedWa.isEnabled === false) {
        console.log(`[Notification Engine] Skipping disabled WhatsApp template 'order_status_wa' for Order #${orderId}`);
      } else {
        results.whatsapp = await messageService.sendTestWhatsAppMessage({
          phone: phone.trim(),
          messageText: renderedWa.content || msgText,
          templateName: waSettings.templateOtp || 'auth_otp_code',
        });
        thirdPartySentCount++;
        console.log(`[Notification Engine] WhatsApp Delivery OTP Dispatched for Order #${orderId}`);
      }
    }
  } catch (err) {
    console.error('[Notification Engine] WhatsApp Delivery OTP dispatch error:', err);
  }

  // 2. MSG91 DLT Channel Check & Dispatch
  try {
    const msg91Settings = await messageService.getMsg91Settings();
    if (msg91Settings.enabled && phone && phone.trim()) {
      const renderedSms = await notificationTemplateService.renderTemplate('sms', 'delivery_otp_sms', {
        orderId,
        otpCode,
        riderName: 'Delivery Rider',
        totalAmount: '0.00',
      });
      if (renderedSms && renderedSms.isEnabled === false) {
        console.log(`[Notification Engine] Skipping disabled SMS/MSG91 template 'delivery_otp_sms' for Order #${orderId}`);
      } else {
        results.msg91 = await messageService.sendTestMsg91Message({
          phone: phone.trim(),
          messageText: renderedSms.content || msgText,
          templateId: msg91Settings.templateOtp,
        });
        thirdPartySentCount++;
        console.log(`[Notification Engine] MSG91 Delivery OTP Dispatched for Order #${orderId}`);
      }
    }
  } catch (err) {
    console.error('[Notification Engine] MSG91 Delivery OTP dispatch error:', err);
  }

  // 3. SMS / Gateway Channel Check & Dispatch
  try {
    const smsSettings = await messageService.getMessageSettings();
    if (smsSettings.otpEnabled && smsSettings.triggers.delivery && phone && phone.trim()) {
      const renderedSms = await notificationTemplateService.renderTemplate('sms', 'delivery_otp_sms', {
        orderId,
        otpCode,
        riderName: 'Delivery Rider',
        totalAmount: '0.00',
      });
      if (renderedSms && renderedSms.isEnabled === false) {
        console.log(`[Notification Engine] Skipping disabled SMS template 'delivery_otp_sms' for Order #${orderId}`);
      } else {
        results.sms = await messageService.sendSmsOtp({
          phone: phone.trim(),
          eventType: 'delivery',
          customMessage: renderedSms.content || msgText,
        });
        thirdPartySentCount++;
        console.log(`[Notification Engine] SMS Delivery OTP Dispatched for Order #${orderId}`);
      }
    }
  } catch (err) {
    console.error('[Notification Engine] SMS Delivery OTP dispatch error:', err);
  }

  // 4. Email Notification
  if (email && email.trim()) {
    try {
      const renderedEmail = await notificationTemplateService.renderTemplate('email', 'delivery_status', {
        userName: customerName,
        orderId,
        deliveryStatus: 'Out for Delivery',
        otpCode,
        riderName: 'Delivery Partner',
        riderPhone: 'Support',
      });
      if (renderedEmail && renderedEmail.isEnabled === false) {
        console.log(`[Notification Engine] Skipping disabled Email template 'delivery_status' for Order #${orderId}`);
      } else {
        results.email = await emailService.sendMail({
          to: email.trim(),
          subject: renderedEmail.subject || `🚚 Delivery Verification OTP for Groxen Order #${orderId}: ${otpCode}`,
          text: renderedEmail.content,
          html: renderedEmail.content,
          triggerKey: 'userDeliveryStatus',
        });
        if (results.email && results.email.success) thirdPartySentCount++;
      }
    } catch (err) {
      console.error('[Notification Engine] Email Delivery OTP error:', err);
    }
  }

  if (thirdPartySentCount === 0) {
    console.log(`[Notification Engine] Standalone Mode: 3rd-party messaging services are OFF. Using internal delivery OTP (${otpCode}) for Order #${orderId}.`);
  }

  return results;
}

/**
 * Unified Dispatcher for Customer / User Events
 */
async function notifyUserEvent({ phone, email, name = 'Customer', eventType, data = {} }) {
  console.log(`[Notification Engine] Dispatching user event '${eventType}' to Phone: ${phone || 'N/A'}, Email: ${email || 'N/A'}`);

  const results = { email: null, sms: null, whatsapp: null, push: null };

  if (email && email.trim()) {
    try {
      const emailTriggerMap = {
        welcome: 'userWelcome',
        order_invoice: 'userOrderInvoice',
        order_status: 'userDeliveryStatus',
        password_reset: 'userPasswordReset',
      };
      const templateKeyMap = {
        welcome: 'user_welcome',
        order_invoice: 'order_invoice',
        order_status: 'delivery_status',
        password_reset: 'password_reset',
      };

      const triggerKey = emailTriggerMap[eventType] || null;
      const tplKey = templateKeyMap[eventType] || 'user_welcome';

      const renderedEmail = await notificationTemplateService.renderTemplate('email', tplKey, {
        userName: name,
        userEmail: email,
        storeName: 'Groxen',
        supportEmail: 'support@groxen.com',
        orderId: data.orderId || '',
        orderDate: new Date().toLocaleDateString('en-IN'),
        itemsTotal: data.itemsTotal || '0.00',
        deliveryFee: data.deliveryFee || '0.00',
        totalAmount: data.totalAmount || '0.00',
        deliveryAddress: data.deliveryAddress || 'N/A',
        deliveryStatus: data.status || 'Processing',
        otpCode: data.otpCode || '',
        riderName: data.riderName || 'Rider',
        riderPhone: data.riderPhone || '',
        resetCode: data.resetCode || '',
        resetLink: data.resetLink || '',
        otpExpiry: '5',
      });

      if (renderedEmail && renderedEmail.isEnabled === false) {
        console.log(`[Notification Engine] Skipping disabled Email template '${tplKey}' for event ${eventType}`);
      } else {
        results.email = await emailService.sendMail({
          to: email.trim(),
          subject: renderedEmail.subject || `Groxen Notification: ${eventType}`,
          text: renderedEmail.content,
          html: renderedEmail.content,
          triggerKey,
        });
      }
    } catch (err) {
      console.error('[Notification Engine] User Email dispatch error:', err);
    }
  }

  if (phone && phone.trim()) {
    try {
      const smsTriggerMap = {
        registration: 'registration',
        login: 'login',
        delivery_otp: 'delivery',
        password_reset: 'passwordReset',
        order_status: 'orderStatusUpdates',
      };
      const smsKeyMap = {
        registration: 'registration_otp_sms',
        login: 'login_otp_sms',
        delivery_otp: 'delivery_otp_sms',
        password_reset: 'password_reset_sms',
        order_status: 'order_update_sms',
      };

      const triggerType = smsTriggerMap[eventType] || 'order_status';
      const tplKey = smsKeyMap[eventType] || 'order_update_sms';

      const renderedSms = await notificationTemplateService.renderTemplate('sms', tplKey, {
        otpCode: data.otpCode || '',
        otpExpiry: '5',
        orderId: data.orderId || '',
        orderStatus: data.status || 'Updated',
        riderName: data.riderName || 'Delivery Rider',
        totalAmount: data.totalAmount || '0.00',
        amount: data.amount || '0.00',
      });

      if (renderedSms && renderedSms.isEnabled === false) {
        console.log(`[Notification Engine] Skipping disabled SMS template '${tplKey}' for event ${eventType}`);
      } else {
        results.sms = await messageService.sendSmsOtp({
          phone: phone.trim(),
          eventType: triggerType,
          customMessage: renderedSms.content || data.customMessage || `Groxen Update: ${eventType} notification.`,
        });
      }
    } catch (err) {
      console.error('[Notification Engine] User SMS dispatch error:', err);
    }

    try {
      const waSettings = await messageService.getWhatsAppSettings();
      if (waSettings.enabled) {
        const waKeyMap = {
          welcome: 'user_welcome_wa',
          order_status: 'order_status_wa',
          delivery_otp: 'auth_otp_wa',
          password_reset: 'auth_otp_wa',
        };
        const tplKey = waKeyMap[eventType] || 'order_status_wa';

        const renderedWa = await notificationTemplateService.renderTemplate('whatsapp', tplKey, {
          userName: name,
          orderId: data.orderId || '',
          orderStatus: data.status || 'Processing',
          totalAmount: data.totalAmount || '0.00',
          riderName: data.riderName || 'Delivery Partner',
          riderPhone: data.riderPhone || '',
          otpCode: data.otpCode || '',
          otpExpiry: '5',
          storeName: 'Groxen',
        });

        results.whatsapp = await messageService.sendTestWhatsAppMessage({
          phone: phone.trim(),
          messageText: renderedWa.content || data.customMessage || `Groxen Alert: ${eventType} for Order #${data.orderId || ''}`,
          templateName: eventType === 'delivery_otp' ? waSettings.templateOtp : waSettings.templateOrder,
        });
      }
    } catch (err) {
      console.error('[Notification Engine] User WhatsApp dispatch error:', err);
    }
  }

  return results;
}

/**
 * Unified Dispatcher for Vendor Events
 */
async function notifyVendorEvent({ vendorEmail, vendorPhone, vendorName = 'Vendor Partner', eventType, data = {} }) {
  console.log(`[Notification Engine] Dispatching vendor event '${eventType}' to Vendor: ${vendorName}`);

  const results = { email: null, sms: null, whatsapp: null, push: null };

  const templateData = {
    userName: vendorName,
    vendorName,
    storeName: data.storeName || 'Groxen Partner Store',
    orderId: data.orderId || '',
    totalAmount: data.totalAmount || '0.00',
    itemCount: data.itemCount || '1',
    loginUrl: data.loginUrl || 'https://groxen.in/vendor/login',
    supportEmail: 'support@groxen.in',
  };

  // 1. Vendor Email Dispatch via Dynamic Template Engine
  if (vendorEmail && vendorEmail.trim()) {
    try {
      const triggerKey = eventType === 'new_order' ? 'vendorNewOrder' : 'vendorApproval';
      const tplKey = eventType === 'new_order' ? 'vendor_new_order' : 'vendor_approval';

      const renderedEmail = await notificationTemplateService.renderTemplate('email', tplKey, templateData);

      results.email = await emailService.sendMail({
        to: vendorEmail.trim(),
        subject: renderedEmail.subject || (eventType === 'new_order' ? `⚡ New Order Received #${data.orderId || ''}` : `🎉 Vendor Account Approved`),
        text: renderedEmail.content,
        html: renderedEmail.content,
        triggerKey,
      });
    } catch (err) {
      console.error('[Notification Engine] Vendor Email error:', err);
    }
  }

  // 2. Vendor WhatsApp & SMS Dispatch via Dynamic Template Engine
  if (vendorPhone && vendorPhone.trim()) {
    try {
      const waSettings = await messageService.getWhatsAppSettings();
      if (waSettings.enabled) {
        const renderedWa = await notificationTemplateService.renderTemplate('whatsapp', 'vendor_order_alert_wa', templateData);
        results.whatsapp = await messageService.sendTestWhatsAppMessage({
          phone: vendorPhone.trim(),
          messageText: renderedWa.content,
          templateName: waSettings.templateOrder || 'vendor_order_alert_wa',
        });
      }
    } catch (err) {
      console.error('[Notification Engine] Vendor WhatsApp error:', err);
    }

    try {
      const renderedSms = await notificationTemplateService.renderTemplate('sms', 'order_update_sms', {
        orderId: data.orderId || '',
        orderStatus: eventType === 'new_order' ? 'New Order Received' : 'Account Approved',
      });
      results.sms = await messageService.sendSmsOtp({
        phone: vendorPhone.trim(),
        eventType: 'vendor_acceptance',
        customMessage: renderedSms.content || `Groxen Vendor Alert: New order #${data.orderId || ''} received.`,
      });
    } catch (err) {
      console.error('[Notification Engine] Vendor SMS error:', err);
    }
  }

  // 3. Push Notification
  try {
    const messaging = firebaseMessaging();
    if (messaging) {
      const pushRes = await messaging.send({
        topic: 'vendors',
        notification: {
          title: `🏪 New Order #${data.orderId || ''} Alert!`,
          body: `New order placed for ₹${data.totalAmount || '0.00'}. Open vendor panel to accept.`,
        },
        data: {
          orderId: String(data.orderId || ''),
          eventType: 'new_order',
        },
      });
      results.push = { success: true, response: pushRes };
    }
  } catch (err) {
    console.error('[Notification Engine] Vendor FCM Push error:', err);
  }

  return results;
}

/**
 * Unified Dispatcher for Delivery Partner / Rider Events
 */
async function notifyDeliveryEvent({ riderEmail, riderPhone, riderName = 'Rider', eventType, data = {} }) {
  console.log(`[Notification Engine] Dispatching delivery event '${eventType}' to Rider: ${riderName}`);

  const results = { email: null, sms: null, whatsapp: null, push: null };

  const templateData = {
    userName: riderName,
    userEmail: riderEmail,
    riderName,
    riderPhone: riderPhone || '',
    orderId: data.orderId || '',
    deliveryStatus: eventType === 'assignment' ? 'Job Assigned' : 'Account Approved',
    otpCode: data.otpCode || '',
    totalAmount: data.totalAmount || '0.00',
    storeName: 'Groxen',
    supportEmail: 'support@groxen.in',
  };

  // 1. Delivery Email Dispatch via Dynamic Template Engine
  if (riderEmail && riderEmail.trim()) {
    try {
      const triggerKey = eventType === 'assignment' ? 'deliveryAssignment' : 'deliveryApproval';
      const tplKey = eventType === 'assignment' ? 'delivery_status' : 'user_welcome';

      const renderedEmail = await notificationTemplateService.renderTemplate('email', tplKey, templateData);

      results.email = await emailService.sendMail({
        to: riderEmail.trim(),
        subject: renderedEmail.subject || (eventType === 'assignment' ? `📍 Delivery Job Assigned - Order #${data.orderId || ''}` : `🛡️ Delivery Partner Account Activated`),
        text: renderedEmail.content,
        html: renderedEmail.content,
        triggerKey,
      });
    } catch (err) {
      console.error('[Notification Engine] Rider Email error:', err);
    }
  }

  // 2. Delivery WhatsApp & SMS Dispatch via Dynamic Template Engine
  if (riderPhone && riderPhone.trim()) {
    try {
      const waSettings = await messageService.getWhatsAppSettings();
      if (waSettings.enabled) {
        const renderedWa = await notificationTemplateService.renderTemplate('whatsapp', 'order_status_wa', templateData);
        results.whatsapp = await messageService.sendTestWhatsAppMessage({
          phone: riderPhone.trim(),
          messageText: renderedWa.content,
          templateName: waSettings.templateOrder || 'order_status_update',
        });
      }
    } catch (err) {
      console.error('[Notification Engine] Rider WhatsApp error:', err);
    }

    try {
      const renderedSms = await notificationTemplateService.renderTemplate('sms', 'delivery_otp_sms', {
        orderId: data.orderId || '',
        otpCode: data.otpCode || 'N/A',
        riderName,
        totalAmount: data.totalAmount || '0.00',
      });
      results.sms = await messageService.sendSmsOtp({
        phone: riderPhone.trim(),
        eventType: 'delivery',
        customMessage: renderedSms.content,
      });
    } catch (err) {
      console.error('[Notification Engine] Rider SMS error:', err);
    }
  }

  // 3. Rider Push Notification
  try {
    const messaging = firebaseMessaging();
    if (messaging) {
      const pushRes = await messaging.send({
        topic: 'delivery_partners',
        notification: {
          title: `🛵 New Delivery Assignment: Order #${data.orderId || ''}`,
          body: `Pickup order #${data.orderId || ''} for delivery. Earn ₹${data.deliveryFee || '0.00'}.`,
        },
        data: {
          orderId: String(data.orderId || ''),
          eventType: 'job_assigned',
        },
      });
      results.push = { success: true, response: pushRes };
    }
  } catch (err) {
    console.error('[Notification Engine] Rider FCM Push error:', err);
  }

  return results;
}

module.exports = {
  dispatchDeliveryOtp,
  notifyUserEvent,
  notifyVendorEvent,
  notifyDeliveryEvent,
};
