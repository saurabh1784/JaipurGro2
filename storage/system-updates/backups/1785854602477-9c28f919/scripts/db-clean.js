const { cleanEntireDatabase } = require('../services/databaseCleanerService');

async function runClean() {
  console.log('🧹 Cleaning all application database data (retaining ONLY Superadmin)...');
  try {
    const result = await cleanEntireDatabase({ bypassPasswordCheck: true });
    console.log(`✅ ${result.message}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Clean database failed:', err);
    process.exit(1);
  }
}

runClean();
