const pool = require('../db');

const vendorServices = [
  ['vendor1@example.com', ['Home Delivery', 'Counter Pickup']],
  ['vendor2@example.com', ['Counter Pickup']],
  ['vendor3@example.com', ['Home Delivery', 'Counter Pickup', 'Wholesale Supply']],
  ['vendor4@example.com', ['Home Delivery']],
  ['vendor5@example.com', ['Home Delivery', 'Counter Pickup', 'Wholesale Supply']],
];

async function seedVendorServices() {
  for (const [email, services] of vendorServices) {
    await pool.query(
      `UPDATE vendor_profiles
       SET services = ?
       FROM users
       WHERE users.id = vendor_profiles.user_id
         AND users.email = ?`,
      [JSON.stringify(services), email]
    );
  }

  const [rows] = await pool.query(
    `SELECT u.email, vp.services
     FROM users u
     INNER JOIN vendor_profiles vp ON vp.user_id = u.id
     WHERE u.email IN (${vendorServices.map(() => '?').join(',')})
     ORDER BY u.email`,
    vendorServices.map(([email]) => email)
  );

  return rows;
}

seedVendorServices()
  .then((rows) => {
    console.log('Updated vendor services.');
    for (const row of rows) {
      const services = Array.isArray(row.services)
        ? row.services
        : JSON.parse(row.services || '[]');
      console.log(`${row.email}: ${services.join(', ')}`);
    }
  })
  .catch((error) => {
    console.error(`Unable to update vendor services: ${pool.formatError(error)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
