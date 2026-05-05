const bcrypt = require('bcryptjs');
const pool = require('../db');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Wallet = require('../models/Wallet');
const { sign } = require('../utils/jwt');
const { revokeToken } = require('../middleware/tokenBlacklist');
const { validateSignup, validateLogin } = require('../middleware/validators');

function tokenPayload(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
  };
}

async function signup(req, res) {
  const errors = validateSignup(req.body);
  if (errors.length > 0) {
    return res.status(422).json({ success: false, message: 'Validation failed', errors });
  }

  const name = String(req.body.name).trim();
  const email = String(req.body.email).trim().toLowerCase();
  const phone = String(req.body.phone).trim();
  const password = String(req.body.password);
  const role = req.body.role;

  const existingUser = await User.findByEmailOrPhone(email, phone);
  if (existingUser) {
    const field = existingUser.email === email ? 'email' : 'phone';
    return res.status(409).json({ success: false, message: `A user with this ${field} already exists` });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = await User.create({ name, email, phone, password: hashedPassword, role }, connection);
    await Profile.createEmptyForRole(userId, role, connection);
    await Wallet.ensureForUser(userId, connection);
    await connection.commit();

    const user = await User.findById(userId);
    const token = sign(tokenPayload(user));

    return res.status(201).json({
      success: true,
      message: 'Signup successful',
      token,
      user: User.publicUser(user),
    });
  } catch (error) {
    await connection.rollback();
    console.error('Signup error:', error);
    return res.status(500).json({ success: false, message: 'Unable to create user' });
  } finally {
    connection.release();
  }
}

async function login(req, res) {
  const errors = validateLogin(req.body);
  if (errors.length > 0) {
    return res.status(422).json({ success: false, message: 'Validation failed', errors });
  }

  const email = String(req.body.email).trim().toLowerCase();
  const user = await User.findByEmail(email);

  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ success: false, message: 'Your account is inactive' });
  }

  const passwordMatches = await bcrypt.compare(String(req.body.password), user.password);
  if (!passwordMatches) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const token = sign(tokenPayload(user));
  return res.json({
    success: true,
    message: 'Login successful',
    token,
    user: User.publicUser(user),
  });
}

function logout(req, res) {
  if (req.token) {
    revokeToken(req.token);
  }

  return res.json({ success: true, message: 'Logout successful' });
}

module.exports = { signup, login, logout };
