const bcrypt = require('bcryptjs');
const db = require('../db');

async function createSuperadmin() {
  const hash = await bcrypt.hash('password', 10);
  const emails = ['superadmin@esample.com', 'superadmin@example.com'];

  for (const email of emails) {
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    const userRows = existing[0] || [];
    if (userRows.length > 0) {
      const userId = userRows[0].id;
      await db.query(
        "UPDATE users SET password = $1, role = 'superadmin', status = 'active', is_deleted = 0 WHERE id = $2",
        [hash, userId]
      );
      console.log(`✅ Superadmin updated: ${email} (ID: ${userId})`);
    } else {
      const inserted = await db.query(
        "INSERT INTO users (name, email, password, role, status, is_deleted) VALUES ($1, $2, $3, 'superadmin', 'active', 0) RETURNING id",
        ['Super Admin', email, hash]
      );
      const newId = inserted.insertId || (inserted[0] && inserted[0][0] && inserted[0][0].id);
      console.log(`✅ Superadmin created: ${email} (ID: ${newId})`);
    }
  }
  await db.end();
}

createSuperadmin().catch((err) => {
  console.error('❌ Error creating superadmin:', err);
  db.end();
  process.exit(1);
});
