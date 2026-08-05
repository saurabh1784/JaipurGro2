module.exports = {
  id: '202608030003_test_otp_hash',
  name: 'Add secure hash for backend WhatsApp test OTP verification',
  async up(db) {
    await db.query('ALTER TABLE msg91_test_otp_sessions ADD COLUMN IF NOT EXISTS otp_hash VARCHAR(128)');
  },
};
