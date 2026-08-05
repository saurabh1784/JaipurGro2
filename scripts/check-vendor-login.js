const bcrypt = require('bcryptjs');
const pool = require('../db');
const User = require('../models/User');

async function testVendorLogin() {
  console.log('--- Testing Vendor Login Flow ---');
  try {
    const identifier = 'vendor.sharma@groxen.in';
    const password = 'vendor123';

    console.log(`Looking up user by identifier: "${identifier}"`);
    const rawUser = await User.findByEmailOrPhoneIdentifier(identifier);
    console.log('Found Raw User:', rawUser ? {
      id: rawUser.id,
      name: rawUser.name,
      email: rawUser.email,
      phone: rawUser.phone,
      role: rawUser.role,
      roleType: typeof rawUser.role,
      status: rawUser.status
    } : null);

    if (!rawUser) {
      console.error('FAIL: User not found in DB!');
      return;
    }

    console.log(`Checking role comparison: rawUser.role ("${rawUser.role}") === 'Vendor' -> ${rawUser.role === 'Vendor'}`);
    console.log(`Checking role case-insensitive comparison: String(rawUser.role).toLowerCase() === 'vendor' -> ${String(rawUser.role).toLowerCase() === 'vendor'}`);
    console.log(`Checking status: rawUser.status ("${rawUser.status}") === 'active' -> ${rawUser.status === 'active'}`);

    const passwordMatches = await bcrypt.compare(password, rawUser.password);
    console.log(`Checking password match for "${password}": ${passwordMatches}`);

    if (passwordMatches && String(rawUser.role).toLowerCase() === 'vendor' && rawUser.status === 'active') {
      console.log('✅ Vendor Login Test PASSED successfully!');
    } else {
      console.error('❌ Vendor Login Test FAILED!');
    }
  } catch (err) {
    console.error('ERROR in testVendorLogin:', err);
  } finally {
    process.exit(0);
  }
}

testVendorLogin();
