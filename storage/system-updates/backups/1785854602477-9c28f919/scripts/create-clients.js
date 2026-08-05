const bcrypt = require('bcryptjs');
const pool = require('../db');
const Client = require('../models/Client');

const PASSWORD = 'pasword';
const COUNT = 5;

async function main() {
  const hashed = await bcrypt.hash(PASSWORD, 10);
  const created = [];

  for (let i = 1; i <= COUNT; i += 1) {
    const email = `client${i}@example.com`;
    const phone = `930000000${i}`;
    const name = `Client ${i}`;

    const duplicate = await Client.emailOrPhoneTaken({ email, phone });
    if (duplicate) {
      console.log(`Skipping ${email}: email or phone already exists`);
      continue;
    }

    const id = await Client.create({
      name,
      email,
      phone,
      password: hashed,
      status: 'active',
      address: '',
      country: '',
      state: '',
      city: '',
      area: '',
      age: '',
      gender: '',
      notes: '',
    });
    created.push({ id, name, email, phone });
    console.log(`Created client id=${id} email=${email}`);
  }

  console.log(`\nDone. Created ${created.length} clients. Password for all: ${PASSWORD}`);
  await pool.end();
}

main().catch((error) => {
  console.error('Failed to create clients:', error);
  process.exit(1);
});
