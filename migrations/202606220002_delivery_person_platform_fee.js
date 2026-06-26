module.exports = {
  id: '202606220002_delivery_person_platform_fee',
  name: 'Set delivery person platform fee to 10 percent',
  async up(db) {
    await db.query(`
      UPDATE commission_settings
      SET commission_type = 'percentage',
          commission_value = 10.00,
          min_commission = 0.00,
          max_commission = NULL,
          is_active = 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE LOWER(REPLACE(REPLACE(role_slug, '-', ''), '_', '')) = 'deliveryperson'
        AND transaction_type = 'order_payment'
    `);
  },
};
