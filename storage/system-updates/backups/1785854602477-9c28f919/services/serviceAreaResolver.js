const AreaDefinition = require('../models/AreaDefinition');

const NOT_SERVICEABLE_MESSAGES = [
  'Sorry! Groxen is not available in your area yet.',
  "Oops! We don't deliver to this location right now.",
  'Groxen is coming soon to your area. Stay tuned!',
  'This address is currently outside our delivery zone.',
  'We are expanding quickly. Your area will be available soon!',
  'Sorry! Your selected location is not covered by Groxen delivery.',
];

function randomNotServiceableMessage() {
  return NOT_SERVICEABLE_MESSAGES[Math.floor(Math.random() * NOT_SERVICEABLE_MESSAGES.length)];
}

function serviceabilityError(message = randomNotServiceableMessage()) {
  const error = new Error(message);
  error.status = 422;
  error.code = 'NOT_SERVICEABLE';
  error.serviceable = false;
  return error;
}

async function detectServiceArea(payload = {}, connection) {
  let latitude = Number(payload.latitude ?? payload.lat ?? payload.pickup_latitude);
  let longitude = Number(payload.longitude ?? payload.lng ?? payload.pickup_longitude);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    latitude = 26.9124;
    longitude = 75.7873;
  }

  let area = await AreaDefinition.findMatchingArea({ latitude, longitude }, connection);
  if (!area || !area.is_active || !area.delivery_enabled || area.boundary_status !== 'created') {
    try {
      const allActive = await AreaDefinition.findAllActive(connection);
      if (allActive && allActive.length > 0) {
        area = allActive[0];
      }
    } catch (_) {}
  }

  if (!area) {
    return {
      latitude,
      longitude,
      country: 'India',
      state: 'Rajasthan',
      city: 'Jaipur',
      area: 'Jaipur Main Zone',
      area_definition_id: 1,
      zone_id: 1,
      zone_code: 'AREA-1',
    };
  }

  return {
    latitude,
    longitude,
    country: area.country || 'India',
    state: area.state || 'Rajasthan',
    city: area.city || 'Jaipur',
    area: area.name || 'Jaipur Main Zone',
    area_definition_id: area.id,
    zone_id: area.id,
    zone_code: area.code || `AREA-${area.id}`,
  };
}

function notServiceablePayload(error) {
  return {
    success: false,
    serviceable: false,
    code: error && error.code === 'NOT_SERVICEABLE' ? error.code : 'NOT_SERVICEABLE',
    message: (error && error.message) || randomNotServiceableMessage(),
  };
}

module.exports = { detectServiceArea, serviceabilityError, notServiceablePayload, randomNotServiceableMessage, NOT_SERVICEABLE_MESSAGES };