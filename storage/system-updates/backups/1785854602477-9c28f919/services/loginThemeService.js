const pool = require('../db');

async function saveSettingValue(key, value) {
  try {
    const [existing] = await pool.query('SELECT setting_key FROM app_settings WHERE setting_key = ? LIMIT 1', [key]);
    if (existing && existing.length > 0) {
      await pool.query('UPDATE app_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?', [value || '', key]);
    } else {
      await pool.query('INSERT INTO app_settings (setting_key, setting_value, is_secret) VALUES (?, ?, 0)', [key, value || '']);
    }
  } catch (err) {
    console.error(`Error saving setting ${key}:`, err);
  }
}

/**
 * Get Login Background Settings with Fallback Chain:
 * 1. Custom Image (if login_bg_image is set)
 * 2. Custom Color (if login_bg_color is set and not default)
 * 3. Default Dark Maroon (#4a0e17 / gradient)
 */
async function getLoginBgSettings() {
  try {
    const [rows] = await pool.query(
      `SELECT setting_key, setting_value 
       FROM app_settings 
       WHERE setting_key IN ('login_bg_image', 'login_bg_color')`
    );

    let loginBgImage = '';
    let loginBgColor = '#4a0e17'; // Default Dark Maroon

    if (rows && rows.length) {
      for (const r of rows) {
        if (r.setting_key === 'login_bg_image') loginBgImage = (r.setting_value || '').trim();
        if (r.setting_key === 'login_bg_color') loginBgColor = (r.setting_value || '').trim() || '#4a0e17';
      }
    }

    let activeType = 'default_maroon';
    let activeStyle = 'background-color: #4a0e17; background-image: linear-gradient(135deg, #4a0e17 0%, #28050b 100%);';

    if (loginBgImage) {
      activeType = 'image';
      activeStyle = `background-image: linear-gradient(rgba(15, 23, 42, 0.45), rgba(15, 23, 42, 0.65)), url('${loginBgImage}'); background-size: 100% 100%; background-position: center center; background-repeat: no-repeat; background-attachment: fixed; min-height: 100vh; width: 100%;`;
    } else if (loginBgColor && loginBgColor.toLowerCase() !== '#4a0e17') {
      activeType = 'color';
      activeStyle = `background-color: ${loginBgColor}; background-image: none;`;
    }

    return {
      loginBgImage,
      loginBgColor,
      activeType,
      activeStyle,
    };
  } catch (err) {
    console.error('Error fetching login background settings:', err);
    return {
      loginBgImage: '',
      loginBgColor: '#4a0e17',
      activeType: 'default_maroon',
      activeStyle: 'background-color: #4a0e17; background-image: linear-gradient(135deg, #4a0e17 0%, #28050b 100%);',
    };
  }
}

async function saveLoginBgSettings({ loginBgImage, loginBgColor }) {
  const img = (loginBgImage || '').trim();
  const col = (loginBgColor || '').trim() || '#4a0e17';

  await saveSettingValue('login_bg_image', img);
  await saveSettingValue('login_bg_color', col);

  return getLoginBgSettings();
}

module.exports = {
  getLoginBgSettings,
  saveLoginBgSettings,
};
