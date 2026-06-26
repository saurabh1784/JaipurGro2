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

module.exports = {
  index,
  show,
  adjust,
  updateStatus,
  adminTransactionsPage,
  adminTransactions,
  canManageWallets,
  isAdminWalletUser,
};
