const db = require('../db');
const { runMigrations } = require('../migrationRunner');

async function main() {
  await db.ensureDatabase();
  await runMigrations(db);
}

main()
  .then(async () => {
    await db.end();
  })
  .catch(async (error) => {
    console.error(`Migration failed: ${error.message}`);
    await db.end();
    process.exit(1);
  });
