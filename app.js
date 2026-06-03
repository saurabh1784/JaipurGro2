const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const pgPool = require('./db');
const { restoreSnapshotOnStartup } = require('./databaseSnapshot');
const { runMigrations } = require('./migrationRunner');
const vendorNotifications = require('./vendorNotifications');
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const productRoutes = require('./routes/productRoutes');
const vendorRoutes = require('./routes/vendorRoutes');
const clientRoutes = require('./routes/clientRoutes');
const walletRoutes = require('./routes/walletRoutes');
const vendorProductRoutes = require('./routes/vendorProductRoutes');
const orderRoutes = require('./routes/orderRoutes');
const userController = require('./controllers/userController');
const managedProfileController = require('./controllers/managedProfileController');
const catalogController = require('./controllers/catalogController');
const commissionController = require('./controllers/commissionController');
const DeliveryCharge = require('./services/deliveryChargeService');
const Wallet = require('./models/Wallet');
const Product = require('./models/Product');
const VendorProduct = require('./models/VendorProduct');
const User = require('./models/User');
const Quotation = require('./models/Quotation');
const Catalog = require('./models/Catalog');
const CommissionSetting = require('./models/CommissionSetting');
const ProductSearch = require('./models/ProductSearch');
const Promotion = require('./models/Promotion');
const SupportTicket = require('./models/SupportTicket');
const {
  uploadBrandLogo,
  handleUploadError,
} = require('./middleware/brandLogoUpload');
const {
  uploadPromotionImage,
  promotionImagePath,
  handlePromotionImageUploadError,
} = require('./middleware/promotionImageUpload');
const {
  webOrJwtAuth,
  requireUserManagement,
  requireClientManagement,
  requireVendorManagement,
  requireProductManagement,
  requireWalletAccess,
  requireProfileAccess,
} = require('./middleware/webOrJwtAuth');

const app = express();
const port = process.env.PORT || 3000;
const appRevision = process.env.RENDER_GIT_COMMIT
  || process.env.COMMIT_SHA
  || process.env.SOURCE_VERSION
  || 'local';

const permissionLabels = {
  all: 'All Access',
  'dashboard.view': 'Dashboard',
  'users.manage': 'Manage Users',
  'roles.manage': 'Manage Roles',
  'clients.manage': 'Manage Clients',
  'vendors.manage': 'Manage Vendors',
  'products.manage': 'Manage Products',
  'wallets.view': 'View Wallets',
  'wallets.manage': 'Manage Wallets',
  'orders.manage': 'Manage Orders',
  'reports.view': 'Reports',
  'settings.manage': 'Settings',
  'inventory.manage': 'Manage Inventory',
  'discounts.view': 'View Discounts',
  'discounts.create': 'Create Discounts',
  'discounts.edit': 'Edit Discounts',
  'discounts.delete': 'Delete Discounts',
  'coupons.view': 'View Coupons',
  'coupons.create': 'Create Coupons',
  'coupons.edit': 'Edit Coupons',
  'coupons.delete': 'Delete Coupons',
  'coupons.apply': 'Apply Coupons',
  'coupon_history.view': 'View Coupon History',
  'support.manage': 'Manage Support Tickets',
};

function allPermissionKeys() {
  return Object.keys(permissionLabels);
}

function isSuperAdminUser(user) {
  if (!user) {
    return false;
  }

  const normalizeRole = (value) => String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (normalizeRole(user.role) === 'superadmin' || normalizeRole(user.roleName) === 'superadmin') {
    return true;
  }

  return Array.isArray(user.roles) && user.roles.some((role) => (
    normalizeRole(role.slug) === 'superadmin' || normalizeRole(role.name) === 'superadmin'
  ));
}

const roleSeeds = [
  {
    name: 'Super Admin',
    slug: 'superadmin',
    description: 'Full system access with every management permission.',
    level: 0,
    permissions: allPermissionKeys(),
  },
  {
    name: 'Admin',
    slug: 'admin',
    description: 'Administrative access for users, roles, products, orders, and reports.',
    level: 1,
    permissions: ['dashboard.view', 'users.manage', 'roles.manage', 'clients.manage', 'vendors.manage', 'products.manage', 'wallets.view', 'wallets.manage', 'orders.manage', 'reports.view', 'discounts.view', 'discounts.create', 'discounts.edit', 'discounts.delete', 'coupons.view', 'coupons.create', 'coupons.edit', 'coupons.delete', 'coupons.apply', 'coupon_history.view', 'support.manage'],
  },
  {
    name: 'Manager',
    slug: 'manager',
    description: 'Operational access for products, orders, and reporting.',
    level: 2,
    permissions: ['dashboard.view', 'clients.manage', 'vendors.manage', 'products.manage', 'wallets.view', 'wallets.manage', 'orders.manage', 'reports.view', 'discounts.view', 'coupons.view', 'coupons.apply', 'coupon_history.view', 'support.manage'],
  },
  {
    name: 'Staff',
    slug: 'staff',
    description: 'Store team access for day-to-day order handling.',
    level: 3,
    permissions: ['dashboard.view', 'wallets.view', 'orders.manage', 'support.manage'],
  },
  {
    name: 'Staff L1',
    slug: 'staff-l1',
    description: 'Entry-level staff access for dashboard, product lookup, and order support.',
    level: 4,
    permissions: ['dashboard.view', 'products.manage', 'orders.manage', 'support.manage'],
  },
  {
    name: 'Staff L2',
    slug: 'staff-l2',
    description: 'Mid-level staff access for clients, vendors, products, and orders.',
    level: 5,
    permissions: ['dashboard.view', 'clients.manage', 'vendors.manage', 'products.manage', 'orders.manage', 'wallets.view', 'support.manage'],
  },
  {
    name: 'Staff L3',
    slug: 'staff-l3',
    description: 'Senior staff access for operations, wallets, reports, and inventory.',
    level: 6,
    permissions: ['dashboard.view', 'clients.manage', 'vendors.manage', 'products.manage', 'inventory.manage', 'orders.manage', 'wallets.view', 'wallets.manage', 'reports.view', 'support.manage'],
  },
  {
    name: 'Support Staff',
    slug: 'support-staff',
    description: 'Customer support access for client, vendor, and order assistance.',
    level: 7,
    permissions: ['dashboard.view', 'clients.manage', 'vendors.manage', 'orders.manage', 'reports.view', 'support.manage'],
  },
  {
    name: 'Accountant',
    slug: 'accountant',
    description: 'Finance access for wallet, order, and reporting workflows.',
    level: 8,
    permissions: ['dashboard.view', 'wallets.view', 'wallets.manage', 'orders.manage', 'reports.view'],
  },
];

const userSeeds = [
  { name: 'Super Admin', email: 'superadmin@example.com', password: 'admin123', role: 'superadmin' },
  { name: 'Admin User', email: 'admin@example.com', password: 'admin123', role: 'admin' },
  { name: 'API Admin', email: 'apiadmin@example.com', phone: '9000000000', password: 'admin123', role: 'Admin' },
  { name: 'Demo Vendor', email: 'vendor@example.com', phone: '9000000001', password: 'admin123', role: 'Vendor' },
  { name: 'Demo Client', email: 'client@example.com', phone: '9000000002', password: 'admin123', role: 'Client' },
  { name: 'Store Manager', email: 'manager@example.com', password: 'admin123', role: 'manager' },
  { name: 'Order Staff', email: 'staff@example.com', password: 'admin123', role: 'staff' },
];

const groceryCatalogSeed = [
  ['Grains & Staples', { Atta: ['Aashirvaad'], Rice: ['Fortune'], 'Dal/Pulses': ['Tata Sampann'] }],
  ['Edible Oils', { Mustard: ['Fortune'], Sunflower: ['Dhara'], Groundnut: ['Patanjali'], Ghee: ['Amul'] }],
  ['Dairy & Bread', { Milk: ['Amul'], Curd: ['Mother Dairy'], Butter: ['Britannia'], Bread: ['Britannia'] }],
  ['Spices & Masala', { Whole: ['MDH'], Powder: ['Everest'], Blends: ['Catch'] }],
  ['Snacks & Namkeen', { Chips: ['Lays'], Bhujia: ['Haldiram’s'], Mixture: ['Bikaji'] }],
  ['Beverages', { Tea: ['Tata Tea'], Coffee: ['Nescafe'], Juices: ['Real'], 'Soft Drinks': ['Pepsi'] }],
  ['Packaged Foods', { Noodles: ['Maggi'], Pasta: ['Yippee'], Sauces: ['Kissan'] }],
  ['Personal Care', { Soap: ['Lux'], Shampoo: ['Dove'], Toothpaste: ['Colgate'] }],
  ['Cleaning & Household', { Detergent: ['Surf Excel', 'Rin'], Dishwash: ['Vim'] }],
  ['Dry Fruits', { Almonds: ['Happilo'], Cashew: ['Nutraj'], Raisins: ['Happilo'] }],
];

const demoProductSeeds = [
  { name: 'Aashirvaad Select Atta 5kg', category: 'Grains & Staples', subcategory: 'Atta', brand: 'Aashirvaad', price: 265, description: 'Premium whole wheat atta for daily home cooking.' },
  { name: 'Fortune Rozana Basmati Rice 5kg', category: 'Grains & Staples', subcategory: 'Rice', brand: 'Fortune', price: 520, description: 'Long grain basmati rice for regular meals.' },
  { name: 'Tata Sampann Toor Dal 1kg', category: 'Grains & Staples', subcategory: 'Dal/Pulses', brand: 'Tata Sampann', price: 185, description: 'Unpolished toor dal packed for freshness.' },
  { name: 'Fortune Kachi Ghani Mustard Oil 1L', category: 'Edible Oils', subcategory: 'Mustard', brand: 'Fortune', price: 170, description: 'Strong aroma mustard oil for Indian cooking.' },
  { name: 'Dhara Refined Sunflower Oil 1L', category: 'Edible Oils', subcategory: 'Sunflower', brand: 'Dhara', price: 145, description: 'Light refined sunflower oil for everyday use.' },
  { name: 'Patanjali Groundnut Oil 1L', category: 'Edible Oils', subcategory: 'Groundnut', brand: 'Patanjali', price: 210, description: 'Groundnut oil with a rich nutty flavor.' },
  { name: 'Amul Pure Ghee 1L', category: 'Edible Oils', subcategory: 'Ghee', brand: 'Amul', price: 650, description: 'Rich dairy ghee for cooking and sweets.' },
  { name: 'Amul Taaza Milk 1L', category: 'Dairy & Bread', subcategory: 'Milk', brand: 'Amul', price: 68, description: 'Fresh toned milk for daily consumption.' },
  { name: 'Mother Dairy Classic Curd 400g', category: 'Dairy & Bread', subcategory: 'Curd', brand: 'Mother Dairy', price: 45, description: 'Thick and creamy curd pack.' },
  { name: 'Britannia Salted Butter 500g', category: 'Dairy & Bread', subcategory: 'Butter', brand: 'Britannia', price: 285, description: 'Salted table butter for breakfast and baking.' },
  { name: 'Britannia Whole Wheat Bread 400g', category: 'Dairy & Bread', subcategory: 'Bread', brand: 'Britannia', price: 55, description: 'Soft wheat bread loaf for sandwiches.' },
  { name: 'MDH Whole Garam Masala 100g', category: 'Spices & Masala', subcategory: 'Whole', brand: 'MDH', price: 92, description: 'Classic whole spice blend for curries and gravies.' },
  { name: 'Everest Turmeric Powder 200g', category: 'Spices & Masala', subcategory: 'Powder', brand: 'Everest', price: 78, description: 'Fine turmeric powder with bright color.' },
  { name: 'Catch Kitchen King Masala 100g', category: 'Spices & Masala', subcategory: 'Blends', brand: 'Catch', price: 155, description: 'Aromatic spice blend for rich Indian gravies.' },
  { name: 'Lays Classic Salted Chips 90g', category: 'Snacks & Namkeen', subcategory: 'Chips', brand: 'Lays', price: 40, description: 'Crispy salted potato chips.' },
  { name: 'Haldiram Bhujia Sev 400g', category: 'Snacks & Namkeen', subcategory: 'Bhujia', brand: 'Haldiram’s', price: 110, description: 'Crunchy spicy bhujia for snacking.' },
  { name: 'Bikaji Tana Bana Mixture 400g', category: 'Snacks & Namkeen', subcategory: 'Mixture', brand: 'Bikaji', price: 125, description: 'Traditional savory namkeen mixture.' },
  { name: 'Tata Tea Premium 1kg', category: 'Beverages', subcategory: 'Tea', brand: 'Tata Tea', price: 485, description: 'Strong tea blend for daily chai.' },
  { name: 'Nescafe Classic Coffee 200g', category: 'Beverages', subcategory: 'Coffee', brand: 'Nescafe', price: 610, description: 'Instant coffee with rich aroma.' },
  { name: 'Real Mixed Fruit Juice 1L', category: 'Beverages', subcategory: 'Juices', brand: 'Real', price: 125, description: 'Ready-to-serve mixed fruit juice.' },
  { name: 'Pepsi Soft Drink 2.25L', category: 'Beverages', subcategory: 'Soft Drinks', brand: 'Pepsi', price: 105, description: 'Chilled cola soft drink bottle.' },
  { name: 'Maggi 2-Minute Noodles 560g', category: 'Packaged Foods', subcategory: 'Noodles', brand: 'Maggi', price: 115, description: 'Family pack instant masala noodles.' },
  { name: 'Kissan Fresh Tomato Ketchup 950g', category: 'Packaged Foods', subcategory: 'Sauces', brand: 'Kissan', price: 155, description: 'Tomato ketchup for snacks and meals.' },
  { name: 'Surf Excel Easy Wash 1kg', category: 'Cleaning & Household', subcategory: 'Detergent', brand: 'Surf Excel', price: 135, description: 'Detergent powder for tough stains.' },
  { name: 'Happilo Premium Almonds 500g', category: 'Dry Fruits', subcategory: 'Almonds', brand: 'Happilo', price: 475, description: 'Premium California almonds for healthy snacking.' },
];

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/default.png', (req, res) => {
  res.type('image/svg+xml').send(`
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
      <rect width="320" height="240" fill="#f1f5f9"/>
      <rect x="96" y="54" width="128" height="132" rx="14" fill="#d8dee6"/>
      <path d="M122 96h76M122 122h76M122 148h52" stroke="#64748b" stroke-width="10" stroke-linecap="round"/>
    </svg>
  `);
});

app.get('/api/system/status', async (req, res) => {
  try {
    const [migrationTableRows] = await pool.query("SELECT to_regclass('public.schema_migrations') AS table_name");
    const [syncTableRows] = await pool.query("SELECT to_regclass('public.schema_sync_runs') AS table_name");
    const [restoreTableRows] = await pool.query("SELECT to_regclass('public.snapshot_restore_runs') AS table_name");
    const hasMigrationTable = Boolean(migrationTableRows[0] && migrationTableRows[0].table_name);
    const hasSyncTable = Boolean(syncTableRows[0] && syncTableRows[0].table_name);
    const hasRestoreTable = Boolean(restoreTableRows[0] && restoreTableRows[0].table_name);
    const [rows] = hasMigrationTable
      ? await pool.query(
          `SELECT id, name, run_at
           FROM schema_migrations
           ORDER BY id DESC
           LIMIT 10`
        )
      : [[]];
    const [syncRows] = hasSyncTable
      ? await pool.query(
          `SELECT revision, synced_at
           FROM schema_sync_runs
           ORDER BY synced_at DESC
           LIMIT 5`
        )
      : [[]];
    const [restoreRows] = hasRestoreTable
      ? await pool.query(
          `SELECT snapshot_hash, snapshot_file, revision, restored_at
           FROM snapshot_restore_runs
           ORDER BY restored_at DESC
           LIMIT 5`
        )
      : [[]];
    res.json({
      success: true,
      service: 'JaipurGro2',
      revision: appRevision,
      migration_table_ready: hasMigrationTable,
      schema_sync_table_ready: hasSyncTable,
      snapshot_restore_table_ready: hasRestoreTable,
      migrations: rows,
      schema_sync_runs: syncRows,
      snapshot_restore_runs: restoreRows,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      service: 'JaipurGro2',
      revision: appRevision,
      message: error.message,
    });
  }
});

app.use(
  session({
    secret: 'jaipur_role_based_login_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 },
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);

let pool = pgPool;

function parsePermissions(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function normalizePermissionList(value) {
  return [...new Set([].concat(value || []).filter((permission) => Object.prototype.hasOwnProperty.call(permissionLabels, permission)))];
}

function roleCan(user, permission) {
  if (isSuperAdminUser(user)) {
    return true;
  }

  const permissions = normalizePermissionList(user && user.permissions);
  return permissions.includes('all') || permissions.includes(permission);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }

  if (requestWantsJson(req)) {
    return res.status(401).json({ success: false, message: 'Login required. Please sign in again.' });
  }

  res.redirect('/');
}

function requirePermission(permission) {
  return (req, res, next) => {
    const currentUser = req.authUser || (req.session && req.session.user);
    if (roleCan(currentUser, permission)) {
      return next();
    }

    if (requestWantsJson(req)) {
      return res.status(403).json({ success: false, message: 'Permission denied' });
    }

    res.status(403).render('dashboard', {
      user: currentUser,
      dashboard: buildDashboard(currentUser, req.path),
      error: 'You do not have permission to open that page.',
    });
  };
}

function requireSessionRole(role, loginPath) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.redirect(loginPath);
    }

    if (req.session.user.role !== role) {
      return res.redirect(loginPath);
    }

    next();
  };
}

function requireAuthRole(role) {
  return (req, res, next) => {
    const user = req.authUser || (req.session && req.session.user);
    if (!user || user.role !== role) {
      return res.status(403).json({ success: false, message: `Only ${role} users can access this resource` });
    }
    next();
  };
}

function requireAdminMaintenance(req, res, next) {
  const currentUser = req.authUser || (req.session && req.session.user);
  if (isSuperAdminUser(currentUser) || ['admin', 'superadmin'].includes(String(currentUser && currentUser.role || '').toLowerCase())) {
    return next();
  }

  if (requestWantsJson(req)) {
    return res.status(403).json({ success: false, message: 'Only admin users can run maintenance actions' });
  }

  return res.redirect('/dashboard?error=Only%20admin%20users%20can%20run%20maintenance%20actions');
}

function requestWantsJson(req) {
  const accept = req.get('accept') || '';
  const requestedWith = req.get('x-requested-with') || '';
  return req.query.format === 'json' || accept.includes('application/json') || requestedWith.toLowerCase() === 'xmlhttprequest';
}

async function columnExists(tableName, columnName) {
  const { rows } = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function indexExists(tableName, indexName) {
  const { rows } = await pool.query(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function addColumnIfMissing(tableName, columnName, definition) {
  if (!(await columnExists(tableName, columnName))) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function addUniqueIndexIfMissing(tableName, indexName, columnName) {
  if (!(await indexExists(tableName, indexName))) {
    await pool.query(`ALTER TABLE ${tableName} ADD CONSTRAINT ${indexName} UNIQUE (${columnName})`);
  }
}

async function settingValue(key, fallback = '') {
  try {
    const [rows] = await pool.query('SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1', [key]);
    return rows[0] && rows[0].setting_value !== null && rows[0].setting_value !== undefined
      ? String(rows[0].setting_value)
      : fallback;
  } catch {
    return fallback;
  }
}

async function settingGroup(keys) {
  const values = {};
  for (const key of keys) {
    values[key] = await settingValue(key);
  }
  return values;
}

async function saveSetting(key, value, isSecret = false) {
  await pool.query(
    `INSERT INTO app_settings (setting_key, setting_value, is_secret)
     VALUES (?, ?, ?)
     ON CONFLICT (setting_key) DO UPDATE
     SET setting_value = EXCLUDED.setting_value,
         is_secret = EXCLUDED.is_secret,
         updated_at = CURRENT_TIMESTAMP`,
    [key, value || '', isSecret ? 1 : 0]
  );
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function seedGroceryCatalog() {
  for (const [categoryName, subcategories] of groceryCatalogSeed) {
    const categorySlug = slugify(categoryName);
    await pool.query(
      `INSERT INTO categories (name, slug, status, is_active)
       VALUES (?, ?, 'active', 1)
       ON CONFLICT (name) DO UPDATE
       SET is_deleted = 0, status = 'active', is_active = 1, slug = EXCLUDED.slug`,
      [categoryName, categorySlug]
    );
    const [categoryRows] = await pool.query('SELECT id FROM categories WHERE name = ? LIMIT 1', [categoryName]);
    const categoryId = categoryRows[0].id;

    for (const [subcategoryName, brands] of Object.entries(subcategories)) {
      await pool.query(
        `INSERT INTO sub_categories (category_id, name, slug, status, is_active)
         VALUES (?, ?, ?, 'active', 1)
         ON CONFLICT (category_id, name) DO UPDATE
         SET is_deleted = 0, status = 'active', is_active = 1, slug = EXCLUDED.slug`,
        [categoryId, subcategoryName, slugify(subcategoryName)]
      );
      const [subcategoryRows] = await pool.query(
        'SELECT id FROM sub_categories WHERE category_id = ? AND name = ? LIMIT 1',
        [categoryId, subcategoryName]
      );
      const subcategoryId = subcategoryRows[0].id;

      for (const brandName of brands) {
        await pool.query(
          `INSERT INTO brands (category_id, sub_category_id, name, slug, status, is_active)
           VALUES (?, ?, ?, ?, 'active', 1)
           ON CONFLICT (category_id, sub_category_id, name) DO UPDATE
           SET is_deleted = 0, status = 'active', is_active = 1, slug = EXCLUDED.slug`,
          [categoryId, subcategoryId, brandName, slugify(brandName)]
        );
      }
    }
  }
}

async function seedDemoProducts() {
  const [adminRows] = await pool.query(
    "SELECT id FROM users WHERE email = ? AND LOWER(role) IN ('admin', 'superadmin') AND is_deleted = 0 ORDER BY id ASC LIMIT 1",
    ['admin@example.com']
  );
  const adminId = adminRows[0] ? adminRows[0].id : null;

  for (const product of demoProductSeeds) {
    const [relationRows] = await pool.query(
      `SELECT c.id AS category_id, s.id AS sub_category_id, b.id AS brand_id
       FROM categories c
       INNER JOIN sub_categories s ON s.category_id = c.id
       INNER JOIN brands b ON b.category_id = c.id AND b.sub_category_id = s.id
       WHERE LOWER(c.name) = LOWER(?)
         AND LOWER(s.name) = LOWER(?)
         AND LOWER(b.name) = LOWER(?)
       LIMIT 1`,
      [product.category, product.subcategory, product.brand]
    );

    if (!relationRows.length) {
      console.warn(`Skipping demo product seed, missing catalog relation: ${product.name}`);
      continue;
    }

    const relation = relationRows[0];
    const [existingRows] = await pool.query('SELECT id FROM products WHERE name = ? AND is_deleted = 0 LIMIT 1', [product.name]);

    if (existingRows.length) {
      continue;
    }

    await pool.query(
      `INSERT INTO products
       (name, description, price, image_url, category_id, sub_category_id, brand_id, approval_status, approved_by, approved_at, rejection_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP, NULL)`,
      [
        product.name,
        product.description,
        product.price,
        '/default.png',
        relation.category_id,
        relation.sub_category_id,
        relation.brand_id,
        adminId,
      ]
    );
  }
}

async function initDatabase() {
  console.log('Database init: ensure database');
  await pgPool.ensureDatabase();
  console.log('Database init: connectivity check');
  await pool.query('SELECT 1');
  console.log('Database init: syncing schema');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      setting_key VARCHAR(120) NOT NULL,
      setting_value TEXT DEFAULT NULL,
      is_secret TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_app_settings_key (setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      phone VARCHAR(30) DEFAULT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'staff',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await addColumnIfMissing('users', 'phone', 'VARCHAR(30) DEFAULT NULL AFTER email');
  await addColumnIfMissing('users', 'status', "VARCHAR(20) NOT NULL DEFAULT 'active' AFTER role");
  await addColumnIfMissing('users', 'theme_mode', "VARCHAR(20) NOT NULL DEFAULT 'light' AFTER status");
  await addColumnIfMissing('users', 'is_deleted', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER status');
  await addColumnIfMissing('users', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');
  await addUniqueIndexIfMissing('users', 'idx_users_phone_unique', 'phone');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL UNIQUE,
      balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      currency VARCHAR(10) NOT NULL DEFAULT 'INR',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_wallets_status (status),
      CONSTRAINT fk_wallets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      wallet_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      type VARCHAR(20) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      balance_before DECIMAL(12,2) NOT NULL,
      balance_after DECIMAL(12,2) NOT NULL,
      reference VARCHAR(120) DEFAULT NULL,
      note TEXT DEFAULT NULL,
      created_by INT UNSIGNED DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_wallet_transactions_wallet (wallet_id),
      KEY idx_wallet_transactions_user (user_id),
      KEY idx_wallet_transactions_type (type),
      CONSTRAINT fk_wallet_transactions_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE,
      CONSTRAINT fk_wallet_transactions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_wallet_transactions_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS commission_settings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      role_slug VARCHAR(100) NOT NULL,
      role_name VARCHAR(100) NOT NULL,
      transaction_type VARCHAR(50) NOT NULL,
      commission_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
      commission_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      min_commission DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      max_commission DECIMAL(10,2) DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_commission_role_transaction (role_slug, transaction_type),
      KEY idx_commission_transaction (transaction_type),
      KEY idx_commission_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('wallet_transactions', 'commission_setting_id', 'INT UNSIGNED DEFAULT NULL AFTER amount');
  await addColumnIfMissing('wallet_transactions', 'commission_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER commission_setting_id');
  await addColumnIfMissing('wallet_transactions', 'net_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER commission_amount');
  await addColumnIfMissing('wallet_transactions', 'transaction_by_name', 'VARCHAR(100) DEFAULT NULL AFTER created_by');
  await addColumnIfMissing('wallet_transactions', 'transaction_by_email', 'VARCHAR(150) DEFAULT NULL AFTER transaction_by_name');
  await addColumnIfMissing('wallet_transactions', 'transaction_by_role', 'VARCHAR(50) DEFAULT NULL AFTER transaction_by_email');
  await addColumnIfMissing('wallet_transactions', 'transaction_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER transaction_by_role');
  await pool.query(`
    UPDATE wallet_transactions wt
    SET transaction_by_name = COALESCE(wt.transaction_by_name, u.name),
        transaction_by_email = COALESCE(wt.transaction_by_email, u.email),
        transaction_by_role = COALESCE(wt.transaction_by_role, u.role),
        transaction_at = COALESCE(wt.transaction_at, wt.created_at)
    FROM users u
    WHERE wt.created_by = u.id
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL UNIQUE,
      slug VARCHAR(100) NOT NULL UNIQUE,
      description TEXT DEFAULT NULL,
      parent_id INT UNSIGNED DEFAULT NULL,
      level INT NOT NULL DEFAULT 0,
      permissions JSON DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_parent (parent_id),
      KEY idx_level (level),
      CONSTRAINT fk_parent FOREIGN KEY (parent_id) REFERENCES roles(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INT UNSIGNED NOT NULL,
      role_id INT UNSIGNED NOT NULL,
      assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      assigned_by INT UNSIGNED DEFAULT NULL,
      PRIMARY KEY (user_id, role_id),
      KEY idx_user (user_id),
      KEY idx_role (role_id),
      CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_role_id FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendor_profiles (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL UNIQUE,
      business_name VARCHAR(150) DEFAULT NULL,
      logo_path VARCHAR(255) DEFAULT NULL,
      storefront_image_path VARCHAR(255) DEFAULT NULL,
      address TEXT DEFAULT NULL,
      country VARCHAR(80) DEFAULT NULL,
      state VARCHAR(80) DEFAULT NULL,
      city VARCHAR(80) DEFAULT NULL,
      gst_number VARCHAR(50) DEFAULT NULL,
      services JSON DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      CONSTRAINT fk_vendor_profile_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('vendor_profiles', 'country', 'VARCHAR(80) DEFAULT NULL AFTER address');
  await addColumnIfMissing('vendor_profiles', 'state', 'VARCHAR(80) DEFAULT NULL AFTER country');
  await addColumnIfMissing('vendor_profiles', 'city', 'VARCHAR(80) DEFAULT NULL AFTER state');
  await addColumnIfMissing('vendor_profiles', 'logo_path', 'VARCHAR(255) DEFAULT NULL AFTER business_name');
  await addColumnIfMissing('vendor_profiles', 'storefront_image_path', 'VARCHAR(255) DEFAULT NULL AFTER logo_path');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_profiles (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL UNIQUE,
      address TEXT DEFAULT NULL,
      country VARCHAR(80) DEFAULT NULL,
      state VARCHAR(80) DEFAULT NULL,
      city VARCHAR(80) DEFAULT NULL,
      age INT UNSIGNED DEFAULT NULL,
      gender VARCHAR(30) DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      CONSTRAINT fk_client_profile_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('client_profiles', 'country', 'VARCHAR(80) DEFAULT NULL AFTER address');
  await addColumnIfMissing('client_profiles', 'state', 'VARCHAR(80) DEFAULT NULL AFTER country');
  await addColumnIfMissing('client_profiles', 'city', 'VARCHAR(80) DEFAULT NULL AFTER state');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_delivery_addresses (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      label VARCHAR(80) NOT NULL DEFAULT 'Home',
      recipient_name VARCHAR(120) DEFAULT NULL,
      phone VARCHAR(30) DEFAULT NULL,
      address TEXT NOT NULL,
      city VARCHAR(80) DEFAULT NULL,
      state VARCHAR(80) DEFAULT NULL,
      country VARCHAR(80) DEFAULT NULL,
      pincode VARCHAR(20) DEFAULT NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_client_delivery_addresses_user (user_id),
      CONSTRAINT fk_client_delivery_addresses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_profiles (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL UNIQUE,
      permissions JSON DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      CONSTRAINT fk_admin_profile_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(150) NOT NULL,
      slug VARCHAR(180) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_category_name (name),
      KEY idx_category_active_deleted (is_active, is_deleted)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('categories', 'slug', 'VARCHAR(180) NOT NULL DEFAULT "" AFTER name');
  await addColumnIfMissing('categories', 'tax_name', 'VARCHAR(80) DEFAULT NULL AFTER slug');
  await addColumnIfMissing('categories', 'tax_percentage', 'DECIMAL(7,2) DEFAULT NULL AFTER tax_name');
  await pool.query(
    `UPDATE categories
     SET tax_name = CASE WHEN tax_name IS NULL OR TRIM(tax_name) = '' THEN 'GST' ELSE tax_name END,
         tax_percentage = COALESCE(tax_percentage, 5.00)
     WHERE is_deleted = 0`
  );
  await addColumnIfMissing('categories', 'status', "VARCHAR(20) NOT NULL DEFAULT 'active' AFTER slug");
  await addColumnIfMissing('categories', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER status');
  await addColumnIfMissing('categories', 'is_deleted', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active');
  await addColumnIfMissing('categories', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER is_deleted');
  await addColumnIfMissing('categories', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sub_categories (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      category_id INT UNSIGNED NOT NULL,
      name VARCHAR(150) NOT NULL,
      slug VARCHAR(180) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_subcategory_name_parent (category_id, name),
      KEY idx_subcategory_category (category_id),
      CONSTRAINT fk_sub_categories_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('sub_categories', 'slug', 'VARCHAR(180) NOT NULL DEFAULT "" AFTER name');
  await addColumnIfMissing('sub_categories', 'status', "VARCHAR(20) NOT NULL DEFAULT 'active' AFTER slug");
  await addColumnIfMissing('sub_categories', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER status');
  await addColumnIfMissing('sub_categories', 'is_deleted', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active');
  await addColumnIfMissing('sub_categories', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER is_deleted');
  await addColumnIfMissing('sub_categories', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS brands (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      category_id INT UNSIGNED NOT NULL,
      sub_category_id INT UNSIGNED NOT NULL,
      name VARCHAR(150) NOT NULL,
      slug VARCHAR(180) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_brand_name_parent (category_id, sub_category_id, name),
      KEY idx_brand_category (category_id),
      KEY idx_brand_sub_category (sub_category_id),
      CONSTRAINT fk_brands_category_new FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
      CONSTRAINT fk_brands_sub_category_new FOREIGN KEY (sub_category_id) REFERENCES sub_categories(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('brands', 'category_id', 'INT UNSIGNED NULL AFTER id');
  await addColumnIfMissing('brands', 'sub_category_id', 'INT UNSIGNED NULL AFTER category_id');
  await addColumnIfMissing('brands', 'slug', 'VARCHAR(180) NOT NULL DEFAULT "" AFTER name');
  await addColumnIfMissing('brands', 'logo_path', 'VARCHAR(255) DEFAULT NULL AFTER slug');
  await addColumnIfMissing('brands', 'status', "VARCHAR(20) NOT NULL DEFAULT 'active' AFTER slug");
  await addColumnIfMissing('brands', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER status');
  await addColumnIfMissing('brands', 'is_deleted', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active');
  await addColumnIfMissing('brands', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER is_deleted');
  await addColumnIfMissing('brands', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');
  if (await columnExists('brands', 'subcategory_id')) {
    await pool.query('ALTER TABLE brands ALTER COLUMN subcategory_id DROP NOT NULL');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(180) NOT NULL,
      description TEXT DEFAULT NULL,
      price DECIMAL(10,2) NOT NULL,
      weight_kg DECIMAL(10,3) NOT NULL DEFAULT 0.000,
      image_url VARCHAR(255) DEFAULT NULL,
      category_id INT UNSIGNED NOT NULL,
      sub_category_id INT UNSIGNED NOT NULL,
      brand_id INT UNSIGNED NOT NULL,
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_products_name (name),
      KEY idx_products_category (category_id),
      KEY idx_products_sub_category (sub_category_id),
      KEY idx_products_brand (brand_id),
      KEY idx_products_deleted (is_deleted),
      CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
      CONSTRAINT fk_products_sub_category FOREIGN KEY (sub_category_id) REFERENCES sub_categories(id) ON DELETE RESTRICT,
      CONSTRAINT fk_products_brand FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('products', 'image_url', 'VARCHAR(255) DEFAULT NULL AFTER price');
  await addColumnIfMissing('products', 'weight_kg', 'DECIMAL(10,3) NOT NULL DEFAULT 0.000 AFTER price');
  await addColumnIfMissing('products', 'tax_name', 'VARCHAR(80) DEFAULT NULL AFTER image_url');
  await addColumnIfMissing('products', 'tax_percentage', 'DECIMAL(7,2) DEFAULT NULL AFTER tax_name');
  await addColumnIfMissing('products', 'approval_status', "VARCHAR(20) NOT NULL DEFAULT 'approved' AFTER is_deleted");
  await addColumnIfMissing('products', 'created_by_vendor_id', 'INT UNSIGNED DEFAULT NULL AFTER approval_status');
  await addColumnIfMissing('products', 'approved_by', 'INT UNSIGNED DEFAULT NULL AFTER created_by_vendor_id');
  await addColumnIfMissing('products', 'approved_at', 'TIMESTAMP NULL DEFAULT NULL AFTER approved_by');
  await addColumnIfMissing('products', 'rejection_reason', 'TEXT DEFAULT NULL AFTER approved_at');
  await pool.query("UPDATE products SET approval_status = 'approved' WHERE approval_status IS NULL OR approval_status = ''");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_search_history (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED DEFAULT NULL,
      search_keyword VARCHAR(255) NOT NULL,
      clicked_product_id INT UNSIGNED DEFAULT NULL,
      viewed_product_id INT UNSIGNED DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_product_search_user (user_id),
      KEY idx_product_search_keyword (search_keyword),
      KEY idx_product_search_created (created_at),
      CONSTRAINT fk_product_search_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_product_search_clicked_product FOREIGN KEY (clicked_product_id) REFERENCES products(id) ON DELETE SET NULL,
      CONSTRAINT fk_product_search_viewed_product FOREIGN KEY (viewed_product_id) REFERENCES products(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_keywords (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      product_id INT UNSIGNED NOT NULL,
      keyword VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_product_keyword (product_id, keyword),
      KEY idx_product_keywords_keyword (keyword),
      CONSTRAINT fk_product_keywords_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sponsored_products (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      product_id INT UNSIGNED NOT NULL UNIQUE,
      is_sponsored TINYINT(1) NOT NULL DEFAULT 0,
      priority_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_sponsored_active_priority (is_sponsored, priority_order),
      CONSTRAINT fk_sponsored_products_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_recent_activity (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED DEFAULT NULL,
      product_id INT UNSIGNED NOT NULL,
      activity_type VARCHAR(30) NOT NULL,
      metadata JSON DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_recent_activity_user_type (user_id, activity_type, created_at),
      KEY idx_recent_activity_product (product_id),
      CONSTRAINT fk_recent_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_recent_activity_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_ranking_scores (
      product_id INT UNSIGNED NOT NULL,
      popularity_score DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      click_score DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      purchase_score DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      search_score DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (product_id),
      CONSTRAINT fk_product_ranking_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendor_products (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      product_id INT UNSIGNED NOT NULL,
      vendor_id INT UNSIGNED NOT NULL,
      quantity DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      image_url VARCHAR(255) DEFAULT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_vendor_product (product_id, vendor_id),
      KEY idx_vendor_products_vendor (vendor_id),
      KEY idx_vendor_products_status_quantity (status, quantity),
      CONSTRAINT fk_vendor_products_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT fk_vendor_products_vendor FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('vendor_products', 'price', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER quantity');
  await addColumnIfMissing('vendor_products', 'image_url', 'VARCHAR(255) DEFAULT NULL AFTER quantity');
  await pool.query("UPDATE vendor_products SET quantity = 0 WHERE status = 'unavailable' AND quantity <> 0");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendor_client_product_prices (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      product_id INT UNSIGNED NOT NULL,
      vendor_id INT UNSIGNED NOT NULL,
      client_id INT UNSIGNED NOT NULL,
      custom_price DECIMAL(12,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_vendor_client_product_price (product_id, vendor_id, client_id),
      KEY idx_vendor_client_price_client (client_id),
      CONSTRAINT fk_vcpp_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT fk_vcpp_vendor FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_vcpp_client FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

   await pool.query(`
     CREATE TABLE IF NOT EXISTS client_orders (
       id INT UNSIGNED NOT NULL AUTO_INCREMENT,
       user_id INT UNSIGNED NOT NULL,
       vendor_id INT UNSIGNED DEFAULT NULL,
       total_amount DECIMAL(12,2) NOT NULL,
       status VARCHAR(20) NOT NULL DEFAULT 'pending',
       delivery_status VARCHAR(20) NOT NULL DEFAULT 'pending',
       delivery_partner_id INT UNSIGNED DEFAULT NULL,
       delivery_otp VARCHAR(10) DEFAULT NULL,
       client_name VARCHAR(100) DEFAULT NULL,
       client_phone VARCHAR(30) DEFAULT NULL,
       client_address TEXT DEFAULT NULL,
       assigned_at TIMESTAMP NULL DEFAULT NULL,
       ready_at TIMESTAMP NULL DEFAULT NULL,
       delivered_at TIMESTAMP NULL DEFAULT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       PRIMARY KEY (id),
       KEY idx_client_orders_user (user_id),
       KEY idx_client_orders_vendor (vendor_id),
       KEY idx_client_orders_delivery_partner (delivery_partner_id),
       KEY idx_client_orders_delivery_status (delivery_status),
       CONSTRAINT fk_client_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
       CONSTRAINT fk_client_orders_vendor FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE SET NULL,
       CONSTRAINT fk_client_orders_delivery_partner FOREIGN KEY (delivery_partner_id) REFERENCES users(id) ON DELETE SET NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
   `);

   await pool.query(`
     CREATE TABLE IF NOT EXISTS client_orders (
       id INT UNSIGNED NOT NULL AUTO_INCREMENT,
       user_id INT UNSIGNED NOT NULL,
       vendor_id INT UNSIGNED DEFAULT NULL,
       total_amount DECIMAL(12,2) NOT NULL,
       status VARCHAR(20) NOT NULL DEFAULT 'pending',
       delivery_status VARCHAR(20) NOT NULL DEFAULT 'pending',
       delivery_partner_id INT UNSIGNED DEFAULT NULL,
       delivery_otp VARCHAR(10) DEFAULT NULL,
       client_name VARCHAR(100) DEFAULT NULL,
       client_phone VARCHAR(30) DEFAULT NULL,
       client_address TEXT DEFAULT NULL,
       assigned_at TIMESTAMP NULL DEFAULT NULL,
       ready_at TIMESTAMP NULL DEFAULT NULL,
       delivered_at TIMESTAMP NULL DEFAULT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       PRIMARY KEY (id),
       KEY idx_client_orders_user (user_id),
       KEY idx_client_orders_vendor (vendor_id),
       KEY idx_client_orders_delivery_partner (delivery_partner_id),
       KEY idx_client_orders_delivery_status (delivery_status),
       CONSTRAINT fk_client_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
       CONSTRAINT fk_client_orders_vendor FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE SET NULL,
       CONSTRAINT fk_client_orders_delivery_partner FOREIGN KEY (delivery_partner_id) REFERENCES users(id) ON DELETE SET NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
   `);

   // Add new columns to existing client_orders table if missing
   await addColumnIfMissing('client_orders', 'vendor_id', 'INT UNSIGNED DEFAULT NULL AFTER user_id');
  await addColumnIfMissing('client_orders', 'delivery_status', "VARCHAR(20) NOT NULL DEFAULT 'pending' AFTER status");
  await addColumnIfMissing('client_orders', 'delivery_partner_id', 'INT UNSIGNED DEFAULT NULL AFTER delivery_status');
  await addColumnIfMissing('client_orders', 'delivery_otp', 'VARCHAR(10) DEFAULT NULL AFTER delivery_partner_id');
  await addColumnIfMissing('client_orders', 'otp_set_by', 'INT UNSIGNED DEFAULT NULL AFTER delivery_otp');
  await addColumnIfMissing('client_orders', 'otp_set_at', 'TIMESTAMP NULL DEFAULT NULL AFTER otp_set_by');
  await addColumnIfMissing('client_orders', 'client_name', 'VARCHAR(100) DEFAULT NULL AFTER delivery_otp');
   await addColumnIfMissing('client_orders', 'client_phone', 'VARCHAR(30) DEFAULT NULL AFTER client_name');
  await addColumnIfMissing('client_orders', 'client_address', 'TEXT DEFAULT NULL AFTER client_phone');
  await addColumnIfMissing('client_orders', 'assigned_at', 'TIMESTAMP NULL DEFAULT NULL AFTER client_address');
  await addColumnIfMissing('client_orders', 'ready_at', 'TIMESTAMP NULL DEFAULT NULL AFTER assigned_at');
  await addColumnIfMissing('client_orders', 'delivered_at', 'TIMESTAMP NULL DEFAULT NULL AFTER ready_at');
  await addColumnIfMissing('client_orders', 'status_updated_at', 'TIMESTAMP NULL DEFAULT NULL AFTER updated_at');
  await addColumnIfMissing('client_orders', 'subtotal_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER vendor_id');
  await addColumnIfMissing('client_orders', 'discount_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER subtotal_amount');
  await addColumnIfMissing('client_orders', 'savings_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER discount_amount');
  await addColumnIfMissing('client_orders', 'delivery_charge', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER savings_amount');
  await addColumnIfMissing('client_orders', 'coupon_id', 'INT UNSIGNED DEFAULT NULL AFTER delivery_charge');
  await addColumnIfMissing('client_orders', 'coupon_code', 'VARCHAR(80) DEFAULT NULL AFTER coupon_id');
  await addColumnIfMissing('client_orders', 'discount_id', 'INT UNSIGNED DEFAULT NULL AFTER coupon_code');
  await addColumnIfMissing('client_orders', 'discount_label', 'VARCHAR(150) DEFAULT NULL AFTER discount_id');
  await addColumnIfMissing('client_orders', 'order_type', "VARCHAR(20) NOT NULL DEFAULT 'direct' AFTER discount_label");
  await addColumnIfMissing('client_orders', 'invoice_number', 'VARCHAR(80) DEFAULT NULL AFTER order_type');
  await addColumnIfMissing('client_orders', 'invoice_pdf_path', 'VARCHAR(255) DEFAULT NULL AFTER invoice_number');
  await addColumnIfMissing('client_orders', 'invoice_generated_at', 'TIMESTAMP NULL DEFAULT NULL AFTER invoice_pdf_path');
  await pool.query('UPDATE client_orders SET subtotal_amount = total_amount WHERE subtotal_amount = 0 AND total_amount > 0');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discounts (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(150) NOT NULL,
      vendor_id INT UNSIGNED DEFAULT NULL,
      description TEXT DEFAULT NULL,
      value_type VARCHAR(20) NOT NULL DEFAULT 'fixed',
      value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      min_order_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      start_at TIMESTAMP NULL DEFAULT NULL,
      expires_at TIMESTAMP NULL DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      apply_on VARCHAR(20) NOT NULL DEFAULT 'both',
      usage_limit INT UNSIGNED DEFAULT NULL,
      per_customer_limit INT UNSIGNED DEFAULT NULL,
      image_path VARCHAR(255) DEFAULT NULL,
      background_color VARCHAR(20) DEFAULT '#0f766e',
      text_color VARCHAR(20) DEFAULT '#ffffff',
      scroll_message VARCHAR(255) DEFAULT NULL,
      city_scope VARCHAR(20) NOT NULL DEFAULT 'all',
      cities JSON DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_discounts_active_scope (is_active, apply_on),
      KEY idx_discounts_vendor (vendor_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('discounts', 'vendor_id', 'INT UNSIGNED DEFAULT NULL AFTER name');
  await addColumnIfMissing('discounts', 'image_path', 'VARCHAR(255) DEFAULT NULL AFTER per_customer_limit');
  await addColumnIfMissing('discounts', 'background_color', "VARCHAR(20) DEFAULT '#0f766e' AFTER image_path");
  await addColumnIfMissing('discounts', 'text_color', "VARCHAR(20) DEFAULT '#ffffff' AFTER background_color");
  await addColumnIfMissing('discounts', 'scroll_message', 'VARCHAR(255) DEFAULT NULL AFTER text_color');
  await addColumnIfMissing('discounts', 'city_scope', "VARCHAR(20) NOT NULL DEFAULT 'all' AFTER scroll_message");
  await addColumnIfMissing('discounts', 'cities', 'JSON DEFAULT NULL AFTER city_scope');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS coupons (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(150) NOT NULL,
      code VARCHAR(80) NOT NULL UNIQUE,
      description TEXT DEFAULT NULL,
      value_type VARCHAR(20) NOT NULL DEFAULT 'fixed',
      value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      min_order_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      start_at TIMESTAMP NULL DEFAULT NULL,
      expires_at TIMESTAMP NULL DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      apply_on VARCHAR(20) NOT NULL DEFAULT 'both',
      usage_limit INT UNSIGNED DEFAULT NULL,
      per_customer_limit INT UNSIGNED DEFAULT NULL,
      auto_generate TINYINT(1) NOT NULL DEFAULT 0,
      image_path VARCHAR(255) DEFAULT NULL,
      background_color VARCHAR(20) DEFAULT '#1d4ed8',
      text_color VARCHAR(20) DEFAULT '#ffffff',
      scroll_message VARCHAR(255) DEFAULT NULL,
      city_scope VARCHAR(20) NOT NULL DEFAULT 'all',
      cities JSON DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_coupons_active_scope (is_active, apply_on)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('coupons', 'image_path', 'VARCHAR(255) DEFAULT NULL AFTER auto_generate');
  await addColumnIfMissing('coupons', 'background_color', "VARCHAR(20) DEFAULT '#1d4ed8' AFTER image_path");
  await addColumnIfMissing('coupons', 'text_color', "VARCHAR(20) DEFAULT '#ffffff' AFTER background_color");
  await addColumnIfMissing('coupons', 'scroll_message', 'VARCHAR(255) DEFAULT NULL AFTER text_color');
  await addColumnIfMissing('coupons', 'city_scope', "VARCHAR(20) NOT NULL DEFAULT 'all' AFTER scroll_message");
  await addColumnIfMissing('coupons', 'cities', 'JSON DEFAULT NULL AFTER city_scope');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS coupon_history (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      coupon_id INT UNSIGNED DEFAULT NULL,
      discount_id INT UNSIGNED DEFAULT NULL,
      order_id INT UNSIGNED DEFAULT NULL,
      user_id INT UNSIGNED NOT NULL,
      order_type VARCHAR(20) NOT NULL,
      code VARCHAR(80) DEFAULT NULL,
      subtotal_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      final_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_coupon_history_coupon (coupon_id),
      KEY idx_coupon_history_discount (discount_id),
      KEY idx_coupon_history_order (order_id),
      KEY idx_coupon_history_user (user_id),
      CONSTRAINT fk_coupon_history_coupon FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL,
      CONSTRAINT fk_coupon_history_discount FOREIGN KEY (discount_id) REFERENCES discounts(id) ON DELETE SET NULL,
      CONSTRAINT fk_coupon_history_order FOREIGN KEY (order_id) REFERENCES client_orders(id) ON DELETE SET NULL,
      CONSTRAINT fk_coupon_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      requester_id INT UNSIGNED NOT NULL,
      requester_role VARCHAR(20) NOT NULL,
      subject VARCHAR(200) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'Open',
      closed_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_support_requester_status (requester_id, requester_role, status),
      KEY idx_support_status (status),
      CONSTRAINT fk_support_ticket_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_ticket_messages (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      ticket_id INT UNSIGNED NOT NULL,
      sender_id INT UNSIGNED DEFAULT NULL,
      sender_role VARCHAR(50) NOT NULL,
      sender_name VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_support_messages_ticket (ticket_id, created_at),
      CONSTRAINT fk_support_message_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
      CONSTRAINT fk_support_message_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

   // Add foreign key constraints if tables exist (safe optional)
   try {
     await pool.query('ALTER TABLE client_orders ADD CONSTRAINT fk_client_orders_vendor FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE SET NULL');
   } catch (e) { /* ignore if exists */ }
   try {
     await pool.query('ALTER TABLE client_orders ADD CONSTRAINT fk_client_orders_delivery_partner FOREIGN KEY (delivery_partner_id) REFERENCES users(id) ON DELETE SET NULL');
   } catch (e) { /* ignore if exists */ }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_order_items (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id INT UNSIGNED NOT NULL,
      vendor_product_id INT UNSIGNED NOT NULL,
      quantity DECIMAL(12,2) NOT NULL,
      unit_price DECIMAL(12,2) NOT NULL,
      tax_name VARCHAR(80) DEFAULT NULL,
      tax_percentage DECIMAL(7,2) NOT NULL DEFAULT 0.00,
      tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      taxable_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_client_order_items_order (order_id),
      KEY idx_client_order_items_vendor_product (vendor_product_id),
      CONSTRAINT fk_client_order_items_order FOREIGN KEY (order_id) REFERENCES client_orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_client_order_items_vendor_product FOREIGN KEY (vendor_product_id) REFERENCES vendor_products(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('client_order_items', 'tax_name', 'VARCHAR(80) DEFAULT NULL AFTER unit_price');
  await addColumnIfMissing('client_order_items', 'tax_percentage', 'DECIMAL(7,2) NOT NULL DEFAULT 0.00 AFTER tax_name');
  await addColumnIfMissing('client_order_items', 'tax_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER tax_percentage');
  await addColumnIfMissing('client_order_items', 'taxable_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER tax_amount');
  await pool.query(
    `UPDATE client_orders co
     SET vendor_id = item_vendor.vendor_id
     FROM (
       SELECT coi.order_id, MIN(vp.vendor_id) AS vendor_id
       FROM client_order_items coi
       INNER JOIN vendor_products vp ON vp.id = coi.vendor_product_id
       GROUP BY coi.order_id
     ) item_vendor
     WHERE co.id = item_vendor.order_id
       AND co.vendor_id IS NULL`
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_status_history (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id INT UNSIGNED NOT NULL,
      old_status VARCHAR(40) DEFAULT NULL,
      new_status VARCHAR(40) NOT NULL,
      changed_by INT UNSIGNED DEFAULT NULL,
      changed_by_role VARCHAR(40) DEFAULT NULL,
      note TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_order_status_history_order (order_id),
      CONSTRAINT fk_order_status_history_order FOREIGN KEY (order_id) REFERENCES client_orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      title VARCHAR(180) NOT NULL,
      message TEXT NOT NULL,
      link VARCHAR(255) DEFAULT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user_notifications_user (user_id, is_read),
      CONSTRAINT fk_user_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS delivery_partner_settings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      city VARCHAR(100) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_delivery_partner_city (user_id, city),
      KEY idx_delivery_partner_city (city, is_active),
      CONSTRAINT fk_delivery_partner_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS delivery_charge_rules (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      city VARCHAR(120) NOT NULL,
      rule_name VARCHAR(120) DEFAULT NULL,
      min_weight_kg DECIMAL(10,3) NOT NULL DEFAULT 0.000,
      max_weight_kg DECIMAL(10,3) DEFAULT NULL,
      base_delivery_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      price_per_km DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      price_per_kg DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      additional_charge DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_delivery_charge_rules_city_weight (city, is_active, min_weight_kg, max_weight_kg)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    INSERT INTO order_status_history (order_id, old_status, new_status, changed_by_role, note, created_at)
    SELECT co.id, NULL, co.status, 'system', 'Initial status', COALESCE(co.created_at, CURRENT_TIMESTAMP)
    FROM client_orders co
    LEFT JOIN order_status_history osh ON osh.order_id = co.id
    WHERE osh.id IS NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quotation_requests (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      client_id INT UNSIGNED NOT NULL,
      client_city VARCHAR(80) NOT NULL,
      total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_quotation_client (client_id),
      KEY idx_quotation_status_city (status, client_city),
      CONSTRAINT fk_quotation_client FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quotation_request_items (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      quotation_request_id INT UNSIGNED NOT NULL,
      vendor_product_id INT UNSIGNED DEFAULT NULL,
      product_id INT UNSIGNED DEFAULT NULL,
      product_name VARCHAR(255) NOT NULL,
      quantity INT UNSIGNED NOT NULL,
      expected_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_quotation_items_request (quotation_request_id),
      CONSTRAINT fk_quotation_items_request FOREIGN KEY (quotation_request_id) REFERENCES quotation_requests(id) ON DELETE CASCADE,
      CONSTRAINT fk_quotation_items_vendor_product FOREIGN KEY (vendor_product_id) REFERENCES vendor_products(id) ON DELETE SET NULL,
      CONSTRAINT fk_quotation_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quotation_vendor_recipients (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      quotation_request_id INT UNSIGNED NOT NULL,
      vendor_id INT UNSIGNED NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'new',
      is_seen TINYINT(1) NOT NULL DEFAULT 0,
      total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      discount_percent DECIMAL(7,2) NOT NULL DEFAULT 0.00,
      submitted_at TIMESTAMP NULL DEFAULT NULL,
      decided_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_quotation_vendor (quotation_request_id, vendor_id),
      KEY idx_quotation_vendor (vendor_id, status),
      CONSTRAINT fk_quotation_recipient_request FOREIGN KEY (quotation_request_id) REFERENCES quotation_requests(id) ON DELETE CASCADE,
      CONSTRAINT fk_quotation_recipient_vendor FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('quotation_vendor_recipients', 'total_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER is_seen');
  await addColumnIfMissing('quotation_vendor_recipients', 'discount_percent', 'DECIMAL(7,2) NOT NULL DEFAULT 0.00 AFTER total_amount');
  await addColumnIfMissing('quotation_vendor_recipients', 'submitted_at', 'TIMESTAMP NULL DEFAULT NULL AFTER total_amount');
  await addColumnIfMissing('quotation_vendor_recipients', 'decided_at', 'TIMESTAMP NULL DEFAULT NULL AFTER submitted_at');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quotation_vendor_response_items (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      quotation_vendor_recipient_id INT UNSIGNED NOT NULL,
      quotation_request_item_id INT UNSIGNED NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      quantity INT UNSIGNED NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'available',
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      line_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_quote_response_item (quotation_vendor_recipient_id, quotation_request_item_id),
      KEY idx_quote_response_recipient (quotation_vendor_recipient_id),
      CONSTRAINT fk_quote_response_recipient FOREIGN KEY (quotation_vendor_recipient_id) REFERENCES quotation_vendor_recipients(id) ON DELETE CASCADE,
      CONSTRAINT fk_quote_response_request_item FOREIGN KEY (quotation_request_item_id) REFERENCES quotation_request_items(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('quotation_vendor_response_items', 'status', "VARCHAR(20) NOT NULL DEFAULT 'available' AFTER quantity");

  await seedGroceryCatalog();

  for (const role of roleSeeds) {
    await pool.query(
      `INSERT INTO roles (name, slug, description, level, permissions)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           level = EXCLUDED.level,
           permissions = EXCLUDED.permissions`,
      [role.name, role.slug, role.description, role.level, JSON.stringify(role.permissions)]
    );
  }

  await CommissionSetting.seedForRoles(pool);

  for (const seedUser of userSeeds) {
    const [existingUsers] = await pool.query('SELECT id FROM users WHERE email = ?', [seedUser.email]);
    let userId = existingUsers[0] && existingUsers[0].id;

    if (!userId) {
      const hashedPassword = await bcrypt.hash(seedUser.password, 10);
      const [result] = await pool.query(
        'INSERT INTO users (name, email, phone, password, role, status) VALUES (?, ?, ?, ?, ?, ?)',
        [seedUser.name, seedUser.email, seedUser.phone || null, hashedPassword, seedUser.role, 'active']
      );
      userId = result.insertId;
      console.log(`Seeded ${seedUser.role} account: ${seedUser.email} / ${seedUser.password}`);
    } else {
      const hashedPassword = await bcrypt.hash(seedUser.password, 10);
      await pool.query('UPDATE users SET role = ?, phone = COALESCE(phone, ?), password = ?, status = ? WHERE id = ?', [
        seedUser.role,
        seedUser.phone || null,
        hashedPassword,
        'active',
        userId,
      ]);
    }

    const [roles] = await pool.query('SELECT id FROM roles WHERE slug = ?', [seedUser.role]);
    if (roles.length > 0) {
      await pool.query(
        'INSERT IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)',
        [userId, roles[0].id, userId]
      );
    }

    if (seedUser.role === 'Admin') {
      await pool.query(
        'INSERT IGNORE INTO admin_profiles (user_id, permissions) VALUES (?, ?)',
        [userId, JSON.stringify(['users.manage', 'profiles.manage', 'wallets.manage'])]
      );
    }

    if (seedUser.role === 'Vendor') {
      await pool.query(
        `INSERT IGNORE INTO vendor_profiles (user_id, business_name, address, country, state, city, gst_number, services)
         VALUES (?, 'Demo Vendor Store', 'Demo vendor address', 'India', 'Rajasthan', 'Jaipur', NULL, ?)`,
        [userId, JSON.stringify(['Grocery', 'Delivery'])]
      );
    }

    if (seedUser.role === 'Client') {
      await pool.query(
        `INSERT IGNORE INTO client_profiles (user_id, address, country, state, city, notes)
         VALUES (?, 'Demo client address', 'India', 'Rajasthan', 'Jaipur', 'Demo login account')`,
        [userId]
      );
    }
  }

  console.log('Database init: seeding defaults');
  await seedDemoProducts();
  await VendorProduct.ensureAllProductsForAllVendors();
  await Wallet.ensureForAllUsers(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_sync_runs (
      id SERIAL PRIMARY KEY,
      revision VARCHAR(190) NOT NULL,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(
    'INSERT INTO schema_sync_runs (revision) VALUES (?)',
    [appRevision]
  );
  console.log('Database init: running migrations');
  await runMigrations(pgPool);
  console.log('Database init: checking snapshot restore');
  await restoreSnapshotOnStartup(pgPool, { revision: appRevision });
}

async function getUserWithRoles(email) {
  const [rows] = await pool.query('SELECT id, name, email, password, role, status, theme_mode FROM users WHERE email = ? AND is_deleted = 0', [email]);
  if (rows.length === 0) {
    return null;
  }

  const user = rows[0];
  if (user.status !== 'active') {
    return null;
  }
  const [roles] = await pool.query(
    `SELECT r.id, r.name, r.slug, r.level, r.permissions
     FROM roles r
     INNER JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?
     ORDER BY r.level ASC, r.name ASC`,
    [user.id]
  );

  const normalizedRoles = roles.length
    ? roles.map((role) => ({ ...role, permissions: parsePermissions(role.permissions) }))
    : [{ id: null, name: user.role, slug: user.role, level: 99, permissions: ['dashboard.view', 'wallets.view'] }];

  const permissions = [...new Set(normalizedRoles.flatMap((role) => role.permissions))];
  const primaryRole = normalizedRoles[0];
  const userWithRoles = {
    role: primaryRole.slug,
    roleName: primaryRole.name,
    roles: normalizedRoles,
  };
  const effectivePermissions = isSuperAdminUser(userWithRoles) ? allPermissionKeys() : permissions;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    password: user.password,
    themeMode: user.theme_mode || 'light',
    role: primaryRole.slug,
    roleName: primaryRole.name,
    roles: normalizedRoles,
    permissions: effectivePermissions,
  };
}

function navItem(label, href, permission, icon, active) {
  return { label, href, permission, icon, active };
}

function navGroup(label, href, permission, icon, active, children = []) {
  return { label, href, permission, icon, active, children };
}

function buildShell(user, activePath = '/dashboard') {
  if (user.role === 'Vendor') {
    return {
      roleTitle: user.roleName || 'Vendor',
      themeMode: user.themeMode || user.theme_mode || 'light',
      navItems: [
        navItem('Dashboard', '/vendor/dashboard', 'vendor.dashboard', 'dashboard', activePath.startsWith('/vendor/dashboard')),
        navItem('Products', '/vendor-products', 'vendor.products', 'products', activePath.startsWith('/vendor-products')),
        navItem('Quotations', '/vendor/quotations', 'vendor.orders', 'orders', activePath.startsWith('/vendor/quotations')),
        navItem('Orders', '/orders/vendor', 'vendor.orders', 'orders', activePath.startsWith('/orders/vendor')),
        navItem('Wallet', '/wallets', 'wallets.view', 'wallets', activePath.startsWith('/wallets')),
        navItem('Vendor Support', '/support/vendor', null, 'support', activePath.startsWith('/support/vendor')),
        navItem('Profile', '/profiles/' + user.id, 'vendor.profile', 'users', activePath.startsWith('/profiles')),
      ],
    };
  }

  if (user.role === 'Client') {
    return {
      roleTitle: user.roleName || 'Client',
      themeMode: user.themeMode || user.theme_mode || 'light',
      navItems: [
        navItem('Dashboard', '/client/dashboard', 'client.dashboard', 'dashboard', activePath.startsWith('/client/dashboard')),
        navItem('Products', '/vendor-products/client-visible', 'client.products', 'products', activePath.startsWith('/vendor-products/client-visible')),
        navItem('Quotations', '/client/quotations', 'client.orders', 'orders', activePath.startsWith('/client/quotations')),
        navItem('Orders', '/orders/client', 'client.orders', 'orders', activePath.startsWith('/orders/client')),
        navItem('Wallet', '/wallets', 'wallets.view', 'wallets', activePath.startsWith('/wallets')),
        navItem('Client Support', '/support/client', null, 'support', activePath.startsWith('/support/client')),
        navItem('Profile', '/profiles/' + user.id, 'client.profile', 'users', activePath.startsWith('/profiles')),
      ],
    };
  }

  const can = (permission) => roleCan(user, permission);
  const navItems = [
    navItem('Dashboard', '/dashboard', 'dashboard.view', 'dashboard', activePath === '/dashboard'),
    navItem('Users', '/users', 'users.manage', 'users', activePath.startsWith('/users')),
    navItem('Roles', '/roles', 'roles.manage', 'roles', activePath.startsWith('/roles')),
    navItem('Clients', '/clients', 'clients.manage', 'clients', activePath.startsWith('/clients')),
    navItem('Vendors', '/vendors', 'vendors.manage', 'vendors', activePath.startsWith('/vendors')),
    navItem('Products', '/products', 'products.manage', 'products', activePath.startsWith('/products')),
    navItem('Wallets', '/wallets', 'wallets.view', 'wallets', activePath.startsWith('/wallets')),
    navItem('Orders', '/orders/admin/dashboard', 'orders.manage', 'orders', activePath.startsWith('/orders/admin')),
    navGroup('Support', '/support', 'support.manage', 'support', activePath.startsWith('/support'), [
      navItem('Client Support', '/support/clients', 'support.manage', 'support', activePath.startsWith('/support/clients')),
      navItem('Vendor Support', '/support/vendors', 'support.manage', 'support', activePath.startsWith('/support/vendors')),
    ]),
    navGroup('Discounts', '/discounts', null, 'discounts', activePath.startsWith('/discounts') || activePath.startsWith('/coupons'), [
      navItem('Discounts', '/discounts', 'discounts.view', 'discounts', activePath.startsWith('/discounts')),
      navItem('Coupons', '/coupons', 'coupons.view', 'coupons', activePath === '/coupons'),
      navItem('Coupon History', '/coupons/history', 'coupon_history.view', 'reports', activePath.startsWith('/coupons/history')),
    ]),
    navItem('Reports', '#', 'reports.view', 'reports', false),
    navItem('Delivery Charge Settings', '/delivery-charge-settings', 'settings.manage', 'settings', activePath.startsWith('/delivery-charge-settings')),
    navItem('Settings', '/settings', 'settings.manage', 'settings', activePath.startsWith('/settings')),
  ]
    .map((item) => item.children
      ? { ...item, children: item.children.filter((child) => !child.permission || can(child.permission)) }
      : item)
    .filter((item) => (item.children && item.children.length) || !item.permission || can(item.permission));

  return {
    roleTitle: user.roleName || user.role,
    themeMode: user.themeMode || user.theme_mode || 'light',
    navItems,
  };
}

function buildDashboard(user, activePath = '/dashboard') {
  const can = (permission) => roleCan(user, permission);
  const shell = buildShell(user, activePath);

  const roleMetrics = {
    superadmin: [
      { label: 'System Users', value: '4 Roles', tone: 'orange', icon: 'users', note: 'Full access enabled' },
      { label: 'Revenue', value: '$34,245', tone: 'green', icon: 'revenue', note: 'Last 24 hours' },
      { label: 'Open Issues', value: '75', tone: 'red', icon: 'alerts', note: 'Tracked by admin team' },
      { label: 'Followers', value: '+245', tone: 'blue', icon: 'followers', note: 'Just updated' },
    ],
    admin: [
      { label: 'Active Users', value: '124', tone: 'orange', icon: 'users', note: '12 new this week' },
      { label: 'Revenue', value: '$18,920', tone: 'green', icon: 'revenue', note: 'Admin region' },
      { label: 'Pending Roles', value: '6', tone: 'red', icon: 'alerts', note: 'Needs review' },
      { label: 'Reports', value: '38', tone: 'blue', icon: 'reports', note: 'Ready to export' },
    ],
    manager: [
      { label: 'Products', value: '1,284', tone: 'orange', icon: 'products', note: 'Catalog available' },
      { label: 'Today Sales', value: '$8,245', tone: 'green', icon: 'revenue', note: 'Store performance' },
      { label: 'Low Stock', value: '21', tone: 'red', icon: 'alerts', note: 'Restock required' },
      { label: 'Orders', value: '186', tone: 'blue', icon: 'orders', note: 'Updated minutes ago' },
    ],
    Vendor: [
      { label: 'Active Products', value: 'Vendor Stock', tone: 'orange', icon: 'products', note: 'Only active stocked products are visible' },
      { label: 'Pending Approval', value: 'Review', tone: 'red', icon: 'alerts', note: 'New submissions need admin approval' },
      { label: 'Client Pricing', value: 'Custom', tone: 'green', icon: 'revenue', note: 'Set client-specific product prices' },
      { label: 'Wallet', value: 'Enabled', tone: 'blue', icon: 'revenue', note: 'Track vendor transactions' },
    ],
    Client: [
      { label: 'Visible Products', value: 'Approved', tone: 'orange', icon: 'products', note: 'Approved, active, in-stock items only' },
      { label: 'Custom Prices', value: 'Applied', tone: 'green', icon: 'revenue', note: 'Vendor custom prices override defaults' },
      { label: 'Wallet', value: 'Enabled', tone: 'blue', icon: 'revenue', note: 'Track client transactions' },
      { label: 'Account Status', value: 'Active', tone: 'red', icon: 'alerts', note: 'Access depends on profile status' },
    ],
    staff: [
      { label: 'Assigned Orders', value: '42', tone: 'orange', icon: 'orders', note: 'For today' },
      { label: 'Packed', value: '28', tone: 'green', icon: 'products', note: 'Ready to dispatch' },
      { label: 'Delayed', value: '4', tone: 'red', icon: 'alerts', note: 'Needs attention' },
      { label: 'Completed', value: '96%', tone: 'blue', icon: 'reports', note: 'Shift target' },
    ],
  };

  const role = roleMetrics[user.role] ? user.role : 'staff';

  return {
    roleTitle: shell.roleTitle,
    navItems: shell.navItems,
    permissions: user.permissions.map((permission) => permissionLabels[permission] || permission),
    metrics: roleMetrics[role],
    charts: [
      { title: 'Daily Sales', tone: 'green-panel', subtitle: '55% increase in today sales.', footer: 'Updated 4 minutes ago', type: 'line-up' },
      { title: 'Email Subscriptions', tone: 'orange-panel', subtitle: 'Last campaign performance', footer: 'Campaign sent 2 days ago', type: 'bars' },
      { title: 'Completed Tasks', tone: 'red-panel', subtitle: 'Role based workflow progress', footer: 'Updated 10 minutes ago', type: 'line-down' },
    ],
    tasks: [
      `Review ${user.roleName || user.role} dashboard permissions`,
      can('orders.manage') ? 'Check pending grocery orders and delivery queue' : 'Review assigned activity feed',
      can('products.manage') ? 'Update low-stock product list' : 'Confirm completed assigned tasks',
      can('roles.manage') ? 'Audit role assignments for new users' : 'Send shift handover note',
    ],
    employees: [
      { id: 1, name: 'Dakota Rice', salary: '$36,738', country: 'Niger' },
      { id: 2, name: 'Minerva Hooper', salary: '$23,789', country: 'Curacao' },
      { id: 3, name: 'Sage Rodriguez', salary: '$56,142', country: 'Netherlands' },
      { id: 4, name: user.name, salary: '$38,735', country: user.roleName || user.role },
    ],
    notifications: [],
  };
}

async function buildDashboardData(user, activePath = '/dashboard') {
  const dashboard = buildDashboard(user, activePath);

  if (['admin', 'superadmin'].includes(String(user.role || '').toLowerCase()) || isSuperAdminUser(user)) {
    const [maintenanceRows] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM quotation_requests) AS quotation_count,
         (SELECT COUNT(*) FROM quotation_vendor_recipients) AS quotation_vendor_count,
         (SELECT COUNT(*) FROM client_orders) AS order_count,
         (SELECT COUNT(*) FROM vendor_products vp INNER JOIN products p ON p.id = vp.product_id WHERE COALESCE(vp.price, 0) <> COALESCE(p.price, 0)) AS vendor_price_diff_count`
    );
    const maintenance = maintenanceRows[0] || {};
    dashboard.maintenance = {
      quotationCount: Number(maintenance.quotation_count || 0),
      quotationVendorCount: Number(maintenance.quotation_vendor_count || 0),
      orderCount: Number(maintenance.order_count || 0),
      vendorPriceDiffCount: Number(maintenance.vendor_price_diff_count || 0),
    };
  }

  if (user.role === 'Vendor') {
    const quotationCount = await Quotation.pendingCountForVendor(user.id);
    const [quotationRows] = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE qvr.status IN ('new', 'seen')) AS unprocessed_count,
         COALESCE(SUM(CASE WHEN qvr.status IN ('new', 'seen') THEN qr.total_amount ELSE 0 END), 0) AS unprocessed_amount,
         COUNT(*) FILTER (WHERE qvr.status IN ('submitted', 'accepted')) AS processed_count,
         COALESCE(SUM(CASE WHEN qvr.status IN ('submitted', 'accepted') THEN COALESCE(NULLIF(qvr.total_amount, 0), qr.total_amount) ELSE 0 END), 0) AS processed_amount,
         COUNT(*) FILTER (WHERE qvr.status = 'rejected') AS rejected_count,
         COALESCE(SUM(CASE WHEN qvr.status = 'rejected' THEN COALESCE(NULLIF(qvr.total_amount, 0), qr.total_amount) ELSE 0 END), 0) AS rejected_amount
       FROM quotation_vendor_recipients qvr
       INNER JOIN quotation_requests qr ON qr.id = qvr.quotation_request_id
       WHERE qvr.vendor_id = ?`,
      [user.id]
    );
    const [productRows] = await pool.query(
      `SELECT COUNT(*) AS active_products
       FROM vendor_products
       WHERE vendor_id = ? AND status = 'active'`,
      [user.id]
    );

    const quotationStats = quotationRows[0] || {};
    const healthMinimum = 200;
    const activeProducts = Number(productRows[0] && productRows[0].active_products ? productRows[0].active_products : 0);
    const healthScore = Math.min(100, Math.round((activeProducts / healthMinimum) * 100));
    const healthTone = healthScore >= 75 ? 'good' : healthScore >= 40 ? 'fair' : 'low';

    dashboard.vendorStats = {
      quotations: [
        {
          label: 'Un Processed',
          count: Number(quotationStats.unprocessed_count || 0),
          amount: Number(quotationStats.unprocessed_amount || 0),
          tone: 'pending',
        },
        {
          label: 'Processed',
          count: Number(quotationStats.processed_count || 0),
          amount: Number(quotationStats.processed_amount || 0),
          tone: 'processed',
        },
        {
          label: 'Rejected',
          count: Number(quotationStats.rejected_count || 0),
          amount: Number(quotationStats.rejected_amount || 0),
          tone: 'rejected',
        },
      ],
      accountHealth: {
        score: healthScore,
        tone: healthTone,
        activeProducts,
        minimum: healthMinimum,
      },
    };

    dashboard.metrics = dashboard.vendorStats.quotations.map((stat) => ({
      label: stat.label,
      value: stat.count,
      tone: stat.tone === 'processed' ? 'green' : stat.tone === 'rejected' ? 'red' : 'orange',
      icon: stat.tone === 'rejected' ? 'alerts' : 'orders',
      note: `INR ${stat.amount.toFixed(2)}`,
    })).concat({
      label: 'Account Health',
      value: `${healthScore}%`,
      tone: healthTone === 'good' ? 'green' : healthTone === 'fair' ? 'orange' : 'red',
      icon: 'reports',
      note: `${activeProducts} active products / ${healthMinimum}`,
    });

    if (quotationCount > 0) {
      dashboard.notifications.push({
        message: 'New quotation found.',
        href: '/vendor/quotations',
        count: quotationCount,
      });
      dashboard.tasks.unshift('New quotation found.');
    }
  }

  if (user.role === 'Client') {
    const [notificationRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM user_notifications WHERE user_id = ? AND is_read = 0',
      [user.id]
    );
    const unreadNotifications = Number(notificationRows[0] && notificationRows[0].total ? notificationRows[0].total : 0);
    if (unreadNotifications > 0) {
      dashboard.notifications.push({
        message: 'Order status update.',
        href: '/orders/client',
        count: unreadNotifications,
      });
      dashboard.tasks.unshift('Check latest order status update.');
    }
  }

  if (['Client', 'Vendor'].includes(user.role)) {
    const requesterRole = SupportTicket.roleScope(user.role);
    const tickets = requesterRole ? await SupportTicket.list({ requesterId: user.id, requesterRole }) : [];
    const openTicket = tickets.find((ticket) => ticket.status === 'Open');
    dashboard.supportTickets = tickets.slice(0, 3);
    dashboard.supportSummary = {
      openTicket,
      total: tickets.length,
      href: user.role === 'Client' ? '/support/client' : '/support/vendor',
    };
    if (openTicket) {
      dashboard.notifications.push({
        message: `Support ticket #${openTicket.id} is open.`,
        href: dashboard.supportSummary.href,
        count: openTicket.message_count,
      });
    }
  }

  return dashboard;
}

async function clearQuotationAndOrderData() {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [countRows] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM quotation_requests) AS quotation_requests,
         (SELECT COUNT(*) FROM quotation_request_items) AS quotation_request_items,
         (SELECT COUNT(*) FROM quotation_vendor_recipients) AS quotation_vendor_recipients,
         (SELECT COUNT(*) FROM quotation_vendor_response_items) AS quotation_vendor_response_items,
         (SELECT COUNT(*) FROM client_orders) AS client_orders,
         (SELECT COUNT(*) FROM client_order_items) AS client_order_items,
         (SELECT COUNT(*) FROM order_status_history) AS order_status_history`
    );

    await connection.query('DELETE FROM order_status_history');
    await connection.query('DELETE FROM client_order_items');
    await connection.query('DELETE FROM client_orders');
    await connection.query('DELETE FROM quotation_vendor_response_items');
    await connection.query('DELETE FROM quotation_vendor_recipients');
    await connection.query('DELETE FROM quotation_request_items');
    await connection.query('DELETE FROM quotation_requests');

    await connection.commit();

    const counts = countRows[0] || {};
    return {
      quotationRequests: Number(counts.quotation_requests || 0),
      quotationRequestItems: Number(counts.quotation_request_items || 0),
      quotationVendorRecipients: Number(counts.quotation_vendor_recipients || 0),
      quotationVendorResponseItems: Number(counts.quotation_vendor_response_items || 0),
      clientOrders: Number(counts.client_orders || 0),
      clientOrderItems: Number(counts.client_order_items || 0),
      orderStatusHistory: Number(counts.order_status_history || 0),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function syncVendorPricesToMasterProducts() {
  const [result] = await pool.query(
    `UPDATE vendor_products vp
     SET price = p.price,
         updated_at = CURRENT_TIMESTAMP
     FROM products p
     WHERE p.id = vp.product_id
       AND p.is_deleted = 0
       AND COALESCE(vp.price, 0) <> COALESCE(p.price, 0)`
  );

  return Number(result.affectedRows || result.rowCount || 0);
}

app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }

  res.render('landing');
});

app.get('/admin', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }

  res.render('login', { error: null });
});

app.get('/login', (req, res) => {
  res.redirect('/admin');
});

app.get('/login/vendor', (req, res) => {
  if (req.session && req.session.user && req.session.user.role === 'Vendor') {
    return res.redirect('/vendor/dashboard');
  }

  res.render('role_login', {
    roleLabel: 'Vendor',
    roleSlug: 'Vendor',
    loginPath: '/login/vendor',
    demoCredentials: { identifier: 'vendor@example.com', password: 'admin123' },
    error: null,
  });
});

app.get('/login/client', (req, res) => {
  if (req.session && req.session.user && req.session.user.role === 'Client') {
    return res.redirect('/client/dashboard');
  }

  res.render('role_login', {
    roleLabel: 'Client',
    roleSlug: 'Client',
    loginPath: '/login/client',
    demoCredentials: { identifier: 'client@example.com', password: 'admin123' },
    error: null,
  });
});

app.use((req, res, next) => {
  if (req.session && req.session.user) {
    res.locals.shell = buildShell(req.session.user, req.path);
  }
  next();
});

async function handleAdminLogin(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { error: 'Please enter both email and password.' });
  }

  try {
    const user = await getUserWithRoles(email);
    if (!user) {
      return res.render('login', { error: 'Invalid credentials.' });
    }

    if (['Vendor', 'Client'].includes(user.role)) {
      return res.render('login', { error: `${user.role} users must use the ${user.role} Login page.` });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.render('login', { error: 'Invalid credentials.' });
    }

    delete user.password;
    req.session.user = user;
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.render('login', { error: 'Unable to process login. Please try again later.' });
  }
}

app.post('/admin/login', handleAdminLogin);
app.post('/login', handleAdminLogin);

async function handleRoleLogin(req, res, expectedRole, dashboardPath) {
  const identifier = String(req.body.identifier || req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const roleLabel = expectedRole;
  const loginPath = expectedRole === 'Vendor' ? '/login/vendor' : '/login/client';

  if (!identifier || !password) {
    return res.render('role_login', {
      roleLabel,
      roleSlug: expectedRole,
      loginPath,
      demoCredentials: expectedRole === 'Vendor'
        ? { identifier: 'vendor@example.com', password: 'admin123' }
        : { identifier: 'client@example.com', password: 'admin123' },
      error: 'Please enter email/username and password.',
    });
  }

  try {
    const rawUser = await User.findByEmailOrPhoneIdentifier(identifier);
    if (!rawUser || rawUser.role !== expectedRole || rawUser.status !== 'active') {
      return res.render('role_login', {
        roleLabel,
        roleSlug: expectedRole,
        loginPath,
        demoCredentials: expectedRole === 'Vendor'
          ? { identifier: 'vendor@example.com', password: 'admin123' }
          : { identifier: 'client@example.com', password: 'admin123' },
        error: `Invalid ${roleLabel.toLowerCase()} credentials.`,
      });
    }

    const passwordMatches = await bcrypt.compare(password, rawUser.password);
    if (!passwordMatches) {
      return res.render('role_login', {
        roleLabel,
        roleSlug: expectedRole,
        loginPath,
        demoCredentials: expectedRole === 'Vendor'
          ? { identifier: 'vendor@example.com', password: 'admin123' }
          : { identifier: 'client@example.com', password: 'admin123' },
        error: `Invalid ${roleLabel.toLowerCase()} credentials.`,
      });
    }

    const fallbackPermissions = expectedRole === 'Client'
      ? ['dashboard.view', 'wallets.view', 'coupons.apply']
      : ['dashboard.view', 'wallets.view'];
    const user = {
      id: rawUser.id,
      name: rawUser.name,
      email: rawUser.email,
      themeMode: rawUser.theme_mode || 'light',
      role: rawUser.role,
      roleName: rawUser.role,
      roles: [{ id: null, name: rawUser.role, slug: rawUser.role, level: 99, permissions: fallbackPermissions }],
      permissions: fallbackPermissions,
    };
    req.session.user = user;
    return res.redirect(dashboardPath);
  } catch (error) {
    console.error(`${roleLabel} login error:`, error);
    return res.render('role_login', {
      roleLabel,
      roleSlug: expectedRole,
      loginPath,
      demoCredentials: expectedRole === 'Vendor'
        ? { identifier: 'vendor@example.com', password: 'admin123' }
        : { identifier: 'client@example.com', password: 'admin123' },
      error: 'Unable to process login. Please try again later.',
    });
  }
}

app.post('/login/vendor', (req, res) => handleRoleLogin(req, res, 'Vendor', '/vendor/dashboard'));
app.post('/login/client', (req, res) => handleRoleLogin(req, res, 'Client', '/client/dashboard'));

app.get('/dashboard', requireAuth, async (req, res) => {
  if (req.session.user.role === 'Vendor') {
    return res.redirect('/vendor/dashboard');
  }

  if (req.session.user.role === 'Client') {
    return res.redirect('/client/dashboard');
  }

  res.render('dashboard', {
    user: req.session.user,
    dashboard: await buildDashboardData(req.session.user, req.path),
    error: req.query.error || null,
    message: req.query.message || null,
  });
});

app.post('/admin/maintenance/clear-quotations-orders', requireAuth, requireAdminMaintenance, async (req, res) => {
  try {
    const counts = await clearQuotationAndOrderData();
    const removed = counts.quotationRequests + counts.clientOrders;
    const detail = `Cleared ${counts.quotationRequests} quotation request(s), ${counts.quotationVendorRecipients} vendor quote row(s), and ${counts.clientOrders} order(s).`;
    return res.redirect(`/dashboard?message=${encodeURIComponent(removed > 0 ? detail : 'No quotation or order data was found to clear.')}`);
  } catch (error) {
    console.error('Admin maintenance clear quotation/order data failed:', error);
    return res.redirect(`/dashboard?error=${encodeURIComponent('Unable to clear quotation and order data. Check server logs.')}`);
  }
});

app.post('/admin/maintenance/sync-vendor-prices', requireAuth, requireAdminMaintenance, async (req, res) => {
  try {
    const updated = await syncVendorPricesToMasterProducts();
    const detail = updated > 0
      ? `Updated ${updated} vendor product price(s) to match master product prices. Vendors can edit their own prices again after this reset.`
      : 'All vendor product prices already match master product prices.';
    return res.redirect(`/dashboard?message=${encodeURIComponent(detail)}`);
  } catch (error) {
    console.error('Admin maintenance sync vendor prices failed:', error);
    return res.redirect(`/dashboard?error=${encodeURIComponent('Unable to sync vendor product prices. Check server logs.')}`);
  }
});

app.get('/vendor/dashboard', requireSessionRole('Vendor', '/login/vendor'), async (req, res) => {
  res.render('dashboard', {
    user: req.session.user,
    dashboard: await buildDashboardData(req.session.user, req.path),
    error: null,
    message: null,
  });
});

app.get('/client/dashboard', requireSessionRole('Client', '/login/client'), async (req, res) => {
  res.render('dashboard', {
    user: req.session.user,
    dashboard: await buildDashboardData(req.session.user, req.path),
    error: null,
    message: null,
  });
});

app.get('/vendor/quotations', requireSessionRole('Vendor', '/login/vendor'), async (req, res) => {
  const vendorId = req.session.user.id;
  try {
    const quotations = await Quotation.listForVendor(vendorId);
    console.log(`[quotation] vendor ${vendorId} loaded ${quotations.length} quotation request(s)`);

    if (requestWantsJson(req)) {
      if (req.query.peek !== '1') {
        await Quotation.markSeenForVendor(vendorId);
      }
      return res.json({ success: true, quotations });
    }

    await Quotation.markSeenForVendor(vendorId);
    res.render('vendor-quotations', {
      user: req.session.user,
      shell: buildShell(req.session.user, req.path),
      quotations,
      error: null,
    });
  } catch (error) {
    console.error('[quotation] Vendor quotations load error:', {
      vendorId,
      message: error.message,
      stack: error.stack,
    });

    if (requestWantsJson(req)) {
      return res.status(500).json({
        success: false,
        message: 'Unable to load quotations',
        error: process.env.NODE_ENV === 'production' ? undefined : error.message,
      });
    }

    res.status(500).render('vendor-quotations', {
      user: req.session.user,
      shell: buildShell(req.session.user, req.path),
      quotations: [],
      error: 'Unable to load quotations. Please refresh the page or contact support.',
    });
  }
});

app.post('/vendor/quotations/:recipientId/submit', requireSessionRole('Vendor', '/login/vendor'), async (req, res) => {
  try {
    const response = await Quotation.submitVendorResponse({
      recipientId: Number(req.params.recipientId),
      vendorId: req.session.user.id,
      items: req.body.items || [],
      discountPercent: req.body.discount_percent,
    });
    return res.json({ success: true, message: 'Quotation submitted to client', response });
  } catch (error) {
    console.error('Vendor quotation submit error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to submit quotation',
    });
  }
});

app.post('/vendor/quotations/:recipientId/reject', requireSessionRole('Vendor', '/login/vendor'), async (req, res) => {
  try {
    const result = await Quotation.rejectVendorRequest({
      recipientId: Number(req.params.recipientId),
      vendorId: req.session.user.id,
    });
    return res.json({ success: true, message: 'Quotation rejected', result });
  } catch (error) {
    console.error('Vendor quotation reject error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to reject quotation',
    });
  }
});

app.get('/client/quotations', requireSessionRole('Client', '/login/client'), async (req, res) => {
  try {
    const quotations = await Quotation.listForClient(req.session.user.id);
    res.render('client-quotations', {
      user: req.session.user,
      shell: buildShell(req.session.user, req.path),
      quotations,
    });
  } catch (error) {
    console.error('Client quotations error:', error);
    res.status(500).send('Unable to load quotations');
  }
});

app.get('/api/client/quotations', webOrJwtAuth, requireAuthRole('Client'), async (req, res) => {
  try {
    const quotations = await Quotation.listForClient(req.authUser.id);
    return res.json({ success: true, quotations });
  } catch (error) {
    console.error('Client quotations API error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load quotations' });
  }
});

app.get('/api/vendor/quotations', webOrJwtAuth, requireAuthRole('Vendor'), async (req, res) => {
  try {
    const vendorId = req.authUser.id;
    const quotations = await Quotation.listForVendor(vendorId);
    if (req.query.peek !== '1') {
      await Quotation.markSeenForVendor(vendorId);
    }
    return res.json({ success: true, quotations });
  } catch (error) {
    console.error('Vendor quotations API error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load quotations' });
  }
});

app.get('/api/vendor/notifications/stream', webOrJwtAuth, requireAuthRole('Vendor'), (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const unsubscribe = vendorNotifications.subscribe(req.authUser.id, res);
  req.on('close', unsubscribe);
});

app.post('/api/vendor/quotations/:recipientId/submit', webOrJwtAuth, requireAuthRole('Vendor'), async (req, res) => {
  try {
    const response = await Quotation.submitVendorResponse({
      recipientId: Number(req.params.recipientId),
      vendorId: req.authUser.id,
      items: req.body.items || [],
      discountPercent: req.body.discount_percent,
    });
    return res.json({ success: true, message: 'Quotation submitted to client', response });
  } catch (error) {
    console.error('Vendor quotation API submit error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to submit quotation',
    });
  }
});

app.post('/api/vendor/quotations/:recipientId/reject', webOrJwtAuth, requireAuthRole('Vendor'), async (req, res) => {
  try {
    const result = await Quotation.rejectVendorRequest({
      recipientId: Number(req.params.recipientId),
      vendorId: req.authUser.id,
    });
    return res.json({ success: true, message: 'Quotation rejected', result });
  } catch (error) {
    console.error('Vendor quotation API reject error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to reject quotation',
    });
  }
});

app.post('/client/quotations/:recipientId/:decision', requireSessionRole('Client', '/login/client'), async (req, res) => {
  try {
    const decision = req.params.decision === 'accept' ? 'accepted' : req.params.decision === 'reject' ? 'rejected' : null;
    if (!decision) {
      return res.status(422).json({ success: false, message: 'Decision must be accept or reject' });
    }
    if (String(req.body.coupon_code || '').trim() && !roleCan(req.session.user, 'coupons.apply')) {
      return res.status(403).json({ success: false, message: 'You do not have permission to apply coupons' });
    }
    const result = await Quotation.decideClientResponse({
      recipientId: Number(req.params.recipientId),
      clientId: req.session.user.id,
      decision,
      couponCode: req.body.coupon_code,
    });
    if (decision === 'accepted' && result.vendorId) {
      vendorNotifications.notifyVendor(result.vendorId, {
        type: 'order',
        id: result.orderId,
        title: 'New order received',
        message: 'New order received',
        orderId: result.orderId,
        orderType: 'quotation',
        totalAmount: result.totalAmount,
      });
    }
    return res.json({ success: true, message: decision === 'accepted' ? 'Quotation accepted and order created' : 'Quotation rejected', result });
  } catch (error) {
    console.error('Client quotation decision error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to update quotation',
    });
  }
});

app.post('/api/client/quotations/:recipientId/:decision', webOrJwtAuth, requireAuthRole('Client'), async (req, res) => {
  try {
    const decision = req.params.decision === 'accept' ? 'accepted' : req.params.decision === 'reject' ? 'rejected' : null;
    if (!decision) {
      return res.status(422).json({ success: false, message: 'Decision must be accept or reject' });
    }
    if (String(req.body.coupon_code || '').trim() && !roleCan(req.authUser, 'coupons.apply')) {
      return res.status(403).json({ success: false, message: 'You do not have permission to apply coupons' });
    }
    const result = await Quotation.decideClientResponse({
      recipientId: Number(req.params.recipientId),
      clientId: req.authUser.id,
      decision,
      couponCode: req.body.coupon_code,
    });
    if (decision === 'accepted' && result.vendorId) {
      vendorNotifications.notifyVendor(result.vendorId, {
        type: 'order',
        id: result.orderId,
        title: 'New order received',
        message: 'New order received',
        orderId: result.orderId,
        orderType: 'quotation',
        totalAmount: result.totalAmount,
      });
    }
    return res.json({ success: true, message: decision === 'accepted' ? 'Quotation accepted and order created' : 'Quotation rejected', result });
  } catch (error) {
    console.error('Client quotation API decision error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to update quotation',
    });
  }
});

app.get('/vendor-products', requireAuth, requireSessionRole('Vendor', '/login/vendor'), async (req, res) => {
  try {
    const products = await VendorProduct.list({ vendor_id: req.session.user.id });
    const approvedProducts = await Product.listApproved(200);
    const [categories, subcategories, brands] = await Promise.all([
      Catalog.listCategories(),
      Catalog.listSubcategories(),
      Catalog.listBrands(),
    ]);
    res.render('vendor-products', {
      user: req.session.user,
      shell: buildShell(req.session.user, req.path),
      products: products,
      approvedProducts: approvedProducts,
      categories,
      subcategories,
      brands,
    });
  } catch (error) {
    console.error('Vendor products error:', error);
    res.render('vendor-products', {
      user: req.session.user,
      shell: buildShell(req.session.user, req.path),
      products: [],
      approvedProducts: [],
      categories: [],
      subcategories: [],
      brands: [],
      error: 'Unable to load products',
    });
  }
});

async function updateThemePreference(req, res) {
  const themeMode = req.body.theme_mode || req.body.themeMode;
  if (!['light', 'dark'].includes(themeMode)) {
    return res.status(422).json({ success: false, message: 'Theme mode must be light or dark' });
  }

  try {
    await pool.query('UPDATE users SET theme_mode = ? WHERE id = ? AND is_deleted = 0', [themeMode, req.authUser.id]);
    if (req.session && req.session.user && Number(req.session.user.id) === Number(req.authUser.id)) {
      req.session.user.themeMode = themeMode;
      req.session.user.theme_mode = themeMode;
    }
    return res.json({ success: true, message: 'Theme updated', theme_mode: themeMode });
  } catch (error) {
    console.error('Theme update error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update theme' });
  }
}

app.put('/theme', webOrJwtAuth, updateThemePreference);
app.put('/api/theme', webOrJwtAuth, updateThemePreference);

app.get('/users', webOrJwtAuth, requireUserManagement, userController.index);
app.put('/users/:id', webOrJwtAuth, requireUserManagement, userController.update);
app.delete('/users/:id', webOrJwtAuth, requireUserManagement, userController.destroy);
app.get('/profiles/:userId', webOrJwtAuth, requireProfileAccess, (req, res, next) => {
  if (req.authType === 'session') {
    res.locals.shell = buildShell(req.authUser, req.path);
  }
  next();
}, managedProfileController.getByUserId);
app.put('/profiles/:userId', webOrJwtAuth, requireProfileAccess, managedProfileController.updateByUserId);
app.use('/clients', requireAuth, requirePermission('clients.manage'), clientRoutes);
app.use('/api/clients', webOrJwtAuth, requireClientManagement, clientRoutes);
app.use('/vendors', requireAuth, requirePermission('vendors.manage'), vendorRoutes);
app.use('/api/vendors', webOrJwtAuth, requireVendorManagement, vendorRoutes);
app.use('/products', requireAuth, requirePermission('products.manage'), productRoutes);
app.use('/api/products', webOrJwtAuth, requireProductManagement, productRoutes);

app.get('/vendor-products/client-visible', requireAuth, requireSessionRole('Client', '/login/client'), async (req, res) => {
  try {
    const products = await VendorProduct.visibleForClient({ client_id: req.session.user.id });
    const [categories, subcategories, brands] = await Promise.all([
      Catalog.listCategories(),
      Catalog.listSubcategories(),
      Catalog.listBrands(),
    ]);
    res.render('client-products', {
      user: req.session.user,
      shell: buildShell(req.session.user, req.path),
      products,
      categories,
      subcategories,
      brands,
    });
  } catch (error) {
    console.error('Client products error:', error);
    res.status(500).send('Unable to load products');
  }
});

app.use('/vendor-products', webOrJwtAuth, vendorProductRoutes);
app.use('/api/vendor-products', webOrJwtAuth, vendorProductRoutes);
app.use('/wallets', webOrJwtAuth, requireWalletAccess, walletRoutes);
app.use('/api/wallets', webOrJwtAuth, requireWalletAccess, walletRoutes);

// Order routes - web (session based)
app.use('/orders/admin', requireAuth, requirePermission('orders.manage'), orderRoutes.adminRouter);
app.use('/orders/vendor', requireAuth, requireSessionRole('Vendor', '/login/vendor'), orderRoutes.vendorRouter);
app.use('/orders/client', requireAuth, requireSessionRole('Client', '/login/client'), orderRoutes.clientRouter);

// Order routes - API (JWT or session based)
app.use('/api/orders/admin', webOrJwtAuth, orderRoutes.adminRouter);
app.use('/api/orders/vendor', webOrJwtAuth, orderRoutes.vendorRouter);
app.use('/api/orders/client', webOrJwtAuth, orderRoutes.clientRouter);

app.post(['/client/quotations', '/api/client/quotations'], webOrJwtAuth, requireAuthRole('Client'), async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No items in quotation request' });
    }

    const quotation = await Quotation.createForCityVendors({
      clientId: req.authUser.id,
      items,
    });
    vendorNotifications.notifyVendors(quotation.vendorIds || [], {
      type: 'quotation',
      id: quotation.id,
      title: 'New quotation received',
      message: 'New quotation received',
      quotationId: quotation.id,
      city: quotation.city,
      totalAmount: quotation.totalAmount,
    });
    console.log(`[quotation] client ${req.authUser.id} created quotation ${quotation.id} for ${quotation.vendorCount} vendor(s) in ${quotation.city}`);

    return res.json({
      success: true,
      message: `Quotation sent to ${quotation.vendorCount} vendor${quotation.vendorCount === 1 ? '' : 's'} in ${quotation.city}`,
      quotation,
    });
  } catch (error) {
    console.error('[quotation] Create quotation error:', {
      clientId: req.authUser && req.authUser.id,
      message: error.message,
      stack: error.stack,
    });
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to send quotation',
    });
  }
});

function normalizeDeliveryAddress(row) {
  return {
    id: row.id,
    label: row.label || 'Home',
    recipient_name: row.recipient_name || '',
    phone: row.phone || '',
    address: row.address || '',
    city: row.city || '',
    state: row.state || '',
    country: row.country || '',
    pincode: row.pincode || '',
    is_default: Boolean(row.is_default),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function deliveryAddressPayload(body) {
  return {
    label: String(body.label || 'Home').trim().slice(0, 80) || 'Home',
    recipient_name: String(body.recipient_name || body.recipientName || '').trim().slice(0, 120) || null,
    phone: String(body.phone || '').trim().slice(0, 30) || null,
    address: String(body.address || '').trim(),
    city: String(body.city || '').trim().slice(0, 80) || null,
    state: String(body.state || '').trim().slice(0, 80) || null,
    country: String(body.country || 'India').trim().slice(0, 80) || 'India',
    pincode: String(body.pincode || body.pinCode || '').trim().slice(0, 20) || null,
    is_default: Boolean(body.is_default || body.isDefault),
  };
}

app.get('/api/client/delivery-addresses', webOrJwtAuth, requireAuthRole('Client'), async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM client_delivery_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC, id DESC',
    [req.authUser.id]
  );
  res.json({ success: true, addresses: rows.map(normalizeDeliveryAddress), max: 5 });
});

app.post('/api/client/delivery-addresses', webOrJwtAuth, requireAuthRole('Client'), async (req, res) => {
  const data = deliveryAddressPayload(req.body);
  if (!data.address) {
    return res.status(422).json({ success: false, message: 'Delivery address is required' });
  }

  const clientId = req.authUser.id;
  const [[countRow]] = await pool.query('SELECT COUNT(*) AS total FROM client_delivery_addresses WHERE user_id = ?', [clientId]);
  const total = Number(countRow.total || 0);
  if (total >= 5) {
    return res.status(422).json({ success: false, message: 'You can save up to 5 delivery addresses' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const shouldDefault = data.is_default || total === 0;
    if (shouldDefault) {
      await connection.query('UPDATE client_delivery_addresses SET is_default = 0 WHERE user_id = ?', [clientId]);
    }
    const [result] = await connection.query(
      `INSERT INTO client_delivery_addresses
       (user_id, label, recipient_name, phone, address, city, state, country, pincode, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clientId,
        data.label,
        data.recipient_name,
        data.phone,
        data.address,
        data.city,
        data.state,
        data.country,
        data.pincode,
        shouldDefault ? 1 : 0,
      ]
    );
    const [rows] = await connection.query('SELECT * FROM client_delivery_addresses WHERE id = ? AND user_id = ?', [result.insertId, clientId]);
    await connection.commit();
    return res.status(201).json({ success: true, address: normalizeDeliveryAddress(rows[0]) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

app.put('/api/client/delivery-addresses/:id', webOrJwtAuth, requireAuthRole('Client'), async (req, res) => {
  const data = deliveryAddressPayload(req.body);
  if (!data.address) {
    return res.status(422).json({ success: false, message: 'Delivery address is required' });
  }

  const clientId = req.authUser.id;
  const addressId = Number(req.params.id);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query('SELECT id FROM client_delivery_addresses WHERE id = ? AND user_id = ?', [addressId, clientId]);
    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Delivery address not found' });
    }
    if (data.is_default) {
      await connection.query('UPDATE client_delivery_addresses SET is_default = 0 WHERE user_id = ?', [clientId]);
    }
    await connection.query(
      `UPDATE client_delivery_addresses
       SET label = ?, recipient_name = ?, phone = ?, address = ?, city = ?, state = ?, country = ?, pincode = ?,
           is_default = CASE WHEN ? = 1 THEN 1 ELSE is_default END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [
        data.label,
        data.recipient_name,
        data.phone,
        data.address,
        data.city,
        data.state,
        data.country,
        data.pincode,
        data.is_default ? 1 : 0,
        addressId,
        clientId,
      ]
    );
    const [rows] = await connection.query('SELECT * FROM client_delivery_addresses WHERE id = ? AND user_id = ?', [addressId, clientId]);
    await connection.commit();
    return res.json({ success: true, address: normalizeDeliveryAddress(rows[0]) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

app.delete('/api/client/delivery-addresses/:id', webOrJwtAuth, requireAuthRole('Client'), async (req, res) => {
  const clientId = req.authUser.id;
  const addressId = Number(req.params.id);
  const [[address]] = await pool.query('SELECT id, is_default FROM client_delivery_addresses WHERE id = ? AND user_id = ?', [addressId, clientId]);
  if (!address) {
    return res.status(404).json({ success: false, message: 'Delivery address not found' });
  }
  await pool.query('DELETE FROM client_delivery_addresses WHERE id = ? AND user_id = ?', [addressId, clientId]);
  if (address.is_default) {
    const [[nextAddress]] = await pool.query(
      'SELECT id FROM client_delivery_addresses WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      [clientId]
    );
    if (nextAddress) {
      await pool.query('UPDATE client_delivery_addresses SET is_default = 1 WHERE id = ? AND user_id = ?', [nextAddress.id, clientId]);
    }
  }
  res.json({ success: true, message: 'Delivery address deleted' });
});

app.post('/api/client/delivery-addresses/:id/default', webOrJwtAuth, requireAuthRole('Client'), async (req, res) => {
  const clientId = req.authUser.id;
  const addressId = Number(req.params.id);
  const [[address]] = await pool.query('SELECT id FROM client_delivery_addresses WHERE id = ? AND user_id = ?', [addressId, clientId]);
  if (!address) {
    return res.status(404).json({ success: false, message: 'Delivery address not found' });
  }
  await pool.query('UPDATE client_delivery_addresses SET is_default = 0 WHERE user_id = ?', [clientId]);
  await pool.query('UPDATE client_delivery_addresses SET is_default = 1 WHERE id = ? AND user_id = ?', [addressId, clientId]);
  res.json({ success: true, message: 'Default delivery address updated' });
});

async function calculateClientOrderPreview({ clientId, rawItems, deliveryAddressId = 0, couponCode = '', connection = pool, lockStock = false }) {
  if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
    const error = new Error('No items in order');
    error.status = 400;
    throw error;
  }

  const itemsByProduct = new Map();
  for (const item of rawItems) {
    const productKey = Number(item.productId || item.product_id || item.id || item.vendorProductId);
    const quantity = Math.max(1, Number(item.quantity || 1));
    const price = Math.max(0, Number(item.price || 0));
    if (!productKey || quantity <= 0) continue;

    const normalized = { ...item, quantity, price };
    const existing = itemsByProduct.get(productKey);
    if (!existing) {
      itemsByProduct.set(productKey, normalized);
    } else {
      existing.quantity = Math.max(existing.quantity, quantity);
      if (price > 0 && (Number(existing.price || 0) <= 0 || price < Number(existing.price || 0))) {
        existing.price = price;
        existing.vendorProductId = item.vendorProductId || existing.vendorProductId;
      }
    }
  }

  const items = [...itemsByProduct.values()];
  if (items.length === 0) {
    const error = new Error('No valid items in order');
    error.status = 400;
    throw error;
  }

  const clientRows = await connection.query(
    'SELECT u.name, u.phone, cp.address, cp.country, cp.state, cp.city FROM users u LEFT JOIN client_profiles cp ON cp.user_id = u.id WHERE u.id = ? LIMIT 1',
    [clientId]
  );
  const client = clientRows[0][0] || {};
  const [addressRows] = deliveryAddressId
    ? await connection.query(
        'SELECT * FROM client_delivery_addresses WHERE id = ? AND user_id = ? LIMIT 1',
        [deliveryAddressId, clientId]
      )
    : await connection.query(
        'SELECT * FROM client_delivery_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC, id DESC',
        [clientId]
      );

  if (!addressRows.length) {
    const error = new Error(deliveryAddressId ? 'Selected delivery address was not found' : 'Please add a delivery address before placing an order');
    error.status = 422;
    throw error;
  }
  if (!deliveryAddressId && addressRows.length > 1) {
    const error = new Error('Please select a delivery address before placing an order');
    error.status = 422;
    throw error;
  }

  const selectedAddress = addressRows[0];
  const clientAddress = [
    selectedAddress.address,
    selectedAddress.city,
    selectedAddress.state,
    selectedAddress.country,
    selectedAddress.pincode,
  ].filter(Boolean).join(', ');

  const vendorOrders = new Map();
  for (const item of items) {
    const vpId = item.vendorProductId || item.id;
    const [vpRows] = await connection.query(
      `SELECT vp.product_id, vp.vendor_id, vp.quantity, vp.price,
              p.name AS product_name,
              p.weight_kg,
              vprof.address AS vendor_address,
              vprof.city AS vendor_city,
              vprof.state AS vendor_state,
              vprof.country AS vendor_country,
              CASE WHEN p.tax_percentage IS NULL THEN COALESCE(c.tax_name, '') ELSE COALESCE(NULLIF(p.tax_name, ''), c.tax_name, '') END AS tax_name,
              COALESCE(p.tax_percentage, c.tax_percentage, 0) AS tax_percentage
       FROM vendor_products vp
       INNER JOIN products p ON p.id = vp.product_id
       INNER JOIN categories c ON c.id = p.category_id
       LEFT JOIN vendor_profiles vprof ON vprof.user_id = vp.vendor_id
       WHERE vp.id = ?
       ${lockStock ? 'FOR UPDATE' : ''}`,
      [vpId]
    );

    if (!vpRows.length) {
      const error = new Error(`Product not found: ${vpId}`);
      error.status = 404;
      throw error;
    }

    const vp = vpRows[0];
    if (Number(vp.quantity || 0) < item.quantity) {
      const error = new Error(`Insufficient stock for product: ${vpId}`);
      error.status = 422;
      throw error;
    }

    const quantity = Math.max(1, Number(item.quantity || 1));
    const unitPrice = Math.max(0, Number(item.price || vp.price || 0));
    const vendorId = Number(vp.vendor_id);
    if (!vendorOrders.has(vendorId)) {
      vendorOrders.set(vendorId, {
        vendorId,
        subtotal: 0,
        deliveryCharge: 0,
        totalWeightKg: 0,
        items: [],
        city: selectedAddress.city || client.city || '',
        destination: clientAddress,
        origin: [
          vp.vendor_address,
          vp.vendor_city,
          vp.vendor_state,
          vp.vendor_country,
        ].filter(Boolean).join(', '),
      });
    }

    const vendorOrder = vendorOrders.get(vendorId);
    vendorOrder.subtotal += unitPrice * quantity;
    vendorOrder.items.push({
      vendorProductId: vpId,
      productId: vp.product_id,
      productName: vp.product_name,
      weightKg: Number(vp.weight_kg || 0),
      quantity,
      unitPrice,
      taxName: vp.tax_name || '',
      taxPercentage: Math.max(0, Number(vp.tax_percentage || 0)),
    });
  }

  const subtotalAmount = [...vendorOrders.values()].reduce((sum, vendorOrder) => sum + Number(vendorOrder.subtotal || 0), 0);
  const globalPromotion = couponCode
    ? await Promotion.resolveOrderPromotion({
        couponCode,
        orderType: 'direct',
        subtotal: subtotalAmount,
        userId: clientId,
      }, connection)
    : null;

  let totalAmount = 0;
  let discountAmount = 0;
  let deliveryCharge = 0;
  const vendorBreakdown = [];

  for (const [vendorId, vendorOrder] of vendorOrders.entries()) {
    const promotion = globalPromotion || await Promotion.resolveOrderPromotion({
      orderType: 'direct',
      subtotal: vendorOrder.subtotal,
      userId: clientId,
      vendorId,
    }, connection);
    const vendorDiscount = Math.min(
      vendorOrder.subtotal,
      globalPromotion
        ? (subtotalAmount > 0 ? Number(((vendorOrder.subtotal / subtotalAmount) * Number(globalPromotion.discountAmount || 0)).toFixed(2)) : 0)
        : Number(promotion.discountAmount || 0)
    );
    const delivery = await DeliveryCharge.calculateCharge({
      city: vendorOrder.city,
      origin: vendorOrder.origin,
      destination: vendorOrder.destination,
      items: vendorOrder.items.map((orderItem) => ({
        product_name: orderItem.productName,
        weight_kg: orderItem.weightKg,
        quantity: orderItem.quantity,
      })),
    }, connection);
    const vendorDeliveryCharge = Number(delivery.delivery_charge || 0);
    const vendorTotal = Math.max(vendorOrder.subtotal - vendorDiscount, 0) + vendorDeliveryCharge;
    discountAmount += vendorDiscount;
    deliveryCharge += vendorDeliveryCharge;
    totalAmount += vendorTotal;
    vendorBreakdown.push({
      vendor_id: vendorId,
      subtotal_amount: Number(vendorOrder.subtotal.toFixed(2)),
      discount_amount: Number(vendorDiscount.toFixed(2)),
      delivery_charge: Number(vendorDeliveryCharge.toFixed(2)),
      total_amount: Number(vendorTotal.toFixed(2)),
      distance_km: delivery.distance_km,
      total_weight_kg: delivery.total_weight_kg,
      rule: delivery.rule,
    });
  }

  return {
    subtotal_amount: Number(subtotalAmount.toFixed(2)),
    discount_amount: Number(discountAmount.toFixed(2)),
    savings_amount: Number(discountAmount.toFixed(2)),
    delivery_charge: Number(deliveryCharge.toFixed(2)),
    total_amount: Number(totalAmount.toFixed(2)),
    address: {
      id: selectedAddress.id,
      label: selectedAddress.label || '',
      recipient_name: selectedAddress.recipient_name || client.name || '',
      phone: selectedAddress.phone || client.phone || '',
      display_address: clientAddress,
      city: selectedAddress.city || client.city || '',
    },
    vendors: vendorBreakdown,
  };
}

app.post(['/client/orders/preview', '/api/client/orders/preview'], webOrJwtAuth, requireAuthRole('Client'), async (req, res) => {
  try {
    if (String(req.body.coupon_code || '').trim() && !roleCan(req.authUser, 'coupons.apply')) {
      return res.status(403).json({ success: false, message: 'You do not have permission to apply coupons' });
    }
    const preview = await calculateClientOrderPreview({
      clientId: req.authUser.id,
      rawItems: req.body.items,
      deliveryAddressId: Number(req.body.delivery_address_id || req.body.deliveryAddressId || 0),
      couponCode: String(req.body.coupon_code || '').trim(),
    });
    res.json({ success: true, preview });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to calculate order preview' });
  }
});

app.post(['/client/orders', '/api/client/orders'], webOrJwtAuth, requireAuthRole('Client'), async (req, res) => {
  try {
    const rawItems = req.body.items;
    if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ success: false, message: 'No items in order' });
    }
    const itemsByProduct = new Map();
    for (const item of rawItems) {
      const productKey = Number(item.productId || item.product_id || item.id || item.vendorProductId);
      const quantity = Math.max(1, Number(item.quantity || 1));
      const price = Math.max(0, Number(item.price || 0));
      if (!productKey || quantity <= 0) continue;

      const normalized = { ...item, quantity, price };
      const existing = itemsByProduct.get(productKey);
      if (!existing) {
        itemsByProduct.set(productKey, normalized);
      } else {
        existing.quantity = Math.max(existing.quantity, quantity);
        if (price > 0 && (Number(existing.price || 0) <= 0 || price < Number(existing.price || 0))) {
          existing.price = price;
          existing.vendorProductId = item.vendorProductId || existing.vendorProductId;
        }
      }
    }
    const items = [...itemsByProduct.values()];
    if (items.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid items in order' });
    }

    const clientId = req.authUser.id;
    if (String(req.body.coupon_code || '').trim() && !roleCan(req.authUser, 'coupons.apply')) {
      return res.status(403).json({ success: false, message: 'You do not have permission to apply coupons' });
    }

    let totalAmount = 0;

    const connection = await pool.getConnection();
    const purchasedProducts = [];
    try {
      await connection.beginTransaction();

      const clientRows = await connection.query(
        'SELECT u.name, u.phone, cp.address, cp.country, cp.state, cp.city FROM users u LEFT JOIN client_profiles cp ON cp.user_id = u.id WHERE u.id = ? LIMIT 1',
        [clientId]
      );
      const client = clientRows[0][0] || {};
      const requestedAddressId = Number(req.body.delivery_address_id || req.body.deliveryAddressId || 0);
      const [addressRows] = requestedAddressId
        ? await connection.query(
            'SELECT * FROM client_delivery_addresses WHERE id = ? AND user_id = ? LIMIT 1',
            [requestedAddressId, clientId]
          )
        : await connection.query(
            'SELECT * FROM client_delivery_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC, id DESC',
            [clientId]
          );

      if (!addressRows.length) {
        throw new Error(requestedAddressId ? 'Selected delivery address was not found' : 'Please add a delivery address before placing an order');
      }
      if (!requestedAddressId && addressRows.length > 1) {
        throw new Error('Please select a delivery address before placing an order');
      }

      const selectedAddress = addressRows[0];
      const clientAddress = [
        selectedAddress.address,
        selectedAddress.city,
        selectedAddress.state,
        selectedAddress.country,
        selectedAddress.pincode,
      ].filter(Boolean).join(', ');
      const clientName = selectedAddress.recipient_name || client.name || null;
      const clientPhone = selectedAddress.phone || client.phone || null;

      const vendorOrders = new Map();

      for (const item of items) {
        const vpId = item.vendorProductId || item.id;
        const [vpRows] = await connection.query(
          `SELECT vp.product_id, vp.vendor_id, vp.quantity, vp.price,
                  p.name AS product_name,
                  p.weight_kg,
                  vprof.address AS vendor_address,
                  vprof.city AS vendor_city,
                  vprof.state AS vendor_state,
                  vprof.country AS vendor_country,
                  CASE WHEN p.tax_percentage IS NULL THEN COALESCE(c.tax_name, '') ELSE COALESCE(NULLIF(p.tax_name, ''), c.tax_name, '') END AS tax_name,
                  COALESCE(p.tax_percentage, c.tax_percentage, 0) AS tax_percentage
           FROM vendor_products vp
           INNER JOIN products p ON p.id = vp.product_id
           INNER JOIN categories c ON c.id = p.category_id
           LEFT JOIN vendor_profiles vprof ON vprof.user_id = vp.vendor_id
           WHERE vp.id = ?
           FOR UPDATE`,
          [vpId]
        );

        if (!vpRows.length) {
          throw new Error(`Product not found: ${vpId}`);
        }

        const vp = vpRows[0];
        if (vp.quantity < item.quantity) {
          throw new Error(`Insufficient stock for product: ${vpId}`);
        }

        const quantity = Math.max(1, Number(item.quantity || 1));
        const unitPrice = Math.max(0, Number(item.price || vp.price || 0));
        const taxPercentage = Math.max(0, Number(vp.tax_percentage || 0));
        const lineTotal = unitPrice * quantity;
        const taxAmount = taxPercentage > 0 ? lineTotal * taxPercentage / (100 + taxPercentage) : 0;
        const taxableAmount = lineTotal - taxAmount;
        const vendorId = Number(vp.vendor_id);

        if (!vendorOrders.has(vendorId)) {
          vendorOrders.set(vendorId, {
            total: 0,
            items: [],
            city: selectedAddress.city || client.city || '',
            destination: clientAddress,
            origin: [
              vp.vendor_address,
              vp.vendor_city,
              vp.vendor_state,
              vp.vendor_country,
            ].filter(Boolean).join(', '),
          });
        }

        vendorOrders.get(vendorId).total += unitPrice * quantity;
        vendorOrders.get(vendorId).items.push({
          vendorProductId: vpId,
          productId: vp.product_id,
          productName: vp.product_name,
          weightKg: Number(vp.weight_kg || 0),
          quantity,
          unitPrice,
          taxName: vp.tax_name || '',
          taxPercentage,
          taxAmount,
          taxableAmount,
        });
      }

      const orderIds = [];
      const vendorOrderNotifications = [];
      const subtotalAmount = [...vendorOrders.values()].reduce((sum, vendorOrder) => sum + Number(vendorOrder.total || 0), 0);
      const couponCode = String(req.body.coupon_code || '').trim();
      const globalPromotion = couponCode
        ? await Promotion.resolveOrderPromotion({
            couponCode,
            orderType: 'direct',
            subtotal: subtotalAmount,
            userId: clientId,
          }, connection)
        : null;
      const vendorPromotions = new Map();

      totalAmount = 0;
      for (const [vendorId, vendorOrder] of vendorOrders.entries()) {
        const vendorSubtotal = vendorOrder.total;
        const promotion = globalPromotion || await Promotion.resolveOrderPromotion({
          orderType: 'direct',
          subtotal: vendorSubtotal,
          userId: clientId,
          vendorId,
        }, connection);
        const discountAmount = globalPromotion
          ? (subtotalAmount > 0 ? Number(((vendorSubtotal / subtotalAmount) * Number(globalPromotion.discountAmount || 0)).toFixed(2)) : 0)
          : Number(promotion.discountAmount || 0);
        const vendorDiscount = Math.min(vendorSubtotal, discountAmount);
        const delivery = await DeliveryCharge.calculateCharge({
          city: vendorOrder.city,
          origin: vendorOrder.origin,
          destination: vendorOrder.destination,
          items: vendorOrder.items.map((orderItem) => ({
            product_name: orderItem.productName,
            weight_kg: orderItem.weightKg,
            quantity: orderItem.quantity,
          })),
        }, connection);
        const deliveryCharge = Number(delivery.delivery_charge || 0);
        const vendorTotal = Math.max(vendorSubtotal - vendorDiscount, 0) + deliveryCharge;
        vendorPromotions.set(vendorId, { promotion, vendorDiscount, vendorTotal, deliveryCharge, delivery });
        totalAmount += vendorTotal;
      }

      const clientWallet = await Wallet.findByUserId(clientId);
      if (clientWallet.balance < totalAmount) {
        const error = new Error('Insufficient wallet balance');
        error.status = 400;
        throw error;
      }

      for (const [vendorId, vendorOrder] of vendorOrders.entries()) {
        const vendorSubtotal = vendorOrder.total;
        const vendorPromotion = vendorPromotions.get(vendorId);
        const promotion = vendorPromotion.promotion;
        const vendorDiscount = vendorPromotion.vendorDiscount;
        const vendorTotal = vendorPromotion.vendorTotal;
        const deliveryCharge = vendorPromotion.deliveryCharge;
        const [orderResult] = await connection.query(
          `INSERT INTO client_orders
           (user_id, vendor_id, subtotal_amount, discount_amount, savings_amount, delivery_charge, coupon_id, coupon_code, discount_id, discount_label, order_type, total_amount, status, delivery_status, client_name, client_phone, client_address, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            clientId,
            vendorId,
            vendorSubtotal,
            vendorDiscount,
            vendorDiscount,
            deliveryCharge,
            promotion.coupon ? promotion.coupon.id : null,
            promotion.code || null,
            promotion.discount ? promotion.discount.id : null,
            promotion.discount ? promotion.discount.name : null,
            'direct',
            vendorTotal,
            'pending',
            'pending',
            clientName,
            clientPhone,
            clientAddress || null,
          ]
        );

        const orderId = orderResult.insertId;
        orderIds.push(orderId);
        vendorOrderNotifications.push({ vendorId, orderId, totalAmount: vendorTotal });
        await Promotion.recordUsage({
          orderId,
          userId: clientId,
          orderType: 'direct',
          subtotal: vendorSubtotal,
          discountAmount: vendorDiscount,
          coupon: promotion.coupon,
          discount: promotion.discount,
        }, connection);
        await connection.query(
          `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [orderId, null, 'pending', clientId, 'Client', 'Order placed']
        );

        for (const orderItem of vendorOrder.items) {
          await connection.query(
            `INSERT INTO client_order_items
             (order_id, vendor_product_id, quantity, unit_price, tax_name, tax_percentage, tax_amount, taxable_amount)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              orderId,
              orderItem.vendorProductId,
              orderItem.quantity,
              orderItem.unitPrice,
              orderItem.taxName || null,
              orderItem.taxPercentage,
              orderItem.taxAmount,
              orderItem.taxableAmount,
            ]
          );

          await connection.query(
            'UPDATE vendor_products SET quantity = quantity - ? WHERE id = ?',
            [orderItem.quantity, orderItem.vendorProductId]
          );

          purchasedProducts.push({ productId: orderItem.productId, quantity: orderItem.quantity });
        }
      }

      await Wallet.adjustBalance({
        userId: clientId,
        type: 'debit',
        amount: totalAmount,
        note: `Order #${orderIds.join(', #')}`,
        reference: `client_order_${orderIds[0]}`,
        createdBy: clientId,
      });

      await connection.commit();
      for (const notification of vendorOrderNotifications) {
        vendorNotifications.notifyVendor(notification.vendorId, {
          type: 'order',
          id: notification.orderId,
          title: 'New order received',
          message: 'New order received',
          orderId: notification.orderId,
          orderType: 'direct',
          totalAmount: notification.totalAmount,
        });
      }
      for (const purchased of purchasedProducts) {
        await ProductSearch.trackPurchase({
          userId: clientId,
          productId: purchased.productId,
          quantity: purchased.quantity,
        });
      }
      res.json({
        success: true,
        orderId: orderIds[0],
        orderIds,
        message: orderIds.length > 1 ? `Order placed successfully for ${orderIds.length} vendors` : 'Order placed successfully',
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Order placement error:', error);
    res.status(500).json({ success: false, message: error.message || 'Unable to place order' });
  }
});

app.get('/roles', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const [roles] = await pool.query(`
      SELECT r.*,
             p.name as parent_name,
             (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) as user_count
      FROM roles r
      LEFT JOIN roles p ON r.parent_id = p.id
      ORDER BY r.level ASC, r.name ASC
    `);
    res.render('roles_list', {
      roles,
      user: req.session.user,
      success: req.query.success,
      error: req.query.error,
    });
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).send('Unable to fetch roles');
  }
});

function normalizeCityName(value) {
  return String(value || '').trim();
}

function cityKey(value) {
  return normalizeCityName(value).toLowerCase();
}

async function promotionCityOptions() {
  const [cityRows] = await pool.query(
    `SELECT DISTINCT city FROM delivery_partner_settings WHERE city IS NOT NULL AND TRIM(city) <> ''
     UNION
     SELECT DISTINCT city FROM client_profiles WHERE city IS NOT NULL AND TRIM(city) <> ''
     UNION
     SELECT DISTINCT city FROM vendor_profiles WHERE city IS NOT NULL AND TRIM(city) <> ''
     UNION
     SELECT DISTINCT city FROM delivery_charge_rules WHERE city IS NOT NULL AND TRIM(city) <> ''
     ORDER BY city`
  );
  return cityRows.map((row) => normalizeCityName(row.city)).filter(Boolean);
}

app.get('/delivery-charge-settings', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  res.render('delivery-charge-settings', {
    user: req.session.user,
    shell: buildShell(req.session.user, req.path),
    cityOptions: await promotionCityOptions(),
  });
});

app.get('/delivery-charge-settings/rules', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    res.json({ success: true, rules: await DeliveryCharge.listRules(), cities: await promotionCityOptions() });
  } catch (error) {
    console.error('Delivery charge rules load error:', error);
    res.status(500).json({ success: false, message: 'Unable to load delivery charge rules' });
  }
});

app.post('/delivery-charge-settings/rules', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const id = await DeliveryCharge.saveRule(req.body);
    res.status(201).json({ success: true, message: 'Delivery charge rule saved', id, rules: await DeliveryCharge.listRules() });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to save delivery charge rule' });
  }
});

app.put('/delivery-charge-settings/rules/:id', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const id = await DeliveryCharge.saveRule({ ...req.body, id: req.params.id });
    res.json({ success: true, message: 'Delivery charge rule updated', id, rules: await DeliveryCharge.listRules() });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update delivery charge rule' });
  }
});

app.delete('/delivery-charge-settings/rules/:id', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    await DeliveryCharge.deleteRule(Number(req.params.id));
    res.json({ success: true, message: 'Delivery charge rule deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to delete delivery charge rule' });
  }
});

app.post('/delivery-charge-settings/calculate', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const result = await DeliveryCharge.calculateCharge({
      city: req.body.city,
      origin: req.body.origin,
      destination: req.body.destination,
      totalWeightKg: req.body.total_weight_kg,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to calculate delivery charge' });
  }
});

async function promotionPayload(body) {
  const allowedCities = await promotionCityOptions();
  const allowedCityMap = new Map(allowedCities.map((city) => [cityKey(city), city]));
  const cities = []
    .concat(body.cities || [])
    .flatMap((value) => String(value || '').split(','))
    .map(normalizeCityName)
    .filter(Boolean);
  const invalidCities = cities.filter((city) => !allowedCityMap.has(cityKey(city)));
  if (invalidCities.length) {
    const error = new Error(`Unknown offer city: ${invalidCities.join(', ')}`);
    error.status = 422;
    throw error;
  }
  const selectedCities = [...new Set(cities.map((city) => allowedCityMap.get(cityKey(city))))];

  return {
    name: String(body.name || '').trim(),
    code: String(body.code || '').trim(),
    description: String(body.description || '').trim(),
    value_type: String(body.value_type || 'fixed').toLowerCase(),
    value: Number(body.value || 0),
    min_order_amount: Number(body.min_order_amount || 0),
    start_at: body.start_at || null,
    expires_at: body.expires_at || null,
    is_active: body.is_active === true || body.is_active === 'true' || body.is_active === '1' || body.is_active === 'on',
    apply_on: String(body.apply_on || 'both').toLowerCase(),
    usage_limit: body.usage_limit ? Number(body.usage_limit) : null,
    per_customer_limit: body.per_customer_limit ? Number(body.per_customer_limit) : null,
    auto_generate: body.auto_generate === true || body.auto_generate === 'true' || body.auto_generate === '1' || body.auto_generate === 'on',
    background_color: String(body.background_color || '').trim() || undefined,
    text_color: String(body.text_color || '').trim() || undefined,
    scroll_message: String(body.scroll_message || '').trim(),
    city_scope: String(body.city_scope || 'all').toLowerCase() === 'specific' && selectedCities.length ? 'specific' : 'all',
    cities: selectedCities,
  };
}

app.get('/discounts', requireAuth, requirePermission('discounts.view'), async (req, res) => {
  res.render('promotions', {
    user: req.session.user,
    mode: 'discounts',
    title: 'Discounts',
    canCreate: roleCan(req.session.user, 'discounts.create'),
    canEdit: roleCan(req.session.user, 'discounts.edit'),
    canDelete: roleCan(req.session.user, 'discounts.delete'),
    cityOptions: await promotionCityOptions(),
  });
});

app.get('/coupons', requireAuth, requirePermission('coupons.view'), async (req, res) => {
  res.render('promotions', {
    user: req.session.user,
    mode: 'coupons',
    title: 'Coupons',
    canCreate: roleCan(req.session.user, 'coupons.create'),
    canEdit: roleCan(req.session.user, 'coupons.edit'),
    canDelete: roleCan(req.session.user, 'coupons.delete'),
    cityOptions: await promotionCityOptions(),
  });
});

app.get('/coupons/history', requireAuth, requirePermission('coupon_history.view'), (req, res) => {
  res.render('coupon-history', { user: req.session.user });
});

function canManageSupport(user) {
  return roleCan(user, 'support.manage');
}

function supportScopeForPath(pathname) {
  if (pathname.includes('/clients')) return 'Client';
  if (pathname.includes('/vendors')) return 'Vendor';
  return '';
}

app.get('/support', requireAuth, requirePermission('support.manage'), (req, res) => {
  res.render('support', {
    user: req.session.user,
    mode: 'staff',
    title: 'Support',
    roleType: '',
  });
});

app.get('/support/clients', requireAuth, requirePermission('support.manage'), (req, res) => {
  res.render('support', {
    user: req.session.user,
    mode: 'staff',
    title: 'Client Support',
    roleType: 'Client',
  });
});

app.get('/support/vendors', requireAuth, requirePermission('support.manage'), (req, res) => {
  res.render('support', {
    user: req.session.user,
    mode: 'staff',
    title: 'Vendor Support',
    roleType: 'Vendor',
  });
});

app.get('/support/client', requireSessionRole('Client', '/login/client'), (req, res) => {
  res.render('support', {
    user: req.session.user,
    shell: buildShell(req.session.user, req.path),
    mode: 'self',
    title: 'Client Support',
    roleType: 'Client',
  });
});

app.get('/support/vendor', requireSessionRole('Vendor', '/login/vendor'), (req, res) => {
  res.render('support', {
    user: req.session.user,
    shell: buildShell(req.session.user, req.path),
    mode: 'self',
    title: 'Vendor Support',
    roleType: 'Vendor',
  });
});

app.get('/api/support/tickets', webOrJwtAuth, async (req, res) => {
  try {
    const currentUser = req.authUser;
    if (canManageSupport(currentUser)) {
      const tickets = await SupportTicket.list({
        roleType: req.query.role_type || supportScopeForPath(req.get('referer') || ''),
        status: req.query.status,
      });
      return res.json({ success: true, tickets, mode: 'staff' });
    }

    const requesterRole = SupportTicket.roleScope(currentUser.role);
    if (!requesterRole) {
      return res.status(403).json({ success: false, message: 'Support access denied' });
    }
    const tickets = await SupportTicket.list({ requesterId: currentUser.id, requesterRole });
    return res.json({ success: true, tickets, mode: 'self' });
  } catch (error) {
    console.error('Support list error:', error);
    res.status(500).json({ success: false, message: 'Unable to load support tickets' });
  }
});

app.post('/api/support/tickets', webOrJwtAuth, async (req, res) => {
  try {
    const id = await SupportTicket.create({
      user: req.authUser,
      subject: req.body.subject,
      message: req.body.message,
    });
    res.status(201).json({ success: true, id, message: 'Support ticket created' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to create support ticket' });
  }
});

app.get('/api/support/tickets/:id', webOrJwtAuth, async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }
  if (!canManageSupport(req.authUser) && Number(ticket.requester_id) !== Number(req.authUser.id)) {
    return res.status(403).json({ success: false, message: 'Support ticket access denied' });
  }
  const messages = await SupportTicket.messages(req.params.id);
  return res.json({ success: true, ticket, messages, canManage: canManageSupport(req.authUser) });
});

app.post('/api/support/tickets/:id/replies', webOrJwtAuth, async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }
  if (!canManageSupport(req.authUser) && Number(ticket.requester_id) !== Number(req.authUser.id)) {
    return res.status(403).json({ success: false, message: 'Support ticket access denied' });
  }
  try {
    await SupportTicket.addMessage({ ticketId: req.params.id, user: req.authUser, message: req.body.message });
    return res.json({ success: true, message: 'Reply saved' });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to save reply' });
  }
});

app.put('/api/support/tickets/:id/status', webOrJwtAuth, requirePermission('support.manage'), async (req, res) => {
  try {
    await SupportTicket.updateStatus(req.params.id, req.body.status);
    res.json({ success: true, message: 'Ticket status updated' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update ticket status' });
  }
});

app.get('/api/discounts', webOrJwtAuth, requirePermission('discounts.view'), async (req, res) => {
  res.json({ success: true, discounts: await Promotion.listDiscounts() });
});

app.get('/api/promotions/active-display', webOrJwtAuth, async (req, res) => {
  res.json({ success: true, promotions: await Promotion.activeDisplayPromotions(req.authUser && req.authUser.id) });
});

app.get('/api/vendor/offers', webOrJwtAuth, requireAuthRole('Vendor'), async (req, res) => {
  res.json({ success: true, offers: await Promotion.listVendorDiscounts(req.authUser.id) });
});

app.post('/api/vendor/offers', webOrJwtAuth, requireAuthRole('Vendor'), async (req, res) => {
  try {
    const payload = await promotionPayload(req.body);
    const id = await Promotion.createDiscount({
      ...payload,
      vendor_id: req.authUser.id,
      apply_on: 'direct',
      scroll_message: payload.scroll_message || payload.name,
      background_color: payload.background_color || '#0f766e',
      text_color: payload.text_color || '#ffffff',
    });
    res.status(201).json({ success: true, id, message: 'Offer created' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to create offer' });
  }
});

app.post('/api/discounts', webOrJwtAuth, requirePermission('discounts.create'), uploadPromotionImage.single('image'), handlePromotionImageUploadError, async (req, res) => {
  try {
    const id = await Promotion.createDiscount({ ...(await promotionPayload(req.body)), image_path: promotionImagePath(req.file) });
    res.status(201).json({ success: true, id, message: 'Discount created' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to create discount' });
  }
});

app.put('/api/discounts/:id', webOrJwtAuth, requirePermission('discounts.edit'), uploadPromotionImage.single('image'), handlePromotionImageUploadError, async (req, res) => {
  try {
    await Promotion.updateDiscount(req.params.id, { ...(await promotionPayload(req.body)), image_path: promotionImagePath(req.file) });
    res.json({ success: true, message: 'Discount updated' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update discount' });
  }
});

app.delete('/api/discounts/:id', webOrJwtAuth, requirePermission('discounts.delete'), async (req, res) => {
  await Promotion.deleteDiscount(req.params.id);
  res.json({ success: true, message: 'Discount deleted' });
});

app.get('/api/coupons', webOrJwtAuth, requirePermission('coupons.view'), async (req, res) => {
  res.json({ success: true, coupons: await Promotion.listCoupons() });
});

app.post('/api/coupons', webOrJwtAuth, requirePermission('coupons.create'), uploadPromotionImage.single('image'), handlePromotionImageUploadError, async (req, res) => {
  try {
    const id = await Promotion.createCoupon({ ...(await promotionPayload(req.body)), image_path: promotionImagePath(req.file) });
    res.status(201).json({ success: true, id, message: 'Coupon created' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to create coupon' });
  }
});

app.put('/api/coupons/:id', webOrJwtAuth, requirePermission('coupons.edit'), uploadPromotionImage.single('image'), handlePromotionImageUploadError, async (req, res) => {
  try {
    await Promotion.updateCoupon(req.params.id, { ...(await promotionPayload(req.body)), image_path: promotionImagePath(req.file) });
    res.json({ success: true, message: 'Coupon updated' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update coupon' });
  }
});

app.delete('/api/coupons/:id', webOrJwtAuth, requirePermission('coupons.delete'), async (req, res) => {
  await Promotion.deleteCoupon(req.params.id);
  res.json({ success: true, message: 'Coupon deleted' });
});

app.get('/api/coupons/history', webOrJwtAuth, requirePermission('coupon_history.view'), async (req, res) => {
  res.json({ success: true, history: await Promotion.listHistory() });
});

app.get('/settings', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  const maps = await settingGroup([
    'google_maps_browser_api_key',
    'google_distance_api_key',
    'google_maps_map_id',
    'google_maps_default_origin',
    'google_maps_default_destination',
  ]);
  res.render('settings', {
    user: req.session.user,
    permissionLabels,
    settings: {
      general: {
        appName: 'Grocery App',
        supportEmail: 'support@groceryapp.local',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        maintenanceMode: false,
      },
      email: {
        mailDriver: 'SMTP',
        host: 'smtp.example.com',
        port: 587,
        fromEmail: 'noreply@groceryapp.local',
        encryption: 'TLS',
      },
      firebase: {
        projectId: 'grocery-app-demo',
        messagingSenderId: '000000000000',
        storageBucket: 'grocery-app-demo.appspot.com',
        pushNotifications: true,
      },
      maps: {
        browserApiKey: maps.google_maps_browser_api_key || process.env.GOOGLE_MAPS_BROWSER_API_KEY || '',
        distanceApiKey: maps.google_distance_api_key || process.env.GOOGLE_DISTANCE_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '',
        mapId: maps.google_maps_map_id || '',
        defaultOrigin: maps.google_maps_default_origin || 'Jaipur, Rajasthan, India',
        defaultDestination: maps.google_maps_default_destination || 'Mansarovar, Jaipur, Rajasthan, India',
      },
      security: {
        jwtExpiry: '7 days',
        minPasswordLength: 6,
        loginAttempts: 5,
        accountVerification: false,
      },
      locations: {
        countries: ['India', 'United States'],
        states: ['Rajasthan', 'Maharashtra', 'California'],
        cities: ['Jaipur', 'Mumbai', 'San Francisco'],
      },
    },
  });
});

app.get('/settings/google-maps', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  const maps = await settingGroup([
    'google_maps_browser_api_key',
    'google_distance_api_key',
    'google_maps_map_id',
    'google_maps_default_origin',
    'google_maps_default_destination',
  ]);
  res.json({
    success: true,
    settings: {
      browserApiKey: maps.google_maps_browser_api_key || process.env.GOOGLE_MAPS_BROWSER_API_KEY || '',
      distanceApiKey: maps.google_distance_api_key || process.env.GOOGLE_DISTANCE_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '',
      mapId: maps.google_maps_map_id || '',
      defaultOrigin: maps.google_maps_default_origin || 'Jaipur, Rajasthan, India',
      defaultDestination: maps.google_maps_default_destination || 'Mansarovar, Jaipur, Rajasthan, India',
    },
  });
});

app.put('/settings/google-maps', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    await saveSetting('google_maps_browser_api_key', String(req.body.browserApiKey || '').trim(), true);
    await saveSetting('google_distance_api_key', String(req.body.distanceApiKey || '').trim(), true);
    await saveSetting('google_maps_map_id', String(req.body.mapId || '').trim(), false);
    await saveSetting('google_maps_default_origin', String(req.body.defaultOrigin || '').trim(), false);
    await saveSetting('google_maps_default_destination', String(req.body.defaultDestination || '').trim(), false);
    res.json({ success: true, message: 'Google Maps settings saved' });
  } catch (error) {
    console.error('Google Maps settings save error:', error);
    res.status(500).json({ success: false, message: 'Unable to save Google Maps settings' });
  }
});

app.post('/settings/google-maps/test-distance', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const origin = String(req.body.origin || '').trim();
    const destination = String(req.body.destination || '').trim();
    if (!origin || !destination) {
      return res.status(422).json({ success: false, message: 'Origin and destination are required' });
    }
    const result = await DeliveryCharge.testDistance(origin, destination);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Unable to test Google Distance API',
      diagnostics: error.googleDiagnostic ? [{ ...error.googleDiagnostic, ok: false }] : [],
    });
  }
});

app.get('/settings/roles', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const [roles] = await pool.query(`
      SELECT r.id, r.name, r.slug, r.description, r.level, r.permissions,
             p.name AS parent_name,
             (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
      FROM roles r
      LEFT JOIN roles p ON r.parent_id = p.id
      ORDER BY r.level ASC, r.name ASC
    `);

    res.json({
      success: true,
      roles: roles.map((role) => ({ ...role, permissions: parsePermissions(role.permissions) })),
      permissionLabels,
    });
  } catch (error) {
    console.error('Role settings load error:', error);
    res.status(500).json({ success: false, message: 'Unable to load role settings' });
  }
});

app.put('/settings/roles/:id', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  let permissions = normalizePermissionList(req.body.permissions);

  try {
    const [roles] = await pool.query('SELECT id, slug FROM roles WHERE id = ?', [req.params.id]);
    if (!roles.length) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    if (roles[0].slug === 'superadmin') {
      permissions = allPermissionKeys();
    }

    await pool.query('UPDATE roles SET permissions = ? WHERE id = ?', [JSON.stringify(permissions), req.params.id]);

    if ((req.session.user.roles || []).some((role) => String(role.id) === String(req.params.id))) {
      const refreshedUser = await getUserWithRoles(req.session.user.email);
      if (refreshedUser) {
        delete refreshedUser.password;
        req.session.user = refreshedUser;
      }
    }

    res.json({ success: true, message: 'Role permissions saved', permissions });
  } catch (error) {
    console.error('Role settings save error:', error);
    res.status(500).json({ success: false, message: 'Unable to save role permissions' });
  }
});

app.get('/settings/delivery-partners', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const [partners] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone,
              COALESCE(
                JSON_AGG(
                  JSON_BUILD_OBJECT('city', dps.city, 'is_active', dps.is_active)
                  ORDER BY dps.city
                ) FILTER (WHERE dps.id IS NOT NULL),
                '[]'
              ) AS cities
       FROM users u
       LEFT JOIN delivery_partner_settings dps ON dps.user_id = u.id
       WHERE LOWER(u.role) = 'staff'
         AND u.status = 'active'
         AND u.is_deleted = 0
       GROUP BY u.id, u.name, u.email, u.phone
       ORDER BY u.name`
    );
    const [cityRows] = await pool.query(
      `SELECT DISTINCT city FROM client_profiles WHERE city IS NOT NULL AND TRIM(city) <> ''
       UNION
       SELECT DISTINCT city FROM vendor_profiles WHERE city IS NOT NULL AND TRIM(city) <> ''
       ORDER BY city`
    );
    res.json({ success: true, partners, cities: cityRows.map((row) => row.city) });
  } catch (error) {
    console.error('Delivery partner settings load error:', error);
    res.status(500).json({ success: false, message: 'Unable to load delivery partner settings' });
  }
});

app.post('/settings/delivery-partners', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '').trim();
  const cities = Array.isArray(req.body.cities) ? req.body.cities : [];

  if (!name || name.length < 2) return res.status(422).json({ success: false, message: 'Name is required' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(422).json({ success: false, message: 'Valid email is required' });
  if (!password || password.length < 6) return res.status(422).json({ success: false, message: 'Password must be at least 6 characters' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [duplicates] = await connection.query(
      'SELECT id FROM users WHERE is_deleted = 0 AND (email = ? OR (? <> ? AND phone = ?)) LIMIT 1',
      [email, phone, '', phone]
    );
    if (duplicates.length) {
      const error = new Error('Email or phone already exists');
      error.status = 409;
      throw error;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await connection.query(
      'INSERT INTO users (name, email, phone, password, role, status) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, phone || null, hashedPassword, 'staff', 'active']
    );
    const userId = result.insertId;

    for (const cityValue of cities) {
      const city = String(cityValue || '').trim();
      if (!city) continue;
      await connection.query(
        `INSERT INTO delivery_partner_settings (user_id, city, is_active)
         VALUES (?, ?, 1)
         ON CONFLICT (user_id, city) DO UPDATE
         SET is_active = 1,
             updated_at = CURRENT_TIMESTAMP`,
        [userId, city]
      );
    }

    await connection.commit();
    res.json({ success: true, message: 'Delivery partner added successfully', id: userId });
  } catch (error) {
    await connection.rollback();
    console.error('Delivery partner create error:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Unable to add delivery partner' });
  } finally {
    connection.release();
  }
});

app.put('/settings/delivery-partners', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  const assignments = Array.isArray(req.body.assignments) ? req.body.assignments : [];
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM delivery_partner_settings');

    for (const assignment of assignments) {
      const userId = Number(assignment.user_id);
      const cities = Array.isArray(assignment.cities) ? assignment.cities : [];
      if (!userId) continue;

      const [staffRows] = await connection.query(
        "SELECT id FROM users WHERE id = ? AND LOWER(role) = 'staff' AND status = 'active' AND is_deleted = 0 LIMIT 1",
        [userId]
      );
      if (!staffRows.length) continue;

      for (const cityValue of cities) {
        const city = String(cityValue || '').trim();
        if (!city) continue;
        await connection.query(
          `INSERT INTO delivery_partner_settings (user_id, city, is_active)
           VALUES (?, ?, 1)
           ON CONFLICT (user_id, city) DO UPDATE
           SET is_active = 1,
               updated_at = CURRENT_TIMESTAMP`,
          [userId, city]
        );
      }
    }

    await connection.commit();
    res.json({ success: true, message: 'Delivery partner settings saved' });
  } catch (error) {
    await connection.rollback();
    console.error('Delivery partner settings save error:', error);
    res.status(500).json({ success: false, message: 'Unable to save delivery partner settings' });
  } finally {
    connection.release();
  }
});

app.put('/settings/delivery-partners/:id', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '').trim();
  const cities = Array.isArray(req.body.cities) ? req.body.cities : [];

  if (!id) return res.status(422).json({ success: false, message: 'Valid delivery partner is required' });
  if (!name || name.length < 2) return res.status(422).json({ success: false, message: 'Name is required' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(422).json({ success: false, message: 'Valid email is required' });
  if (password && password.length < 6) return res.status(422).json({ success: false, message: 'Password must be at least 6 characters' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.query(
      "SELECT id FROM users WHERE id = ? AND LOWER(role) = 'staff' AND is_deleted = 0 LIMIT 1",
      [id]
    );
    if (!existingRows.length) {
      const error = new Error('Delivery partner not found');
      error.status = 404;
      throw error;
    }

    const [duplicates] = await connection.query(
      'SELECT id FROM users WHERE is_deleted = 0 AND id <> ? AND (email = ? OR (? <> ? AND phone = ?)) LIMIT 1',
      [id, email, phone, '', phone]
    );
    if (duplicates.length) {
      const error = new Error('Email or phone already exists');
      error.status = 409;
      throw error;
    }

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await connection.query(
        'UPDATE users SET name = ?, email = ?, phone = ?, password = ?, status = ? WHERE id = ?',
        [name, email, phone || null, hashedPassword, 'active', id]
      );
    } else {
      await connection.query(
        'UPDATE users SET name = ?, email = ?, phone = ?, status = ? WHERE id = ?',
        [name, email, phone || null, 'active', id]
      );
    }

    await connection.query('DELETE FROM delivery_partner_settings WHERE user_id = ?', [id]);
    for (const cityValue of cities) {
      const city = String(cityValue || '').trim();
      if (!city) continue;
      await connection.query(
        `INSERT INTO delivery_partner_settings (user_id, city, is_active)
         VALUES (?, ?, 1)
         ON CONFLICT (user_id, city) DO UPDATE
         SET is_active = 1,
             updated_at = CURRENT_TIMESTAMP`,
        [id, city]
      );
    }

    await connection.commit();
    res.json({ success: true, message: 'Delivery partner updated successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Delivery partner update error:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Unable to update delivery partner' });
  } finally {
    connection.release();
  }
});

app.delete('/settings/delivery-partners/:id', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(422).json({ success: false, message: 'Valid delivery partner is required' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM delivery_partner_settings WHERE user_id = ?', [id]);
    const [result] = await connection.query(
      "UPDATE users SET is_deleted = 1, status = 'inactive' WHERE id = ? AND LOWER(role) = 'staff'",
      [id]
    );
    if (result.affectedRows === 0) {
      const error = new Error('Delivery partner not found');
      error.status = 404;
      throw error;
    }
    await connection.commit();
    res.json({ success: true, message: 'Delivery partner deleted successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Delivery partner delete error:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Unable to delete delivery partner' });
  } finally {
    connection.release();
  }
});

app.get('/settings/catalog-tree', requireAuth, requirePermission('settings.manage'), catalogController.tree);
app.get('/settings/commissions', requireAuth, requirePermission('settings.manage'), commissionController.list);
app.put('/settings/commissions', requireAuth, requirePermission('settings.manage'), commissionController.update);
app.post('/settings/commissions/calculate', requireAuth, requirePermission('settings.manage'), commissionController.calculate);
app.post('/settings/categories', requireAuth, requirePermission('settings.manage'), catalogController.createCategory);
app.get('/settings/categories', requireAuth, requirePermission('settings.manage'), catalogController.listCategories);
app.put('/settings/categories/:id', requireAuth, requirePermission('settings.manage'), catalogController.updateCategory);
app.delete('/settings/categories/:id', requireAuth, requirePermission('settings.manage'), catalogController.deleteCategory);
app.post('/settings/subcategories', requireAuth, requirePermission('settings.manage'), catalogController.createSubcategory);
app.get('/settings/subcategories', requireAuth, requirePermission('settings.manage'), catalogController.listSubcategories);
app.put('/settings/subcategories/:id', requireAuth, requirePermission('settings.manage'), catalogController.updateSubcategory);
app.delete('/settings/subcategories/:id', requireAuth, requirePermission('settings.manage'), catalogController.deleteSubcategory);
app.post('/settings/brands', requireAuth, requirePermission('settings.manage'), uploadBrandLogo.single('logo'), handleUploadError, catalogController.createBrand);
app.get('/settings/brands', requireAuth, requirePermission('settings.manage'), catalogController.listBrands);
app.put('/settings/brands/:id', requireAuth, requirePermission('settings.manage'), uploadBrandLogo.single('logo'), handleUploadError, catalogController.updateBrand);
app.delete('/settings/brands/:id', requireAuth, requirePermission('settings.manage'), catalogController.deleteBrand);
app.get('/catalog-tree', requireAuth, requirePermission('settings.manage'), catalogController.tree);
app.post('/categories', requireAuth, requirePermission('settings.manage'), catalogController.createCategory);
app.get('/categories', requireAuth, requirePermission('settings.manage'), catalogController.listCategories);
app.put('/categories/:id', requireAuth, requirePermission('settings.manage'), catalogController.updateCategory);
app.delete('/categories/:id', requireAuth, requirePermission('settings.manage'), catalogController.deleteCategory);
app.post('/sub-categories', requireAuth, requirePermission('settings.manage'), catalogController.createSubcategory);
app.get('/sub-categories', requireAuth, requirePermission('settings.manage'), catalogController.listSubcategories);
app.put('/sub-categories/:id', requireAuth, requirePermission('settings.manage'), catalogController.updateSubcategory);
app.delete('/sub-categories/:id', requireAuth, requirePermission('settings.manage'), catalogController.deleteSubcategory);
app.post('/brands', requireAuth, requirePermission('settings.manage'), uploadBrandLogo.single('logo'), handleUploadError, catalogController.createBrand);
app.get('/brands', requireAuth, requirePermission('settings.manage'), catalogController.listBrands);
app.put('/brands/:id', requireAuth, requirePermission('settings.manage'), uploadBrandLogo.single('logo'), handleUploadError, catalogController.updateBrand);
app.delete('/brands/:id', requireAuth, requirePermission('settings.manage'), catalogController.deleteBrand);

app.get('/roles/create', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const [availableRoles] = await pool.query('SELECT id, name, level FROM roles ORDER BY level ASC, name ASC');
    res.render('role_form', {
      role: { level: 0, permissions: [] },
      availableRoles,
      user: req.session.user,
      permissionLabels,
    });
  } catch (error) {
    console.error('Error loading create form:', error);
    res.status(500).send('Unable to load form');
  }
});

app.post('/roles/store', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  const { name, slug, description, parent_id, level } = req.body;
  const permissions = JSON.stringify([].concat(req.body.permissions || []));

  try {
    if (!/^[a-z0-9_-]+$/.test(slug)) {
      const [availableRoles] = await pool.query('SELECT id, name, level FROM roles ORDER BY level ASC, name ASC');
      return res.render('role_form', {
        role: { name, slug, description, parent_id, level: parseInt(level, 10) || 0, permissions: parsePermissions(permissions) },
        availableRoles,
        user: req.session.user,
        permissionLabels,
        error: 'Slug must contain only lowercase letters, numbers, hyphens, or underscores',
      });
    }

    await pool.query(
      'INSERT INTO roles (name, slug, description, parent_id, level, permissions) VALUES (?, ?, ?, ?, ?, ?)',
      [name, slug, description, parent_id || null, parseInt(level, 10) || 0, permissions]
    );

    res.redirect('/roles?success=Role+created+successfully');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      const [availableRoles] = await pool.query('SELECT id, name, level FROM roles ORDER BY level ASC, name ASC');
      return res.render('role_form', {
        role: { name, slug, description, parent_id, level: parseInt(level, 10) || 0, permissions: parsePermissions(permissions) },
        availableRoles,
        user: req.session.user,
        permissionLabels,
        error: 'A role with this name or slug already exists',
      });
    }
    console.error('Error creating role:', error);
    res.status(500).send('Unable to create role');
  }
});

app.get('/roles/edit/:id', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const [roles] = await pool.query('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (roles.length === 0) {
      return res.status(404).send('Role not found');
    }

    const role = { ...roles[0], permissions: parsePermissions(roles[0].permissions) };
    const [availableRoles] = await pool.query(
      'SELECT id, name, level FROM roles WHERE id != ? ORDER BY level ASC, name ASC',
      [req.params.id]
    );

    res.render('role_form', { role, availableRoles, user: req.session.user, permissionLabels });
  } catch (error) {
    console.error('Error loading role:', error);
    res.status(500).send('Unable to load role');
  }
});

app.post('/roles/update/:id', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  const { name, slug, description, parent_id, level } = req.body;
  const requestedPermissions = [].concat(req.body.permissions || []);
  const permissions = JSON.stringify(slug === 'superadmin' ? allPermissionKeys() : requestedPermissions);

  try {
    if (!/^[a-z0-9_-]+$/.test(slug)) {
      const [availableRoles] = await pool.query(
        'SELECT id, name, level FROM roles WHERE id != ? ORDER BY level ASC, name ASC',
        [req.params.id]
      );
      return res.render('role_form', {
        role: { id: req.params.id, name, slug, description, parent_id, level: parseInt(level, 10) || 0, permissions: parsePermissions(permissions) },
        availableRoles,
        user: req.session.user,
        permissionLabels,
        error: 'Slug must contain only lowercase letters, numbers, hyphens, or underscores',
      });
    }

    await pool.query(
      'UPDATE roles SET name = ?, slug = ?, description = ?, parent_id = ?, level = ?, permissions = ? WHERE id = ?',
      [name, slug, description, parent_id || null, parseInt(level, 10) || 0, permissions, req.params.id]
    );

    res.redirect('/roles?success=Role+updated+successfully');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      const [availableRoles] = await pool.query(
        'SELECT id, name, level FROM roles WHERE id != ? ORDER BY level ASC, name ASC',
        [req.params.id]
      );
      return res.render('role_form', {
        role: { id: req.params.id, name, slug, description, parent_id, level: parseInt(level, 10) || 0, permissions: parsePermissions(permissions) },
        availableRoles,
        user: req.session.user,
        permissionLabels,
        error: 'A role with this name or slug already exists',
      });
    }
    console.error('Error updating role:', error);
    res.status(500).send('Unable to update role');
  }
});

app.post('/roles/delete/:id', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const [role] = await pool.query('SELECT slug FROM roles WHERE id = ?', [req.params.id]);
    if (role.length === 0) {
      return res.status(404).send('Role not found');
    }

    if (role[0].slug === 'superadmin') {
      return res.redirect('/roles?error=Cannot+delete+superadmin+role');
    }

    await pool.query('DELETE FROM user_roles WHERE role_id = ?', [req.params.id]);
    await pool.query('UPDATE roles SET parent_id = NULL WHERE parent_id = ?', [req.params.id]);
    await pool.query('DELETE FROM roles WHERE id = ?', [req.params.id]);
    res.redirect('/roles?success=Role+deleted+successfully');
  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(500).send('Unable to delete role');
  }
});

app.get('/roles/assign/:id', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const [roles] = await pool.query('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (roles.length === 0) {
      return res.status(404).send('Role not found');
    }

    const role = roles[0];
    const [allUsers] = await pool.query('SELECT u.id, u.name, u.email, u.role FROM users u ORDER BY u.name ASC');
    const [assignedUsers] = await pool.query('SELECT user_id FROM user_roles WHERE role_id = ?', [req.params.id]);
    const assignedUserIds = assignedUsers.map((assignedUser) => assignedUser.user_id);
    role.user_count = assignedUserIds.length;

    res.render('role_assign', {
      role,
      allUsers,
      assignedUserIds,
      user: req.session.user,
    });
  } catch (error) {
    console.error('Error loading assignment page:', error);
    res.status(500).send('Unable to load assignment page');
  }
});

app.post('/roles/assign-user', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  const { userId, roleId, assigned } = req.body;

  try {
    if (assigned === true || assigned === 'true') {
      await pool.query(
        'INSERT IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)',
        [userId, roleId, req.session.user.id]
      );
      return res.json({ success: true, message: 'User assigned to role' });
    }

    await pool.query('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?', [userId, roleId]);
    res.json({ success: true, message: 'User removed from role' });
  } catch (error) {
    console.error('Error updating assignment:', error);
    res.status(500).json({ success: false, message: 'Unable to update assignment' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.use((req, res) => {
  res.status(404).send('Page not found');
});

console.log(`Database config: ${JSON.stringify(pgPool.describeConfig())}`);

initDatabase()
  .then(() => {
    if (process.argv.includes('--sync-schema-only')) {
      console.log('Database schema sync completed.');
      return pgPool.end();
    }

    const server = app.listen(port, () => {
      console.log(`Server is running at http://localhost:${port}`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Stop the existing server or start this app with a different PORT.`);
        process.exit(1);
      }

      console.error('Server failed to start:', error);
      process.exit(1);
    });
  })
  .catch((error) => {
    console.error(`Failed to initialize database: ${pgPool.formatError(error)}`);
    if (error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  });
