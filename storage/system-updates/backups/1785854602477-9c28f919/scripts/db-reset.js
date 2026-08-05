const pool = require('../db');
const { cleanEntireDatabase } = require('../services/databaseCleanerService');
const { ensureAllSchemaTables } = require('../services/schemaSyncService');
const { seedRequiredData } = require('../services/seedService');

async function runReset() {
  console.log('🔄 Resetting database: Cleaning data, ensuring schema, and seeding defaults...');
  try {
    await cleanEntireDatabase({ bypassPasswordCheck: true });
    await ensureAllSchemaTables(pool);
    await seedRequiredData();
    console.log('✅ Database reset completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Reset failed:', err);
    process.exit(1);
  }
}

runReset();
