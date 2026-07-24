const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Profile = require('../models/Profile');
const AuditLog = require('../models/UserAuditLog');
const LocationOption = require('../models/LocationOption');
const AreaDefinition = require('../models/AreaDefinition');
const pool = require('../db');
const { editableUserRoles, validateStatus } = require('../middleware/validators');

const BUILT_IN_ROLES = ['superadmin', 'Admin', 'Staff', 'Provider', 'Client', 'Delivery Partner', 'Vendor', 'deliveryPerson', 'manager', 'staff'];
const ADMIN_BLOCKED_ROLES = ['superadmin', 'admin'];
const ALL_AREAS_VALUE = '*';

function isAllAreas(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === ALL_AREAS_VALUE || normalized === 'all' || normalized === 'all areas';
}

function normalizeAdminArea(value) {
  return isAllAreas(value) || !cleanText(value) ? ALL_AREAS_VALUE : cleanText(value);
}

async function getLocationData() {
  try {
    const options = await LocationOption.list();
    const areas = await AreaDefinition.list({ includeInactive: false });
    const cityAreas = {};
    (areas || []).forEach((area) => {
      const city = String(area.city || '').trim();
      const name = String(area.name || '').trim();
      if (!city || !name) return;
      cityAreas[city] = cityAreas[city] || [];
      if (!cityAreas[city].includes(name)) {
        cityAreas[city].push(name);
      }
    });
    Object.keys(cityAreas).forEach((city) => {
      cityAreas[city].sort((a, b) => a.localeCompare(b));
    });

    return {
      tree: options.tree || {},
      countries: options.countries || [],
      stateEntries: options.stateEntries || [],
      cityEntries: options.cityEntries || [],
      cityAreas,
    };
  } catch (error) {
    console.error('Error fetching location data:', error);
    return { tree: {}, countries: [], stateEntries: [], cityEntries: [], cityAreas: {} };
  }
}

async function validateDependentLocation(body) {
  const errors = [];
  const cleanCountry = cleanText(body.country);
  const cleanState = cleanText(body.state);
  const cleanCity = cleanText(body.city);
  const cleanArea = cleanText(body.area);

  if (!cleanCountry && !cleanState && !cleanCity && !cleanArea) {
    return errors;
  }

  const locationData = await getLocationData();
  const tree = locationData.tree || {};

  if (cleanCountry) {
    const countryMatch = Object.keys(tree).find((c) => c.toLowerCase() === cleanCountry.toLowerCase());
    if (!countryMatch) {
      errors.push(`Invalid country '${cleanCountry}'. Must be a valid active country.`);
      return errors;
    }
  }

  if (cleanState) {
    if (!cleanCountry) {
      errors.push('Country is required when state is specified.');
    } else {
      const countryMatch = Object.keys(tree).find((c) => c.toLowerCase() === cleanCountry.toLowerCase());
      const statesObj = (countryMatch && tree[countryMatch]) || {};
      const stateMatch = Object.keys(statesObj).find((s) => s.toLowerCase() === cleanState.toLowerCase());
      if (!stateMatch) {
        errors.push(`Selected state '${cleanState}' does not belong to country '${cleanCountry}'.`);
      }
    }
  }

  if (cleanCity) {
    if (!cleanState || !cleanCountry) {
      errors.push('Country and State are required when city is specified.');
    } else {
      const countryMatch = Object.keys(tree).find((c) => c.toLowerCase() === cleanCountry.toLowerCase());
      const statesObj = (countryMatch && tree[countryMatch]) || {};
      const stateMatch = Object.keys(statesObj).find((s) => s.toLowerCase() === cleanState.toLowerCase());
      const cities = (stateMatch && statesObj[stateMatch]) || [];
      const cityMatch = cities.find((c) => c.toLowerCase() === cleanCity.toLowerCase());
      if (!cityMatch) {
        errors.push(`Selected city '${cleanCity}' does not belong to state '${cleanState}'.`);
      }
    }
  }

  if (cleanArea && !isAllAreas(cleanArea)) {
    if (!cleanCity) {
      errors.push('City is required when area is specified.');
    } else {
      const cityMatchKey = Object.keys(locationData.cityAreas || {}).find((c) => c.toLowerCase() === cleanCity.toLowerCase());
      const cityAreas = (cityMatchKey && locationData.cityAreas[cityMatchKey]) || [];
      const areaMatch = cityAreas.find((a) => a.toLowerCase() === cleanArea.toLowerCase());
      if (!areaMatch) {
        errors.push(`Selected area '${cleanArea}' does not belong to city '${cleanCity}'.`);
      }
    }
  }

  return errors;
}

function normalizeRole(value) {
  return String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
}

function isSuperAdminUser(user) {
  if (!user) return false;
  if (normalizeRole(user.role) === 'superadmin' || normalizeRole(user.roleName) === 'superadmin') return true;
  return Array.isArray(user.roles) && user.roles.some((r) => normalizeRole(r.slug) === 'superadmin' || normalizeRole(r.name) === 'superadmin');
}

function isAdminUser(user) {
  return !isSuperAdminUser(user) && normalizeRole(user && user.role) === 'admin';
}

function canonicalProfileRole(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'provider' || normalized === 'vendor') return 'Vendor';
  if (normalized === 'deliverypartner' || normalized === 'deliveryperson') return 'deliveryPerson';
  if (normalized === 'client') return 'Client';
  if (normalized === 'admin' || normalized === 'superadmin') return 'Admin';
  return role;
}

function cleanText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function requestContext(req) {
  return {
    ipAddress: req.ip || (req.headers && req.headers['x-forwarded-for']) || null,
    userAgent: req.get ? req.get('user-agent') : null,
  };
}

async function getAssignedUserLocation(user) {
  if (!user) return { country: '', state: '', city: '', area: '' };
  if (user.country || user.state || user.city || user.area) {
    return {
      country: String(user.country || '').trim(),
      state: String(user.state || '').trim(),
      city: String(user.city || user.admin_city || user.profile_city || '').trim(),
      area: String(user.area || '').trim(),
    };
  }

  const { rows } = await pool.query(
    `SELECT COALESCE(NULLIF(u.country, ''), ap.country, cp.country, vp.country, '') AS country,
            COALESCE(NULLIF(u.state, ''), ap.state, cp.state, vp.state, '') AS state,
            COALESCE(NULLIF(u.city, ''), ap.city, cp.city, vp.city, dpp.city, '') AS city,
            COALESCE(NULLIF(u.area, ''), ap.area, cp.area, vp.area, dpp.area, '') AS area
     FROM users u
     LEFT JOIN admin_profiles ap ON ap.user_id = u.id
     LEFT JOIN client_profiles cp ON cp.user_id = u.id
     LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
     LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
     WHERE u.id = $1 LIMIT 1`,
    [user.id]
  ).catch(() => ({ rows: [] }));

  const row = rows[0] || {};
  return {
    country: String(row.country || '').trim(),
    state: String(row.state || '').trim(),
    city: String(row.city || '').trim(),
    area: String(row.area || '').trim(),
  };
}

async function getAssignedUserCity(user) {
  const location = await getAssignedUserLocation(user);
  return location.city || null;
}

function wantsJson(req) {
  return req.query.format === 'json' || req.accepts(['html', 'json']) === 'json';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

function isValidPhone(phone) {
  return !phone || /^[0-9+\-\s()]{7,20}$/.test(String(phone));
}

async function roleOptions(currentUser) {
  const isSuper = isSuperAdminUser(currentUser);

  try {
    const { rows } = await pool.query(
      `SELECT slug, name
       FROM roles
       WHERE slug IS NOT NULL AND TRIM(slug) <> ''
       ORDER BY level ASC, name ASC`
    );
    const dbRoles = rows.flatMap((role) => [role.name, role.slug]).filter(Boolean);
    const all = [...new Set([...BUILT_IN_ROLES, ...editableUserRoles, ...dbRoles])];
    return all.filter((role) => {
      const normalized = normalizeRole(role);
      if (!normalized) return false;
      if (!isSuper && ADMIN_BLOCKED_ROLES.includes(normalized)) return false;
      return true;
    });
  } catch {
    return [...new Set([...BUILT_IN_ROLES, ...editableUserRoles])].filter((role) => {
      const normalized = normalizeRole(role);
      return normalized && (isSuper || !ADMIN_BLOCKED_ROLES.includes(normalized));
    });
  }
}

async function adminOptions(currentUser) {
  const isSuper = isSuperAdminUser(currentUser);
  const values = [];
  const where = ["u.is_deleted = 0", "LOWER(REPLACE(REPLACE(REPLACE(u.role, ' ', ''), '_', ''), '-', '')) = 'admin'"];
  if (!isSuper) {
    const location = await getAssignedUserLocation(currentUser);
    where.push("LOWER(TRIM(COALESCE(NULLIF(u.city, ''), ap.city, ''))) = LOWER(TRIM($1))");
    values.push(location.city || '');
  }
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, COALESCE(NULLIF(u.city, ''), ap.city, '') AS city, COALESCE(NULLIF(u.area, ''), ap.area, '') AS area
     FROM users u
     LEFT JOIN admin_profiles ap ON ap.user_id = u.id
     WHERE ${where.join(' AND ')}
     ORDER BY u.name ASC`,
    values
  ).catch(() => ({ rows: [] }));
  return rows;
}

async function filterOptions(currentUser) {
  const isSuper = isSuperAdminUser(currentUser);
  const location = await getAssignedUserLocation(currentUser);
  const values = [];
  const where = ['u.is_deleted = 0'];
  if (!isSuper) {
    where.push("LOWER(REPLACE(REPLACE(REPLACE(u.role, ' ', ''), '_', ''), '-', '')) NOT IN ('superadmin', 'admin')");
    where.push("LOWER(TRIM(COALESCE(NULLIF(u.city, ''), ap.city, cp.city, vp.city, dpp.city, ''))) = LOWER(TRIM($1))");
    values.push(location.city || '');
  }
  const { rows } = await pool.query(
    `SELECT DISTINCT
        COALESCE(NULLIF(u.city, ''), ap.city, cp.city, vp.city, dpp.city, '') AS city,
        COALESCE(NULLIF(u.area, ''), ap.area, cp.area, vp.area, dpp.area, '') AS area
     FROM users u
     LEFT JOIN admin_profiles ap ON ap.user_id = u.id
     LEFT JOIN client_profiles cp ON cp.user_id = u.id
     LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
     LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
     WHERE ${where.join(' AND ')}
     ORDER BY city ASC, area ASC`,
    values
  ).catch(() => ({ rows: [] }));
  return {
    cities: [...new Set(rows.map((row) => row.city).filter(Boolean))],
    areas: [...new Set(rows.map((row) => row.area).filter(Boolean))],
    admins: await adminOptions(currentUser),
  };
}

function validateUserPayload(body, allowedRoles, { creating = false } = {}) {
  const errors = [];
  const name = cleanText(body.name || body.full_name);
  const email = cleanText(body.email);
  const phone = cleanText(body.phone);
  const role = cleanText(body.role);
  const status = cleanText(body.status) || 'active';

  if (!name || name.length < 2) errors.push('Full name must be at least 2 characters');
  if (!email || !isValidEmail(email)) errors.push('Valid email address is required');
  if (!isValidPhone(phone)) errors.push('Valid phone number is required');
  if (!role || !allowedRoles.some((allowed) => normalizeRole(allowed) === normalizeRole(role))) errors.push('Invalid role');
  if (!validateStatus(status)) errors.push('Status must be active or inactive');

  if (creating) {
    if (!body.password || String(body.password).length < 6) errors.push('Password must be at least 6 characters');
    if (String(body.password || '') !== String(body.confirm_password || body.confirmPassword || '')) errors.push('Password and confirm password must match');
  }

  return errors;
}

function canAdminAccessTarget(adminLocation, targetUser, adminId) {
  if (!targetUser) return false;
  const targetRole = normalizeRole(targetUser.role);
  if (targetRole === 'superadmin' || targetRole === 'admin') return false;
  const adminCity = String(adminLocation.city || '').trim().toLowerCase();
  const targetCity = String(targetUser.city || '').trim().toLowerCase();
  const adminArea = String(adminLocation.area || '').trim().toLowerCase();
  const targetArea = String(targetUser.area || '').trim().toLowerCase();
  const areaAllowed = isAllAreas(adminArea) || Boolean(adminArea && targetArea && adminArea === targetArea);
  return Boolean(adminCity && targetCity && adminCity === targetCity && areaAllowed && Number(targetUser.assigned_admin_id) === Number(adminId));
}

function locationFromRequest(body) {
  return {
    country: cleanText(body.country),
    state: cleanText(body.state),
    city: cleanText(body.city),
    area: cleanText(body.area),
  };
}

async function syncProfileLocation(userId, role, location, connection = pool) {
  const normalized = normalizeRole(role);
  if (normalized === 'admin' || normalized === 'superadmin') {
    await connection.query(
      `INSERT INTO admin_profiles (user_id, country, state, city, area)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET country = EXCLUDED.country, state = EXCLUDED.state, city = EXCLUDED.city, area = EXCLUDED.area`,
      [userId, location.country, location.state, location.city, location.area]
    );
  } else if (normalized === 'client') {
    await connection.query(
      `INSERT INTO client_profiles (user_id, country, state, city, area)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET country = EXCLUDED.country, state = EXCLUDED.state, city = EXCLUDED.city, area = EXCLUDED.area`,
      [userId, location.country, location.state, location.city, location.area]
    );
  } else if (normalized === 'provider' || normalized === 'vendor') {
    await connection.query(
      `INSERT INTO vendor_profiles (user_id, country, state, city, area)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET country = EXCLUDED.country, state = EXCLUDED.state, city = EXCLUDED.city, area = EXCLUDED.area`,
      [userId, location.country, location.state, location.city, location.area]
    );
  } else if (normalized === 'deliverypartner' || normalized === 'deliveryperson') {
    await connection.query(
      `INSERT INTO delivery_person_profiles (user_id, city, area)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET city = EXCLUDED.city, area = EXCLUDED.area`,
      [userId, location.city, location.area || '*']
    );
  }
}

async function index(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const adminLocation = await getAssignedUserLocation(currentUser);
  const roles = await roleOptions(currentUser);
  const options = await filterOptions(currentUser);
  const locationData = await getLocationData();

  if (!wantsJson(req)) {
    return res.render('users', {
      user: req.session.user,
      isSuperAdmin: isSuper,
      adminCity: adminLocation.city,
      adminLocation,
      roleOptions: roles,
      filterOptions: options,
      locationData,
    });
  }

  try {
    const result = await User.list({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      role: roles.some((role) => role === req.query.role) ? req.query.role : '',
      status: req.query.status,
      city: req.query.city,
      area: req.query.area,
      assignedAdminId: req.query.assigned_admin_id,
      isSuperAdmin: isSuper,
      adminCity: adminLocation.city,
      adminArea: adminLocation.area,
      adminId: currentUser && currentUser.id,
    });

    return res.json({
      success: true,
      isSuperAdmin: isSuper,
      adminCity: adminLocation.city,
      adminLocation,
      roleOptions: roles,
      filterOptions: options,
      locationData,
      ...result,
    });
  } catch (error) {
    console.error('User list error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch users' });
  }
}

async function show(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const target = await User.findById(Number(req.params.id));
  if (!target) return res.status(404).json({ success: false, message: 'User not found' });

  if (!isSuper) {
    const adminLocation = await getAssignedUserLocation(currentUser);
    if (!canAdminAccessTarget(adminLocation, target, currentUser && currentUser.id)) {
      return res.status(403).json({ success: false, message: 'Admins can only view users in their assigned city.' });
    }
  }

  const profile = await Profile.findByRole(target.id, canonicalProfileRole(target.role)).catch(() => null);
  return res.json({ success: true, user: User.publicUser(target), profile });
}

async function create(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const adminLocation = await getAssignedUserLocation(currentUser);
  const allowedRoles = await roleOptions(currentUser);
  const errors = validateUserPayload(req.body, allowedRoles, { creating: true });
  const requestedRole = cleanText(req.body.role);
  const requestedRoleNorm = normalizeRole(requestedRole);

  if (!isSuper && ADMIN_BLOCKED_ROLES.includes(requestedRoleNorm)) {
    return res.status(403).json({ success: false, message: 'Admins cannot create Admin or Superadmin accounts.' });
  }

  if (!isSuper && !adminLocation.city) {
    return res.status(403).json({ success: false, message: 'Your Admin account needs an assigned city before managing users.' });
  }

  if (errors.length > 0) {
    return res.status(422).json({ success: false, message: 'Validation failed', errors });
  }

  if (isSuper) {
    const locErrors = await validateDependentLocation(req.body);
    if (locErrors.length > 0) {
      return res.status(422).json({ success: false, message: 'Validation failed', errors: locErrors });
    }
  }

  let location = isSuper ? locationFromRequest(req.body) : {
    ...adminLocation,
    area: isAllAreas(adminLocation.area) ? cleanText(req.body.area) : adminLocation.area,
  };
  if (requestedRoleNorm === 'admin') location.area = normalizeAdminArea(location.area);
  if (!isSuper) {
    if (!location.area) return res.status(422).json({ success: false, message: 'Please select an area for this user.' });
    const scopedLocationErrors = await validateDependentLocation(location);
    if (scopedLocationErrors.length > 0) return res.status(422).json({ success: false, message: 'Validation failed', errors: scopedLocationErrors });
  }
  if (isSuper && requestedRoleNorm === 'admin' && !location.city) {
    return res.status(422).json({ success: false, message: 'Admins must have an assigned city.' });
  }

  const assignedAdminId = isSuper
    ? (req.body.assigned_admin_id ? Number(req.body.assigned_admin_id) : null)
    : Number(currentUser.id);
  const duplicate = await User.emailOrPhoneTaken({ id: 0, email: cleanText(req.body.email), phone: cleanText(req.body.phone) });
  if (duplicate) return res.status(409).json({ success: false, message: 'Email or phone already exists' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const hashedPassword = await bcrypt.hash(String(req.body.password), 10);
    const userId = await User.create({
      name: cleanText(req.body.name || req.body.full_name),
      email: cleanText(req.body.email).toLowerCase(),
      phone: cleanText(req.body.phone),
      password: hashedPassword,
      role: requestedRole,
      status: cleanText(req.body.status) || 'active',
      ...location,
      assigned_admin_id: assignedAdminId,
      created_by: currentUser && currentUser.id,
    }, connection);
    await Profile.createEmptyForRole(userId, canonicalProfileRole(requestedRole), connection);
    await syncProfileLocation(userId, requestedRole, location, connection);
    await AuditLog.record({
      actorId: currentUser && currentUser.id,
      targetUserId: userId,
      action: 'user.created',
      details: { role: requestedRole, location, assigned_admin_id: assignedAdminId },
      ...requestContext(req),
    }, connection);
    await connection.commit();
    const user = await User.findById(userId);
    return res.status(201).json({ success: true, message: 'User created successfully', user: User.publicUser(user) });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
      return res.status(409).json({ success: false, message: 'Email or phone already exists' });
    }
    console.error('User create error:', error);
    return res.status(500).json({ success: false, message: 'Unable to create user' });
  } finally {
    connection.release();
  }
}

async function update(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const id = Number(req.params.id);

  if (!id) return res.status(422).json({ success: false, message: 'Valid user ID is required' });

  const existingUser = await User.findById(id);
  if (!existingUser) return res.status(404).json({ success: false, message: 'User not found' });

  const adminLocation = await getAssignedUserLocation(currentUser);
  if (!isSuper && !canAdminAccessTarget(adminLocation, existingUser, currentUser && currentUser.id)) {
    return res.status(403).json({ success: false, message: 'Admins can only edit users in their assigned city and cannot edit Admin or Superadmin accounts.' });
  }

  const allowedRoles = await roleOptions(currentUser);
  const errors = validateUserPayload(req.body, allowedRoles);
  const requestedRole = cleanText(req.body.role);
  const requestedRoleNorm = normalizeRole(requestedRole);

  if (!isSuper && ADMIN_BLOCKED_ROLES.includes(requestedRoleNorm)) {
    return res.status(403).json({ success: false, message: 'Admins cannot assign Admin or Superadmin roles.' });
  }
  if (errors.length > 0) return res.status(422).json({ success: false, message: 'Validation failed', errors });

  if (isSuper) {
    const locErrors = await validateDependentLocation(req.body);
    if (locErrors.length > 0) {
      return res.status(422).json({ success: false, message: 'Validation failed', errors: locErrors });
    }
  }

  if (normalizeRole(existingUser.role) === 'superadmin' && existingUser.status === 'active' && cleanText(req.body.status) === 'inactive') {
    const remaining = await User.activeSuperadminCount(id);
    if (remaining < 1) {
      return res.status(422).json({ success: false, message: 'At least one active Superadmin must remain in the system.' });
    }
  }

  let location = isSuper ? locationFromRequest(req.body) : {
    country: existingUser.country || adminLocation.country,
    state: existingUser.state || adminLocation.state,
    city: adminLocation.city,
    area: isAllAreas(adminLocation.area) ? cleanText(req.body.area) : adminLocation.area,
  };
  if (requestedRoleNorm === 'admin') location.area = normalizeAdminArea(location.area);
  if (!isSuper) {
    if (!location.area) return res.status(422).json({ success: false, message: 'Please select an area for this user.' });
    const scopedLocationErrors = await validateDependentLocation(location);
    if (scopedLocationErrors.length > 0) return res.status(422).json({ success: false, message: 'Validation failed', errors: scopedLocationErrors });
  }
  if (isSuper && requestedRoleNorm === 'admin' && !location.city) {
    return res.status(422).json({ success: false, message: 'Admins must have an assigned city.' });
  }

  const duplicate = await User.emailOrPhoneTaken({ id, email: cleanText(req.body.email), phone: cleanText(req.body.phone) });
  if (duplicate) return res.status(409).json({ success: false, message: 'Email or phone already exists' });

  const updateData = {
    name: cleanText(req.body.name || req.body.full_name),
    email: cleanText(req.body.email).toLowerCase(),
    phone: cleanText(req.body.phone),
    role: requestedRole,
    status: cleanText(req.body.status) || 'active',
    ...location,
    assigned_admin_id: isSuper ? (req.body.assigned_admin_id ? Number(req.body.assigned_admin_id) : null) : (existingUser.assigned_admin_id || Number(currentUser.id)),
  };

  try {
    await User.updateBasic(id, updateData);
    await Profile.createEmptyForRole(id, canonicalProfileRole(updateData.role));
    await syncProfileLocation(id, updateData.role, location);
    await AuditLog.record({
      actorId: currentUser && currentUser.id,
      targetUserId: id,
      action: existingUser.status !== updateData.status ? `user.${updateData.status === 'active' ? 'activated' : 'deactivated'}` : 'user.updated',
      details: { before: User.publicUser(existingUser), after: updateData },
      ...requestContext(req),
    });
    const updatedUser = await User.findById(id);
    return res.json({ success: true, message: 'User updated successfully', user: User.publicUser(updatedUser) });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
      return res.status(409).json({ success: false, message: 'Email or phone already exists' });
    }
    console.error('User update error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update user' });
  }
}

async function destroy(req, res) {
  const currentUser = req.authUser || (req.session && req.session.user);
  const isSuper = isSuperAdminUser(currentUser);
  const id = Number(req.params.id);

  if (!id) return res.status(422).json({ success: false, message: 'Valid user ID is required' });
  if (currentUser && Number(currentUser.id) === id) {
    return res.status(422).json({ success: false, message: 'You cannot delete your own account' });
  }

  const existingUser = await User.findById(id);
  if (!existingUser) return res.status(404).json({ success: false, message: 'User not found' });

  if (!isSuper) {
    const adminLocation = await getAssignedUserLocation(currentUser);
    if (!canAdminAccessTarget(adminLocation, existingUser, currentUser && currentUser.id)) {
      return res.status(403).json({ success: false, message: 'Admins can only delete users in their assigned city and cannot delete Admin or Superadmin accounts.' });
    }
  }

  if (normalizeRole(existingUser.role) === 'superadmin' && existingUser.status === 'active') {
    const remaining = await User.activeSuperadminCount(id);
    if (remaining < 1) {
      return res.status(422).json({ success: false, message: 'At least one active Superadmin must remain in the system.' });
    }
  }

  await User.softDelete(id);
  await AuditLog.record({
    actorId: currentUser && currentUser.id,
    targetUserId: id,
    action: 'user.deleted',
    details: { deleted: User.publicUser(existingUser) },
    ...requestContext(req),
  });
  return res.json({ success: true, message: 'User deleted successfully' });
}

module.exports = {
  index,
  show,
  create,
  update,
  destroy,
  isSuperAdminUser,
  getAssignedUserCity,
  getAssignedUserLocation,
};
