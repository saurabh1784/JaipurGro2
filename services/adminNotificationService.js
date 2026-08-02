const pool = require('../db');

// In-memory collection of connected Admin SSE client responses
const adminClients = new Set();
// Recent events cache (for polling fallback)
const recentEvents = [];
const MAX_RECENT_EVENTS = 50;

function writeSse(res, event, payload) {
  if (res.destroyed || res.writableEnded) {
    return false;
  }
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (typeof res.flush === 'function') {
      res.flush();
    }
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Subscribe an Admin SSE Response Connection
 */
function subscribeAdmin(res) {
  adminClients.add(res);
  writeSse(res, 'connected', { at: new Date().toISOString(), totalClients: adminClients.size });

  const cleanup = () => {
    clearInterval(heartbeat);
    adminClients.delete(res);
  };

  const heartbeat = setInterval(() => {
    if (!writeSse(res, 'heartbeat', { at: new Date().toISOString() })) {
      cleanup();
    }
  }, 25000);

  return cleanup;
}

/**
 * Broadcast an Admin Real-Time Event Notification
 *
 * Types supported:
 *  - 'new_vendor_register' (Purple)
 *  - 'new_client_register' (Green)
 *  - 'new_delivery_partner_register' (Amber)
 *  - 'new_quotation_raised' (Blue)
 *  - 'new_order' (Rose/Red)
 *  - 'wallet_activity' (Teal)
 */
function notifyAdmin({ type = 'new_order', title, message, link = '#', data = {} }) {
  const eventPayload = {
    id: `admin-notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    type,
    title: title || 'Admin Alert',
    message: message || '',
    link,
    data,
    timestamp: Date.now(),
    createdAt: new Date().toISOString(),
  };

  // Cache in recent events for polling fallback
  recentEvents.unshift(eventPayload);
  if (recentEvents.length > MAX_RECENT_EVENTS) {
    recentEvents.pop();
  }

  console.log(`[Admin Live Notification] [${type.toUpperCase()}] ${eventPayload.title}: ${eventPayload.message}`);

  // Broadcast to all active admin SSE connections
  for (const res of [...adminClients]) {
    if (!writeSse(res, 'admin-notification', eventPayload)) {
      adminClients.delete(res);
    }
  }

  return eventPayload;
}

/**
 * Get recent events after a given timestamp (for polling fallback)
 */
function getRecentEvents(sinceTimestamp = 0) {
  const since = Number(sinceTimestamp) || 0;
  return recentEvents.filter((ev) => ev.timestamp > since);
}

module.exports = {
  subscribeAdmin,
  notifyAdmin,
  getRecentEvents,
};
