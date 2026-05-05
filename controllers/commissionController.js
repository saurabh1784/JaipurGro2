const CommissionSetting = require('../models/CommissionSetting');

async function list(req, res) {
  try {
    const settings = await CommissionSetting.list();
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Commission settings list error:', error);
    res.status(500).json({ success: false, message: 'Unable to load commission settings' });
  }
}

async function update(req, res) {
  const settings = Array.isArray(req.body.settings) ? req.body.settings : [];
  if (settings.length === 0) {
    return res.status(422).json({ success: false, message: 'No commission settings were provided' });
  }

  try {
    const updatedSettings = await CommissionSetting.updateMany(settings);
    res.json({ success: true, message: 'Commission settings updated successfully', settings: updatedSettings });
  } catch (error) {
    console.error('Commission settings update error:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to update commission settings',
    });
  }
}

function calculate(req, res) {
  const setting = {
    is_active: true,
    commission_type: req.body.commission_type,
    commission_value: req.body.commission_value,
    min_commission: req.body.min_commission,
    max_commission: req.body.max_commission,
  };
  const amount = Number(req.body.amount);
  const commission = CommissionSetting.calculateAmount(setting, amount);
  res.json({
    success: true,
    amount,
    commission,
    net_amount: Number(Math.max(amount - commission, 0).toFixed(2)),
  });
}

module.exports = { list, update, calculate };
