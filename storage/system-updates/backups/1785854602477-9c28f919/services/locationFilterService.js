const pool = require('../db');

function normalizeRole(value) {
  return String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
}

function isSuperAdminUser(user) {
  if (!user) return false;
  if (normalizeRole(user.role) === 'superadmin' || normalizeRole(user.roleName) === 'superadmin') return true;
  if (Array.isArray(user.roles)) {
    return user.roles.some((r) => normalizeRole(r.slug) === 'superadmin' || normalizeRole(r.name) === 'superadmin');
  }
  return false;
}

function isAdminUser(user) {
  if (!user) return false;
  if (isSuperAdminUser(user)) return false;
  const r = normalizeRole(user.role || user.roleName);
  if (['admin', 'staff', 'staffl1', 'staffl2', 'staffl3', 'manager'].includes(r)) return true;
  if (Array.isArray(user.roles)) {
    return user.roles.some((roleObj) => ['admin', 'staff', 'staffl1', 'staffl2', 'staffl3', 'manager'].includes(normalizeRole(roleObj.slug || roleObj.name)));
  }
  return false;
}

function parseCitiesInput(val) {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.map((c) => String(c).trim()).filter(Boolean);
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map((c) => String(c).trim()).filter(Boolean);
      } catch (e) {
        // Fallback to splitting by comma
      }
    }
    return trimmed.split(',').map((c) => c.trim()).filter(Boolean);
  }
  return [];
}

async function getAllSystemCities() {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT TRIM(city) AS city FROM (
        SELECT city FROM area_definitions WHERE city IS NOT NULL AND TRIM(city) <> ''
        UNION
        SELECT city FROM client_profiles WHERE city IS NOT NULL AND TRIM(city) <> ''
        UNION
        SELECT city FROM vendor_profiles WHERE city IS NOT NULL AND TRIM(city) <> ''
        UNION
        SELECT city FROM delivery_person_profiles WHERE city IS NOT NULL AND TRIM(city) <> ''
        UNION
        SELECT shipping_city AS city FROM client_orders WHERE shipping_city IS NOT NULL AND TRIM(shipping_city) <> ''
      ) AS all_c ORDER BY city ASC
    `);
    return rows.map((r) => r.city).filter(Boolean);
  } catch (err) {
    console.error('Error fetching system cities:', err);
    return ['Jaipur', 'Ajmer', 'Kota'];
  }
}

async function getAdminAssignedCities(user) {
  const isSuper = isSuperAdminUser(user);
  const allSystemCities = await getAllSystemCities();

  if (isSuper) {
    return {
      isSuper: true,
      assignedCities: allSystemCities,
      allCities: allSystemCities,
    };
  }

  let assignedCities = [];

  // Parse from user object session first
  if (user) {
    if (user.assigned_cities) {
      assignedCities = parseCitiesInput(user.assigned_cities);
    } else if (user.city) {
      assignedCities = parseCitiesInput(user.city);
    }
  }

  // Fetch from database if user ID exists
  if (user && user.id) {
    try {
      const { rows } = await pool.query(
        `SELECT u.city AS user_city, ap.city AS admin_city, ap.assigned_cities
         FROM users u
         LEFT JOIN admin_profiles ap ON ap.user_id = u.id
         WHERE u.id = $1 LIMIT 1`,
        [user.id]
      );
      if (rows.length > 0) {
        const row = rows[0];
        const dbAssigned = parseCitiesInput(row.assigned_cities);
        const dbCity = parseCitiesInput(row.admin_city || row.user_city);

        if (dbAssigned.length > 0) {
          assignedCities = dbAssigned;
        } else if (dbCity.length > 0) {
          assignedCities = dbCity;
        }
      }
    } catch (e) {
      console.error('Error loading admin assigned cities from DB:', e);
    }
  }

  // Deduplicate case-insensitively while preserving capital names
  const uniqueMap = new Map();
  assignedCities.forEach((c) => {
    const key = c.toLowerCase();
    if (!uniqueMap.has(key)) uniqueMap.set(key, c);
  });
  const finalAssigned = Array.from(uniqueMap.values());

  return {
    isSuper: false,
    assignedCities: finalAssigned,
    allCities: allSystemCities,
  };
}

async function validateCityAndAreaAccess(user, requestedCity, requestedArea) {
  const access = await getAdminAssignedCities(user);
  const cleanCityReq = String(requestedCity || '').trim();
  const cleanAreaReq = String(requestedArea || '').trim();

  // If superadmin
  if (access.isSuper) {
    const isAll = !cleanCityReq || cleanCityReq.toLowerCase() === 'all' || cleanCityReq.toLowerCase() === 'all_assigned' || cleanCityReq === '*';
    const targetCities = isAll ? [] : [cleanCityReq];
    return {
      allowed: true,
      isSuper: true,
      targetCities,
      selectedCity: isAll ? 'all' : cleanCityReq,
      selectedArea: cleanAreaReq && cleanAreaReq.toLowerCase() !== 'all' ? cleanAreaReq : '',
      assignedCities: access.allCities,
    };
  }

  // Admin user
  const assigned = access.assignedCities;
  if (!assigned || assigned.length === 0) {
    return {
      allowed: false,
      statusCode: 403,
      message: 'Access Denied: You have no assigned cities.',
      assignedCities: [],
    };
  }

  const isAllRequested = !cleanCityReq || cleanCityReq.toLowerCase() === 'all' || cleanCityReq.toLowerCase() === 'all_assigned' || cleanCityReq === '*';

  if (isAllRequested) {
    return {
      allowed: true,
      isSuper: false,
      targetCities: assigned,
      selectedCity: assigned.length === 1 ? assigned[0] : 'all_assigned',
      selectedArea: cleanAreaReq && cleanAreaReq.toLowerCase() !== 'all' ? cleanAreaReq : '',
      assignedCities: assigned,
    };
  }

  // Check if requested city is within assigned cities
  const isAssigned = assigned.some((c) => c.toLowerCase() === cleanCityReq.toLowerCase());
  if (!isAssigned) {
    return {
      allowed: false,
      statusCode: 403,
      message: `Access Denied: You are not authorized to view data for city '${cleanCityReq}'.`,
      assignedCities: assigned,
    };
  }

  return {
    allowed: true,
    isSuper: false,
    targetCities: [cleanCityReq],
    selectedCity: cleanCityReq,
    selectedArea: cleanAreaReq && cleanAreaReq.toLowerCase() !== 'all' ? cleanAreaReq : '',
    assignedCities: assigned,
  };
}

async function getAllowedCitiesAndAreas(user) {
  const access = await getAdminAssignedCities(user);
  const cities = access.isSuper ? access.allCities : access.assignedCities;

  let cityAreasMap = {};
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT TRIM(city) AS city, TRIM(name) AS area
       FROM area_definitions
       WHERE city IS NOT NULL AND TRIM(city) <> ''
         AND name IS NOT NULL AND TRIM(name) <> ''
         AND is_active = 1
       ORDER BY city ASC, area ASC`
    );
    rows.forEach((r) => {
      const cityKey = r.city;
      cityAreasMap[cityKey] = cityAreasMap[cityKey] || [];
      if (!cityAreasMap[cityKey].includes(r.area)) {
        cityAreasMap[cityKey].push(r.area);
      }
    });
  } catch (err) {
    console.error('Error building city-area map:', err);
  }

  return {
    isSuper: access.isSuper,
    assignedCities: access.assignedCities,
    allCities: access.allCities,
    displayCities: cities,
    cityAreasMap,
  };
}

module.exports = {
  normalizeRole,
  isSuperAdminUser,
  isAdminUser,
  getAdminAssignedCities,
  validateCityAndAreaAccess,
  getAllowedCitiesAndAreas,
};
