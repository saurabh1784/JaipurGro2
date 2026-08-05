const pool = require('../db');
const { ensureAllSchemaTables } = require('../services/schemaSyncService');
const { seedRequiredData } = require('../services/seedService');
const { runMigrations } = require('../migrationRunner');

async function runFresh() {
  console.log('⚡ Creating complete fresh database from an empty state...');
  try {
    const [tables] = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);

    const tableNames = tables.map((t) => t.table_name).filter(Boolean);
    if (tableNames.length > 0) {
      const tableList = tableNames.map((t) => `"${t}"`).join(', ');
      await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
      console.log(`✅ Truncated ${tableNames.length} table(s) and reset auto-increment sequences.`);
    }

    await ensureAllSchemaTables(pool);
    await runMigrations(pool).catch(() => {});
    await seedRequiredData();

    console.log('✅ Complete fresh database build completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Fresh database creation failed:', err);
    process.exit(1);
  }
}

runFresh();
