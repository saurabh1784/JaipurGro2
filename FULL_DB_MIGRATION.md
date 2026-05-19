# Full database replacement from local PostgreSQL

Use this when you want the deployed database to become an exact copy of your
local database.

This is destructive for the target database. The script backs up the target
first, then drops and recreates the target `public` schema.

## 1. Install PostgreSQL client tools

The machine running the command needs:

- `pg_dump`
- `psql`

On Windows, install PostgreSQL and add its `bin` folder to `PATH`, for example:

```powershell
C:\Program Files\PostgreSQL\16\bin
```

## 2. Configure source and target URLs

Set these in your terminal, not in Git:

```powershell
$env:SOURCE_DATABASE_URL="postgresql://postgres:password@localhost:5432/jaipur_db_node"
$env:TARGET_DATABASE_URL="postgresql://render_user:render_password@render_host/render_db"
```

You can also use:

- `LOCAL_DATABASE_URL`
- `RENDER_DATABASE_URL`

If no source URL is set, the script builds one from local `.env` values:
`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.

## 3. Create a local dump

```powershell
npm run db:dump:local -- --file db-backups/local.sql
```

## 4. Replace the target database

```powershell
npm run db:replace:target -- --file db-backups/local.sql --confirm-replace
```

The `--confirm-replace` flag is required. Without it, the script refuses to
touch the target database.

## 5. Verify after deploy

Open:

```text
https://jaipurgro2.onrender.com/api/system/status
```

Then check the app data.

## Safety notes

- Never commit `.env` or database URLs.
- `db-backups/` is ignored by Git.
- The script refuses to run if source and target URLs are the same.
- A target backup is created in `db-backups/` before replacement.
