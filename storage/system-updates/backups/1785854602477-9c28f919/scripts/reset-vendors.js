const bcrypt = require('bcryptjs');
const pool = require('../db');

const vendors = [
  {
    name: 'Grocery Vendor 1',
    email: 'vendor1@example.com',
    phone: '9000000101',
    businessName: 'Grocery Fresh Store',
    categories: ['Grocery'],
    services: ['Home Delivery', 'Counter Pickup'],
  },
  {
    name: 'Stationery Vendor 2',
    email: 'vendor2@example.com',
    phone: '9000000102',
    businessName: 'Stationery Point',
    categories: ['Stationery'],
    services: ['Counter Pickup'],
  },
  {
    name: 'Mixed Vendor 3',
    email: 'vendor3@example.com',
    phone: '9000000103',
    businessName: 'Grocery Stationery Hub',
    categories: ['Grocery', 'Stationery', 'Pet Care'],
    services: ['Home Delivery', 'Counter Pickup', 'Wholesale Supply'],
  },
  {
    name: 'Grocery Vendor 4',
    email: 'vendor4@example.com',
    phone: '9000000104',
    businessName: 'Daily Grocery Mart',
    categories: ['Grocery'],
    services: ['Home Delivery'],
  },
  {
    name: 'Mixed Vendor 5',
    email: 'vendor5@example.com',
    phone: '9000000105',
    businessName: 'Wholesale Supply Center',
    categories: ['Grocery', 'Stationery', 'Pet Care'],
    services: ['Home Delivery', 'Counter Pickup', 'Wholesale Supply'],
  },
];

async function requireCategoryMap(connection) {
  const categoryNames = [...new Set(vendors.flatMap((vendor) => vendor.categories))];
  const [rows] = await connection.query(
    `SELECT id, name
     FROM categories
     WHERE name IN (${categoryNames.map(() => '?').join(',')})
       AND is_deleted = 0
       AND status = 'active'`,
    categoryNames
  );

  const categoryMap = new Map(rows.map((row) => [row.name, row.id]));
  const missing = categoryNames.filter((name) => !categoryMap.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing active categories: ${missing.join(', ')}. Run seed-grocery-stationery-subcategories.js first.`);
  }

  return categoryMap;
}

async function resetVendors() {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const categoryMap = await requireCategoryMap(connection);
    const [oldVendorRows] = await connection.query(
      "SELECT id FROM users WHERE LOWER(role) = 'vendor'"
    );
    const oldVendorIds = oldVendorRows.map((row) => row.id);

    if (oldVendorIds.length > 0) {
      await connection.query(
        `UPDATE client_orders
         SET vendor_id = NULL
         WHERE vendor_id IN (${oldVendorIds.map(() => '?').join(',')})`,
        oldVendorIds
      );
      await connection.query(
        `UPDATE discounts
         SET vendor_id = NULL
         WHERE vendor_id IN (${oldVendorIds.map(() => '?').join(',')})`,
        oldVendorIds
      );
      await connection.query(
        `DELETE FROM users
         WHERE id IN (${oldVendorIds.map(() => '?').join(',')})`,
        oldVendorIds
      );
    }

    const passwordHash = await bcrypt.hash('admin123', 10);
    const created = [];

    for (const vendor of vendors) {
      const [result] = await connection.query(
        `INSERT INTO users (name, email, phone, password, role, status)
         VALUES (?, ?, ?, ?, 'Vendor', 'active')`,
        [vendor.name, vendor.email, vendor.phone, passwordHash]
      );
      const vendorId = result.insertId;

      await connection.query(
        `INSERT INTO vendor_profiles (user_id, business_name, address, country, state, city, gst_number, services)
         VALUES (?, ?, 'Demo vendor address', 'India', 'Rajasthan', 'Jaipur', NULL, ?)`,
        [vendorId, vendor.businessName, JSON.stringify(vendor.services)]
      );
      await connection.query(
        `INSERT INTO wallets (user_id, balance, currency, status)
         VALUES (?, 0.00, 'INR', 'active')
         ON CONFLICT (user_id) DO NOTHING`,
        [vendorId]
      );

      for (const categoryName of vendor.categories) {
        await connection.query(
          `INSERT INTO vendor_categories (vendor_id, category_id)
           VALUES (?, ?)
           ON CONFLICT (vendor_id, category_id) DO NOTHING`,
          [vendorId, categoryMap.get(categoryName)]
        );
      }

      created.push({ ...vendor, id: vendorId });
    }

    await connection.commit();
    return { removed: oldVendorIds.length, created };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

resetVendors()
  .then(({ removed, created }) => {
    console.log(`Removed existing vendors: ${removed}`);
    console.log(`Created vendors: ${created.length}`);
    for (const vendor of created) {
      console.log(`${vendor.email} / admin123 -> categories: ${vendor.categories.join(', ')}; services: ${vendor.services.join(', ')}`);
    }
  })
  .catch((error) => {
    console.error(`Unable to reset vendors: ${pool.formatError(error)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
