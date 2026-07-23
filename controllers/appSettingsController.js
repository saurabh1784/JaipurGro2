const pool = require('../db');

async function settingValue(key, fallback = '') {
  try {
    const [rows] = await pool.query(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
      [key]
    );
    return rows[0] && rows[0].setting_value != null ? String(rows[0].setting_value) : fallback;
  } catch (err) {
    console.error(`Error reading setting ${key}:`, err);
    return fallback;
  }
}

async function saveSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (setting_key, setting_value, is_secret)
     VALUES (?, ?, 0)
     ON CONFLICT (setting_key) DO UPDATE
     SET setting_value = EXCLUDED.setting_value,
         is_secret = 0,
         updated_at = CURRENT_TIMESTAMP`,
    [key, value || '']
  );
}

function resolveFullUrl(req, relativeOrAbsoluteUrl) {
  if (!relativeOrAbsoluteUrl) return '';
  if (relativeOrAbsoluteUrl.startsWith('http://') || relativeOrAbsoluteUrl.startsWith('https://')) {
    return relativeOrAbsoluteUrl;
  }
  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  const cleanPath = relativeOrAbsoluteUrl.startsWith('/') ? relativeOrAbsoluteUrl : `/${relativeOrAbsoluteUrl}`;
  return `${protocol}://${host}${cleanPath}`;
}

const renderAppSettings = async (req, res) => {
  try {
    const clientLogo = await settingValue('client_app_logo', '/assets/images/GroLogo.png');
    const vendorLogo = await settingValue('vendor_app_logo', '/assets/images/GroLogo.png');
    const deliveryLogo = await settingValue('delivery_app_logo', '/assets/images/GroLogo.png');
    const appName = await settingValue('app_name', 'JaipurGro');

    const shell = req.shell || {
      roleTitle: req.user ? req.user.role : 'Admin',
      themeMode: 'light',
      navItems: [],
    };

    res.render('app-settings', {
      title: 'App Settings - Logo Management',
      shell,
      settings: {
        clientAppLogo: clientLogo,
        vendorAppLogo: vendorLogo,
        deliveryAppLogo: deliveryLogo,
        appName,
      },
      message: req.query.msg || null,
      error: req.query.err || null,
    });
  } catch (error) {
    console.error('Error loading App Settings page:', error);
    res.status(500).send('Error loading App Settings');
  }
};

const updateAppLogos = async (req, res) => {
  try {
    const files = req.files || {};
    const body = req.body || {};

    if (files.client_app_logo && files.client_app_logo[0]) {
      const clientLogoPath = `/uploads/app_settings/${files.client_app_logo[0].filename}`;
      await saveSetting('client_app_logo', clientLogoPath);
    } else if (body.client_app_logo_url && body.client_app_logo_url.trim()) {
      await saveSetting('client_app_logo', body.client_app_logo_url.trim());
    }

    if (files.vendor_app_logo && files.vendor_app_logo[0]) {
      const vendorLogoPath = `/uploads/app_settings/${files.vendor_app_logo[0].filename}`;
      await saveSetting('vendor_app_logo', vendorLogoPath);
    } else if (body.vendor_app_logo_url && body.vendor_app_logo_url.trim()) {
      await saveSetting('vendor_app_logo', body.vendor_app_logo_url.trim());
    }

    if (files.delivery_app_logo && files.delivery_app_logo[0]) {
      const deliveryLogoPath = `/uploads/app_settings/${files.delivery_app_logo[0].filename}`;
      await saveSetting('delivery_app_logo', deliveryLogoPath);
    } else if (body.delivery_app_logo_url && body.delivery_app_logo_url.trim()) {
      await saveSetting('delivery_app_logo', body.delivery_app_logo_url.trim());
    }

    if (body.app_name && body.app_name.trim()) {
      await saveSetting('app_name', body.app_name.trim());
    }

    if (req.accepts('html')) {
      return res.redirect('/app-settings?msg=App+logos+updated+successfully');
    }
    return res.json({ success: true, message: 'App logos updated successfully' });
  } catch (error) {
    console.error('Error updating app logos:', error);
    if (req.accepts('html')) {
      return res.redirect(`/app-settings?err=${encodeURIComponent(error.message)}`);
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getPublicAppLogos = async (req, res) => {
  try {
    const clientLogoRel = await settingValue('client_app_logo', '');
    const vendorLogoRel = await settingValue('vendor_app_logo', '');
    const deliveryLogoRel = await settingValue('delivery_app_logo', '');
    const appName = await settingValue('app_name', 'JaipurGro');

    return res.json({
      success: true,
      appName,
      logos: {
        clientAppLogo: clientLogoRel ? resolveFullUrl(req, clientLogoRel) : '',
        vendorAppLogo: vendorLogoRel ? resolveFullUrl(req, vendorLogoRel) : '',
        deliveryAppLogo: deliveryLogoRel ? resolveFullUrl(req, deliveryLogoRel) : '',
        rawPaths: {
          clientAppLogo: clientLogoRel,
          vendorAppLogo: vendorLogoRel,
          deliveryAppLogo: deliveryLogoRel,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching public app logos:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve app logos' });
  }
};

module.exports = {
  renderAppSettings,
  updateAppLogos,
  getPublicAppLogos,
};
