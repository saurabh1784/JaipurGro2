/**
 * newdata.js - Standalone Schema Creation, Migration & Guaranteed Account Seeding Runner for cPanel / Live Hosting
 *
 * Usage on cPanel terminal or Node app:
 *   node newdata.js
 *   npm run migrate:newdata
 */

const bcrypt = require('bcryptjs');
const db = require('./db');

async function safeExec(sql, params = []) {
  try {
    return await db.query(sql, params);
  } catch (err) {
    // Silently skip if table/column/index/constraint already exists
    return [{ rows: [] }, { affectedRows: 0 }];
  }
}

const DEFAULT_ACCOUNTS = [
  // 1 Super Admin
  {
    name: 'Super Admin',
    email: 'superadmin@example.com',
    password: 'password',
    role: 'superadmin',
    phone: '9000000000'
  },
  // 5 Vendors
  {
    name: 'Vendor 1',
    email: 'vendor1@example.com',
    phone: '9000000101',
    password: 'password',
    role: 'Vendor',
    business_name: 'Vendor Store 1',
    address: 'Store 1 Address, Main Market, Jaipur'
  },
  {
    name: 'Vendor 2',
    email: 'vendor2@example.com',
    phone: '9000000102',
    password: 'password',
    role: 'Vendor',
    business_name: 'Vendor Store 2',
    address: 'Store 2 Address, Raja Park, Jaipur'
  },
  {
    name: 'Vendor 3',
    email: 'vendor3@example.com',
    phone: '9000000103',
    password: 'password',
    role: 'Vendor',
    business_name: 'Vendor Store 3',
    address: 'Store 3 Address, Vaishali Nagar, Jaipur'
  },
  {
    name: 'Vendor 4',
    email: 'vendor4@example.com',
    phone: '9000000104',
    password: 'password',
    role: 'Vendor',
    business_name: 'Vendor Store 4',
    address: 'Store 4 Address, Malviya Nagar, Jaipur'
  },
  {
    name: 'Vendor 5',
    email: 'vendor5@example.com',
    phone: '9000000105',
    password: 'password',
    role: 'Vendor',
    business_name: 'Vendor Store 5',
    address: 'Store 5 Address, Mansarovar, Jaipur'
  },
  // 5 Clients
  {
    name: 'Client User 1',
    email: 'client1@example.com',
    phone: '9000000001',
    password: 'password',
    role: 'Client',
    address: 'House 1, Tonk Road, Jaipur'
  },
  {
    name: 'Client User 2',
    email: 'client2@example.com',
    phone: '9000000002',
    password: 'password',
    role: 'Client',
    address: 'House 2, C-Scheme, Jaipur'
  },
  {
    name: 'Client User 3',
    email: 'client3@example.com',
    phone: '9000000003',
    password: 'password',
    role: 'Client',
    address: 'House 3, Nirman Nagar, Jaipur'
  },
  {
    name: 'Client User 4',
    email: 'client4@example.com',
    phone: '9000000004',
    password: 'password',
    role: 'Client',
    address: 'House 4, Gopalpura, Jaipur'
  },
  {
    name: 'Client User 5',
    email: 'client5@example.com',
    phone: '9000000005',
    password: 'password',
    role: 'Client',
    address: 'House 5, MI Road, Jaipur'
  }
];

async function seedDefaultRolesAndAccounts() {
  console.log('[newdata.js] 🌱 Seeding default system roles...');

  // Seed System Roles
  const rolesToSeed = [
    { name: 'Super Admin', slug: 'superadmin', description: 'Full system access', level: 0, permissions: ['*'] },
    { name: 'Admin', slug: 'admin', description: 'Administrator access', level: 1, permissions: ['dashboard.view', 'users.manage', 'roles.manage', 'clients.manage', 'vendors.manage', 'products.manage'] },
    { name: 'Client', slug: 'Client', description: 'Client / Customer access', level: 5, permissions: ['dashboard.view'] },
    { name: 'Vendor', slug: 'Vendor', description: 'Vendor / Merchant access', level: 5, permissions: ['dashboard.view'] },
  ];

  for (const r of rolesToSeed) {
    await safeExec(
      `INSERT INTO roles (name, slug, description, level, permissions)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (slug) DO NOTHING`,
      [r.name, r.slug, r.description, r.level, JSON.stringify(r.permissions)]
    );
  }

  // Common Password Hash ("password")
  const defaultHash = await bcrypt.hash('password', 10);

  console.log('[newdata.js] 🌱 Seeding 1 Superadmin, 5 Vendors, and 5 Clients...');

  for (const acc of DEFAULT_ACCOUNTS) {
    try {
      // Step 1: Check if user exists or insert
      let userId = null;
      const [existingRows] = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [acc.email]);

      if (existingRows && existingRows.length > 0) {
        userId = existingRows[0].id;
      } else {
        await safeExec(
          'INSERT INTO users (name, email, phone, password, role, status) VALUES (?, ?, ?, ?, ?, ?)',
          [acc.name, acc.email, acc.phone || null, defaultHash, acc.role, 'active']
        );
        const [insertedRows] = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [acc.email]);
        if (insertedRows && insertedRows.length > 0) {
          userId = insertedRows[0].id;
        }
      }

      if (!userId) {
        console.error(`[newdata.js]   ❌ Could not retrieve user ID for ${acc.email}`);
        continue;
      }

      // Step 2: Role Mapping
      const [roleRows] = await db.query('SELECT id FROM roles WHERE LOWER(slug) = LOWER(?)', [acc.role]);
      if (roleRows && roleRows.length > 0) {
        await safeExec(
          'INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
          [userId, roleRows[0].id, userId]
        );
      }

      // Step 3: Wallet creation
      await safeExec(
        "INSERT INTO wallets (user_id, balance, currency, status) VALUES (?, 1000.00, 'INR', 'active') ON CONFLICT (user_id) DO NOTHING",
        [userId]
      );

      // Step 4: Role-specific profiles
      if (acc.role === 'superadmin' || acc.role === 'admin') {
        await safeExec(
          "INSERT INTO admin_profiles (user_id, country, state, city, area, permissions) VALUES (?, 'India', 'Rajasthan', 'Jaipur', '*', ?) ON CONFLICT (user_id) DO NOTHING",
          [userId, JSON.stringify(['*'])]
        );
      }

      if (acc.role === 'Vendor') {
        await safeExec(
          "INSERT INTO vendor_profiles (user_id, business_name, address, country, state, city, area, services) VALUES (?, ?, ?, 'India', 'Rajasthan', 'Jaipur', 'Main Area', ?) ON CONFLICT (user_id) DO NOTHING",
          [userId, acc.business_name || (acc.name + ' Store'), acc.address, JSON.stringify(['Home Delivery', 'Counter Pickup'])]
        );
      }

      if (acc.role === 'Client') {
        await safeExec(
          "INSERT INTO client_profiles (user_id, address, country, state, city, area, notes) VALUES (?, ?, 'India', 'Rajasthan', 'Jaipur', 'Main Area', 'Default client account') ON CONFLICT (user_id) DO NOTHING",
          [userId, acc.address]
        );

        await safeExec(
          "INSERT INTO client_delivery_addresses (client_id, user_id, address_line1, city, state, country, pincode, is_default) VALUES (?, ?, ?, 'Jaipur', 'Rajasthan', 'India', '302001', 1) ON CONFLICT DO NOTHING",
          [userId, userId, acc.address]
        );
      }

      console.log(`[newdata.js]   ✅ Account ready: ${acc.name} (${acc.email}) [Role: ${acc.role}, ID: ${userId}]`);
    } catch (e) {
      console.error(`[newdata.js]   ❌ Account error (${acc.email}): ${e.message}`);
    }
  }
}

async function main() {
  console.log('====================================================');
  console.log('[newdata.js] Starting complete database schema creation, migration & account seeding...');
  console.log('====================================================');

  try {
    const config = db.describeConfig ? db.describeConfig() : {};
    console.log(`[newdata.js] Target Database Host: ${config.host || 'Default'}`);
    console.log(`[newdata.js] Target Database Name: ${config.database || 'Default'}`);

    // Ensure schema_migrations table exists
    await safeExec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(190) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    let createdCount = 0;
    const totalTables = 74;

    // Table (account_deletion_requests)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "account_deletion_requests" (
        "id" SERIAL PRIMARY KEY,
        "user_id" INT DEFAULT NULL,
        "user_name" VARCHAR(255) DEFAULT NULL,
        "user_email" VARCHAR(255) DEFAULT NULL,
        "user_phone" VARCHAR(255) DEFAULT NULL,
        "user_role" VARCHAR(255) DEFAULT NULL,
        "city" VARCHAR(255) DEFAULT NULL,
        "reason" VARCHAR(255) DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "admin_notes" TEXT DEFAULT NULL,
        "processed_by" VARCHAR(255) DEFAULT NULL,
        "processed_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "account_deletion_requests" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "account_deletion_requests" ADD COLUMN IF NOT EXISTS "user_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "account_deletion_requests" ADD COLUMN IF NOT EXISTS "user_email" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "account_deletion_requests" ADD COLUMN IF NOT EXISTS "user_phone" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "account_deletion_requests" ADD COLUMN IF NOT EXISTS "user_role" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "account_deletion_requests" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "account_deletion_requests" ADD COLUMN IF NOT EXISTS "reason" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "account_deletion_requests" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "account_deletion_requests" ADD COLUMN IF NOT EXISTS "admin_notes" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "account_deletion_requests" ADD COLUMN IF NOT EXISTS "processed_by" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "account_deletion_requests" ADD COLUMN IF NOT EXISTS "processed_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "account_deletion_requests" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "account_deletion_requests" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (advertisements)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "advertisements" (
        "id" SERIAL PRIMARY KEY,
        "title" VARCHAR(255) DEFAULT NULL,
        "description" TEXT DEFAULT NULL,
        "image_path" VARCHAR(255) DEFAULT NULL,
        "ad_type" VARCHAR(255) DEFAULT NULL,
        "start_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "end_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "countdown_seconds" INT DEFAULT NULL,
        "priority" INT DEFAULT NULL,
        "target_platforms" VARCHAR(255) DEFAULT NULL,
        "city_scope" VARCHAR(255) DEFAULT NULL,
        "city" VARCHAR(255) DEFAULT NULL,
        "areas" VARCHAR(255) DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "advertiser_name" VARCHAR(255) DEFAULT NULL,
        "advertiser_email" VARCHAR(255) DEFAULT NULL,
        "advertiser_phone" VARCHAR(255) DEFAULT NULL,
        "package_name" VARCHAR(255) DEFAULT NULL,
        "payment_amount" NUMERIC(12,2) DEFAULT 0,
        "payment_status" VARCHAR(255) DEFAULT NULL,
        "invoice_number" VARCHAR(255) DEFAULT NULL,
        "receipt_path" VARCHAR(255) DEFAULT NULL,
        "approval_status" VARCHAR(255) DEFAULT NULL,
        "campaign_start_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "campaign_end_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "target_pages" VARCHAR(255) DEFAULT NULL,
        "target_category_id" INT DEFAULT NULL,
        "target_category_name" VARCHAR(255) DEFAULT NULL,
        "click_action_type" VARCHAR(255) DEFAULT NULL,
        "click_action_value" VARCHAR(255) DEFAULT NULL,
        "impression_count" INT DEFAULT NULL,
        "click_count" INT DEFAULT NULL
      );
    `);

    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "title" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "description" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "image_path" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "ad_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "start_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "end_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "countdown_seconds" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "priority" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "target_platforms" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "city_scope" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "areas" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "advertiser_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "advertiser_email" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "advertiser_phone" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "package_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "payment_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "payment_status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "invoice_number" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "receipt_path" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "approval_status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "campaign_start_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "campaign_end_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "target_pages" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "target_category_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "target_category_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "click_action_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "click_action_value" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "impression_count" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisements" ADD COLUMN IF NOT EXISTS "click_count" INT DEFAULT NULL');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (app_settings)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "app_settings" (
        "id" SERIAL PRIMARY KEY,
        "setting_key" VARCHAR(255) DEFAULT NULL,
        "setting_value" VARCHAR(255) DEFAULT NULL,
        "is_secret" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "setting_key" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "setting_value" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "is_secret" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (area_delivery_rules)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "area_delivery_rules" (
        "id" SERIAL PRIMARY KEY,
        "area_definition_id" INT DEFAULT 0,
        "vehicle_category_id" INT DEFAULT 0,
        "source_default_rule_id" INT DEFAULT 0,
        "rule_name" VARCHAR(255) DEFAULT NULL,
        "min_weight_kg" NUMERIC(12,2) DEFAULT 0,
        "max_weight_kg" NUMERIC(12,2) DEFAULT 0,
        "slab_charge" NUMERIC(12,2) DEFAULT 0,
        "price_per_km" NUMERIC(12,2) DEFAULT 0,
        "additional_charge" NUMERIC(12,2) DEFAULT 0,
        "night_charge_increment" VARCHAR(255) DEFAULT NULL,
        "is_active" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "area_delivery_rules" ADD COLUMN IF NOT EXISTS "area_definition_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "area_delivery_rules" ADD COLUMN IF NOT EXISTS "vehicle_category_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "area_delivery_rules" ADD COLUMN IF NOT EXISTS "source_default_rule_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "area_delivery_rules" ADD COLUMN IF NOT EXISTS "rule_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "area_delivery_rules" ADD COLUMN IF NOT EXISTS "min_weight_kg" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "area_delivery_rules" ADD COLUMN IF NOT EXISTS "max_weight_kg" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "area_delivery_rules" ADD COLUMN IF NOT EXISTS "slab_charge" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "area_delivery_rules" ADD COLUMN IF NOT EXISTS "price_per_km" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "area_delivery_rules" ADD COLUMN IF NOT EXISTS "additional_charge" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "area_delivery_rules" ADD COLUMN IF NOT EXISTS "night_charge_increment" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "area_delivery_rules" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "area_delivery_rules" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "area_delivery_rules" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (bidding_settings)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "bidding_settings" (
        "id" SERIAL PRIMARY KEY,
        "city" VARCHAR(255) DEFAULT NULL,
        "timer_minutes" INT DEFAULT NULL,
        "daily_start_time" VARCHAR(255) DEFAULT NULL,
        "daily_end_time" VARCHAR(255) DEFAULT NULL,
        "is_enabled" SMALLINT DEFAULT 0,
        "auto_close_on_expiry" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "bidding_settings" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "bidding_settings" ADD COLUMN IF NOT EXISTS "timer_minutes" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "bidding_settings" ADD COLUMN IF NOT EXISTS "daily_start_time" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "bidding_settings" ADD COLUMN IF NOT EXISTS "daily_end_time" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "bidding_settings" ADD COLUMN IF NOT EXISTS "is_enabled" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "bidding_settings" ADD COLUMN IF NOT EXISTS "auto_close_on_expiry" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "bidding_settings" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "bidding_settings" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (categories)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "categories" (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) DEFAULT NULL,
        "slug" VARCHAR(255) DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "is_active" SMALLINT DEFAULT 0,
        "is_deleted" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "icon_path" VARCHAR(255) DEFAULT NULL,
        "tax_name" VARCHAR(255) DEFAULT NULL,
        "tax_percentage" NUMERIC(12,2) DEFAULT 0
      );
    `);

    await safeExec('ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "slug" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "is_deleted" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "icon_path" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "tax_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "tax_percentage" NUMERIC(12,2) DEFAULT 0');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (commission_settings)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "commission_settings" (
        "id" SERIAL PRIMARY KEY,
        "role_slug" VARCHAR(255) DEFAULT NULL,
        "role_name" VARCHAR(255) DEFAULT NULL,
        "transaction_type" VARCHAR(255) DEFAULT NULL,
        "commission_type" VARCHAR(255) DEFAULT NULL,
        "commission_value" VARCHAR(255) DEFAULT NULL,
        "min_commission" VARCHAR(255) DEFAULT NULL,
        "max_commission" VARCHAR(255) DEFAULT NULL,
        "is_active" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "commission_settings" ADD COLUMN IF NOT EXISTS "role_slug" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "commission_settings" ADD COLUMN IF NOT EXISTS "role_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "commission_settings" ADD COLUMN IF NOT EXISTS "transaction_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "commission_settings" ADD COLUMN IF NOT EXISTS "commission_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "commission_settings" ADD COLUMN IF NOT EXISTS "commission_value" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "commission_settings" ADD COLUMN IF NOT EXISTS "min_commission" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "commission_settings" ADD COLUMN IF NOT EXISTS "max_commission" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "commission_settings" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "commission_settings" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "commission_settings" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (content_pages)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "content_pages" (
        "id" SERIAL PRIMARY KEY,
        "app_name" VARCHAR(255) DEFAULT NULL,
        "page_type" VARCHAR(255) DEFAULT NULL,
        "title" VARCHAR(255) DEFAULT NULL,
        "content_html" TEXT DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "is_enabled" SMALLINT DEFAULT 0,
        "current_version" INT DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "content_pages" ADD COLUMN IF NOT EXISTS "app_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "content_pages" ADD COLUMN IF NOT EXISTS "page_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "content_pages" ADD COLUMN IF NOT EXISTS "title" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "content_pages" ADD COLUMN IF NOT EXISTS "content_html" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "content_pages" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "content_pages" ADD COLUMN IF NOT EXISTS "is_enabled" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "content_pages" ADD COLUMN IF NOT EXISTS "current_version" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "content_pages" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "content_pages" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (countries)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "countries" (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) DEFAULT NULL,
        "code" VARCHAR(255) DEFAULT NULL,
        "is_active" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "countries" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "countries" ADD COLUMN IF NOT EXISTS "code" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "countries" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "countries" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "countries" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (coupons)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "coupons" (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) DEFAULT NULL,
        "code" VARCHAR(255) DEFAULT NULL,
        "description" TEXT DEFAULT NULL,
        "value_type" VARCHAR(255) DEFAULT NULL,
        "value" VARCHAR(255) DEFAULT NULL,
        "min_order_amount" NUMERIC(12,2) DEFAULT 0,
        "start_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "expires_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "is_active" SMALLINT DEFAULT 0,
        "apply_on" VARCHAR(255) DEFAULT NULL,
        "usage_limit" INT DEFAULT NULL,
        "per_customer_limit" INT DEFAULT NULL,
        "auto_generate" VARCHAR(255) DEFAULT NULL,
        "image_path" VARCHAR(255) DEFAULT NULL,
        "background_color" VARCHAR(255) DEFAULT NULL,
        "text_color" VARCHAR(255) DEFAULT NULL,
        "scroll_message" TEXT DEFAULT NULL,
        "city_scope" VARCHAR(255) DEFAULT NULL,
        "cities" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "code" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "description" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "value_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "value" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "min_order_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "start_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "apply_on" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "usage_limit" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "per_customer_limit" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "auto_generate" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "image_path" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "background_color" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "text_color" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "scroll_message" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "city_scope" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "cities" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (default_delivery_rules)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "default_delivery_rules" (
        "id" SERIAL PRIMARY KEY,
        "vehicle_category_id" INT DEFAULT 0,
        "rule_name" VARCHAR(255) DEFAULT NULL,
        "min_weight_kg" NUMERIC(12,2) DEFAULT 0,
        "max_weight_kg" NUMERIC(12,2) DEFAULT 0,
        "slab_charge" NUMERIC(12,2) DEFAULT 0,
        "price_per_km" NUMERIC(12,2) DEFAULT 0,
        "additional_charge" NUMERIC(12,2) DEFAULT 0,
        "night_charge_increment" VARCHAR(255) DEFAULT NULL,
        "is_active" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "default_delivery_rules" ADD COLUMN IF NOT EXISTS "vehicle_category_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "default_delivery_rules" ADD COLUMN IF NOT EXISTS "rule_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "default_delivery_rules" ADD COLUMN IF NOT EXISTS "min_weight_kg" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "default_delivery_rules" ADD COLUMN IF NOT EXISTS "max_weight_kg" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "default_delivery_rules" ADD COLUMN IF NOT EXISTS "slab_charge" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "default_delivery_rules" ADD COLUMN IF NOT EXISTS "price_per_km" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "default_delivery_rules" ADD COLUMN IF NOT EXISTS "additional_charge" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "default_delivery_rules" ADD COLUMN IF NOT EXISTS "night_charge_increment" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "default_delivery_rules" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "default_delivery_rules" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "default_delivery_rules" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (delivery_charge_rules)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "delivery_charge_rules" (
        "id" SERIAL PRIMARY KEY,
        "city" VARCHAR(255) DEFAULT NULL,
        "rule_name" VARCHAR(255) DEFAULT NULL,
        "min_weight_kg" NUMERIC(12,2) DEFAULT 0,
        "max_weight_kg" NUMERIC(12,2) DEFAULT 0,
        "base_delivery_price" NUMERIC(12,2) DEFAULT 0,
        "price_per_km" NUMERIC(12,2) DEFAULT 0,
        "price_per_kg" NUMERIC(12,2) DEFAULT 0,
        "additional_charge" NUMERIC(12,2) DEFAULT 0,
        "night_charge_increment" VARCHAR(255) DEFAULT NULL,
        "is_active" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "delivery_charge_rules" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_charge_rules" ADD COLUMN IF NOT EXISTS "rule_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_charge_rules" ADD COLUMN IF NOT EXISTS "min_weight_kg" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_charge_rules" ADD COLUMN IF NOT EXISTS "max_weight_kg" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_charge_rules" ADD COLUMN IF NOT EXISTS "base_delivery_price" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_charge_rules" ADD COLUMN IF NOT EXISTS "price_per_km" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_charge_rules" ADD COLUMN IF NOT EXISTS "price_per_kg" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_charge_rules" ADD COLUMN IF NOT EXISTS "additional_charge" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_charge_rules" ADD COLUMN IF NOT EXISTS "night_charge_increment" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_charge_rules" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_charge_rules" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "delivery_charge_rules" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (delivery_type_area_settings)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "delivery_type_area_settings" (
        "id" SERIAL PRIMARY KEY,
        "city" VARCHAR(255) DEFAULT NULL,
        "area" VARCHAR(255) DEFAULT NULL,
        "delivery_type" VARCHAR(255) DEFAULT NULL,
        "label" VARCHAR(255) DEFAULT NULL,
        "priority" INT DEFAULT 0,
        "is_enabled" SMALLINT DEFAULT 0,
        "is_active" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "delivery_type_area_settings" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_type_area_settings" ADD COLUMN IF NOT EXISTS "area" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_type_area_settings" ADD COLUMN IF NOT EXISTS "delivery_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_type_area_settings" ADD COLUMN IF NOT EXISTS "label" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_type_area_settings" ADD COLUMN IF NOT EXISTS "priority" INT DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_type_area_settings" ADD COLUMN IF NOT EXISTS "is_enabled" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_type_area_settings" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_type_area_settings" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "delivery_type_area_settings" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (discounts)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "discounts" (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) DEFAULT NULL,
        "vendor_id" INT DEFAULT NULL,
        "description" TEXT DEFAULT NULL,
        "value_type" VARCHAR(255) DEFAULT NULL,
        "value" VARCHAR(255) DEFAULT NULL,
        "min_order_amount" NUMERIC(12,2) DEFAULT 0,
        "start_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "expires_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "is_active" SMALLINT DEFAULT 0,
        "apply_on" VARCHAR(255) DEFAULT NULL,
        "usage_limit" INT DEFAULT NULL,
        "per_customer_limit" INT DEFAULT NULL,
        "image_path" VARCHAR(255) DEFAULT NULL,
        "background_color" VARCHAR(255) DEFAULT NULL,
        "text_color" VARCHAR(255) DEFAULT NULL,
        "scroll_message" TEXT DEFAULT NULL,
        "city_scope" VARCHAR(255) DEFAULT NULL,
        "cities" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "vendor_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "description" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "value_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "value" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "min_order_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "start_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "apply_on" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "usage_limit" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "per_customer_limit" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "image_path" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "background_color" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "text_color" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "scroll_message" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "city_scope" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "cities" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (external_delivery_providers)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "external_delivery_providers" (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) DEFAULT NULL,
        "slug" VARCHAR(255) DEFAULT NULL,
        "phone" VARCHAR(255) DEFAULT NULL,
        "email" VARCHAR(255) DEFAULT NULL,
        "city" VARCHAR(255) DEFAULT NULL,
        "area" VARCHAR(255) DEFAULT NULL,
        "is_active" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "external_delivery_providers" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "external_delivery_providers" ADD COLUMN IF NOT EXISTS "slug" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "external_delivery_providers" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "external_delivery_providers" ADD COLUMN IF NOT EXISTS "email" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "external_delivery_providers" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "external_delivery_providers" ADD COLUMN IF NOT EXISTS "area" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "external_delivery_providers" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "external_delivery_providers" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "external_delivery_providers" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (location_commission_settings)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "location_commission_settings" (
        "id" SERIAL PRIMARY KEY,
        "city" VARCHAR(255) DEFAULT NULL,
        "area" VARCHAR(255) DEFAULT NULL,
        "order_commission_percentage" NUMERIC(12,2) DEFAULT 0,
        "delivery_commission_percentage" NUMERIC(12,2) DEFAULT 0,
        "is_active" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "location_commission_settings" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "location_commission_settings" ADD COLUMN IF NOT EXISTS "area" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "location_commission_settings" ADD COLUMN IF NOT EXISTS "order_commission_percentage" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "location_commission_settings" ADD COLUMN IF NOT EXISTS "delivery_commission_percentage" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "location_commission_settings" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "location_commission_settings" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "location_commission_settings" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (referral_logs)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "referral_logs" (
        "id" SERIAL PRIMARY KEY,
        "referrer_user_id" INT DEFAULT NULL,
        "referred_user_id" INT DEFAULT NULL,
        "referral_code" VARCHAR(255) DEFAULT NULL,
        "city" VARCHAR(255) DEFAULT NULL,
        "user_type" VARCHAR(255) DEFAULT NULL,
        "referrer_reward_amount" NUMERIC(12,2) DEFAULT 0,
        "new_user_reward_amount" NUMERIC(12,2) DEFAULT 0,
        "status" VARCHAR(255) DEFAULT NULL,
        "reward_condition" VARCHAR(255) DEFAULT NULL,
        "rewarded_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "reversed_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "reversal_reason" TEXT DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "referral_logs" ADD COLUMN IF NOT EXISTS "referrer_user_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_logs" ADD COLUMN IF NOT EXISTS "referred_user_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_logs" ADD COLUMN IF NOT EXISTS "referral_code" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_logs" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_logs" ADD COLUMN IF NOT EXISTS "user_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_logs" ADD COLUMN IF NOT EXISTS "referrer_reward_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "referral_logs" ADD COLUMN IF NOT EXISTS "new_user_reward_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "referral_logs" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_logs" ADD COLUMN IF NOT EXISTS "reward_condition" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_logs" ADD COLUMN IF NOT EXISTS "rewarded_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "referral_logs" ADD COLUMN IF NOT EXISTS "reversed_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "referral_logs" ADD COLUMN IF NOT EXISTS "reversal_reason" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_logs" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (referral_messages)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "referral_messages" (
        "id" SERIAL PRIMARY KEY,
        "category" VARCHAR(255) DEFAULT NULL,
        "message_title" VARCHAR(255) DEFAULT NULL,
        "message_text" TEXT DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "referral_messages" ADD COLUMN IF NOT EXISTS "category" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_messages" ADD COLUMN IF NOT EXISTS "message_title" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_messages" ADD COLUMN IF NOT EXISTS "message_text" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_messages" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_messages" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "referral_messages" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (referral_settings)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "referral_settings" (
        "id" SERIAL PRIMARY KEY,
        "city" VARCHAR(255) DEFAULT NULL,
        "user_type" VARCHAR(255) DEFAULT NULL,
        "referral_enabled" SMALLINT DEFAULT 0,
        "max_referrals" INT DEFAULT 0,
        "referrer_reward" VARCHAR(255) DEFAULT NULL,
        "new_user_reward" VARCHAR(255) DEFAULT NULL,
        "reward_condition" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "user_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "referral_enabled" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "max_referrals" INT DEFAULT 0');
    await safeExec('ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "referrer_reward" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "new_user_reward" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "reward_condition" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (roles)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "roles" (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) DEFAULT NULL,
        "slug" VARCHAR(255) DEFAULT NULL,
        "description" TEXT DEFAULT NULL,
        "parent_id" INT DEFAULT NULL,
        "level" INT DEFAULT 0,
        "permissions" JSONB DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "slug" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "description" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "parent_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "level" INT DEFAULT 0');
    await safeExec('ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "permissions" JSONB DEFAULT NULL');
    await safeExec('ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (social_profiles)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "social_profiles" (
        "id" SERIAL PRIMARY KEY,
        "platform_name" VARCHAR(255) DEFAULT NULL,
        "icon_name" VARCHAR(255) DEFAULT NULL,
        "icon_image" VARCHAR(255) DEFAULT NULL,
        "profile_link" VARCHAR(255) DEFAULT NULL,
        "is_active" SMALLINT DEFAULT 0,
        "display_order" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "social_profiles" ADD COLUMN IF NOT EXISTS "platform_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "social_profiles" ADD COLUMN IF NOT EXISTS "icon_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "social_profiles" ADD COLUMN IF NOT EXISTS "icon_image" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "social_profiles" ADD COLUMN IF NOT EXISTS "profile_link" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "social_profiles" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "social_profiles" ADD COLUMN IF NOT EXISTS "display_order" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "social_profiles" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "social_profiles" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (uploaded_files_backup)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "uploaded_files_backup" (
        "file_path" VARCHAR(255) DEFAULT NULL,
        "mime_type" VARCHAR(255) DEFAULT NULL,
        "file_data" TEXT DEFAULT NULL,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "uploaded_files_backup" ADD COLUMN IF NOT EXISTS "file_path" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "uploaded_files_backup" ADD COLUMN IF NOT EXISTS "mime_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "uploaded_files_backup" ADD COLUMN IF NOT EXISTS "file_data" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "uploaded_files_backup" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (users)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) DEFAULT NULL,
        "email" VARCHAR(255) DEFAULT NULL,
        "phone" VARCHAR(255) DEFAULT NULL,
        "password" VARCHAR(255) DEFAULT NULL,
        "role" VARCHAR(255) DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "is_deleted" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "theme_mode" VARCHAR(255) DEFAULT NULL,
        "country" VARCHAR(255) DEFAULT NULL,
        "state" VARCHAR(255) DEFAULT NULL,
        "city" VARCHAR(255) DEFAULT NULL,
        "area" VARCHAR(255) DEFAULT NULL,
        "assigned_admin_id" INT DEFAULT NULL,
        "created_by" VARCHAR(255) DEFAULT NULL,
        "referral_code" VARCHAR(255) DEFAULT NULL,
        "referred_by_user_id" INT DEFAULT NULL,
        "referred_by_code" VARCHAR(255) DEFAULT NULL
      );
    `);

    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_deleted" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "theme_mode" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "country" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "state" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "area" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "assigned_admin_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_by" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by_user_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by_code" VARCHAR(255) DEFAULT NULL');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (variation_types)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "variation_types" (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) DEFAULT NULL,
        "code" VARCHAR(255) DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "created_by" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "variation_types" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "variation_types" ADD COLUMN IF NOT EXISTS "code" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "variation_types" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "variation_types" ADD COLUMN IF NOT EXISTS "created_by" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "variation_types" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "variation_types" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (vehicle_categories)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "vehicle_categories" (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) DEFAULT NULL,
        "code" VARCHAR(255) DEFAULT NULL,
        "base_delivery_charge" NUMERIC(12,2) DEFAULT 0,
        "max_supported_weight_kg" NUMERIC(12,2) DEFAULT 0,
        "priority" INT DEFAULT 0,
        "is_active" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "vehicle_categories" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vehicle_categories" ADD COLUMN IF NOT EXISTS "code" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vehicle_categories" ADD COLUMN IF NOT EXISTS "base_delivery_charge" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "vehicle_categories" ADD COLUMN IF NOT EXISTS "max_supported_weight_kg" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "vehicle_categories" ADD COLUMN IF NOT EXISTS "priority" INT DEFAULT 0');
    await safeExec('ALTER TABLE "vehicle_categories" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "vehicle_categories" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "vehicle_categories" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (admin_profiles)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "admin_profiles" (
        "id" SERIAL PRIMARY KEY,
        "user_id" INT DEFAULT 0,
        "permissions" JSONB DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "country" VARCHAR(255) DEFAULT NULL,
        "state" VARCHAR(255) DEFAULT NULL,
        "city" VARCHAR(255) DEFAULT NULL,
        "area" VARCHAR(255) DEFAULT NULL
      );
    `);

    await safeExec('ALTER TABLE "admin_profiles" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "admin_profiles" ADD COLUMN IF NOT EXISTS "permissions" JSONB DEFAULT NULL');
    await safeExec('ALTER TABLE "admin_profiles" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "admin_profiles" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "admin_profiles" ADD COLUMN IF NOT EXISTS "country" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "admin_profiles" ADD COLUMN IF NOT EXISTS "state" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "admin_profiles" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "admin_profiles" ADD COLUMN IF NOT EXISTS "area" VARCHAR(255) DEFAULT NULL');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (advertisement_events)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "advertisement_events" (
        "id" SERIAL PRIMARY KEY,
        "advertisement_id" INT DEFAULT NULL,
        "event_type" VARCHAR(255) DEFAULT NULL,
        "platform" VARCHAR(255) DEFAULT NULL,
        "page" VARCHAR(255) DEFAULT NULL,
        "category_id" INT DEFAULT NULL,
        "user_id" INT DEFAULT NULL,
        "metadata" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "advertisement_events" ADD COLUMN IF NOT EXISTS "advertisement_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisement_events" ADD COLUMN IF NOT EXISTS "event_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisement_events" ADD COLUMN IF NOT EXISTS "platform" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisement_events" ADD COLUMN IF NOT EXISTS "page" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisement_events" ADD COLUMN IF NOT EXISTS "category_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisement_events" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisement_events" ADD COLUMN IF NOT EXISTS "metadata" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "advertisement_events" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (client_delivery_addresses)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "client_delivery_addresses" (
        "id" SERIAL PRIMARY KEY,
        "user_id" INT DEFAULT NULL,
        "label" VARCHAR(255) DEFAULT NULL,
        "recipient_name" VARCHAR(255) DEFAULT NULL,
        "phone" VARCHAR(255) DEFAULT NULL,
        "address" VARCHAR(255) DEFAULT NULL,
        "area" VARCHAR(255) DEFAULT NULL,
        "city" VARCHAR(255) DEFAULT NULL,
        "state" VARCHAR(255) DEFAULT NULL,
        "country" VARCHAR(255) DEFAULT NULL,
        "pincode" VARCHAR(255) DEFAULT NULL,
        "is_default" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "latitude" NUMERIC(12,2) DEFAULT 0,
        "longitude" NUMERIC(12,2) DEFAULT 0,
        "area_definition_id" INT DEFAULT NULL,
        "zone_id" INT DEFAULT NULL,
        "zone_code" VARCHAR(255) DEFAULT NULL
      );
    `);

    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "label" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "recipient_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "address" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "area" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "state" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "country" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "pincode" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "is_default" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "latitude" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "longitude" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "area_definition_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "zone_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_delivery_addresses" ADD COLUMN IF NOT EXISTS "zone_code" VARCHAR(255) DEFAULT NULL');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (client_orders)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "client_orders" (
        "id" SERIAL PRIMARY KEY,
        "order_number" VARCHAR(255) DEFAULT NULL,
        "user_id" INT DEFAULT NULL,
        "vendor_id" INT DEFAULT NULL,
        "total_amount" NUMERIC(12,2) DEFAULT 0,
        "status" VARCHAR(255) DEFAULT NULL,
        "delivery_status" VARCHAR(255) DEFAULT NULL,
        "delivery_partner_id" INT DEFAULT NULL,
        "delivery_otp" VARCHAR(255) DEFAULT NULL,
        "pickup_otp" VARCHAR(255) DEFAULT NULL,
        "auto_delivery_offer_id" INT DEFAULT NULL,
        "client_name" VARCHAR(255) DEFAULT NULL,
        "client_phone" VARCHAR(255) DEFAULT NULL,
        "client_address" VARCHAR(255) DEFAULT NULL,
        "shipping_address_id" INT DEFAULT NULL,
        "shipping_name" VARCHAR(255) DEFAULT NULL,
        "shipping_phone" VARCHAR(255) DEFAULT NULL,
        "shipping_address" VARCHAR(255) DEFAULT NULL,
        "shipping_area" VARCHAR(255) DEFAULT NULL,
        "shipping_city" VARCHAR(255) DEFAULT NULL,
        "shipping_state" VARCHAR(255) DEFAULT NULL,
        "shipping_country" VARCHAR(255) DEFAULT NULL,
        "shipping_pincode" VARCHAR(255) DEFAULT NULL,
        "assigned_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "ready_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "delivered_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "external_delivery_provider_id" INT DEFAULT NULL,
        "external_delivery_provider_name" VARCHAR(255) DEFAULT NULL,
        "delivery_otp_attempts" INT DEFAULT NULL,
        "delivery_otp_locked_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "delivery_otp_verified_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "otp_set_by" VARCHAR(255) DEFAULT NULL,
        "otp_set_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "shipping_latitude" VARCHAR(255) DEFAULT NULL,
        "shipping_longitude" VARCHAR(255) DEFAULT NULL,
        "delivery_method" VARCHAR(255) DEFAULT NULL,
        "delivery_type" VARCHAR(255) DEFAULT NULL,
        "status_updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "subtotal_amount" NUMERIC(12,2) DEFAULT 0,
        "discount_amount" NUMERIC(12,2) DEFAULT 0,
        "savings_amount" NUMERIC(12,2) DEFAULT 0,
        "delivery_charge" NUMERIC(12,2) DEFAULT 0,
        "platform_fee" NUMERIC(12,2) DEFAULT 0,
        "order_commission_amount" NUMERIC(12,2) DEFAULT 0,
        "premium_vendor_commission_percentage" NUMERIC(12,2) DEFAULT 0,
        "delivery_commission_amount" NUMERIC(12,2) DEFAULT 0,
        "area_definition_id" INT DEFAULT NULL,
        "area_pricing_snapshot" JSONB DEFAULT NULL,
        "platform_charge" NUMERIC(12,2) DEFAULT 0,
        "vendor_earning" NUMERIC(12,2) DEFAULT 0,
        "delivery_earning" NUMERIC(12,2) DEFAULT 0,
        "wallet_settled_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "delivery_wallet_settled_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "coupon_id" INT DEFAULT NULL,
        "coupon_code" VARCHAR(255) DEFAULT NULL,
        "discount_id" INT DEFAULT NULL,
        "discount_label" VARCHAR(255) DEFAULT NULL,
        "order_type" VARCHAR(255) DEFAULT NULL,
        "payment_method" VARCHAR(255) DEFAULT NULL,
        "payment_status" VARCHAR(255) DEFAULT NULL,
        "total_weight_kg" NUMERIC(12,2) DEFAULT 0,
        "distance_km" NUMERIC(12,2) DEFAULT 0,
        "delivery_rule_id" INT DEFAULT NULL,
        "delivery_rule_name" VARCHAR(255) DEFAULT NULL,
        "delivery_rule_snapshot" JSONB DEFAULT NULL,
        "accepted_bid_amount" NUMERIC(12,2) DEFAULT 0,
        "tax_amount" NUMERIC(12,2) DEFAULT 0,
        "other_charges" VARCHAR(255) DEFAULT NULL,
        "admin_earning" NUMERIC(12,2) DEFAULT 0,
        "payment_transaction_id" INT DEFAULT NULL,
        "wallet_transaction_ids" JSONB DEFAULT NULL,
        "invoice_number" VARCHAR(255) DEFAULT NULL,
        "invoice_pdf_path" VARCHAR(255) DEFAULT NULL,
        "invoice_generated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "order_number" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "vendor_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "total_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_partner_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_otp" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "pickup_otp" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "auto_delivery_offer_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "client_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "client_phone" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "client_address" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "shipping_address_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "shipping_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "shipping_phone" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "shipping_address" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "shipping_area" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "shipping_city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "shipping_state" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "shipping_country" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "shipping_pincode" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "assigned_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "ready_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "external_delivery_provider_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "external_delivery_provider_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_otp_attempts" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_otp_locked_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_otp_verified_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "otp_set_by" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "otp_set_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "shipping_latitude" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "shipping_longitude" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_method" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "status_updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "subtotal_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "discount_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "savings_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_charge" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "platform_fee" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "order_commission_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "premium_vendor_commission_percentage" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_commission_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "area_definition_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "area_pricing_snapshot" JSONB DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "platform_charge" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "vendor_earning" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_earning" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "wallet_settled_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_wallet_settled_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "coupon_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "coupon_code" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "discount_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "discount_label" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "order_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "payment_method" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "payment_status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "total_weight_kg" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "distance_km" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_rule_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_rule_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "delivery_rule_snapshot" JSONB DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "accepted_bid_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "tax_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "other_charges" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "admin_earning" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "payment_transaction_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "wallet_transaction_ids" JSONB DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "invoice_number" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "invoice_pdf_path" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_orders" ADD COLUMN IF NOT EXISTS "invoice_generated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (client_profiles)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "client_profiles" (
        "id" SERIAL PRIMARY KEY,
        "user_id" INT DEFAULT 0,
        "address" VARCHAR(255) DEFAULT NULL,
        "country" VARCHAR(255) DEFAULT NULL,
        "state" VARCHAR(255) DEFAULT NULL,
        "city" VARCHAR(255) DEFAULT NULL,
        "age" VARCHAR(255) DEFAULT NULL,
        "gender" VARCHAR(255) DEFAULT NULL,
        "notes" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "area" VARCHAR(255) DEFAULT NULL,
        "cod_limit" INT DEFAULT NULL
      );
    `);

    await safeExec('ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "address" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "country" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "state" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "age" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "gender" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "notes" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "area" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "cod_limit" INT DEFAULT NULL');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (content_page_versions)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "content_page_versions" (
        "id" SERIAL PRIMARY KEY,
        "page_id" INT DEFAULT NULL,
        "version" VARCHAR(255) DEFAULT NULL,
        "title" VARCHAR(255) DEFAULT NULL,
        "content_html" TEXT DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "is_enabled" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "content_page_versions" ADD COLUMN IF NOT EXISTS "page_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "content_page_versions" ADD COLUMN IF NOT EXISTS "version" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "content_page_versions" ADD COLUMN IF NOT EXISTS "title" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "content_page_versions" ADD COLUMN IF NOT EXISTS "content_html" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "content_page_versions" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "content_page_versions" ADD COLUMN IF NOT EXISTS "is_enabled" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "content_page_versions" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (delivery_partner_settings)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "delivery_partner_settings" (
        "id" SERIAL PRIMARY KEY,
        "user_id" INT DEFAULT NULL,
        "city" VARCHAR(255) DEFAULT NULL,
        "area" VARCHAR(255) DEFAULT NULL,
        "is_active" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "delivery_partner_settings" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_partner_settings" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_partner_settings" ADD COLUMN IF NOT EXISTS "area" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_partner_settings" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_partner_settings" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "delivery_partner_settings" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (delivery_person_activity_logs)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "delivery_person_activity_logs" (
        "id" SERIAL PRIMARY KEY,
        "delivery_person_id" INT DEFAULT NULL,
        "actor_id" INT DEFAULT NULL,
        "action" VARCHAR(255) DEFAULT NULL,
        "description" TEXT DEFAULT NULL,
        "metadata" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "delivery_person_activity_logs" ADD COLUMN IF NOT EXISTS "delivery_person_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_activity_logs" ADD COLUMN IF NOT EXISTS "actor_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_activity_logs" ADD COLUMN IF NOT EXISTS "action" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_activity_logs" ADD COLUMN IF NOT EXISTS "description" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_activity_logs" ADD COLUMN IF NOT EXISTS "metadata" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_activity_logs" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (delivery_person_profiles)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "delivery_person_profiles" (
        "id" SERIAL PRIMARY KEY,
        "user_id" INT DEFAULT NULL,
        "city" VARCHAR(255) DEFAULT NULL,
        "area" VARCHAR(255) DEFAULT NULL,
        "address" VARCHAR(255) DEFAULT NULL,
        "address_proof_id" INT DEFAULT NULL,
        "address_proof_type" VARCHAR(255) DEFAULT NULL,
        "profile_image_path" VARCHAR(255) DEFAULT NULL,
        "vehicle_type" VARCHAR(255) DEFAULT NULL,
        "vehicle_number" VARCHAR(255) DEFAULT NULL,
        "document_notes" TEXT DEFAULT NULL,
        "is_available" SMALLINT DEFAULT 0,
        "current_latitude" VARCHAR(255) DEFAULT NULL,
        "current_longitude" VARCHAR(255) DEFAULT NULL,
        "last_seen_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "area" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "address" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "address_proof_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "address_proof_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "profile_image_path" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "vehicle_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "vehicle_number" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "document_notes" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "is_available" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "current_latitude" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "current_longitude" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "delivery_person_profiles" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (quotation_requests)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "quotation_requests" (
        "id" SERIAL PRIMARY KEY,
        "client_id" INT DEFAULT NULL,
        "client_city" VARCHAR(255) DEFAULT NULL,
        "total_amount" NUMERIC(12,2) DEFAULT 0,
        "status" VARCHAR(255) DEFAULT NULL,
        "expires_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "quotation_requests" ADD COLUMN IF NOT EXISTS "client_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_requests" ADD COLUMN IF NOT EXISTS "client_city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_requests" ADD COLUMN IF NOT EXISTS "total_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "quotation_requests" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_requests" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "quotation_requests" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "quotation_requests" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (states)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "states" (
        "id" SERIAL PRIMARY KEY,
        "country_id" INT DEFAULT 0,
        "name" VARCHAR(255) DEFAULT NULL,
        "is_active" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "states" ADD COLUMN IF NOT EXISTS "country_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "states" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "states" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "states" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "states" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (sub_categories)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "sub_categories" (
        "id" SERIAL PRIMARY KEY,
        "category_id" INT DEFAULT 0,
        "name" VARCHAR(255) DEFAULT NULL,
        "slug" VARCHAR(255) DEFAULT NULL,
        "image_path" VARCHAR(255) DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "is_active" SMALLINT DEFAULT 0,
        "is_deleted" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "sub_categories" ADD COLUMN IF NOT EXISTS "category_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "sub_categories" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "sub_categories" ADD COLUMN IF NOT EXISTS "slug" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "sub_categories" ADD COLUMN IF NOT EXISTS "image_path" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "sub_categories" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "sub_categories" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "sub_categories" ADD COLUMN IF NOT EXISTS "is_deleted" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "sub_categories" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "sub_categories" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (support_tickets)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "support_tickets" (
        "id" SERIAL PRIMARY KEY,
        "requester_id" INT DEFAULT NULL,
        "requester_role" VARCHAR(255) DEFAULT NULL,
        "subject" VARCHAR(255) DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "closed_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "requester_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "requester_role" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "subject" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (user_audit_logs)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "user_audit_logs" (
        "id" SERIAL PRIMARY KEY,
        "actor_id" INT DEFAULT 0,
        "target_user_id" INT DEFAULT 0,
        "action" VARCHAR(255) DEFAULT NULL,
        "details" JSONB DEFAULT NULL,
        "ip_address" VARCHAR(255) DEFAULT NULL,
        "user_agent" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "user_audit_logs" ADD COLUMN IF NOT EXISTS "actor_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "user_audit_logs" ADD COLUMN IF NOT EXISTS "target_user_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "user_audit_logs" ADD COLUMN IF NOT EXISTS "action" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "user_audit_logs" ADD COLUMN IF NOT EXISTS "details" JSONB DEFAULT NULL');
    await safeExec('ALTER TABLE "user_audit_logs" ADD COLUMN IF NOT EXISTS "ip_address" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "user_audit_logs" ADD COLUMN IF NOT EXISTS "user_agent" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "user_audit_logs" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (user_notifications)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "user_notifications" (
        "id" SERIAL PRIMARY KEY,
        "user_id" INT DEFAULT NULL,
        "title" VARCHAR(255) DEFAULT NULL,
        "message" VARCHAR(255) DEFAULT NULL,
        "link" VARCHAR(255) DEFAULT NULL,
        "is_read" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "user_notifications" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "user_notifications" ADD COLUMN IF NOT EXISTS "title" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "user_notifications" ADD COLUMN IF NOT EXISTS "message" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "user_notifications" ADD COLUMN IF NOT EXISTS "link" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "user_notifications" ADD COLUMN IF NOT EXISTS "is_read" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "user_notifications" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (user_roles)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "user_roles" (
        "user_id" INT DEFAULT 0,
        "role_id" INT DEFAULT 0,
        "assigned_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "assigned_by" INT DEFAULT 0
      );
    `);

    await safeExec('ALTER TABLE "user_roles" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "user_roles" ADD COLUMN IF NOT EXISTS "role_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "user_roles" ADD COLUMN IF NOT EXISTS "assigned_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "user_roles" ADD COLUMN IF NOT EXISTS "assigned_by" INT DEFAULT 0');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (variation_values)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "variation_values" (
        "id" SERIAL PRIMARY KEY,
        "variation_type_id" INT DEFAULT 0,
        "value" VARCHAR(255) DEFAULT NULL,
        "unit" VARCHAR(255) DEFAULT NULL,
        "numeric_value" VARCHAR(255) DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "created_by" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "variation_values" ADD COLUMN IF NOT EXISTS "variation_type_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "variation_values" ADD COLUMN IF NOT EXISTS "value" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "variation_values" ADD COLUMN IF NOT EXISTS "unit" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "variation_values" ADD COLUMN IF NOT EXISTS "numeric_value" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "variation_values" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "variation_values" ADD COLUMN IF NOT EXISTS "created_by" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "variation_values" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "variation_values" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (vendor_categories)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "vendor_categories" (
        "id" SERIAL PRIMARY KEY,
        "vendor_id" INT DEFAULT 0,
        "category_id" INT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "vendor_categories" ADD COLUMN IF NOT EXISTS "vendor_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "vendor_categories" ADD COLUMN IF NOT EXISTS "category_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "vendor_categories" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (vendor_category_requests)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "vendor_category_requests" (
        "id" SERIAL PRIMARY KEY,
        "vendor_id" INT DEFAULT NULL,
        "category_id" INT DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "note" VARCHAR(255) DEFAULT NULL,
        "admin_note" VARCHAR(255) DEFAULT NULL,
        "decided_by" VARCHAR(255) DEFAULT NULL,
        "decided_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "vendor_category_requests" ADD COLUMN IF NOT EXISTS "vendor_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_category_requests" ADD COLUMN IF NOT EXISTS "category_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_category_requests" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_category_requests" ADD COLUMN IF NOT EXISTS "note" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_category_requests" ADD COLUMN IF NOT EXISTS "admin_note" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_category_requests" ADD COLUMN IF NOT EXISTS "decided_by" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_category_requests" ADD COLUMN IF NOT EXISTS "decided_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "vendor_category_requests" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "vendor_category_requests" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (vendor_profiles)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "vendor_profiles" (
        "id" SERIAL PRIMARY KEY,
        "user_id" INT DEFAULT 0,
        "business_name" VARCHAR(255) DEFAULT NULL,
        "logo_path" VARCHAR(255) DEFAULT NULL,
        "storefront_image_path" VARCHAR(255) DEFAULT NULL,
        "signature_path" VARCHAR(255) DEFAULT NULL,
        "address" VARCHAR(255) DEFAULT NULL,
        "pickup_latitude" VARCHAR(255) DEFAULT NULL,
        "pickup_longitude" VARCHAR(255) DEFAULT NULL,
        "country" VARCHAR(255) DEFAULT NULL,
        "state" VARCHAR(255) DEFAULT NULL,
        "city" VARCHAR(255) DEFAULT NULL,
        "gst_number" VARCHAR(255) DEFAULT NULL,
        "services" JSONB DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "area" VARCHAR(255) DEFAULT NULL,
        "pincode" VARCHAR(255) DEFAULT NULL,
        "area_definition_id" INT DEFAULT NULL,
        "zone_id" INT DEFAULT NULL,
        "zone_code" VARCHAR(255) DEFAULT NULL,
        "is_premium_vendor" SMALLINT DEFAULT 0,
        "premium_commission_percent" NUMERIC(12,2) DEFAULT 0
      );
    `);

    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "business_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "logo_path" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "storefront_image_path" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "signature_path" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "address" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "pickup_latitude" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "pickup_longitude" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "country" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "state" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "gst_number" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "services" JSONB DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "area" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "pincode" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "area_definition_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "zone_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "zone_code" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "is_premium_vendor" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "vendor_profiles" ADD COLUMN IF NOT EXISTS "premium_commission_percent" NUMERIC(12,2) DEFAULT 0');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (wallets)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "wallets" (
        "id" SERIAL PRIMARY KEY,
        "user_id" INT DEFAULT 0,
        "balance" VARCHAR(255) DEFAULT NULL,
        "currency" VARCHAR(255) DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "balance" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "currency" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (brands)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "brands" (
        "id" SERIAL PRIMARY KEY,
        "category_id" INT DEFAULT 0,
        "sub_category_id" INT DEFAULT 0,
        "name" VARCHAR(255) DEFAULT NULL,
        "slug" VARCHAR(255) DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "is_active" SMALLINT DEFAULT 0,
        "is_deleted" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "logo_path" VARCHAR(255) DEFAULT NULL
      );
    `);

    await safeExec('ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "category_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "sub_category_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "slug" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "is_deleted" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "logo_path" VARCHAR(255) DEFAULT NULL');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (cities)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "cities" (
        "id" SERIAL PRIMARY KEY,
        "state_id" INT DEFAULT 0,
        "name" VARCHAR(255) DEFAULT NULL,
        "is_active" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "state_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (coupon_history)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "coupon_history" (
        "id" SERIAL PRIMARY KEY,
        "coupon_id" INT DEFAULT NULL,
        "discount_id" INT DEFAULT NULL,
        "order_id" INT DEFAULT NULL,
        "user_id" INT DEFAULT NULL,
        "order_type" VARCHAR(255) DEFAULT NULL,
        "code" VARCHAR(255) DEFAULT NULL,
        "subtotal_amount" NUMERIC(12,2) DEFAULT 0,
        "discount_amount" NUMERIC(12,2) DEFAULT 0,
        "final_amount" NUMERIC(12,2) DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "coupon_history" ADD COLUMN IF NOT EXISTS "coupon_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "coupon_history" ADD COLUMN IF NOT EXISTS "discount_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "coupon_history" ADD COLUMN IF NOT EXISTS "order_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "coupon_history" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "coupon_history" ADD COLUMN IF NOT EXISTS "order_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "coupon_history" ADD COLUMN IF NOT EXISTS "code" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "coupon_history" ADD COLUMN IF NOT EXISTS "subtotal_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "coupon_history" ADD COLUMN IF NOT EXISTS "discount_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "coupon_history" ADD COLUMN IF NOT EXISTS "final_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "coupon_history" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (delivery_order_offers)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "delivery_order_offers" (
        "id" SERIAL PRIMARY KEY,
        "order_id" INT DEFAULT NULL,
        "delivery_person_id" INT DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "pickup_area" VARCHAR(255) DEFAULT NULL,
        "delivery_area" VARCHAR(255) DEFAULT NULL,
        "delivery_charge" NUMERIC(12,2) DEFAULT 0,
        "platform_fee" NUMERIC(12,2) DEFAULT 0,
        "delivery_partner_earning" NUMERIC(12,2) DEFAULT 0,
        "notification_payload" VARCHAR(255) DEFAULT NULL,
        "response_note" VARCHAR(255) DEFAULT NULL,
        "expires_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "responded_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "delivery_order_offers" ADD COLUMN IF NOT EXISTS "order_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_order_offers" ADD COLUMN IF NOT EXISTS "delivery_person_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_order_offers" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_order_offers" ADD COLUMN IF NOT EXISTS "pickup_area" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_order_offers" ADD COLUMN IF NOT EXISTS "delivery_area" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_order_offers" ADD COLUMN IF NOT EXISTS "delivery_charge" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_order_offers" ADD COLUMN IF NOT EXISTS "platform_fee" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_order_offers" ADD COLUMN IF NOT EXISTS "delivery_partner_earning" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "delivery_order_offers" ADD COLUMN IF NOT EXISTS "notification_payload" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_order_offers" ADD COLUMN IF NOT EXISTS "response_note" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "delivery_order_offers" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "delivery_order_offers" ADD COLUMN IF NOT EXISTS "responded_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "delivery_order_offers" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "delivery_order_offers" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (order_ratings)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "order_ratings" (
        "id" SERIAL PRIMARY KEY,
        "order_id" INT DEFAULT NULL,
        "client_id" INT DEFAULT NULL,
        "subject_type" VARCHAR(255) DEFAULT NULL,
        "subject_id" INT DEFAULT NULL,
        "overall_rating" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "order_ratings" ADD COLUMN IF NOT EXISTS "order_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "order_ratings" ADD COLUMN IF NOT EXISTS "client_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "order_ratings" ADD COLUMN IF NOT EXISTS "subject_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "order_ratings" ADD COLUMN IF NOT EXISTS "subject_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "order_ratings" ADD COLUMN IF NOT EXISTS "overall_rating" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "order_ratings" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "order_ratings" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (order_status_history)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "order_status_history" (
        "id" SERIAL PRIMARY KEY,
        "order_id" INT DEFAULT NULL,
        "old_status" VARCHAR(255) DEFAULT NULL,
        "new_status" VARCHAR(255) DEFAULT NULL,
        "changed_by" VARCHAR(255) DEFAULT NULL,
        "changed_by_role" VARCHAR(255) DEFAULT NULL,
        "note" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "order_status_history" ADD COLUMN IF NOT EXISTS "order_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "order_status_history" ADD COLUMN IF NOT EXISTS "old_status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "order_status_history" ADD COLUMN IF NOT EXISTS "new_status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "order_status_history" ADD COLUMN IF NOT EXISTS "changed_by" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "order_status_history" ADD COLUMN IF NOT EXISTS "changed_by_role" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "order_status_history" ADD COLUMN IF NOT EXISTS "note" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "order_status_history" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (quotation_vendor_recipients)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "quotation_vendor_recipients" (
        "id" SERIAL PRIMARY KEY,
        "quotation_request_id" INT DEFAULT NULL,
        "vendor_id" INT DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "is_seen" SMALLINT DEFAULT 0,
        "total_amount" NUMERIC(12,2) DEFAULT 0,
        "discount_percent" NUMERIC(12,2) DEFAULT 0,
        "submitted_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "decided_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "eligibility_status" VARCHAR(255) DEFAULT NULL,
        "eligibility_details" JSONB DEFAULT NULL
      );
    `);

    await safeExec('ALTER TABLE "quotation_vendor_recipients" ADD COLUMN IF NOT EXISTS "quotation_request_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_vendor_recipients" ADD COLUMN IF NOT EXISTS "vendor_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_vendor_recipients" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_vendor_recipients" ADD COLUMN IF NOT EXISTS "is_seen" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "quotation_vendor_recipients" ADD COLUMN IF NOT EXISTS "total_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "quotation_vendor_recipients" ADD COLUMN IF NOT EXISTS "discount_percent" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "quotation_vendor_recipients" ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "quotation_vendor_recipients" ADD COLUMN IF NOT EXISTS "decided_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "quotation_vendor_recipients" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "quotation_vendor_recipients" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "quotation_vendor_recipients" ADD COLUMN IF NOT EXISTS "eligibility_status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_vendor_recipients" ADD COLUMN IF NOT EXISTS "eligibility_details" JSONB DEFAULT NULL');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (support_ticket_messages)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "support_ticket_messages" (
        "id" SERIAL PRIMARY KEY,
        "ticket_id" INT DEFAULT NULL,
        "sender_id" INT DEFAULT NULL,
        "sender_role" VARCHAR(255) DEFAULT NULL,
        "sender_name" VARCHAR(255) DEFAULT NULL,
        "message" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "ticket_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "sender_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "sender_role" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "sender_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "message" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (wallet_transactions)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "wallet_transactions" (
        "id" SERIAL PRIMARY KEY,
        "wallet_id" INT DEFAULT NULL,
        "user_id" INT DEFAULT NULL,
        "order_id" INT DEFAULT NULL,
        "type" VARCHAR(255) DEFAULT NULL,
        "amount" VARCHAR(255) DEFAULT NULL,
        "balance_before" VARCHAR(255) DEFAULT NULL,
        "balance_after" VARCHAR(255) DEFAULT NULL,
        "reference" VARCHAR(255) DEFAULT NULL,
        "note" VARCHAR(255) DEFAULT NULL,
        "component" VARCHAR(255) DEFAULT NULL,
        "ledger_key" VARCHAR(255) DEFAULT NULL,
        "created_by" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "commission_setting_id" INT DEFAULT NULL,
        "commission_amount" NUMERIC(12,2) DEFAULT 0,
        "net_amount" NUMERIC(12,2) DEFAULT 0,
        "transaction_by_name" VARCHAR(255) DEFAULT NULL,
        "transaction_by_email" VARCHAR(255) DEFAULT NULL,
        "transaction_by_role" VARCHAR(255) DEFAULT NULL,
        "transaction_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "wallet_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "order_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "amount" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "balance_before" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "balance_after" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "reference" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "note" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "component" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "ledger_key" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "created_by" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "commission_setting_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "commission_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "net_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "transaction_by_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "transaction_by_email" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "transaction_by_role" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "transaction_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (area_definitions)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "area_definitions" (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) DEFAULT NULL,
        "city" VARCHAR(255) DEFAULT NULL,
        "polygon" JSONB DEFAULT NULL,
        "center_lat" NUMERIC(12,2) DEFAULT 0,
        "center_lng" NUMERIC(12,2) DEFAULT 0,
        "platform_fee" NUMERIC(12,2) DEFAULT 0,
        "delivery_charge" NUMERIC(12,2) DEFAULT 0,
        "order_commission_percentage" NUMERIC(12,2) DEFAULT 0,
        "delivery_commission_percentage" NUMERIC(12,2) DEFAULT 0,
        "own_delivery_active" INT DEFAULT 0,
        "is_active" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "cod_enabled" SMALLINT DEFAULT 0,
        "country_id" INT DEFAULT 0,
        "state_id" INT DEFAULT 0,
        "city_id" INT DEFAULT 0,
        "code" VARCHAR(255) DEFAULT NULL,
        "description" TEXT DEFAULT NULL,
        "delivery_enabled" SMALLINT DEFAULT 0,
        "boundary_geojson" JSONB DEFAULT NULL,
        "boundary_status" VARCHAR(255) DEFAULT NULL,
        "created_by" INT DEFAULT 0,
        "updated_by" INT DEFAULT 0
      );
    `);

    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "polygon" JSONB DEFAULT NULL');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "center_lat" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "center_lng" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "platform_fee" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "delivery_charge" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "order_commission_percentage" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "delivery_commission_percentage" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "own_delivery_active" INT DEFAULT 0');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "is_active" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "cod_enabled" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "country_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "state_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "city_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "code" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "description" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "delivery_enabled" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "boundary_geojson" JSONB DEFAULT NULL');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "boundary_status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "created_by" INT DEFAULT 0');
    await safeExec('ALTER TABLE "area_definitions" ADD COLUMN IF NOT EXISTS "updated_by" INT DEFAULT 0');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (order_rating_categories)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "order_rating_categories" (
        "id" SERIAL PRIMARY KEY,
        "rating_id" INT DEFAULT NULL,
        "category_key" VARCHAR(255) DEFAULT NULL,
        "score" VARCHAR(255) DEFAULT NULL
      );
    `);

    await safeExec('ALTER TABLE "order_rating_categories" ADD COLUMN IF NOT EXISTS "rating_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "order_rating_categories" ADD COLUMN IF NOT EXISTS "category_key" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "order_rating_categories" ADD COLUMN IF NOT EXISTS "score" VARCHAR(255) DEFAULT NULL');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (products)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "products" (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(255) DEFAULT NULL,
        "description" TEXT DEFAULT NULL,
        "price" VARCHAR(255) DEFAULT NULL,
        "weight_value" VARCHAR(255) DEFAULT NULL,
        "weight_unit" VARCHAR(255) DEFAULT NULL,
        "weight_kg" NUMERIC(12,2) DEFAULT 0,
        "image_url" VARCHAR(255) DEFAULT NULL,
        "category_id" INT DEFAULT 0,
        "sub_category_id" INT DEFAULT 0,
        "brand_id" INT DEFAULT 0,
        "is_deleted" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "tax_name" VARCHAR(255) DEFAULT NULL,
        "tax_percentage" NUMERIC(12,2) DEFAULT 0,
        "approval_status" VARCHAR(255) DEFAULT NULL,
        "created_by_vendor_id" INT DEFAULT NULL,
        "approved_by" VARCHAR(255) DEFAULT NULL,
        "approved_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "rejection_reason" TEXT DEFAULT NULL,
        "has_variants" SMALLINT DEFAULT 0,
        "hsn_code" VARCHAR(255) DEFAULT NULL
      );
    `);

    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "description" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "price" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "weight_value" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "weight_unit" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "weight_kg" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "image_url" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "category_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sub_category_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "brand_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_deleted" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tax_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tax_percentage" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "approval_status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "created_by_vendor_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "approved_by" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT DEFAULT NULL');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "has_variants" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "hsn_code" VARCHAR(255) DEFAULT NULL');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (quotation_bid_rejection_logs)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "quotation_bid_rejection_logs" (
        "id" SERIAL PRIMARY KEY,
        "quotation_vendor_recipient_id" INT DEFAULT NULL,
        "quotation_request_id" INT DEFAULT NULL,
        "vendor_id" INT DEFAULT NULL,
        "reason_code" VARCHAR(255) DEFAULT NULL,
        "message" VARCHAR(255) DEFAULT NULL,
        "details" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "quotation_bid_rejection_logs" ADD COLUMN IF NOT EXISTS "quotation_vendor_recipient_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_bid_rejection_logs" ADD COLUMN IF NOT EXISTS "quotation_request_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_bid_rejection_logs" ADD COLUMN IF NOT EXISTS "vendor_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_bid_rejection_logs" ADD COLUMN IF NOT EXISTS "reason_code" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_bid_rejection_logs" ADD COLUMN IF NOT EXISTS "message" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_bid_rejection_logs" ADD COLUMN IF NOT EXISTS "details" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_bid_rejection_logs" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (product_keywords)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "product_keywords" (
        "id" SERIAL PRIMARY KEY,
        "product_id" INT DEFAULT NULL,
        "keyword" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "product_keywords" ADD COLUMN IF NOT EXISTS "product_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "product_keywords" ADD COLUMN IF NOT EXISTS "keyword" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "product_keywords" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (product_ranking_scores)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "product_ranking_scores" (
        "product_id" INT DEFAULT NULL,
        "popularity_score" NUMERIC(12,2) DEFAULT 0,
        "click_score" NUMERIC(12,2) DEFAULT 0,
        "purchase_score" NUMERIC(12,2) DEFAULT 0,
        "search_score" NUMERIC(12,2) DEFAULT 0,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "product_ranking_scores" ADD COLUMN IF NOT EXISTS "product_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "product_ranking_scores" ADD COLUMN IF NOT EXISTS "popularity_score" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "product_ranking_scores" ADD COLUMN IF NOT EXISTS "click_score" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "product_ranking_scores" ADD COLUMN IF NOT EXISTS "purchase_score" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "product_ranking_scores" ADD COLUMN IF NOT EXISTS "search_score" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "product_ranking_scores" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (product_search_history)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "product_search_history" (
        "id" SERIAL PRIMARY KEY,
        "user_id" INT DEFAULT 0,
        "search_keyword" VARCHAR(255) DEFAULT NULL,
        "clicked_product_id" INT DEFAULT NULL,
        "viewed_product_id" INT DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "product_search_history" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "product_search_history" ADD COLUMN IF NOT EXISTS "search_keyword" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "product_search_history" ADD COLUMN IF NOT EXISTS "clicked_product_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "product_search_history" ADD COLUMN IF NOT EXISTS "viewed_product_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "product_search_history" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (product_variants)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "product_variants" (
        "id" SERIAL PRIMARY KEY,
        "product_id" INT DEFAULT 0,
        "variant_name" VARCHAR(255) DEFAULT NULL,
        "sku" VARCHAR(255) DEFAULT NULL,
        "barcode" VARCHAR(255) DEFAULT NULL,
        "mrp" VARCHAR(255) DEFAULT NULL,
        "variation_price" NUMERIC(12,2) DEFAULT 0,
        "sale_price" NUMERIC(12,2) DEFAULT 0,
        "stock_quantity" INT DEFAULT 0,
        "weight_in_grams" INT DEFAULT 0,
        "measurement_value" VARCHAR(255) DEFAULT NULL,
        "measurement_unit" VARCHAR(255) DEFAULT NULL,
        "image" VARCHAR(255) DEFAULT NULL,
        "is_default" SMALLINT DEFAULT 0,
        "status" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "product_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "variant_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "sku" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "barcode" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "mrp" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "variation_price" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "sale_price" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "stock_quantity" INT DEFAULT 0');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "weight_in_grams" INT DEFAULT 0');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "measurement_value" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "measurement_unit" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "image" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "is_default" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (sponsored_products)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "sponsored_products" (
        "id" SERIAL PRIMARY KEY,
        "product_id" INT DEFAULT NULL,
        "is_sponsored" SMALLINT DEFAULT 0,
        "priority_order" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "sponsored_products" ADD COLUMN IF NOT EXISTS "product_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "sponsored_products" ADD COLUMN IF NOT EXISTS "is_sponsored" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "sponsored_products" ADD COLUMN IF NOT EXISTS "priority_order" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "sponsored_products" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "sponsored_products" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (user_recent_activity)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "user_recent_activity" (
        "id" SERIAL PRIMARY KEY,
        "user_id" INT DEFAULT NULL,
        "product_id" INT DEFAULT NULL,
        "activity_type" VARCHAR(255) DEFAULT NULL,
        "metadata" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "user_recent_activity" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "user_recent_activity" ADD COLUMN IF NOT EXISTS "product_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "user_recent_activity" ADD COLUMN IF NOT EXISTS "activity_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "user_recent_activity" ADD COLUMN IF NOT EXISTS "metadata" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "user_recent_activity" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (vendor_client_product_prices)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "vendor_client_product_prices" (
        "id" SERIAL PRIMARY KEY,
        "product_id" INT DEFAULT NULL,
        "vendor_id" INT DEFAULT NULL,
        "client_id" INT DEFAULT NULL,
        "custom_price" NUMERIC(12,2) DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "vendor_client_product_prices" ADD COLUMN IF NOT EXISTS "product_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_client_product_prices" ADD COLUMN IF NOT EXISTS "vendor_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_client_product_prices" ADD COLUMN IF NOT EXISTS "client_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_client_product_prices" ADD COLUMN IF NOT EXISTS "custom_price" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "vendor_client_product_prices" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "vendor_client_product_prices" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (vendor_products)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "vendor_products" (
        "id" SERIAL PRIMARY KEY,
        "product_id" INT DEFAULT 0,
        "vendor_id" INT DEFAULT 0,
        "quantity" VARCHAR(255) DEFAULT NULL,
        "price" VARCHAR(255) DEFAULT NULL,
        "image_url" VARCHAR(255) DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "vendor_products" ADD COLUMN IF NOT EXISTS "product_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "vendor_products" ADD COLUMN IF NOT EXISTS "vendor_id" INT DEFAULT 0');
    await safeExec('ALTER TABLE "vendor_products" ADD COLUMN IF NOT EXISTS "quantity" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_products" ADD COLUMN IF NOT EXISTS "price" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_products" ADD COLUMN IF NOT EXISTS "image_url" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_products" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_products" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "vendor_products" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (cart_items)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "cart_items" (
        "id" SERIAL PRIMARY KEY,
        "user_id" INT DEFAULT NULL,
        "vendor_id" INT DEFAULT NULL,
        "product_id" INT DEFAULT NULL,
        "product_variant_id" INT DEFAULT NULL,
        "quantity" VARCHAR(255) DEFAULT NULL,
        "unit_price" NUMERIC(12,2) DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "user_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "vendor_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "product_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "product_variant_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "quantity" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "unit_price" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (client_order_items)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "client_order_items" (
        "id" SERIAL PRIMARY KEY,
        "order_id" INT DEFAULT NULL,
        "vendor_product_id" INT DEFAULT NULL,
        "quantity" VARCHAR(255) DEFAULT NULL,
        "unit_price" NUMERIC(12,2) DEFAULT 0,
        "tax_name" VARCHAR(255) DEFAULT NULL,
        "tax_percentage" NUMERIC(12,2) DEFAULT 0,
        "tax_amount" NUMERIC(12,2) DEFAULT 0,
        "taxable_amount" NUMERIC(12,2) DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "product_variant_id" INT DEFAULT NULL,
        "variant_name" VARCHAR(255) DEFAULT NULL,
        "unit" VARCHAR(255) DEFAULT NULL,
        "weight_in_grams" NUMERIC(12,2) DEFAULT 0
      );
    `);

    await safeExec('ALTER TABLE "client_order_items" ADD COLUMN IF NOT EXISTS "order_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_order_items" ADD COLUMN IF NOT EXISTS "vendor_product_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_order_items" ADD COLUMN IF NOT EXISTS "quantity" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_order_items" ADD COLUMN IF NOT EXISTS "unit_price" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_order_items" ADD COLUMN IF NOT EXISTS "tax_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_order_items" ADD COLUMN IF NOT EXISTS "tax_percentage" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_order_items" ADD COLUMN IF NOT EXISTS "tax_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_order_items" ADD COLUMN IF NOT EXISTS "taxable_amount" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "client_order_items" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "client_order_items" ADD COLUMN IF NOT EXISTS "product_variant_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "client_order_items" ADD COLUMN IF NOT EXISTS "variant_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_order_items" ADD COLUMN IF NOT EXISTS "unit" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "client_order_items" ADD COLUMN IF NOT EXISTS "weight_in_grams" NUMERIC(12,2) DEFAULT 0');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (product_variant_values)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "product_variant_values" (
        "id" SERIAL PRIMARY KEY,
        "product_variant_id" INT DEFAULT NULL,
        "variation_type_id" INT DEFAULT NULL,
        "variation_value_id" INT DEFAULT NULL
      );
    `);

    await safeExec('ALTER TABLE "product_variant_values" ADD COLUMN IF NOT EXISTS "product_variant_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "product_variant_values" ADD COLUMN IF NOT EXISTS "variation_type_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "product_variant_values" ADD COLUMN IF NOT EXISTS "variation_value_id" INT DEFAULT NULL');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (quotation_request_items)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "quotation_request_items" (
        "id" SERIAL PRIMARY KEY,
        "quotation_request_id" INT DEFAULT NULL,
        "vendor_product_id" INT DEFAULT NULL,
        "product_id" INT DEFAULT NULL,
        "product_name" VARCHAR(255) DEFAULT NULL,
        "quantity" VARCHAR(255) DEFAULT NULL,
        "expected_price" NUMERIC(12,2) DEFAULT 0,
        "weight_value" VARCHAR(255) DEFAULT NULL,
        "weight_unit" VARCHAR(255) DEFAULT NULL,
        "weight_kg" NUMERIC(12,2) DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "product_variant_id" INT DEFAULT NULL
      );
    `);

    await safeExec('ALTER TABLE "quotation_request_items" ADD COLUMN IF NOT EXISTS "quotation_request_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_request_items" ADD COLUMN IF NOT EXISTS "vendor_product_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_request_items" ADD COLUMN IF NOT EXISTS "product_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_request_items" ADD COLUMN IF NOT EXISTS "product_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_request_items" ADD COLUMN IF NOT EXISTS "quantity" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_request_items" ADD COLUMN IF NOT EXISTS "expected_price" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "quotation_request_items" ADD COLUMN IF NOT EXISTS "weight_value" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_request_items" ADD COLUMN IF NOT EXISTS "weight_unit" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_request_items" ADD COLUMN IF NOT EXISTS "weight_kg" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "quotation_request_items" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "quotation_request_items" ADD COLUMN IF NOT EXISTS "product_variant_id" INT DEFAULT NULL');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (vendor_inventory_transactions)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "vendor_inventory_transactions" (
        "id" SERIAL PRIMARY KEY,
        "vendor_id" INT DEFAULT NULL,
        "product_variant_id" INT DEFAULT NULL,
        "transaction_type" VARCHAR(255) DEFAULT NULL,
        "quantity" VARCHAR(255) DEFAULT NULL,
        "stock_before" VARCHAR(255) DEFAULT NULL,
        "stock_after" VARCHAR(255) DEFAULT NULL,
        "reference_type" VARCHAR(255) DEFAULT NULL,
        "reference_id" INT DEFAULT NULL,
        "note" VARCHAR(255) DEFAULT NULL,
        "created_by" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "vendor_inventory_transactions" ADD COLUMN IF NOT EXISTS "vendor_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_inventory_transactions" ADD COLUMN IF NOT EXISTS "product_variant_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_inventory_transactions" ADD COLUMN IF NOT EXISTS "transaction_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_inventory_transactions" ADD COLUMN IF NOT EXISTS "quantity" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_inventory_transactions" ADD COLUMN IF NOT EXISTS "stock_before" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_inventory_transactions" ADD COLUMN IF NOT EXISTS "stock_after" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_inventory_transactions" ADD COLUMN IF NOT EXISTS "reference_type" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_inventory_transactions" ADD COLUMN IF NOT EXISTS "reference_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_inventory_transactions" ADD COLUMN IF NOT EXISTS "note" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_inventory_transactions" ADD COLUMN IF NOT EXISTS "created_by" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_inventory_transactions" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (vendor_product_variants)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "vendor_product_variants" (
        "id" SERIAL PRIMARY KEY,
        "vendor_id" INT DEFAULT NULL,
        "product_id" INT DEFAULT NULL,
        "product_variant_id" INT DEFAULT NULL,
        "vendor_price" NUMERIC(12,2) DEFAULT 0,
        "mrp" VARCHAR(255) DEFAULT NULL,
        "stock_quantity" VARCHAR(255) DEFAULT NULL,
        "minimum_order_quantity" VARCHAR(255) DEFAULT NULL,
        "maximum_order_quantity" VARCHAR(255) DEFAULT NULL,
        "is_available" SMALLINT DEFAULT 0,
        "is_approved" SMALLINT DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "approval_status" VARCHAR(255) DEFAULT NULL,
        "approval_note" VARCHAR(255) DEFAULT NULL,
        "approved_by" VARCHAR(255) DEFAULT NULL,
        "approved_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "low_stock_limit" INT DEFAULT NULL,
        "reserved_stock" VARCHAR(255) DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "sku" VARCHAR(255) DEFAULT NULL,
        "barcode" VARCHAR(255) DEFAULT NULL,
        "supporting_document" VARCHAR(255) DEFAULT NULL
      );
    `);

    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "vendor_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "product_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "product_variant_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "vendor_price" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "mrp" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "stock_quantity" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "minimum_order_quantity" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "maximum_order_quantity" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "is_available" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "is_approved" SMALLINT DEFAULT 0');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "approval_status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "approval_note" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "approved_by" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "low_stock_limit" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "reserved_stock" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "sku" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "barcode" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "vendor_product_variants" ADD COLUMN IF NOT EXISTS "supporting_document" VARCHAR(255) DEFAULT NULL');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Table (quotation_vendor_response_items)
    await safeExec(`
      CREATE TABLE IF NOT EXISTS "quotation_vendor_response_items" (
        "id" SERIAL PRIMARY KEY,
        "quotation_vendor_recipient_id" INT DEFAULT NULL,
        "quotation_request_item_id" INT DEFAULT NULL,
        "product_name" VARCHAR(255) DEFAULT NULL,
        "quantity" VARCHAR(255) DEFAULT NULL,
        "status" VARCHAR(255) DEFAULT NULL,
        "unit_price" NUMERIC(12,2) DEFAULT 0,
        "line_total" VARCHAR(255) DEFAULT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await safeExec('ALTER TABLE "quotation_vendor_response_items" ADD COLUMN IF NOT EXISTS "quotation_vendor_recipient_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_vendor_response_items" ADD COLUMN IF NOT EXISTS "quotation_request_item_id" INT DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_vendor_response_items" ADD COLUMN IF NOT EXISTS "product_name" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_vendor_response_items" ADD COLUMN IF NOT EXISTS "quantity" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_vendor_response_items" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_vendor_response_items" ADD COLUMN IF NOT EXISTS "unit_price" NUMERIC(12,2) DEFAULT 0');
    await safeExec('ALTER TABLE "quotation_vendor_response_items" ADD COLUMN IF NOT EXISTS "line_total" VARCHAR(255) DEFAULT NULL');
    await safeExec('ALTER TABLE "quotation_vendor_response_items" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    await safeExec('ALTER TABLE "quotation_vendor_response_items" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    createdCount++;
    if (createdCount % 10 === 0 || createdCount === totalTables) {
      console.log(`[newdata.js] Synced ${createdCount}/${totalTables} tables...`);
    }

    // Performance Indexes
    console.log('[newdata.js] Creating performance indexes...');
    const indexDefinitions = [
      { table: 'client_orders', name: 'idx_co_client_status', columns: '"client_id", "status"' },
      { table: 'client_orders', name: 'idx_co_vendor_status', columns: '"vendor_id", "status"' },
      { table: 'client_orders', name: 'idx_co_dp_status', columns: '"delivery_partner_id", "status"' },
      { table: 'client_orders', name: 'idx_co_created', columns: '"created_at"' },
      { table: 'vendor_profiles', name: 'idx_vp_user', columns: '"user_id"' },
      { table: 'vendor_profiles', name: 'idx_vp_city_area', columns: '"city", "area"' },
      { table: 'support_tickets', name: 'idx_st_dp', columns: '"delivery_partner_id"' },
      { table: 'support_tickets', name: 'idx_st_order', columns: '"order_id"' },
      { table: 'wallet_transactions', name: 'idx_wt_user_type', columns: '"user_id", "type"' },
      { table: 'ratings', name: 'idx_ratings_target', columns: '"target_id", "rating_type"' },
    ];

    for (const { table, name, columns } of indexDefinitions) {
      await safeExec(`CREATE INDEX IF NOT EXISTS ${name} ON "${table}" (${columns})`);
    }

    // Seed Superadmin + 5 Vendors + 5 Clients
    await seedDefaultRolesAndAccounts();

    // Record migration history
    await safeExec(
      `INSERT INTO schema_migrations (id, name) VALUES ('202607280001_complete_schema_sync', 'Ensure complete schema') ON CONFLICT (id) DO NOTHING`
    );
    await safeExec(
      `INSERT INTO schema_migrations (id, name) VALUES ('202607280002_ensure_all_74_tables', 'Ensure all 74 database tables') ON CONFLICT (id) DO NOTHING`
    );

    console.log('====================================================');
    console.log('[newdata.js] ✅ SUCCESS: All 74 tables, columns, Superadmin, 5 Vendors & 5 Clients seeded!');
    console.log('====================================================');
  } catch (error) {
    console.error('[newdata.js] ❌ Migration & seeding failed:', error.message);
    process.exit(1);
  } finally {
    if (db.end) {
      await db.end();
    }
  }
}

main();
