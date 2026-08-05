const pool = require('../db');

async function addColumnIfMissing(dbPool, table, column, definition) {
  try {
    const colName = column.trim();
    const [rows] = await dbPool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
      [table, colName]
    );
    if (!rows || rows.length === 0) {
      await dbPool.query(`ALTER TABLE "${table}" ADD COLUMN ${colName} ${definition}`);
    }
  } catch (err) {
    // Ignore if already exists or table doesn't exist yet
  }
}

async function ensureSessionTableExists(dbPool = pool) {
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" VARCHAR NOT NULL PRIMARY KEY,
        "sess" JSON NOT NULL,
        "expire" TIMESTAMP(6) NOT NULL
      );
    `);
    await dbPool.query(`
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);
  } catch (err) {
    console.error('Session table initialization error:', err.message);
  }
}

async function ensureAllSchemaTables(dbPool = pool) {
  try {
    await ensureSessionTableExists(dbPool);

    // 1. app_settings
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(120) NOT NULL UNIQUE,
        setting_value TEXT DEFAULT NULL,
        is_secret SMALLINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. content_pages
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS content_pages (
        id SERIAL PRIMARY KEY,
        app_name VARCHAR(30) NOT NULL,
        page_type VARCHAR(60) NOT NULL,
        title VARCHAR(180) NOT NULL,
        content_html TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        is_enabled SMALLINT NOT NULL DEFAULT 1,
        current_version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uniq_content_pages_app_page UNIQUE (app_name, page_type)
      );
    `);

    // 3. content_page_versions
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS content_page_versions (
        id SERIAL PRIMARY KEY,
        page_id INT NOT NULL,
        version INT NOT NULL,
        title VARCHAR(180) NOT NULL,
        content_html TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        is_enabled SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. users
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(150) NOT NULL UNIQUE,
        phone VARCHAR(30) DEFAULT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'staff',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        theme_mode VARCHAR(20) NOT NULL DEFAULT 'light',
        is_deleted SMALLINT NOT NULL DEFAULT 0,
        country VARCHAR(80) DEFAULT NULL,
        state VARCHAR(80) DEFAULT NULL,
        city VARCHAR(100) DEFAULT NULL,
        area VARCHAR(120) DEFAULT NULL,
        assigned_admin_id INT DEFAULT NULL,
        created_by INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. wallets
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6. wallet_transactions
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id SERIAL PRIMARY KEY,
        wallet_id INT NOT NULL,
        user_id INT NOT NULL,
        order_id INT DEFAULT NULL,
        type VARCHAR(20) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        balance_before DECIMAL(12,2) NOT NULL,
        balance_after DECIMAL(12,2) NOT NULL,
        reference VARCHAR(120) DEFAULT NULL,
        note TEXT DEFAULT NULL,
        component VARCHAR(60) DEFAULT NULL,
        ledger_key VARCHAR(190) DEFAULT NULL,
        created_by INT DEFAULT NULL,
        commission_setting_id INT DEFAULT NULL,
        commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        net_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        transaction_by_name VARCHAR(100) DEFAULT NULL,
        transaction_by_email VARCHAR(150) DEFAULT NULL,
        transaction_by_role VARCHAR(50) DEFAULT NULL,
        transaction_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 7. commission_settings
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS commission_settings (
        id SERIAL PRIMARY KEY,
        role_slug VARCHAR(100) NOT NULL,
        role_name VARCHAR(100) NOT NULL,
        transaction_type VARCHAR(50) NOT NULL,
        commission_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
        commission_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        min_commission DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        max_commission DECIMAL(10,2) DEFAULT NULL,
        is_active SMALLINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uniq_commission_role_transaction UNIQUE (role_slug, transaction_type)
      );
    `);

    // 8. roles
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        slug VARCHAR(100) NOT NULL UNIQUE,
        description TEXT DEFAULT NULL,
        parent_id INT DEFAULT NULL,
        level INT NOT NULL DEFAULT 0,
        permissions JSONB DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 9. user_roles
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id INT NOT NULL,
        role_id INT NOT NULL,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        assigned_by INT DEFAULT NULL,
        PRIMARY KEY (user_id, role_id)
      );
    `);

    // 10. vendor_profiles
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS vendor_profiles (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        business_name VARCHAR(150) DEFAULT NULL,
        logo_path VARCHAR(255) DEFAULT NULL,
        storefront_image_path VARCHAR(255) DEFAULT NULL,
        signature_path VARCHAR(255) DEFAULT NULL,
        address TEXT DEFAULT NULL,
        pickup_latitude DECIMAL(10,7) DEFAULT NULL,
        pickup_longitude DECIMAL(10,7) DEFAULT NULL,
        country VARCHAR(80) DEFAULT NULL,
        state VARCHAR(80) DEFAULT NULL,
        city VARCHAR(80) DEFAULT NULL,
        area VARCHAR(120) DEFAULT NULL,
        pincode VARCHAR(20) DEFAULT NULL,
        gst_number VARCHAR(50) DEFAULT NULL,
        services JSONB DEFAULT NULL,
        account_health INT NOT NULL DEFAULT 500,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 11. client_profiles
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS client_profiles (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        avatar_path VARCHAR(255) DEFAULT NULL,
        address TEXT DEFAULT NULL,
        country VARCHAR(80) DEFAULT NULL,
        state VARCHAR(80) DEFAULT NULL,
        city VARCHAR(80) DEFAULT NULL,
        area VARCHAR(120) DEFAULT NULL,
        pincode VARCHAR(20) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 12. admin_profiles
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS admin_profiles (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        permissions JSONB DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 13. support_tickets
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id SERIAL PRIMARY KEY,
        requester_id INT NOT NULL,
        requester_role VARCHAR(50) NOT NULL,
        order_id INT DEFAULT NULL,
        delivery_partner_id INT DEFAULT NULL,
        category VARCHAR(100) DEFAULT 'General',
        subject VARCHAR(180) NOT NULL,
        description TEXT DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'Open',
        priority VARCHAR(20) NOT NULL DEFAULT 'Normal',
        assigned_staff_id INT DEFAULT NULL,
        resolution TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await addColumnIfMissing(dbPool, 'support_tickets', 'order_id', 'INT DEFAULT NULL');
    await addColumnIfMissing(dbPool, 'support_tickets', 'delivery_partner_id', 'INT DEFAULT NULL');
    await addColumnIfMissing(dbPool, 'support_tickets', 'category', "VARCHAR(100) DEFAULT 'General'");
    await addColumnIfMissing(dbPool, 'support_tickets', 'description', 'TEXT DEFAULT NULL');
    await addColumnIfMissing(dbPool, 'support_tickets', 'assigned_staff_id', 'INT DEFAULT NULL');
    await addColumnIfMissing(dbPool, 'support_tickets', 'resolution', 'TEXT DEFAULT NULL');

    // 14. support_ticket_replies
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS support_ticket_replies (
        id SERIAL PRIMARY KEY,
        ticket_id INT NOT NULL,
        sender_id INT NOT NULL,
        sender_role VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        attachment_path VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 15. delivery_person_profiles
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS delivery_person_profiles (
        id SERIAL PRIMARY KEY,
        user_id INT DEFAULT NULL UNIQUE,
        city VARCHAR(255) DEFAULT NULL,
        area VARCHAR(255) DEFAULT NULL,
        address VARCHAR(255) DEFAULT NULL,
        address_proof_id INT DEFAULT NULL,
        address_proof_type VARCHAR(255) DEFAULT NULL,
        profile_image_path VARCHAR(255) DEFAULT NULL,
        vehicle_type VARCHAR(255) DEFAULT NULL,
        vehicle_number VARCHAR(255) DEFAULT NULL,
        document_notes TEXT DEFAULT NULL,
        is_available SMALLINT DEFAULT 0,
        current_latitude VARCHAR(255) DEFAULT NULL,
        current_longitude VARCHAR(255) DEFAULT NULL,
        last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 16. vendor_bank_accounts
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS vendor_bank_accounts (
        id SERIAL PRIMARY KEY,
        vendor_id INTEGER NOT NULL UNIQUE,
        account_number VARCHAR(100),
        ifsc_code VARCHAR(50),
        bank_name VARCHAR(255),
        account_holder_name VARCHAR(255),
        upi_id VARCHAR(255),
        payout_method VARCHAR(50) DEFAULT 'bank',
        pay_to_phone VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await addColumnIfMissing(dbPool, 'vendor_bank_accounts', 'payout_method', "VARCHAR(50) DEFAULT 'bank'");
    await addColumnIfMissing(dbPool, 'vendor_bank_accounts', 'pay_to_phone', 'VARCHAR(50)');

    // 17. vendor_withdrawal_requests
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS vendor_withdrawal_requests (
        id SERIAL PRIMARY KEY,
        vendor_id INTEGER NOT NULL,
        vendor_name VARCHAR(255),
        business_name VARCHAR(255),
        city VARCHAR(255) NOT NULL,
        amount NUMERIC(12, 2) NOT NULL,
        bank_details JSONB NOT NULL DEFAULT '{}',
        note TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        admin_remark TEXT,
        processed_by_user_id INTEGER,
        processed_by_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP
      );
    `);

    // 18. delivery_bank_accounts
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS delivery_bank_accounts (
        id SERIAL PRIMARY KEY,
        delivery_person_id INTEGER NOT NULL UNIQUE,
        account_number VARCHAR(100),
        ifsc_code VARCHAR(50),
        bank_name VARCHAR(255),
        account_holder_name VARCHAR(255),
        upi_id VARCHAR(255),
        payout_method VARCHAR(50) DEFAULT 'bank',
        pay_to_phone VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await addColumnIfMissing(dbPool, 'delivery_bank_accounts', 'payout_method', "VARCHAR(50) DEFAULT 'bank'");
    await addColumnIfMissing(dbPool, 'delivery_bank_accounts', 'pay_to_phone', 'VARCHAR(50)');

    // 19. delivery_withdrawal_requests
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS delivery_withdrawal_requests (
        id SERIAL PRIMARY KEY,
        delivery_person_id INTEGER NOT NULL,
        delivery_person_name VARCHAR(255),
        city VARCHAR(255) NOT NULL,
        amount NUMERIC(12, 2) NOT NULL,
        bank_details JSONB NOT NULL DEFAULT '{}',
        note TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        admin_remark TEXT,
        processed_by_user_id INTEGER,
        processed_by_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP
      );
    `);

    // 20. auth_otps
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS auth_otps (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(50) NOT NULL,
        otp_hash VARCHAR(255) NOT NULL,
        app_type VARCHAR(30) NOT NULL DEFAULT 'client',
        attempts SMALLINT NOT NULL DEFAULT 0,
        max_attempts SMALLINT NOT NULL DEFAULT 5,
        is_verified SMALLINT NOT NULL DEFAULT 0,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 21. auth_otp_blocks
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS auth_otp_blocks (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(50) NOT NULL,
        blocked_until TIMESTAMP NOT NULL,
        reason VARCHAR(255) DEFAULT 'Too many failed OTP attempts',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await addColumnIfMissing(dbPool, 'users', 'social_provider', 'VARCHAR(50) DEFAULT NULL');
    await addColumnIfMissing(dbPool, 'users', 'social_provider_id', 'VARCHAR(255) DEFAULT NULL');
    await addColumnIfMissing(dbPool, 'users', 'profile_image', 'VARCHAR(500) DEFAULT NULL');

    const notificationTemplateService = require('./notificationTemplateService');
    await notificationTemplateService.ensureTableAndDefaults();

    console.log('✅ Base schema tables verified and ready.');
  } catch (err) {
    console.error('Schema table initialization note:', err.message);
  }
}

module.exports = {
  ensureAllSchemaTables,
  ensureSessionTableExists,
};
