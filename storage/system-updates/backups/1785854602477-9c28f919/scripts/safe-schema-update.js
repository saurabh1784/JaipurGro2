const db = require('../db');
const { ensureAllSchemaTables } = require('../services/schemaSyncService');
const { runMigrations } = require('../migrationRunner');

async function main() {
  process.env.DB_DATA_SAFE_MODE = 'true';
  process.env.DB_SCHEMA_STRICT = 'true';

  const config = db.describeConfig();
  console.log('Starting data-safe database schema update...');
  console.log(`Database: ${config.host}:${config.port}/${config.database}`);
  console.log('Existing rows will be preserved. Seeding is disabled.');

  await db.ensureDatabase();
  await db.query('SELECT 1');
  await ensureAllSchemaTables(db);
  await runMigrations(db);
  console.log('Data-safe database schema update completed successfully.');
}

main()
  .then(async () => db.end())
  .catch(async (error) => {
    console.error(`Data-safe schema update failed: ${error.message}`);
    await db.end().catch(() => {});
    process.exit(1);
  });
