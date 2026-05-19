const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, 'migrations');
const migrationLockKey = 'jaipurgro2_schema_migrations';

async function ensureMigrationTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(190) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function loadAppliedMigrationIds(db) {
  const [rows] = await db.query('SELECT id FROM schema_migrations ORDER BY id');
  return new Set(rows.map((row) => row.id));
}

function migrationFiles() {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.js'))
    .sort()
    .map((file) => path.join(migrationsDir, file));
}

async function runSingleMigration(db, migrationFile) {
  const migration = require(migrationFile);
  const id = migration.id || path.basename(migrationFile, '.js');
  const name = migration.name || id;

  if (!migration || typeof migration.up !== 'function') {
    throw new Error(`Migration ${path.basename(migrationFile)} must export an up(db) function`);
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await migration.up(connection);
    await connection.query(
      'INSERT INTO schema_migrations (id, name) VALUES (?, ?)',
      [id, name]
    );
    await connection.commit();
    console.log(`Migration applied: ${id}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function runMigrations(db) {
  await db.query('SELECT pg_advisory_lock(hashtext(?))', [migrationLockKey]);

  try {
    await ensureMigrationTable(db);
    const appliedIds = await loadAppliedMigrationIds(db);
    const pendingFiles = migrationFiles().filter((file) => {
      const migration = require(file);
      const id = migration.id || path.basename(file, '.js');
      return !appliedIds.has(id);
    });

    if (pendingFiles.length === 0) {
      console.log('Database migrations are up to date.');
      return;
    }

    for (const file of pendingFiles) {
      await runSingleMigration(db, file);
    }
  } finally {
    await db.query('SELECT pg_advisory_unlock(hashtext(?))', [migrationLockKey]);
  }
}

module.exports = {
  runMigrations,
};
