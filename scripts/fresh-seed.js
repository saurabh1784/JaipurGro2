const bcrypt = require('bcryptjs');
const pool = require('../db');
const { runMigrations } = require('../migrationRunner');

const DEFAULT_USERS = [
  // 1 Super Admin
  { name: 'Super Admin', email: 'superadmin@example.com', password: 'password', role: 'superadmin' },

  // 1 Admin
  { name: 'Admin User', email: 'admin@example.com', password: 'password', role: 'admin' },

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
  console.log('🔄 Resetting database: Truncating all tables and restarting auto-increment IDs at 1...');

  if (typeof pool.ensureDatabase === 'function') {
    await pool.ensureDatabase();
  }

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

  try {
    await runMigrations(pool);
  } catch (err) {
    console.log('Migrations up to date or already applied.');
  }

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

  console.log('🌱 Seeding default 12 accounts (1 Super Admin, 1 Admin, 5 Clients, 5 Vendors) with password: password ...');

  for (const user of DEFAULT_USERS) {
    const hashedPassword = await bcrypt.hash(user.password, 10);
    const [res] = await pool.query(
      'INSERT INTO users (name, email, phone, password, role, status) VALUES (?, ?, ?, ?, ?, ?)',
      [user.name, user.email, user.phone || null, hashedPassword, user.role, 'active']
    );
    const userId = res.insertId;

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

  console.log('✨ Database fresh reset & seeding complete!');
  console.log('📊 Verification Summary:');
  console.log('  - Users created: 12');
  console.log('  - Main Categories: 0');
  console.log('  - Subcategories: 0');
  console.log('  - Brands: 0');
  console.log('  - Products: 0');
  console.log('  - Default password for all users: password');
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
