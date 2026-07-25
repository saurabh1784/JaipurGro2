const pool = require('../db');

// Initialize Vendor Inventory Tables & Schema Migrations
async function initVendorInventorySystem() {
  try {
    // 1. Add missing columns to vendor_product_variants if needed
    const columns = [
      { name: 'approval_status', type: "VARCHAR(20) NOT NULL DEFAULT 'pending'" },
      { name: 'approval_note', type: 'TEXT DEFAULT NULL' },
      { name: 'approved_by', type: 'INTEGER DEFAULT NULL REFERENCES users(id)' },
      { name: 'approved_at', type: 'TIMESTAMP DEFAULT NULL' },
      { name: 'low_stock_limit', type: 'INTEGER NOT NULL DEFAULT 10' },
      { name: 'reserved_stock', type: 'INTEGER NOT NULL DEFAULT 0' },
      { name: 'status', type: "VARCHAR(20) NOT NULL DEFAULT 'active'" },
      { name: 'sku', type: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'barcode', type: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'supporting_document', type: 'VARCHAR(255) DEFAULT NULL' }
    ];

    for (const col of columns) {
      const [colCheck] = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'vendor_product_variants' AND column_name = ?",
        [col.name]
      );
      if (!colCheck.length) {
        await pool.query(`ALTER TABLE vendor_product_variants ADD COLUMN ${col.name} ${col.type}`);
      }
    }

    // 2. Create vendor_inventory_transactions table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendor_inventory_transactions (
        id SERIAL PRIMARY KEY,
        vendor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
        transaction_type VARCHAR(30) NOT NULL,
        quantity INTEGER NOT NULL,
        stock_before INTEGER NOT NULL,
        stock_after INTEGER NOT NULL,
        reference_type VARCHAR(50) DEFAULT NULL,
        reference_id VARCHAR(100) DEFAULT NULL,
        note TEXT DEFAULT NULL,
        created_by INTEGER DEFAULT NULL REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Backfill existing vendor_product_variants to approval_status = 'approved' if currently unassigned
    await pool.query(
      "UPDATE vendor_product_variants SET approval_status = 'approved' WHERE approval_status IS NULL OR approval_status = ''"
    );

    console.log('Vendor Inventory & Variation Approval System Initialized Cleanly!');
  } catch (err) {
    console.error('Error initializing Vendor Inventory System:', err);
  }
}

// Log Inventory Transaction Helper
async function recordTransaction({
  vendor_id,
  product_variant_id,
  transaction_type,
  quantity,
  stock_before,
  stock_after,
  reference_type = null,
  reference_id = null,
  note = null,
  created_by = null
}) {
  const [res] = await pool.query(
    `INSERT INTO vendor_inventory_transactions
       (vendor_id, product_variant_id, transaction_type, quantity, stock_before, stock_after, reference_type, reference_id, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      vendor_id,
      product_variant_id,
      transaction_type,
      quantity,
      stock_before,
      stock_after,
      reference_type,
      reference_id,
      note,
      created_by || vendor_id
    ]
  );
  return res.insertId || (res[0] && res[0].id);
}

// Check vendor eligibility for bidding/quoting
async function isVendorVariantApprovedAndAvailable(vendor_id, product_variant_id, requested_quantity = 1) {
  const [rows] = await pool.query(
    `SELECT vpv.*, pv.variant_name, p.name as product_name
     FROM vendor_product_variants vpv
     INNER JOIN product_variants pv ON pv.id = vpv.product_variant_id
     INNER JOIN products p ON p.id = vpv.product_id
     WHERE vpv.vendor_id = ? AND vpv.product_variant_id = ? AND vpv.status = 'active'`,
    [vendor_id, product_variant_id]
  );

  if (!rows.length) {
    return { eligible: false, message: 'This product variation is not approved or is out of stock.' };
  }

  const vpv = rows[0];

  if (vpv.approval_status !== 'approved') {
    return { eligible: false, message: 'This product variation is not approved or is out of stock.' };
  }

  if (!vpv.is_available) {
    return { eligible: false, message: 'This product variation is not approved or is out of stock.' };
  }

  const availableStock = Math.max(0, parseInt(vpv.stock_quantity, 10) - parseInt(vpv.reserved_stock || 0, 10));
  if (availableStock < requested_quantity) {
    return { eligible: false, message: 'This product variation is not approved or is out of stock.' };
  }

  return { eligible: true, vendorVariant: vpv };
}

module.exports = {
  initVendorInventorySystem,
  recordTransaction,
  isVendorVariantApprovedAndAvailable
};
