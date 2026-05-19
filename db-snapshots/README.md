# Deploy database snapshot

To make Render replace its data during deploy, export your local database here:

```powershell
npm run db:snapshot:export -- --file db-snapshots/deploy-snapshot.json
```

Commit and push `db-snapshots/deploy-snapshot.json`, then set these Render
environment variables:

```text
AUTO_RESTORE_DB_SNAPSHOT=true
DB_SNAPSHOT_FILE=db-snapshots/deploy-snapshot.json
```

By default, the same snapshot is restored only once. To restore the same file on
every restart, also set:

```text
AUTO_RESTORE_DB_SNAPSHOT_ALWAYS=true
```

Warning: `deploy-snapshot.json` contains database data, including user records
and password hashes. Only commit it to a private repository you trust.
