module.exports = {
  id: '202606220001_delivery_type_priorities',
  name: 'Align default area delivery type priorities',
  async up(db) {
    await db.query(`
      UPDATE delivery_type_area_settings
      SET priority = CASE
        WHEN delivery_type = 'counter_pickup' AND priority = 4 THEN 3
        WHEN delivery_type = 'delivered_by_vendor' AND priority = 3 THEN 4
        ELSE priority
      END,
      label = CASE
        WHEN delivery_type = 'counter_pickup' THEN 'Client Self Pickup'
        WHEN delivery_type = 'delivered_by_vendor' THEN 'Vendor Delivery'
        ELSE label
      END
      WHERE delivery_type IN ('counter_pickup', 'delivered_by_vendor')
    `);
  },
};
