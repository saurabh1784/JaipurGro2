const locationTree = {
  India: {
    Rajasthan: ['Jaipur'],
    Maharashtra: ['Mumbai'],
  },
  'United States': {
    California: ['San Francisco'],
  },
};

function flattenLocationOptions() {
  return {
    countries: Object.keys(locationTree),
    states: [...new Set(Object.values(locationTree).flatMap((states) => Object.keys(states)))],
    cities: [...new Set(Object.values(locationTree).flatMap((states) => Object.values(states).flat()))],
    tree: locationTree,
  };
}

function isValidLocation({ country, state, city }) {
  return Boolean(
    country &&
      state &&
      city &&
      locationTree[country] &&
      locationTree[country][state] &&
      locationTree[country][state].includes(city)
  );
}

module.exports = {
  locationTree,
  flattenLocationOptions,
  isValidLocation,
};
