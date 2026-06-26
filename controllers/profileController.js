const User = require('../models/User');
const Profile = require('../models/Profile');
const { validateStatus } = require('../middleware/validators');
const Rating = require('../models/Rating');

function sanitizeUserUpdate(body) {
  const update = {};
  for (const field of ['name', 'email', 'phone', 'status']) {
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
  const fieldsByRole = {
    Vendor: ['business_name', 'logo_path', 'storefront_image_path', 'signature_path', 'address', 'pickup_latitude', 'pickup_longitude', 'country', 'state', 'city', 'gst_number', 'services'],
    Client: ['address', 'country', 'state', 'city', 'age', 'gender', 'notes'],
    Admin: ['permissions'],
  };

  for (const field of fieldsByRole[role] || []) {
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
  const ratingType = String(req.user.role || '').toLowerCase() === 'vendor'
    ? 'vendor'
    : (String(req.user.role || '').toLowerCase() === 'deliveryperson' ? 'delivery_person' : null);
  const ratingSummary = ratingType ? await Rating.summary(ratingType, req.user.id) : null;

  return res.json({
    success: true,
    user: User.publicUser(req.user),
    profile,
    rating_summary: ratingSummary,
  });
}

async function updateProfile(req, res) {
  try {
    const userUpdate = sanitizeUserUpdate(req.body);
    const profileUpdate = sanitizeProfileUpdate(req.user.role, req.body);

    if (!validateStatus(userUpdate.status)) {
      return res.status(422).json({ success: false, message: 'Status must be active or inactive' });
    }

    if (userUpdate.email || userUpdate.phone) {
      const duplicate = await User.emailOrPhoneTaken({
        id: req.user.id,
        email: userUpdate.email || req.user.email || '',
        phone: userUpdate.phone || req.user.phone || '',
      });
      if (duplicate) {
        const field = duplicate.email === userUpdate.email ? 'email' : 'phone';
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

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      user: User.publicUser(updatedUser),
      profile: updatedProfile,
      rating_summary: String(updatedUser.role || '').toLowerCase() === 'vendor'
        ? await Rating.summary('vendor', updatedUser.id)
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
