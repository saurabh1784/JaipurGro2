const User = require('../models/User');
const Profile = require('../models/Profile');
const { validateStatus } = require('../middleware/validators');
const Rating = require('../models/Rating');
const { detectServiceArea, notServiceablePayload } = require('../services/serviceAreaResolver');

function sanitizeUserUpdate(body) {
  const update = {};
  // Account approval is admin-controlled and must never be writable here.
  for (const field of ['name', 'email', 'phone']) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const value = typeof body[field] === 'string' ? body[field].trim() : body[field];
      update[field] = field === 'email' && typeof value === 'string'
        ? value.toLowerCase()
        : value;
    }
  }
  return update;
}

function sanitizeProfileUpdate(role, body) {
  const profile = body.profile && typeof body.profile === 'object' ? body.profile : body;
  const update = {};
  const normRole = String(role || '').trim().toLowerCase();
  const deliveryFields = ['city', 'area', 'address', 'address_proof_id', 'address_proof_type', 'vehicle_type', 'vehicle_number', 'document_notes', 'is_available', 'current_latitude', 'current_longitude', 'delivery_areas'];
  const fieldsByRole = {
    vendor: ['business_name', 'logo_path', 'storefront_image_path', 'signature_path', 'address', 'pickup_latitude', 'pickup_longitude', 'pincode', 'gst_number', 'services', 'country', 'state', 'city', 'area', 'area_definition_id', 'zone_id', 'zone_code'],
    client: ['address', 'country', 'state', 'city', 'area', 'age', 'gender', 'notes'],
    admin: ['permissions'],
    deliveryperson: deliveryFields,
    delivery_partner: deliveryFields,
    delivery: deliveryFields,
    driver: deliveryFields,
    staff: deliveryFields,
    rider: deliveryFields,
  };

  const allowedFields = fieldsByRole[normRole] || fieldsByRole.vendor || [];
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(profile, field)) {
      update[field] = normalizeProfileValue(field, profile[field]);
    }
  }

  return update;
}

function normalizeProfileValue(field, value) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  if (field === 'age') {
    const age = Number(trimmed);
    if (!Number.isInteger(age) || age < 0) {
      const error = new Error('Age must be a valid number');
      error.status = 422;
      throw error;
    }
    return age;
  }

  return trimmed;
}

async function getProfile(req, res) {
  const profile = await Profile.findByRole(req.user.id, req.user.role);
  const { getProfileCompletionStatus } = require('../services/profileCompletionService');
  const completion = await getProfileCompletionStatus(req.user.id);
  const ratingType = String(req.user.role || '').toLowerCase() === 'vendor'
    ? 'vendor'
    : (String(req.user.role || '').toLowerCase() === 'deliveryperson' ? 'delivery_person' : null);
  const ratingSummary = ratingType ? await Rating.summary(ratingType, req.user.id) : null;

  return res.json({
    success: true,
    user: {
      ...User.publicUser(req.user),
      is_profile_complete: completion.isComplete,
      is_approved: completion.isApproved,
      approval_status: completion.approvalStatus,
      status_message: completion.statusMessage,
      banner_message: completion.bannerMessage,
      missing_fields: completion.missingFields,
    },
    profile,
    rating_summary: ratingSummary,
  });
}

async function updateProfile(req, res) {
  try {
    const userUpdate = sanitizeUserUpdate(req.body);
    const profileUpdate = sanitizeProfileUpdate(req.user.role, req.body);
    const rawProfile = req.body.profile && typeof req.body.profile === 'object' ? req.body.profile : req.body;
    const userRoleNorm = String(req.user.role || '').trim().toLowerCase();
    const updatesVendorAddress = (userRoleNorm === 'vendor') && ['address', 'pickup_latitude', 'pickup_longitude', 'latitude', 'longitude', 'lat', 'lng'].some((field) => Object.prototype.hasOwnProperty.call(rawProfile, field));
    if (updatesVendorAddress) {
      try {
        const detected = await detectServiceArea({
          latitude: rawProfile.pickup_latitude ?? rawProfile.latitude ?? rawProfile.lat,
          longitude: rawProfile.pickup_longitude ?? rawProfile.longitude ?? rawProfile.lng,
        });
        Object.assign(profileUpdate, detected, {
          pickup_latitude: detected.latitude,
          pickup_longitude: detected.longitude,
        });
        delete profileUpdate.latitude;
        delete profileUpdate.longitude;
      } catch (error) {
        return res.status(error.status || 422).json(notServiceablePayload(error));
      }
    }

    if (!validateStatus(userUpdate.status)) {
      return res.status(422).json({ success: false, message: 'Status must be active or inactive' });
    }

    const newEmail = userUpdate.email && userUpdate.email !== String(req.user.email || '').toLowerCase() ? userUpdate.email : null;
    const newPhone = userUpdate.phone && userUpdate.phone !== String(req.user.phone || '') ? userUpdate.phone : null;

    if (newEmail || newPhone) {
      const duplicate = await User.emailOrPhoneTaken({
        id: req.user.id,
        email: newEmail || '',
        phone: newPhone || '',
      });
      if (duplicate) {
        const field = newEmail && duplicate.email === newEmail ? 'email' : 'phone';
        return res.status(409).json({ success: false, message: `A user with this ${field} already exists` });
      }
    }

    if (Object.keys(userUpdate).length > 0) {
      await User.updateBasic(req.user.id, userUpdate);
    }

    if (Object.keys(profileUpdate).length > 0) {
      await Profile.createEmptyForRole(req.user.id, req.user.role);
      await Profile.updateByRole(req.user.id, req.user.role, profileUpdate);
    }

    const updatedUser = await User.findById(req.user.id);
    const updatedProfile = await Profile.findByRole(req.user.id, req.user.role);
    const { getProfileCompletionStatus } = require('../services/profileCompletionService');
    const completion = await getProfileCompletionStatus(req.user.id);

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        ...User.publicUser(updatedUser || req.user),
        is_profile_complete: completion.isComplete,
        is_approved: completion.isApproved,
        approval_status: completion.approvalStatus,
        status_message: completion.statusMessage,
        banner_message: completion.bannerMessage,
        missing_fields: completion.missingFields,
      },
      profile: updatedProfile,
      rating_summary: (updatedUser || req.user) && String((updatedUser || req.user).role || '').toLowerCase() === 'vendor'
        ? await Rating.summary('vendor', req.user.id)
        : null,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }

    if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
      return res.status(409).json({ success: false, message: 'Email or phone already exists' });
    }

    console.error('Profile update error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update profile' });
  }
}

module.exports = { getProfile, updateProfile };
