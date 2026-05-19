# Jaipur Node Login App

A minimal Node.js + Express app with a PostgreSQL-backed login UI and seeded superadmin account.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the app:
   ```bash
   npm start
   ```
3. Visit `http://localhost:3000`

## Database

The app creates the `jaipur_db_node` database automatically if it does not already exist. Create a `.env` file in this folder with your PostgreSQL credentials:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_NAME=jaipur_db_node
```

For a hosted PostgreSQL database, you can use a single connection URL instead:

```env
DATABASE_URL=postgres://user:password@host:5432/database
DB_SSL=true
```

## Default superadmin credentials

- Email: `superadmin@example.com`
- Password: `admin123`
