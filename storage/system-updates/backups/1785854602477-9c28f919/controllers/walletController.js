const User = require('../models/User');
const Wallet = require('../models/Wallet');
const { editableUserRoles } = require('../middleware/validators');
const paymentGatewayService = require('../services/paymentGatewayService');

function wantsJson(req) {
  return req.query.format === 'json' || req.accepts(['html', 'json']) === 'json';
}

function isSuperAdmin(user) {
  return String((user && (user.role || user.roleName)) || '').toLowerCase().replace(/[\s_-]+/g, '') === 'superadmin';
}

function canManageWallets(user) {
  return Boolean(
    user &&
      (user.role === 'Admin' ||
        isSuperAdmin(user) ||
        (Array.isArray(user.permissions) && (user.permissions.includes('all') || user.permissions.includes('wallets.manage'))))
  );
}

function isAdminWalletUser(user) {
  const role = String((user && (user.role || user.roleName)) || '').toLowerCase().replace(/[\s_-]+/g, '');
  return role === 'admin' || role === 'superadmin';
}

async function index(req, res) {
  if (!wantsJson(req)) {
    return res.render('wallets', {
      user: req.session.user,
      roleOptions: editableUserRoles,
      canManage: canManageWallets(req.authUser || req.session.user),
    });
  }

  try {
    if (!canManageWallets(req.authUser)) {
      const result = await Wallet.transactionsByUserId(req.authUser.id, {
        page: req.query.page,
        limit: req.query.limit,
      });
      return res.json({ success: true, mode: 'self', ...result });
    }

    const result = await Wallet.list({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      role: req.query.role,
      status: req.query.status,
    });

    return res.json({ success: true, mode: 'manage', ...result });
  } catch (error) {
    console.error('Wallet list error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch wallets' });
  }
}

function adminTransactionsPage(req, res) {
  return res.render('admin-wallet-transactions', {
    user: req.session.user,
    shell: res.locals.shell,
  });
}

async function adminTransactions(req, res) {
  if (!isAdminWalletUser(req.authUser || req.session.user)) {
    return res.status(403).json({ success: false, message: 'Only Admin users can access admin wallet transactions' });
  }

  try {
    const result = await Wallet.adminTransactions({
      page: req.query.page,
      limit: req.query.limit,
      filter: req.query.filter,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Admin wallet transactions error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch admin wallet transactions' });
  }
}

async function show(req, res) {
  const userId = Number(req.params.userId || req.authUser.id);
  if (!userId) {
    return res.status(422).json({ success: false, message: 'Valid user ID is required' });
  }

  if (!canManageWallets(req.authUser) && Number(req.authUser.id) !== userId) {
    return res.status(403).json({ success: false, message: 'You do not have permission to access this wallet' });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const result = await Wallet.transactionsByUserId(userId, {
    page: req.query.page,
    limit: req.query.limit,
  });

  return res.json({ success: true, user: User.publicUser(user), ...result });
}

async function adjust(req, res) {
  if (!canManageWallets(req.authUser)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to adjust wallets' });
  }

  const userId = Number(req.params.userId || req.body.user_id || req.body.userId);
  if (!userId) {
    return res.status(422).json({ success: false, message: 'Valid user ID is required' });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  try {
    const wallet = await Wallet.adjustBalance({
      userId,
      type: req.body.type,
      amount: req.body.amount,
      note: req.body.note,
      reference: req.body.reference,
      createdBy: req.authUser.id,
    });
    return res.json({ success: true, message: 'Wallet updated successfully', wallet });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to update wallet',
    });
  }
}

async function updateStatus(req, res) {
  if (!canManageWallets(req.authUser)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to update wallet status' });
  }

  const userId = Number(req.params.userId);
  if (!userId) {
    return res.status(422).json({ success: false, message: 'Valid user ID is required' });
  }

  try {
    const wallet = await Wallet.updateStatus(userId, req.body.status);
    return res.json({ success: true, message: 'Wallet status updated successfully', wallet });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to update wallet status',
    });
  }
}

async function createRazorpayOrder(req, res) {
  const currentActor = req.authUser || req.session.user;
  if (!currentActor) {
    console.warn('[RAZORPAY AUDIT LOG] Unauthorized wallet top-up attempt.');
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const amount = Number(req.body.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    console.warn(`[RAZORPAY AUDIT LOG] Invalid top-up amount: ${req.body.amount} by user ${currentActor.id}`);
    return res.status(422).json({ success: false, message: 'Top-up amount must be greater than ₹0' });
  }

  try {
    const rzpConfig = await paymentGatewayService.getRazorpayConfig();
    const keyId = rzpConfig.keyId || process.env.RAZORPAY_KEY_ID || 'rzp_test_groxen_key';
    const keySecret = rzpConfig.keySecret || process.env.RAZORPAY_KEY_SECRET || 'rzp_test_groxen_secret';
    const currency = rzpConfig.currency || 'INR';

    let orderId = `rzp_ord_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;
    let isRealOrder = false;

    if (keyId && keySecret && !keyId.includes('groxen_key')) {
      try {
        const Razorpay = require('razorpay');
        const instance = new Razorpay({ key_id: keyId, key_secret: keySecret });
        const order = await instance.orders.create({
          amount: Math.round(amount * 100),
          currency: currency,
          receipt: `topup_${currentActor.id}_${Date.now()}`,
          notes: { user_id: currentActor.id, type: 'wallet_topup' },
        });
        orderId = order.id;
        isRealOrder = true;
      } catch (rzpErr) {
        console.warn('[RAZORPAY AUDIT LOG] Razorpay SDK order creation fallback:', rzpErr.message);
      }
    }

    console.log(`[RAZORPAY AUDIT LOG] Created top-up order ${orderId} for user ${currentActor.id}, amount: ₹${amount}`);

    res.json({
      success: true,
      order_id: orderId,
      amount,
      amount_in_paise: Math.round(amount * 100),
      currency: currency,
      key_id: keyId,
      is_test_mode: !isRealOrder,
      user: {
        name: currentActor.name || 'User',
        email: currentActor.email || '',
        phone: currentActor.phone || '',
      },
    });
  } catch (error) {
    console.error('[RAZORPAY AUDIT LOG] Error creating Razorpay order:', error);
    res.status(500).json({ success: false, message: 'Unable to initiate Razorpay wallet top-up' });
  }
}

async function verifyRazorpayTopup(req, res) {
  const currentActor = req.authUser || req.session.user;
  if (!currentActor) {
    console.warn('[RAZORPAY AUDIT LOG] Unauthorized payment verification attempt.');
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const amount = Number(req.body.amount || 0);
  const paymentId = String(req.body.razorpay_payment_id || req.body.payment_id || req.body.paymentId || '').trim();
  const orderId = String(req.body.razorpay_order_id || req.body.order_id || req.body.orderId || '').trim();
  const signature = String(req.body.razorpay_signature || req.body.signature || '').trim();

  console.log(`[RAZORPAY AUDIT LOG] Payment verification requested - User: ${currentActor.id}, PaymentID: ${paymentId}, OrderID: ${orderId}, Amount: ₹${amount}`);

  if (!Number.isFinite(amount) || amount <= 0) {
    console.warn(`[RAZORPAY AUDIT LOG] Verification failed: Invalid amount ₹${amount}`);
    return res.status(422).json({ success: false, message: 'Payment failed. Wallet balance was not added.' });
  }

  if (!paymentId || !orderId || !signature) {
    console.warn(`[RAZORPAY AUDIT LOG] Verification failed: Incomplete payment details provided for payment ${paymentId}`);
    return res.status(422).json({ success: false, message: 'Payment failed. Incomplete payment details received.' });
  }

  const crypto = require('crypto');
  const keyId = rzpConfig.keyId || process.env.RAZORPAY_KEY_ID || 'rzp_test_groxen_key';
  const keySecret = rzpConfig.keySecret || process.env.RAZORPAY_KEY_SECRET || 'rzp_test_groxen_secret';
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  if (expectedSignature !== signature) {
    console.error(`[RAZORPAY AUDIT LOG] SIGNATURE MISMATCH for user ${currentActor.id}, order ${orderId}, payment ${paymentId}. Verification REJECTED.`);
    return res.status(400).json({
      success: false,
      message: 'Payment failed. Invalid payment signature. Wallet balance was not added.',
    });
  }

  // Official Razorpay API verification check if live credentials are supplied
  if (keyId && keySecret && !keyId.includes('groxen_key') && orderId.startsWith('order_')) {
    try {
      const Razorpay = require('razorpay');
      const instance = new Razorpay({ key_id: keyId, key_secret: keySecret });
      const paymentObj = await instance.payments.fetch(paymentId);
      console.log(`[RAZORPAY AUDIT LOG] Official Razorpay API payment status for ${paymentId}: ${paymentObj.status}`);
      if (paymentObj.status !== 'captured' && paymentObj.status !== 'authorized') {
        console.error(`[RAZORPAY AUDIT LOG] Official API payment verification failed: Payment status '${paymentObj.status}' is not successful.`);
        return res.status(400).json({
          success: false,
          message: `Payment failed. Razorpay payment status is ${paymentObj.status}. Wallet balance was not added.`,
        });
      }
    } catch (apiErr) {
      console.warn(`[RAZORPAY AUDIT LOG] Official Razorpay API status fetch warning: ${apiErr.message}`);
    }
  }

  const finalPaymentId = paymentId;
  const pool = require('../db');
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const transaction = await Wallet.applyLedgerEntry({
      userId: currentActor.id,
      type: 'credit',
      amount,
      component: 'razorpay_wallet_topup',
      ledgerKey: `razorpay_topup:${finalPaymentId}`,
      reference: finalPaymentId,
      note: `Razorpay Wallet Top-up (Payment ID: ${finalPaymentId})`,
      createdBy: currentActor.id,
      connection,
    });
    const balanceAfter = Number(transaction.balance_after || 0);

    await connection.commit();

    console.log(`[RAZORPAY AUDIT LOG] SUCCESS! User ${currentActor.id} topped up ₹${amount}. New wallet balance: ₹${balanceAfter}`);

    res.json({
      success: true,
      message: `Wallet topped up successfully by ₹${amount.toFixed(2)}!`,
      wallet_balance: balanceAfter,
      transaction: {
        payment_id: finalPaymentId,
        order_id: orderId,
        amount,
        payment_method: 'razorpay',
        status: 'completed',
        date: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(`[RAZORPAY AUDIT LOG] Wallet credit error for payment ${paymentId}:`, error);
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Payment failed. Wallet balance was not added.',
    });
  } finally {
    if (connection) connection.release();
  }
}

module.exports = {
  index,
  show,
  adjust,
  updateStatus,
  adminTransactionsPage,
  adminTransactions,
  canManageWallets,
  isAdminWalletUser,
  createRazorpayOrder,
  verifyRazorpayTopup,
};
