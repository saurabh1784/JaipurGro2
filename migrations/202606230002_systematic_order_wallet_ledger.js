module.exports = {
  id: '202606230002_systematic_order_wallet_ledger',
  name: 'Add systematic order wallet ledger fields',
  async up(db) {
    await db.query('ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS order_id INTEGER DEFAULT NULL');
    await db.query('ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS component VARCHAR(60) DEFAULT NULL');
    await db.query('ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS ledger_key VARCHAR(190) DEFAULT NULL');
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_ledger_key_unique ON wallet_transactions (ledger_key)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_wallet_transactions_order ON wallet_transactions (order_id)');

    await db.query('ALTER TABLE client_orders ADD COLUMN IF NOT EXISTS platform_charge DECIMAL(12,2) NOT NULL DEFAULT 0.00');
    await db.query('ALTER TABLE client_orders ADD COLUMN IF NOT EXISTS vendor_earning DECIMAL(12,2) NOT NULL DEFAULT 0.00');
    await db.query('ALTER TABLE client_orders ADD COLUMN IF NOT EXISTS delivery_earning DECIMAL(12,2) NOT NULL DEFAULT 0.00');
    await db.query('ALTER TABLE client_orders ADD COLUMN IF NOT EXISTS wallet_settled_at TIMESTAMP NULL DEFAULT NULL');
    await db.query('ALTER TABLE client_orders ADD COLUMN IF NOT EXISTS delivery_wallet_settled_at TIMESTAMP NULL DEFAULT NULL');

    await db.query(`
      UPDATE wallet_transactions
      SET order_id = CAST(SUBSTRING(reference FROM 'ORDER[_:]([0-9]+)') AS INTEGER)
      WHERE order_id IS NULL
        AND reference ~ 'ORDER[_:][0-9]+'
        AND EXISTS (
          SELECT 1 FROM client_orders o
          WHERE o.id = CAST(SUBSTRING(wallet_transactions.reference FROM 'ORDER[_:]([0-9]+)') AS INTEGER)
        )
    `);

    await db.query(`
      UPDATE commission_settings admin_fee
      SET commission_type = legacy_fee.commission_type,
          commission_value = legacy_fee.commission_value,
          min_commission = legacy_fee.min_commission,
          max_commission = legacy_fee.max_commission,
          is_active = 1,
          updated_at = CURRENT_TIMESTAMP
      FROM (
        SELECT commission_type, commission_value, min_commission, max_commission
        FROM commission_settings
        WHERE LOWER(role_slug) = 'deliveryperson'
          AND transaction_type = 'order_payment'
          AND is_active = 1
        ORDER BY id
        LIMIT 1
      ) legacy_fee
      WHERE LOWER(admin_fee.role_slug) = 'admin'
        AND admin_fee.transaction_type = 'order_payment'
        AND admin_fee.is_active = 0
    `);
    await db.query(`
      UPDATE commission_settings
      SET is_active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE LOWER(role_slug) = 'deliveryperson'
        AND transaction_type = 'order_payment'
    `);
  },
};
