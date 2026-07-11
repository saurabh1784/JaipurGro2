const pool = require('../db');

(async () => {
  const { rows } = await pool.query(
    "SELECT id, name, email, phone, role, status, is_deleted FROM users WHERE phone IN ('9000000003','9000000004','9000000005') OR email IN ('client3@example.com','client4@example.com','client5@example.com')"
  );
  console.table(rows);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
