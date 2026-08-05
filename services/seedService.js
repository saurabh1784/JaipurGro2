const pool = require('../db');
const bcrypt = require('bcryptjs');
const { ensureAllSchemaTables } = require('./schemaSyncService');

const DEFAULT_SUPERADMIN = {
  name: 'Super Admin',
  email: process.env.SUPERADMIN_EMAIL || 'superadmin@example.com',
  password: process.env.SUPERADMIN_PASSWORD || 'password',
  role: 'superadmin',
  status: 'active',
};

const DEFAULT_ROLES = [
  { name: 'Super Admin', slug: 'superadmin', description: 'Full system access', level: 0 },
  { name: 'Admin', slug: 'admin', description: 'Administrative management access', level: 1 },
  { name: 'Manager', slug: 'manager', description: 'Operational management access', level: 2 },
  { name: 'Staff', slug: 'staff', description: 'Store team operations access', level: 3 },
  { name: 'Delivery Person', slug: 'deliveryperson', description: 'Delivery partner access', level: 3 },
  { name: 'Client', slug: 'client', description: 'Customer store client access', level: 5 },
  { name: 'Vendor', slug: 'vendor', description: 'Seller vendor store access', level: 5 },
];

const DEFAULT_SETTINGS = [
  { setting_key: 'app_title', setting_value: 'JaipurGro - Online Grocery' },
  { setting_key: 'currency_symbol', setting_value: '₹' },
  { setting_key: 'currency_code', setting_value: 'INR' },
  { setting_key: 'maintenance_mode', setting_value: 'false' },
  { setting_key: 'maintenance_message', setting_value: 'We are under scheduled maintenance. Please check back soon.' },
  { setting_key: 'customer_minimum_version', setting_value: '1.0.0' },
  { setting_key: 'delivery_minimum_version', setting_value: '1.0.0' },
  { setting_key: 'vendor_minimum_version', setting_value: '1.0.0' },
];

async function seedRequiredData() {
  console.log('🌱 Seeding required default database data...');
  await ensureAllSchemaTables(pool);

  // 1. Seed Roles
  for (const r of DEFAULT_ROLES) {
    await pool.query(
      `INSERT INTO roles (name, slug, description, level)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, level = EXCLUDED.level`,
      [r.name, r.slug, r.description, r.level]
    ).catch(() => {});
  }

  // 2. Seed Default Superadmin Account
  const [existingSuperadmins] = await pool.query(
    "SELECT * FROM users WHERE LOWER(role) = 'superadmin' OR LOWER(role) = 'super admin' ORDER BY id ASC LIMIT 1"
  );

  if (!existingSuperadmins || existingSuperadmins.length === 0) {
    const hashedPassword = bcrypt.hashSync(DEFAULT_SUPERADMIN.password, 10);
    await pool.query(
      `INSERT INTO users (name, email, password, role, status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        DEFAULT_SUPERADMIN.name,
        DEFAULT_SUPERADMIN.email,
        hashedPassword,
        DEFAULT_SUPERADMIN.role,
        DEFAULT_SUPERADMIN.status,
      ]
    );
    console.log(`✅ Default Superadmin created: ${DEFAULT_SUPERADMIN.email}`);
  } else {
    console.log(`✅ Superadmin account already present: ${existingSuperadmins[0].email}`);
  }

  // 3. Seed Default System Settings
  for (const s of DEFAULT_SETTINGS) {
    await pool.query(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES (?, ?)
       ON CONFLICT (setting_key) DO NOTHING`,
      [s.setting_key, s.setting_value]
    ).catch(() => {});
  }

  console.log('✅ Required default data seeded successfully.');
  return true;
}

module.exports = {
  seedRequiredData,
  DEFAULT_SUPERADMIN,
};
