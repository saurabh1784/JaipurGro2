const LocationOption = require('../models/LocationOption');

const locationTree = LocationOption.DEFAULT_LOCATION_TREE;

function flattenLocationOptions() {
  return LocationOption.flattenTree(locationTree);
}

async function flattenLocationOptionsFromDb() {
  try {
    return await LocationOption.list();
  } catch (error) {
    console.error('Location options load error:', error);
    return flattenLocationOptions();
  }
}

function isValidLocation({ country, state, city }, options = flattenLocationOptions()) {
  const tree = options.tree || locationTree;
  const countryStates = tree[country];
  if (!countryStates) return false;
  const stateCities = countryStates[state];
  if (!Array.isArray(stateCities)) return false;
  return stateCities.includes(city);
}

module.exports = {
  locationTree,
  flattenLocationOptions,
  flattenLocationOptionsFromDb,
  isValidLocation,
};