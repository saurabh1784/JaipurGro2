# Jaipur Node Login App

A Node.js + Express grocery app with MySQL-backed login, roles, wallets, catalog, vendors, clients, products, orders, and quotations.

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

Use Railway's public MySQL URL when deploying the app on Render. Do not use `MYSQL_URL` or `RAILWAY_PRIVATE_DOMAIN` on Render because Railway private networking only works inside Railway.

Render build command:

```bash
npm ci
```

Render start command:

```bash
npm start
```

If configuring manually in the Render dashboard, set:

- `Root Directory`: leave blank when this repository root is selected
- `MYSQL_PUBLIC_URL`: Railway MySQL public URL, using `RAILWAY_TCP_PROXY_DOMAIN` and `RAILWAY_TCP_PROXY_PORT`
- `NODE_ENV`: `production`
- `SESSION_SECRET`: any long random secret

Remove these variables from Render if they exist:

- `MYSQL_URL`
- `MYSQLHOST`
- `DATABASE_URL`

The app intentionally fails fast on Render if no public MySQL connection is configured. Render cannot connect to Railway's private MySQL host, so `MYSQL_PUBLIC_URL` must look like:

```bash
mysql://user:password@public-host:public-port/database
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
