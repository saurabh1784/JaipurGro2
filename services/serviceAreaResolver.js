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
  const latitude = Number(payload.latitude ?? payload.lat ?? payload.pickup_latitude);
  const longitude = Number(payload.longitude ?? payload.lng ?? payload.pickup_longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw serviceabilityError('Please select a valid address from Google Maps.');
  }

  // Intentionally do not pass client-supplied city/area/zone values. Coordinates are authoritative.
  const area = await AreaDefinition.findMatchingArea({ latitude, longitude }, connection);
  if (!area || !area.is_active || !area.delivery_enabled || area.boundary_status !== 'created') {
    throw serviceabilityError();
  }

  return {
    latitude,
    longitude,
    country: area.country || '',
    state: area.state || '',
    city: area.city || '',
    area: area.name,
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