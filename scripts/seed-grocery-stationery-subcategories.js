const pool = require('../db');
const {
  catalogSeed,
  vendorCategoryAssignments,
} = require('../data/indianCatalogSeed');

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function firstRow(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows[0] || null;
}

async function seedCatalog() {
  const connection = await pool.getConnection();
  const allowedCategories = catalogSeed.map(([categoryName]) => categoryName);

  try {
    await connection.beginTransaction();

    await connection.query(
      `UPDATE categories
       SET is_deleted = 1, status = 'inactive', is_active = 0
       WHERE name NOT IN (${allowedCategories.map(() => '?').join(',')})`,
      allowedCategories
    );

    const summary = {};
    for (const [categoryName, subcategories] of catalogSeed) {
      await connection.query(
        `INSERT INTO categories (name, slug, tax_name, tax_percentage, status, is_active)
         VALUES (?, ?, 'GST', 5.00, 'active', 1)
         ON CONFLICT (name) DO UPDATE
         SET slug = EXCLUDED.slug,
             is_deleted = 0,
             status = 'active',
             is_active = 1`,
        [categoryName, slugify(categoryName)]
      );

      const category = await firstRow(
        connection,
        'SELECT id FROM categories WHERE name = ? AND is_deleted = 0 LIMIT 1',
        [categoryName]
      );
      let subcategoryCount = 0;
      let brandCount = 0;

      for (const [subcategoryName, brands] of Object.entries(subcategories)) {
        await connection.query(
          `INSERT INTO sub_categories (category_id, name, slug, status, is_active)
           VALUES (?, ?, ?, 'active', 1)
           ON CONFLICT (category_id, name) DO UPDATE
           SET slug = EXCLUDED.slug,
               is_deleted = 0,
               status = 'active',
               is_active = 1`,
          [category.id, subcategoryName, slugify(subcategoryName)]
        );

        const subcategory = await firstRow(
          connection,
          'SELECT id FROM sub_categories WHERE category_id = ? AND name = ? AND is_deleted = 0 LIMIT 1',
          [category.id, subcategoryName]
        );
        subcategoryCount += 1;

        for (const brandName of brands) {
          await connection.query(
            `INSERT INTO brands (category_id, sub_category_id, name, slug, status, is_active)
             VALUES (?, ?, ?, ?, 'active', 1)
             ON CONFLICT (category_id, sub_category_id, name) DO UPDATE
             SET slug = EXCLUDED.slug,
                 is_deleted = 0,
                 status = 'active',
                 is_active = 1`,
            [category.id, subcategory.id, brandName, slugify(brandName)]
          );
          brandCount += 1;
        }
      }

      summary[categoryName] = { subcategoryCount, brandCount };
    }

    await connection.query(`
      INSERT INTO vendor_categories (vendor_id, category_id)
      SELECT u.id, c.id
      FROM users u
      INNER JOIN categories c ON c.name IN (${allowedCategories.map(() => '?').join(',')}) AND c.is_deleted = 0
      LEFT JOIN vendor_categories existing ON existing.vendor_id = u.id
      WHERE u.role = 'Vendor'
        AND u.is_deleted = 0
        AND existing.vendor_id IS NULL
      ON CONFLICT (vendor_id, category_id) DO NOTHING
    `, allowedCategories);

    for (const assignment of vendorCategoryAssignments) {
      await connection.query(
        `INSERT INTO vendor_categories (vendor_id, category_id)
         SELECT u.id, c.id
         FROM users u
         INNER JOIN categories c ON c.name IN (${assignment.categories.map(() => '?').join(',')})
          AND c.is_deleted = 0
          AND c.status = 'active'
         WHERE LOWER(u.email) = LOWER(?)
           AND LOWER(u.role) = 'vendor'
           AND u.is_deleted = 0
         ON CONFLICT (vendor_id, category_id) DO NOTHING`,
        [...assignment.categories, assignment.email]
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

seedCatalog()
  .then((summary) => {
    console.log('Seeded Indian main categories, sub-categories, and brands.');
    for (const [category, counts] of Object.entries(summary)) {
      console.log(`${category}: ${counts.subcategoryCount} sub-categories, ${counts.brandCount} brands`);
    }
  })
  .catch((error) => {
    console.error(`Unable to seed catalog: ${pool.formatError(error)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
