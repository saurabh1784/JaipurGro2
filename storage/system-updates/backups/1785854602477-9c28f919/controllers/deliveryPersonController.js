const bcrypt = require('bcryptjs');
const pool = require('../db');
const DeliveryPerson = require('../models/DeliveryPerson');
const Wallet = require('../models/Wallet');
const Rating = require('../models/Rating');
const { isSuperAdminUser, getAssignedUserCity } = require('./userController');

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
  const currentActor = actor(req);
  const isSuper = isSuperAdminUser(currentActor);
  const adminCity = await getAssignedUserCity(currentActor);
  const filterCity = isSuper ? (req.query.city || '') : adminCity;

  if (!req.query.format && req.accepts(['html', 'json']) !== 'json') {
    return res.render('delivery-persons', { user: req.session.user, isSuperAdmin: isSuper, adminCity });
  }

  try {
    const result = await DeliveryPerson.list({ ...req.query, city: filterCity, vehicleType: req.query.vehicle_type });
    res.json({ success: true, isSuperAdmin: isSuper, adminCity, ...result });
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
    const currentActor = actor(req);
    const isSuper = isSuperAdminUser(currentActor);
    const adminCity = await getAssignedUserCity(currentActor);

    const id = Number(req.params.id);
    const person = await DeliveryPerson.findById(id);
    if (!person) return res.status(404).json({ success: false, message: 'Delivery person not found' });

    if (!isSuper && adminCity && person.city && person.city.toLowerCase() !== adminCity.toLowerCase()) {
      return res.status(403).json({ success: false, message: `Admins can only view delivery partners in their assigned city (${adminCity}).` });
    }

    person.rating_summary = await Rating.summary('delivery_person', id);
    const [orders, offers, walletData, activity] = await Promise.all([DeliveryPerson.orders(id), DeliveryPerson.offers(id), Wallet.transactionsByUserId(id, { limit: 100 }), DeliveryPerson.activity(id)]);
    res.json({ success: true, person, orders, offers, wallet: walletData.wallet, walletTransactions: walletData.transactions, activity });
  } catch (error) {
    console.error('Delivery person profile error:', error);
    res.status(500).json({ success: false, message: 'Unable to load delivery person profile' });
  }
}

async function create(req, res) {
  const currentActor = actor(req);
  const isSuper = isSuperAdminUser(currentActor);
  const adminCity = await getAssignedUserCity(currentActor);

  if (!isSuper && adminCity) {
    if (req.body.city && text(req.body.city).toLowerCase() !== adminCity.toLowerCase()) {
      return res.status(403).json({ success: false, message: `Admins can only create delivery partners for their assigned city (${adminCity}).` });
    }
    req.body.city = adminCity;
  }

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
  const currentActor = actor(req);
  const isSuper = isSuperAdminUser(currentActor);
  const adminCity = await getAssignedUserCity(currentActor);
  const id = Number(req.params.id);

  const current = await DeliveryPerson.findById(id);
  if (!current) return res.status(404).json({ success: false, message: 'Delivery person not found' });

  if (!isSuper && adminCity) {
    if (current.city && current.city.toLowerCase() !== adminCity.toLowerCase()) {
      return res.status(403).json({ success: false, message: `Admins can only manage delivery partners in their assigned city (${adminCity}).` });
    }
    req.body.city = adminCity;
  }

  const errorMessage = validate(req.body, false);
  if (errorMessage) return res.status(422).json({ success: false, message: errorMessage });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
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
  const currentActor = actor(req);
  const isSuper = isSuperAdminUser(currentActor);
  const adminCity = await getAssignedUserCity(currentActor);
  const id = Number(req.params.id);
  const status = text(req.body.status).toLowerCase();
  if (!['active', 'blocked'].includes(status)) return res.status(422).json({ success: false, message: 'Status must be active or blocked' });
  try {
    const person = await DeliveryPerson.findById(id);
    if (!person) return res.status(404).json({ success: false, message: 'Delivery person not found' });
    if (!isSuper && adminCity && person.city && person.city.toLowerCase() !== adminCity.toLowerCase()) {
      return res.status(403).json({ success: false, message: `Admins can only update status for delivery partners in their assigned city (${adminCity}).` });
    }
    await pool.query('UPDATE users SET status = ? WHERE id = ?', [status, id]);
    await pool.query('UPDATE delivery_partner_settings SET is_active = ? WHERE user_id = ?', [status === 'active' ? 1 : 0, id]);
    await DeliveryPerson.log({ deliveryPersonId: id, actorId: actor(req).id, action: status === 'active' ? 'account_unblocked' : 'account_blocked', description: status === 'active' ? 'Account enabled' : 'Account blocked from accepting new orders' });
    res.json({ success: true, message: status === 'active' ? 'Delivery person unblocked' : 'Delivery person blocked' });
  } catch (error) { res.status(500).json({ success: false, message: 'Unable to update account status' }); }
}

async function resetPassword(req, res) {
  const currentActor = actor(req);
  const isSuper = isSuperAdminUser(currentActor);
  const adminCity = await getAssignedUserCity(currentActor);
  const id = Number(req.params.id);
  const password = text(req.body.password) || `Gro${Math.random().toString(36).slice(2, 8)}!${Math.floor(Math.random() * 90 + 10)}`;
  if (password.length < 6) return res.status(422).json({ success: false, message: 'Password must be at least 6 characters' });
  const person = await DeliveryPerson.findById(id);
  if (!person) return res.status(404).json({ success: false, message: 'Delivery person not found' });
  if (!isSuper && adminCity && person.city && person.city.toLowerCase() !== adminCity.toLowerCase()) {
    return res.status(403).json({ success: false, message: `Admins can only reset password for delivery partners in their assigned city (${adminCity}).` });
  }
  await pool.query('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(password, 10), id]);
  await DeliveryPerson.log({ deliveryPersonId: id, actorId: actor(req).id, action: 'password_reset', description: 'Login password reset by administrator' });
  res.json({ success: true, message: 'Password reset successfully', generatedPassword: password });
}

async function adjustWallet(req, res) {
  try {
    const currentActor = actor(req);
    const isSuper = isSuperAdminUser(currentActor);
    const adminCity = await getAssignedUserCity(currentActor);
    const id = Number(req.params.id);
    const person = await DeliveryPerson.findById(id);
    if (!person) return res.status(404).json({ success: false, message: 'Delivery person not found' });
    if (!isSuper && adminCity && person.city && person.city.toLowerCase() !== adminCity.toLowerCase()) {
      return res.status(403).json({ success: false, message: `Admins can only adjust wallet for delivery partners in their assigned city (${adminCity}).` });
    }
    const wallet = await Wallet.adjustBalance({ userId: id, type: req.body.type, amount: req.body.amount, note: req.body.note, reference: req.body.reference, createdBy: actor(req).id });
    await DeliveryPerson.log({ deliveryPersonId: id, actorId: actor(req).id, action: req.body.type === 'debit' ? 'wallet_debited' : 'wallet_credited', description: `${req.body.type === 'debit' ? 'Deducted' : 'Added'} INR ${Number(req.body.amount).toFixed(2)}`, metadata: { amount: Number(req.body.amount), balance: wallet.balance } });
    res.json({ success: true, message: 'Wallet updated successfully', wallet });
  } catch (error) { res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to update wallet' }); }
}

async function fullDetails(req, res) {
  try {
    const currentActor = actor(req);
    const isSuper = isSuperAdminUser(currentActor);
    const adminCity = await getAssignedUserCity(currentActor);

    const id = Number(req.params.id);
    const person = await DeliveryPerson.findById(id);
    if (!person) return res.status(404).json({ success: false, message: 'Delivery person not found' });

    if (!isSuper && adminCity && person.city && person.city.toLowerCase() !== adminCity.toLowerCase()) {
      return res.status(403).json({ success: false, message: `Admins can only view delivery partners in their assigned city (${adminCity}).` });
    }

    const SupportTicket = require('../models/SupportTicket');

    // Rating summary & review list
    const ratingSummary = await Rating.summary('delivery_person', id).catch(() => ({ average_rating: 0, review_count: 0 }));
    const [ratingRows] = await pool.query(
      `SELECT r.*, u.name AS client_name
       FROM ratings r
       INNER JOIN users u ON u.id = r.user_id
       WHERE r.target_id = ? AND LOWER(r.rating_type) = 'delivery_person'
       ORDER BY r.created_at DESC`,
      [id]
    ).catch(() => [[]]);

    const ratingsList = (ratingRows || []).map((r) => ({
      id: r.id,
      order_id: r.order_id,
      client_name: r.client_name || 'Client',
      rating: Number(r.rating || 0),
      feedback: r.comment || r.feedback || 'No feedback provided',
      created_at: r.created_at,
    }));

    // Orders history with client and vendor info
    const [orderRows] = await pool.query(
      `SELECT o.*,
              c.name AS client_name, c.phone AS client_phone,
              v.name AS vendor_name, vprof.business_name AS vendor_business_name
       FROM client_orders o
       LEFT JOIN users c ON c.id = o.client_id
       LEFT JOIN users v ON v.id = o.vendor_id
       LEFT JOIN vendor_profiles vprof ON vprof.user_id = o.vendor_id
       WHERE o.delivery_partner_id = ?
       ORDER BY o.created_at DESC`,
      [id]
    ).catch(() => [[]]);

    const orders = (orderRows || []).map((o) => {
      const assignedAt = o.assigned_at || o.created_at;
      const deliveredAt = o.delivered_at || o.status_updated_at;
      let deliveryTimeMinutes = 0;
      if (assignedAt && deliveredAt && ['delivered', 'completed'].includes(String(o.status).toLowerCase())) {
        deliveryTimeMinutes = Math.max(1, Math.round((new Date(deliveredAt).getTime() - new Date(assignedAt).getTime()) / (1000 * 60)));
      }
      return {
        id: o.id,
        order_number: o.order_number || `#${o.id}`,
        client_id: o.client_id,
        client_name: o.client_name || o.shipping_name || 'Client',
        client_phone: o.client_phone || o.shipping_phone || '-',
        vendor_id: o.vendor_id,
        vendor_name: o.vendor_business_name || o.vendor_name || 'Vendor',
        pickup_address: [o.vendor_city, o.vendor_area].filter(Boolean).join(', ') || 'Vendor Store',
        delivery_address: o.shipping_address || o.client_address || '-',
        delivery_charge: Number(o.delivery_fee || o.shipping_fee || 0),
        delivery_earning: Number(o.delivery_earning || (o.delivery_fee ? o.delivery_fee * 0.8 : 0)),
        total_amount: Number(o.total_amount || 0),
        payment_method: o.payment_method || 'wallet',
        payment_status: o.payment_status || (['delivered', 'completed'].includes(String(o.status).toLowerCase()) ? 'paid' : 'pending'),
        status: o.status || 'pending',
        delivery_status: o.delivery_status || '',
        assigned_at: assignedAt,
        delivered_at: deliveredAt,
        delivery_time_minutes: deliveryTimeMinutes,
        distance_km: Number(o.distance_km || 2.5),
        cancelled_by: o.cancelled_by || (String(o.status).toLowerCase() === 'cancelled' ? 'Delivery Person' : null),
        cancellation_reason: o.cancellation_reason || (String(o.status).toLowerCase() === 'cancelled' ? 'Delivery cancelled' : null),
        cancelled_at: o.cancelled_at || (String(o.status).toLowerCase() === 'cancelled' ? o.updated_at : null),
        penalty_applied: Number(o.penalty_amount || 0) > 0,
        penalty_amount: Number(o.penalty_amount || 0),
        items: o.items ? (typeof o.items === 'string' ? JSON.parse(o.items) : o.items) : [],
      };
    });

    // Offers & Rejections
    const rawOffers = await DeliveryPerson.offers(id).catch(() => []);
    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

    let rejectedLast7DaysCount = 0;
    const offers = (rawOffers || []).map((off) => {
      const isRejected = ['rejected', 'unaccepted'].includes(String(off.status || '').toLowerCase());
      const resTime = off.responded_at || off.created_at;
      if (isRejected && resTime && new Date(resTime).getTime() >= sevenDaysAgo) {
        rejectedLast7DaysCount++;
      }
      return {
        id: off.id,
        order_id: off.order_id || off.id,
        order_number: off.order_number || `#${off.order_id || off.id}`,
        request_time: off.created_at,
        response_time: resTime,
        rejection_reason: off.response_note || 'Request expired / rejected by delivery person',
        assigned_area: off.delivery_area || off.pickup_area || person.city || '-',
        status: off.status,
      };
    });

    // Wallet & Transactions
    const walletData = await Wallet.transactionsByUserId(id, { limit: 200 }).catch(() => ({ wallet: { balance: 0 }, transactions: [] }));

    // Complaints
    const [complaintRows] = await pool.query(
      `SELECT st.*, u.name AS requester_name, staff.name AS assigned_staff_name
       FROM support_tickets st
       INNER JOIN users u ON u.id = st.requester_id
       LEFT JOIN users staff ON staff.id = st.assigned_staff_id
       WHERE st.delivery_partner_id = ? OR (st.requester_id = ? AND st.requester_role = 'deliveryPerson')
       ORDER BY st.created_at DESC`,
      [id, id]
    ).catch(() => [[]]);

    const complaints = (complaintRows || []).map((c) => ({
      id: c.id,
      order_id: c.order_id || null,
      client_name: c.requester_name || 'Client',
      category: c.category || 'Delivery Issue',
      description: c.description || c.subject || '',
      created_at: c.created_at,
      assigned_staff_id: c.assigned_staff_id || null,
      assigned_staff_name: c.assigned_staff_name || 'Unassigned',
      status: c.status || 'Open',
      resolution: c.resolution || '',
    }));

    // Calculate Working Status: Free, Assigned, On Pickup, or On Delivery
    let workingStatus = 'Free';
    if (!person.is_available) {
      workingStatus = 'Offline';
    } else {
      const activeOrders = orders.filter((o) => ['assigned', 'ready_for_pickup', 'out_for_delivery'].includes(String(o.status).toLowerCase()));
      if (activeOrders.length > 0) {
        const topOrder = activeOrders[0];
        if (String(topOrder.status).toLowerCase() === 'out_for_delivery') workingStatus = 'On Delivery';
        else if (String(topOrder.status).toLowerCase() === 'ready_for_pickup') workingStatus = 'On Pickup';
        else workingStatus = 'Assigned';
      }
    }

    // Sub-lists
    const completedDeliveries = orders.filter((o) => ['delivered', 'completed'].includes(String(o.status).toLowerCase()));
    const cancelledDeliveries = orders.filter((o) => ['cancelled', 'rejected'].includes(String(o.status).toLowerCase()));
    const rejectedRequests = offers.filter((off) => ['rejected', 'unaccepted'].includes(String(off.status).toLowerCase()));
    const activeDeliveries = orders.filter((o) => ['assigned', 'ready_for_pickup', 'out_for_delivery'].includes(String(o.status).toLowerCase()));
    const failedDeliveriesCount = person.failed_delivery_attempts + person.otp_conflict_count;

    // Delivery times
    const deliveredTimes = completedDeliveries.map((o) => o.delivery_time_minutes).filter(Boolean);
    const avgDeliveryTime = deliveredTimes.length ? Math.round(deliveredTimes.reduce((a, b) => a + b, 0) / deliveredTimes.length) : 25;

    // Earnings calculations
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();

    let totalEarnings = 0;
    let todayEarnings = 0;
    let weeklyEarnings = 0;
    let monthlyEarnings = 0;
    let yearlyEarnings = 0;

    for (const o of completedDeliveries) {
      const earning = Number(o.delivery_earning || 0);
      const time = new Date(o.delivered_at || o.created_at).getTime();
      totalEarnings += earning;
      if (time >= todayStart) todayEarnings += earning;
      if (time >= sevenDaysAgo) weeklyEarnings += earning;
      if (time >= monthStart) monthlyEarnings += earning;
      if (time >= yearStart) yearlyEarnings += earning;
    }

    // Summary Metrics & Cards (8 Cards)
    const stats = {
      total_deliveries: orders.length,
      completed_deliveries: completedDeliveries.length,
      cancelled_deliveries: cancelledDeliveries.length,
      rejected_requests: rejectedRequests.length,
      rejected_last_7_days: rejectedLast7DaysCount,
      active_deliveries: activeDeliveries.length,
      failed_deliveries: failedDeliveriesCount,
      total_complaints: complaints.length,
      avg_delivery_time_min: avgDeliveryTime,
      avg_rating: Number(ratingSummary.average_rating || 5.0).toFixed(1),
      total_earnings: totalEarnings,
    };

    const earningsSummary = {
      total_earnings: totalEarnings,
      today_earnings: todayEarnings,
      weekly_earnings: weeklyEarnings,
      monthly_earnings: monthlyEarnings,
      yearly_earnings: yearlyEarnings,
      delivery_charge_sum: completedDeliveries.reduce((acc, o) => acc + o.delivery_charge, 0),
      admin_commission_sum: completedDeliveries.reduce((acc, o) => acc + (o.delivery_charge - o.delivery_earning), 0),
      deductions_sum: orders.reduce((acc, o) => acc + o.penalty_amount, 0),
      incentives_sum: 0,
      penalties_sum: orders.reduce((acc, o) => acc + o.penalty_amount, 0),
      final_earnings_sum: totalEarnings,
    };

    const fullPersonDetails = {
      profile: {
        ...person,
        working_status: workingStatus,
        online_status: person.is_available ? 'Online' : 'Offline',
        wallet_balance: Number(walletData.wallet?.balance || person.wallet_balance || 0),
      },
      stats,
      earnings: earningsSummary,
      orders,
      completed_deliveries: completedDeliveries,
      cancelled_deliveries: cancelledDeliveries,
      rejected_requests: rejectedRequests,
      active_deliveries: activeDeliveries,
      complaints,
      wallet_transactions: walletData.transactions || [],
      ratings: ratingsList,
    };

    return res.json({ success: true, person: fullPersonDetails });
  } catch (error) {
    console.error('Full delivery person details error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load delivery partner full details' });
  }
}

async function updateComplaint(req, res) {
  const personId = Number(req.params.id);
  const ticketId = Number(req.params.ticketId);

  if (!personId || !ticketId) {
    return res.status(422).json({ success: false, message: 'Delivery Person ID and Complaint ID are required' });
  }

  const currentActor = actor(req);
  const isSuper = isSuperAdminUser(currentActor);
  const adminCity = await getAssignedUserCity(currentActor);

  try {
    const person = await DeliveryPerson.findById(personId);
    if (!person) return res.status(404).json({ success: false, message: 'Delivery person not found' });
    if (!isSuper && adminCity && person.city && person.city.toLowerCase() !== adminCity.toLowerCase()) {
      return res.status(403).json({ success: false, message: `Admins can only manage complaints in their assigned city (${adminCity}).` });
    }

    const SupportTicket = require('../models/SupportTicket');
    const { status, resolution, assigned_staff_id } = req.body;
    const ticket = await SupportTicket.updateResolution({
      ticketId,
      status: status || 'Resolved',
      resolution: resolution || '',
      assignedStaffId: assigned_staff_id ? Number(assigned_staff_id) : currentActor.id,
    });

    return res.json({ success: true, message: 'Complaint updated successfully', ticket });
  } catch (error) {
    console.error('Update delivery partner complaint error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Unable to update complaint' });
  }
}

module.exports = { index, showPage, show, create, update, setStatus, resetPassword, adjustWallet, fullDetails, updateComplaint };
