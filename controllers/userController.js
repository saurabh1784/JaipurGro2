const User = require('../models/User');
const Profile = require('../models/Profile');
const { editableUserRoles, validateStatus } = require('../middleware/validators');

function wantsJson(req) {
  return req.query.format === 'json' || req.accepts(['html', 'json']) === 'json';
}

function validateUserUpdate(body) {
  const errors = [];
  const name = body.name && String(body.name).trim();
  const email = body.email && String(body.email).trim().toLowerCase();
  const role = body.role;
  const status = body.status;

  if (!name || name.length < 2) errors.push('Name must be at least 2 characters');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Valid email is required');
  if (!editableUserRoles.includes(role)) errors.push('Invalid role');
  if (!validateStatus(status)) errors.push('Status must be active or inactive');

  return errors;
}

async function index(req, res) {
  if (!wantsJson(req)) {
    return res.render('users', {
      user: req.session.user,
      roleOptions: editableUserRoles,
    });
  }

  try {
    const result = await User.list({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      role: req.query.role,
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('User list error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch users' });
  }
}

async function update(req, res) {
  const id = Number(req.params.id);
  const errors = validateUserUpdate(req.body);

  if (!id) errors.push('Valid user ID is required');
  if (errors.length > 0) {
    return res.status(422).json({ success: false, message: 'Validation failed', errors });
  }

  const existingUser = await User.findById(id);
  if (!existingUser) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const updateData = {
    name: String(req.body.name).trim(),
    email: String(req.body.email).trim().toLowerCase(),
    role: req.body.role,
    status: req.body.status,
  };

  const duplicate = await User.emailOrPhoneTaken({
    id,
    email: updateData.email,
    phone: existingUser.phone || '',
  });

  if (duplicate) {
    return res.status(409).json({ success: false, message: 'Email already exists' });
  }

  try {
    await User.updateBasic(id, updateData);
    await Profile.createEmptyForRole(id, updateData.role);
    const updatedUser = await User.findById(id);
    return res.json({ success: true, message: 'User updated successfully', user: User.publicUser(updatedUser) });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Email already exists' });
    }

    console.error('User update error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update user' });
  }
}

async function destroy(req, res) {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid user ID is required' });
  }

  if (req.authUser && Number(req.authUser.id) === id) {
    return res.status(422).json({ success: false, message: 'You cannot delete your own account' });
  }

  const existingUser = await User.findById(id);
  if (!existingUser) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  await User.softDelete(id);
  return res.json({ success: true, message: 'User deleted successfully' });
}

module.exports = { index, update, destroy };
