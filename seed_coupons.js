const pool = require('./db');

async function seedCoupons() {
  try {
    const [c] = await pool.query('SELECT COUNT(*) AS cnt FROM coupons');
    if (Number(c[0].cnt) === 0) {
      await pool.query(`
        INSERT INTO coupons (name, code, description, value_type, value, min_order_amount, is_active, scroll_message, background_color, text_color)
        VALUES 
          ('10% OFF Special', 'GROXEN10', 'Get 10% instant discount on orders above Rs 199', 'percentage', 10.00, 199.00, 1, 'Use code GROXEN10 for 10% OFF!', '#0f766e', '#ffffff'),
          ('Flat Rs 50 Savings', 'SAVE50', 'Flat Rs 50 discount on orders above Rs 499', 'fixed', 50.00, 499.00, 1, 'Flat Rs 50 OFF on orders above Rs 499!', '#b45309', '#ffffff'),
          ('Free Delivery Bonus', 'FREESHIP', 'Flat Rs 30 discount on orders above Rs 299', 'fixed', 30.00, 299.00, 1, 'Free delivery bonus on orders above Rs 299!', '#15803d', '#ffffff')
      `);
      console.log('Seeded 3 active coupons into DB!');
    } else {
      console.log('Coupons count in DB:', c[0].cnt);
    }
    process.exit(0);
  } catch (e) {
    console.error('Error seeding coupons:', e);
    process.exit(1);
  }
}

seedCoupons();
