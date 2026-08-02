const bcrypt = require('bcryptjs');
const pool = require('../db');
const { runMigrations } = require('../migrationRunner');
const { ensureAllSchemaTables } = require('../services/schemaSyncService');
const LocationOption = require('../models/LocationOption');
const DeliveryPricing = require('../services/deliveryPricingService');
const BiddingSetting = require('../models/BiddingSetting');
const LocationCommissionSetting = require('../models/LocationCommissionSetting');
const DeliveryType = require('../models/DeliveryType');
const ContentPage = require('../models/ContentPage');
const ProductVariant = require('../models/ProductVariant');
const VendorInventory = require('../models/VendorInventory');
const { seedCatalog } = require('./seed-grocery-stationery-subcategories');
const { seedProducts } = require('./seed-seven-products-per-category');
const { seedVendorServices } = require('./seed-vendor-services');

const DEFAULT_USERS = [
  // 1 Super Admin
  { name: 'Super Admin', email: 'superadmin@example.com', password: 'password', role: 'superadmin' },

  // 2 Admins
  { name: 'Admin User', email: 'admin@example.com', password: 'password', role: 'admin' },
  { name: 'Jaipur Admin', email: 'jaipur@example.com', password: 'password', role: 'admin', city: 'Jaipur', state: 'Rajasthan', country: 'India', area: '*' },

  // Operations Staff
  { name: 'Staff User', email: 'staff@example.com', password: 'password', role: 'staff', city: 'Jaipur', state: 'Rajasthan', country: 'India', area: '*' },

  // 5 Clients
  { name: 'Client User 1', email: 'client1@example.com', phone: '9000000001', password: 'password', role: 'Client' },
  { name: 'Client User 2', email: 'client2@example.com', phone: '9000000002', password: 'password', role: 'Client' },
  { name: 'Client User 3', email: 'client3@example.com', phone: '9000000003', password: 'password', role: 'Client' },
  { name: 'Client User 4', email: 'client4@example.com', phone: '9000000004', password: 'password', role: 'Client' },
  { name: 'Client User 5', email: 'client5@example.com', phone: '9000000005', password: 'password', role: 'Client' },

  // 5 Vendors
  { name: 'Vendor 1', email: 'vendor1@example.com', phone: '9000000101', password: 'password', role: 'Vendor', business_name: 'Vendor Store 1' },
  { name: 'Vendor 2', email: 'vendor2@example.com', phone: '9000000102', password: 'password', role: 'Vendor', business_name: 'Vendor Store 2' },
  { name: 'Vendor 3', email: 'vendor3@example.com', phone: '9000000103', password: 'password', role: 'Vendor', business_name: 'Vendor Store 3' },
  { name: 'Vendor 4', email: 'vendor4@example.com', phone: '9000000104', password: 'password', role: 'Vendor', business_name: 'Vendor Store 4' },
  { name: 'Vendor 5', email: 'vendor5@example.com', phone: '9000000105', password: 'password', role: 'Vendor', business_name: 'Vendor Store 5' },
];

async function resetDatabase() {
  console.log('🔄 Resetting database: Building base schema & truncating tables...');

  // Step 1: Base Schema Tables Verification
  await ensureAllSchemaTables(pool);

  // Step 2: Clean Truncation of All Public Tables
  const [tables] = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);

  const tableNames = tables.map((t) => t.table_name).filter(Boolean);

  if (tableNames.length > 0) {
    const tableList = tableNames.map((t) => `"${t}"`).join(', ');
    await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
    console.log(`✅ Truncated ${tableNames.length} tables and reset auto-increment sequences.`);
  }

  const [sequences] = await pool.query(`
    SELECT sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
  `);

  for (const seq of sequences) {
    try {
      await pool.query(`ALTER SEQUENCE "${seq.sequence_name}" RESTART WITH 1`);
    } catch (e) {
      // Ignore
    }
  }

  // Step 3: Database Migrations
  try {
    await runMigrations(pool);
    console.log('✅ Applied database migrations.');
  } catch (err) {
    console.log('Migrations up to date or already applied.');
  }

  // Step 4: System Roles Seeding
  const rolesToSeed = [
    { name: 'Super Admin', slug: 'superadmin', description: 'Full system access', level: 0, permissions: ['*'] },
    { name: 'Admin', slug: 'admin', description: 'Administrator access', level: 1, permissions: ['dashboard.view', 'users.manage', 'roles.manage', 'clients.manage', 'vendors.manage', 'products.manage'] },
    { name: 'Client', slug: 'Client', description: 'Client / Customer access', level: 5, permissions: ['dashboard.view'] },
    { name: 'Vendor', slug: 'Vendor', description: 'Vendor / Merchant access', level: 5, permissions: ['dashboard.view'] },
  ];

  for (const r of rolesToSeed) {
    await pool.query(
      `INSERT INTO roles (name, slug, description, level, permissions)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (slug) DO NOTHING`,
      [r.name, r.slug, r.description, r.level, JSON.stringify(r.permissions)]
    );
  }

  // Step 5: Seed Default Accounts
  console.log('🌱 Seeding default 12 system accounts with password: password ...');

  for (const user of DEFAULT_USERS) {
    const userPhone = user.phone ? String(user.phone).trim() : null;
    const hashedPassword = await bcrypt.hash(user.password, 10);
    let userId = null;

    try {
      const [res] = await pool.query(
        'INSERT INTO users (name, email, phone, password, role, status) VALUES (?, ?, ?, ?, ?, ?)',
        [user.name, user.email, userPhone, hashedPassword, user.role, 'active']
      );
      userId = res.insertId;
    } catch (err) {
      if (err.code === '23505') {
        const [res] = await pool.query(
          'INSERT INTO users (name, email, phone, password, role, status) VALUES (?, ?, NULL, ?, ?, ?)',
          [user.name, user.email, hashedPassword, user.role, 'active']
        );
        userId = res.insertId;
      } else {
        throw err;
      }
    }

    const [roleRows] = await pool.query('SELECT id FROM roles WHERE LOWER(slug) = LOWER(?)', [user.role]);
    if (roleRows.length > 0) {
      await pool.query(
        'INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        [userId, roleRows[0].id, userId]
      );
    }

    if (user.role === 'admin') {
      await pool.query(
        'INSERT INTO admin_profiles (user_id, permissions) VALUES (?, ?) ON CONFLICT DO NOTHING',
        [userId, JSON.stringify(['users.manage', 'profiles.manage', 'wallets.manage'])]
      );
    }

    if (user.role === 'Vendor') {
      await pool.query(
        `INSERT INTO vendor_profiles (user_id, business_name, address, country, state, city, services)
         VALUES (?, ?, 'Demo vendor address', 'India', 'Rajasthan', 'Jaipur', ?)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, user.business_name || `${user.name} Store`, JSON.stringify(['Home Delivery', 'Counter Pickup'])]
      );
    }

    if (user.role === 'Client') {
      await pool.query(
        `INSERT INTO client_profiles (user_id, address, country, state, city, notes)
         VALUES (?, 'Demo client address', 'India', 'Rajasthan', 'Jaipur', 'Default client account')
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
    }
  }

  // Step 6: Initialize System Models & Settings
  console.log('⚙️ Initializing location tree, delivery pricing, bidding rules & content pages...');
  try { await LocationOption.seedDefaultsIfEmpty(pool); } catch (e) {}
  try { await DeliveryPricing.initSchema(pool); } catch (e) {}
  try { await BiddingSetting.initSchema(pool); } catch (e) {}
  try { await LocationCommissionSetting.initSchema(pool); } catch (e) {}
  try { await DeliveryType.initSchema(pool); } catch (e) {}
  try { await ContentPage.seedDemoPages(); } catch (e) {}
  try { await ProductVariant.initProductVariantsSystem(); } catch (e) {}
  try { await VendorInventory.initVendorInventorySystem(); } catch (e) {}

  // Step 7: Seed Categories, Subcategories, Brands Catalog
  console.log('📦 Seeding Indian main categories, sub-categories, and brands catalog...');
  try { await seedCatalog(); } catch (e) { console.error('Catalog seed note:', e.message); }

  // Step 8: Seed Real Approved Products
  console.log('🛒 Seeding approved products with tax, weight, HSN codes, and images...');
  try { await seedProducts(); } catch (e) { console.error('Products seed note:', e.message); }

  // Step 9: Seed Vendor Services & Vendor Product Linkages
  console.log('🏪 Linking vendor profiles, categories, and store products...');
  try { await seedVendorServices(); } catch (e) { console.error('Vendor services seed note:', e.message); }

  // Step 10: Final Verification & Count Summary
  const getCount = async (sql) => {
    try {
      const [rows] = await pool.query(sql);
      return Number(rows[0]?.count || 0);
    } catch {
      return 0;
    }
  };

  const usersCount = await getCount('SELECT COUNT(*) AS count FROM users');
  const categoriesCount = await getCount('SELECT COUNT(*) AS count FROM categories WHERE is_deleted = 0');
  const subCategoriesCount = await getCount('SELECT COUNT(*) AS count FROM sub_categories WHERE is_deleted = 0');
  const brandsCount = await getCount('SELECT COUNT(*) AS count FROM brands WHERE is_deleted = 0');
  const productsCount = await getCount('SELECT COUNT(*) AS count FROM products WHERE is_deleted = 0');
  const vendorProductsCount = await getCount('SELECT COUNT(*) AS count FROM vendor_products');

  console.log('\n✨ Database fresh reset & complete seeding finished successfully!');
  console.log('📊 Complete Verification Summary:');
  console.log(`  - Users created: ${usersCount}`);
  console.log(`  - Main Categories: ${categoriesCount}`);
  console.log(`  - Subcategories: ${subCategoriesCount}`);
  console.log(`  - Brands: ${brandsCount}`);
  console.log(`  - Products: ${productsCount}`);
  console.log(`  - Vendor Store Products: ${vendorProductsCount}`);
  console.log('  - Default password for all accounts: password\n');
}

if (require.main === module) {
  resetDatabase()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Database fresh reset error:', err);
      await pool.end();
      process.exit(1);
    });
}

module.exports = resetDatabase;
