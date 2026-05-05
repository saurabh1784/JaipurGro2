-- Jaipur Grocery App schema for Railway MySQL.
-- Import this into the Railway MySQL database before starting the app, or let the app create it on startup.

SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  phone VARCHAR(30) UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'staff',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  theme_mode VARCHAR(20) NOT NULL DEFAULT 'light',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  parent_id INTEGER,
  level INTEGER NOT NULL DEFAULT 0,
  permissions JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  assigned_by INTEGER,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wallets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS commission_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_slug VARCHAR(100) NOT NULL,
  role_name VARCHAR(100) NOT NULL,
  transaction_type VARCHAR(50) NOT NULL,
  commission_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
  commission_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  min_commission DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  max_commission DECIMAL(10,2),
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (role_slug, transaction_type)
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  wallet_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  commission_setting_id INTEGER,
  commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  net_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  balance_before DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  reference VARCHAR(120),
  note TEXT,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (commission_setting_id) REFERENCES commission_settings(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS vendor_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  business_name VARCHAR(150),
  address TEXT,
  country VARCHAR(80),
  state VARCHAR(80),
  city VARCHAR(80),
  gst_number VARCHAR(50),
  services JSON,
  aadhaar_front_path VARCHAR(255),
  aadhaar_back_path VARCHAR(255),
  store_image_path VARCHAR(255),
  profile_image_path VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS client_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  address TEXT,
  country VARCHAR(80),
  state VARCHAR(80),
  city VARCHAR(80),
  age INTEGER,
  gender VARCHAR(30),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  permissions JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  slug VARCHAR(180) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sub_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INTEGER NOT NULL,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(180) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (category_id, name),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS brands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INTEGER NOT NULL,
  sub_category_id INTEGER NOT NULL,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(180) NOT NULL,
  logo_path VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (category_id, sub_category_id, name),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (sub_category_id) REFERENCES sub_categories(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  image_url VARCHAR(255),
  category_id INTEGER NOT NULL,
  sub_category_id INTEGER NOT NULL,
  brand_id INTEGER NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  approval_status VARCHAR(20) NOT NULL DEFAULT 'approved',
  created_by_vendor_id INTEGER,
  approved_by INTEGER,
  approved_at TIMESTAMP,
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (sub_category_id) REFERENCES sub_categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_vendor_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS vendor_products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  image_url VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_id, vendor_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vendor_client_product_prices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  custom_price DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_id, vendor_id, client_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS client_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  vendor_id INTEGER,
  total_amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  delivery_partner_id INTEGER,
  delivery_otp VARCHAR(10),
  client_name VARCHAR(100),
  client_phone VARCHAR(30),
  client_address TEXT,
  assigned_at TIMESTAMP,
  ready_at TIMESTAMP,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (delivery_partner_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS client_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INTEGER NOT NULL,
  vendor_product_id INTEGER,
  quantity DECIMAL(12,2) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES client_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_product_id) REFERENCES vendor_products(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS quotation_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INTEGER NOT NULL,
  client_city VARCHAR(80) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quotation_request_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_request_id INTEGER NOT NULL,
  vendor_product_id INTEGER,
  product_id INTEGER,
  product_name VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL,
  expected_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (quotation_request_id) REFERENCES quotation_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_product_id) REFERENCES vendor_products(id) ON DELETE SET NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS quotation_vendor_recipients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_request_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  is_seen INTEGER NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount_percent DECIMAL(7,2) NOT NULL DEFAULT 0.00,
  submitted_at TIMESTAMP,
  decided_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (quotation_request_id, vendor_id),
  FOREIGN KEY (quotation_request_id) REFERENCES quotation_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quotation_vendor_response_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_vendor_recipient_id INTEGER NOT NULL,
  quotation_request_item_id INTEGER NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  line_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (quotation_vendor_recipient_id, quotation_request_item_id),
  FOREIGN KEY (quotation_vendor_recipient_id) REFERENCES quotation_vendor_recipients(id) ON DELETE CASCADE,
  FOREIGN KEY (quotation_request_item_id) REFERENCES quotation_request_items(id) ON DELETE CASCADE
);

CREATE INDEX idx_wallets_status ON wallets (status);
CREATE INDEX idx_products_name ON products (name);
CREATE INDEX idx_products_deleted ON products (is_deleted);
CREATE INDEX idx_vendor_products_vendor ON vendor_products (vendor_id);
CREATE INDEX idx_client_orders_user ON client_orders (user_id);
CREATE INDEX idx_client_orders_vendor ON client_orders (vendor_id);
CREATE INDEX idx_quotation_vendor ON quotation_vendor_recipients (vendor_id, status);

SET FOREIGN_KEY_CHECKS=1;
