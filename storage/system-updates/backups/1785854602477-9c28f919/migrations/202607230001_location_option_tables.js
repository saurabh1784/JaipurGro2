const LocationOption = require('../models/LocationOption');

module.exports = {
  id: '202607230001_location_option_tables',
  name: 'Add DB-backed country state city location options',
  async up(db) {
    await LocationOption.ensureTable(db);
    await LocationOption.seedDefaultsIfEmpty(db);
  },
};
