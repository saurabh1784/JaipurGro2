const pool = require('../db');

// Convert measurement value + unit to weight in grams
function calculateWeightInGrams(value, unit) {
  const numericVal = parseFloat(value) || 0;
  if (!numericVal) return 0;
  const cleanUnit = String(unit || 'kg').trim().toLowerCase();

  if (['kg', 'kilogram', 'kilograms', 'l', 'liter', 'liters', 'litre', 'litres'].includes(cleanUnit)) {
    return Math.round(numericVal * 1000);
  }
  if (['g', 'gram', 'grams', 'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'].includes(cleanUnit)) {
    return Math.round(numericVal);
  }
  // Default estimate fallback if unit is pieces/packs
  return Math.round(numericVal);
}

// System Tables & Migration Initialization
async function initProductVariantsSystem() {
  try {
    // 1. Ensure has_variants column on products table
    const [hasVarCols] = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'has_variants'"
    );
    if (!hasVarCols.length) {
      await pool.query('ALTER TABLE products ADD COLUMN has_variants SMALLINT NOT NULL DEFAULT 0');
    }

    // 2. variation_types table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS variation_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(80) NOT NULL UNIQUE,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_by INTEGER DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. variation_values table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS variation_values (
        id SERIAL PRIMARY KEY,
        variation_type_id INTEGER NOT NULL REFERENCES variation_types(id) ON DELETE CASCADE,
        value VARCHAR(100) NOT NULL,
        unit VARCHAR(50) DEFAULT NULL,
        numeric_value DECIMAL(12,4) DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_by INTEGER DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uniq_variation_type_value_unit UNIQUE (variation_type_id, value, unit)
      )
    `);

    // 4. product_variants table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_variants (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        variant_name VARCHAR(255) NOT NULL,
        sku VARCHAR(100) DEFAULT NULL,
        barcode VARCHAR(100) DEFAULT NULL,
        mrp DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        variation_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        sale_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        weight_in_grams INTEGER NOT NULL DEFAULT 0,
        measurement_value DECIMAL(10,3) NOT NULL DEFAULT 0.000,
        measurement_unit VARCHAR(20) NOT NULL DEFAULT 'kg',
        image VARCHAR(255) DEFAULT NULL,
        is_default SMALLINT NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. product_variant_values table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_variant_values (
        id SERIAL PRIMARY KEY,
        product_variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
        variation_type_id INTEGER NOT NULL REFERENCES variation_types(id) ON DELETE CASCADE,
        variation_value_id INTEGER NOT NULL REFERENCES variation_values(id) ON DELETE CASCADE,
        CONSTRAINT uniq_product_variant_type_val UNIQUE (product_variant_id, variation_type_id, variation_value_id)
      )
    `);

    // 6. vendor_product_variants table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendor_product_variants (
        id SERIAL PRIMARY KEY,
        vendor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        product_variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
        vendor_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        mrp DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        minimum_order_quantity INTEGER NOT NULL DEFAULT 1,
        maximum_order_quantity INTEGER NOT NULL DEFAULT 100,
        is_available SMALLINT NOT NULL DEFAULT 1,
        is_approved SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uniq_vendor_product_variant UNIQUE (vendor_id, product_variant_id)
      )
    `);

    // 7. cart_items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        vendor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        product_variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uniq_cart_user_vendor_variant UNIQUE (user_id, vendor_id, product_variant_id)
      )
    `);

    // Add product_variant_id to quotation_request_items if missing
    const [quotCols] = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'quotation_request_items' AND column_name = 'product_variant_id'"
    );
    if (!quotCols.length) {
      await pool.query('ALTER TABLE quotation_request_items ADD COLUMN product_variant_id INTEGER NULL REFERENCES product_variants(id) ON DELETE SET NULL');
    }

    // Add variant columns to client_order_items if missing
    const [ordCols] = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'client_order_items' AND column_name = 'product_variant_id'"
    );
    if (!ordCols.length) {
      await pool.query('ALTER TABLE client_order_items ADD COLUMN product_variant_id INTEGER NULL REFERENCES product_variants(id) ON DELETE SET NULL');
      await pool.query('ALTER TABLE client_order_items ADD COLUMN variant_name VARCHAR(255) DEFAULT NULL');
      await pool.query('ALTER TABLE client_order_items ADD COLUMN unit VARCHAR(50) DEFAULT NULL');
      await pool.query('ALTER TABLE client_order_items ADD COLUMN weight_in_grams INTEGER NOT NULL DEFAULT 0');
    }

    // Seed Default Variation Types
    const defaultTypes = [
      { name: 'Weight', code: 'weight' },
      { name: 'Volume', code: 'volume' },
      { name: 'Pack Quantity', code: 'pack_quantity' },
      { name: 'Size', code: 'size' },
      { name: 'Packaging Type', code: 'packaging_type' },
      { name: 'Flavour', code: 'flavour' },
    ];

    for (const dt of defaultTypes) {
      await pool.query(
        `INSERT INTO variation_types (name, code, status) VALUES (?, ?, 'active') ON CONFLICT (code) DO NOTHING`,
        [dt.name, dt.code]
      );
    }

    // Seed Default Variation Values for Weight & Volume
    const [weightType] = await pool.query("SELECT id FROM variation_types WHERE code = 'weight' LIMIT 1");
    if (weightType.length) {
      const weightValId = weightType[0].id;
      const weightValues = [
        { value: '250', unit: 'g', numeric_value: 250 },
        { value: '500', unit: 'g', numeric_value: 500 },
        { value: '1', unit: 'kg', numeric_value: 1 },
        { value: '2', unit: 'kg', numeric_value: 2 },
        { value: '5', unit: 'kg', numeric_value: 5 },
        { value: '10', unit: 'kg', numeric_value: 10 },
      ];
      for (const wv of weightValues) {
        await pool.query(
          `INSERT INTO variation_values (variation_type_id, value, unit, numeric_value)
           VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          [weightValId, wv.value, wv.unit, wv.numeric_value]
        );
      }
    }

    const [volType] = await pool.query("SELECT id FROM variation_types WHERE code = 'volume' LIMIT 1");
    if (volType.length) {
      const volValId = volType[0].id;
      const volValues = [
        { value: '250', unit: 'ml', numeric_value: 250 },
        { value: '500', unit: 'ml', numeric_value: 500 },
        { value: '1', unit: 'L', numeric_value: 1 },
        { value: '2', unit: 'L', numeric_value: 2 },
        { value: '5', unit: 'L', numeric_value: 5 },
      ];
      for (const vv of volValues) {
        await pool.query(
          `INSERT INTO variation_values (variation_type_id, value, unit, numeric_value)
           VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          [volValId, vv.value, vv.unit, vv.numeric_value]
        );
      }
    }

    // Seed Default Packaging Types
    const [packType] = await pool.query("SELECT id FROM variation_types WHERE code = 'packaging_type' LIMIT 1");
    if (packType.length) {
      const packValId = packType[0].id;
      const packValues = ['Pouch', 'Bottle', 'Jar', 'Bag', 'Box', 'Can'];
      for (const pv of packValues) {
        await pool.query(
          `INSERT INTO variation_values (variation_type_id, value, unit, numeric_value)
           VALUES (?, ?, 'piece', 1) ON CONFLICT DO NOTHING`,
          [packValId, pv]
        );
      }
    }

    // 8. BACKFILL DEFAULT VARIANTS FOR EXISTING PRODUCTS
    const [productsWithoutVariants] = await pool.query(`
      SELECT p.id, p.name, p.price, p.weight_value, p.weight_unit, p.weight_kg, p.image_url
      FROM products p
      LEFT JOIN product_variants pv ON pv.product_id = p.id
      WHERE pv.id IS NULL
    `);

    for (const prod of productsWithoutVariants) {
      const weightVal = Number(prod.weight_value || prod.weight_kg || 1);
      const weightUnit = String(prod.weight_unit || 'kg').trim();
      const weightGrams = calculateWeightInGrams(weightVal, weightUnit);

      const [insRes] = await pool.query(
        `INSERT INTO product_variants
           (product_id, variant_name, sku, mrp, variation_price, sale_price, stock_quantity, weight_in_grams, measurement_value, measurement_unit, image, is_default, status)
         VALUES (?, ?, ?, ?, ?, ?, 100, ?, ?, ?, ?, 1, 'active')`,
        [
          prod.id,
          'Default',
          `DEF-${prod.id}`,
          parseFloat(prod.price) || 0.0,
          parseFloat(prod.price) || 0.0,
          parseFloat(prod.price) || 0.0,
          weightGrams,
          weightVal,
          weightUnit,
          prod.image_url || null,
        ]
      );
      const variantId = insRes.insertId;

      // Link vendor_products to vendor_product_variants
      const [vpRows] = await pool.query('SELECT * FROM vendor_products WHERE product_id = ?', [prod.id]);
      for (const vp of vpRows) {
        await pool.query(
          `INSERT INTO vendor_product_variants
             (vendor_id, product_id, product_variant_id, vendor_price, mrp, stock_quantity, is_available, is_approved)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1) ON CONFLICT DO NOTHING`,
          [vp.vendor_id, prod.id, variantId, parseFloat(vp.price || prod.price), parseFloat(prod.price), parseInt(vp.quantity, 10) || 0]
        );
      }
    }

    console.log('Product Variants System Initialized & Backfilled Cleanly!');
  } catch (err) {
    console.error('Error initializing Product Variants System:', err);
  }
}

// Fetch all variation types with their options
async function getAllVariationTypes() {
  const [types] = await pool.query("SELECT * FROM variation_types WHERE status = 'active' ORDER BY name ASC");
  for (const t of types) {
    const [vals] = await pool.query(
      "SELECT * FROM variation_values WHERE variation_type_id = ? AND status = 'active' ORDER BY numeric_value ASC, value ASC",
      [t.id]
    );
    t.values = vals;
  }
  return types;
}

// Create new variation type
async function createVariationType({ name, code, created_by }) {
  const cleanName = String(name || '').trim();
  const cleanCode = String(code || cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_')).trim();
  const [res] = await pool.query(
    'INSERT INTO variation_types (name, code, created_by) VALUES (?, ?, ?)',
    [cleanName, cleanCode, created_by || null]
  );
  return res.insertId;
}

// Create new variation value (for quick-add or management)
async function createVariationValue({ variation_type_id, value, unit, numeric_value, created_by }) {
  const cleanVal = String(value || '').trim();
  const cleanUnit = String(unit || '').trim();
  const numVal = parseFloat(numeric_value) || parseFloat(cleanVal) || 0;

  const [res] = await pool.query(
    `INSERT INTO variation_values (variation_type_id, value, unit, numeric_value, created_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (variation_type_id, value, unit) DO UPDATE SET status = 'active'
     RETURNING id`,
    [variation_type_id, cleanVal, cleanUnit, numVal, created_by || null]
  );
  const valId = (res[0] && res[0].id) || res.insertId;

  const [rows] = await pool.query('SELECT * FROM variation_values WHERE id = ?', [valId]);
  return rows[0];
}

// Fetch all variants for a product
async function getVariantsByProductId(productId) {
  const [variants] = await pool.query(
    "SELECT * FROM product_variants WHERE product_id = ? AND status = 'active' ORDER BY is_default DESC, id ASC",
    [productId]
  );

  for (const v of variants) {
    v.price = parseFloat(v.variation_price || v.sale_price || 0);
    v.mrp = parseFloat(v.mrp || 0);
    v.stock = parseInt(v.stock_quantity, 10) || 0;
    v.weight_in_grams = parseInt(v.weight_in_grams, 10) || 0;

    // Calculate base unit price (e.g. 5 kg for $20 = $4/kg)
    const mVal = parseFloat(v.measurement_value) || 1;
    v.unit_price = mVal > 0 ? parseFloat((v.price / mVal).toFixed(2)) : v.price;

    const [valRows] = await pool.query(
      `SELECT pvv.*, vt.name as type_name, vt.code as type_code, vv.value as val_text, vv.unit as val_unit
       FROM product_variant_values pvv
       INNER JOIN variation_types vt ON vt.id = pvv.variation_type_id
       INNER JOIN variation_values vv ON vv.id = pvv.variation_value_id
       WHERE pvv.product_variant_id = ?`,
      [v.id]
    );
    v.combination_values = valRows;
  }
  return variants;
}

// Get single variant details
async function getVariantById(variantId) {
  const [rows] = await pool.query('SELECT * FROM product_variants WHERE id = ?', [variantId]);
  if (!rows.length) return null;
  const v = rows[0];
  v.price = parseFloat(v.variation_price || v.sale_price || 0);
  v.mrp = parseFloat(v.mrp || 0);
  v.stock = parseInt(v.stock_quantity, 10) || 0;
  v.weight_in_grams = parseInt(v.weight_in_grams, 10) || 0;
  const mVal = parseFloat(v.measurement_value) || 1;
  v.unit_price = mVal > 0 ? parseFloat((v.price / mVal).toFixed(2)) : v.price;
  return v;
}

// Save variants for a product (handles both Simple product without variants and Product with variations)
async function saveProductVariants(productId, hasVariants, variantsData, defaultProductInfo = {}) {
  const isHasVar = Boolean(hasVariants && hasVariants !== '0' && hasVariants !== 'false');

  // Update has_variants status on product
  await pool.query('UPDATE products SET has_variants = ? WHERE id = ?', [isHasVar ? 1 : 0, productId]);

  if (!isHasVar) {
    // 1. Simple Product: Ensure single hidden default variant exists
    const [existingDefault] = await pool.query(
      'SELECT id FROM product_variants WHERE product_id = ? AND is_default = 1 LIMIT 1',
      [productId]
    );

    const price = parseFloat(defaultProductInfo.price) || 0.0;
    const mrp = parseFloat(defaultProductInfo.mrp || defaultProductInfo.price) || 0.0;
    const stock = parseInt(defaultProductInfo.stock, 10) || 100;
    const sku = String(defaultProductInfo.sku || `DEF-${productId}`).trim();
    const barcode = String(defaultProductInfo.barcode || '').trim();
    const weightVal = parseFloat(defaultProductInfo.weight_value) || 1;
    const weightUnit = String(defaultProductInfo.weight_unit || 'kg').trim();
    const weightGrams = calculateWeightInGrams(weightVal, weightUnit);

    let defaultVariantId;
    if (existingDefault.length) {
      defaultVariantId = existingDefault[0].id;
      await pool.query(
        `UPDATE product_variants
         SET variant_name = 'Default', sku = ?, barcode = ?, mrp = ?, variation_price = ?, sale_price = ?,
             stock_quantity = ?, weight_in_grams = ?, measurement_value = ?, measurement_unit = ?, status = 'active'
         WHERE id = ?`,
        [sku, barcode, mrp, price, price, stock, weightGrams, weightVal, weightUnit, defaultVariantId]
      );
    } else {
      const [insRes] = await pool.query(
        `INSERT INTO product_variants
           (product_id, variant_name, sku, barcode, mrp, variation_price, sale_price, stock_quantity, weight_in_grams, measurement_value, measurement_unit, is_default, status)
         VALUES (?, 'Default', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active')`,
        [productId, sku, barcode, mrp, price, price, stock, weightGrams, weightVal, weightUnit]
      );
      defaultVariantId = insRes.insertId;
    }

    // Disable any non-default variants for this product
    await pool.query("UPDATE product_variants SET status = 'disabled' WHERE product_id = ? AND is_default = 0", [productId]);

    return [defaultVariantId];
  } else {
    // 2. Multi-Variant Product: Process array of variants
    const processedVariantIds = [];

    if (!Array.isArray(variantsData) || !variantsData.length) {
      return [];
    }

    // Mark old default variant as non-default
    await pool.query('UPDATE product_variants SET is_default = 0 WHERE product_id = ?', [productId]);

    for (let index = 0; index < variantsData.length; index++) {
      const v = variantsData[index];
      const variantId = v.id ? parseInt(v.id, 10) : null;
      const vName = String(v.variant_name || `${v.value || ''} ${v.unit || ''}`).trim() || `Variant ${index + 1}`;
      const sku = String(v.sku || `SKU-${productId}-${index + 1}`).trim();
      const barcode = String(v.barcode || '').trim();
      const price = parseFloat(v.variation_price || v.price) || 0.0;
      const mrp = parseFloat(v.mrp || v.variation_price || v.price) || 0.0;
      const stock = parseInt(v.stock_quantity || v.stock, 10) || 0;
      const mVal = parseFloat(v.measurement_value || v.value) || 1.0;
      const mUnit = String(v.measurement_unit || v.unit || 'kg').trim();
      const weightGrams = parseInt(v.weight_in_grams, 10) || calculateWeightInGrams(mVal, mUnit);
      const isDef = index === 0 ? 1 : 0; // First variant is primary/default

      let savedVariantId;
      if (variantId) {
        await pool.query(
          `UPDATE product_variants
           SET variant_name = ?, sku = ?, barcode = ?, mrp = ?, variation_price = ?, sale_price = ?,
               stock_quantity = ?, weight_in_grams = ?, measurement_value = ?, measurement_unit = ?,
               is_default = ?, status = 'active'
           WHERE id = ? AND product_id = ?`,
          [vName, sku, barcode, mrp, price, price, stock, weightGrams, mVal, mUnit, isDef, variantId, productId]
        );
        savedVariantId = variantId;
      } else {
        const [ins] = await pool.query(
          `INSERT INTO product_variants
             (product_id, variant_name, sku, barcode, mrp, variation_price, sale_price, stock_quantity, weight_in_grams, measurement_value, measurement_unit, is_default, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
          [productId, vName, sku, barcode, mrp, price, price, stock, weightGrams, mVal, mUnit, isDef]
        );
        savedVariantId = ins.insertId;
      }

      // Link variation type + value if provided
      if (v.variation_type_id && v.variation_value_id) {
        await pool.query(
          `INSERT INTO product_variant_values (product_variant_id, variation_type_id, variation_value_id)
           VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
          [savedVariantId, v.variation_type_id, v.variation_value_id]
        );
      }

      processedVariantIds.push(savedVariantId);
    }

    // Disable variants that were omitted in update
    if (processedVariantIds.length) {
      await pool.query(
        `UPDATE product_variants SET status = 'disabled' WHERE product_id = ? AND id NOT IN (${processedVariantIds.join(',')})`,
        [productId]
      );
    }

    return processedVariantIds;
  }
}

module.exports = {
  calculateWeightInGrams,
  initProductVariantsSystem,
  getAllVariationTypes,
  createVariationType,
  createVariationValue,
  getVariantsByProductId,
  getVariantById,
  saveProductVariants,
};
