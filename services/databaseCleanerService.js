const pool = require('../db');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const VendorProduct = require('../models/VendorProduct');
const dashboardCache = require('./dashboardCacheService');

async function cleanEntireDatabase({ superadminUserId, password, bypassPasswordCheck = false }) {
  if (!superadminUserId && !bypassPasswordCheck) {
    throw new Error('Superadmin user ID is required.');
  }

  let superadminUser = null;
  if (superadminUserId) {
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [superadminUserId]);
    superadminUser = users && users[0];
  }

  if (!superadminUser && !bypassPasswordCheck) {
    const [superadmins] = await pool.query("SELECT * FROM users WHERE LOWER(role) = 'superadmin' OR LOWER(role) = 'super admin' ORDER BY id ASC LIMIT 1");
    superadminUser = superadmins && superadmins[0];
  }

  if (!bypassPasswordCheck) {
    if (!password || !String(password).trim()) {
      const error = new Error('Superadmin password is required for security verification.');
      error.status = 400;
      throw error;
    }
    if (!superadminUser || !superadminUser.password) {
      const error = new Error('Superadmin user account not found for password verification.');
      error.status = 404;
      throw error;
    }
    const isValid = bcrypt.compareSync(String(password).trim(), superadminUser.password);
    if (!isValid) {
      const error = new Error('Invalid Superadmin password. Action denied.');
      error.status = 401;
      throw error;
    }
  }

  const retainedUserId = superadminUser ? superadminUser.id : null;

  try {
    // 1. Order, quotation & delivery data
    await pool.query('DELETE FROM client_order_items').catch(() => {});
    await pool.query('DELETE FROM client_order_status_logs').catch(() => {});
    await pool.query('DELETE FROM client_orders').catch(() => {});
    await pool.query('DELETE FROM quotation_items').catch(() => {});
    await pool.query('DELETE FROM quotation_status_logs').catch(() => {});
    await pool.query('DELETE FROM client_quotations').catch(() => {});
    await pool.query('DELETE FROM delivery_addresses').catch(() => {});

    // 2. Customer activity, ratings & search indexes
    await pool.query('DELETE FROM ratings').catch(() => {});
    await pool.query('DELETE FROM user_recent_activity').catch(() => {});
    await pool.query('DELETE FROM product_ranking_scores').catch(() => {});
    await pool.query('DELETE FROM product_keywords').catch(() => {});

    // 3. Products, variants, inventory, categories & brands
    await pool.query('DELETE FROM sponsored_products').catch(() => {});
    await pool.query('DELETE FROM product_variant_values').catch(() => {});
    await pool.query('DELETE FROM product_variants').catch(() => {});
    await pool.query('DELETE FROM vendor_inventory').catch(() => {});
    await pool.query('DELETE FROM vendor_products').catch(() => {});
    await pool.query('DELETE FROM products').catch(() => {});
    await pool.query('DELETE FROM brands').catch(() => {});
    await pool.query('DELETE FROM sub_categories').catch(() => {});
    await pool.query('DELETE FROM categories').catch(() => {});
    await pool.query('DELETE FROM vendor_categories').catch(() => {});
    await pool.query('DELETE FROM vendor_category_requests').catch(() => {});

    // 4. App promotions, advertisements & coupons
    await pool.query('DELETE FROM app_promotions').catch(() => {});
    await pool.query('DELETE FROM app_advertisements').catch(() => {});
    await pool.query('DELETE FROM coupon_usage_history').catch(() => {});
    await pool.query('DELETE FROM coupons').catch(() => {});

    // 5. Wallets & reports
    await pool.query('DELETE FROM wallet_transactions').catch(() => {});
    await pool.query('DELETE FROM wallets').catch(() => {});
    await pool.query('DELETE FROM gst_report_files').catch(() => {});

    // 6. Support tickets & vendor requests
    await pool.query('DELETE FROM ticket_replies').catch(() => {});
    await pool.query('DELETE FROM support_tickets').catch(() => {});
    await pool.query('DELETE FROM vendor_deletion_requests').catch(() => {});

    // 7. User profiles (keep Superadmin profile if exists, delete others)
    if (retainedUserId) {
      await pool.query('DELETE FROM vendor_profiles WHERE user_id != ?', [retainedUserId]).catch(() => {});
      await pool.query('DELETE FROM client_profiles WHERE user_id != ?', [retainedUserId]).catch(() => {});
      await pool.query('DELETE FROM delivery_person_profiles WHERE user_id != ?', [retainedUserId]).catch(() => {});
    } else {
      await pool.query('DELETE FROM vendor_profiles').catch(() => {});
      await pool.query('DELETE FROM client_profiles').catch(() => {});
      await pool.query('DELETE FROM delivery_person_profiles').catch(() => {});
    }

    // 8. Delete users keeping ONLY Superadmin
    if (retainedUserId) {
      await pool.query('DELETE FROM users WHERE id != ?', [retainedUserId]).catch(() => {});
    } else {
      await pool.query("DELETE FROM users WHERE LOWER(role) != 'superadmin' AND LOWER(role) != 'super admin'").catch(() => {});
    }

    // Reset sequence generators where applicable
    const sequences = [
      'products_id_seq',
      'vendor_products_id_seq',
      'categories_id_seq',
      'sub_categories_id_seq',
      'brands_id_seq',
      'client_orders_id_seq',
      'client_order_items_id_seq',
      'client_quotations_id_seq',
      'quotation_items_id_seq',
      'app_promotions_id_seq',
      'app_advertisements_id_seq',
      'coupons_id_seq',
      'support_tickets_id_seq',
    ];
    for (const seq of sequences) {
      await pool.query(`ALTER SEQUENCE IF EXISTS "${seq}" RESTART WITH 1`).catch(() => {});
    }

    // Clear memory caches
    if (VendorProduct.invalidateVisibleProductsCache) {
      VendorProduct.invalidateVisibleProductsCache();
    }
    if (dashboardCache && typeof dashboardCache.clear === 'function') {
      dashboardCache.clear();
    }

    // Clean uploaded product files
    const uploadDirs = [
      path.join(__dirname, '..', 'public', 'uploads', 'products'),
      path.join(__dirname, '..', 'public', 'uploads', 'vendor_products'),
      path.join(__dirname, '..', 'public', 'uploads', 'brands'),
      path.join(__dirname, '..', 'public', 'uploads', 'subcategories'),
      path.join(__dirname, '..', 'public', 'uploads', 'promotions'),
      path.join(__dirname, '..', 'public', 'uploads', 'advertisements'),
    ];
    for (const dir of uploadDirs) {
      if (fs.existsSync(dir)) {
        try {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            if (file !== '.gitkeep' && file !== 'default.png') {
              fs.unlinkSync(path.join(dir, file));
            }
          }
        } catch (_) {}
      }
    }

    return {
      success: true,
      message: 'Database cleaned successfully. Only the Superadmin account has been retained.',
      retainedUserId,
    };
  } catch (err) {
    console.error('[Clean Entire Database Error]:', err);
    throw new Error('Database clean failed: ' + err.message);
  }
}

module.exports = {
  cleanEntireDatabase,
};
