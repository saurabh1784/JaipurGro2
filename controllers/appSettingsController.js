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

function fallbackShell(user, activePath = '/app-settings') {
  const roleTitle = (user && (user.roleName || user.role)) || 'Superadmin';
  const themeMode = (user && (user.themeMode || user.theme_mode)) || 'light';
  return {
    roleTitle,
    themeMode,
    navItems: [
      { label: 'Dashboard', href: '/dashboard', icon: 'dashboard', active: false },
      { label: 'Users', href: '/users', icon: 'users', active: false },
      { label: 'Roles', href: '/roles', icon: 'roles', active: false },
      { label: 'Clients', href: '/clients', icon: 'clients', active: false },
      { label: 'Vendors', href: '/vendors', icon: 'vendors', active: false },
      { label: 'Products', href: '/products', icon: 'products', active: false },
      { label: 'Wallets', href: '/wallets', icon: 'wallets', active: false },
      { label: 'Orders', href: '/orders/admin/dashboard', icon: 'orders', active: false },
      { label: 'Delivery Dashboard', href: '/delivery-dashboard', icon: 'delivery', active: false },
      { label: 'Support', href: '/support', icon: 'support', active: false },
      { label: 'Discounts', href: '/discounts', icon: 'discounts', active: false },
      { label: 'Advertisements', href: '/advertisements', icon: 'discounts', active: false },
      { label: 'App Settings', href: '/app-settings', icon: 'settings', active: true },
      { label: 'Reports', href: '#', icon: 'reports', active: false },
      { label: 'Settings', href: '/settings', icon: 'settings', active: false },
    ],
  };
}

async function initSocialProfileTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_profiles (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        platform_name VARCHAR(100) NOT NULL,
        icon_name VARCHAR(50) DEFAULT NULL,
        icon_image TEXT DEFAULT NULL,
        profile_link TEXT NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        display_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (err) {
    console.error('Error initializing social_profiles table:', err);
  }
}

// Call table init
initSocialProfileTable();

const renderAppSettings = async (req, res) => {
  try {
    const clientLogo = await settingValue('client_app_logo', '/assets/images/GroLogo.png');
    const vendorLogo = await settingValue('vendor_app_logo', '/assets/images/GroLogo.png');
    const deliveryLogo = await settingValue('delivery_app_logo', '/assets/images/GroLogo.png');
    const appName = await settingValue('app_name', 'Groxen Dashboard');

    const clientPlayStore = await settingValue('client_app_playstore_url', '');
    const clientAppStore = await settingValue('client_app_appstore_url', '');

    const vendorPlayStore = await settingValue('vendor_app_playstore_url', '');
    const vendorAppStore = await settingValue('vendor_app_appstore_url', '');

    const deliveryPlayStore = await settingValue('delivery_app_playstore_url', '');
    const deliveryAppStore = await settingValue('delivery_app_appstore_url', '');

    // Client update settings
    const clientLatestVersion = await settingValue('client_latest_version', '1.0.0');
    const clientMinVersion = await settingValue('client_min_version', '1.0.0');
    const clientForceUpdate = await settingValue('client_force_update', 'false');
    const clientUpdateTitle = await settingValue('client_update_title', 'Update Available');
    const clientUpdateMessage = await settingValue('client_update_message', 'A new version of the Client App is available. Please update to continue using the app.');

    // Vendor update settings
    const vendorLatestVersion = await settingValue('vendor_latest_version', '1.0.0');
    const vendorMinVersion = await settingValue('vendor_min_version', '1.0.0');
    const vendorForceUpdate = await settingValue('vendor_force_update', 'false');
    const vendorUpdateTitle = await settingValue('vendor_update_title', 'Update Available');
    const vendorUpdateMessage = await settingValue('vendor_update_message', 'A new version of the Vendor App is available. Please update to continue using the app.');

    // Delivery update settings
    const deliveryLatestVersion = await settingValue('delivery_latest_version', '1.0.0');
    const deliveryMinVersion = await settingValue('delivery_min_version', '1.0.0');
    const deliveryForceUpdate = await settingValue('delivery_force_update', 'false');
    const deliveryUpdateTitle = await settingValue('delivery_update_title', 'Update Available');
    const deliveryUpdateMessage = await settingValue('delivery_update_message', 'A new version of the Delivery App is available. Please update to continue using the app.');

    // Social Profiles list
    let socialProfiles = [];
    try {
      const [rows] = await pool.query('SELECT * FROM social_profiles ORDER BY display_order ASC, id ASC');
      socialProfiles = rows || [];
    } catch (_) {}

    const sessionUser = (req.session && req.session.user) || req.user || req.authUser;
    const shell = req.shell && req.shell.navItems && req.shell.navItems.length
      ? req.shell
      : fallbackShell(sessionUser, req.path || '/app-settings');

    res.render('app-settings', {
      title: 'App Settings - Logos, Stores, Updates & Social Profiles',
      shell,
      settings: {
        clientAppLogo: clientLogo,
        vendorAppLogo: vendorLogo,
        deliveryAppLogo: deliveryLogo,
        appName,
        clientPlayStore,
        clientAppStore,
        vendorPlayStore,
        vendorAppStore,
        deliveryPlayStore,
        deliveryAppStore,

        clientLatestVersion,
        clientMinVersion,
        clientForceUpdate: clientForceUpdate === 'true' || clientForceUpdate === '1',
        clientUpdateTitle,
        clientUpdateMessage,

        vendorLatestVersion,
        vendorMinVersion,
        vendorForceUpdate: vendorForceUpdate === 'true' || vendorForceUpdate === '1',
        vendorUpdateTitle,
        vendorUpdateMessage,

        deliveryLatestVersion,
        deliveryMinVersion,
        deliveryForceUpdate: deliveryForceUpdate === 'true' || deliveryForceUpdate === '1',
        deliveryUpdateTitle,
        deliveryUpdateMessage,
      },
      socialProfiles,
      message: req.query.msg || null,
      error: req.query.err || null,
    });
  } catch (error) {
    console.error('Error rendering app settings:', error);
    res.status(500).send('Unable to load App Settings page');
  }
};

const updateAppLogos = async (req, res) => {
  try {
    const files = req.files || {};
    const body = req.body || {};

    // Client App Logo, Links & Update Settings
    if (files.client_app_logo && files.client_app_logo[0]) {
      const clientLogoPath = `/uploads/app_settings/${files.client_app_logo[0].filename}`;
      await saveSetting('client_app_logo', clientLogoPath);
    } else if (body.client_app_logo_url && body.client_app_logo_url.trim()) {
      await saveSetting('client_app_logo', body.client_app_logo_url.trim());
    }
    if (body.client_app_playstore_url !== undefined) {
      await saveSetting('client_app_playstore_url', body.client_app_playstore_url.trim());
    }
    if (body.client_app_appstore_url !== undefined) {
      await saveSetting('client_app_appstore_url', body.client_app_appstore_url.trim());
    }
    if (body.client_latest_version !== undefined) {
      await saveSetting('client_latest_version', body.client_latest_version.trim());
    }
    if (body.client_min_version !== undefined) {
      await saveSetting('client_min_version', body.client_min_version.trim());
    }
    await saveSetting('client_force_update', body.client_force_update === 'on' || body.client_force_update === 'true' ? 'true' : 'false');
    if (body.client_update_title !== undefined) {
      await saveSetting('client_update_title', body.client_update_title.trim());
    }
    if (body.client_update_message !== undefined) {
      await saveSetting('client_update_message', body.client_update_message.trim());
    }

    // Vendor App Logo, Links & Update Settings
    if (files.vendor_app_logo && files.vendor_app_logo[0]) {
      const vendorLogoPath = `/uploads/app_settings/${files.vendor_app_logo[0].filename}`;
      await saveSetting('vendor_app_logo', vendorLogoPath);
    } else if (body.vendor_app_logo_url && body.vendor_app_logo_url.trim()) {
      await saveSetting('vendor_app_logo', body.vendor_app_logo_url.trim());
    }
    if (body.vendor_app_playstore_url !== undefined) {
      await saveSetting('vendor_app_playstore_url', body.vendor_app_playstore_url.trim());
    }
    if (body.vendor_app_appstore_url !== undefined) {
      await saveSetting('vendor_app_appstore_url', body.vendor_app_appstore_url.trim());
    }
    if (body.vendor_latest_version !== undefined) {
      await saveSetting('vendor_latest_version', body.vendor_latest_version.trim());
    }
    if (body.vendor_min_version !== undefined) {
      await saveSetting('vendor_min_version', body.vendor_min_version.trim());
    }
    await saveSetting('vendor_force_update', body.vendor_force_update === 'on' || body.vendor_force_update === 'true' ? 'true' : 'false');
    if (body.vendor_update_title !== undefined) {
      await saveSetting('vendor_update_title', body.vendor_update_title.trim());
    }
    if (body.vendor_update_message !== undefined) {
      await saveSetting('vendor_update_message', body.vendor_update_message.trim());
    }

    // Delivery App Logo, Links & Update Settings
    if (files.delivery_app_logo && files.delivery_app_logo[0]) {
      const deliveryLogoPath = `/uploads/app_settings/${files.delivery_app_logo[0].filename}`;
      await saveSetting('delivery_app_logo', deliveryLogoPath);
    } else if (body.delivery_app_logo_url && body.delivery_app_logo_url.trim()) {
      await saveSetting('delivery_app_logo', body.delivery_app_logo_url.trim());
    }
    if (body.delivery_app_playstore_url !== undefined) {
      await saveSetting('delivery_app_playstore_url', body.delivery_app_playstore_url.trim());
    }
    if (body.delivery_app_appstore_url !== undefined) {
      await saveSetting('delivery_app_appstore_url', body.delivery_app_appstore_url.trim());
    }
    if (body.delivery_latest_version !== undefined) {
      await saveSetting('delivery_latest_version', body.delivery_latest_version.trim());
    }
    if (body.delivery_min_version !== undefined) {
      await saveSetting('delivery_min_version', body.delivery_min_version.trim());
    }
    await saveSetting('delivery_force_update', body.delivery_force_update === 'on' || body.delivery_force_update === 'true' ? 'true' : 'false');
    if (body.delivery_update_title !== undefined) {
      await saveSetting('delivery_update_title', body.delivery_update_title.trim());
    }
    if (body.delivery_update_message !== undefined) {
      await saveSetting('delivery_update_message', body.delivery_update_message.trim());
    }

    if (body.app_name && body.app_name.trim()) {
      await saveSetting('app_name', body.app_name.trim());
    }

    if (req.accepts('html')) {
      return res.redirect('/app-settings?msg=App+settings+updated+successfully');
    }
    return res.json({ success: true, message: 'App settings updated successfully' });
  } catch (error) {
    console.error('Error updating app settings:', error);
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
    const appName = await settingValue('app_name', 'Groxen Dashboard');

    const clientPlayStore = await settingValue('client_app_playstore_url', '');
    const clientAppStore = await settingValue('client_app_appstore_url', '');

    const vendorPlayStore = await settingValue('vendor_app_playstore_url', '');
    const vendorAppStore = await settingValue('vendor_app_appstore_url', '');

    const deliveryPlayStore = await settingValue('delivery_app_playstore_url', '');
    const deliveryAppStore = await settingValue('delivery_app_appstore_url', '');

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
      appLinks: {
        clientApp: {
          playStore: clientPlayStore,
          appStore: clientAppStore,
        },
        vendorApp: {
          playStore: vendorPlayStore,
          appStore: vendorAppStore,
        },
        deliveryApp: {
          playStore: deliveryPlayStore,
          appStore: deliveryAppStore,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching public app logos and links:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve app settings' });
  }
};

const getAppUpdateConfig = async (req, res) => {
  try {
    const appQuery = (req.query.app || 'client').toLowerCase();
    const prefix = appQuery === 'vendor' ? 'vendor' : appQuery === 'delivery' ? 'delivery' : 'client';

    const latestVersion = await settingValue(`${prefix}_latest_version`, '1.0.0');
    const minVersion = await settingValue(`${prefix}_min_version`, '1.0.0');
    const playStoreUrl = await settingValue(`${prefix}_app_playstore_url`, '');
    const appStoreUrl = await settingValue(`${prefix}_app_appstore_url`, '');
    const forceUpdateRaw = await settingValue(`${prefix}_force_update`, 'false');
    const forceUpdate = forceUpdateRaw === 'true' || forceUpdateRaw === '1';
    const updateTitle = await settingValue(`${prefix}_update_title`, 'Update Available');
    const updateMessage = await settingValue(`${prefix}_update_message`, 'A new version of the app is available. Please update for the best experience.');

    return res.json({
      success: true,
      app: prefix,
      latestVersion,
      minVersion,
      playStoreUrl,
      appStoreUrl,
      forceUpdate,
      updateTitle,
      updateMessage,
    });
  } catch (error) {
    console.error('Error fetching app update config:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve update configuration' });
  }
};

const saveSocialProfile = async (req, res) => {
  try {
    const platformName = String(req.body.platform_name || '').trim();
    const iconName = String(req.body.icon_name || '').trim().toLowerCase();
    const profileLink = String(req.body.profile_link || '').trim();
    const isActive = req.body.is_active === 'on' || req.body.is_active === '1' || req.body.is_active === true ? 1 : 0;
    const displayOrder = parseInt(req.body.display_order, 10) || 0;

    if (!platformName || !profileLink) {
      return res.redirect('/app-settings?err=Platform+name+and+Profile+link+are+required');
    }

    let iconImage = null;
    if (req.file) {
      iconImage = `/uploads/app_settings/${req.file.filename}`;
    }

    await pool.query(
      `INSERT INTO social_profiles (platform_name, icon_name, icon_image, profile_link, is_active, display_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [platformName, iconName || null, iconImage, profileLink, isActive, displayOrder]
    );

    return res.redirect('/app-settings?msg=Social+profile+added+successfully');
  } catch (err) {
    console.error('Error saving social profile:', err);
    return res.redirect('/app-settings?err=Failed+to+save+social+profile');
  }
};

const updateSocialProfile = async (req, res) => {
  try {
    const id = req.params.id;
    const platformName = String(req.body.platform_name || '').trim();
    const iconName = String(req.body.icon_name || '').trim().toLowerCase();
    const profileLink = String(req.body.profile_link || '').trim();
    const isActive = req.body.is_active === 'on' || req.body.is_active === '1' || req.body.is_active === true ? 1 : 0;
    const displayOrder = parseInt(req.body.display_order, 10) || 0;

    if (!platformName || !profileLink) {
      return res.redirect('/app-settings?err=Platform+name+and+Profile+link+are+required');
    }

    if (req.file) {
      const iconImage = `/uploads/app_settings/${req.file.filename}`;
      await pool.query(
        `UPDATE social_profiles
         SET platform_name = ?, icon_name = ?, icon_image = ?, profile_link = ?, is_active = ?, display_order = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [platformName, iconName || null, iconImage, profileLink, isActive, displayOrder, id]
      );
    } else {
      await pool.query(
        `UPDATE social_profiles
         SET platform_name = ?, icon_name = ?, profile_link = ?, is_active = ?, display_order = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [platformName, iconName || null, profileLink, isActive, displayOrder, id]
      );
    }

    return res.redirect('/app-settings?msg=Social+profile+updated+successfully');
  } catch (err) {
    console.error('Error updating social profile:', err);
    return res.redirect('/app-settings?err=Failed+to+update+social+profile');
  }
};

const deleteSocialProfile = async (req, res) => {
  try {
    const id = req.params.id;
    await pool.query('DELETE FROM social_profiles WHERE id = ?', [id]);
    return res.redirect('/app-settings?msg=Social+profile+deleted');
  } catch (err) {
    console.error('Error deleting social profile:', err);
    return res.redirect('/app-settings?err=Failed+to+delete+social+profile');
  }
};

const toggleSocialProfileStatus = async (req, res) => {
  try {
    const id = req.params.id;
    await pool.query(
      'UPDATE social_profiles SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );
    return res.redirect('/app-settings?msg=Social+profile+status+toggled');
  } catch (err) {
    console.error('Error toggling social profile status:', err);
    return res.redirect('/app-settings?err=Failed+to+toggle+social+profile+status');
  }
};

const getPublicSocialProfiles = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, platform_name, icon_name, icon_image, profile_link, display_order FROM social_profiles WHERE is_active = 1 ORDER BY display_order ASC, id ASC'
    );

    const profiles = (rows || []).map((p) => ({
      id: p.id,
      platform_name: p.platform_name,
      icon_name: p.icon_name || '',
      icon_image_url: p.icon_image ? resolveFullUrl(req, p.icon_image) : '',
      profile_link: p.profile_link,
      display_order: p.display_order,
    }));

    return res.json({
      success: true,
      profiles,
    });
  } catch (error) {
    console.error('Error fetching public social profiles:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve social profiles' });
  }
}

async function getGstMandatory() {
  const val = await settingValue('gst_mandatory', 'false');
  return val === 'true' || val === '1';
}

async function setGstMandatory(isMandatory) {
  await saveSetting('gst_mandatory', isMandatory ? 'true' : 'false');
}

module.exports = {
  renderAppSettings,
  updateAppLogos,
  getPublicAppLogos,
  getAppUpdateConfig,
  saveSocialProfile,
  updateSocialProfile,
  deleteSocialProfile,
  toggleSocialProfileStatus,
  getPublicSocialProfiles,
  initSocialProfileTable,
  getGstMandatory,
  setGstMandatory,
  settingValue,
  saveSetting,
};
