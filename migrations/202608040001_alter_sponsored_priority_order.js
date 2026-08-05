module.exports = {
  id: '202608040001_alter_sponsored_priority_order',
  name: 'Alter priority_order column in sponsored_products to integer',
  async up(db) {
    // Drop default value of priority_order if exists
    await db.query('ALTER TABLE sponsored_products ALTER COLUMN priority_order DROP DEFAULT').catch(() => {});

    // Alter column type to INTEGER safely
    await db.query(`
      ALTER TABLE sponsored_products 
      ALTER COLUMN priority_order TYPE INTEGER 
      USING (
        CASE 
          WHEN priority_order IS NULL OR TRIM(priority_order::text) = '' THEN 0 
          ELSE priority_order::text::integer 
        END
      )
    `);

    // Set new default value of 0
    await db.query('ALTER TABLE sponsored_products ALTER COLUMN priority_order SET DEFAULT 0');
  },
};
