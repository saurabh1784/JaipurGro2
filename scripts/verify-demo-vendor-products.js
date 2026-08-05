const pool = require('../db');

async function verifyDemoVendor() {
  console.log('--- Verifying Demo Vendor & Products in Database ---');
  try {
    const [vendors] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.status, vp.business_name, vp.city, vp.area
       FROM users u
       LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
       WHERE u.email = 'demovendor@groxen.in' AND u.is_deleted = 0`
    );

    if (!vendors || !vendors.length) {
      return console.error('FAIL: Demo vendor not found in database!');
    }

    const v = vendors[0];
    console.log('✅ Demo Vendor Found:');
    console.log(`   - User ID: ${v.id}`);
    console.log(`   - Name: ${v.name}`);
    console.log(`   - Store Name: ${v.business_name}`);
    console.log(`   - Email: ${v.email}`);
    console.log(`   - Phone: ${v.phone}`);
    console.log(`   - Status: ${v.status}`);
    console.log(`   - Location: ${v.area}, ${v.city}`);

    const [products] = await pool.query(
      `SELECT vp.id AS vendor_product_id, p.id AS product_id, p.name, c.name AS category_name, p.price AS mrp, vp.price AS sale_price, vp.quantity AS stock, vp.status
       FROM vendor_products vp
       INNER JOIN products p ON p.id = vp.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE vp.vendor_id = ? AND p.is_deleted = 0
       ORDER BY vp.id ASC`,
      [v.id]
    );

    console.log(`✅ Total Products Assigned to Demo Vendor: ${products.length} products`);
    console.log('\n--- Sample Products List (First 10 of 50): ---');
    products.slice(0, 10).forEach((p, idx) => {
      console.log(` ${idx + 1}. ${p.name} [Category: ${p.category_name}] - MRP: ₹${p.mrp} | Vendor Price: ₹${p.sale_price} | Stock: ${p.stock} units | Status: ${p.status}`);
    });

  } catch (err) {
    console.error('ERROR during verification:', err);
  } finally {
    process.exit(0);
  }
}

verifyDemoVendor();
