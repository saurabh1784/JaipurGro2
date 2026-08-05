module.exports = {
  id: '202608030004_enable_vendor_mobile_otp',
  name: 'Enable mobile OTP login for Vendor App',
  async up(db) {
    const result = await db.query(
      `UPDATE app_settings
       SET setting_value = 'true', is_secret = 0, updated_at = CURRENT_TIMESTAMP
       WHERE setting_key = 'otp_vendor_app_enabled'`
    );
    if (!result.rowCount) {
      await db.query(
        `INSERT INTO app_settings (setting_key, setting_value, is_secret)
         VALUES ('otp_vendor_app_enabled', 'true', 0)`
      );
    }
  },
};
