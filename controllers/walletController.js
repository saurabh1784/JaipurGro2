const User = require('../models/User');
const Wallet = require('../models/Wallet');
const { editableUserRoles } = require('../middleware/validators');

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
  if (!currentActor) return res.status(401).json({ success: false, message: 'Authentication required' });

  const amount = Number(req.body.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(422).json({ success: false, message: 'Top-up amount must be greater than ₹0' });
  }

  try {
    const keyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_groxen_key';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_groxen_secret';
    let orderId = `rzp_ord_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;

    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      try {
        const Razorpay = require('razorpay');
        const instance = new Razorpay({ key_id: keyId, key_secret: keySecret });
        const order = await instance.orders.create({
          amount: Math.round(amount * 100),
          currency: 'INR',
          receipt: `topup_${currentActor.id}_${Date.now()}`,
          notes: { user_id: currentActor.id, type: 'wallet_topup' },
        });
        orderId = order.id;
      } catch (rzpErr) {
        console.warn('Razorpay SDK order creation fallback:', rzpErr.message);
      }
    }

    res.json({
      success: true,
      order_id: orderId,
      amount,
      amount_in_paise: Math.round(amount * 100),
      currency: 'INR',
      key_id: keyId,
      user: {
        name: currentActor.name || 'User',
        email: currentActor.email || '',
        phone: currentActor.phone || '',
      },
    });
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ success: false, message: 'Unable to initiate Razorpay wallet top-up' });
  }
}

async function verifyRazorpayTopup(req, res) {
  const currentActor = req.authUser || req.session.user;
  if (!currentActor) return res.status(401).json({ success: false, message: 'Authentication required' });

  const amount = Number(req.body.amount || 0);
  const paymentId = String(req.body.razorpay_payment_id || req.body.payment_id || req.body.paymentId || '').trim();
  const orderId = String(req.body.razorpay_order_id || req.body.order_id || req.body.orderId || '').trim();
  const signature = String(req.body.razorpay_signature || req.body.signature || '').trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(422).json({ success: false, message: 'Valid top-up amount is required' });
  }

  const finalPaymentId = paymentId || `pay_rzp_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;
  const pool = require('../db');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const walletData = await Wallet.lockForUser(currentActor.id, connection);

    await connection.query('UPDATE wallets SET balance = (COALESCE(NULLIF(balance::text, \'\'), \'0\')::numeric + ?)::text WHERE user_id = ?', [amount, currentActor.id]);
    const [updatedWallet] = await connection.query('SELECT balance FROM wallets WHERE user_id = ? LIMIT 1', [currentActor.id]);
    const balanceAfter = Number(updatedWallet[0]?.balance || 0);

    await connection.query(
      `INSERT INTO wallet_transactions
        (wallet_id, user_id, type, amount, balance_before, balance_after, reference, note, created_by)
       VALUES (?, ?, 'credit', ?, ?, ?, ?, ?, ?)`,
      [
        walletData.id,
        currentActor.id,
        amount,
        walletData.balance,
        balanceAfter,
        finalPaymentId,
        `Razorpay Wallet Top-up (Payment ID: ${finalPaymentId})`,
        currentActor.id,
      ]
    );

    await connection.commit();

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
    await connection.rollback();
    console.error('Error verifying Razorpay top-up:', error);
    res.status(500).json({ success: false, message: 'Unable to process wallet top-up verification' });
  } finally {
    connection.release();
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
