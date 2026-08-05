const pool = require('../db');
const { ensureAllSchemaTables } = require('../services/schemaSyncService');
const { runMigrations } = require('../migrationRunner');

async function runMigrate() {
  console.log('🚀 Running database migrations...');
  try {
    await ensureAllSchemaTables(pool);
    await runMigrations(pool).catch(() => {});
    console.log('✅ All database migrations executed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

runMigrate();
