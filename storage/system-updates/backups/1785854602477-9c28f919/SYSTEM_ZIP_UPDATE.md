# Backend ZIP updates

Only a Super Admin can apply an update from **System Settings → Server Backups → ZIP System Update**.

## ZIP structure

The ZIP must contain this backend's `package.json` and its `main` file at the archive root. A single wrapping folder is also accepted.

```text
backend-update.zip
  package.json
  package-lock.json
  app.js
  controllers/
  models/
  routes/
  services/
  views/
  public/
  migrations/
```

Incremental ZIPs are supported, but they must still include `package.json` and the configured main file. Files missing from a ZIP are left unchanged.

## Preserved runtime data

The updater never replaces `.env`, `.git`, `node_modules`, `uploads`, `storage`, `backups`, `db-backups`, or `db-snapshots`.

Before applying files it saves every replaced file under `storage/system-updates/backups/<update-id>`. If copying fails, it restores changed files and removes files created by the failed update. History is stored in `storage/system-updates/history.json`.

After a successful upload, restart the managed Node process so it loads the new code. Startup migrations remain responsible for additive database schema updates; update packages must never contain destructive data-reset scripts.

Optional limits:

- `SYSTEM_UPDATE_MAX_MB` — uploaded ZIP limit, default 100 MB.
- `SYSTEM_UPDATE_MAX_EXPANDED_MB` — expanded archive limit, default 500 MB.
