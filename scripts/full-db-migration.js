const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

function localDatabaseUrl() {
  if (process.env.LOCAL_DATABASE_URL) return process.env.LOCAL_DATABASE_URL;
  if (process.env.SOURCE_DATABASE_URL) return process.env.SOURCE_DATABASE_URL;

  const user = encodeURIComponent(envValue('DB_USER', 'postgres'));
  const password = encodeURIComponent(envValue('DB_PASSWORD', ''));
  const host = envValue('DB_HOST', 'localhost');
  const port = envValue('DB_PORT', '5432');
  const database = envValue('DB_NAME', 'jaipur_db_node');
  const auth = password ? `${user}:${password}` : user;
  return `postgresql://${auth}@${host}:${port}/${database}`;
}

function targetDatabaseUrl() {
  return process.env.TARGET_DATABASE_URL
    || process.env.RENDER_DATABASE_URL
    || argValue('--target-url');
}

function sourceDatabaseUrl() {
  return argValue('--source-url') || localDatabaseUrl();
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function defaultDumpFile() {
  return path.join(backupDir, `local-to-render-${timestamp()}.sql`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  if (result.error && result.error.code === 'ENOENT') {
    throw new Error(`${command} was not found. Install PostgreSQL client tools and add them to PATH.`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

function ensureBackupDir() {
  fs.mkdirSync(backupDir, { recursive: true });
}

function assertSafeUrls(sourceUrl, targetUrl) {
  if (!sourceUrl) throw new Error('Missing source database URL.');
  if (!targetUrl) {
    throw new Error('Missing target database URL. Set TARGET_DATABASE_URL or RENDER_DATABASE_URL.');
  }
  if (sourceUrl === targetUrl) {
    throw new Error('Source and target database URLs are the same. Refusing to replace the same database.');
  }
}

function dumpSource() {
  ensureBackupDir();
  const sourceUrl = sourceDatabaseUrl();
  const dumpFile = argValue('--file') || defaultDumpFile();

  console.log(`Creating source dump: ${dumpFile}`);
  run('pg_dump', [
    sourceUrl,
    '--format=plain',
    '--no-owner',
    '--no-privileges',
    '--clean',
    '--if-exists',
    '--file',
    dumpFile,
  ]);
  console.log(`Dump created: ${dumpFile}`);
}

function backupTarget(targetUrl) {
  ensureBackupDir();
  const targetBackupFile = path.join(backupDir, `target-before-replace-${timestamp()}.sql`);
  console.log(`Backing up target database first: ${targetBackupFile}`);
  run('pg_dump', [
    targetUrl,
    '--format=plain',
    '--no-owner',
    '--no-privileges',
    '--clean',
    '--if-exists',
    '--file',
    targetBackupFile,
  ]);
  console.log(`Target backup created: ${targetBackupFile}`);
}

function restoreIntoTarget() {
  const sourceUrl = sourceDatabaseUrl();
  const targetUrl = targetDatabaseUrl();
  const dumpFile = argValue('--file') || defaultDumpFile();

  assertSafeUrls(sourceUrl, targetUrl);

  if (!hasFlag('--confirm-replace')) {
    throw new Error('Refusing to replace target database without --confirm-replace.');
  }

  if (!fs.existsSync(dumpFile)) {
    console.log('No dump file found, creating one from the source database first.');
    process.argv.push('--file', dumpFile);
    dumpSource();
  }

  backupTarget(targetUrl);
  console.log('Resetting target public schema.');
  run('psql', [
    targetUrl,
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
  ]);

  console.log('Restoring source dump into target database.');
  run('psql', [
    targetUrl,
    '--set',
    'ON_ERROR_STOP=1',
    '--file',
    dumpFile,
  ]);
  console.log('Target database replacement complete.');
}

function printHelp() {
  console.log(`
Full database migration helper

Commands:
  node scripts/full-db-migration.js dump --file db-backups/local.sql
  node scripts/full-db-migration.js replace --file db-backups/local.sql --confirm-replace

Environment:
  LOCAL_DATABASE_URL or SOURCE_DATABASE_URL   Source/local PostgreSQL URL
  TARGET_DATABASE_URL or RENDER_DATABASE_URL  Target/Render PostgreSQL URL

Notes:
  - replace backs up the target database first.
  - replace drops and recreates the target public schema.
  - PostgreSQL client tools pg_dump and psql must be installed and on PATH.
`);
}

function main() {
  loadLocalEnv();
  const command = process.argv[2];

  if (command === 'dump') {
    dumpSource();
    return;
  }
  if (command === 'replace') {
    restoreIntoTarget();
    return;
  }
  printHelp();
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
