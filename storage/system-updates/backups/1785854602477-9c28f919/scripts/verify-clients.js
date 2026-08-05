const pool = require('../db');

(async () => {
  const { rows } = await pool.query(
    "SELECT id, name, email, phone, role, status FROM users WHERE email LIKE 'client%@example.com' AND is_deleted = 0 ORDER BY id"
  );
  console.table(rows);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
