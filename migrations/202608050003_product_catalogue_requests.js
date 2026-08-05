module.exports = {
  id: '202608050003_product_catalogue_requests',
  name: 'Add governed MRP revision and product request fields',
  async up(db) {
    await db.query(`CREATE TABLE IF NOT EXISTS mrp_revision_requests (
      id BIGSERIAL PRIMARY KEY,
      vendor_id BIGINT NOT NULL REFERENCES users(id),
      product_id BIGINT NOT NULL REFERENCES products(id),
      product_variant_id BIGINT NULL REFERENCES product_variants(id),
      current_mrp NUMERIC(12,2) NOT NULL,
      proposed_mrp NUMERIC(12,2) NOT NULL,
      reason VARCHAR(500) NOT NULL,
      proof_image_url VARCHAR(500),
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      admin_reason VARCHAR(500),
      reviewed_by BIGINT NULL REFERENCES users(id),
      reviewed_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_mrp_revision_vendor_status
      ON mrp_revision_requests(vendor_id, status)`);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mrp_revision_one_pending
      ON mrp_revision_requests(vendor_id, product_id, COALESCE(product_variant_id, 0))
      WHERE status = 'pending'`);

    const additions = [
      ['request_reason', 'VARCHAR(500)'],
      ['barcode', 'VARCHAR(255)'],
      ['pack_size', 'VARCHAR(100)'],
      ['admin_change_reason', 'VARCHAR(500)']
    ];
    for (const [column, type] of additions) {
      await db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ${column} ${type}`);
    }
  },
};
