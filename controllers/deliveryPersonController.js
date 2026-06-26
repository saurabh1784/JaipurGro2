const bcrypt = require('bcryptjs');
const pool = require('../db');
const DeliveryPerson = require('../models/DeliveryPerson');
const Wallet = require('../models/Wallet');
const Rating = require('../models/Rating');

const text = (value) => String(value || '').trim();
const actor = (req) => req.authUser || req.session.user;

function validate(body, creating = false) {
  if (text(body.name).length < 2) return 'Name is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(body.login_id || body.email))) return 'A valid login ID (email) is required';
  if (!/^\d{7,15}$/.test(text(body.phone).replace(/\D/g, ''))) return 'A valid phone number is required';
  if (!text(body.city)) return 'City is required';
  if (creating && text(body.password).length < 6) return 'Password must be at least 6 characters';
  if (body.password && text(body.password).length < 6) return 'Password must be at least 6 characters';
  return null;
}

async function validateAreaAssignments(body, connection) {
  if (!Array.isArray(body.delivery_areas)) return;
  if (!body.delivery_areas.length) {
    const error = new Error('Select at least one service area');
    error.status = 422;
    throw error;
  }
  for (const entry of body.delivery_areas) {
    const city = text(entry && entry.city);
    const area = text(entry && (entry.area || entry.name));
    const [rows] = await connection.query(
      `SELECT id FROM area_definitions
       WHERE is_active = 1 AND LOWER(TRIM(city)) = LOWER(TRIM(?)) AND LOWER(TRIM(name)) = LOWER(TRIM(?))
       LIMIT 1`,
      [city, area]
    );
    if (!rows.length) {
      const error = new Error(`Area "${area}" in ${city} is not available`);
      error.status = 422;
      throw error;
    }
  }
}

async function index(req, res) {
  if (!req.query.format && req.accepts(['html', 'json']) !== 'json') return res.render('delivery-persons', { user: req.session.user });
  try {
    const result = await DeliveryPerson.list({ ...req.query, vehicleType: req.query.vehicle_type });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Delivery person list error:', error);
    res.status(500).json({ success: false, message: 'Unable to load delivery persons' });
  }
}

async function showPage(req, res) {
  const person = await DeliveryPerson.findById(Number(req.params.id));
  if (!person) return res.status(404).send('Delivery person not found');
  person.rating_summary = await Rating.summary('delivery_person', person.id);
  return res.render('delivery-person-profile', { user: req.session.user, person });
}

async function show(req, res) {
  try {
    const id = Number(req.params.id);
    const person = await DeliveryPerson.findById(id);
    if (!person) return res.status(404).json({ success: false, message: 'Delivery person not found' });
    person.rating_summary = await Rating.summary('delivery_person', id);
    const [orders, offers, walletData, activity] = await Promise.all([DeliveryPerson.orders(id), DeliveryPerson.offers(id), Wallet.transactionsByUserId(id, { limit: 100 }), DeliveryPerson.activity(id)]);
    res.json({ success: true, person, orders, offers, wallet: walletData.wallet, walletTransactions: walletData.transactions, activity });
  } catch (error) {
    console.error('Delivery person profile error:', error);
    res.status(500).json({ success: false, message: 'Unable to load delivery person profile' });
  }
}

async function create(req, res) {
  const errorMessage = validate(req.body, true);
  if (errorMessage) return res.status(422).json({ success: false, message: errorMessage });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const email = text(req.body.login_id || req.body.email).toLowerCase();
    const phone = text(req.body.phone);
    const [duplicates] = await connection.query('SELECT id FROM users WHERE is_deleted = 0 AND (email = ? OR phone = ?) LIMIT 1', [email, phone]);
    if (duplicates.length) { const e = new Error('Login ID or phone already exists'); e.status = 409; throw e; }
    const hash = await bcrypt.hash(text(req.body.password), 10);
    const status = text(req.body.status).toLowerCase() === 'blocked' ? 'blocked' : 'active';
    const [result] = await connection.query('INSERT INTO users (name, email, phone, password, role, status) VALUES (?, ?, ?, ?, ?, ?)', [text(req.body.name), email, phone, hash, 'deliveryPerson', status]);
    const id = result.insertId;
    await validateAreaAssignments(req.body, connection);
    await DeliveryPerson.upsertProfile(id, { ...req.body, status }, connection);
    await Wallet.ensureForUser(id, connection);
    const opening = Number(req.body.initial_wallet_balance || 0);
    if (opening > 0) {
      const [wallets] = await connection.query('SELECT id FROM wallets WHERE user_id = ? LIMIT 1', [id]);
      await connection.query('UPDATE wallets SET balance = ? WHERE user_id = ?', [opening, id]);
      await connection.query(`INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, net_amount, balance_before, balance_after, reference, note, created_by, transaction_by_name, transaction_by_email, transaction_by_role, transaction_at) VALUES (?, ?, 'credit', ?, ?, 0, ?, 'OPENING', 'Initial wallet balance', ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [wallets[0].id, id, opening, opening, opening, actor(req).id, actor(req).name, actor(req).email, actor(req).role]);
    }
    await DeliveryPerson.log({ deliveryPersonId: id, actorId: actor(req).id, action: 'profile_created', description: 'Delivery person profile created' }, connection);
    await connection.commit();
    res.status(201).json({ success: true, message: 'Delivery person created successfully', id });
  } catch (error) {
    await connection.rollback();
    console.error('Delivery person create error:', error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Unable to create delivery person' });
  } finally { connection.release(); }
}

async function update(req, res) {
  const errorMessage = validate(req.body, false);
  if (errorMessage) return res.status(422).json({ success: false, message: errorMessage });
  const id = Number(req.params.id);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await DeliveryPerson.findById(id);
    if (!current) { const e = new Error('Delivery person not found'); e.status = 404; throw e; }
    const email = text(req.body.login_id || req.body.email).toLowerCase();
    const phone = text(req.body.phone);
    const [duplicates] = await connection.query('SELECT id FROM users WHERE is_deleted = 0 AND id <> ? AND (email = ? OR phone = ?) LIMIT 1', [id, email, phone]);
    if (duplicates.length) { const e = new Error('Login ID or phone already exists'); e.status = 409; throw e; }
    const status = text(req.body.status).toLowerCase() === 'blocked' ? 'blocked' : 'active';
    await validateAreaAssignments(req.body, connection);
    const password = text(req.body.password);
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await connection.query('UPDATE users SET name = ?, email = ?, phone = ?, password = ?, status = ? WHERE id = ?', [text(req.body.name), email, phone, hash, status, id]);
    } else {
      await connection.query('UPDATE users SET name = ?, email = ?, phone = ?, status = ? WHERE id = ?', [text(req.body.name), email, phone, status, id]);
    }
    await DeliveryPerson.upsertProfile(id, { ...req.body, status }, connection);
    await DeliveryPerson.log({ deliveryPersonId: id, actorId: actor(req).id, action: 'profile_updated', description: 'Profile details updated' }, connection);
    if (password) {
      await DeliveryPerson.log({ deliveryPersonId: id, actorId: actor(req).id, action: 'password_updated', description: 'Login password updated from profile edit' }, connection);
    }
    await connection.commit();
    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (error) {
    await connection.rollback();
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Unable to update profile' });
  } finally { connection.release(); }
}

async function setStatus(req, res) {
  const id = Number(req.params.id);
  const status = text(req.body.status).toLowerCase();
  if (!['active', 'blocked'].includes(status)) return res.status(422).json({ success: false, message: 'Status must be active or blocked' });
  try {
    const person = await DeliveryPerson.findById(id);
    if (!person) return res.status(404).json({ success: false, message: 'Delivery person not found' });
    await pool.query('UPDATE users SET status = ? WHERE id = ?', [status, id]);
    await pool.query('UPDATE delivery_partner_settings SET is_active = ? WHERE user_id = ?', [status === 'active' ? 1 : 0, id]);
    await DeliveryPerson.log({ deliveryPersonId: id, actorId: actor(req).id, action: status === 'active' ? 'account_unblocked' : 'account_blocked', description: status === 'active' ? 'Account enabled' : 'Account blocked from accepting new orders' });
    res.json({ success: true, message: status === 'active' ? 'Delivery person unblocked' : 'Delivery person blocked' });
  } catch (error) { res.status(500).json({ success: false, message: 'Unable to update account status' }); }
}

async function resetPassword(req, res) {
  const id = Number(req.params.id);
  const password = text(req.body.password) || `Gro${Math.random().toString(36).slice(2, 8)}!${Math.floor(Math.random() * 90 + 10)}`;
  if (password.length < 6) return res.status(422).json({ success: false, message: 'Password must be at least 6 characters' });
  const person = await DeliveryPerson.findById(id);
  if (!person) return res.status(404).json({ success: false, message: 'Delivery person not found' });
  await pool.query('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(password, 10), id]);
  await DeliveryPerson.log({ deliveryPersonId: id, actorId: actor(req).id, action: 'password_reset', description: 'Login password reset by administrator' });
  res.json({ success: true, message: 'Password reset successfully', generatedPassword: password });
}

async function adjustWallet(req, res) {
  try {
    const id = Number(req.params.id);
    const wallet = await Wallet.adjustBalance({ userId: id, type: req.body.type, amount: req.body.amount, note: req.body.note, reference: req.body.reference, createdBy: actor(req).id });
    await DeliveryPerson.log({ deliveryPersonId: id, actorId: actor(req).id, action: req.body.type === 'debit' ? 'wallet_debited' : 'wallet_credited', description: `${req.body.type === 'debit' ? 'Deducted' : 'Added'} INR ${Number(req.body.amount).toFixed(2)}`, metadata: { amount: Number(req.body.amount), balance: wallet.balance } });
    res.json({ success: true, message: 'Wallet updated successfully', wallet });
  } catch (error) { res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update wallet' }); }
}

module.exports = { index, showPage, show, create, update, setStatus, resetPassword, adjustWallet };
