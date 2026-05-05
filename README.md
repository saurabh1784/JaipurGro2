# Jaipur Node Login App

A Node.js + Express grocery app with MySQL or PostgreSQL-backed login, roles, wallets, catalog, vendors, clients, products, orders, and quotations.

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set a MySQL connection, or use the defaults shown here:
   ```bash
   set DATABASE_HOST=localhost
   set DATABASE_PORT=3306
   set DATABASE_USER=root
   set DATABASE_PASSWORD=
   set DATABASE_NAME=jaipur_db_node
   ```
3. Start the app:
   ```bash
   npm start
   ```
4. Visit `http://localhost:3000`

## Railway MySQL deployment

Add a Railway MySQL service, then set the app service variables from the MySQL service. The app reads Railway's private connection first:

```bash
MYSQL_URL=mysql://${{ MYSQLUSER }}:${{ MYSQL_ROOT_PASSWORD }}@${{ RAILWAY_PRIVATE_DOMAIN }}:3306/${{ MYSQL_DATABASE }}
MYSQLHOST=${{ RAILWAY_PRIVATE_DOMAIN }}
MYSQLPORT=3306
MYSQLUSER=root
MYSQLPASSWORD=${{ MYSQL_ROOT_PASSWORD }}
MYSQLDATABASE=${{ MYSQL_DATABASE }}
MYSQL_DATABASE=railway
```

Use `MYSQL_URL` for app-to-database connections inside Railway. `MYSQL_PUBLIC_URL` is only needed when connecting from outside Railway, such as a local database client.

Database deployment files are in `database/railway`:

- `schema.sql` for a fresh Railway MySQL database
- `npm run db:export` to create `database/railway/railway-export.sql` from the configured database

## Render deployment

Render is configured to use an existing PostgreSQL database through `DATABASE_URL`. The app creates the tables on startup and can optionally copy data from a linked MySQL database before starting.

Render build command:

```bash
npm ci
```

Render start command:

```bash
npm run render:start
```

If configuring manually in the Render dashboard, set:

- `Root Directory`: leave blank when this repository root is selected
- `DB_CLIENT`: `postgres`
- `DATABASE_URL`: Render PostgreSQL internal connection string
- `NODE_ENV`: `production`
- `SESSION_SECRET`: any long random secret

For a Render web service connected to a Render PostgreSQL database, use the internal database URL:

```bash
postgresql://db_for_jaipur_user:YOUR_PASSWORD@dpg-d7ss7vdckfvc73cnsmk0-a/db_for_jaipur
```

Use the external database URL only from your local machine or an external database client.

To migrate data from Railway/MySQL into the new Render PostgreSQL database, set either:

- `MYSQL_PUBLIC_URL`: public MySQL URL

Or set these Railway public TCP proxy values separately:

- `RAILWAY_TCP_PROXY_DOMAIN`
- `RAILWAY_TCP_PROXY_PORT`
- `MYSQLUSER`
- `MYSQLPASSWORD`
- `MYSQLDATABASE`

Remove these variables from Render if they exist:

- `MYSQL_URL`
- `MYSQLHOST`

Do not use Railway's private `MYSQL_URL` or `RAILWAY_PRIVATE_DOMAIN` on Render because Railway private networking only works inside Railway.

Manual migration command:

```bash
npm run db:migrate:mysql-to-postgres
```

## Vercel deployment

Set the Vercel project root directory to `Jaipur`. The included `vercel.json` rewrites all requests to the Express serverless function at `api/index.js`.

Set these Vercel environment variables:

- `DATABASE_URL`: PostgreSQL connection string
- `NODE_ENV`: `production`
- `SESSION_SECRET`: any long random secret
- `DATABASE_SSL`: `true`

Vercel serverless storage is temporary. Uploaded brand/product images are stored in `/tmp` for the current function instance only; use object storage for persistent uploads.

## Default superadmin credentials

- Email: `superadmin@example.com`
- Password: `admin123`
