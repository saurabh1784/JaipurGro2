# Jaipur Node Login App

A minimal Node.js + Express app with a MySQL-backed login UI and seeded superadmin account.

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

The app creates the `jaipur_db_node` database automatically if it does not already exist, using MySQL on `localhost` with:

- user: `root`
- password: blank

## Default superadmin credentials

- Email: `superadmin@example.com`
- Password: `admin123`
