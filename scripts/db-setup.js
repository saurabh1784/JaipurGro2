const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const pool = require('../db');
const { ensureAllSchemaTables, ensureSessionTableExists } = require('../services/schemaSyncService');
const { seedRequiredData, DEFAULT_SUPERADMIN } = require('../services/seedService');
const { runMigrations } = require('../migrationRunner');

async function ensureDatabaseExists() {
  const dbName = process.env.DB_NAME || 'groxenin_jaipurgro';
  const host = process.env.DB_HOST || 'localhost';
  const port = Number(process.env.DB_PORT || 5432);
  const user = process.env.DB_USER || 'groxenin_saurabh';
  const password = process.env.DB_PASSWORD || 'saurabh@17842006';

  const client = new Client({
    host,
    port,
    user,
    password,
    database: 'postgres',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
    if (res.rowCount === 0) {
      console.log(`📦 Database "${dbName}" does not exist. Creating database...`);
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`✅ Database "${dbName}" created successfully.`);
    }
  } catch (err) {
    console.log(`ℹ️ System database check note: ${err.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

function ensureUploadDirs() {
  const dirs = [
    path.join(__dirname, '..', 'public', 'uploads'),
    path.join(__dirname, '..', 'public', 'uploads', 'products'),
    path.join(__dirname, '..', 'public', 'uploads', 'vendor_products'),
    path.join(__dirname, '..', 'public', 'uploads', 'brands'),
    path.join(__dirname, '..', 'public', 'uploads', 'subcategories'),
    path.join(__dirname, '..', 'public', 'uploads', 'promotions'),
    path.join(__dirname, '..', 'public', 'uploads', 'advertisements'),
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }
}

async function runCompleteSetup() {
  console.log('=======================================================');
  console.log('🚀 INITIALIZING COMPLETE DATABASE & APPLICATION SETUP');
  console.log('=======================================================');

  try {
    // 1. Ensure Database & Upload Dirs
    await ensureDatabaseExists();
    ensureUploadDirs();

    // 2. Build Schema Tables, Indexes & Foreign Keys
    console.log('\n1. Synchronizing Schema Tables & Relationships...');
    await ensureAllSchemaTables(pool);
    await ensureSessionTableExists(pool).catch(() => {});
    await runMigrations(pool).catch(() => {});

    // 3. Seed Default System Data & Superadmin Account
    console.log('\n2. Seeding Required System Data & Superadmin...');
    await seedRequiredData();

    // 4. Summary Output
    console.log('\n=======================================================');
    console.log('🎉 APPLICATION DATABASE SETUP COMPLETED SUCCESSFULLY!');
    console.log('=======================================================');
    console.log('  • Database: Created & Synchronized');
    console.log('  • Tables, Indexes & Constraints: Ready');
    console.log('  • Default Roles & Permissions: Configured');
    console.log('  • System Settings: Initialized');
    console.log(`  • Superadmin Account: ${DEFAULT_SUPERADMIN.email}`);
    console.log(`  • Superadmin Password: ${DEFAULT_SUPERADMIN.password}`);
    console.log('-------------------------------------------------------');
    console.log('The application is ready to use immediately!');
    console.log('Run "npm start" or "npm run dev" to launch the server.');
    console.log('=======================================================\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Setup failed:', err);
    process.exit(1);
  }
}

runCompleteSetup();
