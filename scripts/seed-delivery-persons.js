const bcrypt = require('bcryptjs');
const pgPool = require('../db');
const { ensureAllSchemaTables } = require('../services/schemaSyncService');

async function seedDeliveryPersons() {
  console.log('🚀 Starting Delivery Person Seeding...');

  try {
    // 1. Ensure DB Schema & Tables
    await ensureAllSchemaTables(pgPool);

    const deliveryUsers = [
      {
        name: 'Rahul Delivery Partner',
        email: 'delivery1@example.com',
        phone: '9876543210',
        password: 'password',
        city: 'Jaipur',
        area: 'Malviya Nagar',
        vehicleType: 'Bike',
        vehicleNumber: 'RJ-14-AB-1234',
      },
      {
        name: 'Vikram Delivery Partner',
        email: 'delivery2@example.com',
        phone: '9876543211',
        password: 'password',
        city: 'Jaipur',
        area: 'Vaishali Nagar',
        vehicleType: 'Scooter',
        vehicleNumber: 'RJ-14-CD-5678',
      },
      {
        name: 'Suresh Express Rider',
        email: 'delivery3@example.com',
        phone: '9876543212',
        password: 'password',
        city: 'Jaipur',
        area: 'Raja Park',
        vehicleType: 'E-Bike',
        vehicleNumber: 'RJ-14-EV-9012',
      },
      {
        name: 'Amit Logistics Partner',
        email: 'delivery4@example.com',
        phone: '9876543213',
        password: 'password',
        city: 'Jaipur',
        area: 'Mansarovar',
        vehicleType: 'Bike',
        vehicleNumber: 'RJ-14-XY-3456',
      },
      {
        name: 'Rohan Delivery Executive',
        email: 'delivery5@example.com',
        phone: '9876543214',
        password: 'password',
        city: 'Jaipur',
        area: 'C Scheme',
        vehicleType: 'Scooter',
        vehicleNumber: 'RJ-14-ZZ-7890',
      },
    ];

    let createdCount = 0;
    let updatedCount = 0;

    for (const dp of deliveryUsers) {
      const hashedPassword = await bcrypt.hash(dp.password, 10);

      // Insert or find user
      const [existingRows] = await pgPool.query(
        'SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
        [dp.email]
      );

      let userId;
      if (existingRows && existingRows.length > 0) {
        userId = existingRows[0].id;
        await pgPool.query(
          `UPDATE users 
           SET name = ?, phone = ?, password = ?, role = 'deliveryperson', city = ?, area = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [dp.name, dp.phone, hashedPassword, dp.city, dp.area, userId]
        );
        updatedCount++;
      } else {
        const [insertResult] = await pgPool.query(
          `INSERT INTO users (name, email, phone, password, role, status, city, area)
           VALUES (?, ?, ?, ?, 'deliveryperson', 'active', ?, ?)
           RETURNING id`,
          [dp.name, dp.email, dp.phone, hashedPassword, dp.city, dp.area]
        );
        userId = insertResult[0]?.id || insertResult.insertId;
        createdCount++;
      }

      // Upsert delivery_person_profile
      await pgPool.query(
        `INSERT INTO delivery_person_profiles (user_id, city, area, vehicle_type, vehicle_number, is_available)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT (user_id) DO UPDATE
         SET city = EXCLUDED.city,
             area = EXCLUDED.area,
             vehicle_type = EXCLUDED.vehicle_type,
             vehicle_number = EXCLUDED.vehicle_number,
             is_available = 1,
             updated_at = CURRENT_TIMESTAMP`,
        [userId, dp.city, dp.area, dp.vehicleType, dp.vehicleNumber]
      );
    }

    console.log(`\n✅ Delivery Person Seeding Completed Successfully!`);
    console.log(`   - New Users Created: ${createdCount}`);
    console.log(`   - Existing Users Updated: ${updatedCount}`);
    console.log(`   - Credentials: delivery1@example.com to delivery5@example.com / password\n`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Delivery Person Seeding Error:', error);
    process.exit(1);
  }
}

seedDeliveryPersons();
