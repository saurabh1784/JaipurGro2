const User = require('../models/User');
const Profile = require('../models/Profile');

function sanitizeProfileUpdate(role, body) {
  const profile = body.profile && typeof body.profile === 'object' ? body.profile : body;
  const update = {};
  const fieldsByRole = {
    Vendor: ['business_name', 'address', 'country', 'state', 'city', 'gst_number', 'services', 'aadhaar_front_path', 'aadhaar_back_path', 'store_image_path', 'profile_image_path'],
    Client: ['address', 'country', 'state', 'city', 'age', 'gender', 'notes'],
    Admin: ['permissions'],
  };

  for (const field of fieldsByRole[role] || []) {
    if (Object.prototype.hasOwnProperty.call(profile, field)) {
      update[field] = profile[field];
    }
  }

  return update;
}

function wantsJson(req) {
  const accept = req.get('accept') || '';
  return req.query.format === 'json' || req.xhr || req.authType === 'jwt' || (accept.includes('application/json') && !accept.includes('text/html'));
}

async function getByUserId(req, res) {
  const userId = Number(req.params.userId);
  if (!userId) {
    return res.status(422).json({ success: false, message: 'Valid user ID is required' });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const profile = await Profile.findByRole(user.id, user.role);
  const payload = {
    success: true,
    user: User.publicUser(user),
    profile,
    profileRole: user.role,
  };

  if (wantsJson(req)) {
    return res.json(payload);
  }

  return res.render('managed-profile', {
    ...payload,
    currentUser: req.authUser,
    shell: res.locals.shell,
  });
}

async function updateByUserId(req, res) {
  const userId = Number(req.params.userId);
  if (!userId) {
    return res.status(422).json({ success: false, message: 'Valid user ID is required' });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const update = sanitizeProfileUpdate(user.role, req.body);
  if (Object.keys(update).length === 0) {
    return res.status(422).json({ success: false, message: `No profile fields were provided for ${user.role}` });
  }

  await Profile.createEmptyForRole(user.id, user.role);
  await Profile.updateByRole(user.id, user.role, update);
  const profile = await Profile.findByRole(user.id, user.role);

  return res.json({
    success: true,
    message: 'Profile updated successfully',
    user: User.publicUser(user),
    profile,
    profileRole: user.role,
  });
}

module.exports = { getByUserId, updateByUserId };
