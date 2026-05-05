const User = require('../models/User');
const Profile = require('../models/Profile');
const { validateStatus } = require('../middleware/validators');

function sanitizeUserUpdate(body) {
  const update = {};
  for (const field of ['name', 'email', 'phone', 'status']) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      update[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
    }
  }
  return update;
}

function sanitizeProfileUpdate(role, body) {
  const profile = body.profile && typeof body.profile === 'object' ? body.profile : body;
  const update = {};
  const fieldsByRole = {
    Vendor: ['business_name', 'address', 'gst_number', 'services'],
    Client: ['address', 'age', 'gender', 'notes'],
    Admin: ['permissions'],
  };

  for (const field of fieldsByRole[role] || []) {
    if (Object.prototype.hasOwnProperty.call(profile, field)) {
      update[field] = profile[field];
    }
  }

  return update;
}

async function getProfile(req, res) {
  const profile = await Profile.findByRole(req.user.id, req.user.role);

  return res.json({
    success: true,
    user: User.publicUser(req.user),
    profile,
  });
}

async function updateProfile(req, res) {
  try {
    const userUpdate = sanitizeUserUpdate(req.body);
    const profileUpdate = sanitizeProfileUpdate(req.user.role, req.body);

    if (!validateStatus(userUpdate.status)) {
      return res.status(422).json({ success: false, message: 'Status must be active or inactive' });
    }

    if (Object.keys(userUpdate).length > 0) {
      await User.updateBasic(req.user.id, userUpdate);
    }

    if (Object.keys(profileUpdate).length > 0) {
      await Profile.updateByRole(req.user.id, req.user.role, profileUpdate);
    }

    const updatedUser = await User.findById(req.user.id);
    const updatedProfile = await Profile.findByRole(req.user.id, req.user.role);

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      user: User.publicUser(updatedUser),
      profile: updatedProfile,
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Email or phone already exists' });
    }

    console.error('Profile update error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update profile' });
  }
}

module.exports = { getProfile, updateProfile };
