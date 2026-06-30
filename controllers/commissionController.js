const CommissionSetting = require('../models/CommissionSetting');
const LocationCommissionSetting = require('../models/LocationCommissionSetting');

function responsePayload(settings) {
  const rows = Array.isArray(settings) ? settings : [];
  const byKey = new Map(rows.map((item) => [item.key, item]));
  const order = byKey.get(CommissionSetting.commissionKinds.order.key);
  const delivery = byKey.get(CommissionSetting.commissionKinds.delivery.key);
  return {
    settings: rows,
    order_commission_percentage: order ? order.percentage : 0,
    delivery_commission_percentage: delivery ? delivery.percentage : 0,
  };
}

async function list(req, res) {
  try {
    const [settings, locationSettings] = await Promise.all([
      CommissionSetting.list(),
      LocationCommissionSetting.listPayload(),
    ]);
    res.json({ success: true, ...responsePayload(settings), location_commissions: locationSettings });
  } catch (error) {
    console.error('Commission settings list error:', error);
    res.status(500).json({ success: false, message: 'Unable to load commission settings' });
  }
}

async function update(req, res) {
  try {
    if (Array.isArray(req.body.location_commissions)) {
      const locationSettings = await LocationCommissionSetting.saveMany(req.body.location_commissions);
      return res.json({
        success: true,
        message: 'Location commission settings updated successfully',
        location_commissions: locationSettings,
      });
    }

    const updatedSettings = await CommissionSetting.update({
      order_commission_percentage: req.body.order_commission_percentage,
      delivery_commission_percentage: req.body.delivery_commission_percentage,
    });
    res.json({
      success: true,
      message: 'Commission settings updated successfully',
      ...responsePayload(updatedSettings),
    });
  } catch (error) {
    console.error('Commission settings update error:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to update commission settings',
    });
  }
}

async function removeLocation(req, res) {
  try {
    await LocationCommissionSetting.remove(req.params.id);
    res.json({
      success: true,
      message: 'Location commission setting removed',
      location_commissions: await LocationCommissionSetting.listPayload(),
    });
  } catch (error) {
    console.error('Location commission delete error:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to remove location commission setting',
    });
  }
}

function calculate(req, res) {
  const orderAmount = Number(req.body.order_amount || req.body.amount || 0);
  const deliveryCharge = Number(req.body.delivery_charge || 0);
  const orderPercentage = Number(req.body.order_commission_percentage || 0);
  const deliveryPercentage = Number(req.body.delivery_commission_percentage || 0);
  const orderCommission = CommissionSetting.calculatePercentageAmount(orderPercentage, orderAmount);
  const deliveryCommission = CommissionSetting.calculatePercentageAmount(deliveryPercentage, deliveryCharge);
  res.json({
    success: true,
    order_amount: orderAmount,
    delivery_charge: deliveryCharge,
    order_commission: orderCommission,
    delivery_commission: deliveryCommission,
    delivery_partner_earning: Number(Math.max(deliveryCharge - deliveryCommission, 0).toFixed(2)),
    platform_earning: Number((orderCommission + deliveryCommission).toFixed(2)),
  });
}

module.exports = { list, update, calculate, removeLocation };
