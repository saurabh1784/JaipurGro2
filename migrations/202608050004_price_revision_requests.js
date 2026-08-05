module.exports = {
  id: '202608050004_price_revision_requests',
  name: 'Add vendor price revision workflow and configurable low stock limits',
  async up(db) {
    await db.query('ALTER TABLE vendor_products ADD COLUMN IF NOT EXISTS low_stock_limit INTEGER NOT NULL DEFAULT 10');
    await db.query(`CREATE TABLE IF NOT EXISTS price_revision_requests (
      id BIGSERIAL PRIMARY KEY,
      vendor_id BIGINT NOT NULL REFERENCES users(id),
      vendor_product_id BIGINT NOT NULL REFERENCES vendor_products(id),
      product_id BIGINT NOT NULL REFERENCES products(id),
      vendor_city VARCHAR(100),
      current_price NUMERIC(12,2) NOT NULL,
      proposed_price NUMERIC(12,2) NOT NULL,
      reason VARCHAR(500) NOT NULL,
      proof_url VARCHAR(500),
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      reviewer_reason VARCHAR(500),
      reviewed_by BIGINT NULL REFERENCES users(id),
      reviewed_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.query('CREATE INDEX IF NOT EXISTS idx_price_revision_vendor ON price_revision_requests(vendor_id, created_at DESC)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_price_revision_city_status ON price_revision_requests(vendor_city, status)');
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_price_revision_pending
      ON price_revision_requests(vendor_id, vendor_product_id) WHERE status = 'pending'`);
  },
};
