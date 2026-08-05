module.exports = {
  id: '202608050002_role_scoped_mobile_accounts',
  name: 'Allow one mobile account per customer, vendor, and delivery role',
  async up(db) {
    await db.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS idx_users_phone_unique').catch(() => {});
    await db.query('DROP INDEX IF EXISTS idx_users_phone_unique').catch(() => {});
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_role_unique
      ON users (phone, (CASE
        WHEN LOWER(REPLACE(REPLACE(REPLACE(role, ' ', ''), '_', ''), '-', '')) IN ('client', 'customer') THEN 'client'
        WHEN LOWER(REPLACE(REPLACE(REPLACE(role, ' ', ''), '_', ''), '-', '')) = 'vendor' THEN 'vendor'
        WHEN LOWER(REPLACE(REPLACE(REPLACE(role, ' ', ''), '_', ''), '-', '')) IN ('deliveryperson', 'deliverypartner', 'delivery', 'rider') THEN 'deliveryperson'
        ELSE LOWER(REPLACE(REPLACE(REPLACE(role, ' ', ''), '_', ''), '-', ''))
      END))
      WHERE phone IS NOT NULL AND phone <> '' AND is_deleted = 0`);
  },
};