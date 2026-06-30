module.exports = {
  id: '202606300001_location_commissions_and_order_fees',
  name: 'Add location commissions and order fee columns',
  async up(db) {
    await db.query('ALTER TABLE client_orders ADD COLUMN IF NOT EXISTS platform_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00');
    await db.query('ALTER TABLE client_orders ADD COLUMN IF NOT EXISTS order_commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00');
    await db.query('ALTER TABLE client_orders ADD COLUMN IF NOT EXISTS delivery_commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00');
    await db.query('ALTER TABLE client_orders ADD COLUMN IF NOT EXISTS area_definition_id INTEGER DEFAULT NULL');
    await db.query('ALTER TABLE client_orders ADD COLUMN IF NOT EXISTS area_pricing_snapshot JSONB DEFAULT NULL');

    await db.query('ALTER TABLE area_definitions ADD COLUMN IF NOT EXISTS platform_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00');
    await db.query('ALTER TABLE area_definitions ADD COLUMN IF NOT EXISTS delivery_charge DECIMAL(12,2) NOT NULL DEFAULT 0.00');
    await db.query('ALTER TABLE area_definitions ADD COLUMN IF NOT EXISTS order_commission_percentage DECIMAL(7,2) NOT NULL DEFAULT 0.00');
    await db.query('ALTER TABLE area_definitions ADD COLUMN IF NOT EXISTS delivery_commission_percentage DECIMAL(7,2) NOT NULL DEFAULT 0.00');

    await db.query(`
      CREATE TABLE IF NOT EXISTS location_commission_settings (
        id SERIAL PRIMARY KEY,
        city VARCHAR(120) NOT NULL,
        area VARCHAR(150) NOT NULL DEFAULT '*',
        order_commission_percentage DECIMAL(7,2) NOT NULL DEFAULT 0.00,
        delivery_commission_percentage DECIMAL(7,2) NOT NULL DEFAULT 0.00,
        is_active SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uniq_location_commission_city_area UNIQUE (city, area)
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_location_commission_lookup ON location_commission_settings (city, area, is_active)');
  },
};
