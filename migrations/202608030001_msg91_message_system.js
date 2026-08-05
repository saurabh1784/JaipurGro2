module.exports = {
  id: '202608030001_msg91_message_system',
  name: 'Create MSG91 message logs, test OTP sessions, and webhook events',
  async up(db) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS msg91_message_logs (
        id BIGSERIAL PRIMARY KEY,
        idempotency_key VARCHAR(160) UNIQUE,
        mobile VARCHAR(20) NOT NULL,
        user_role VARCHAR(40),
        app_name VARCHAR(40),
        message_type VARCHAR(30) NOT NULL,
        channel VARCHAR(20) NOT NULL,
        template_name VARCHAR(160),
        msg91_request_id VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'Pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        provider_response JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        delivered_at TIMESTAMPTZ,
        read_at TIMESTAMPTZ
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_msg91_logs_request ON msg91_message_logs (msg91_request_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_msg91_logs_filter ON msg91_message_logs (channel, message_type, status, created_at DESC)');
    await db.query(`
      CREATE TABLE IF NOT EXISTS msg91_test_otp_sessions (
        id BIGSERIAL PRIMARY KEY,
        req_id VARCHAR(255) UNIQUE NOT NULL,
        mobile VARCHAR(20) NOT NULL,
        channel VARCHAR(20) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        verified_at TIMESTAMPTZ,
        created_by BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS msg91_webhook_events (
        event_key VARCHAR(255) PRIMARY KEY,
        payload JSONB NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
};
