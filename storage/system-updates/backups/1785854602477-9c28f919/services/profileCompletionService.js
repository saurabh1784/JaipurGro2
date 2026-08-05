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
      'SELECT business_name, address, city, area, gst_number FROM vendor_profiles WHERE user_id = ? LIMIT 1',
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
  } else if (isDelivery) {
    const [dpRows] = await pool.query(
      'SELECT city, area, address, vehicle_type, vehicle_number FROM delivery_person_profiles WHERE user_id = ? LIMIT 1',
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
      missingFields.push('Vehicle Number');
    }
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
