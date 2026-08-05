const pool = require('../db');

async function getProfileCompletionStatus(userId) {
  if (!userId) {
    return {
      isComplete: false,
      approvalStatus: 'incomplete_profile',
      statusMessage: 'Please complete your profile.',
      bannerMessage: 'Please complete your profile',
      missingFields: ['User account'],
    };
  }

  const [userRows] = await pool.query(
    'SELECT id, name, email, phone, role, status, city, area FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1',
    [userId]
  );
  if (!userRows || userRows.length === 0) {
    return {
      isComplete: false,
      approvalStatus: 'incomplete_profile',
      statusMessage: 'Please complete your profile.',
      bannerMessage: 'Please complete your profile',
      missingFields: ['User account'],
    };
  }

  const user = userRows[0];
  const roleLower = String(user.role || '').trim().toLowerCase();
  const isVendor = roleLower === 'vendor';
  const isDelivery = ['deliveryperson', 'delivery_partner', 'deliverypersonnel', 'delivery', 'staff'].includes(roleLower);

  let isComplete = true;
  const missingFields = [];

  if (isVendor) {
    const [vpRows] = await pool.query(
      `SELECT business_name, address, city, area, gst_number,
              pan_card_path, aadhaar_card_path, gst_certificate_path, food_license_path,
              cancelled_cheque_path, shop_front_photo_path, shop_inside_photo_1_path,
              shop_inside_photo_2_path, shop_inside_photo_3_path, kyc_status, kyc_rejection_reason
       FROM vendor_profiles WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    const vp = (vpRows && vpRows[0]) || {};

    if (!user.name || !String(user.name).trim() || user.name.startsWith('User ')) {
      isComplete = false;
      missingFields.push('Full Name');
    }
    if (!user.phone || !String(user.phone).trim()) {
      isComplete = false;
      missingFields.push('Phone Number');
    }
    const cityVal = String(user.city || vp.city || '').trim();
    if (!cityVal) {
      isComplete = false;
      missingFields.push('City');
    }
    const storeName = String(vp.business_name || '').trim();
    if (!storeName) {
      isComplete = false;
      missingFields.push('Store / Business Name');
    }
    const storeAddress = String(vp.address || '').trim();
    if (!storeAddress) {
      isComplete = false;
      missingFields.push('Store Address');
    }
    if (!vp.pan_card_path) { isComplete = false; missingFields.push('PAN Card'); }
    if (!vp.aadhaar_card_path) { isComplete = false; missingFields.push('Aadhaar Card'); }
    if (!vp.gst_certificate_path) { isComplete = false; missingFields.push('GST Certificate'); }
    if (!vp.food_license_path) { isComplete = false; missingFields.push('Food License'); }
    if (!vp.cancelled_cheque_path) { isComplete = false; missingFields.push('Cancelled Cheque'); }
    if (!vp.shop_front_photo_path) { isComplete = false; missingFields.push('Front photo of the shop'); }
    if (!vp.shop_inside_photo_1_path) { isComplete = false; missingFields.push('Inside photo 1 of shop'); }
    if (!vp.shop_inside_photo_2_path) { isComplete = false; missingFields.push('Inside photo 2 of shop'); }
    if (!vp.shop_inside_photo_3_path) { isComplete = false; missingFields.push('Inside photo 3 of shop'); }
  } else if (isDelivery) {
    const [dpRows] = await pool.query(
      `SELECT city, area, address, vehicle_type, vehicle_number,
              bike_rc_path, pan_card_path, aadhaar_card_path, driving_license_path,
              cancelled_cheque_path, live_selfie_path, kyc_status, kyc_rejection_reason
       FROM delivery_person_profiles WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    const dp = (dpRows && dpRows[0]) || {};

    if (!user.name || !String(user.name).trim() || user.name.startsWith('User ')) {
      isComplete = false;
      missingFields.push('Full Name');
    }
    if (!user.phone || !String(user.phone).trim()) {
      isComplete = false;
      missingFields.push('Phone Number');
    }
    const cityVal = String(user.city || dp.city || '').trim();
    if (!cityVal) {
      isComplete = false;
      missingFields.push('City');
    }
    const vehicleType = String(dp.vehicle_type || '').trim();
    if (!vehicleType) {
      isComplete = false;
      missingFields.push('Vehicle Type');
    }
    const vehicleNumber = String(dp.vehicle_number || '').trim();
    if (!vehicleNumber) {
      isComplete = false;
      missingFields.push('Bike Registration Number');
    }
    if (!dp.bike_rc_path) { isComplete = false; missingFields.push('Bike RC'); }
    if (!dp.pan_card_path) { isComplete = false; missingFields.push('PAN Card'); }
    if (!dp.aadhaar_card_path) { isComplete = false; missingFields.push('Aadhaar Card'); }
    if (!dp.driving_license_path) { isComplete = false; missingFields.push('Driving License'); }
    if (!dp.cancelled_cheque_path) { isComplete = false; missingFields.push('Cancelled Cheque'); }
    if (!dp.live_selfie_path) { isComplete = false; missingFields.push('Live Selfie Photo'); }
  } else {
    // Customer / Client
    if (!user.name || !String(user.name).trim()) {
      isComplete = false;
      missingFields.push('Full Name');
    }
    if (!user.phone || !String(user.phone).trim()) {
      isComplete = false;
      missingFields.push('Phone Number');
    }
  }

  const isApproved = ['active', 'approved'].includes(String(user.status || '').toLowerCase());
  let approvalStatus = 'approved';
  let statusMessage = 'Account Approved.';
  let bannerMessage = '';

  if (!isApproved) {
    if (!isComplete) {
      approvalStatus = 'incomplete_profile';
      statusMessage = 'Please complete your profile.';
      bannerMessage = 'Please complete your profile';
    } else {
      approvalStatus = 'pending_approval';
      statusMessage = 'Profile completed. Waiting for admin approval.';
      bannerMessage = 'Profile completed. Waiting for admin approval.';
    }
  }

  return {
    isComplete,
    isApproved,
    approvalStatus,
    statusMessage,
    bannerMessage,
    missingFields,
  };
}

module.exports = {
  getProfileCompletionStatus,
};
