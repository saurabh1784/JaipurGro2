module.exports = {
  id: '202607300001_bank_and_withdrawal_tables',
  name: 'Ensure vendor and delivery partner bank account and withdrawal request tables',
  async up(db) {
    await db.query(`
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
      )
    `);
    await db.query(`ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS payout_method VARCHAR(50) DEFAULT 'bank'`).catch(() => {});
    await db.query(`ALTER TABLE vendor_bank_accounts ADD COLUMN IF NOT EXISTS pay_to_phone VARCHAR(50)`).catch(() => {});
    await db.query(`ALTER TABLE vendor_bank_accounts ALTER COLUMN account_number DROP NOT NULL`).catch(() => {});
    await db.query(`ALTER TABLE vendor_bank_accounts ALTER COLUMN ifsc_code DROP NOT NULL`).catch(() => {});
    await db.query(`ALTER TABLE vendor_bank_accounts ALTER COLUMN bank_name DROP NOT NULL`).catch(() => {});
    await db.query(`ALTER TABLE vendor_bank_accounts ALTER COLUMN account_holder_name DROP NOT NULL`).catch(() => {});

    await db.query(`
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
      )
    `);

    await db.query(`
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
      )
    `);
    await db.query(`ALTER TABLE delivery_bank_accounts ADD COLUMN IF NOT EXISTS payout_method VARCHAR(50) DEFAULT 'bank'`).catch(() => {});
    await db.query(`ALTER TABLE delivery_bank_accounts ADD COLUMN IF NOT EXISTS pay_to_phone VARCHAR(50)`).catch(() => {});
    await db.query(`ALTER TABLE delivery_bank_accounts ALTER COLUMN account_number DROP NOT NULL`).catch(() => {});
    await db.query(`ALTER TABLE delivery_bank_accounts ALTER COLUMN ifsc_code DROP NOT NULL`).catch(() => {});
    await db.query(`ALTER TABLE delivery_bank_accounts ALTER COLUMN bank_name DROP NOT NULL`).catch(() => {});
    await db.query(`ALTER TABLE delivery_bank_accounts ALTER COLUMN account_holder_name DROP NOT NULL`).catch(() => {});

    await db.query(`
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
      )
    `);
  },
};
