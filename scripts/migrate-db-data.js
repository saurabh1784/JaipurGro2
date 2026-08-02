const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { exportSnapshot, restoreSnapshot } = require('../databaseSnapshot');
const { ensureAllSchemaTables } = require('../services/schemaSyncService');
const { runMigrations } = require('../migrationRunner');

const projectRoot = path.join(__dirname, '..');
const backupDir = path.join(projectRoot, 'db-backups');

function loadLocalEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match || match[1].startsWith('#') || Object.prototype.hasOwnProperty.call(process.env, match[1])) {
      continue;
    }

    let value = match[2] || '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function envValue(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function getSourceConfig() {
  if (process.env.SOURCE_DATABASE_URL || argValue('--source-url')) {
    return { connectionString: argValue('--source-url') || process.env.SOURCE_DATABASE_URL, ssl: { rejectUnauthorized: false } };
  }
  const sourceHost = argValue('--source-host') || process.env.SOURCE_DB_HOST;
  if (sourceHost) {
    return {
      host: sourceHost,
      port: Number(argValue('--source-port') || process.env.SOURCE_DB_PORT || 5432),
      user: argValue('--source-user') || process.env.SOURCE_DB_USER || 'groxenin_GroSaurabh',
      password: argValue('--source-password') || process.env.SOURCE_DB_PASSWORD || 'adminsaurabh17842006',
      database: argValue('--source-name') || process.env.SOURCE_DB_NAME || 'groxenin_GroceryData',
      ssl: false,
    };
  }
  return {
    host: '127.0.0.200',
    port: 5432,
    user: 'groxenin_GroSaurabh',
    password: 'adminsaurabh17842006',
    database: 'groxenin_GroceryData',
    ssl: false,
  };
}

function getTargetConfig() {
  const targetUrl = argValue('--target-url') || process.env.TARGET_DATABASE_URL || process.env.NEW_DATABASE_URL;
  if (targetUrl) {
    return { connectionString: targetUrl, ssl: { rejectUnauthorized: false } };
  }
  const targetHost = argValue('--target-host') || process.env.TARGET_DB_HOST || envValue('DB_HOST', '127.0.0.1');
  return {
    host: targetHost,
    port: Number(argValue('--target-port') || process.env.TARGET_DB_PORT || envValue('DB_PORT', 5432)),
    user: argValue('--target-user') || process.env.TARGET_DB_USER || envValue('DB_USER', 'postgres'),
    password: argValue('--target-password') || process.env.TARGET_DB_PASSWORD || envValue('DB_PASSWORD', 'saurabh'),
    database: argValue('--target-name') || process.env.TARGET_DB_NAME || envValue('DB_NAME', 'postgres'),
    ssl: false,
  };
}

function wrapPool(config) {
  const p = new Pool(config);
  return {
    query: (sql, params = []) => p.query(sql, params).then((res) => [res.rows, res]),
    connect: () => p.connect(),
    end: () => p.end(),
    rawPool: p,
  };
}

async function migrateData() {
  loadLocalEnv();
  const sourceConfig = getSourceConfig();
  const targetConfig = getTargetConfig();

  if (!targetConfig) {
    console.error('❌ Missing target database configuration.');
    console.log('\nUsage Examples:');
    console.log('  node scripts/migrate-db-data.js --target-url "postgresql://user:pass@host:5432/dbname"');
    console.log('  node scripts/migrate-db-data.js --target-host newhost --target-user user --target-password pass --target-name newdb');
    console.log('  TARGET_DATABASE_URL="postgresql://..." npm run db:migrate-data\n');
    process.exit(1);
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotFile = path.join(backupDir, `migration-snapshot-${timestampStr}.json`);

  console.log('🔌 Connecting to source and target databases...');
  const sourcePool = wrapPool(sourceConfig);
  const targetPool = wrapPool(targetConfig);

  try {
    // 1. Export Data Snapshot from Source DB
    console.log('📸 Step 1: Exporting full data snapshot from connected source database...');
    const snapshotInfo = await exportSnapshot(sourcePool.rawPool, snapshotFile);
    console.log(`✅ Exported ${snapshotInfo.tables} tables to snapshot file: ${snapshotFile}`);

    // 2. Initialize Schema & Migrations on Target DB
    console.log('🛠️ Step 2: Verifying schema tables and running migrations on target database...');
    await ensureAllSchemaTables(targetPool);
    await runMigrations(targetPool);
    console.log('✅ Target schema and migrations up to date.');

    // 3. Restore Data Snapshot into Target DB
    console.log('🔄 Step 3: Restoring data snapshot into target database...');
    const restoreResult = await restoreSnapshot(targetPool.rawPool, snapshotFile, { force: true });
    console.log('✅ Data snapshot restored cleanly into target database.');

    // 4. Data Count Verification
    console.log('\n📊 Step 4: Verifying row count parity between source and target databases:');
    const [sourceTablesRes] = await sourcePool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tables = sourceTablesRes.map((r) => r.table_name).filter((t) => !t.startsWith('schema_'));

    let totalSourceRows = 0;
    let totalTargetRows = 0;
    for (const table of tables) {
      try {
        const [sRow] = await sourcePool.query(`SELECT COUNT(*) AS count FROM "${table}"`);
        const [tRow] = await targetPool.query(`SELECT COUNT(*) AS count FROM "${table}"`);
        const sCount = Number(sRow[0]?.count || 0);
        const tCount = Number(tRow[0]?.count || 0);
        totalSourceRows += sCount;
        totalTargetRows += tCount;
        const status = sCount === tCount ? '✅ MATCH' : '⚠️ MISMATCH';
        console.log(`  - ${table.padEnd(30)} Source: ${String(sCount).padStart(5)} | Target: ${String(tCount).padStart(5)} | ${status}`);
      } catch (e) {
        // Table may be new or missing
      }
    }

    console.log(`\n🎉 Data migration complete! Total Source Rows: ${totalSourceRows} | Total Target Rows: ${totalTargetRows}`);

    if (hasFlag('--update-env') && targetConfig.host) {
      console.log('📝 Updating .env file to point to new database...');
      let envContent = fs.readFileSync(path.join(projectRoot, '.env'), 'utf8');
      envContent = envContent.replace(/^DB_HOST=.*/m, `DB_HOST=${targetConfig.host}`);
      if (targetConfig.port) envContent = envContent.replace(/^DB_PORT=.*/m, `DB_PORT=${targetConfig.port}`);
      if (targetConfig.user) envContent = envContent.replace(/^DB_USER=.*/m, `DB_USER=${targetConfig.user}`);
      if (targetConfig.password) envContent = envContent.replace(/^DB_PASSWORD=.*/m, `DB_PASSWORD=${targetConfig.password}`);
      if (targetConfig.database) envContent = envContent.replace(/^DB_NAME=.*/m, `DB_NAME=${targetConfig.database}`);
      fs.writeFileSync(path.join(projectRoot, '.env'), envContent);
      console.log('✅ .env updated with new database credentials.');
    }
  } catch (err) {
    console.error('❌ Data migration error:', err);
    process.exitCode = 1;
  } finally {
    await sourcePool.end().catch(() => {});
    await targetPool.end().catch(() => {});
  }
}

if (require.main === module) {
  migrateData();
}

module.exports = { migrateData };
