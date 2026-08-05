const { seedRequiredData } = require('../services/seedService');

async function runSeed() {
  console.log('🌱 Seeding required default database data...');
  try {
    await seedRequiredData();
    console.log('✅ Database seeding completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
}

runSeed();
