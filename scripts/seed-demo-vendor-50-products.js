const bcrypt = require('bcryptjs');
const pool = require('../db');

const DEMO_VENDOR = {
  name: 'Demo Groxen Vendor',
  email: 'demovendor@groxen.in',
  phone: '9876543210',
  password: 'vendor123',
  business_name: 'Groxen Fresh Supermarket',
  address: 'Plot 45, Tonk Road, Malviya Nagar',
  city: 'Jaipur',
  state: 'Rajasthan',
  country: 'India',
  area: 'Malviya Nagar',
  gst_number: '08DEMO9999F1Z9',
  services: ['Grocery', 'Fresh Produce', 'Dairy & Bakery', 'Beverages', 'Household'],
};

const PRODUCTS_50 = [
  // 1-10: Fresh Vegetables & Fruits
  { name: 'Fresh Red Tomatoes', category: 'Vegetables', weight_value: 1, weight_unit: 'kg', weight_kg: 1.0, mrp: 40, sale_price: 32, stock: 150, image_url: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=500' },
  { name: 'Hybrid Fresh Onions', category: 'Vegetables', weight_value: 1, weight_unit: 'kg', weight_kg: 1.0, mrp: 35, sale_price: 28, stock: 200, image_url: 'https://images.unsplash.com/photo-1508747703725-719777637510?w=500' },
  { name: 'Fresh Organic Potatoes', category: 'Vegetables', weight_value: 1, weight_unit: 'kg', weight_kg: 1.0, mrp: 30, sale_price: 24, stock: 250, image_url: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=500' },
  { name: 'Fresh Green Capsicum', category: 'Vegetables', weight_value: 500, weight_unit: 'g', weight_kg: 0.5, mrp: 45, sale_price: 36, stock: 80, image_url: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=500' },
  { name: 'Organic Fresh Palak (Spinach)', category: 'Vegetables', weight_value: 250, weight_unit: 'g', weight_kg: 0.25, mrp: 25, sale_price: 20, stock: 60, image_url: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=500' },
  { name: 'Fresh Green Peas (Matar)', category: 'Vegetables', weight_value: 500, weight_unit: 'g', weight_kg: 0.5, mrp: 60, sale_price: 48, stock: 90, image_url: 'https://images.unsplash.com/photo-1587735243615-c03f25aaff15?w=500' },
  { name: 'Fresh White Cauliflower', category: 'Vegetables', weight_value: 1, weight_unit: 'pc', weight_kg: 0.8, mrp: 35, sale_price: 28, stock: 70, image_url: 'https://images.unsplash.com/photo-1568584711075-3d021a7c3ca3?w=500' },
  { name: 'Fresh Green Coriander (Dhaniye)', category: 'Vegetables', weight_value: 100, weight_unit: 'g', weight_kg: 0.1, mrp: 15, sale_price: 12, stock: 120, image_url: 'https://images.unsplash.com/photo-1618160702438-9b02ab6515c9?w=500' },
  { name: 'Washington Red Delicious Apples', category: 'Fruits', weight_value: 1, weight_unit: 'kg', weight_kg: 1.0, mrp: 180, sale_price: 155, stock: 100, image_url: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=500' },
  { name: 'Fresh Robusta Bananas', category: 'Fruits', weight_value: 12, weight_unit: 'pc', weight_kg: 1.2, mrp: 60, sale_price: 48, stock: 140, image_url: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=500' },

  // 11-18: Dairy & Bakery
  { name: 'Amul Taaza Toned Fresh Milk', category: 'Dairy', weight_value: 1, weight_unit: 'L', weight_kg: 1.0, mrp: 54, sale_price: 54, stock: 300, image_url: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=500' },
  { name: 'Amul Pasteurised Butter (Salted)', category: 'Dairy', weight_value: 100, weight_unit: 'g', weight_kg: 0.1, mrp: 58, sale_price: 56, stock: 180, image_url: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=500' },
  { name: 'Mother Dairy Fresh Cottage Paneer', category: 'Dairy', weight_value: 200, weight_unit: 'g', weight_kg: 0.2, mrp: 90, sale_price: 82, stock: 110, image_url: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500' },
  { name: 'Mother Dairy Classic Dahi', category: 'Dairy', weight_value: 400, weight_unit: 'g', weight_kg: 0.4, mrp: 40, sale_price: 38, stock: 150, image_url: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=500' },
  { name: 'Britannia 100% Whole Wheat Bread', category: 'Bakery', weight_value: 400, weight_unit: 'g', weight_kg: 0.4, mrp: 45, sale_price: 40, stock: 90, image_url: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=500' },
  { name: 'Amul Malai Paneer Premium Block', category: 'Dairy', weight_value: 500, weight_unit: 'g', weight_kg: 0.5, mrp: 220, sale_price: 199, stock: 75, image_url: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=500' },
  { name: 'Epigamia Alphonso Mango Greek Yogurt', category: 'Dairy', weight_value: 90, weight_unit: 'g', weight_kg: 0.09, mrp: 50, sale_price: 45, stock: 85, image_url: 'https://images.unsplash.com/photo-1571212515416-fef01fc43637?w=500' },
  { name: 'Amul Masti Spiced Refreshing Buttermilk', category: 'Dairy', weight_value: 200, weight_unit: 'ml', weight_kg: 0.2, mrp: 15, sale_price: 15, stock: 220, image_url: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=500' },

  // 19-28: Staples, Oils & Pulses
  { name: 'Aashirvaad Shuddh Chakki Whole Wheat Atta', category: 'Staples', weight_value: 5, weight_unit: 'kg', weight_kg: 5.0, mrp: 260, sale_price: 235, stock: 120, image_url: 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=500' },
  { name: 'Fortune Sunlite Refined Sunflower Oil', category: 'Staples', weight_value: 1, weight_unit: 'L', weight_kg: 1.0, mrp: 165, sale_price: 145, stock: 160, image_url: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=500' },
  { name: 'India Gate Basmati Rice Feast Rozana', category: 'Staples', weight_value: 5, weight_unit: 'kg', weight_kg: 5.0, mrp: 450, sale_price: 385, stock: 95, image_url: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=500' },
  { name: 'Tata Sampann Unpolished Toor / Arhar Dal', category: 'Pulses', weight_value: 1, weight_unit: 'kg', weight_kg: 1.0, mrp: 175, sale_price: 152, stock: 110, image_url: 'https://images.unsplash.com/photo-1515543904379-3d757afe72e4?w=500' },
  { name: 'Tata Sampann Unpolished Chana Dal', category: 'Pulses', weight_value: 1, weight_unit: 'kg', weight_kg: 1.0, mrp: 110, sale_price: 94, stock: 130, image_url: 'https://images.unsplash.com/photo-1515543904379-3d757afe72e4?w=500' },
  { name: 'Tata Vacuum Evaporated Iodized Salt', category: 'Staples', weight_value: 1, weight_unit: 'kg', weight_kg: 1.0, mrp: 28, sale_price: 25, stock: 300, image_url: 'https://images.unsplash.com/photo-1607672632458-9eb5e696346b?w=500' },
  { name: 'Madhur Pure Refined Sugar', category: 'Staples', weight_value: 1, weight_unit: 'kg', weight_kg: 1.0, mrp: 60, sale_price: 52, stock: 210, image_url: 'https://images.unsplash.com/photo-1581441363689-1f3c3c414635?w=500' },
  { name: 'Fortune Kachi Ghani Pure Mustard Oil', category: 'Staples', weight_value: 1, weight_unit: 'L', weight_kg: 1.0, mrp: 175, sale_price: 155, stock: 140, image_url: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=500' },
  { name: 'Tata Sampann Split Yellow Moong Dal', category: 'Pulses', weight_value: 1, weight_unit: 'kg', weight_kg: 1.0, mrp: 145, sale_price: 128, stock: 115, image_url: 'https://images.unsplash.com/photo-1515543904379-3d757afe72e4?w=500' },
  { name: 'Catch Pure Turmeric Powder (Haldi)', category: 'Spices', weight_value: 200, weight_unit: 'g', weight_kg: 0.2, mrp: 55, sale_price: 46, stock: 180, image_url: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=500' },

  // 29-35: Beverages
  { name: 'Tata Tea Gold Premium Black Tea', category: 'Beverages', weight_value: 500, weight_unit: 'g', weight_kg: 0.5, mrp: 340, sale_price: 295, stock: 130, image_url: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500' },
  { name: 'Nescafe Classic Pure Instant Coffee', category: 'Beverages', weight_value: 100, weight_unit: 'g', weight_kg: 0.1, mrp: 320, sale_price: 280, stock: 95, image_url: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=500' },
  { name: 'Tropicana 100% Orange Fruit Juice', category: 'Beverages', weight_value: 1, weight_unit: 'L', weight_kg: 1.0, mrp: 140, sale_price: 120, stock: 110, image_url: 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=500' },
  { name: 'Coca-Cola Original Soft Drink', category: 'Beverages', weight_value: 1.25, weight_unit: 'L', weight_kg: 1.25, mrp: 65, sale_price: 58, stock: 170, image_url: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=500' },
  { name: 'Real Fruit Power Mango Nectar Juice', category: 'Beverages', weight_value: 1, weight_unit: 'L', weight_kg: 1.0, mrp: 130, sale_price: 112, stock: 125, image_url: 'https://images.unsplash.com/photo-1546173159-315724a31696?w=500' },
  { name: 'Red Bull Energy Drink Can', category: 'Beverages', weight_value: 250, weight_unit: 'ml', weight_kg: 0.25, mrp: 125, sale_price: 115, stock: 200, image_url: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=500' },
  { name: 'Bisleri Packaged Mineral Water Bottle', category: 'Beverages', weight_value: 1, weight_unit: 'L', weight_kg: 1.0, mrp: 20, sale_price: 18, stock: 400, image_url: 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?w=500' },

  // 36-42: Snacks & Biscuits
  { name: "Lay's India's Magic Masala Potato Chips", category: 'Snacks', weight_value: 50, weight_unit: 'g', weight_kg: 0.05, mrp: 20, sale_price: 19, stock: 350, image_url: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=500' },
  { name: 'Kurkure Masala Munch Crunchy Snack', category: 'Snacks', weight_value: 90, weight_unit: 'g', weight_kg: 0.09, mrp: 20, sale_price: 19, stock: 300, image_url: 'https://images.unsplash.com/photo-1621447504864-d8686e12698c?w=500' },
  { name: 'Britannia Good Day Cashew Cookies', category: 'Snacks', weight_value: 200, weight_unit: 'g', weight_kg: 0.2, mrp: 40, sale_price: 35, stock: 220, image_url: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=500' },
  { name: "Haldiram's Nagpur Crisp Bhujia Sev", category: 'Snacks', weight_value: 350, weight_unit: 'g', weight_kg: 0.35, mrp: 115, sale_price: 98, stock: 160, image_url: 'https://images.unsplash.com/photo-1599490659213-e2b9527bd087?w=500' },
  { name: 'Oreo Original Cream Sandwich Biscuits', category: 'Snacks', weight_value: 120, weight_unit: 'g', weight_kg: 0.12, mrp: 35, sale_price: 30, stock: 250, image_url: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=500' },
  { name: 'Maggi 2-Minute Masala Instant Noodles (Pack of 4)', category: 'Snacks', weight_value: 280, weight_unit: 'g', weight_kg: 0.28, mrp: 56, sale_price: 50, stock: 280, image_url: 'https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?w=500' },
  { name: 'Doritos Nacho Cheese Tortilla Chips', category: 'Snacks', weight_value: 82, weight_unit: 'g', weight_kg: 0.082, mrp: 50, sale_price: 44, stock: 190, image_url: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=500' },

  // 43-47: Personal Care
  { name: 'Dove Cream Beauty Bathing Soap Bar (3x75g)', category: 'Personal Care', weight_value: 225, weight_unit: 'g', weight_kg: 0.225, mrp: 165, sale_price: 142, stock: 140, image_url: 'https://images.unsplash.com/photo-1607006482602-76ca2fd60caa?w=500' },
  { name: 'Colgate Strong Teeth Cavity Protection Toothpaste', category: 'Personal Care', weight_value: 200, weight_unit: 'g', weight_kg: 0.2, mrp: 115, sale_price: 99, stock: 175, image_url: 'https://images.unsplash.com/photo-1559598467-f8b76c8155d0?w=500' },
  { name: 'Head & Shoulders Anti-Dandruff Smooth Shampoo', category: 'Personal Care', weight_value: 180, weight_unit: 'ml', weight_kg: 0.18, mrp: 190, sale_price: 165, stock: 110, image_url: 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=500' },
  { name: 'Dettol Liquid Handwash Moisture Refill', category: 'Personal Care', weight_value: 750, weight_unit: 'ml', weight_kg: 0.75, mrp: 125, sale_price: 108, stock: 130, image_url: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500' },
  { name: 'Nivea Soft Light Moisturizing Cream', category: 'Personal Care', weight_value: 100, weight_unit: 'ml', weight_kg: 0.1, mrp: 210, sale_price: 185, stock: 90, image_url: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=500' },

  // 48-50: Household Essentials
  { name: 'Surf Excel Easy Wash Detergent Powder', category: 'Household', weight_value: 1, weight_unit: 'kg', weight_kg: 1.0, mrp: 145, sale_price: 128, stock: 160, image_url: 'https://images.unsplash.com/photo-1585421514284-efb74c2b69ba?w=500' },
  { name: 'Vim Dishwash Gel Lemon Liquid', category: 'Household', weight_value: 500, weight_unit: 'ml', weight_kg: 0.5, mrp: 125, sale_price: 108, stock: 180, image_url: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500' },
  { name: 'Harpic Power Plus Disinfectant Toilet Cleaner', category: 'Household', weight_value: 1, weight_unit: 'L', weight_kg: 1.0, mrp: 215, sale_price: 188, stock: 120, image_url: 'https://images.unsplash.com/photo-1585421514284-efb74c2b69ba?w=500' },
];

async function seedDemoVendorAndProducts() {
  console.log('--- Seeding Demo Vendor Account & 50 Products ---');
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Create or Find Demo Vendor User
    let vendorId;
    const [existingUsers] = await connection.query(
      "SELECT id FROM users WHERE (email = ? OR phone = ?) AND role = 'Vendor' AND is_deleted = 0 LIMIT 1",
      [DEMO_VENDOR.email, DEMO_VENDOR.phone]
    );

    if (existingUsers && existingUsers.length > 0) {
      vendorId = existingUsers[0].id;
      console.log(`[Vendor Found] Existing Demo Vendor User ID: ${vendorId}`);
    } else {
      const passwordHash = await bcrypt.hash(DEMO_VENDOR.password, 10);
      const [userRes] = await connection.query(
        `INSERT INTO users (name, email, phone, password, role, status)
         VALUES (?, ?, ?, ?, 'Vendor', 'active') RETURNING id`,
        [DEMO_VENDOR.name, DEMO_VENDOR.email, DEMO_VENDOR.phone, passwordHash]
      );
      vendorId = userRes[0] ? userRes[0].id : (userRes.insertId || userRes.id);
      console.log(`[Vendor Created] New Demo Vendor User ID: ${vendorId}`);
    }

    // 2. Create or Update Vendor Profile
    const [existingProf] = await connection.query('SELECT id FROM vendor_profiles WHERE user_id = ? LIMIT 1', [vendorId]);
    if (existingProf && existingProf.length > 0) {
      await connection.query(
        `UPDATE vendor_profiles 
         SET business_name = ?, address = ?, city = ?, state = ?, country = ?, area = ?, gst_number = ?, services = ?, is_premium_vendor = 1
         WHERE user_id = ?`,
        [
          DEMO_VENDOR.business_name,
          DEMO_VENDOR.address,
          DEMO_VENDOR.city,
          DEMO_VENDOR.state,
          DEMO_VENDOR.country,
          DEMO_VENDOR.area,
          DEMO_VENDOR.gst_number,
          JSON.stringify(DEMO_VENDOR.services),
          vendorId,
        ]
      );
    } else {
      await connection.query(
        `INSERT INTO vendor_profiles 
         (user_id, business_name, address, city, state, country, area, gst_number, services, is_premium_vendor, premium_commission_percent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 5)`,
        [
          vendorId,
          DEMO_VENDOR.business_name,
          DEMO_VENDOR.address,
          DEMO_VENDOR.city,
          DEMO_VENDOR.state,
          DEMO_VENDOR.country,
          DEMO_VENDOR.area,
          DEMO_VENDOR.gst_number,
          JSON.stringify(DEMO_VENDOR.services),
        ]
      );
    }
    console.log('[Vendor Profile Created/Updated]');

    // 3. Link Vendor to Categories
    const [categories] = await connection.query('SELECT id, name FROM categories WHERE is_deleted = 0');
    if (categories && categories.length > 0) {
      for (const cat of categories) {
        const [existCat] = await connection.query(
          'SELECT 1 FROM vendor_categories WHERE vendor_id = ? AND category_id = ? LIMIT 1',
          [vendorId, cat.id]
        );
        if (!existCat || existCat.length === 0) {
          await connection.query(
            'INSERT INTO vendor_categories (vendor_id, category_id) VALUES (?, ?)',
            [vendorId, cat.id]
          );
        }
      }
      console.log(`[Vendor Categories Linked] ${categories.length} categories assigned.`);
    }

    const defaultCatId = categories && categories.length ? categories[0].id : 1;

    // 4. Seed 50 Products
    let createdCount = 0;
    for (let i = 0; i < PRODUCTS_50.length; i++) {
      const p = PRODUCTS_50[i];

      // Find matching category or fallback
      const matchedCat = categories.find((c) => c.name.toLowerCase().includes(p.category.toLowerCase())) || categories[0] || { id: defaultCatId };
      const categoryId = matchedCat.id;

      // Check if product exists by name
      let productId;
      const [existingProd] = await connection.query(
        'SELECT id FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND is_deleted = 0 LIMIT 1',
        [p.name]
      );

      if (existingProd && existingProd.length > 0) {
        productId = existingProd[0].id;
        await connection.query(
          `UPDATE products 
           SET price = ?, weight_value = ?, weight_unit = ?, weight_kg = ?, image_url = ?, approval_status = 'approved', created_by_vendor_id = ?
           WHERE id = ?`,
          [p.mrp, p.weight_value, p.weight_unit, p.weight_kg, p.image_url, vendorId, productId]
        );
      } else {
        const [prodRes] = await connection.query(
          `INSERT INTO products 
           (name, description, price, weight_value, weight_unit, weight_kg, image_url, category_id, approval_status, created_by_vendor_id, approved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP) RETURNING id`,
          [
            p.name,
            `Fresh & premium quality ${p.name}. Sourced daily for maximum freshness and quality guarantee.`,
            p.mrp,
            p.weight_value,
            p.weight_unit,
            p.weight_kg,
            p.image_url,
            categoryId,
            vendorId,
          ]
        );
        productId = prodRes[0] ? prodRes[0].id : (prodRes.insertId || prodRes.id);
      }

      // Link to vendor_products
      const [existVP] = await connection.query(
        'SELECT id FROM vendor_products WHERE product_id = ? AND vendor_id = ? LIMIT 1',
        [productId, vendorId]
      );

      if (existVP && existVP.length > 0) {
        await connection.query(
          'UPDATE vendor_products SET quantity = ?, price = ?, status = \'available\' WHERE product_id = ? AND vendor_id = ?',
          [p.stock, p.sale_price, productId, vendorId]
        );
      } else {
        await connection.query(
          'INSERT INTO vendor_products (product_id, vendor_id, quantity, price, status) VALUES (?, ?, ?, ?, \'available\')',
          [productId, vendorId, p.stock, p.sale_price]
        );
      }

      createdCount++;
    }

    await connection.commit();
    console.log(`--- SUCCESS: Demo Vendor created (ID: ${vendorId}) with ${createdCount} Products! ---`);
  } catch (err) {
    await connection.rollback();
    console.error('ERROR seeding demo vendor & products:', err.message, err.stack);
  } finally {
    connection.release();
    process.exit(0);
  }
}

seedDemoVendorAndProducts();
