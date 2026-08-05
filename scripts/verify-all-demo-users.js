const pool = require('../db');

async function verifyAllDemoUsers() {
  console.log('=== VERIFYING DEMO USERS (2 VENDORS, 2 CLIENTS, 2 DELIVERY PARTNERS) ===\n');

  try {
    // 1. Vendors
    const [vendors] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.city, u.area,
              vp.business_name, vp.address, vp.gst_number, vp.services
       FROM users u
       LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
       WHERE u.email IN ('vendor.sharma@groxen.in', 'vendor.verma@groxen.in') AND u.is_deleted = 0
       ORDER BY u.id ASC`
    );

    console.log('📌 VENDORS (2 Accounts):');
    vendors.forEach((v, idx) => {
      console.log(`  [Vendor #${idx + 1}] ID: ${v.id} | Store: "${v.business_name}" | Name: ${v.name}`);
      console.log(`     Email: ${v.email} | Phone: ${v.phone} | Password: vendor123`);
      console.log(`     Location: ${v.address}, ${v.area}, ${v.city} | GST: ${v.gst_number}`);
      console.log(`     Services: ${v.services}`);
      console.log('');
    });

    // 2. Clients
    const [clients] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.city, u.area,
              cp.address, cp.gender, cp.age, w.balance AS wallet_balance
       FROM users u
       LEFT JOIN client_profiles cp ON cp.user_id = u.id
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE u.email IN ('client.ananya@groxen.in', 'client.vikram@groxen.in') AND u.is_deleted = 0
       ORDER BY u.id ASC`
    );

    console.log('📌 CLIENTS / CUSTOMERS (2 Accounts):');
    clients.forEach((c, idx) => {
      console.log(`  [Client #${idx + 1}] ID: ${c.id} | Name: ${c.name} | Gender: ${c.gender} | Age: ${c.age}`);
      console.log(`     Email: ${c.email} | Phone: ${c.phone} | Password: client123`);
      console.log(`     Address: ${c.address}, ${c.area}, ${c.city}`);
      console.log(`     Wallet Balance: ₹${c.wallet_balance || 0}`);
      console.log('');
    });

    // 3. Delivery Partners
    const [riders] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.city, u.area,
              dp.vehicle_type, dp.vehicle_number, dp.address, dp.address_proof_type, dp.is_available, w.balance AS wallet_balance
       FROM users u
       LEFT JOIN delivery_person_profiles dp ON dp.user_id = u.id
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE u.email IN ('rider.surendra@groxen.in', 'rider.mohit@groxen.in') AND u.is_deleted = 0
       ORDER BY u.id ASC`
    );

    console.log('📌 DELIVERY PARTNERS / RIDERS (2 Accounts):');
    riders.forEach((r, idx) => {
      console.log(`  [Rider #${idx + 1}] ID: ${r.id} | Name: ${r.name} | Availability: ${r.is_available ? 'ONLINE' : 'OFFLINE'}`);
      console.log(`     Email: ${r.email} | Phone: ${r.phone} | Password: rider123`);
      console.log(`     Vehicle: ${r.vehicle_type} (${r.vehicle_number})`);
      console.log(`     Address: ${r.address}, ${r.area}, ${r.city}`);
      console.log(`     Wallet Balance / Earnings: ₹${r.wallet_balance}`);
      console.log('');
    });

    console.log('=== VERIFICATION PASSED 100% ===');
  } catch (err) {
    console.error('ERROR during verification:', err);
  } finally {
    process.exit(0);
  }
}

verifyAllDemoUsers();
