const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const os = require('os');
const path = require('path');
const pool = require('./db');
const initializeSchema = require('./dbSchema');
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
const registrationController = require('./controllers/registrationController');
const Wallet = require('./models/Wallet');
const Product = require('./models/Product');
const VendorProduct = require('./models/VendorProduct');
const User = require('./models/User');
const Quotation = require('./models/Quotation');
const Catalog = require('./models/Catalog');
const CommissionSetting = require('./models/CommissionSetting');
const {
  uploadBrandLogo,
  handleUploadError,
} = require('./middleware/brandLogoUpload');
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
app.set('trust proxy', 1);
const port = process.env.PORT || 3000;
const permissionLabels = {
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
};

const roleSeeds = [
  {
    name: 'Super Admin',
    slug: 'superadmin',
    description: 'Full system access with every management permission.',
    level: 0,
    permissions: ['all'],
  },
  {
    name: 'Admin',
    slug: 'admin',
    description: 'Administrative access for users, roles, products, orders, and reports.',
    level: 1,
    permissions: ['dashboard.view', 'users.manage', 'roles.manage', 'clients.manage', 'vendors.manage', 'products.manage', 'wallets.view', 'wallets.manage', 'orders.manage', 'reports.view'],
  },
  {
    name: 'Manager',
    slug: 'manager',
    description: 'Operational access for products, orders, and reporting.',
    level: 2,
    permissions: ['dashboard.view', 'clients.manage', 'vendors.manage', 'products.manage', 'wallets.view', 'wallets.manage', 'orders.manage', 'reports.view'],
  },
  {
    name: 'Staff',
    slug: 'staff',
    description: 'Store team access for day-to-day order handling.',
    level: 3,
    permissions: ['dashboard.view', 'wallets.view', 'orders.manage'],
  },
  {
    name: 'Vendor',
    slug: 'Vendor',
    description: 'Vendor portal access for inventory, quotations, orders, and wallet.',
    level: 4,
    permissions: ['dashboard.view', 'wallets.view'],
  },
  {
    name: 'Client',
    slug: 'Client',
    description: 'Client portal access for shopping, quotations, orders, and wallet.',
    level: 4,
    permissions: ['dashboard.view', 'wallets.view'],
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

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
if (process.env.VERCEL) {
  app.use('/uploads', express.static(path.join(os.tmpdir(), 'uploads')));
}
app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true });
});
app.get('/default.png', (req, res) => {
  res.type('image/svg+xml').send(`
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
      <rect width="320" height="240" fill="#f1f5f9"/>
      <rect x="96" y="54" width="128" height="132" rx="14" fill="#d8dee6"/>
      <path d="M122 96h76M122 122h76M122 148h52" stroke="#64748b" stroke-width="10" stroke-linecap="round"/>
    </svg>
  `);
});

function createSessionStore() {
  class MySqlSessionStore extends session.Store {
    constructor() {
      super();
      this.ready = null;
    }

    ensureReady() {
      if (!this.ready) {
        this.ready = pool.query(`
          CREATE TABLE IF NOT EXISTS sessions (
            sid VARCHAR(128) NOT NULL PRIMARY KEY,
            expires BIGINT NOT NULL,
            data LONGTEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `)
          .then(() => {
            if (pool.dbType === 'postgres') {
              return pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires)');
            }
            return pool.query('CREATE INDEX idx_sessions_expires ON sessions (expires)').catch((error) => {
              if (error && (error.code === 'ER_DUP_KEYNAME' || error.errno === 1061)) return null;
              throw error;
            });
          })
          .catch((error) => {
          this.ready = null;
          throw error;
        });
      }

      return this.ready;
    }

    get(sid, callback) {
      this.ensureReady()
        .then(() => pool.query('SELECT data FROM sessions WHERE sid = ? AND expires > ? LIMIT 1', [sid, Date.now()]))
        .then(([rows]) => {
          if (!rows.length) {
            callback(null, null);
            return;
          }

          callback(null, JSON.parse(rows[0].data));
        })
        .catch(callback);
    }

    set(sid, sess, callback) {
      const expires = this.getExpires(sess);
      this.ensureReady()
        .then(() => pool.query(
          `REPLACE INTO sessions (sid, expires, data)
           VALUES (?, ?, ?)`,
          [sid, expires, JSON.stringify(sess)]
        ))
        .then(() => callback && callback(null))
        .catch((error) => callback && callback(error));
    }

    destroy(sid, callback) {
      this.ensureReady()
        .then(() => pool.query('DELETE FROM sessions WHERE sid = ?', [sid]))
        .then(() => callback && callback(null))
        .catch((error) => callback && callback(error));
    }

    touch(sid, sess, callback) {
      const expires = this.getExpires(sess);
      this.ensureReady()
        .then(() => pool.query('UPDATE sessions SET expires = ?, data = ? WHERE sid = ?', [expires, JSON.stringify(sess), sid]))
        .then(() => callback && callback(null))
        .catch((error) => callback && callback(error));
    }

    getExpires(sess) {
      if (sess.cookie && sess.cookie.expires) {
        return new Date(sess.cookie.expires).getTime();
      }

      if (sess.cookie && sess.cookie.maxAge) {
        return Date.now() + Number(sess.cookie.maxAge);
      }

      return Date.now() + 1000 * 60 * 60;
    }
  }

  return new MySqlSessionStore();
}

app.use(
  session({
    store: createSessionStore(),
    secret: process.env.SESSION_SECRET || 'jaipur_role_based_login_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  })
);

app.use(async (req, res, next) => {
  try {
    await ensureDatabaseReady();
    next();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    res.status(500).send('Database initialization failed. Check MYSQL_PUBLIC_URL and database access.');
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);

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

function roleCan(user, permission) {
  return Boolean(user && (user.permissions.includes('all') || user.permissions.includes(permission)));
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }

  res.redirect('/');
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (roleCan(req.session.user, permission)) {
      return next();
    }

    res.status(403).render('dashboard', {
      user: req.session.user,
      dashboard: buildDashboard(req.session.user, req.path),
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
       ON DUPLICATE KEY UPDATE is_deleted = 0, status = 'active', is_active = 1, slug = VALUES(slug)`,
      [categoryName, categorySlug]
    );
    const [categoryRows] = await pool.query('SELECT id FROM categories WHERE name = ? LIMIT 1', [categoryName]);
    const categoryId = categoryRows[0].id;

    for (const [subcategoryName, brands] of Object.entries(subcategories)) {
      await pool.query(
        `INSERT INTO sub_categories (category_id, name, slug, status, is_active)
         VALUES (?, ?, ?, 'active', 1)
         ON DUPLICATE KEY UPDATE is_deleted = 0, status = 'active', is_active = 1, slug = VALUES(slug)`,
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
           ON DUPLICATE KEY UPDATE is_deleted = 0, status = 'active', is_active = 1, slug = VALUES(slug)`,
          [categoryId, subcategoryId, brandName, slugify(brandName)]
        );
      }
    }
  }
}

async function initDatabase() {
  await initializeSchema(pool);

  await seedGroceryCatalog();

  for (const role of roleSeeds) {
    await pool.query(
      `INSERT INTO roles (name, slug, description, level, permissions)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         description = VALUES(description),
         level = VALUES(level),
         permissions = VALUES(permissions)`,
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
      await pool.query('UPDATE users SET role = ?, phone = COALESCE(phone, ?) WHERE id = ?', [
        seedUser.role,
        seedUser.phone || null,
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

  await Wallet.ensureForAllUsers(pool);
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

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    password: user.password,
    themeMode: user.theme_mode || 'light',
    role: primaryRole.slug,
    roleName: primaryRole.name,
    roles: normalizedRoles,
    permissions,
  };
}

function navItem(label, href, permission, icon, active) {
  return { label, href, permission, icon, active };
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
    navItem('Reports', '#', 'reports.view', 'reports', false),
    navItem('Settings', '/settings', 'settings.manage', 'settings', activePath.startsWith('/settings')),
  ].filter((item) => can(item.permission));

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

  if (user.role === 'Vendor') {
    const quotationCount = await Quotation.pendingCountForVendor(user.id);
    if (quotationCount > 0) {
      dashboard.notifications.push({
        message: 'New quotation found.',
        href: '/vendor/quotations',
        count: quotationCount,
      });
      dashboard.tasks.unshift('New quotation found.');
    }
  }

  return dashboard;
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

app.get('/register/vendor', registrationController.showVendor);
app.post('/register/vendor', registrationController.storeVendor);
app.get('/register/client', registrationController.showClient);
app.post('/register/client', registrationController.storeClient);

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

    const user = {
      id: rawUser.id,
      name: rawUser.name,
      email: rawUser.email,
      themeMode: rawUser.theme_mode || 'light',
      role: rawUser.role,
      roleName: rawUser.role,
      roles: [{ id: null, name: rawUser.role, slug: rawUser.role, level: 99, permissions: ['dashboard.view', 'wallets.view'] }],
      permissions: ['dashboard.view', 'wallets.view'],
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
    error: null,
  });
});

app.get('/vendor/dashboard', requireSessionRole('Vendor', '/login/vendor'), async (req, res) => {
  res.render('dashboard', {
    user: req.session.user,
    dashboard: await buildDashboardData(req.session.user, req.path),
    error: null,
  });
});

app.get('/client/dashboard', requireSessionRole('Client', '/login/client'), async (req, res) => {
  res.render('dashboard', {
    user: req.session.user,
    dashboard: await buildDashboardData(req.session.user, req.path),
    error: null,
  });
});

app.get('/vendor/quotations', requireSessionRole('Vendor', '/login/vendor'), async (req, res) => {
  try {
    const quotations = await Quotation.listForVendor(req.session.user.id);
    await Quotation.markSeenForVendor(req.session.user.id);
    res.render('vendor-quotations', {
      user: req.session.user,
      shell: buildShell(req.session.user, req.path),
      quotations,
    });
  } catch (error) {
    console.error('Vendor quotations error:', error);
    res.status(500).send('Unable to load quotations');
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

app.post('/client/quotations/:recipientId/:decision', requireSessionRole('Client', '/login/client'), async (req, res) => {
  try {
    const decision = req.params.decision === 'accept' ? 'accepted' : req.params.decision === 'reject' ? 'rejected' : null;
    if (!decision) {
      return res.status(422).json({ success: false, message: 'Decision must be accept or reject' });
    }
    const result = await Quotation.decideClientResponse({
      recipientId: Number(req.params.recipientId),
      clientId: req.session.user.id,
      decision,
    });
    return res.json({ success: true, message: decision === 'accepted' ? 'Quotation accepted and order created' : 'Quotation rejected', result });
  } catch (error) {
    console.error('Client quotation decision error:', error);
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

app.post('/client/quotations', webOrJwtAuth, requireSessionRole('Client', '/login/client'), async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No items in quotation request' });
    }

    const quotation = await Quotation.createForCityVendors({
      clientId: req.authUser.id,
      items,
    });

    return res.json({
      success: true,
      message: `Quotation sent to ${quotation.vendorCount} vendor${quotation.vendorCount === 1 ? '' : 's'} in ${quotation.city}`,
      quotation,
    });
  } catch (error) {
    console.error('Quotation request error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to send quotation',
    });
  }
});

app.post('/client/orders', webOrJwtAuth, requireSessionRole('Client', '/login/client'), async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No items in order' });
    }

    const clientId = req.authUser.id;

    const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const clientWallet = await Wallet.findByUserId(clientId);

    if (clientWallet.balance < totalAmount) {
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [orderResult] = await connection.query(
        'INSERT INTO client_orders (user_id, total_amount, status, created_at) VALUES (?, ?, ?, NOW())',
        [clientId, totalAmount, 'pending']
      );

      const orderId = orderResult.insertId;

      for (const item of items) {
        const vpId = item.vendorProductId || item.id;
        const [vpRows] = await connection.query(
          'SELECT product_id, vendor_id, quantity FROM vendor_products WHERE id = ? FOR UPDATE',
          [vpId]
        );

        if (!vpRows.length) {
          throw new Error(`Product not found: ${vpId}`);
        }

        const vp = vpRows[0];
        if (vp.quantity < item.quantity) {
          throw new Error(`Insufficient stock for product: ${vpId}`);
        }

        await connection.query(
          'INSERT INTO client_order_items (order_id, vendor_product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
          [orderId, vpId, item.quantity, item.price]
        );

        await connection.query(
          'UPDATE vendor_products SET quantity = quantity - ? WHERE id = ?',
          [item.quantity, vpId]
        );
      }

      await Wallet.adjustBalance({
        userId: clientId,
        type: 'debit',
        amount: totalAmount,
        note: `Order #${orderId}`,
        reference: `client_order_${orderId}`,
        createdBy: clientId,
      });

      await connection.commit();
      res.json({ success: true, orderId, message: 'Order placed successfully' });
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

app.get('/settings', requireAuth, requirePermission('settings.manage'), (req, res) => {
  res.render('settings', {
    user: req.session.user,
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
  const permissions = JSON.stringify([].concat(req.body.permissions || []));

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

let databaseReadyPromise;

function ensureDatabaseReady() {
  if (!databaseReadyPromise) {
    databaseReadyPromise = initDatabase().catch((error) => {
      databaseReadyPromise = undefined;
      throw error;
    });
  }

  return databaseReadyPromise;
}

async function startServer() {
  await ensureDatabaseReady();
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  });
}

module.exports = app;
 
