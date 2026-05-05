# Railway database export

This folder is for Railway MySQL deployment files.

## Files

- `schema.sql`: MySQL table structure for a fresh Railway database.
- `railway-export.sql`: generated full database dump after running `npm run db:export`.

## Create a full export

Set your local or Railway MySQL variables, then run:

```bash
npm run db:export
```

The export script uses the same connection settings as the app:

1. `MYSQL_URL`
2. `DATABASE_URL`
3. `MYSQL_PUBLIC_URL`
4. `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`

## Import into Railway

For a fresh Railway database, import `schema.sql` first. If you exported real data, import `railway-export.sql` instead.

Using the public Railway MySQL URL from your machine:

```bash
mysql "$MYSQL_PUBLIC_URL" < database/railway/schema.sql
```

Inside Railway, keep the app connected with private networking:

```bash
MYSQL_URL=mysql://${{ MYSQLUSER }}:${{ MYSQL_ROOT_PASSWORD }}@${{ RAILWAY_PRIVATE_DOMAIN }}:3306/${{ MYSQL_DATABASE }}
```

The app also initializes and seeds the schema on startup, so this folder is mainly for manual imports, backups, and deployment handoff.
