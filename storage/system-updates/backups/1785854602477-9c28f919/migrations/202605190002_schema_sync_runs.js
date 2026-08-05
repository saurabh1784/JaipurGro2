module.exports = {
  id: '202605190002_schema_sync_runs',
  name: 'Create schema sync run history',
  async up(db) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_sync_runs (
        id SERIAL PRIMARY KEY,
        revision VARCHAR(190) NOT NULL,
        synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  },
};
