const pool = require('../db');
const {
  productSeeds,
  genericProductLabels,
} = require('../data/indianCatalogSeed');

async function firstRow(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows[0] || null;
}

async function removeGeneratedDemoProducts(connection) {
  if (!genericProductLabels.length) return 0;
  const conditions = genericProductLabels.map(() => 'p.name LIKE ?').join(' OR ');
  const params = genericProductLabels.map((label) => `% ${label}`);
  const [result] = await connection.query(
    `UPDATE products p
     SET is_deleted = 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE p.is_deleted = 0
       AND (${conditions})`,
    params
  );
  return Number(result.affectedRows || result.rowCount || 0);
}

async function findRelation(connection, product) {
  return firstRow(
    connection,
    `SELECT c.id AS category_id, s.id AS sub_category_id, b.id AS brand_id
     FROM categories c
     INNER JOIN sub_categories s ON s.category_id = c.id
     INNER JOIN brands b ON b.category_id = c.id AND b.sub_category_id = s.id
     WHERE LOWER(c.name) = LOWER(?)
       AND LOWER(s.name) = LOWER(?)
       AND LOWER(b.name) = LOWER(?)
       AND c.is_deleted = 0
       AND s.is_deleted = 0
       AND b.is_deleted = 0
     LIMIT 1`,
    [product.category, product.subcategory, product.brand]
  );
}

async function upsertProduct(connection, product, adminId) {
  const relation = await findRelation(connection, product);
  if (!relation) {
    return { skipped: true, name: product.name };
  }

  const values = [
    product.description,
    product.price,
    product.weightValue,
    product.weightUnit,
    product.weightKg,
    '/default.png',
    product.taxName || 'GST',
    product.taxPercentage ?? 5,
    relation.category_id,
    relation.sub_category_id,
    relation.brand_id,
    adminId,
  ];
  const existing = await firstRow(
    connection,
    'SELECT id FROM products WHERE name = ? LIMIT 1',
    [product.name]
  );

  if (existing) {
    await connection.query(
      `UPDATE products
       SET description = ?,
           price = ?,
           weight_value = ?,
           weight_unit = ?,
           weight_kg = ?,
           image_url = ?,
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
      [...values, existing.id]
    );
    return { id: existing.id, created: false, categoryId: relation.category_id };
  }

  const [result] = await connection.query(
    `INSERT INTO products
     (name, description, price, weight_value, weight_unit, weight_kg, image_url,
      tax_name, tax_percentage, category_id, sub_category_id, brand_id,
      approval_status, approved_by, approved_at, rejection_reason, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP, NULL, 0)`,
    [product.name, ...values]
  );
  return { id: result.insertId, created: true, categoryId: relation.category_id };
}

async function addVendorInventory(connection, productId, categoryId, price) {
  const [result] = await connection.query(
    `INSERT INTO vendor_products (product_id, vendor_id, quantity, price, status)
     SELECT ?, u.id, 100, ?, 'active'
     FROM users u
     INNER JOIN vendor_categories vc ON vc.vendor_id = u.id AND vc.category_id = ?
     WHERE u.role = 'Vendor'
       AND u.status = 'active'
       AND u.is_deleted = 0
     ON CONFLICT (product_id, vendor_id) DO NOTHING`,
    [productId, price, categoryId]
  );
  return Number(result.affectedRows || result.rowCount || 0);
}

async function seedProducts() {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const admin = await firstRow(
      connection,
      "SELECT id FROM users WHERE email = ? AND LOWER(role) IN ('admin', 'superadmin') AND is_deleted = 0 ORDER BY id ASC LIMIT 1",
      ['admin@example.com']
    );
    const summary = {
      demoProductsRemoved: await removeGeneratedDemoProducts(connection),
      createdProducts: 0,
      updatedProducts: 0,
      skippedProducts: [],
      vendorInventoryRows: 0,
    };

    for (const product of productSeeds) {
      const result = await upsertProduct(connection, product, admin?.id || null);
      if (result.skipped) {
        summary.skippedProducts.push(result.name);
        continue;
      }
      if (result.created) {
        summary.createdProducts += 1;
      } else {
        summary.updatedProducts += 1;
      }
      summary.vendorInventoryRows += await addVendorInventory(
        connection,
        result.id,
        result.categoryId,
        product.price
      );
    }

    await connection.commit();
    return summary;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

seedProducts()
  .then((summary) => {
    console.log('Seeded real Indian products.');
    console.log(`Removed generated demo products: ${summary.demoProductsRemoved}`);
    console.log(`Created products: ${summary.createdProducts}`);
    console.log(`Updated products: ${summary.updatedProducts}`);
    console.log(`Vendor inventory rows added: ${summary.vendorInventoryRows}`);
    if (summary.skippedProducts.length) {
      console.log(`Skipped missing catalog relations: ${summary.skippedProducts.join(', ')}`);
    }
  })
  .catch((error) => {
    console.error(`Unable to seed products: ${pool.formatError(error)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
