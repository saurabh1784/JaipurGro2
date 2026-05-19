const clients = new Map();

function clientSet(vendorId) {
  const key = String(vendorId);
  if (!clients.has(key)) {
    clients.set(key, new Set());
  }
  return clients.get(key);
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function subscribe(vendorId, res) {
  const set = clientSet(vendorId);
  set.add(res);
  writeSse(res, 'connected', { vendorId: Number(vendorId), at: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    if (!res.destroyed) {
      writeSse(res, 'heartbeat', { at: new Date().toISOString() });
    }
  }, 25000);

  return () => {
    clearInterval(heartbeat);
    set.delete(res);
    if (set.size === 0) {
      clients.delete(String(vendorId));
    }
  };
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
    if (res.destroyed) {
      set.delete(res);
      continue;
    }
    writeSse(res, 'vendor-notification', event);
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
