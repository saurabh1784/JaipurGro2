const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const systemTables = new Set([
  'schema_migrations',
  'schema_sync_runs',
  'snapshot_restore_runs',
]);

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function snapshotHash(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

async function withClient(db, task) {
  const client = await db.connect();
  try {
    return await task(client);
  } finally {
    client.release();
  }
}

async function publicTables(client, { includeSystemTables = false } = {}) {
  const result = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  return result.rows
    .map((row) => row.table_name)
    .filter((table) => includeSystemTables || !systemTables.has(table));
}

async function tableColumns(client, table) {
  const result = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return result.rows.map((row) => row.column_name);
}

async function foreignKeys(client, tables) {
  const tableSet = new Set(tables);
  const result = await client.query(
    `SELECT tc.table_name, ccu.table_name AS foreign_table_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema = 'public'`
  );
  return result.rows
    .filter((row) => tableSet.has(row.table_name) && tableSet.has(row.foreign_table_name))
    .map((row) => ({
      table: row.table_name,
      dependsOn: row.foreign_table_name,
    }));
}

function dependencyOrder(tables, dependencies) {
  const remaining = new Set(tables);
  const deps = new Map(tables.map((table) => [table, new Set()]));

  for (const dependency of dependencies) {
    if (dependency.table !== dependency.dependsOn) {
      deps.get(dependency.table).add(dependency.dependsOn);
    }
  }

  const ordered = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((table) => {
      return [...deps.get(table)].every((dependency) => !remaining.has(dependency));
    });

    if (ready.length === 0) {
      ordered.push(...[...remaining].sort());
      break;
    }

    for (const table of ready.sort()) {
      ordered.push(table);
      remaining.delete(table);
    }
  }

  return ordered;
}

async function exportSnapshot(db, outputFile) {
  return withClient(db, async (client) => {
    const tables = await publicTables(client);
    const orderedTables = dependencyOrder(tables, await foreignKeys(client, tables));
    const snapshot = {
      version: 1,
      exported_at: new Date().toISOString(),
      tables: [],
    };

    for (const table of orderedTables) {
      const columns = await tableColumns(client, table);
      const orderBy = columns.includes('id') ? ' ORDER BY "id"' : '';
      const result = await client.query(`SELECT * FROM ${quoteIdent(table)}${orderBy}`);
      snapshot.tables.push({
        name: table,
        columns,
        rows: result.rows,
      });
    }

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, JSON.stringify(snapshot, null, 2));
    return {
      file: outputFile,
      hash: snapshotHash(snapshot),
      tables: snapshot.tables.length,
    };
  });
}

async function ensureRestoreHistory(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS snapshot_restore_runs (
      id SERIAL PRIMARY KEY,
      snapshot_hash VARCHAR(80) NOT NULL UNIQUE,
      snapshot_file VARCHAR(255) NOT NULL,
      revision VARCHAR(190) DEFAULT NULL,
      restored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function snapshotAlreadyRestored(client, hash) {
  const result = await client.query(
    'SELECT id FROM snapshot_restore_runs WHERE snapshot_hash = $1 LIMIT 1',
    [hash]
  );
  return result.rowCount > 0;
}

async function resetSequences(client, tableNames) {
  for (const table of tableNames) {
    const columns = await tableColumns(client, table);
    if (!columns.includes('id')) continue;

    await client.query(
      `SELECT setval(
         pg_get_serial_sequence($1, 'id'),
         COALESCE((SELECT MAX("id") FROM ${quoteIdent(table)}), 1),
         (SELECT COUNT(*) > 0 FROM ${quoteIdent(table)})
       )`,
      [table]
    );
  }
}

function formatParamValue(val) {
  if (val === null || val === undefined) {
    return null;
  }
  if (typeof val === 'object' && !(val instanceof Date) && !Buffer.isBuffer(val)) {
    return JSON.stringify(val);
  }
  return val;
}

async function restoreSnapshot(db, snapshotFile, options = {}) {
  const resolvedFile = path.resolve(snapshotFile);
  const snapshot = JSON.parse(fs.readFileSync(resolvedFile, 'utf8'));
  const hash = snapshotHash(snapshot);
  const snapshotTables = snapshot.tables || [];

  return withClient(db, async (client) => {
    await ensureRestoreHistory(client);

    if (!options.force && await snapshotAlreadyRestored(client, hash)) {
      return {
        restored: false,
        reason: 'snapshot already restored',
        file: resolvedFile,
        hash,
      };
    }

    const existingTables = await publicTables(client);
    const snapshotTableNames = snapshotTables.map((table) => table.name);
    const existingSnapshotTables = snapshotTableNames.filter((table) => existingTables.includes(table));
    const truncateTables = existingTables.filter((table) => !systemTables.has(table));

    await client.query('BEGIN');
    try {
      if (truncateTables.length > 0) {
        await client.query(
          `TRUNCATE TABLE ${truncateTables.map(quoteIdent).join(', ')} RESTART IDENTITY CASCADE`
        );
      }

      for (const table of snapshotTables) {
        if (!existingSnapshotTables.includes(table.name) || !table.rows.length) continue;

        const columns = table.columns;
        const columnSql = columns.map(quoteIdent).join(', ');
        const valueSql = columns.map((_, index) => `$${index + 1}`).join(', ');
        const insertSql = `INSERT INTO ${quoteIdent(table.name)} (${columnSql}) VALUES (${valueSql})`;

        for (const row of table.rows) {
          const paramValues = columns.map((column) => formatParamValue(row[column]));
          await client.query(insertSql, paramValues);
        }
      }

      await resetSequences(client, existingSnapshotTables);
      await client.query(
        `INSERT INTO snapshot_restore_runs (snapshot_hash, snapshot_file, revision)
         VALUES ($1, $2, $3)
         ON CONFLICT (snapshot_hash) DO NOTHING`,
        [hash, path.relative(process.cwd(), resolvedFile), options.revision || null]
      );
      await client.query('COMMIT');

      return {
        restored: true,
        file: resolvedFile,
        hash,
        tables: existingSnapshotTables.length,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function restoreSnapshotOnStartup(db, options = {}) {
  if (String(process.env.AUTO_RESTORE_DB_SNAPSHOT || '').toLowerCase() !== 'true') {
    return null;
  }

  const snapshotFile = process.env.DB_SNAPSHOT_FILE || path.join(__dirname, 'db-snapshots', 'deploy-snapshot.json');
  if (!fs.existsSync(snapshotFile)) {
    throw new Error(`AUTO_RESTORE_DB_SNAPSHOT is true, but snapshot file was not found: ${snapshotFile}`);
  }

  const result = await restoreSnapshot(db, snapshotFile, {
    force: String(process.env.AUTO_RESTORE_DB_SNAPSHOT_ALWAYS || '').toLowerCase() === 'true',
    revision: options.revision,
  });
  console.log(result.restored ? `Database snapshot restored: ${result.hash}` : `Database snapshot skipped: ${result.reason}`);
  return result;
}

module.exports = {
  exportSnapshot,
  restoreSnapshot,
  restoreSnapshotOnStartup,
};
