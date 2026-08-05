const path = require('path');
const db = require('../db');
const { exportSnapshot, restoreSnapshot } = require('../databaseSnapshot');

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function defaultSnapshotFile() {
  return path.join(__dirname, '..', 'db-snapshots', 'deploy-snapshot.json');
}

async function main() {
  const command = process.argv[2];
  const file = argValue('--file') || defaultSnapshotFile();

  if (command === 'export') {
    const result = await exportSnapshot(db, file);
    console.log(`Snapshot exported: ${result.file}`);
    console.log(`Snapshot hash: ${result.hash}`);
    console.log(`Tables exported: ${result.tables}`);
    return;
  }

  if (command === 'restore') {
    if (!hasFlag('--confirm-replace')) {
      throw new Error('Refusing to restore snapshot without --confirm-replace.');
    }
    const result = await restoreSnapshot(db, file, { force: hasFlag('--force') });
    console.log(result.restored ? `Snapshot restored: ${result.hash}` : `Snapshot skipped: ${result.reason}`);
    return;
  }

  console.log(`
Database snapshot helper

Commands:
  npm run db:snapshot:export -- --file db-snapshots/deploy-snapshot.json
  npm run db:snapshot:restore -- --file db-snapshots/deploy-snapshot.json --confirm-replace

Render auto-restore env:
  AUTO_RESTORE_DB_SNAPSHOT=true
  DB_SNAPSHOT_FILE=db-snapshots/deploy-snapshot.json
`);
}

main()
  .then(() => db.end())
  .catch((error) => {
    console.error(error.message);
    db.end().finally(() => process.exit(1));
  });
