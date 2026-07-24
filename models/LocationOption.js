const pool = require('../db');

const DEFAULT_LOCATION_TREE = {
  India: {
    Rajasthan: ['Jaipur'],
    Maharashtra: ['Mumbai'],
  },
  'United States': {
    California: ['San Francisco'],
  },
};

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function uniqueCleanList(values = []) {
  return [...new Set([].concat(values || []).map(cleanName).filter(Boolean))];
}

function normalizeTree(payload = {}) {
  const source = payload.tree && typeof payload.tree === 'object' ? payload.tree : payload;
  const tree = {};

  Object.entries(source || {}).forEach(([countryName, states]) => {
    const country = cleanName(countryName);
    if (!country || !states || typeof states !== 'object') return;
    tree[country] = tree[country] || {};
    Object.entries(states).forEach(([stateName, cities]) => {
      const state = cleanName(stateName);
      if (!state) return;
      tree[country][state] = uniqueCleanList(cities);
    });
  });

  uniqueCleanList(payload.countries).forEach((country) => {
    tree[country] = tree[country] || {};
  });

  [].concat(payload.states || []).forEach((entry) => {
    const state = cleanName(entry && typeof entry === 'object' ? entry.name : entry);
    const country = cleanName(entry && typeof entry === 'object' ? entry.country : '') || Object.keys(tree)[0] || '';
    if (!country || !state) return;
    tree[country] = tree[country] || {};
    tree[country][state] = tree[country][state] || [];
  });

  [].concat(payload.cities || []).forEach((entry) => {
    const city = cleanName(entry && typeof entry === 'object' ? entry.name : entry);
    const country = cleanName(entry && typeof entry === 'object' ? entry.country : '') || Object.keys(tree)[0] || '';
    const state = cleanName(entry && typeof entry === 'object' ? entry.state : '')
      || (country && tree[country] ? Object.keys(tree[country])[0] : '');
    if (!country || !state || !city) return;
    tree[country] = tree[country] || {};
    tree[country][state] = uniqueCleanList([...(tree[country][state] || []), city]);
  });

  return tree;
}

function flattenTree(tree = {}) {
  const countries = Object.keys(tree).sort((left, right) => left.localeCompare(right));
  const stateEntries = [];
  const cityEntries = [];

  countries.forEach((country) => {
    Object.keys(tree[country] || {}).sort((left, right) => left.localeCompare(right)).forEach((state) => {
      stateEntries.push({ name: state, country });
      uniqueCleanList(tree[country][state]).sort((left, right) => left.localeCompare(right)).forEach((city) => {
        cityEntries.push({ name: city, state, country });
      });
    });
  });

  return {
    tree,
    countries,
    states: uniqueCleanList(stateEntries.map((entry) => entry.name)).sort((left, right) => left.localeCompare(right)),
    cities: uniqueCleanList(cityEntries.map((entry) => entry.name)).sort((left, right) => left.localeCompare(right)),
    stateEntries,
    cityEntries,
  };
}

async function ensureTable(connection = pool) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS countries (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      code VARCHAR(12) DEFAULT NULL,
      is_active SMALLINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uniq_countries_name UNIQUE (name)
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS states (
      id SERIAL PRIMARY KEY,
      country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      is_active SMALLINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uniq_states_country_name UNIQUE (country_id, name)
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS cities (
      id SERIAL PRIMARY KEY,
      state_id INTEGER NOT NULL REFERENCES states(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      is_active SMALLINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uniq_cities_state_name UNIQUE (state_id, name)
    )
  `);
  await connection.query('CREATE INDEX IF NOT EXISTS idx_states_country_id ON states (country_id)');
  await connection.query('CREATE INDEX IF NOT EXISTS idx_cities_state_id ON cities (state_id)');
}

async function countRows(connection = pool) {
  const [rows] = await connection.query('SELECT COUNT(*) AS count FROM countries');
  return Number(rows[0] && rows[0].count) || 0;
}

async function insertTree(tree, connection = pool) {
  for (const country of Object.keys(tree)) {
    const [countryResult] = await connection.query(
      `INSERT INTO countries (name, code, is_active)
       VALUES (?, ?, 1)
       ON CONFLICT (name) DO UPDATE SET is_active = 1, updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [country, null]
    );
    const countryId = countryResult.insertId || (countryResult.rows && countryResult.rows[0] && countryResult.rows[0].id);
    for (const state of Object.keys(tree[country] || {})) {
      const [stateResult] = await connection.query(
        `INSERT INTO states (country_id, name, is_active)
         VALUES (?, ?, 1)
         ON CONFLICT (country_id, name) DO UPDATE SET is_active = 1, updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [countryId, state]
      );
      const stateId = stateResult.insertId || (stateResult.rows && stateResult.rows[0] && stateResult.rows[0].id);
      for (const city of uniqueCleanList(tree[country][state])) {
        await connection.query(
          `INSERT INTO cities (state_id, name, is_active)
           VALUES (?, ?, 1)
           ON CONFLICT (state_id, name) DO UPDATE SET is_active = 1, updated_at = CURRENT_TIMESTAMP`,
          [stateId, city]
        );
      }
    }
  }
}

async function seedDefaultsIfEmpty(connection = pool) {
  await ensureTable(connection);
  if (await countRows(connection)) return;
  await insertTree(DEFAULT_LOCATION_TREE, connection);
}

async function list(connection = pool) {
  await ensureTable(connection);
  await seedDefaultsIfEmpty(connection);
  const [rows] = await connection.query(`
    SELECT
      c.id AS country_id, c.name AS country,
      s.id AS state_id, s.name AS state,
      ci.id AS city_id, ci.name AS city
    FROM countries c
    LEFT JOIN states s ON s.country_id = c.id
    LEFT JOIN cities ci ON ci.state_id = s.id
    WHERE c.is_active = 1
      AND (s.id IS NULL OR s.is_active = 1)
      AND (ci.id IS NULL OR ci.is_active = 1)
    ORDER BY c.name, s.name, ci.name
  `);
  const tree = {};
  rows.forEach((row) => {
    const country = cleanName(row.country);
    const state = cleanName(row.state);
    const city = cleanName(row.city);
    if (!country) return;
    tree[country] = tree[country] || {};
    if (!state) return;
    tree[country][state] = tree[country][state] || [];
    if (city) tree[country][state].push(city);
  });
  return {
    ...flattenTree(tree),
    countryEntries: rows
      .filter((row, index, all) => row.country_id && all.findIndex((item) => Number(item.country_id) === Number(row.country_id)) === index)
      .map((row) => ({ id: Number(row.country_id), name: cleanName(row.country) })),
    stateEntriesDetailed: rows
      .filter((row, index, all) => row.state_id && all.findIndex((item) => Number(item.state_id) === Number(row.state_id)) === index)
      .map((row) => ({ id: Number(row.state_id), country_id: Number(row.country_id), name: cleanName(row.state), country: cleanName(row.country) })),
    cityEntriesDetailed: rows
      .filter((row, index, all) => row.city_id && all.findIndex((item) => Number(item.city_id) === Number(row.city_id)) === index)
      .map((row) => ({ id: Number(row.city_id), state_id: Number(row.state_id), country_id: Number(row.country_id), name: cleanName(row.city), state: cleanName(row.state), country: cleanName(row.country) })),
  };
}

async function replaceAll(payload, connection = pool) {
  const tree = normalizeTree(payload);
  if (!Object.keys(tree).length) {
    const error = new Error('Add at least one country');
    error.status = 422;
    throw error;
  }

  const db = connection;
  const ownsConnection = db === pool;
  const trx = ownsConnection ? await pool.getConnection() : db;
  try {
    if (ownsConnection) await trx.beginTransaction();
    await ensureTable(trx);
    await trx.query('DELETE FROM cities');
    await trx.query('DELETE FROM states');
    await trx.query('DELETE FROM countries');
    await insertTree(tree, trx);
    if (ownsConnection) await trx.commit();
  } catch (error) {
    if (ownsConnection) await trx.rollback();
    throw error;
  } finally {
    if (ownsConnection) trx.release();
  }

  return list(connection);
}

module.exports = {
  DEFAULT_LOCATION_TREE,
  cleanName,
  ensureTable,
  flattenTree,
  list,
  normalizeTree,
  replaceAll,
  seedDefaultsIfEmpty,
};

