const clients = new Map();

function clientSet(vendorId) {
  const key = String(vendorId);
  if (!clients.has(key)) {
    clients.set(key, new Set());
  }
  return clients.get(key);
}

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

function subscribe(vendorId, res) {
  const set = clientSet(vendorId);
  set.add(res);
  writeSse(res, 'connected', { vendorId: Number(vendorId), at: new Date().toISOString() });

  const cleanup = () => {
    clearInterval(heartbeat);
    set.delete(res);
    if (set.size === 0) {
      clients.delete(String(vendorId));
    }
  };

  const heartbeat = setInterval(() => {
    if (!writeSse(res, 'heartbeat', { at: new Date().toISOString() })) {
      cleanup();
    }
  }, 25000);

  return cleanup;
}

function notifyVendor(vendorId, payload) {
  const set = clients.get(String(vendorId));
  if (!set || set.size === 0) {
    return;
  }

  const event = {
    id: `${payload.type || 'event'}-${payload.id || Date.now()}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...payload,
  };

  for (const res of [...set]) {
    if (!writeSse(res, 'vendor-notification', event)) {
      set.delete(res);
    }
  }
}

function notifyVendors(vendorIds, payloadFactory) {
  for (const vendorId of vendorIds) {
    notifyVendor(vendorId, typeof payloadFactory === 'function' ? payloadFactory(vendorId) : payloadFactory);
  }
}

module.exports = {
  subscribe,
  notifyVendor,
  notifyVendors,
};
