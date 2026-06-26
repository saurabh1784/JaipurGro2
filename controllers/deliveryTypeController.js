const DeliveryType = require('../models/DeliveryType');

function canManage(user) {
  return ['superadmin', 'admin', 'manager', 'staff'].includes(String(user && user.role || '').toLowerCase());
}

function requireManage(req, res) {
  const user = req.authUser || req.session?.user;
  if (!canManage(user)) {
    res.status(403).json({ success: false, message: 'Delivery type management access required' });
    return false;
  }
  return true;
}

async function options(req, res) {
  try {
    const result = await DeliveryType.availableForLocation({
      city: req.query.city,
      area: req.query.area || req.query.pincode,
      latitude: req.query.latitude || req.query.lat,
      longitude: req.query.longitude || req.query.lng,
      vendorId: req.query.vendor_id || req.query.vendorId,
      requestedType: req.query.delivery_type || req.query.deliveryType || req.query.delivery_method,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to load delivery types' });
  }
}

async function settings(req, res) {
  if (!requireManage(req, res)) return;
  try {
    return res.json({
      success: true,
      types: DeliveryType.TYPES,
      settings: await DeliveryType.listSettings({ city: req.query.city, area: req.query.area }),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to load delivery type settings' });
  }
}

async function save(req, res) {
  if (!requireManage(req, res)) return;
  try {
    await DeliveryType.saveSetting(req.body);
    return res.json({
      success: true,
      message: 'Delivery type setting saved',
      settings: await DeliveryType.listSettings({ city: req.body.city, area: req.body.area }),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to save delivery type setting' });
  }
}

async function saveArea(req, res) {
  if (!requireManage(req, res)) return;
  try {
    await DeliveryType.saveAreaTypes(req.body);
    return res.json({
      success: true,
      message: 'Area delivery types saved',
      settings: await DeliveryType.listSettings({ city: req.body.city, area: req.body.area }),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to save area delivery types' });
  }
}

async function remove(req, res) {
  if (!requireManage(req, res)) return;
  try {
    const city = req.body.city || req.query.city;
    const area = req.body.area || req.query.area || '*';
    const deliveryType = req.body.delivery_type || req.body.deliveryType || req.query.delivery_type || req.query.deliveryType;
    const removed = await DeliveryType.removeSetting({ city, area, delivery_type: deliveryType });
    return res.json({
      success: true,
      message: removed ? 'Delivery type removed' : 'Delivery type setting was already removed',
      removed,
      settings: await DeliveryType.listSettings({ city, area }),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to remove delivery type setting' });
  }
}

async function removeArea(req, res) {
  if (!requireManage(req, res)) return;
  try {
    const city = req.body.city || req.query.city;
    const area = req.body.area || req.query.area || '*';
    const removed = await DeliveryType.removeAreaSettings({ city, area });
    return res.json({
      success: true,
      message: removed ? 'City/area delivery type settings removed' : 'No delivery type settings found for this city/area',
      removed,
      settings: await DeliveryType.listSettings(),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to remove city/area delivery type settings' });
  }
}

module.exports = {
  options,
  remove,
  removeArea,
  save,
  saveArea,
  settings,
};
