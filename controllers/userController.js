const User = require('../models/User');
const Profile = require('../models/Profile');
const pool = require('../db');
const { editableUserRoles, validateStatus } = require('../middleware/validators');

function isSuperAdminUser(user) {
  if (!user) return false;
  const normalize = (v) => String(v || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (normalize(user.role) === 'superadmin' || normalize(user.roleName) === 'superadmin') return true;
  return Array.isArray(user.roles) && user.roles.some((r) => normalize(r.slug) === 'superadmin' || normalize(r.name) === 'superadmin');
}

async function getAssignedUserCity(user) {
  if (!user) return null;
  if (isSuperAdminUser(user)) return null;

  const direct = String(user.city || user.admin_city || user.profile_city || '').trim();
  if (direct) return direct;

  const { rows } = await pool.query(
    `SELECT COALESCE(ap.city, cp.city, vp.city, dpp.city, '') AS city
     FROM users u
     LEFT JOIN admin_profiles ap ON ap.user_id = u.id
     LEFT JOIN client_profiles cp ON cp.user_id = u.id
     LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
     LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
     WHERE u.id = $1 LIMIT 1`,
    [user.id]
  ).catch(() => ({ rows: [] }));

  return String((rows[0] && rows[0].city) || '').trim();
}

function wantsJson(req) {
  return req.query.format === 'json' || req.accepts(['html', 'json']) === 'json';
}

function validateUserUpdate(body, allowedRoles = editableUserRoles) {
  const errors = [];
  const name = body.name && String(body.name).trim();
  const email = body.email && String(body.email).trim().toLowerCase();
  const role = body.role;
  const status = body.status;

  if (!name || name.length < 2) errors.push('Name must be at least 2 characters');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Valid email is required');
  if (!allowedRoles.includes(role)) errors.push('Invalid role');
  if (!validateStatus(status)) errors.push('Status must be active or inactive');

  return errors;
}

async function roleOptions(currentUser) {
  const isSuper = isSuperAdminUser(currentUser);
  const isAdm = !isSuper && currentUser && ['admin', 'superadmin'].includes(String(currentUser.role || '').toLowerCase());

  try {
    const { rows } = await pool.query(
      `SELECT slug, name
       FROM roles
       WHERE slug IS NOT NULL AND TRIM(slug) <> ''
       ORDER BY level ASC, name ASC`
    );
    const slugs = rows.map((role) => role.slug).filter(Boolean);
    let all = [...new Set([...slugs, ...editableUserRoles])];

    all = all.filter((r) => {
      const lower = String(r).toLowerCase().replace(/[\s_-]+/g, '');
      if (lower === 'superadmin') return false;
      if (isAdm && (lower === 'admin' || lower === 'superadmin')) return false;
      return true;
    });

    return all;
  } catch {
    return editableUserRoles.filter((r) => {
      const lower = String(r).toLowerCase().replace(/[\s_-]+/g, '');
      if (lower === 'superadmin') return false;
      if (isAdm && (lower === 'admin' || lower === 'superadmin')) return false;
      return true;
    });
  }
}

async function index(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const adminCity = await getAssignedUserCity(currentUser);
  const roles = await roleOptions(currentUser);

  if (!wantsJson(req)) {
    return res.render('users', {
      user: req.session.user,
      isSuperAdmin: isSuper,
      adminCity,
      roleOptions: roles,
    });
  }

  try {
    const result = await User.list({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      role: req.query.role,
      isSuperAdmin: isSuper,
      adminCity: isSuper ? '' : (req.query.city || adminCity),
    });

    return res.json({
      success: true,
      isSuperAdmin: isSuper,
      adminCity,
      roleOptions: roles,
      ...result,
    });
  } catch (error) {
    console.error('User list error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch users' });
  }
}

async function update(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const id = Number(req.params.id);

  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid user ID is required' });
  }

  const existingUser = await User.findById(id);
  if (!existingUser) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (isSuperAdminUser(existingUser) && !isSuper) {
    return res.status(403).json({ success: false, message: 'Super Admin accounts cannot be edited or modified.' });
  }

  if (['admin', 'superadmin'].includes(String(existingUser.role || '').toLowerCase()) && !isSuper) {
    return res.status(403).json({ success: false, message: 'Admins cannot edit or modify Admin accounts.' });
  }

  const requestedRoleNorm = req.body.role ? String(req.body.role).toLowerCase().replace(/[\s_-]+/g, '') : '';
  if (requestedRoleNorm === 'superadmin' && !isSuper) {
    return res.status(403).json({ success: false, message: 'You do not have permission to assign the Super Admin role.' });
  }
  if (requestedRoleNorm === 'admin' && !isSuper) {
    return res.status(403).json({ success: false, message: 'Admins cannot assign the Admin role.' });
  }

  if (!isSuper) {
    const adminCity = await getAssignedUserCity(currentUser);
    const targetCity = await getAssignedUserCity(existingUser);
    if (adminCity && targetCity && adminCity.toLowerCase() !== targetCity.toLowerCase()) {
      return res.status(403).json({ success: false, message: `Admins can only manage users in their assigned city (${adminCity}).` });
    }
  }

  const allowedRoles = await roleOptions(currentUser);
  const errors = validateUserUpdate(req.body, allowedRoles);

  if (errors.length > 0) {
    return res.status(422).json({ success: false, message: 'Validation failed', errors });
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
    if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
      return res.status(409).json({ success: false, message: 'Email already exists' });
    }

    console.error('User update error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update user' });
  }
}

async function destroy(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const id = Number(req.params.id);

  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid user ID is required' });
  }

  if (currentUser && Number(currentUser.id) === id) {
    return res.status(422).json({ success: false, message: 'You cannot delete your own account' });
  }

  const existingUser = await User.findById(id);
  if (!existingUser) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (isSuperAdminUser(existingUser)) {
    return res.status(403).json({ success: false, message: 'Super Admin accounts cannot be deleted.' });
  }

  if (['admin', 'superadmin'].includes(String(existingUser.role || '').toLowerCase()) && !isSuper) {
    return res.status(403).json({ success: false, message: 'Admins cannot delete Admin accounts.' });
  }

  if (!isSuper) {
    const adminCity = await getAssignedUserCity(currentUser);
    const targetCity = await getAssignedUserCity(existingUser);
    if (adminCity && targetCity && adminCity.toLowerCase() !== targetCity.toLowerCase()) {
      return res.status(403).json({ success: false, message: `Admins can only delete users in their assigned city (${adminCity}).` });
    }
  }

  await User.softDelete(id);
  return res.json({ success: true, message: 'User deleted successfully' });
}

module.exports = { index, update, destroy, isSuperAdminUser, getAssignedUserCity };
