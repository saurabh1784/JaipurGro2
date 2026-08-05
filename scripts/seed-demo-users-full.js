const bcrypt = require('bcryptjs');
const pool = require('../db');
const Wallet = require('../models/Wallet');

const VENDORS = [
  {
    name: 'Rajesh Sharma',
    business_name: 'Jaipur Royal Spices & Mart',
    email: 'vendor.sharma@groxen.in',
    phone: '9829011111',
    password: 'vendor123',
    address: 'Shop 12, Johari Bazar, Pink City',
    area: 'Johari Bazar',
    city: 'Jaipur',
    state: 'Rajasthan',
    country: 'India',
    gst_number: '08ABCRS1111A1Z1',
    services: ['Spices', 'Dry Fruits', 'Grains', 'Grocery'],
  },
  {
    name: 'Pooja Verma',
    business_name: 'Green Basket Supermarket',
    email: 'vendor.verma@groxen.in',
    phone: '9829022222',
    password: 'vendor123',
    address: 'Plot 88, Kings Road, Nirman Nagar',
    area: 'Nirman Nagar',
    city: 'Jaipur',
    state: 'Rajasthan',
    country: 'India',
    gst_number: '08DEFGV2222B2Z2',
    services: ['Fresh Fruits', 'Organic Vegetables', 'Dairy', 'Bakery'],
  },
];

const CLIENTS = [
  {
    name: 'Ananya Roy',
    email: 'client.ananya@groxen.in',
    phone: '9829033333',
    password: 'client123',
    address: 'Flat 304, Green Heights, Vaishali Nagar',
    area: 'Vaishali Nagar',
    city: 'Jaipur',
    state: 'Rajasthan',
    country: 'India',
    gender: 'Female',
    age: '28',
    wallet_balance: 1500.0,
  },
  {
    name: 'Vikramaditya Singh',
    email: 'client.vikram@groxen.in',
    phone: '9829044444',
    password: 'client123',
    address: 'Villa 14, Royal Palm Enclave, Jagatpura',
    area: 'Jagatpura',
    city: 'Jaipur',
    state: 'Rajasthan',
    country: 'India',
    gender: 'Male',
    age: '34',
    wallet_balance: 2500.0,
  },
];

const DELIVERY_PARTNERS = [
  {
    name: 'Surendra Kumar (Express Rider)',
    email: 'rider.surendra@groxen.in',
    phone: '9829055555',
    password: 'rider123',
    vehicle_type: 'Honda Activa 6G (Scooter)',
    vehicle_number: 'RJ-14-SK-5555',
    address_proof_type: 'Aadhaar Card',
    address_proof_id: 67891234,
    address: 'House 42, Sector 3, Malviya Nagar',
    area: 'Malviya Nagar',
    city: 'Jaipur',
    is_available: 1,
    initial_wallet: 850.0,
  },
  {
    name: 'Mohit Choudhary (Fast Delivery)',
    email: 'rider.mohit@groxen.in',
    phone: '9829066666',
    password: 'rider123',
    vehicle_type: 'TVS Splendor+ (Motorcycle)',
    vehicle_number: 'RJ-14-MC-6666',
    address_proof_type: 'Driving License',
    address_proof_id: 14202100,
    address: 'Plot 19, Chitrakoot Sector 5',
    area: 'Vaishali Nagar',
    city: 'Jaipur',
    is_available: 1,
    initial_wallet: 1200.0,
  },
];

async function seedDemoUsersFull() {
  console.log('--- Seeding 2 Vendors, 2 Clients, and 2 Delivery Partners ---');
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Fetch existing categories for vendor linking
    const [categories] = await connection.query('SELECT id FROM categories WHERE is_deleted = 0');
    const categoryIds = categories.map((c) => c.id);

    // Fetch products for vendor product assignment
    const [masterProducts] = await connection.query('SELECT id, price FROM products WHERE is_deleted = 0 LIMIT 30');

    // ===============================================
    // 1. SEED 2 VENDORS
    // ===============================================
    console.log('\n--- Seeding 2 Vendors ---');
    for (const v of VENDORS) {
      const hash = await bcrypt.hash(v.password, 10);

      let vendorId;
      const [exUser] = await connection.query(
        "SELECT id FROM users WHERE (email = ? OR phone = ?) AND is_deleted = 0 LIMIT 1",
        [v.email, v.phone]
      );

      if (exUser && exUser.length > 0) {
        vendorId = exUser[0].id;
        await connection.query(
          "UPDATE users SET name = ?, email = ?, phone = ?, password = ?, role = 'Vendor', status = 'active', city = ?, area = ? WHERE id = ?",
          [v.name, v.email, v.phone, hash, v.city, v.area, vendorId]
        );
        console.log(`[Vendor Updated] Name: ${v.name} (ID: ${vendorId})`);
      } else {
        const [uRes] = await connection.query(
          `INSERT INTO users (name, email, phone, password, role, status, city, area)
           VALUES (?, ?, ?, ?, 'Vendor', 'active', ?, ?) RETURNING id`,
          [v.name, v.email, v.phone, hash, v.city, v.area]
        );
        vendorId = uRes[0] ? uRes[0].id : (uRes.insertId || uRes.id);
        console.log(`[Vendor Created] Name: ${v.name} (ID: ${vendorId})`);
      }

      // Upsert vendor profile
      const [exProf] = await connection.query('SELECT id FROM vendor_profiles WHERE user_id = ? LIMIT 1', [vendorId]);
      if (exProf && exProf.length > 0) {
        await connection.query(
          `UPDATE vendor_profiles 
           SET business_name = ?, address = ?, city = ?, state = ?, country = ?, area = ?, gst_number = ?, services = ?, is_premium_vendor = 1
           WHERE user_id = ?`,
          [v.business_name, v.address, v.city, v.state, v.country, v.area, v.gst_number, JSON.stringify(v.services), vendorId]
        );
      } else {
        await connection.query(
          `INSERT INTO vendor_profiles (user_id, business_name, address, city, state, country, area, gst_number, services, is_premium_vendor, premium_commission_percent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 5)`,
          [vendorId, v.business_name, v.address, v.city, v.state, v.country, v.area, v.gst_number, JSON.stringify(v.services)]
        );
      }

      // Link categories
      for (const catId of categoryIds) {
        const [exVC] = await connection.query(
          'SELECT 1 FROM vendor_categories WHERE vendor_id = ? AND category_id = ? LIMIT 1',
          [vendorId, catId]
        );
        if (!exVC || exVC.length === 0) {
          await connection.query('INSERT INTO vendor_categories (vendor_id, category_id) VALUES (?, ?)', [vendorId, catId]);
        }
      }

      // Assign products to vendor
      for (const prod of masterProducts) {
        const [exVP] = await connection.query(
          'SELECT id FROM vendor_products WHERE product_id = ? AND vendor_id = ? LIMIT 1',
          [prod.id, vendorId]
        );
        const salePrice = Math.round(Number(prod.price || 100) * 0.9);
        if (exVP && exVP.length > 0) {
          await connection.query(
            "UPDATE vendor_products SET quantity = 100, price = ?, status = 'available' WHERE product_id = ? AND vendor_id = ?",
            [salePrice, prod.id, vendorId]
          );
        } else {
          await connection.query(
            "INSERT INTO vendor_products (product_id, vendor_id, quantity, price, status) VALUES (?, ?, 100, ?, 'available')",
            [prod.id, vendorId, salePrice]
          );
        }
      }
    }

    // ===============================================
    // 2. SEED 2 CLIENTS (CUSTOMERS)
    // ===============================================
    console.log('\n--- Seeding 2 Clients ---');
    for (const c of CLIENTS) {
      const hash = await bcrypt.hash(c.password, 10);

      let clientId;
      const [exUser] = await connection.query(
        "SELECT id FROM users WHERE (email = ? OR phone = ?) AND is_deleted = 0 LIMIT 1",
        [c.email, c.phone]
      );

      if (exUser && exUser.length > 0) {
        clientId = exUser[0].id;
        await connection.query(
          "UPDATE users SET name = ?, email = ?, phone = ?, password = ?, role = 'Client', status = 'active', country = ?, state = ?, city = ?, area = ? WHERE id = ?",
          [c.name, c.email, c.phone, hash, c.country, c.state, c.city, c.area, clientId]
        );
        console.log(`[Client Updated] Name: ${c.name} (ID: ${clientId})`);
      } else {
        const [uRes] = await connection.query(
          `INSERT INTO users (name, email, phone, password, role, status, country, state, city, area)
           VALUES (?, ?, ?, ?, 'Client', 'active', ?, ?, ?, ?) RETURNING id`,
          [c.name, c.email, c.phone, hash, c.country, c.state, c.city, c.area]
        );
        clientId = uRes[0] ? uRes[0].id : (uRes.insertId || uRes.id);
        console.log(`[Client Created] Name: ${c.name} (ID: ${clientId})`);
      }

      // Upsert client_profiles
      const [exProf] = await connection.query('SELECT id FROM client_profiles WHERE user_id = ? LIMIT 1', [clientId]);
      if (exProf && exProf.length > 0) {
        await connection.query(
          'UPDATE client_profiles SET address = ?, city = ?, state = ?, country = ?, area = ?, gender = ?, age = ? WHERE user_id = ?',
          [c.address, c.city, c.state, c.country, c.area, c.gender, c.age, clientId]
        );
      } else {
        await connection.query(
          'INSERT INTO client_profiles (user_id, address, city, state, country, area, gender, age) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [clientId, c.address, c.city, c.state, c.country, c.area, c.gender, c.age]
        );
      }

      // Update wallet balance using Wallet model
      await Wallet.ensureForUser(clientId, connection);
      await connection.query('UPDATE wallets SET balance = ? WHERE user_id = ?', [c.wallet_balance, clientId]);
    }

    // ===============================================
    // 3. SEED 2 DELIVERY PARTNERS (RIDERS)
    // ===============================================
    console.log('\n--- Seeding 2 Delivery Partners ---');
    for (const dp of DELIVERY_PARTNERS) {
      const hash = await bcrypt.hash(dp.password, 10);

      let riderId;
      const [exUser] = await connection.query(
        "SELECT id FROM users WHERE (email = ? OR phone = ?) AND is_deleted = 0 LIMIT 1",
        [dp.email, dp.phone]
      );

      if (exUser && exUser.length > 0) {
        riderId = exUser[0].id;
        await connection.query(
          "UPDATE users SET name = ?, email = ?, phone = ?, password = ?, role = 'deliveryperson', status = 'active', city = ?, area = ? WHERE id = ?",
          [dp.name, dp.email, dp.phone, hash, dp.city, dp.area, riderId]
        );
        console.log(`[Delivery Partner Updated] Name: ${dp.name} (ID: ${riderId})`);
      } else {
        const [uRes] = await connection.query(
          `INSERT INTO users (name, email, phone, password, role, status, city, area)
           VALUES (?, ?, ?, ?, 'deliveryperson', 'active', ?, ?) RETURNING id`,
          [dp.name, dp.email, dp.phone, hash, dp.city, dp.area]
        );
        riderId = uRes[0] ? uRes[0].id : (uRes.insertId || uRes.id);
        console.log(`[Delivery Partner Created] Name: ${dp.name} (ID: ${riderId})`);
      }

      // Upsert delivery_person_profiles
      const [exProf] = await connection.query('SELECT id FROM delivery_person_profiles WHERE user_id = ? LIMIT 1', [riderId]);
      if (exProf && exProf.length > 0) {
        await connection.query(
          `UPDATE delivery_person_profiles 
           SET city = ?, area = ?, address = ?, address_proof_type = ?, address_proof_id = ?, vehicle_type = ?, vehicle_number = ?, is_available = ?
           WHERE user_id = ?`,
          [dp.city, dp.area, dp.address, dp.address_proof_type, dp.address_proof_id, dp.vehicle_type, dp.vehicle_number, dp.is_available, riderId]
        );
      } else {
        await connection.query(
          `INSERT INTO delivery_person_profiles 
           (user_id, city, area, address, address_proof_type, address_proof_id, vehicle_type, vehicle_number, is_available)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [riderId, dp.city, dp.area, dp.address, dp.address_proof_type, dp.address_proof_id, dp.vehicle_type, dp.vehicle_number, dp.is_available]
        );
      }

      // Update wallet balance using Wallet model
      await Wallet.ensureForUser(riderId, connection);
      await connection.query('UPDATE wallets SET balance = ? WHERE user_id = ?', [dp.initial_wallet, riderId]);
    }

    await connection.commit();
    console.log('\n--- SUCCESS: All 2 Vendors, 2 Clients, and 2 Delivery Partners Seeded! ---');
  } catch (err) {
    await connection.rollback();
    console.error('ERROR seeding demo users:', err.message, err.stack);
  } finally {
    connection.release();
    process.exit(0);
  }
}

seedDemoUsersFull();
