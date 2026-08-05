const pool = require('../db');
const { firebaseMessaging, firebaseAdminStatus } = require('./firebaseAdminService');

let isTableInitialized = false;

// Ensure database table for scheduled push notifications exists
async function initPushNotificationTable() {
  if (isTableInitialized) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scheduled_push_notifications (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        image_url VARCHAR(500) DEFAULT NULL,
        action_url VARCHAR(500) DEFAULT NULL,
        target_audience VARCHAR(100) DEFAULT 'all',
        target_topic VARCHAR(255) DEFAULT NULL,
        send_now BOOLEAN DEFAULT TRUE,
        scheduled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'pending',
        sent_at TIMESTAMP DEFAULT NULL,
        total_sent INT DEFAULT 0,
        error_message TEXT DEFAULT NULL,
        created_by VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    isTableInitialized = true;
  } catch (err) {
    console.error('Error initializing scheduled_push_notifications table:', err);
  }
}

/**
 * Fetch list of all created and scheduled push notifications
 */
async function getPushNotifications(limit = 50) {
  await initPushNotificationTable();
  try {
    const [rows] = await pool.query(
      `SELECT * FROM scheduled_push_notifications ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return rows;
  } catch (err) {
    console.error('Error reading push notifications:', err);
    return [];
  }
}

/**
 * Create a new push notification (Send Now or Schedule)
 */
async function createPushNotification({
  title,
  message,
  imageUrl = '',
  actionUrl = '',
  targetAudience = 'all',
  sendNow = true,
  scheduledAt = null,
  createdBy = 'Admin',
}) {
  await initPushNotificationTable();
  if (!title || !title.trim()) throw new Error('Notification Title is required');
  if (!message || !message.trim()) throw new Error('Notification Message text is required');

  const status = sendNow ? 'pending' : 'scheduled';
  const scheduledTime = scheduledAt ? new Date(scheduledAt) : new Date();

  const [res] = await pool.query(
    `INSERT INTO scheduled_push_notifications
     (title, message, image_url, action_url, target_audience, send_now, scheduled_at, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    [
      title.trim(),
      message.trim(),
      imageUrl ? imageUrl.trim() : null,
      actionUrl ? actionUrl.trim() : null,
      targetAudience,
      sendNow ? true : false,
      scheduledTime,
      status,
      createdBy,
    ]
  );

  const inserted = res[0] || { id: res.insertId, title, message, targetAudience, status };

  // If sendNow is requested, dispatch immediately
  if (sendNow) {
    return dispatchNotification(inserted.id || res.insertId);
  }

  return inserted;
}

/**
 * Execute actual FCM push dispatch
 */
async function dispatchNotification(id) {
  await initPushNotificationTable();
  const [rows] = await pool.query(
    `SELECT * FROM scheduled_push_notifications WHERE id = ? LIMIT 1`,
    [id]
  );
  const notif = rows[0];
  if (!notif) throw new Error('Notification record not found');

  const messaging = firebaseMessaging();
  const topicMap = {
    all: 'all_users',
    clients: 'clients',
    vendors: 'vendors',
    delivery: 'delivery_partners',
  };
  const targetTopic = topicMap[notif.target_audience] || 'all_users';

  let sendResult = { success: false, totalSent: 0, message: '' };

  if (messaging) {
    try {
      const payload = {
        topic: targetTopic,
        notification: {
          title: notif.title,
          body: notif.message,
          ...(notif.image_url ? { imageUrl: notif.image_url } : {}),
        },
        data: {
          title: notif.title,
          body: notif.message,
          actionUrl: notif.action_url || '',
          targetAudience: notif.target_audience,
          timestamp: new Date().toISOString(),
        },
      };

      const response = await messaging.send(payload);
      console.log(`[Push Notification Dispatched] ID: ${id} | Topic: ${targetTopic} | FCM Response:`, response);

      sendResult = {
        success: true,
        totalSent: 1,
        message: `Successfully dispatched to FCM topic '${targetTopic}' (${response})`,
      };
    } catch (fcmErr) {
      console.error(`[Push Notification FCM Error] ID: ${id}:`, fcmErr);
      sendResult = {
        success: false,
        totalSent: 0,
        message: fcmErr.message || 'FCM dispatch failed',
      };
    }
  } else {
    // Firebase Admin SDK not configured - simulate dispatch record
    console.log(`[Push Notification Simulated] ID: ${id} | Topic: ${targetTopic} | Title: ${notif.title}`);
    sendResult = {
      success: true,
      totalSent: 1,
      message: `Simulated Push Notification broadcast to '${targetTopic}' (Firebase Admin SDK credentials not initialized).`,
    };
  }

  // Update record status in database
  const status = sendResult.success ? 'sent' : 'failed';
  await pool.query(
    `UPDATE scheduled_push_notifications
     SET status = ?, sent_at = CURRENT_TIMESTAMP, total_sent = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, sendResult.totalSent, sendResult.message, id]
  );

  return {
    id,
    status,
    message: sendResult.message,
  };
}

/**
 * Cancel a scheduled push notification
 */
async function cancelNotification(id) {
  await initPushNotificationTable();
  await pool.query(
    `UPDATE scheduled_push_notifications
     SET status = 'canceled', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'scheduled'`,
    [id]
  );
  return { success: true, message: 'Scheduled notification canceled successfully' };
}

/**
 * Background Scheduler Worker to process due scheduled notifications
 */
async function processDueScheduledNotifications() {
  try {
    await initPushNotificationTable();
    const [dueRows] = await pool.query(
      `SELECT id FROM scheduled_push_notifications
       WHERE status = 'scheduled' AND scheduled_at <= CURRENT_TIMESTAMP`
    );

    for (const row of dueRows) {
      console.log(`[Push Scheduler] Processing due notification ID: ${row.id}`);
      await dispatchNotification(row.id);
    }
  } catch (err) {
    console.error('Error in Push Notification Scheduler Worker:', err);
  }
}

// Run scheduler check every 30 seconds
setInterval(processDueScheduledNotifications, 30000);

module.exports = {
  getPushNotifications,
  createPushNotification,
  dispatchNotification,
  cancelNotification,
  processDueScheduledNotifications,
};
