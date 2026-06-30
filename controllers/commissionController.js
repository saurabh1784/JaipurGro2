const CommissionSetting = require('../models/CommissionSetting');

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
    const settings = await CommissionSetting.list();
    res.json({ success: true, ...responsePayload(settings) });
  } catch (error) {
    console.error('Commission settings list error:', error);
    res.status(500).json({ success: false, message: 'Unable to load commission settings' });
  }
}

async function update(req, res) {
  try {
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

module.exports = { list, update, calculate };
