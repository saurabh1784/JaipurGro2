const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pgPool = require('./db');
const {
  exportSnapshot,
  restoreSnapshot,
  restoreSnapshotOnStartup,
} = require('./databaseSnapshot');
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
const deliveryPersonRoutes = require('./routes/deliveryPersonRoutes');
const deliveryTypeRoutes = require('./routes/deliveryTypeRoutes');
const orderController = require('./controllers/orderController');
const walletController = require('./controllers/walletController');
const userController = require('./controllers/userController');
const managedProfileController = require('./controllers/managedProfileController');
const catalogController = require('./controllers/catalogController');
const commissionController = require('./controllers/commissionController');
const DeliveryCharge = require('./services/deliveryChargeService');
const {
  getInvoiceSettings,
  saveInvoiceSettings,
} = require('./services/invoiceSettingsService');
const Wallet = require('./models/Wallet');
const Product = require('./models/Product');
const Vendor = require('./models/Vendor');
const VendorProduct = require('./models/VendorProduct');
const User = require('./models/User');
const Order = require('./models/Order');
const Rating = require('./models/Rating');
const OrderWalletSettlement = require('./services/orderWalletSettlementService');
const Quotation = require('./models/Quotation');
const DeliveryPerson = require('./models/DeliveryPerson');
const Catalog = require('./models/Catalog');
const CommissionSetting = require('./models/CommissionSetting');
const LocationCommissionSetting = require('./models/LocationCommissionSetting');
const ProductSearch = require('./models/ProductSearch');
const Promotion = require('./models/Promotion');
const Advertisement = require('./models/Advertisement');
const SupportTicket = require('./models/SupportTicket');
const VendorCategoryRequest = require('./models/VendorCategoryRequest');
const AreaDefinition = require('./models/AreaDefinition');
const DeliveryType = require('./models/DeliveryType');
const { findOrCreateGoogleClient, publicGoogleConfig } = require('./services/googleClientAuthService');
const { firebaseAdminStatus } = require('./services/firebaseAdminService');
const {
  uploadBrandLogo,
  handleUploadError,
} = require('./middleware/brandLogoUpload');
const {
  uploadSubcategoryImage,
  handleSubcategoryImageUploadError,
} = require('./middleware/subcategoryImageUpload');
const {
  catalogSeed: groceryCatalogSeed,
  productSeeds: indianProductSeeds,
  genericProductLabels,
} = require('./data/indianCatalogSeed');
const {
  uploadPromotionImage,
  promotionImagePath,
  handlePromotionImageUploadError,
} = require('./middleware/promotionImageUpload');
const {
  uploadAdvertisementImage,
  advertisementImagePath,
  handleAdvertisementImageUploadError,
} = require('./middleware/advertisementImageUpload');
const {
  uploadVendorSignature,
  handleVendorSignatureUploadError,
} = require('./middleware/vendorSignatureUpload');
const {
  backfillMissingOrderNumbers,
  insertClientOrderWithOrderNumber,
} = require('./utils/orderNumber');
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
const manualBackupDir = path.join(__dirname, 'db-snapshots', 'manual');

function ensureManualBackupDir() {
  fs.mkdirSync(manualBackupDir, { recursive: true });
}

function backupFileName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `manual-backup-${stamp}.json`;
}

function isSafeBackupFileName(name) {
  return /^[-\w.]+\.json$/i.test(String(name || ''));
}

function manualBackupPath(name) {
  if (!isSafeBackupFileName(name)) {
    const error = new Error('Invalid backup file name');
    error.status = 400;
    throw error;
  }

  const resolved = path.resolve(manualBackupDir, name);
  const root = path.resolve(manualBackupDir);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error('Invalid backup file path');
    error.status = 400;
    throw error;
  }
  return resolved;
}

function listManualBackupFiles() {
  ensureManualBackupDir();
  return fs.readdirSync(manualBackupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isSafeBackupFileName(entry.name))
    .map((entry) => {
      const fullPath = path.join(manualBackupDir, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        size: stat.size,
        createdAt: stat.birthtime,
        updatedAt: stat.mtime,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

const uploadDatabaseBackup = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.json$/i.test(file.originalname || '') || file.mimetype === 'application/json') {
      return cb(null, true);
    }
    return cb(new Error('Only JSON database backup files are allowed'));
  },
});

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
  'advertisements.view': 'View Advertisements',
  'advertisements.create': 'Create Advertisements',
  'advertisements.edit': 'Edit Advertisements',
  'advertisements.delete': 'Delete Advertisements',
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
    permissions: ['dashboard.view', 'users.manage', 'roles.manage', 'clients.manage', 'vendors.manage', 'products.manage', 'wallets.view', 'wallets.manage', 'orders.manage', 'reports.view', 'discounts.view', 'discounts.create', 'discounts.edit', 'discounts.delete', 'coupons.view', 'coupons.create', 'coupons.edit', 'coupons.delete', 'coupons.apply', 'coupon_history.view', 'advertisements.view', 'advertisements.create', 'advertisements.edit', 'advertisements.delete', 'support.manage'],
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
    permissions: ['dashboard.view', 'wallets.view', 'orders.manage', 'advertisements.view', 'advertisements.create', 'advertisements.edit', 'support.manage'],
  },
  {
    name: 'Delivery Person',
    slug: 'deliveryperson',
    description: 'In-house delivery partner access for accepting, picking up, and delivering orders.',
    level: 3,
    permissions: ['dashboard.view', 'orders.manage', 'wallets.view'],
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

const roleFallbackDetails = {
  Admin: { name: 'API Admin', level: 1, permissions: ['dashboard.view', 'users.manage', 'roles.manage', 'clients.manage', 'vendors.manage', 'products.manage', 'wallets.view', 'wallets.manage', 'orders.manage', 'reports.view'] },
  Vendor: { name: 'Vendor', level: 5, permissions: ['dashboard.view', 'wallets.view'] },
  Client: { name: 'Client', level: 5, permissions: ['dashboard.view', 'wallets.view'] },
  superadmin: { name: 'Super Admin', level: 0, permissions: allPermissionKeys() },
  admin: { name: 'Admin', level: 1, permissions: ['dashboard.view', 'users.manage', 'roles.manage', 'clients.manage', 'vendors.manage', 'products.manage', 'wallets.view', 'wallets.manage', 'orders.manage', 'reports.view', 'advertisements.view', 'advertisements.create', 'advertisements.edit', 'advertisements.delete'] },
  manager: { name: 'Manager', level: 2, permissions: ['dashboard.view', 'clients.manage', 'vendors.manage', 'products.manage', 'orders.manage', 'reports.view'] },
  staff: { name: 'Staff', level: 3, permissions: ['dashboard.view', 'wallets.view', 'orders.manage', 'advertisements.view', 'advertisements.create', 'advertisements.edit', 'support.manage'] },
  deliveryPerson: { name: 'Delivery Person App', level: 3, permissions: ['dashboard.view', 'orders.manage', 'wallets.view'] },
  deliveryperson: { name: 'Delivery Person', level: 3, permissions: ['dashboard.view', 'orders.manage', 'wallets.view'] },
  'staff-l1': { name: 'Staff L1', level: 4, permissions: ['dashboard.view', 'products.manage', 'orders.manage', 'support.manage'] },
  'staff-l2': { name: 'Staff L2', level: 5, permissions: ['dashboard.view', 'clients.manage', 'vendors.manage', 'products.manage', 'orders.manage', 'wallets.view', 'support.manage'] },
  'staff-l3': { name: 'Staff L3', level: 6, permissions: ['dashboard.view', 'clients.manage', 'vendors.manage', 'products.manage', 'inventory.manage', 'orders.manage', 'wallets.view', 'wallets.manage', 'reports.view', 'support.manage'] },
  'support-staff': { name: 'Support Staff', level: 7, permissions: ['dashboard.view', 'clients.manage', 'vendors.manage', 'orders.manage', 'reports.view', 'support.manage'] },
  accountant: { name: 'Accountant', level: 8, permissions: ['dashboard.view', 'wallets.view', 'wallets.manage', 'orders.manage', 'reports.view'] },
};

function humanizeRoleSlug(slug) {
  return String(slug || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function fallbackRoleForSlug(slug) {
  const key = String(slug || '').trim();
  const details = roleFallbackDetails[key] || roleFallbackDetails[key.toLowerCase()] || {};
  return {
    name: details.name || humanizeRoleSlug(key),
    level: Number.isFinite(Number(details.level)) ? Number(details.level) : 9,
    permissions: Array.isArray(details.permissions) ? details.permissions : ['dashboard.view'],
  };
}

async function syncRolesFromUsers() {
  const deletedSlugs = new Set(await deletedRoleSlugs());
  const expectedSlugs = [
    ...roleSeeds.map((role) => role.slug),
    ...Object.keys(roleFallbackDetails),
  ];
  const [userRoleRows] = await pool.query(
    `SELECT DISTINCT role
     FROM users
     WHERE role IS NOT NULL AND TRIM(role) <> ''`
  );
  const slugs = [...new Set([...expectedSlugs, ...userRoleRows.map((row) => row.role)].filter(Boolean))]
    .filter((slug) => !deletedSlugs.has(String(slug)));

  for (const slug of slugs) {
    const seed = roleSeeds.find((role) => role.slug === slug);
    const fallback = seed || fallbackRoleForSlug(slug);
    await pool.query(
      `INSERT INTO roles (name, slug, description, level, permissions)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name,
           description = COALESCE(roles.description, EXCLUDED.description),
           level = COALESCE(roles.level, EXCLUDED.level),
           permissions = COALESCE(roles.permissions, EXCLUDED.permissions)`,
      [
        seed ? seed.name : fallback.name,
        slug,
        seed ? seed.description : `${fallback.name} role`,
        seed ? seed.level : fallback.level,
        JSON.stringify(seed ? seed.permissions : fallback.permissions),
      ]
    );
  }
}

const userSeeds = [
  { name: 'Super Admin', email: 'superadmin@example.com', password: 'admin123', role: 'superadmin' },
  { name: 'Admin User', email: 'admin@example.com', password: 'admin123', role: 'admin' },
  { name: 'API Admin', email: 'apiadmin@example.com', phone: '9000000000', password: 'admin123', role: 'Admin' },
  { name: 'Grocery Vendor 1', email: 'vendor1@example.com', phone: '9000000101', password: 'admin123', role: 'Vendor', business_name: 'Grocery Fresh Store', categoryNames: ['Grocery'], serviceNames: ['Home Delivery', 'Counter Pickup'] },
  { name: 'Stationery Vendor 2', email: 'vendor2@example.com', phone: '9000000102', password: 'admin123', role: 'Vendor', business_name: 'Stationery Point', categoryNames: ['Stationery'], serviceNames: ['Counter Pickup'] },
  { name: 'Mixed Vendor 3', email: 'vendor3@example.com', phone: '9000000103', password: 'admin123', role: 'Vendor', business_name: 'Grocery Stationery Hub', categoryNames: ['Grocery', 'Stationery', 'Pet Care'], serviceNames: ['Home Delivery', 'Counter Pickup', 'Wholesale Supply'] },
  { name: 'Grocery Vendor 4', email: 'vendor4@example.com', phone: '9000000104', password: 'admin123', role: 'Vendor', business_name: 'Daily Grocery Mart', categoryNames: ['Grocery'], serviceNames: ['Home Delivery'] },
  { name: 'Mixed Vendor 5', email: 'vendor5@example.com', phone: '9000000105', password: 'admin123', role: 'Vendor', business_name: 'Wholesale Supply Center', categoryNames: ['Grocery', 'Stationery', 'Pet Care'], serviceNames: ['Home Delivery', 'Counter Pickup', 'Wholesale Supply'] },
  { name: 'Demo Client', email: 'client@example.com', phone: '9000000002', password: 'admin123', role: 'Client' },
  { name: 'Store Manager', email: 'manager@example.com', password: 'admin123', role: 'manager' },
  { name: 'Order Staff', email: 'staff@example.com', password: 'admin123', role: 'staff' },
  { name: 'Santosh Nayak', email: 'delivery@example.com', phone: '9000000003', password: 'admin123', role: 'deliveryPerson', city: 'Jaipur', area: '*', vehicle_type: 'Bike', vehicle_number: 'RJ14DP0003' },
  { name: 'Delivery Partner One', email: 'delivery1@example.com', phone: '9000000004', password: 'admin123', role: 'deliveryPerson', city: 'Jaipur', area: 'Malviya Nagar', vehicle_type: 'Bike', vehicle_number: 'RJ14DP0001' },
  { name: 'Delivery Partner Two', email: 'delivery2@example.com', phone: '9000000005', password: 'admin123', role: 'deliveryPerson', city: 'Jaipur', area: 'Vaishali Nagar', vehicle_type: 'Scooter', vehicle_number: 'RJ14DP0002' },
];

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/default.png', (req, res) => {
  const defaultPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAEklEQVR4nGNkYPjPgASYGFABqgE/BuZX43gAAAAASUVORK5CYII=';
  res.type('image/png').send(Buffer.from(defaultPng, 'base64'));
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

  return res.redirect('/settings?error=Only%20admin%20users%20can%20run%20maintenance%20actions');
}

function requireAdminCommission(req, res, next) {
  const currentUser = req.authUser || (req.session && req.session.user);
  if (isSuperAdminUser(currentUser) || ['admin', 'superadmin'].includes(String(currentUser && currentUser.role || '').toLowerCase())) {
    return next();
  }

  if (requestWantsJson(req)) {
    return res.status(403).json({ success: false, message: 'Only Admin and Super Admin users can manage commission settings' });
  }

  return res.redirect('/settings?error=Only%20Admin%20and%20Super%20Admin%20users%20can%20manage%20commission%20settings');
}

function requireAdminWalletTransactions(req, res, next) {
  const currentUser = req.authUser || (req.session && req.session.user);
  if (walletController.isAdminWalletUser(currentUser)) {
    return next();
  }

  if (requestWantsJson(req)) {
    return res.status(403).json({ success: false, message: 'Only Admin users can access admin wallet transactions' });
  }

  return res.status(403).render('dashboard', {
    user: currentUser,
    dashboard: buildDashboard(currentUser, req.path),
    error: 'Only Admin users can access Admin Wallet Transactions.',
  });
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

async function deletedRoleSlugs() {
  try {
    const raw = await settingValue('deleted_role_slugs', '[]');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map((slug) => String(slug)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function rememberDeletedRoleSlug(slug) {
  const value = String(slug || '').trim();
  if (!value) return;
  const slugs = new Set(await deletedRoleSlugs());
  slugs.add(value);
  await saveSetting('deleted_role_slugs', JSON.stringify([...slugs]), false);
}

async function forgetDeletedRoleSlug(slug) {
  const value = String(slug || '').trim();
  if (!value) return;
  const slugs = (await deletedRoleSlugs()).filter((existing) => existing !== value);
  await saveSetting('deleted_role_slugs', JSON.stringify(slugs), false);
}

function formatRupees(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

async function notifyClientBidUpdate(response) {
  if (!response || !response.clientId || !response.quotationId) return;
  const message = `Quotation #${response.quotationId} has a new bid update. New bid price: ${formatRupees(response.totalAmount)}`;
  await pool.query(
    `INSERT INTO user_notifications (user_id, title, message, link)
     VALUES (?, ?, ?, ?)`,
    [
      response.clientId,
      response.isUpdate ? 'Quotation bid updated' : 'New quotation bid',
      message,
      `/client/quotations?recipient_id=${response.recipientId}`,
    ]
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

let uploadedProductImageFiles;

function uploadedProductImagePath(productName) {
  if (!uploadedProductImageFiles) {
    const uploadDir = path.join(__dirname, 'public', 'uploads', 'products');
    try {
      uploadedProductImageFiles = fs
        .readdirSync(uploadDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name));
    } catch {
      uploadedProductImageFiles = [];
    }
  }

  const productSlug = slugify(productName);
  const file = uploadedProductImageFiles.find((name) => (
    name.toLowerCase().startsWith(`${productSlug}-`)
  ));
  return file ? `/uploads/products/${file}` : null;
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

async function backfillVendorMainCategories() {
  await pool.query(`
    INSERT INTO vendor_categories (vendor_id, category_id)
    SELECT u.id, c.id
    FROM users u
    INNER JOIN categories c ON c.is_deleted = 0 AND c.status = 'active'
    LEFT JOIN vendor_categories existing ON existing.vendor_id = u.id
    WHERE u.role = 'Vendor'
      AND u.is_deleted = 0
      AND existing.vendor_id IS NULL
    ON CONFLICT (vendor_id, category_id) DO NOTHING
  `);
}

async function removeGeneratedDemoProducts() {
  if (!genericProductLabels.length) return;
  const conditions = genericProductLabels.map(() => 'p.name LIKE ?').join(' OR ');
  const params = genericProductLabels.map((label) => `% ${label}`);
  await pool.query(
    `UPDATE products p
     SET is_deleted = 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE p.is_deleted = 0
       AND (${conditions})`,
    params
  );
}

async function seedIndianProducts() {
  const [adminRows] = await pool.query(
    "SELECT id FROM users WHERE email = ? AND LOWER(role) IN ('admin', 'superadmin') AND is_deleted = 0 ORDER BY id ASC LIMIT 1",
    ['admin@example.com']
  );
  const adminId = adminRows[0] ? adminRows[0].id : null;

  await removeGeneratedDemoProducts();

  for (const product of indianProductSeeds) {
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
      console.warn(`Skipping Indian product seed, missing catalog relation: ${product.name}`);
      continue;
    }

    const relation = relationRows[0];
    const [existingRows] = await pool.query('SELECT id FROM products WHERE name = ? LIMIT 1', [product.name]);

    const imageUrl = uploadedProductImagePath(product.name) || '/default.png';
    const productValues = [
      product.description,
      product.price,
      product.weightValue,
      product.weightUnit,
      product.weightKg,
      imageUrl,
      product.taxName || 'GST',
      product.taxPercentage ?? 5,
      relation.category_id,
      relation.sub_category_id,
      relation.brand_id,
      adminId,
    ];

    if (existingRows.length) {
      await pool.query(
        `UPDATE products
         SET description = ?,
             price = ?,
             weight_value = ?,
             weight_unit = ?,
             weight_kg = ?,
             image_url = CASE
               WHEN NULLIF(NULLIF(image_url, ''), '/default.png') IS NULL THEN ?
               ELSE image_url
             END,
             tax_name = ?,
             tax_percentage = ?,
             category_id = ?,
             sub_category_id = ?,
             brand_id = ?,
             approval_status = 'approved',
             approved_by = ?,
             approved_at = CURRENT_TIMESTAMP,
             rejection_reason = NULL,
             is_deleted = 0
         WHERE id = ?`,
        [...productValues, existingRows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO products
         (name, description, price, weight_value, weight_unit, weight_kg, image_url,
          tax_name, tax_percentage, category_id, sub_category_id, brand_id,
          approval_status, approved_by, approved_at, rejection_reason, is_deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP, NULL, 0)`,
        [product.name, ...productValues]
      );
    }
  }
}

async function initDatabase(options = {}) {
  const { restoreSnapshot = true } = options;
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
      order_id INT UNSIGNED DEFAULT NULL,
      type VARCHAR(20) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      balance_before DECIMAL(12,2) NOT NULL,
      balance_after DECIMAL(12,2) NOT NULL,
      reference VARCHAR(120) DEFAULT NULL,
      note TEXT DEFAULT NULL,
      component VARCHAR(60) DEFAULT NULL,
      ledger_key VARCHAR(190) DEFAULT NULL,
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
  await addColumnIfMissing('wallet_transactions', 'order_id', 'INT UNSIGNED DEFAULT NULL AFTER user_id');
  await addColumnIfMissing('wallet_transactions', 'component', 'VARCHAR(60) DEFAULT NULL AFTER note');
  await addColumnIfMissing('wallet_transactions', 'ledger_key', 'VARCHAR(190) DEFAULT NULL AFTER component');
  await addUniqueIndexIfMissing('wallet_transactions', 'idx_wallet_transactions_ledger_key_unique', 'ledger_key');
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
      signature_path VARCHAR(255) DEFAULT NULL,
      address TEXT DEFAULT NULL,
      pickup_latitude DECIMAL(10,7) DEFAULT NULL,
      pickup_longitude DECIMAL(10,7) DEFAULT NULL,
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
  await addColumnIfMissing('vendor_profiles', 'pickup_latitude', 'DECIMAL(10,7) DEFAULT NULL AFTER address');
  await addColumnIfMissing('vendor_profiles', 'pickup_longitude', 'DECIMAL(10,7) DEFAULT NULL AFTER pickup_latitude');
  await addColumnIfMissing('vendor_profiles', 'state', 'VARCHAR(80) DEFAULT NULL AFTER country');
  await addColumnIfMissing('vendor_profiles', 'city', 'VARCHAR(80) DEFAULT NULL AFTER state');
  await addColumnIfMissing('vendor_profiles', 'area', 'VARCHAR(120) DEFAULT NULL AFTER city');
  await addColumnIfMissing('vendor_profiles', 'logo_path', 'VARCHAR(255) DEFAULT NULL AFTER business_name');
  await addColumnIfMissing('vendor_profiles', 'storefront_image_path', 'VARCHAR(255) DEFAULT NULL AFTER logo_path');
  await addColumnIfMissing('vendor_profiles', 'signature_path', 'VARCHAR(255) DEFAULT NULL AFTER storefront_image_path');

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
  await addColumnIfMissing('client_profiles', 'area', 'VARCHAR(120) DEFAULT NULL AFTER city');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_delivery_addresses (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      label VARCHAR(80) NOT NULL DEFAULT 'Home',
      recipient_name VARCHAR(120) DEFAULT NULL,
      phone VARCHAR(30) DEFAULT NULL,
      address TEXT NOT NULL,
      area VARCHAR(120) DEFAULT NULL,
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
  await addColumnIfMissing('client_delivery_addresses', 'area', 'VARCHAR(120) DEFAULT NULL AFTER address');
  await addColumnIfMissing('client_delivery_addresses', 'latitude', 'DECIMAL(10,7) DEFAULT NULL AFTER pincode');
  await addColumnIfMissing('client_delivery_addresses', 'longitude', 'DECIMAL(10,7) DEFAULT NULL AFTER latitude');

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
      image_path VARCHAR(255) DEFAULT NULL,
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
  await addColumnIfMissing('sub_categories', 'image_path', 'VARCHAR(255) DEFAULT NULL AFTER slug');
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
      weight_value DECIMAL(10,3) NOT NULL DEFAULT 0.000,
      weight_unit VARCHAR(20) NOT NULL DEFAULT 'kg',
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
  await addColumnIfMissing('products', 'weight_unit', "VARCHAR(20) NOT NULL DEFAULT 'kg' AFTER price");
  await addColumnIfMissing('products', 'weight_value', 'DECIMAL(10,3) NOT NULL DEFAULT 0.000 AFTER price');
  await addColumnIfMissing('products', 'tax_name', 'VARCHAR(80) DEFAULT NULL AFTER image_url');
  await addColumnIfMissing('products', 'tax_percentage', 'DECIMAL(7,2) DEFAULT NULL AFTER tax_name');
  await addColumnIfMissing('products', 'approval_status', "VARCHAR(20) NOT NULL DEFAULT 'approved' AFTER is_deleted");
  await addColumnIfMissing('products', 'created_by_vendor_id', 'INT UNSIGNED DEFAULT NULL AFTER approval_status');
  await addColumnIfMissing('products', 'approved_by', 'INT UNSIGNED DEFAULT NULL AFTER created_by_vendor_id');
  await addColumnIfMissing('products', 'approved_at', 'TIMESTAMP NULL DEFAULT NULL AFTER approved_by');
  await addColumnIfMissing('products', 'rejection_reason', 'TEXT DEFAULT NULL AFTER approved_at');
  await pool.query("UPDATE products SET approval_status = 'approved' WHERE approval_status IS NULL OR approval_status = ''");
  await pool.query("UPDATE products SET weight_unit = 'kg' WHERE weight_unit IS NULL OR TRIM(weight_unit) = ''");
  await pool.query('UPDATE products SET weight_value = weight_kg WHERE COALESCE(weight_value, 0) = 0 AND COALESCE(weight_kg, 0) > 0');

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
    CREATE TABLE IF NOT EXISTS vendor_categories (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      vendor_id INT UNSIGNED NOT NULL,
      category_id INT UNSIGNED NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_vendor_category (vendor_id, category_id),
      KEY idx_vendor_categories_category (category_id),
      CONSTRAINT fk_vendor_categories_vendor FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_vendor_categories_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendor_category_requests (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      vendor_id INT UNSIGNED NOT NULL,
      category_id INT UNSIGNED NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      note TEXT DEFAULT NULL,
      admin_note TEXT DEFAULT NULL,
      decided_by INT UNSIGNED DEFAULT NULL,
      decided_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_vendor_category_request_vendor (vendor_id, status),
      KEY idx_vendor_category_request_category (category_id),
      CONSTRAINT fk_vendor_category_requests_vendor FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_vendor_category_requests_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      CONSTRAINT fk_vendor_category_requests_decider FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    DROP INDEX IF EXISTS uniq_pending_vendor_category_request
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_vendor_category_request_category
    ON vendor_category_requests (vendor_id, category_id)
    WHERE status = 'pending'
  `);
  await pool.query(`
    INSERT INTO vendor_categories (vendor_id, category_id)
    SELECT u.id, c.id
    FROM users u
    INNER JOIN categories c ON c.is_deleted = 0 AND c.status = 'active'
    LEFT JOIN vendor_categories existing ON existing.vendor_id = u.id
    WHERE u.role = 'Vendor'
      AND u.is_deleted = 0
      AND existing.vendor_id IS NULL
    ON CONFLICT (vendor_id, category_id) DO NOTHING
  `);

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
       order_number VARCHAR(10) DEFAULT NULL,
       user_id INT UNSIGNED NOT NULL,
       vendor_id INT UNSIGNED DEFAULT NULL,
       total_amount DECIMAL(12,2) NOT NULL,
       status VARCHAR(20) NOT NULL DEFAULT 'pending',
       delivery_status VARCHAR(20) NOT NULL DEFAULT 'pending',
       delivery_partner_id INT UNSIGNED DEFAULT NULL,
       delivery_otp VARCHAR(10) DEFAULT NULL,
       pickup_otp VARCHAR(10) DEFAULT NULL,
       auto_delivery_offer_id INT UNSIGNED DEFAULT NULL,
       client_name VARCHAR(100) DEFAULT NULL,
       client_phone VARCHAR(30) DEFAULT NULL,
       client_address TEXT DEFAULT NULL,
       shipping_address_id INT UNSIGNED DEFAULT NULL,
       shipping_name VARCHAR(120) DEFAULT NULL,
       shipping_phone VARCHAR(30) DEFAULT NULL,
       shipping_address TEXT DEFAULT NULL,
       shipping_area VARCHAR(120) DEFAULT NULL,
       shipping_city VARCHAR(80) DEFAULT NULL,
       shipping_state VARCHAR(80) DEFAULT NULL,
       shipping_country VARCHAR(80) DEFAULT NULL,
       shipping_pincode VARCHAR(20) DEFAULT NULL,
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
       order_number VARCHAR(10) DEFAULT NULL,
       user_id INT UNSIGNED NOT NULL,
       vendor_id INT UNSIGNED DEFAULT NULL,
       total_amount DECIMAL(12,2) NOT NULL,
       status VARCHAR(20) NOT NULL DEFAULT 'pending',
       delivery_status VARCHAR(20) NOT NULL DEFAULT 'pending',
       delivery_partner_id INT UNSIGNED DEFAULT NULL,
       delivery_otp VARCHAR(10) DEFAULT NULL,
       pickup_otp VARCHAR(10) DEFAULT NULL,
       auto_delivery_offer_id INT UNSIGNED DEFAULT NULL,
       client_name VARCHAR(100) DEFAULT NULL,
       client_phone VARCHAR(30) DEFAULT NULL,
       client_address TEXT DEFAULT NULL,
       shipping_address_id INT UNSIGNED DEFAULT NULL,
       shipping_name VARCHAR(120) DEFAULT NULL,
       shipping_phone VARCHAR(30) DEFAULT NULL,
       shipping_address TEXT DEFAULT NULL,
       shipping_area VARCHAR(120) DEFAULT NULL,
       shipping_city VARCHAR(80) DEFAULT NULL,
       shipping_state VARCHAR(80) DEFAULT NULL,
       shipping_country VARCHAR(80) DEFAULT NULL,
       shipping_pincode VARCHAR(20) DEFAULT NULL,
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
  await addColumnIfMissing('client_orders', 'order_number', 'VARCHAR(10) DEFAULT NULL AFTER id');
   await addColumnIfMissing('client_orders', 'vendor_id', 'INT UNSIGNED DEFAULT NULL AFTER user_id');
  await addColumnIfMissing('client_orders', 'delivery_status', "VARCHAR(20) NOT NULL DEFAULT 'pending' AFTER status");
  await addColumnIfMissing('client_orders', 'delivery_partner_id', 'INT UNSIGNED DEFAULT NULL AFTER delivery_status');
  await addColumnIfMissing('client_orders', 'external_delivery_provider_id', 'INT UNSIGNED DEFAULT NULL AFTER delivery_partner_id');
  await addColumnIfMissing('client_orders', 'external_delivery_provider_name', 'VARCHAR(120) DEFAULT NULL AFTER external_delivery_provider_id');
  await addColumnIfMissing('client_orders', 'delivery_otp', 'VARCHAR(10) DEFAULT NULL AFTER delivery_partner_id');
  await addColumnIfMissing('client_orders', 'delivery_otp_attempts', 'INT NOT NULL DEFAULT 0 AFTER delivery_otp');
  await addColumnIfMissing('client_orders', 'delivery_otp_locked_at', 'TIMESTAMP NULL DEFAULT NULL AFTER delivery_otp_attempts');
  await addColumnIfMissing('client_orders', 'delivery_otp_verified_at', 'TIMESTAMP NULL DEFAULT NULL AFTER delivery_otp_locked_at');
  await addColumnIfMissing('client_orders', 'pickup_otp', 'VARCHAR(10) DEFAULT NULL AFTER delivery_otp');
  await addColumnIfMissing('client_orders', 'auto_delivery_offer_id', 'INT UNSIGNED DEFAULT NULL AFTER pickup_otp');
  await addColumnIfMissing('client_orders', 'otp_set_by', 'INT UNSIGNED DEFAULT NULL AFTER delivery_otp');
  await addColumnIfMissing('client_orders', 'otp_set_at', 'TIMESTAMP NULL DEFAULT NULL AFTER otp_set_by');
  await addColumnIfMissing('client_orders', 'client_name', 'VARCHAR(100) DEFAULT NULL AFTER delivery_otp');
   await addColumnIfMissing('client_orders', 'client_phone', 'VARCHAR(30) DEFAULT NULL AFTER client_name');
  await addColumnIfMissing('client_orders', 'client_address', 'TEXT DEFAULT NULL AFTER client_phone');
  await addColumnIfMissing('client_orders', 'shipping_address_id', 'INT UNSIGNED DEFAULT NULL AFTER client_address');
  await addColumnIfMissing('client_orders', 'shipping_name', 'VARCHAR(120) DEFAULT NULL AFTER shipping_address_id');
  await addColumnIfMissing('client_orders', 'shipping_phone', 'VARCHAR(30) DEFAULT NULL AFTER shipping_name');
  await addColumnIfMissing('client_orders', 'shipping_address', 'TEXT DEFAULT NULL AFTER shipping_phone');
  await addColumnIfMissing('client_orders', 'shipping_area', 'VARCHAR(120) DEFAULT NULL AFTER shipping_address');
  await addColumnIfMissing('client_orders', 'shipping_city', 'VARCHAR(80) DEFAULT NULL AFTER shipping_address');
  await addColumnIfMissing('client_orders', 'shipping_state', 'VARCHAR(80) DEFAULT NULL AFTER shipping_city');
  await addColumnIfMissing('client_orders', 'shipping_country', 'VARCHAR(80) DEFAULT NULL AFTER shipping_state');
  await addColumnIfMissing('client_orders', 'shipping_pincode', 'VARCHAR(20) DEFAULT NULL AFTER shipping_country');
  await addColumnIfMissing('client_orders', 'shipping_latitude', 'DECIMAL(10,7) DEFAULT NULL AFTER shipping_pincode');
  await addColumnIfMissing('client_orders', 'shipping_longitude', 'DECIMAL(10,7) DEFAULT NULL AFTER shipping_latitude');
  await addColumnIfMissing('client_orders', 'delivery_method', "VARCHAR(30) NOT NULL DEFAULT 'partner' AFTER delivery_partner_id");
  await addColumnIfMissing('client_orders', 'delivery_type', "VARCHAR(40) DEFAULT NULL AFTER delivery_method");
  await addColumnIfMissing('client_orders', 'assigned_at', 'TIMESTAMP NULL DEFAULT NULL AFTER shipping_pincode');
  await addColumnIfMissing('client_orders', 'ready_at', 'TIMESTAMP NULL DEFAULT NULL AFTER assigned_at');
  await addColumnIfMissing('client_orders', 'delivered_at', 'TIMESTAMP NULL DEFAULT NULL AFTER ready_at');
  await addColumnIfMissing('client_orders', 'status_updated_at', 'TIMESTAMP NULL DEFAULT NULL AFTER updated_at');
  await addColumnIfMissing('client_orders', 'subtotal_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER vendor_id');
  await addColumnIfMissing('client_orders', 'discount_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER subtotal_amount');
  await addColumnIfMissing('client_orders', 'savings_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER discount_amount');
  await addColumnIfMissing('client_orders', 'delivery_charge', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER savings_amount');
  await addColumnIfMissing('client_orders', 'platform_fee', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER delivery_charge');
  await addColumnIfMissing('client_orders', 'order_commission_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER platform_fee');
  await addColumnIfMissing('client_orders', 'delivery_commission_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER order_commission_amount');
  await addColumnIfMissing('client_orders', 'area_definition_id', 'INT UNSIGNED DEFAULT NULL AFTER shipping_longitude');
  await addColumnIfMissing('client_orders', 'area_pricing_snapshot', 'JSON DEFAULT NULL AFTER area_definition_id');
  await addColumnIfMissing('client_orders', 'platform_charge', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER delivery_charge');
  await addColumnIfMissing('client_orders', 'vendor_earning', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER platform_charge');
  await addColumnIfMissing('client_orders', 'delivery_earning', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER vendor_earning');
  await addColumnIfMissing('client_orders', 'wallet_settled_at', 'TIMESTAMP NULL DEFAULT NULL AFTER delivery_earning');
  await addColumnIfMissing('client_orders', 'delivery_wallet_settled_at', 'TIMESTAMP NULL DEFAULT NULL AFTER wallet_settled_at');
  await addColumnIfMissing('client_orders', 'coupon_id', 'INT UNSIGNED DEFAULT NULL AFTER delivery_charge');
  await addColumnIfMissing('client_orders', 'coupon_code', 'VARCHAR(80) DEFAULT NULL AFTER coupon_id');
  await addColumnIfMissing('client_orders', 'discount_id', 'INT UNSIGNED DEFAULT NULL AFTER coupon_code');
  await addColumnIfMissing('client_orders', 'discount_label', 'VARCHAR(150) DEFAULT NULL AFTER discount_id');
  await addColumnIfMissing('client_orders', 'order_type', "VARCHAR(20) NOT NULL DEFAULT 'direct' AFTER discount_label");
  await addColumnIfMissing('client_orders', 'invoice_number', 'VARCHAR(80) DEFAULT NULL AFTER order_type');
  await addColumnIfMissing('client_orders', 'invoice_pdf_path', 'VARCHAR(255) DEFAULT NULL AFTER invoice_number');
  await addColumnIfMissing('client_orders', 'invoice_generated_at', 'TIMESTAMP NULL DEFAULT NULL AFTER invoice_pdf_path');
  await pool.query('UPDATE client_orders SET subtotal_amount = total_amount WHERE subtotal_amount = 0 AND total_amount > 0');
  await backfillMissingOrderNumbers(pool);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_client_orders_order_number
    ON client_orders (order_number)
    WHERE order_number IS NOT NULL
  `);
  await pool.query(`
    UPDATE client_orders
    SET shipping_name = COALESCE(NULLIF(shipping_name, ''), client_name),
        shipping_phone = COALESCE(NULLIF(shipping_phone, ''), client_phone),
        shipping_address = COALESCE(NULLIF(shipping_address, ''), client_address)
    WHERE shipping_address IS NULL OR TRIM(shipping_address) = ''
  `);

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
    CREATE TABLE IF NOT EXISTS advertisements (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      title VARCHAR(160) NOT NULL,
      description TEXT DEFAULT NULL,
      image_path VARCHAR(255) DEFAULT NULL,
      start_at TIMESTAMP NULL DEFAULT NULL,
      end_at TIMESTAMP NULL DEFAULT NULL,
      countdown_seconds INT UNSIGNED NOT NULL DEFAULT 5,
      target_platforms JSON DEFAULT NULL,
      city_scope VARCHAR(20) NOT NULL DEFAULT 'all',
      city VARCHAR(120) DEFAULT NULL,
      areas JSON DEFAULT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      advertiser_name VARCHAR(150) DEFAULT NULL,
      advertiser_email VARCHAR(150) DEFAULT NULL,
      advertiser_phone VARCHAR(40) DEFAULT NULL,
      package_name VARCHAR(120) DEFAULT NULL,
      payment_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      invoice_number VARCHAR(80) DEFAULT NULL,
      receipt_path VARCHAR(255) DEFAULT NULL,
      approval_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      campaign_start_at TIMESTAMP NULL DEFAULT NULL,
      campaign_end_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_advertisements_status_dates (status, start_at, end_at),
      KEY idx_advertisements_payment_approval (payment_status, approval_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('advertisements', 'target_platforms', 'JSON DEFAULT NULL AFTER countdown_seconds');
  await addColumnIfMissing('advertisements', 'city_scope', "VARCHAR(20) NOT NULL DEFAULT 'all' AFTER target_platforms");
  await addColumnIfMissing('advertisements', 'city', 'VARCHAR(120) DEFAULT NULL AFTER city_scope');
  await addColumnIfMissing('advertisements', 'areas', 'JSON DEFAULT NULL AFTER city');
  await addColumnIfMissing('advertisements', 'advertiser_name', 'VARCHAR(150) DEFAULT NULL AFTER status');
  await addColumnIfMissing('advertisements', 'advertiser_email', 'VARCHAR(150) DEFAULT NULL AFTER advertiser_name');
  await addColumnIfMissing('advertisements', 'advertiser_phone', 'VARCHAR(40) DEFAULT NULL AFTER advertiser_email');
  await addColumnIfMissing('advertisements', 'package_name', 'VARCHAR(120) DEFAULT NULL AFTER advertiser_phone');
  await addColumnIfMissing('advertisements', 'payment_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER package_name');
  await addColumnIfMissing('advertisements', 'payment_status', "VARCHAR(20) NOT NULL DEFAULT 'pending' AFTER payment_amount");
  await addColumnIfMissing('advertisements', 'invoice_number', 'VARCHAR(80) DEFAULT NULL AFTER payment_status');
  await addColumnIfMissing('advertisements', 'receipt_path', 'VARCHAR(255) DEFAULT NULL AFTER invoice_number');
  await addColumnIfMissing('advertisements', 'approval_status', "VARCHAR(20) NOT NULL DEFAULT 'pending' AFTER receipt_path");
  await addColumnIfMissing('advertisements', 'campaign_start_at', 'TIMESTAMP NULL DEFAULT NULL AFTER approval_status');
  await addColumnIfMissing('advertisements', 'campaign_end_at', 'TIMESTAMP NULL DEFAULT NULL AFTER campaign_start_at');

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
      area VARCHAR(120) NOT NULL DEFAULT '*',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_delivery_partner_city_area (user_id, city, area),
      KEY idx_delivery_partner_city (city, is_active),
      CONSTRAINT fk_delivery_partner_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('delivery_partner_settings', 'area', "VARCHAR(120) NOT NULL DEFAULT '*' AFTER city");
  await pool.query('ALTER TABLE delivery_partner_settings DROP CONSTRAINT IF EXISTS uniq_delivery_partner_city');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS uniq_delivery_partner_city_area ON delivery_partner_settings (user_id, city, area)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS external_delivery_providers (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(80) NOT NULL,
      phone VARCHAR(40) DEFAULT NULL,
      email VARCHAR(160) DEFAULT NULL,
      city VARCHAR(120) NOT NULL DEFAULT '*',
      area VARCHAR(150) NOT NULL DEFAULT '*',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_external_delivery_provider_area (slug, city, area),
      KEY idx_external_delivery_provider_area (city, area, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('external_delivery_providers', 'phone', 'VARCHAR(40) DEFAULT NULL AFTER slug');
  await addColumnIfMissing('external_delivery_providers', 'email', 'VARCHAR(160) DEFAULT NULL AFTER phone');
  await addColumnIfMissing('external_delivery_providers', 'city', "VARCHAR(120) NOT NULL DEFAULT '*' AFTER email");
  await addColumnIfMissing('external_delivery_providers', 'area', "VARCHAR(150) NOT NULL DEFAULT '*' AFTER city");
  await addColumnIfMissing('external_delivery_providers', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER area');
  await pool.query(`
    INSERT INTO external_delivery_providers (name, slug, city, area, is_active)
    VALUES
      ('Porter', 'porter', '*', '*', 1),
      ('Wahaak', 'wahaak', '*', '*', 1)
    ON CONFLICT (slug, city, area) DO NOTHING
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS delivery_person_profiles (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      city VARCHAR(100) DEFAULT NULL,
      area VARCHAR(120) NOT NULL DEFAULT '*',
      address TEXT DEFAULT NULL,
      address_proof_id VARCHAR(120) DEFAULT NULL,
      address_proof_type VARCHAR(80) DEFAULT NULL,
      profile_image_path VARCHAR(255) DEFAULT NULL,
      vehicle_type VARCHAR(60) DEFAULT NULL,
      vehicle_number VARCHAR(80) DEFAULT NULL,
      document_notes TEXT DEFAULT NULL,
      is_available TINYINT(1) NOT NULL DEFAULT 1,
      current_latitude DECIMAL(10,7) DEFAULT NULL,
      current_longitude DECIMAL(10,7) DEFAULT NULL,
      last_seen_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_delivery_person_profile_user (user_id),
      KEY idx_delivery_person_profile_city_vehicle (city, vehicle_type),
      CONSTRAINT fk_delivery_person_profile_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('delivery_person_profiles', 'area', "VARCHAR(120) NOT NULL DEFAULT '*' AFTER city");
  await addColumnIfMissing('delivery_person_profiles', 'profile_image_path', 'VARCHAR(255) DEFAULT NULL AFTER address_proof_type');
  await addColumnIfMissing('delivery_person_profiles', 'is_available', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER document_notes');
  await addColumnIfMissing('delivery_person_profiles', 'current_latitude', 'DECIMAL(10,7) DEFAULT NULL AFTER is_available');
  await addColumnIfMissing('delivery_person_profiles', 'current_longitude', 'DECIMAL(10,7) DEFAULT NULL AFTER current_latitude');
  await addColumnIfMissing('delivery_person_profiles', 'last_seen_at', 'TIMESTAMP NULL DEFAULT NULL AFTER current_longitude');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS delivery_person_activity_logs (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      delivery_person_id INT UNSIGNED NOT NULL,
      actor_id INT UNSIGNED DEFAULT NULL,
      action VARCHAR(80) NOT NULL,
      description TEXT NOT NULL,
      metadata JSON DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_delivery_activity_person_date (delivery_person_id, created_at),
      KEY idx_delivery_activity_action (action),
      CONSTRAINT fk_delivery_activity_person FOREIGN KEY (delivery_person_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_delivery_activity_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS delivery_order_offers (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id INT UNSIGNED NOT NULL,
      delivery_person_id INT UNSIGNED NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      pickup_area VARCHAR(180) DEFAULT NULL,
      delivery_area VARCHAR(180) DEFAULT NULL,
      delivery_charge DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      platform_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      delivery_partner_earning DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      notification_payload JSON DEFAULT NULL,
      response_note TEXT DEFAULT NULL,
      expires_at TIMESTAMP NULL DEFAULT NULL,
      responded_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_delivery_offer_person_status (delivery_person_id, status),
      KEY idx_delivery_offer_order (order_id),
      CONSTRAINT fk_delivery_offer_order FOREIGN KEY (order_id) REFERENCES client_orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_delivery_offer_person FOREIGN KEY (delivery_person_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('delivery_order_offers', 'delivery_charge', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER delivery_area');
  await addColumnIfMissing('delivery_order_offers', 'platform_fee', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER delivery_charge');
  await addColumnIfMissing('delivery_order_offers', 'delivery_partner_earning', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER platform_fee');
  await addColumnIfMissing('delivery_order_offers', 'notification_payload', 'JSON DEFAULT NULL AFTER delivery_partner_earning');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_ratings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id INT UNSIGNED NOT NULL,
      client_id INT UNSIGNED NOT NULL,
      subject_type VARCHAR(30) NOT NULL,
      subject_id INT UNSIGNED NOT NULL,
      overall_rating SMALLINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_order_rating_subject (order_id, client_id, subject_type),
      KEY idx_order_rating_subject (subject_type, subject_id),
      CONSTRAINT fk_order_rating_order FOREIGN KEY (order_id) REFERENCES client_orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_order_rating_client FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_order_rating_subject FOREIGN KEY (subject_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_rating_categories (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      rating_id INT UNSIGNED NOT NULL,
      category_key VARCHAR(60) NOT NULL,
      score SMALLINT NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_rating_category (rating_id, category_key),
      KEY idx_rating_category_key (category_key),
      CONSTRAINT fk_rating_category_rating FOREIGN KEY (rating_id) REFERENCES order_ratings(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    INSERT INTO delivery_person_profiles (user_id, city)
    SELECT u.id, MIN(dps.city)
    FROM users u INNER JOIN delivery_partner_settings dps ON dps.user_id = u.id
    LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
    WHERE LOWER(u.role) = 'deliveryperson' AND u.is_deleted = 0 AND dpp.id IS NULL
    GROUP BY u.id
    ON CONFLICT (user_id) DO NOTHING
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS area_definitions (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(150) NOT NULL,
      city VARCHAR(80) DEFAULT NULL,
      polygon JSON NOT NULL,
      center_lat DECIMAL(10,7) DEFAULT NULL,
      center_lng DECIMAL(10,7) DEFAULT NULL,
      platform_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      delivery_charge DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      order_commission_percentage DECIMAL(7,2) NOT NULL DEFAULT 0.00,
      delivery_commission_percentage DECIMAL(7,2) NOT NULL DEFAULT 0.00,
      own_delivery_active TINYINT(1) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_area_definitions_city (city, is_active),
      KEY idx_area_definitions_own_delivery (own_delivery_active, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('area_definitions', 'platform_fee', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER center_lng');
  await addColumnIfMissing('area_definitions', 'delivery_charge', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER platform_fee');
  await addColumnIfMissing('area_definitions', 'order_commission_percentage', 'DECIMAL(7,2) NOT NULL DEFAULT 0.00 AFTER delivery_charge');
  await addColumnIfMissing('area_definitions', 'delivery_commission_percentage', 'DECIMAL(7,2) NOT NULL DEFAULT 0.00 AFTER order_commission_percentage');
  await LocationCommissionSetting.ensureTable(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS delivery_type_area_settings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      city VARCHAR(120) NOT NULL,
      area VARCHAR(150) NOT NULL DEFAULT '*',
      delivery_type VARCHAR(40) NOT NULL,
      label VARCHAR(120) NOT NULL,
      priority INT UNSIGNED NOT NULL DEFAULT 99,
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_delivery_type_area (city, area, delivery_type),
      KEY idx_delivery_type_area_lookup (city, area, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    INSERT INTO delivery_type_area_settings (city, area, delivery_type, label, priority, is_enabled, is_active)
    SELECT ad.city, ad.name, seed.delivery_type, seed.label, seed.priority,
           CASE
             WHEN seed.delivery_type IN ('in_house_delivery', 'delivered_by_vendor') THEN COALESCE(ad.own_delivery_active, 0)
             ELSE 1
           END,
           1
    FROM area_definitions ad
    CROSS JOIN (
      SELECT 'in_house_delivery' AS delivery_type, 'In-house Delivery' AS label, 1 AS priority
      UNION ALL SELECT 'delivery_partner', 'Delivery Partner', 2
      UNION ALL SELECT 'counter_pickup', 'Client Self Pickup', 3
      UNION ALL SELECT 'delivered_by_vendor', 'Vendor Delivery', 4
    ) seed
    WHERE ad.is_active = 1
      AND ad.city IS NOT NULL
      AND TRIM(ad.city) <> ''
    ON CONFLICT (city, area, delivery_type) DO NOTHING
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
    INSERT INTO delivery_charge_rules
      (city, rule_name, min_weight_kg, max_weight_kg, base_delivery_price, price_per_km, price_per_kg, additional_charge, is_active)
    SELECT 'Jaipur', 'Default Jaipur delivery', 0, NULL, 30, 0, 10, 0, 1
    WHERE NOT EXISTS (
      SELECT 1 FROM delivery_charge_rules
      WHERE is_active = 1
        AND LOWER(TRIM(city)) = 'jaipur'
    )
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
      expires_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_quotation_client (client_id),
      KEY idx_quotation_status_city (status, client_city),
      CONSTRAINT fk_quotation_client FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('quotation_requests', 'expires_at', 'TIMESTAMP NULL DEFAULT NULL AFTER status');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quotation_request_items (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      quotation_request_id INT UNSIGNED NOT NULL,
      vendor_product_id INT UNSIGNED DEFAULT NULL,
      product_id INT UNSIGNED DEFAULT NULL,
      product_name VARCHAR(255) NOT NULL,
      quantity INT UNSIGNED NOT NULL,
      expected_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      weight_value DECIMAL(10,3) NOT NULL DEFAULT 0.000,
      weight_unit VARCHAR(20) NOT NULL DEFAULT 'kg',
      weight_kg DECIMAL(10,3) NOT NULL DEFAULT 0.000,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_quotation_items_request (quotation_request_id),
      CONSTRAINT fk_quotation_items_request FOREIGN KEY (quotation_request_id) REFERENCES quotation_requests(id) ON DELETE CASCADE,
      CONSTRAINT fk_quotation_items_vendor_product FOREIGN KEY (vendor_product_id) REFERENCES vendor_products(id) ON DELETE SET NULL,
      CONSTRAINT fk_quotation_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await addColumnIfMissing('quotation_request_items', 'weight_value', 'DECIMAL(10,3) NOT NULL DEFAULT 0.000 AFTER expected_price');
  await addColumnIfMissing('quotation_request_items', 'weight_unit', "VARCHAR(20) NOT NULL DEFAULT 'kg' AFTER weight_value");
  await addColumnIfMissing('quotation_request_items', 'weight_kg', 'DECIMAL(10,3) NOT NULL DEFAULT 0.000 AFTER weight_unit');
  await pool.query(`
    UPDATE quotation_request_items qri
    SET weight_value = CASE WHEN COALESCE(qri.weight_value, 0) = 0 THEN COALESCE(p.weight_value, p.weight_kg, 0) ELSE qri.weight_value END,
        weight_unit = CASE WHEN qri.weight_unit IS NULL OR TRIM(qri.weight_unit) = '' THEN COALESCE(NULLIF(p.weight_unit, ''), 'kg') ELSE qri.weight_unit END,
        weight_kg = CASE WHEN COALESCE(qri.weight_kg, 0) = 0 THEN COALESCE(p.weight_kg, 0) ELSE qri.weight_kg END
    FROM products p
    WHERE p.id = qri.product_id
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

  await saveSetting('quotation_submission_minutes', await settingValue('quotation_submission_minutes', '1440'));

  await seedGroceryCatalog();

  const deletedSeedRoleSlugs = new Set(await deletedRoleSlugs());
  for (const role of roleSeeds) {
    if (deletedSeedRoleSlugs.has(role.slug)) continue;
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
  await syncRolesFromUsers();

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
      await pool.query('UPDATE users SET role = ?, phone = COALESCE(phone, ?), password = ?, status = ?, is_deleted = 0 WHERE id = ?', [
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
        `INSERT INTO vendor_profiles (user_id, business_name, address, country, state, city, gst_number, services)
         VALUES (?, ?, ?, 'India', 'Rajasthan', 'Jaipur', NULL, ?)
         ON CONFLICT (user_id) DO UPDATE
         SET business_name = EXCLUDED.business_name,
             address = EXCLUDED.address,
             country = EXCLUDED.country,
             state = EXCLUDED.state,
             city = EXCLUDED.city,
             services = EXCLUDED.services`,
        [
          userId,
          seedUser.business_name || `${seedUser.name} Store`,
          seedUser.address || 'Demo vendor address',
          JSON.stringify(seedUser.serviceNames || ['Home Delivery', 'Counter Pickup']),
        ]
      );

      if (Array.isArray(seedUser.categoryNames) && seedUser.categoryNames.length > 0) {
        await pool.query('DELETE FROM vendor_categories WHERE vendor_id = ?', [userId]);
        await pool.query(
          `INSERT INTO vendor_categories (vendor_id, category_id)
           SELECT ?, id
           FROM categories
           WHERE name IN (${seedUser.categoryNames.map(() => '?').join(',')})
             AND is_deleted = 0
             AND status = 'active'
           ON CONFLICT (vendor_id, category_id) DO NOTHING`,
          [userId, ...seedUser.categoryNames]
        );
      }
    }

    if (seedUser.role === 'Client') {
      await pool.query(
        `INSERT IGNORE INTO client_profiles (user_id, address, country, state, city, notes)
         VALUES (?, 'Demo client address', 'India', 'Rajasthan', 'Jaipur', 'Demo login account')`,
        [userId]
      );
    }

    if (String(seedUser.role).toLowerCase() === 'deliveryperson') {
      await DeliveryPerson.upsertProfile(userId, {
        city: seedUser.city || 'Jaipur',
        area: seedUser.area || '*',
        address: seedUser.address || 'Demo delivery partner address',
        vehicle_type: seedUser.vehicle_type || 'Bike',
        vehicle_number: seedUser.vehicle_number || null,
        status: 'active',
        is_available: true,
      }, pool);
    }
  }

  console.log('Database init: seeding defaults');
  await backfillVendorMainCategories();
  await seedIndianProducts();
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
  if (restoreSnapshot) {
    await restoreSnapshotOnStartup(pgPool, { revision: appRevision });
  }
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
    ...(walletController.isAdminWalletUser(user)
      ? [navItem('Admin Wallet Transactions', '/admin-wallet-transactions', null, 'wallets', activePath.startsWith('/admin-wallet-transactions'))]
      : []),
    navItem('Orders', '/orders/admin/dashboard', 'orders.manage', 'orders', activePath.startsWith('/orders/admin') && !activePath.startsWith('/orders/admin/delivery-dashboard')),
    navGroup('Delivery Dashboard', '/delivery-dashboard', 'orders.manage', 'delivery',
      activePath.startsWith('/delivery-dashboard')
      || activePath.startsWith('/delivery-partner-status')
      || activePath.startsWith('/delivery-persons')
      || activePath.startsWith('/delivery-types')
      || activePath.startsWith('/delivery-charge-settings')
      || activePath.startsWith('/area-definitions'), [
      navItem('Dashboard', '/delivery-dashboard', 'orders.manage', 'dashboard', activePath.startsWith('/delivery-dashboard')),
      navItem('Delivery Partner Status', '/delivery-partner-status', 'orders.manage', 'delivery', activePath.startsWith('/delivery-partner-status')),
      navItem('Delivery Persons', '/delivery-persons', 'orders.manage', 'delivery', activePath.startsWith('/delivery-persons')),
      navItem('Delivery Area Management', '/delivery-types', 'settings.manage', 'delivery', activePath.startsWith('/delivery-types')),
      navItem('Delivery Charge Settings', '/delivery-charge-settings', 'settings.manage', 'settings', activePath.startsWith('/delivery-charge-settings')),
      navItem('Area Definition', '/area-definitions', 'settings.manage', 'settings', activePath.startsWith('/area-definitions')),
    ]),
    navGroup('Support', '/support', 'support.manage', 'support', activePath.startsWith('/support'), [
      navItem('Client Support', '/support/clients', 'support.manage', 'support', activePath.startsWith('/support/clients')),
      navItem('Vendor Support', '/support/vendors', 'support.manage', 'support', activePath.startsWith('/support/vendors')),
    ]),
    navGroup('Discounts', '/discounts', null, 'discounts', activePath.startsWith('/discounts') || activePath.startsWith('/coupons'), [
      navItem('Discounts', '/discounts', 'discounts.view', 'discounts', activePath.startsWith('/discounts')),
      navItem('Coupons', '/coupons', 'coupons.view', 'coupons', activePath === '/coupons'),
      navItem('Coupon History', '/coupons/history', 'coupon_history.view', 'reports', activePath.startsWith('/coupons/history')),
    ]),
    navItem('Advertisements', '/advertisements', 'advertisements.view', 'discounts', activePath.startsWith('/advertisements')),
    navItem('Reports', '#', 'reports.view', 'reports', false),
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

function formatDashboardMoney(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDashboardNumber(value) {
  return Number(value || 0).toLocaleString('en-IN');
}

function dashboardPercent(current, previous) {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  if (previousValue <= 0) {
    return currentValue > 0 ? '+100%' : '0%';
  }
  const percent = Math.round(((currentValue - previousValue) / previousValue) * 100);
  return `${percent >= 0 ? '+' : ''}${percent}%`;
}

async function applyAdminDashboardStats(dashboard) {
  const [summaryRows] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE is_deleted = 0) AS total_users,
       (SELECT COUNT(*) FROM users WHERE is_deleted = 0 AND LOWER(status) = 'active') AS active_users,
       (SELECT COUNT(*) FROM users WHERE is_deleted = 0 AND LOWER(role) = 'client') AS client_count,
       (SELECT COUNT(*) FROM users WHERE is_deleted = 0 AND LOWER(role) = 'vendor') AS vendor_count,
       (SELECT COUNT(*) FROM roles) AS role_count,
       (SELECT COUNT(*) FROM products WHERE is_deleted = 0) AS product_count,
       (SELECT COUNT(*) FROM products WHERE is_deleted = 0 AND approval_status = 'pending') AS pending_products,
       (SELECT COUNT(*) FROM vendor_products WHERE status = 'active' AND quantity > 0) AS active_stock_items,
       (SELECT COUNT(*) FROM vendor_products WHERE status = 'active' AND quantity <= 5) AS low_stock_items,
       (SELECT COUNT(*) FROM client_orders) AS order_count,
       (SELECT COUNT(*) FROM client_orders WHERE status = 'pending') AS pending_orders,
       (SELECT COUNT(*) FROM client_orders WHERE DATE(created_at) = CURRENT_DATE) AS today_orders,
       (SELECT COUNT(*) FROM client_orders WHERE DATE(created_at) = CURRENT_DATE - INTERVAL '1 day') AS yesterday_orders,
       (SELECT COALESCE(SUM(total_amount), 0) FROM client_orders WHERE DATE(created_at) = CURRENT_DATE) AS today_revenue,
       (SELECT COALESCE(SUM(total_amount), 0) FROM client_orders WHERE DATE(created_at) = CURRENT_DATE - INTERVAL '1 day') AS yesterday_revenue,
       (SELECT COALESCE(SUM(total_amount), 0) FROM client_orders) AS total_revenue,
       (SELECT COUNT(*) FROM support_tickets WHERE status = 'Open') AS open_support_tickets,
       (SELECT COUNT(*) FROM quotation_requests WHERE status = 'pending') AS pending_quotations,
       (SELECT COUNT(*) FROM quotation_vendor_recipients WHERE status IN ('new', 'seen')) AS unprocessed_vendor_quotes`
  );
  const stats = summaryRows[0] || {};
  const openIssues = Number(stats.open_support_tickets || 0)
    + Number(stats.pending_products || 0)
    + Number(stats.pending_orders || 0)
    + Number(stats.unprocessed_vendor_quotes || 0);

  dashboard.metrics = [
    {
      label: 'System Users',
      value: formatDashboardNumber(stats.total_users),
      tone: 'orange',
      icon: 'users',
      note: `${formatDashboardNumber(stats.active_users)} active / ${formatDashboardNumber(stats.role_count)} roles`,
    },
    {
      label: 'Today Revenue',
      value: formatDashboardMoney(stats.today_revenue),
      tone: 'green',
      icon: 'revenue',
      note: `${formatDashboardNumber(stats.today_orders)} order${Number(stats.today_orders || 0) === 1 ? '' : 's'} today`,
    },
    {
      label: 'Open Issues',
      value: formatDashboardNumber(openIssues),
      tone: 'red',
      icon: 'alerts',
      note: `${formatDashboardNumber(stats.open_support_tickets)} support / ${formatDashboardNumber(stats.pending_products)} product approvals`,
    },
    {
      label: 'Clients & Vendors',
      value: `${formatDashboardNumber(stats.client_count)} / ${formatDashboardNumber(stats.vendor_count)}`,
      tone: 'blue',
      icon: 'followers',
      note: 'Clients / vendors registered',
    },
  ];

  dashboard.charts = [
    {
      title: 'Daily Sales',
      tone: 'green-panel',
      subtitle: `${formatDashboardMoney(stats.today_revenue)} today, ${dashboardPercent(stats.today_revenue, stats.yesterday_revenue)} vs yesterday.`,
      footer: `${formatDashboardNumber(stats.today_orders)} order${Number(stats.today_orders || 0) === 1 ? '' : 's'} today`,
      type: 'line-up',
    },
    {
      title: 'Orders & Quotations',
      tone: 'orange-panel',
      subtitle: `${formatDashboardNumber(stats.order_count)} orders / ${formatDashboardNumber(stats.pending_quotations)} pending quotations`,
      footer: `${formatDashboardNumber(stats.pending_orders)} pending orders`,
      type: 'bars',
    },
    {
      title: 'Operational Issues',
      tone: 'red-panel',
      subtitle: `${formatDashboardNumber(openIssues)} open items need action`,
      footer: `${formatDashboardNumber(stats.low_stock_items)} low-stock active vendor products`,
      type: 'line-down',
    },
  ];

  dashboard.tasks = [
    Number(stats.pending_orders || 0) > 0
      ? `Review ${formatDashboardNumber(stats.pending_orders)} pending grocery order${Number(stats.pending_orders || 0) === 1 ? '' : 's'}`
      : 'No pending grocery orders right now',
    Number(stats.open_support_tickets || 0) > 0
      ? `Reply to ${formatDashboardNumber(stats.open_support_tickets)} open support ticket${Number(stats.open_support_tickets || 0) === 1 ? '' : 's'}`
      : 'No open support tickets',
    Number(stats.pending_products || 0) > 0
      ? `Approve or reject ${formatDashboardNumber(stats.pending_products)} product submission${Number(stats.pending_products || 0) === 1 ? '' : 's'}`
      : 'No pending product approvals',
    Number(stats.low_stock_items || 0) > 0
      ? `Check ${formatDashboardNumber(stats.low_stock_items)} low-stock vendor item${Number(stats.low_stock_items || 0) === 1 ? '' : 's'}`
      : 'Vendor stock levels look healthy',
  ];

  const [teamRows] = await pool.query(
    `SELECT id, name, role, status
     FROM users
     WHERE is_deleted = 0
     ORDER BY
       CASE WHEN LOWER(status) = 'active' THEN 0 ELSE 1 END,
       updated_at DESC,
       id DESC
     LIMIT 6`
  );
  dashboard.employees = teamRows.map((row) => ({
    id: row.id,
    name: row.name,
    salary: row.status,
    country: row.role,
  }));
}

async function buildDashboardData(user, activePath = '/dashboard') {
  const dashboard = buildDashboard(user, activePath);

  if (['admin', 'superadmin'].includes(String(user.role || '').toLowerCase()) || isSuperAdminUser(user)) {
    await applyAdminDashboardStats(dashboard);
  }

  if (user.role === 'Vendor') {
    const quotationCount = await Quotation.pendingCountForVendor(user.id);
    const vendorDashboardOrders = await Order.listByVendor(user.id, { status: 'pending' });
    dashboard.vendorNewOrders = vendorDashboardOrders.filter((order) => order.status === 'pending');
    const vendorDashboardQuotations = await Quotation.listForVendor(user.id);
    dashboard.vendorNewQuotations = vendorDashboardQuotations.filter((quotation) => (
      quotation.recipient_status === 'new' || quotation.recipient_status === 'seen'
    ));
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
    const quotations = await Quotation.listForClient(user.id);
    dashboard.clientLiveQuotations = quotations.filter((quotation) => (
      quotation.recipient_status === 'submitted' && quotation.bid_editable
    ));

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

async function getAdminMaintenanceStats() {
  const [maintenanceRows] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM quotation_requests) AS quotation_count,
       (SELECT COUNT(*) FROM quotation_vendor_recipients) AS quotation_vendor_count,
       (SELECT COUNT(*) FROM client_orders) AS order_count,
       (SELECT COUNT(*) FROM vendor_products vp INNER JOIN products p ON p.id = vp.product_id WHERE COALESCE(vp.price, 0) <> COALESCE(p.price, 0)) AS vendor_price_diff_count`
  );
  const maintenance = maintenanceRows[0] || {};
  return {
    quotationCount: Number(maintenance.quotation_count || 0),
    quotationVendorCount: Number(maintenance.quotation_vendor_count || 0),
    orderCount: Number(maintenance.order_count || 0),
    vendorPriceDiffCount: Number(maintenance.vendor_price_diff_count || 0),
  };
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

let databaseRestoreInProgress = false;

function quotePgIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function restoreDatabaseFromSettings() {
  if (databaseRestoreInProgress) {
    const error = new Error('Database restore is already running');
    error.status = 409;
    throw error;
  }

  databaseRestoreInProgress = true;

  try {
    const tableResult = await pgPool.query(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename`
    );
    const tableNames = (tableResult.rows || [])
      .map((row) => row.tablename)
      .filter(Boolean);

    if (tableNames.length > 0) {
      await pgPool.query(`DROP TABLE ${tableNames.map(quotePgIdentifier).join(', ')} CASCADE`);
    }

    await initDatabase({ restoreSnapshot: false });

    return tableNames.length;
  } finally {
    databaseRestoreInProgress = false;
  }
}

async function backupDatabaseFromSettings() {
  ensureManualBackupDir();
  const outputFile = path.join(manualBackupDir, backupFileName());
  const result = await exportSnapshot(pgPool, outputFile);
  const stat = fs.statSync(outputFile);
  return {
    ...result,
    name: path.basename(outputFile),
    size: stat.size,
  };
}

async function restoreDatabaseBackupFromFile(snapshotFile) {
  if (databaseRestoreInProgress) {
    const error = new Error('Database restore is already running');
    error.status = 409;
    throw error;
  }

  databaseRestoreInProgress = true;

  try {
    await initDatabase({ restoreSnapshot: false });
    return await restoreSnapshot(pgPool, snapshotFile, {
      force: true,
      revision: `manual-${appRevision}`,
    });
  } finally {
    databaseRestoreInProgress = false;
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
    demoCredentials: { identifier: 'vendor1@example.com', password: 'admin123' },
    googleWebClientId: '',
    firebaseConfig: publicGoogleConfig().firebase,
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
    googleWebClientId: publicGoogleConfig().webClientId,
    firebaseConfig: publicGoogleConfig().firebase,
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
        ? { identifier: 'vendor1@example.com', password: 'admin123' }
        : { identifier: 'client@example.com', password: 'admin123' },
      googleWebClientId: expectedRole === 'Client' ? publicGoogleConfig().webClientId : '',
      firebaseConfig: publicGoogleConfig().firebase,
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
          ? { identifier: 'vendor1@example.com', password: 'admin123' }
          : { identifier: 'client@example.com', password: 'admin123' },
        googleWebClientId: expectedRole === 'Client' ? publicGoogleConfig().webClientId : '',
        firebaseConfig: publicGoogleConfig().firebase,
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
          ? { identifier: 'vendor1@example.com', password: 'admin123' }
          : { identifier: 'client@example.com', password: 'admin123' },
        googleWebClientId: expectedRole === 'Client' ? publicGoogleConfig().webClientId : '',
        firebaseConfig: publicGoogleConfig().firebase,
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
        ? { identifier: 'vendor1@example.com', password: 'admin123' }
        : { identifier: 'client@example.com', password: 'admin123' },
      googleWebClientId: expectedRole === 'Client' ? publicGoogleConfig().webClientId : '',
      firebaseConfig: publicGoogleConfig().firebase,
      error: 'Unable to process login. Please try again later.',
    });
  }
}

app.post('/login/vendor', (req, res) => handleRoleLogin(req, res, 'Vendor', '/vendor/dashboard'));
app.post('/login/client', (req, res) => handleRoleLogin(req, res, 'Client', '/client/dashboard'));

app.post('/login/client/google', async (req, res) => {
  const idToken = String(req.body.credential || req.body.idToken || '').trim();
  if (!idToken) {
    return res.render('role_login', {
      roleLabel: 'Client',
      roleSlug: 'Client',
      loginPath: '/login/client',
      demoCredentials: { identifier: 'client@example.com', password: 'admin123' },
      googleWebClientId: publicGoogleConfig().webClientId,
      firebaseConfig: publicGoogleConfig().firebase,
      error: 'Google login token is missing. Please try again.',
    });
  }

  try {
    const rawUser = await findOrCreateGoogleClient(idToken);
    const fallbackPermissions = ['dashboard.view', 'wallets.view', 'coupons.apply'];
    req.session.user = {
      id: rawUser.id,
      name: rawUser.name,
      email: rawUser.email,
      themeMode: rawUser.theme_mode || 'light',
      role: rawUser.role,
      roleName: rawUser.role,
      roles: [{ id: null, name: rawUser.role, slug: rawUser.role, level: 99, permissions: fallbackPermissions }],
      permissions: fallbackPermissions,
    };
    return res.redirect('/client/dashboard');
  } catch (error) {
    console.error('Client Google web login error:', error);
    return res.render('role_login', {
      roleLabel: 'Client',
      roleSlug: 'Client',
      loginPath: '/login/client',
      demoCredentials: { identifier: 'client@example.com', password: 'admin123' },
      googleWebClientId: publicGoogleConfig().webClientId,
      firebaseConfig: publicGoogleConfig().firebase,
      error: error.status ? error.message : 'Unable to process Google login. Please try again later.',
    });
  }
});

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
    return res.redirect(`/settings?message=${encodeURIComponent(removed > 0 ? detail : 'No quotation or order data was found to clear.')}`);
  } catch (error) {
    console.error('Admin maintenance clear quotation/order data failed:', error);
    return res.redirect(`/settings?error=${encodeURIComponent('Unable to clear quotation and order data. Check server logs.')}`);
  }
});

app.post('/admin/maintenance/sync-vendor-prices', requireAuth, requireAdminMaintenance, async (req, res) => {
  try {
    const updated = await syncVendorPricesToMasterProducts();
    const detail = updated > 0
      ? `Updated ${updated} vendor product price(s) to match master product prices. Vendors can edit their own prices again after this reset.`
      : 'All vendor product prices already match master product prices.';
    return res.redirect(`/settings?message=${encodeURIComponent(detail)}`);
  } catch (error) {
    console.error('Admin maintenance sync vendor prices failed:', error);
    return res.redirect(`/settings?error=${encodeURIComponent('Unable to sync vendor product prices. Check server logs.')}`);
  }
});

app.post('/admin/maintenance/restore-database', requireAuth, requireAdminMaintenance, async (req, res) => {
  try {
    const droppedTables = await restoreDatabaseFromSettings();
    const detail = `Database cleaned successfully. Dropped and recreated ${droppedTables} table(s).`;
    return res.redirect(`/settings?message=${encodeURIComponent(detail)}`);
  } catch (error) {
    console.error('Admin maintenance database restore failed:', error);
    const status = Number(error.status || 500);
    const message = status === 409
      ? 'Database restore is already running. Please wait for it to finish.'
      : 'Unable to restore database. Check server logs.';
    return res.redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
});

app.post('/admin/maintenance/clean-database', requireAuth, requireAdminMaintenance, async (req, res) => {
  try {
    const droppedTables = await restoreDatabaseFromSettings();
    const detail = `Database cleaned successfully. Dropped and recreated ${droppedTables} table(s).`;
    return res.redirect(`/settings?message=${encodeURIComponent(detail)}`);
  } catch (error) {
    console.error('Admin maintenance database clean failed:', error);
    const status = Number(error.status || 500);
    const message = status === 409
      ? 'Database maintenance is already running. Please wait for it to finish.'
      : 'Unable to clean database. Check server logs.';
    return res.redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
});

app.post('/admin/maintenance/backup-database', requireAuth, requireAdminMaintenance, async (req, res) => {
  try {
    const backup = await backupDatabaseFromSettings();
    const detail = `Database backup created: ${backup.name} (${backup.tables} table(s), ${backup.size} bytes).`;
    return res.redirect(`/settings?message=${encodeURIComponent(detail)}`);
  } catch (error) {
    console.error('Admin maintenance database backup failed:', error);
    return res.redirect(`/settings?error=${encodeURIComponent('Unable to create database backup. Check server logs.')}`);
  }
});

app.get('/admin/maintenance/database-backups/:name', requireAuth, requireAdminMaintenance, (req, res) => {
  try {
    const filePath = manualBackupPath(req.params.name);
    if (!fs.existsSync(filePath)) {
      return res.redirect(`/settings?error=${encodeURIComponent('Backup file was not found.')}`);
    }
    return res.download(filePath, path.basename(filePath));
  } catch (error) {
    console.error('Admin maintenance database backup download failed:', error);
    return res.redirect(`/settings?error=${encodeURIComponent(error.message || 'Unable to download backup file.')}`);
  }
});

app.post('/admin/maintenance/restore-database-backup', requireAuth, requireAdminMaintenance, async (req, res) => {
  try {
    const filePath = manualBackupPath(req.body.backup_name);
    if (!fs.existsSync(filePath)) {
      return res.redirect(`/settings?error=${encodeURIComponent('Backup file was not found.')}`);
    }
    const result = await restoreDatabaseBackupFromFile(filePath);
    const detail = `Database restored from ${path.basename(filePath)} (${result.tables || 0} table(s)).`;
    return res.redirect(`/settings?message=${encodeURIComponent(detail)}`);
  } catch (error) {
    console.error('Admin maintenance database backup restore failed:', error);
    const status = Number(error.status || 500);
    const message = status === 409
      ? 'Database maintenance is already running. Please wait for it to finish.'
      : 'Unable to restore database backup. Check server logs.';
    return res.redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
});

app.post('/admin/maintenance/restore-database-upload', requireAuth, requireAdminMaintenance, (req, res) => {
  uploadDatabaseBackup.single('backup')(req, res, async (uploadError) => {
    if (uploadError) {
      return res.redirect(`/settings?error=${encodeURIComponent(uploadError.message || 'Invalid backup upload.')}`);
    }
    if (!req.file) {
      return res.redirect(`/settings?error=${encodeURIComponent('Choose a JSON backup file to restore.')}`);
    }

    try {
      ensureManualBackupDir();
      const originalBase = path.basename(req.file.originalname || 'uploaded-backup.json').replace(/[^-\w.]+/g, '-');
      const safeOriginal = isSafeBackupFileName(originalBase) ? originalBase : 'uploaded-backup.json';
      const outputFile = path.join(manualBackupDir, `uploaded-${Date.now()}-${safeOriginal}`);
      JSON.parse(req.file.buffer.toString('utf8'));
      fs.writeFileSync(outputFile, req.file.buffer);
      const result = await restoreDatabaseBackupFromFile(outputFile);
      const detail = `Database restored from uploaded backup ${path.basename(outputFile)} (${result.tables || 0} table(s)).`;
      return res.redirect(`/settings?message=${encodeURIComponent(detail)}`);
    } catch (error) {
      console.error('Admin maintenance uploaded database restore failed:', error);
      const status = Number(error.status || 500);
      const message = status === 409
        ? 'Database maintenance is already running. Please wait for it to finish.'
        : 'Unable to restore uploaded backup. Make sure it is a valid database snapshot JSON file.';
      return res.redirect(`/settings?error=${encodeURIComponent(message)}`);
    }
  });
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
    const selectedCategoryId = Number(req.query.category_id || req.query.categoryId || 0) || 0;
    const categoriesByVendor = await Vendor.assignedCategories([vendorId]);
    const vendorCategories = categoriesByVendor.get(Number(vendorId)) || [];
    const allQuotations = await Quotation.listForVendor(vendorId);
    const categoryCounts = allQuotations.reduce((counts, quotation) => {
      if (!['new', 'seen'].includes(quotation.recipient_status)) return counts;
      const categoryId = Number(quotation.category_id || 0);
      if (categoryId > 0) counts[categoryId] = (counts[categoryId] || 0) + 1;
      return counts;
    }, {});
    const quotations = selectedCategoryId > 0
      ? await Quotation.listForVendor(vendorId, { categoryId: selectedCategoryId })
      : allQuotations;
    console.log(`[quotation] vendor ${vendorId} loaded ${quotations.length} quotation request(s)`);

    if (requestWantsJson(req)) {
      if (req.query.peek !== '1') {
        await Quotation.markSeenForVendor(vendorId);
      }
      return res.json({
        success: true,
        quotations,
        categories: vendorCategories,
        category_counts: categoryCounts,
        selected_category_id: selectedCategoryId,
      });
    }

    await Quotation.markSeenForVendor(vendorId);
    res.render('vendor-quotations', {
      user: req.session.user,
      shell: buildShell(req.session.user, req.path),
      quotations,
      categories: vendorCategories,
      categoryCounts,
      selectedCategoryId,
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
      categories: [],
      categoryCounts: {},
      selectedCategoryId: 0,
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
    await notifyClientBidUpdate(response);
    return res.json({ success: true, message: response.isUpdate ? 'Quotation bid updated' : 'Quotation submitted to client', response });
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

app.get('/api/client/categories', webOrJwtAuth, requireAuthRole('Client'), async (req, res) => {
  try {
    const categories = (await Catalog.listCategories()).filter((category) => category.status === 'active');
    return res.json({
      success: true,
      categories,
      updated_at: categories.map((category) => category.updated_at || '').sort().pop() || null,
    });
  } catch (error) {
    console.error('Client categories API error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load categories' });
  }
});

app.get('/api/catalog/categories', webOrJwtAuth, async (req, res) => {
  try {
    const [categories, subcategories, brands, tree] = await Promise.all([
      Catalog.listCategories(),
      Catalog.listSubcategories(),
      Catalog.listBrands(),
      Catalog.getTree(),
    ]);
    const activeCategories = categories.filter((category) => category.status === 'active');
    const activeCategoryIds = new Set(activeCategories.map((category) => Number(category.id)));
    const activeSubcategories = subcategories.filter((subcategory) => (
      subcategory.status === 'active' && activeCategoryIds.has(Number(subcategory.category_id))
    ));
    const activeSubcategoryIds = new Set(activeSubcategories.map((subcategory) => Number(subcategory.id)));
    const activeBrands = brands.filter((brand) => (
      brand.status === 'active'
        && activeCategoryIds.has(Number(brand.category_id))
        && activeSubcategoryIds.has(Number(brand.sub_category_id || brand.subcategory_id))
    ));
    const activeTree = tree
      .filter((category) => category.status === 'active')
      .map((category) => ({
        ...category,
        subcategories: (category.subcategories || [])
          .filter((subcategory) => subcategory.status === 'active')
          .map((subcategory) => ({
            ...subcategory,
            brands: (subcategory.brands || []).filter((brand) => brand.status === 'active'),
          })),
      }));
    return res.json({
      success: true,
      categories: activeCategories,
      subcategories: activeSubcategories,
      brands: activeBrands,
      tree: activeTree,
    });
  } catch (error) {
    console.error('Catalog categories API error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load categories' });
  }
});

app.get('/api/catalog/subcategories', webOrJwtAuth, async (req, res) => {
  try {
    const categoryId = Number(req.query.category_id || req.query.categoryId || 0);
    const subcategories = (await Catalog.listSubcategories())
      .filter((subcategory) => subcategory.status === 'active')
      .filter((subcategory) => !categoryId || Number(subcategory.category_id) === categoryId);
    return res.json({ success: true, subcategories });
  } catch (error) {
    console.error('Catalog subcategories API error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load subcategories' });
  }
});

app.get('/api/catalog/brands', webOrJwtAuth, async (req, res) => {
  try {
    const categoryId = Number(req.query.category_id || req.query.categoryId || 0);
    const subcategoryId = Number(req.query.sub_category_id || req.query.subcategory_id || req.query.subcategoryId || 0);
    const brands = (await Catalog.listBrands())
      .filter((brand) => brand.status === 'active')
      .filter((brand) => !categoryId || Number(brand.category_id) === categoryId)
      .filter((brand) => !subcategoryId || Number(brand.sub_category_id || brand.subcategory_id) === subcategoryId);
    return res.json({ success: true, brands });
  } catch (error) {
    console.error('Catalog brands API error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load brands' });
  }
});

app.get('/api/vendor/category-requests', webOrJwtAuth, requireAuthRole('Vendor'), async (req, res) => {
  try {
    const vendorId = req.authUser.id;
    const [pending_request, pending_requests, requests, available_categories] = await Promise.all([
      VendorCategoryRequest.pendingForVendor(vendorId),
      VendorCategoryRequest.pendingForVendorList(vendorId),
      VendorCategoryRequest.listForVendor(vendorId),
      VendorCategoryRequest.availableCategoriesForVendor(vendorId),
    ]);
    return res.json({ success: true, pending_request, pending_requests, requests, available_categories });
  } catch (error) {
    console.error('Vendor category request load error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load category requests' });
  }
});

app.post('/api/vendor/category-requests', webOrJwtAuth, requireAuthRole('Vendor'), async (req, res) => {
  try {
    const categoryIds = req.body.category_ids || req.body.categoryIds || req.body.category_id || req.body.categoryId;
    if (!categoryIds || (Array.isArray(categoryIds) && !categoryIds.length)) {
      return res.status(422).json({ success: false, message: 'Category is required' });
    }
    const ids = await VendorCategoryRequest.create(req.authUser.id, categoryIds, req.body.note);
    return res.status(201).json({
      success: true,
      message: 'Category activation request sent to admin',
      pending_requests: await VendorCategoryRequest.pendingForVendorList(req.authUser.id),
      ids,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Unable to create category request',
    });
  }
});

app.get('/api/admin/vendor-category-requests', webOrJwtAuth, requirePermission('vendors.manage'), async (req, res) => {
  try {
    const requests = await VendorCategoryRequest.list({ status: req.query.status || 'pending' });
    return res.json({ success: true, requests });
  } catch (error) {
    console.error('Admin category request load error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load category requests' });
  }
});

app.post('/api/admin/vendor-category-requests/:id/approve', webOrJwtAuth, requirePermission('vendors.manage'), async (req, res) => {
  try {
    await VendorCategoryRequest.decide(Number(req.params.id), 'approved', req.authUser.id, req.body.admin_note);
    return res.json({ success: true, message: 'Category request approved' });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to approve request' });
  }
});

app.post('/api/admin/vendor-category-requests/:id/reject', webOrJwtAuth, requirePermission('vendors.manage'), async (req, res) => {
  try {
    await VendorCategoryRequest.decide(Number(req.params.id), 'rejected', req.authUser.id, req.body.admin_note);
    return res.json({ success: true, message: 'Category request rejected' });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to reject request' });
  }
});

app.get('/api/vendor/quotations', webOrJwtAuth, requireAuthRole('Vendor'), async (req, res) => {
  try {
    const vendorId = req.authUser.id;
    const selectedCategoryId = Number(req.query.category_id || req.query.categoryId || 0) || 0;
    const categoriesByVendor = await Vendor.assignedCategories([vendorId]);
    const vendorCategories = categoriesByVendor.get(Number(vendorId)) || [];
    const allQuotations = await Quotation.listForVendor(vendorId);
    const categoryCounts = allQuotations.reduce((counts, quotation) => {
      if (!['new', 'seen'].includes(quotation.recipient_status)) return counts;
      const categoryId = Number(quotation.category_id || 0);
      if (categoryId > 0) counts[categoryId] = (counts[categoryId] || 0) + 1;
      return counts;
    }, {});
    const quotations = selectedCategoryId > 0
      ? await Quotation.listForVendor(vendorId, { categoryId: selectedCategoryId })
      : allQuotations;
    if (req.query.peek !== '1') {
      await Quotation.markSeenForVendor(vendorId);
    }
    return res.json({
      success: true,
      quotations,
      categories: vendorCategories,
      category_counts: categoryCounts,
      selected_category_id: selectedCategoryId,
    });
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
    await notifyClientBidUpdate(response);
    return res.json({ success: true, message: response.isUpdate ? 'Quotation bid updated' : 'Quotation submitted to client', response });
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
        orderNumber: result.orderNumber,
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
        orderNumber: result.orderNumber,
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
app.post(
  '/profiles/:userId/vendor-signature',
  webOrJwtAuth,
  requireProfileAccess,
  uploadVendorSignature.single('signature'),
  handleVendorSignatureUploadError,
  managedProfileController.uploadVendorSignature
);
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
app.get('/admin-wallet-transactions', webOrJwtAuth, requireAdminWalletTransactions, walletController.adminTransactionsPage);
app.get('/api/admin-wallet-transactions', webOrJwtAuth, requireAdminWalletTransactions, walletController.adminTransactions);
app.get('/delivery-dashboard', requireAuth, requirePermission('orders.manage'), orderController.deliveryDashboardPage);
app.get('/delivery-partner-status', requireAuth, requirePermission('orders.manage'), orderController.deliveryPartnerStatusPage);
app.use('/delivery-persons', requireAuth, requirePermission('orders.manage'), deliveryPersonRoutes);
app.get('/delivery-types', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  res.render('delivery-types', {
    user: req.session.user,
    shell: buildShell(req.session.user, req.path),
    cityOptions: await promotionCityOptions(),
  });
});
app.use('/delivery-types', requireAuth, requirePermission('settings.manage'), deliveryTypeRoutes);

// Order routes - web (session based)
app.use('/public', orderRoutes.publicRouter);
app.use('/orders/admin', requireAuth, requirePermission('orders.manage'), orderRoutes.adminRouter);
app.use('/orders/vendor', requireAuth, requireSessionRole('Vendor', '/login/vendor'), orderRoutes.vendorRouter);
app.use('/orders/client', requireAuth, requireSessionRole('Client', '/login/client'), orderRoutes.clientRouter);

// Order routes - API (JWT or session based)
app.use('/api/orders/admin', webOrJwtAuth, orderRoutes.adminRouter);
app.use('/api/orders/vendor', webOrJwtAuth, orderRoutes.vendorRouter);
app.use('/api/orders/client', webOrJwtAuth, orderRoutes.clientRouter);
app.use('/api/orders/delivery', webOrJwtAuth, orderRoutes.deliveryRouter);
app.use('/api/delivery-types', webOrJwtAuth, deliveryTypeRoutes);

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
    const createdQuotations = Array.isArray(quotation.quotations) && quotation.quotations.length
      ? quotation.quotations
      : [quotation];
    for (const categoryQuotation of createdQuotations) {
      vendorNotifications.notifyVendors(categoryQuotation.vendorIds || [], {
        type: 'quotation',
        id: categoryQuotation.id,
        title: 'New quotation received',
        message: categoryQuotation.categoryName
          ? `New ${categoryQuotation.categoryName} quotation received`
          : 'New quotation received',
        quotationId: categoryQuotation.id,
        categoryId: categoryQuotation.categoryId,
        categoryName: categoryQuotation.categoryName,
        city: categoryQuotation.city,
        totalAmount: categoryQuotation.totalAmount,
      });
    }
    console.log(`[quotation] client ${req.authUser.id} created ${createdQuotations.length} category quotation(s) for ${quotation.vendorCount} vendor(s) in ${quotation.city}`);

    const skippedCategories = Array.isArray(quotation.skippedCategories) ? quotation.skippedCategories : [];
    const skippedSuffix = skippedCategories.length
      ? ` (${skippedCategories.length} categor${skippedCategories.length === 1 ? 'y' : 'ies'} skipped: ${skippedCategories.map((category) => category.categoryName).filter(Boolean).join(', ')})`
      : '';
    const message = createdQuotations.length === 1
      ? `Quotation sent to ${createdQuotations[0].vendorCount} vendor${createdQuotations[0].vendorCount === 1 ? '' : 's'} in ${quotation.city}${skippedSuffix}`
      : `${createdQuotations.length} category-wise quotations sent to ${quotation.vendorCount} vendor${quotation.vendorCount === 1 ? '' : 's'} in ${quotation.city}${skippedSuffix}`;

    return res.json({
      success: true,
      message,
      quotation,
      quotations: createdQuotations,
      skipped_categories: skippedCategories,
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
      skipped_categories: Array.isArray(error.skippedCategories) ? error.skippedCategories : [],
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
    area: row.area || '',
    city: row.city || '',
    state: row.state || '',
    country: row.country || '',
    pincode: row.pincode || '',
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    is_default: Boolean(row.is_default),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function deliveryAddressPayload(body) {
  const latitude = Number(body.latitude ?? body.lat);
  const longitude = Number(body.longitude ?? body.lng);
  return {
    label: String(body.label || 'Home').trim().slice(0, 80) || 'Home',
    recipient_name: String(body.recipient_name || body.recipientName || '').trim().slice(0, 120) || null,
    phone: String(body.phone || '').trim().slice(0, 30) || null,
    address: String(body.address || '').trim(),
    area: String(body.area || body.locality || '').trim().slice(0, 120) || null,
    city: String(body.city || '').trim().slice(0, 80) || null,
    state: String(body.state || '').trim().slice(0, 80) || null,
    country: String(body.country || 'India').trim().slice(0, 80) || 'India',
    pincode: String(body.pincode || body.pinCode || '').trim().slice(0, 20) || null,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    is_default: Boolean(body.is_default || body.isDefault),
  };
}

function formatClientProfileAddress(client) {
  return [
    client.address,
    client.city,
    client.state,
    client.country,
  ].filter(Boolean).join(', ');
}

function formatDeliveryAddress(address) {
  if (!address) return '';
  return [
    address.address,
    address.city,
    address.state,
    address.country,
    address.pincode,
  ].filter(Boolean).join(', ');
}

function buildShippingSnapshot(client, selectedAddress) {
  const clientAddress = formatClientProfileAddress(client);
  const shippingAddress = selectedAddress ? formatDeliveryAddress(selectedAddress) : clientAddress;
  return {
    clientAddress,
    shippingAddress,
    shippingAddressId: selectedAddress ? selectedAddress.id : null,
    shippingName: (selectedAddress && selectedAddress.recipient_name) || client.name || null,
    shippingPhone: (selectedAddress && selectedAddress.phone) || client.phone || null,
    shippingArea: (selectedAddress && selectedAddress.area) || null,
    shippingCity: (selectedAddress && selectedAddress.city) || client.city || null,
    shippingState: (selectedAddress && selectedAddress.state) || client.state || null,
    shippingCountry: (selectedAddress && selectedAddress.country) || client.country || null,
    shippingPincode: selectedAddress ? selectedAddress.pincode || null : null,
    shippingLatitude: selectedAddress ? selectedAddress.latitude || null : null,
    shippingLongitude: selectedAddress ? selectedAddress.longitude || null : null,
  };
}

function money(value) {
  return Number(Math.max(Number(value || 0), 0).toFixed(2));
}

async function resolveAreaOrderPricing({ addressSnapshot, vendorOrder, deliveryOptions, connection }) {
  const areaPricing = await AreaDefinition.pricingForLocation({
    city: addressSnapshot.shippingCity || vendorOrder.city || '',
    area: addressSnapshot.shippingArea || addressSnapshot.shippingPincode || '',
    latitude: addressSnapshot.shippingLatitude,
    longitude: addressSnapshot.shippingLongitude,
  }, connection);

  const delivery = await DeliveryCharge.calculateCharge({
    city: vendorOrder.city,
    origin: vendorOrder.origin,
    destination: vendorOrder.destination,
    originLatitude: vendorOrder.originLatitude,
    originLongitude: vendorOrder.originLongitude,
    destinationLatitude: vendorOrder.destinationLatitude,
    destinationLongitude: vendorOrder.destinationLongitude,
    items: vendorOrder.items.map((orderItem) => ({
      product_name: orderItem.productName,
      weight_kg: orderItem.weightKg,
      quantity: orderItem.quantity,
    })),
  }, connection);

  const deliveryCharge = deliveryOptions.selected_type === 'counter_pickup'
    ? 0
    : money(areaPricing.delivery_charge !== null ? areaPricing.delivery_charge : delivery.delivery_charge);
  const platformFee = money(areaPricing.platform_fee);
  const locationCommission = await LocationCommissionSetting.resolveForLocation({
    city: addressSnapshot.shippingCity || areaPricing.city || vendorOrder.city || '',
    area: addressSnapshot.shippingArea || areaPricing.area_name || addressSnapshot.shippingPincode || '',
  }, connection);
  const orderCommissionSetting = await CommissionSetting.getOrderCommission(connection);
  const deliveryCommissionSetting = await CommissionSetting.getDeliveryCommission(connection);
  const areaOrderCommissionPercentage = money(
    locationCommission
      ? locationCommission.order_commission_percentage
      : areaPricing.order_commission_percentage
  );
  const areaDeliveryCommissionPercentage = money(
    locationCommission
      ? locationCommission.delivery_commission_percentage
      : areaPricing.delivery_commission_percentage
  );
  const orderCommissionPercentage = money(
    areaOrderCommissionPercentage || (orderCommissionSetting ? orderCommissionSetting.percentage : 0)
  );
  const deliveryCommissionPercentage = money(
    areaDeliveryCommissionPercentage || (deliveryCommissionSetting ? deliveryCommissionSetting.percentage : 0)
  );

  return {
    areaPricing,
    locationCommission,
    delivery,
    platformFee,
    deliveryCharge,
    orderCommissionPercentage,
    deliveryCommissionPercentage,
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
       (user_id, label, recipient_name, phone, address, area, city, state, country, pincode, latitude, longitude, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clientId,
        data.label,
        data.recipient_name,
        data.phone,
        data.address,
        data.area,
        data.city,
        data.state,
        data.country,
        data.pincode,
        data.latitude,
        data.longitude,
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
       SET label = ?, recipient_name = ?, phone = ?, address = ?, area = ?, city = ?, state = ?, country = ?, pincode = ?,
           latitude = ?, longitude = ?,
           is_default = CASE WHEN ? = 1 THEN 1 ELSE is_default END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [
        data.label,
        data.recipient_name,
        data.phone,
        data.address,
        data.area,
        data.city,
        data.state,
        data.country,
        data.pincode,
        data.latitude,
        data.longitude,
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

async function calculateClientOrderPreview({ clientId, rawItems, deliveryAddressId = 0, couponCode = '', deliveryType = '', connection = pool, lockStock = false }) {
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

  if (deliveryAddressId && !addressRows.length) {
    const error = new Error(deliveryAddressId ? 'Selected delivery address was not found' : 'Please add a delivery address before placing an order');
    error.status = 422;
    throw error;
  }

  const selectedAddress = addressRows[0] || null;
  const addressSnapshot = buildShippingSnapshot(client, selectedAddress);
  const clientAddress = addressSnapshot.shippingAddress || addressSnapshot.clientAddress;

  const vendorOrders = new Map();
  for (const item of items) {
    const vpId = item.vendorProductId || item.id;
    const [vpRows] = await connection.query(
      `SELECT vp.product_id, vp.vendor_id, vp.quantity, vp.price,
              p.name AS product_name,
              p.weight_kg,
              vprof.address AS vendor_address,
              vprof.pickup_latitude AS vendor_pickup_latitude,
              vprof.pickup_longitude AS vendor_pickup_longitude,
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
        destinationLatitude: addressSnapshot.shippingLatitude,
        destinationLongitude: addressSnapshot.shippingLongitude,
        origin: [
          vp.vendor_address,
          vp.vendor_city,
          vp.vendor_state,
          vp.vendor_country,
        ].filter(Boolean).join(', '),
        originLatitude: vp.vendor_pickup_latitude,
        originLongitude: vp.vendor_pickup_longitude,
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
    const deliveryOptions = await DeliveryType.availableForLocation({
      city: vendorOrder.city,
      area: addressSnapshot.shippingArea || addressSnapshot.shippingPincode,
      latitude: addressSnapshot.shippingLatitude,
      longitude: addressSnapshot.shippingLongitude,
      vendorId,
      requestedType: deliveryType,
    }, connection);
    const pricing = await resolveAreaOrderPricing({ addressSnapshot, vendorOrder, deliveryOptions, connection });
    const vendorDeliveryCharge = pricing.deliveryCharge;
    const vendorPlatformFee = pricing.platformFee;
    const itemPayable = Math.max(vendorOrder.subtotal - vendorDiscount, 0);
    const vendorTotal = itemPayable + vendorDeliveryCharge + vendorPlatformFee;
    discountAmount += vendorDiscount;
    deliveryCharge += vendorDeliveryCharge;
    totalAmount += vendorTotal;
    vendorBreakdown.push({
      vendor_id: vendorId,
      vendor_name: await (async () => {
        const [vendorRows] = await connection.query(
          `SELECT COALESCE(NULLIF(vp.business_name, ''), u.name) AS name
           FROM users u LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
           WHERE u.id = ? LIMIT 1`,
          [vendorId]
        );
        return vendorRows[0] ? vendorRows[0].name : `Vendor #${vendorId}`;
      })(),
      vendor_rating: await Rating.summary('vendor', vendorId, connection),
      subtotal_amount: Number(vendorOrder.subtotal.toFixed(2)),
      discount_amount: Number(vendorDiscount.toFixed(2)),
      platform_fee: Number(vendorPlatformFee.toFixed(2)),
      delivery_charge: Number(vendorDeliveryCharge.toFixed(2)),
      delivery_type: deliveryOptions.selected_type,
      delivery_method: deliveryOptions.selected_method,
      delivery_types: deliveryOptions.delivery_types,
      total_amount: Number(vendorTotal.toFixed(2)),
      distance_km: pricing.delivery.distance_km,
      total_weight_kg: pricing.delivery.total_weight_kg,
      rule: pricing.delivery.rule,
      area_pricing: {
        area_definition_id: pricing.areaPricing.area_definition_id,
        area_name: pricing.areaPricing.area_name,
        city: pricing.areaPricing.city,
        commission_area: pricing.locationCommission ? pricing.locationCommission.area : null,
        commission_source: pricing.locationCommission ? (pricing.locationCommission.area === '*' ? 'city' : 'area') : 'area_definition',
        order_commission_percentage: pricing.orderCommissionPercentage,
        delivery_commission_percentage: pricing.deliveryCommissionPercentage,
      },
    });
  }

  return {
    subtotal_amount: Number(subtotalAmount.toFixed(2)),
    discount_amount: Number(discountAmount.toFixed(2)),
    savings_amount: Number(discountAmount.toFixed(2)),
    delivery_charge: Number(deliveryCharge.toFixed(2)),
    platform_fee: Number(vendorBreakdown.reduce((sum, vendor) => sum + Number(vendor.platform_fee || 0), 0).toFixed(2)),
    total_amount: Number(totalAmount.toFixed(2)),
    address: {
      id: addressSnapshot.shippingAddressId,
      label: selectedAddress ? selectedAddress.label || '' : 'Client Address',
      recipient_name: addressSnapshot.shippingName || '',
      phone: addressSnapshot.shippingPhone || '',
      display_address: addressSnapshot.shippingAddress || addressSnapshot.clientAddress,
      area: addressSnapshot.shippingArea || (selectedAddress ? selectedAddress.pincode || '' : ''),
      city: addressSnapshot.shippingCity || client.city || '',
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
      deliveryType: String(req.body.delivery_type || req.body.deliveryType || req.body.delivery_method || '').trim(),
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

      if (requestedAddressId && !addressRows.length) {
        throw new Error(requestedAddressId ? 'Selected delivery address was not found' : 'Please add a delivery address before placing an order');
      }

      const selectedAddress = addressRows[0] || null;
      const addressSnapshot = buildShippingSnapshot(client, selectedAddress);
      const clientAddress = addressSnapshot.clientAddress || addressSnapshot.shippingAddress;
      const shippingAddress = addressSnapshot.shippingAddress || addressSnapshot.clientAddress;
      const clientName = client.name || addressSnapshot.shippingName || null;
      const clientPhone = client.phone || addressSnapshot.shippingPhone || null;

      const vendorOrders = new Map();

      for (const item of items) {
        const vpId = item.vendorProductId || item.id;
        const [vpRows] = await connection.query(
          `SELECT vp.product_id, vp.vendor_id, vp.quantity, vp.price,
                  p.name AS product_name,
                  p.weight_kg,
                  vprof.address AS vendor_address,
                  vprof.pickup_latitude AS vendor_pickup_latitude,
                  vprof.pickup_longitude AS vendor_pickup_longitude,
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
            city: addressSnapshot.shippingCity || client.city || '',
            destination: shippingAddress,
            destinationLatitude: addressSnapshot.shippingLatitude,
            destinationLongitude: addressSnapshot.shippingLongitude,
            origin: [
              vp.vendor_address,
              vp.vendor_city,
              vp.vendor_state,
              vp.vendor_country,
            ].filter(Boolean).join(', '),
            originLatitude: vp.vendor_pickup_latitude,
            originLongitude: vp.vendor_pickup_longitude,
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
      const orderNumbers = [];
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
      const requestedDeliveryType = String(req.body.delivery_type || req.body.deliveryType || req.body.delivery_method || '').trim();

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
        const deliveryOptions = await DeliveryType.availableForLocation({
          city: vendorOrder.city,
          area: addressSnapshot.shippingArea || addressSnapshot.shippingPincode,
          latitude: addressSnapshot.shippingLatitude,
          longitude: addressSnapshot.shippingLongitude,
          vendorId,
          requestedType: requestedDeliveryType,
        }, connection);
        const pricing = await resolveAreaOrderPricing({ addressSnapshot, vendorOrder, deliveryOptions, connection });
        const deliveryCharge = pricing.deliveryCharge;
        const platformFee = pricing.platformFee;
        const itemPayable = Math.max(vendorSubtotal - vendorDiscount, 0);
        const orderCommissionAmount = money((itemPayable * pricing.orderCommissionPercentage) / 100);
        const deliveryCommissionAmount = money((deliveryCharge * pricing.deliveryCommissionPercentage) / 100);
        const vendorTotal = itemPayable + deliveryCharge + platformFee;
        vendorPromotions.set(vendorId, {
          promotion,
          vendorDiscount,
          vendorTotal,
          deliveryCharge,
          platformFee,
          orderCommissionAmount,
          deliveryCommissionAmount,
          pricing,
          deliveryOptions,
        });
        totalAmount += vendorTotal;
      }

      await OrderWalletSettlement.assertSufficientBalance(clientId, totalAmount, connection);

      for (const [vendorId, vendorOrder] of vendorOrders.entries()) {
        const vendorSubtotal = vendorOrder.total;
        const vendorPromotion = vendorPromotions.get(vendorId);
        const promotion = vendorPromotion.promotion;
        const vendorDiscount = vendorPromotion.vendorDiscount;
        const vendorTotal = vendorPromotion.vendorTotal;
        const deliveryCharge = vendorPromotion.deliveryCharge;
        const platformFee = vendorPromotion.platformFee;
        const orderCommissionAmount = vendorPromotion.orderCommissionAmount;
        const deliveryCommissionAmount = vendorPromotion.deliveryCommissionAmount;
        const pricing = vendorPromotion.pricing;
        const deliveryOptions = vendorPromotion.deliveryOptions;
        const { result: orderResult, orderNumber } = await insertClientOrderWithOrderNumber(
          connection,
          `INSERT INTO client_orders
           (order_number, user_id, vendor_id, subtotal_amount, discount_amount, savings_amount, delivery_charge, platform_fee, order_commission_amount, delivery_commission_amount, platform_charge, area_definition_id, area_pricing_snapshot, coupon_id, coupon_code, discount_id, discount_label, order_type, total_amount, status, delivery_status, delivery_method, delivery_type, client_name, client_phone, client_address, shipping_address_id, shipping_name, shipping_phone, shipping_address, shipping_area, shipping_city, shipping_state, shipping_country, shipping_pincode, shipping_latitude, shipping_longitude, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            clientId,
            vendorId,
            vendorSubtotal,
            vendorDiscount,
            vendorDiscount,
            deliveryCharge,
            platformFee,
            orderCommissionAmount,
            deliveryCommissionAmount,
            orderCommissionAmount,
            pricing.areaPricing.area_definition_id,
            JSON.stringify({
              area_definition_id: pricing.areaPricing.area_definition_id,
              area_name: pricing.areaPricing.area_name,
              city: pricing.areaPricing.city,
              platform_fee: platformFee,
              delivery_charge: deliveryCharge,
              commission_area: pricing.locationCommission ? pricing.locationCommission.area : null,
              commission_source: pricing.locationCommission ? (pricing.locationCommission.area === '*' ? 'city' : 'area') : 'area_definition',
              order_commission_percentage: pricing.orderCommissionPercentage,
              delivery_commission_percentage: pricing.deliveryCommissionPercentage,
            }),
            promotion.coupon ? promotion.coupon.id : null,
            promotion.code || null,
            promotion.discount ? promotion.discount.id : null,
            promotion.discount ? promotion.discount.name : null,
            'direct',
            vendorTotal,
            'pending',
            'pending',
            deliveryOptions.selected_method,
            deliveryOptions.selected_type,
            clientName,
            clientPhone,
            clientAddress || null,
            addressSnapshot.shippingAddressId,
            addressSnapshot.shippingName,
            addressSnapshot.shippingPhone,
            shippingAddress || null,
            addressSnapshot.shippingArea,
            addressSnapshot.shippingCity,
            addressSnapshot.shippingState,
            addressSnapshot.shippingCountry,
            addressSnapshot.shippingPincode,
            addressSnapshot.shippingLatitude,
            addressSnapshot.shippingLongitude,
          ]
        );

        const orderId = orderResult.insertId;
        orderIds.push(orderId);
        orderNumbers.push(orderNumber);
        vendorOrderNotifications.push({ vendorId, orderId, orderNumber, totalAmount: vendorTotal });
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
        await OrderWalletSettlement.settleOrderPlacement({
          orderId,
          actorId: clientId,
          connection,
        });
      }

      await connection.commit();
      for (const notification of vendorOrderNotifications) {
        vendorNotifications.notifyVendor(notification.vendorId, {
          type: 'order',
          id: notification.orderId,
          title: 'New order received',
          message: 'New order received',
          orderId: notification.orderId,
          orderNumber: notification.orderNumber,
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
        orderNumber: orderNumbers[0],
        orderNumbers,
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
    await syncRolesFromUsers();
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

async function advertisementAreaOptions() {
  const [areaRows] = await pool.query(
    `SELECT DISTINCT city, name AS area FROM area_definitions WHERE city IS NOT NULL AND TRIM(city) <> '' AND name IS NOT NULL AND TRIM(name) <> ''
     UNION
     SELECT DISTINCT city, area FROM client_profiles WHERE city IS NOT NULL AND TRIM(city) <> '' AND area IS NOT NULL AND TRIM(area) <> ''
     UNION
     SELECT DISTINCT city, area FROM client_delivery_addresses WHERE city IS NOT NULL AND TRIM(city) <> '' AND area IS NOT NULL AND TRIM(area) <> ''
     UNION
     SELECT DISTINCT city, area FROM delivery_partner_settings WHERE city IS NOT NULL AND TRIM(city) <> '' AND area IS NOT NULL AND TRIM(area) <> ''
     ORDER BY city, area`
  );
  return areaRows
    .map((row) => ({ city: normalizeCityName(row.city), area: normalizeCityName(row.area) }))
    .filter((row) => row.city && row.area);
}

async function googleMapsBrowserSettings() {
  const maps = await settingGroup([
    'google_maps_browser_api_key',
    'google_maps_map_id',
    'google_maps_default_origin',
  ]);
  return {
    browserApiKey: maps.google_maps_browser_api_key || process.env.GOOGLE_MAPS_BROWSER_API_KEY || '',
    mapId: maps.google_maps_map_id || '',
    defaultOrigin: maps.google_maps_default_origin || 'Jaipur, Rajasthan, India',
  };
}

app.get('/area-definitions', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  res.render('area-definitions', {
    user: req.session.user,
    shell: buildShell(req.session.user, req.path),
    maps: await googleMapsBrowserSettings(),
    cityOptions: await promotionCityOptions(),
  });
});

app.get('/area-definitions/list', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    res.json({ success: true, areas: await AreaDefinition.list({ includeInactive: true }) });
  } catch (error) {
    console.error('Area definitions load error:', error);
    res.status(500).json({ success: false, message: 'Unable to load areas' });
  }
});

app.get('/area-options', requireAuth, async (req, res) => {
  try {
    const areas = await AreaDefinition.list({ includeInactive: false });
    res.json({
      success: true,
      areas: areas
        .filter((area) => area.city && area.name)
        .map((area) => ({ id: area.id, city: area.city, area: area.name })),
    });
  } catch (error) {
    console.error('Area options load error:', error);
    res.status(500).json({ success: false, message: 'Unable to load area options' });
  }
});

app.post('/area-definitions', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const id = await AreaDefinition.save(req.body);
    res.status(201).json({ success: true, id, message: 'Area saved' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to save area' });
  }
});

app.put('/area-definitions/:id', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const id = await AreaDefinition.save({ ...req.body, id: req.params.id });
    res.json({ success: true, id, message: 'Area updated' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update area' });
  }
});

app.delete('/area-definitions/:id', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    await AreaDefinition.remove(Number(req.params.id));
    res.json({ success: true, message: 'Area deleted' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to delete area' });
  }
});

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

function requestList(value) {
  return [].concat(value || []).map((item) => String(item || '').trim()).filter(Boolean);
}

async function advertisementPayload(body) {
  const cityOptions = await promotionCityOptions();
  const cityMap = new Map(cityOptions.map((city) => [cityKey(city), city]));
  const requestedCity = String(body.city || '').trim();
  const selectedCity = requestedCity ? cityMap.get(cityKey(requestedCity)) || requestedCity : '';
  const cityScope = String(body.city_scope || 'all').toLowerCase() === 'specific' && selectedCity ? 'specific' : 'all';
  return {
    title: String(body.title || '').trim(),
    description: String(body.description || '').trim(),
    start_at: body.start_at || null,
    end_at: body.end_at || null,
    countdown_seconds: Number(body.countdown_seconds || 0),
    target_platforms: requestList(body.target_platforms),
    city_scope: cityScope,
    city: cityScope === 'specific' ? selectedCity : '',
    areas: cityScope === 'specific' ? requestList(body.areas) : [],
    status: String(body.status || 'draft').toLowerCase(),
    advertiser_name: String(body.advertiser_name || '').trim(),
    advertiser_email: String(body.advertiser_email || '').trim(),
    advertiser_phone: String(body.advertiser_phone || '').trim(),
    package_name: String(body.package_name || '').trim(),
    payment_amount: Number(body.payment_amount || 0),
    payment_status: String(body.payment_status || 'pending').toLowerCase(),
    invoice_number: String(body.invoice_number || '').trim(),
    receipt_path: String(body.receipt_path || '').trim(),
    approval_status: String(body.approval_status || 'pending').toLowerCase(),
    campaign_start_at: body.campaign_start_at || body.start_at || null,
    campaign_end_at: body.campaign_end_at || body.end_at || null,
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

app.get('/advertisements', requireAuth, requirePermission('advertisements.view'), async (req, res) => {
  res.render('advertisements', {
    user: req.session.user,
    title: 'Advertisements',
    canCreate: roleCan(req.session.user, 'advertisements.create'),
    canEdit: roleCan(req.session.user, 'advertisements.edit'),
    canDelete: roleCan(req.session.user, 'advertisements.delete'),
    cityOptions: await promotionCityOptions(),
    areaOptions: await advertisementAreaOptions(),
    platforms: Advertisement.PLATFORM_VALUES,
  });
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

app.get('/api/advertisements', webOrJwtAuth, requirePermission('advertisements.view'), async (req, res) => {
  res.json({ success: true, advertisements: await Advertisement.list() });
});

app.get('/api/advertisements/active-display', webOrJwtAuth, async (req, res) => {
  const advertisement = await Advertisement.activeForDisplay({
    platform: req.query.platform || 'client_app',
    userId: req.authUser && req.authUser.id,
    query: req.query,
  });
  res.json({ success: true, advertisement });
});

app.post('/api/advertisements', webOrJwtAuth, requirePermission('advertisements.create'), uploadAdvertisementImage.single('image'), handleAdvertisementImageUploadError, async (req, res) => {
  try {
    const id = await Advertisement.create({ ...(await advertisementPayload(req.body)), image_path: advertisementImagePath(req.file) });
    res.status(201).json({ success: true, id, message: 'Advertisement created' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to create advertisement' });
  }
});

app.put('/api/advertisements/:id', webOrJwtAuth, requirePermission('advertisements.edit'), uploadAdvertisementImage.single('image'), handleAdvertisementImageUploadError, async (req, res) => {
  try {
    await Advertisement.update(req.params.id, { ...(await advertisementPayload(req.body)), image_path: advertisementImagePath(req.file) });
    res.json({ success: true, message: 'Advertisement updated' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update advertisement' });
  }
});

app.put('/api/advertisements/:id/status', webOrJwtAuth, requirePermission('advertisements.edit'), async (req, res) => {
  try {
    await Advertisement.updateStatus(req.params.id, req.body.status);
    res.json({ success: true, message: 'Advertisement status updated' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update advertisement status' });
  }
});

app.delete('/api/advertisements/:id', webOrJwtAuth, requirePermission('advertisements.delete'), async (req, res) => {
  await Advertisement.remove(req.params.id);
  res.json({ success: true, message: 'Advertisement deleted' });
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
  const googleConfig = publicGoogleConfig();
  const firebaseAdmin = firebaseAdminStatus();
  const maps = await settingGroup([
    'google_maps_browser_api_key',
    'google_maps_android_api_key',
    'google_distance_api_key',
    'google_maps_map_id',
    'google_maps_default_origin',
    'google_maps_default_destination',
  ]);
  const quotationSubmissionMinutes = Number(await settingValue('quotation_submission_minutes', '1440')) || 1440;
  const invoiceSettings = await getInvoiceSettings();
  const canRunMaintenance = isSuperAdminUser(req.session.user) || ['admin', 'superadmin'].includes(String(req.session.user && req.session.user.role || '').toLowerCase());
  const canManageCommissions = canRunMaintenance;
  let databaseBackups = [];
  if (canRunMaintenance) {
    try {
      databaseBackups = listManualBackupFiles();
    } catch (error) {
      console.error('Database backup list error:', error);
    }
  }
  res.render('settings', {
    user: req.session.user,
    permissionLabels,
    canManageCommissions,
    maintenance: canRunMaintenance ? await getAdminMaintenanceStats() : null,
    databaseBackups,
    error: req.query.error || null,
    message: req.query.message || null,
    settings: {
      general: {
        appName: 'Grocery App',
        supportEmail: 'support@groceryapp.local',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        maintenanceMode: false,
        quotationSubmissionMinutes,
      },
      email: {
        mailDriver: 'SMTP',
        host: 'smtp.example.com',
        port: 587,
        fromEmail: 'noreply@groceryapp.local',
        encryption: 'TLS',
      },
      firebase: {
        apiKey: googleConfig.firebase.apiKey,
        authDomain: googleConfig.firebase.authDomain,
        projectId: googleConfig.firebase.projectId,
        storageBucket: googleConfig.firebase.storageBucket,
        messagingSenderId: googleConfig.firebase.messagingSenderId,
        appId: googleConfig.firebase.appId,
        measurementId: googleConfig.firebase.measurementId,
        googleWebClientId: googleConfig.webClientId,
        adminConfigured: firebaseAdmin.configured,
        adminProjectId: firebaseAdmin.projectId,
        adminClientEmail: firebaseAdmin.clientEmail,
        adminMessage: firebaseAdmin.message,
        pushNotifications: true,
      },
      maps: {
        browserApiKey: maps.google_maps_browser_api_key || process.env.GOOGLE_MAPS_BROWSER_API_KEY || '',
        androidApiKey: maps.google_maps_android_api_key || process.env.GOOGLE_MAPS_ANDROID_API_KEY || '',
        distanceApiKey: maps.google_distance_api_key || process.env.GOOGLE_DISTANCE_API_KEY || '',
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
      invoice: invoiceSettings,
    },
  });
});

app.put('/settings/quotations', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const minutes = Math.max(5, Math.min(10080, Math.round(Number(req.body.submissionMinutes || 0))));
    if (!Number.isFinite(minutes)) {
      return res.status(422).json({ success: false, message: 'Valid quotation submission time is required' });
    }
    await saveSetting('quotation_submission_minutes', String(minutes), false);
    res.json({ success: true, message: 'Quotation submission deadline saved', submissionMinutes: minutes });
  } catch (error) {
    console.error('Quotation settings save error:', error);
    res.status(500).json({ success: false, message: 'Unable to save quotation settings' });
  }
});

async function resolveAdminDebugCity(user) {
  const directCity = String((user && (user.city || user.admin_city || user.profile_city)) || '').trim();
  if (directCity) return directCity;

  const [profileRows] = await pool.query(
    `SELECT COALESCE(cp.city, vp.city, dpp.city) AS city
     FROM users u
     LEFT JOIN client_profiles cp ON cp.user_id = u.id
     LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
     LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
     WHERE u.id = ?
     LIMIT 1`,
    [user && user.id]
  ).catch(() => [[]]);
  const profileCity = String((profileRows[0] && profileRows[0].city) || '').trim();
  if (profileCity) return profileCity;

  const [cityRows] = await pool.query(
    `SELECT city
     FROM delivery_partner_settings
     WHERE city IS NOT NULL AND TRIM(city) <> ''
     GROUP BY city
     ORDER BY COUNT(*) DESC, city ASC
     LIMIT 1`
  );
  return String((cityRows[0] && cityRows[0].city) || 'Jaipur').trim();
}

app.get('/settings/debug/delivery-partner-test/partners', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const filters = {
      city: String(req.query.city || '').trim(),
      area: String(req.query.area || '').trim(),
      mobile: String(req.query.mobile || '').trim(),
      email: String(req.query.email || '').trim(),
      name: String(req.query.name || '').trim(),
    };
    const hasFilter = Object.values(filters).some(Boolean);
    const adminCity = await resolveAdminDebugCity(req.session.user);
    const where = ['u.is_deleted = 0', "LOWER(u.status) = 'active'", "LOWER(u.role) = 'deliveryperson'"];
    const params = [];

    if (!hasFilter && adminCity) {
      where.push(`EXISTS (
        SELECT 1 FROM delivery_partner_settings city_dps
        WHERE city_dps.user_id = u.id
          AND city_dps.is_active = 1
          AND LOWER(TRIM(city_dps.city)) = LOWER(TRIM(CAST(? AS TEXT)))
      )`);
      params.push(adminCity);
    }
    if (filters.city) {
      where.push(`EXISTS (
        SELECT 1 FROM delivery_partner_settings city_filter
        WHERE city_filter.user_id = u.id
          AND city_filter.is_active = 1
          AND LOWER(TRIM(city_filter.city)) = LOWER(TRIM(CAST(? AS TEXT)))
      )`);
      params.push(filters.city);
    }
    if (filters.area) {
      where.push(`EXISTS (
        SELECT 1 FROM delivery_partner_settings area_filter
        WHERE area_filter.user_id = u.id
          AND area_filter.is_active = 1
          AND (LOWER(TRIM(area_filter.area)) = LOWER(TRIM(CAST(? AS TEXT))) OR TRIM(COALESCE(area_filter.area, '*')) = '*')
      )`);
      params.push(filters.area);
    }
    if (filters.mobile) {
      where.push('u.phone ILIKE ?');
      params.push(`%${filters.mobile}%`);
    }
    if (filters.email) {
      where.push('u.email ILIKE ?');
      params.push(`%${filters.email}%`);
    }
    if (filters.name) {
      where.push('u.name ILIKE ?');
      params.push(`%${filters.name}%`);
    }

    const [partners] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone,
              COALESCE(MIN(NULLIF(TRIM(dps.city), '')), dpp.city, '') AS city,
              COALESCE(
                STRING_AGG(DISTINCT COALESCE(NULLIF(TRIM(dps.area), ''), '*'), ', ' ORDER BY COALESCE(NULLIF(TRIM(dps.area), ''), '*')),
                dpp.area,
                '*'
              ) AS area
       FROM users u
       LEFT JOIN delivery_partner_settings dps ON dps.user_id = u.id AND dps.is_active = 1
       LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
       WHERE ${where.join(' AND ')}
       GROUP BY u.id, u.name, u.email, u.phone, dpp.city, dpp.area
       ORDER BY u.name ASC, u.id ASC`,
      params
    );
    const walletBalances = new Map();
    for (const partner of partners) {
      const wallet = await Wallet.findByUserId(partner.id);
      walletBalances.set(Number(partner.id), wallet ? Number(wallet.balance || 0) : 0);
    }

    res.json({
      success: true,
      admin_city: adminCity,
      partners: partners.map((partner) => ({
        id: Number(partner.id),
        name: partner.name || '',
        city: partner.city || adminCity,
        area: partner.area || '*',
        wallet_balance: walletBalances.get(Number(partner.id)) || 0,
      })),
    });
  } catch (error) {
    console.error('Delivery partner debug list error:', error);
    res.status(500).json({ success: false, message: 'Unable to load delivery partners' });
  }
});

app.post('/settings/debug/delivery-partner-test/:partnerId/send', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  const partnerId = Number(req.params.partnerId);
  if (!partnerId) {
    return res.status(422).json({ success: false, message: 'Valid delivery partner is required' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const adminCity = await resolveAdminDebugCity(req.session.user);
    const [partnerRows] = await connection.query(
      `SELECT u.id, u.name, u.phone,
              COALESCE(NULLIF(TRIM(dps.city), ''), dpp.city, ?) AS city,
              COALESCE(NULLIF(TRIM(dps.area), ''), dpp.area, '*') AS area
       FROM users u
       LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
       LEFT JOIN delivery_partner_settings dps ON dps.user_id = u.id AND dps.is_active = 1
       WHERE u.id = ?
         AND u.is_deleted = 0
         AND LOWER(u.status) = 'active'
         AND LOWER(u.role) = 'deliveryperson'
       ORDER BY CASE WHEN COALESCE(NULLIF(TRIM(dps.area), ''), '*') = '*' THEN 1 ELSE 0 END, dps.id ASC
       LIMIT 1
       FOR UPDATE OF u`,
      [adminCity, partnerId]
    );
    if (!partnerRows.length) {
      const error = new Error('Active delivery partner not found');
      error.status = 404;
      throw error;
    }

    const partner = partnerRows[0];
    const city = String(partner.city || adminCity || 'Jaipur').trim();
    const area = String(partner.area || '*').trim() || '*';
    const actor = req.session.user;
    const pickupOtp = String(Math.floor(100000 + Math.random() * 900000));
    const deliveryOtp = String(Math.floor(100000 + Math.random() * 900000));
    const pickupAddress = `Debug pickup hub, ${city}`;
    const deliveryAddress = `Debug delivery address, ${area === '*' ? city : area}, ${city}`;
    const delivery = await DeliveryCharge.calculateCharge({
      city,
      origin: pickupAddress,
      destination: deliveryAddress,
      totalWeightKg: 1,
    }, connection);
    const deliveryCharge = Number(delivery.delivery_charge || 0);
    const notificationPayload = {
      test_delivery: true,
      vendor_name: 'Debug Test Vendor',
      vendor_phone: '',
      vendor_address: pickupAddress,
      client_name: 'Debug Test Customer',
      client_phone: '',
      client_address: deliveryAddress,
      pickup_area: city,
      delivery_area: area,
      delivery_charge: deliveryCharge,
      platform_fee: 0,
      delivery_partner_earning: deliveryCharge,
      approx_total_weight_kg: Number(delivery.total_weight_kg || 1),
    };

    const { result: orderResult, orderNumber } = await insertClientOrderWithOrderNumber(
      connection,
      `INSERT INTO client_orders
       (order_number, user_id, vendor_id, subtotal_amount, discount_amount, savings_amount, delivery_charge, order_type, total_amount, status, delivery_status, delivery_method, delivery_type, client_name, client_phone, client_address, shipping_name, shipping_phone, shipping_address, shipping_area, shipping_city, shipping_state, shipping_country, shipping_pincode, delivery_otp, pickup_otp, otp_set_by, otp_set_at, created_at)
       VALUES (?, ?, NULL, 0, 0, 0, ?, 'debug_test', 0, 'pending', 'offer_pending', 'in_house_auto', 'in_house_delivery', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        actor.id,
        deliveryCharge,
        'Debug Test Customer',
        partner.phone || '',
        deliveryAddress,
        'Debug Test Customer',
        partner.phone || '',
        deliveryAddress,
        area,
        city,
        'Rajasthan',
        'India',
        '',
        deliveryOtp,
        pickupOtp,
        actor.id,
      ]
    );
    const orderId = Number(orderResult.insertId || (orderResult.rows && orderResult.rows[0] && orderResult.rows[0].id));
    notificationPayload.order_id = orderId;
    notificationPayload.order_number = orderNumber;

    const [offerResult] = await connection.query(
      `INSERT INTO delivery_order_offers
       (order_id, delivery_person_id, status, pickup_area, delivery_area, delivery_charge, platform_fee, delivery_partner_earning, notification_payload, expires_at)
       VALUES (?, ?, 'pending', ?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP + INTERVAL '30 minutes')`,
      [orderId, partner.id, pickupAddress, deliveryAddress, deliveryCharge, deliveryCharge, JSON.stringify(notificationPayload)]
    );
    const offerId = Number(offerResult.insertId || (offerResult.rows && offerResult.rows[0] && offerResult.rows[0].id));

    await connection.query('UPDATE client_orders SET auto_delivery_offer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [offerId || null, orderId]);
    await connection.query(
      `INSERT INTO user_notifications (user_id, title, message, link)
       VALUES (?, ?, ?, ?)`,
      [
        partner.id,
        `Test delivery #${orderNumber}`,
        `Debug test delivery request from ${actor.name || 'admin'} for ${deliveryAddress}.`,
        '/api/orders/delivery/offers',
      ]
    );
    await connection.query(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
       VALUES (?, NULL, 'offer_pending', ?, ?, ?)`,
      [orderId, actor.id, actor.role || 'admin', `Debug test delivery offer sent to delivery partner #${partner.id}`]
    );

    await connection.commit();
    res.json({
      success: true,
      message: `Test delivery sent to ${partner.name}`,
      order_id: orderId,
      order_number: orderNumber,
      offer_id: offerId,
    });
  } catch (error) {
    await connection.rollback();
    console.error('Delivery partner debug send error:', error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to send test delivery' });
  } finally {
    connection.release();
  }
});

app.put('/settings/invoice', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const enabledColumns = Array.isArray(req.body.enabledProductColumns)
      ? req.body.enabledProductColumns
      : [];
    if (!enabledColumns.length) {
      return res.status(422).json({ success: false, message: 'Select at least one invoice product column' });
    }
    const settings = await saveInvoiceSettings({
      platformName: req.body.platformName,
      reverseChargeText: req.body.reverseChargeText,
      serialInfoText: req.body.serialInfoText,
      legalNote: req.body.legalNote,
      deliveryFromName: req.body.deliveryFromName,
      deliveryFromAddress: req.body.deliveryFromAddress,
      deliveryFromFssai: req.body.deliveryFromFssai,
      platformAddress: req.body.platformAddress,
      platformFssai: req.body.platformFssai,
      platformEmail: req.body.platformEmail,
      enabledProductColumns: enabledColumns,
    });
    res.json({ success: true, message: 'Invoice settings saved', settings });
  } catch (error) {
    console.error('Invoice settings save error:', error);
    res.status(500).json({ success: false, message: 'Unable to save invoice settings' });
  }
});

app.get('/settings/google-maps', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  const maps = await settingGroup([
    'google_maps_browser_api_key',
    'google_maps_android_api_key',
    'google_distance_api_key',
    'google_maps_map_id',
    'google_maps_default_origin',
    'google_maps_default_destination',
  ]);
  res.json({
    success: true,
    settings: {
      browserApiKey: maps.google_maps_browser_api_key || process.env.GOOGLE_MAPS_BROWSER_API_KEY || '',
      androidApiKey: maps.google_maps_android_api_key || process.env.GOOGLE_MAPS_ANDROID_API_KEY || '',
      distanceApiKey: maps.google_distance_api_key || process.env.GOOGLE_DISTANCE_API_KEY || '',
      mapId: maps.google_maps_map_id || '',
      defaultOrigin: maps.google_maps_default_origin || 'Jaipur, Rajasthan, India',
      defaultDestination: maps.google_maps_default_destination || 'Mansarovar, Jaipur, Rajasthan, India',
    },
  });
});

app.put('/settings/google-maps', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    await saveSetting('google_maps_browser_api_key', String(req.body.browserApiKey || '').trim(), true);
    await saveSetting('google_maps_android_api_key', String(req.body.androidApiKey || '').trim(), true);
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
    await syncRolesFromUsers();
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
                  JSON_BUILD_OBJECT('city', dps.city, 'area', COALESCE(NULLIF(TRIM(dps.area), ''), '*'), 'is_active', dps.is_active)
                  ORDER BY dps.city, dps.area
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
    const mappedAreas = await AreaDefinition.list({ includeInactive: false });
    const mappedDeliveryAreas = mappedAreas
      .filter((area) => area.name && area.city)
      .map((area) => ({
        id: area.id,
        city: area.city,
        area: area.name,
        own_delivery_active: area.own_delivery_active,
      }));
    const cityRows = [...new Set(mappedDeliveryAreas.map((area) => area.city).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right))
      .map((city) => ({ city }));
    const allAreaRows = [
      ...mappedDeliveryAreas,
      ...cityRows.map((row) => ({ city: row.city, area: '*', id: null, is_all_area: true })),
    ];
    res.json({
      success: true,
      partners,
      cities: cityRows.map((row) => row.city),
      areas: allAreaRows,
      mapped_areas: mappedDeliveryAreas,
    });
  } catch (error) {
    console.error('Delivery partner settings load error:', error);
    res.status(500).json({ success: false, message: 'Unable to load delivery partner settings' });
  }
});

function normalizeDeliveryAreaEntries(input) {
  const rawEntries = Array.isArray(input) ? input : [];
  const seen = new Set();
  const entries = [];

  for (const entry of rawEntries) {
    const city = String(
      entry && typeof entry === 'object' ? entry.city : entry
    ).trim();
    const areaValue = entry && typeof entry === 'object' ? entry.area : '*';
    const area = String(areaValue || '*').trim() || '*';
    if (!city) continue;

    const key = `${city.toLowerCase()}::${area.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ city, area });
  }

  return entries;
}

async function resolveMappedDeliveryAreaEntries(input, connection = pool) {
  const normalizedEntries = normalizeDeliveryAreaEntries(input);
  const mappedAreas = await AreaDefinition.list({ includeInactive: false });
  const mappedById = new Map(mappedAreas.map((area) => [String(area.id), area]));
  const mappedByCityArea = new Map(mappedAreas.map((area) => [
    `${String(area.city || '').trim().toLowerCase()}::${String(area.name || '').trim().toLowerCase()}`,
    area,
  ]));
  const mappedCityKeys = new Set(mappedAreas.map((area) => String(area.city || '').trim().toLowerCase()).filter(Boolean));
  const seen = new Set();
  const resolved = [];

  for (const rawEntry of Array.isArray(input) ? input : []) {
    const requestedId = rawEntry && typeof rawEntry === 'object'
      ? Number(rawEntry.area_definition_id || rawEntry.areaDefinitionId || rawEntry.id || 0)
      : 0;
    const mappedArea = requestedId ? mappedById.get(String(requestedId)) : null;
    const entry = mappedArea
      ? { city: mappedArea.city, area: mappedArea.name }
      : normalizeDeliveryAreaEntries([rawEntry])[0];
    if (!entry || !entry.city) continue;

    if (entry.area === '*' && !mappedCityKeys.has(entry.city.toLowerCase())) {
      const error = new Error(`No mapped delivery areas are defined for ${entry.city}`);
      error.status = 422;
      throw error;
    }

    if (entry.area !== '*') {
      const key = `${entry.city.toLowerCase()}::${entry.area.toLowerCase()}`;
      if (!mappedByCityArea.has(key)) {
        const error = new Error(`Delivery area "${entry.area}" in ${entry.city} is not defined on the Area Definition map page`);
        error.status = 422;
        throw error;
      }
    }

    const resolvedKey = `${entry.city.toLowerCase()}::${entry.area.toLowerCase()}`;
    if (seen.has(resolvedKey)) continue;
    seen.add(resolvedKey);
    resolved.push(entry);
  }

  for (const entry of normalizedEntries) {
    const resolvedKey = `${entry.city.toLowerCase()}::${entry.area.toLowerCase()}`;
    if (seen.has(resolvedKey)) continue;
    if (entry.area === '*' && !mappedCityKeys.has(entry.city.toLowerCase())) {
      const error = new Error(`No mapped delivery areas are defined for ${entry.city}`);
      error.status = 422;
      throw error;
    }

    if (entry.area !== '*') {
      const key = `${entry.city.toLowerCase()}::${entry.area.toLowerCase()}`;
      if (!mappedByCityArea.has(key)) {
        const error = new Error(`Delivery area "${entry.area}" in ${entry.city} is not defined on the Area Definition map page`);
        error.status = 422;
        throw error;
      }
    }
    seen.add(resolvedKey);
    resolved.push(entry);
  }

  return resolved;
}

app.post('/settings/delivery-partners', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '').trim();
  const requestedDeliveryAreas = req.body.delivery_areas || req.body.areas || req.body.cities;

  if (!name || name.length < 2) return res.status(422).json({ success: false, message: 'Name is required' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(422).json({ success: false, message: 'Valid email is required' });
  if (!password || password.length < 6) return res.status(422).json({ success: false, message: 'Password must be at least 6 characters' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const deliveryAreas = await resolveMappedDeliveryAreaEntries(requestedDeliveryAreas, connection);
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

    for (const entry of deliveryAreas) {
      await connection.query(
        `INSERT INTO delivery_partner_settings (user_id, city, area, is_active)
         VALUES (?, ?, ?, 1)`,
        [userId, entry.city, entry.area]
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
      const deliveryAreas = await resolveMappedDeliveryAreaEntries(assignment.delivery_areas || assignment.areas || assignment.cities, connection);
      if (!userId) continue;

      const [staffRows] = await connection.query(
        "SELECT id FROM users WHERE id = ? AND LOWER(role) = 'staff' AND status = 'active' AND is_deleted = 0 LIMIT 1",
        [userId]
      );
      if (!staffRows.length) continue;

      for (const entry of deliveryAreas) {
        await connection.query(
          `INSERT INTO delivery_partner_settings (user_id, city, area, is_active)
           VALUES (?, ?, ?, 1)`,
          [userId, entry.city, entry.area]
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
  const requestedDeliveryAreas = req.body.delivery_areas || req.body.areas || req.body.cities;

  if (!id) return res.status(422).json({ success: false, message: 'Valid delivery partner is required' });
  if (!name || name.length < 2) return res.status(422).json({ success: false, message: 'Name is required' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(422).json({ success: false, message: 'Valid email is required' });
  if (password && password.length < 6) return res.status(422).json({ success: false, message: 'Password must be at least 6 characters' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const deliveryAreas = await resolveMappedDeliveryAreaEntries(requestedDeliveryAreas, connection);
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
    for (const entry of deliveryAreas) {
      await connection.query(
        `INSERT INTO delivery_partner_settings (user_id, city, area, is_active)
         VALUES (?, ?, ?, 1)`,
        [id, entry.city, entry.area]
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
app.get('/settings/commissions', requireAuth, requirePermission('settings.manage'), requireAdminCommission, commissionController.list);
app.put('/settings/commissions', requireAuth, requirePermission('settings.manage'), requireAdminCommission, commissionController.update);
app.delete('/settings/commissions/location/:id', requireAuth, requirePermission('settings.manage'), requireAdminCommission, commissionController.removeLocation);
app.post('/settings/commissions/calculate', requireAuth, requirePermission('settings.manage'), requireAdminCommission, commissionController.calculate);
app.post('/settings/categories', requireAuth, requirePermission('settings.manage'), catalogController.createCategory);
app.get('/settings/categories', requireAuth, requirePermission('settings.manage'), catalogController.listCategories);
app.put('/settings/categories/:id', requireAuth, requirePermission('settings.manage'), catalogController.updateCategory);
app.delete('/settings/categories/:id', requireAuth, requirePermission('settings.manage'), catalogController.deleteCategory);
app.post('/settings/subcategories', requireAuth, requirePermission('settings.manage'), uploadSubcategoryImage.single('image'), handleSubcategoryImageUploadError, catalogController.createSubcategory);
app.get('/settings/subcategories', requireAuth, requirePermission('settings.manage'), catalogController.listSubcategories);
app.put('/settings/subcategories/:id', requireAuth, requirePermission('settings.manage'), uploadSubcategoryImage.single('image'), handleSubcategoryImageUploadError, catalogController.updateSubcategory);
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
app.post('/sub-categories', requireAuth, requirePermission('settings.manage'), uploadSubcategoryImage.single('image'), handleSubcategoryImageUploadError, catalogController.createSubcategory);
app.get('/sub-categories', requireAuth, requirePermission('settings.manage'), catalogController.listSubcategories);
app.put('/sub-categories/:id', requireAuth, requirePermission('settings.manage'), uploadSubcategoryImage.single('image'), handleSubcategoryImageUploadError, catalogController.updateSubcategory);
app.delete('/sub-categories/:id', requireAuth, requirePermission('settings.manage'), catalogController.deleteSubcategory);
app.post('/brands', requireAuth, requirePermission('settings.manage'), uploadBrandLogo.single('logo'), handleUploadError, catalogController.createBrand);
app.get('/brands', requireAuth, requirePermission('settings.manage'), catalogController.listBrands);
app.put('/brands/:id', requireAuth, requirePermission('settings.manage'), uploadBrandLogo.single('logo'), handleUploadError, catalogController.updateBrand);
app.delete('/brands/:id', requireAuth, requirePermission('settings.manage'), catalogController.deleteBrand);

app.get('/roles/create', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    await syncRolesFromUsers();
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
    await forgetDeletedRoleSlug(slug);

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
    await forgetDeletedRoleSlug(slug);

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
    await rememberDeletedRoleSlug(role[0].slug);
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

    const deliveryOfferTimer = setInterval(() => {
      Order.processExpiredDeliveryOffers().catch((error) => {
        console.error('Delivery offer handoff error:', error);
      });
    }, 15000);
    deliveryOfferTimer.unref();

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
