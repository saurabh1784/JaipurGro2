module.exports = {
  id: '202608020002_add_social_provider_to_users',
  name: 'Add social_provider, social_provider_id and profile_image columns to users table',
  async up(db) {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS social_provider VARCHAR(50) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS social_provider_id VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT DEFAULT NULL`).catch(() => {});
  }
};
