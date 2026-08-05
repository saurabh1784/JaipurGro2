module.exports = {
  id: '202608050001_add_vendor_and_delivery_kyc_documents',
  name: 'Add KYC document upload columns and kyc_status to vendor_profiles and delivery_person_profiles',
  async up(db) {
    // Vendor profile KYC columns
    await db.query(`ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS pan_card_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS aadhaar_card_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS gst_certificate_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS food_license_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS cancelled_cheque_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS shop_front_photo_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS shop_inside_photo_1_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS shop_inside_photo_2_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS shop_inside_photo_3_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS kyc_status VARCHAR(50) DEFAULT 'pending_documents'`).catch(() => {});
    await db.query(`ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMP DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS kyc_rejection_reason TEXT DEFAULT NULL`).catch(() => {});

    // Delivery person profile KYC columns
    await db.query(`ALTER TABLE delivery_person_profiles ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE delivery_person_profiles ADD COLUMN IF NOT EXISTS bike_rc_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE delivery_person_profiles ADD COLUMN IF NOT EXISTS pan_card_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE delivery_person_profiles ADD COLUMN IF NOT EXISTS aadhaar_card_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE delivery_person_profiles ADD COLUMN IF NOT EXISTS driving_license_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE delivery_person_profiles ADD COLUMN IF NOT EXISTS cancelled_cheque_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE delivery_person_profiles ADD COLUMN IF NOT EXISTS live_selfie_path VARCHAR(255) DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE delivery_person_profiles ADD COLUMN IF NOT EXISTS kyc_status VARCHAR(50) DEFAULT 'pending_documents'`).catch(() => {});
    await db.query(`ALTER TABLE delivery_person_profiles ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMP DEFAULT NULL`).catch(() => {});
    await db.query(`ALTER TABLE delivery_person_profiles ADD COLUMN IF NOT EXISTS kyc_rejection_reason TEXT DEFAULT NULL`).catch(() => {});

    // Ensure initial kyc_status for active existing users
    await db.query(`UPDATE vendor_profiles vp SET kyc_status = 'approved' FROM users u WHERE u.id = vp.user_id AND u.status IN ('active', 'approved') AND (vp.kyc_status IS NULL OR vp.kyc_status = 'pending_documents')`).catch(() => {});
    await db.query(`UPDATE delivery_person_profiles dp SET kyc_status = 'approved' FROM users u WHERE u.id = dp.user_id AND u.status IN ('active', 'approved') AND (dp.kyc_status IS NULL OR dp.kyc_status = 'pending_documents')`).catch(() => {});
  }
};
