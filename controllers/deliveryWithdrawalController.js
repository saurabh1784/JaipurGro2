const pool = require('../db');
const DeliveryWithdrawal = require('../models/DeliveryWithdrawal');
const Wallet = require('../models/Wallet');
const { isSuperAdminUser, getAssignedUserCity } = require('./userController');
const { notifyUserEvent } = require('../services/notificationDispatcher');
const adminNotificationService = require('../services/adminNotificationService');

const actor = (req) => req.authUser || req.session.user;

async function getBankAccount(req, res) {
  try {
    const currentActor = actor(req);
    if (!currentActor) return res.status(401).json({ success: false, message: 'Authentication required' });
    const bankAccount = await DeliveryWithdrawal.getBankAccount(currentActor.id);
    res.json({ success: true, bankAccount });
  } catch (error) {
    console.error('Error fetching delivery bank account:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch bank account details' });
  }
}

async function saveBankAccount(req, res) {
  try {
    const currentActor = actor(req);
    if (!currentActor) return res.status(401).json({ success: false, message: 'Authentication required' });

    const payoutMethod = String(req.body.payout_method || req.body.payoutMethod || 'bank').trim();
    const payToPhone = String(req.body.pay_to_phone || req.body.payToPhone || currentActor.phone || '').trim();
    const accountNumber = String(req.body.account_number || req.body.accountNumber || '').trim();
    const ifscCode = String(req.body.ifsc_code || req.body.ifscCode || '').trim();
    const bankName = String(req.body.bank_name || req.body.bankName || '').trim();
    const accountHolderName = String(req.body.account_holder_name || req.body.accountHolderName || '').trim();
    const upiId = String(req.body.upi_id || req.body.upiId || '').trim();

    if (payoutMethod === 'mobile' && !payToPhone && !currentActor.phone) {
      return res.status(422).json({ success: false, message: 'Registered phone number is required for mobile payout' });
    }
    if (payoutMethod === 'upi' && !upiId) {
      return res.status(422).json({ success: false, message: 'UPI ID is required for UPI payout' });
    }
    if (payoutMethod === 'bank') {
      if (!accountNumber) return res.status(422).json({ success: false, message: 'Account number is required' });
      if (!ifscCode) return res.status(422).json({ success: false, message: 'IFSC code is required' });
      if (!bankName) return res.status(422).json({ success: false, message: 'Bank name is required' });
      if (!accountHolderName) return res.status(422).json({ success: false, message: 'Account holder name is required' });
    }

    const bankAccount = await DeliveryWithdrawal.saveBankAccount(currentActor.id, {
      accountNumber,
      ifscCode,
      bankName,
      accountHolderName,
      upiId,
      payoutMethod,
      payToPhone: payToPhone || currentActor.phone || '',
    });

    res.json({ success: true, message: 'Bank account & payout details saved successfully', bankAccount });
  } catch (error) {
    console.error('Error saving delivery bank account:', error);
    res.status(500).json({ success: false, message: 'Unable to save bank account details' });
  }
}

async function createRequest(req, res) {
  const currentActor = actor(req);
  if (!currentActor) return res.status(401).json({ success: false, message: 'Authentication required' });

  const amount = Number(req.body.amount || 0);
  const note = String(req.body.note || '').trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(422).json({ success: false, message: 'A valid withdrawal amount greater than ₹0 is required' });
  }

  try {
    const walletData = await Wallet.lockForUser(currentActor.id);
    if (walletData.balance < amount) {
      return res.status(422).json({
        success: false,
        message: `Insufficient wallet balance. Your current balance is ₹${walletData.balance.toFixed(2)}.`,
      });
    }

    let bankDetails = req.body.bank_details || req.body.bankDetails;
    if (!bankDetails || !bankDetails.account_number) {
      const savedAccount = await DeliveryWithdrawal.getBankAccount(currentActor.id);
      if (!savedAccount || !savedAccount.account_number) {
        return res.status(422).json({
          success: false,
          message: 'Please save your bank account details before submitting a withdrawal request.',
        });
      }
      bankDetails = savedAccount;
    }

    const request = await DeliveryWithdrawal.createRequest(currentActor.id, {
      amount,
      bankDetails,
      note,
    });

    try {
      notifyUserEvent({
        phone: currentActor.phone || '',
        email: currentActor.email || '',
        name: currentActor.name || 'Delivery Partner',
        eventType: 'withdrawal_submitted',
        data: {
          storeName: 'Groxen',
          amount: amount.toFixed(2),
          status: 'pending',
          requestId: request.id,
        },
      });
    } catch (_) {}

    try {
      adminNotificationService.notifyAdmin({
        type: 'new_withdrawal_request',
        title: 'New Delivery Partner Withdrawal Request',
        message: `${request.delivery_person_name} (${request.city}) submitted a withdrawal request of ₹${amount.toFixed(2)}.`,
        link: '/delivery-withdrawals',
      });
    } catch (_) {}

    res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully! Pending approval from Admin.',
      request,
    });
  } catch (error) {
    console.error('Error creating delivery withdrawal request:', error);
    res.status(500).json({ success: false, message: error.message || 'Unable to submit withdrawal request' });
  }
}

async function listDeliveryWithdrawals(req, res) {
  try {
    const currentActor = actor(req);
    if (!currentActor) return res.status(401).json({ success: false, message: 'Authentication required' });

    const result = await DeliveryWithdrawal.listRequests({
      deliveryPersonId: currentActor.id,
      page: req.query.page,
      limit: req.query.limit,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error listing delivery withdrawals:', error);
    res.status(500).json({ success: false, message: 'Unable to load withdrawal requests' });
  }
}

async function listAdminWithdrawals(req, res) {
  try {
    const currentActor = actor(req);
    const isSuper = isSuperAdminUser(currentActor);
    const adminCity = await getAssignedUserCity(currentActor);
    const filterCity = isSuper ? (req.query.city || '') : adminCity;

    const result = await DeliveryWithdrawal.listRequests({
      city: filterCity,
      status: req.query.status,
      search: req.query.search,
      page: req.query.page,
      limit: req.query.limit || 20,
    });

    if (req.query.format !== 'json' && req.accepts(['html', 'json']) !== 'json') {
      return res.render('delivery-withdrawals', {
        user: req.session.user,
        isSuperAdmin: isSuper,
        adminCity: adminCity || '',
        shell: res.locals.shell || {},
      });
    }

    res.json({ success: true, isSuperAdmin: isSuper, adminCity, ...result });
  } catch (error) {
    console.error('Error listing admin delivery withdrawals:', error);
    res.status(500).json({ success: false, message: 'Unable to load withdrawal requests' });
  }
}

async function approveWithdrawal(req, res) {
  const currentActor = actor(req);
  const isSuper = isSuperAdminUser(currentActor);
  const adminCity = await getAssignedUserCity(currentActor);
  const id = Number(req.params.id);
  const adminRemark = String(req.body.admin_remark || req.body.remark || '').trim();

  try {
    const request = await DeliveryWithdrawal.findById(id);
    if (!request) return res.status(404).json({ success: false, message: 'Withdrawal request not found' });

    if (!isSuper && adminCity && request.city && request.city.toLowerCase() !== adminCity.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: `Admins can only manage withdrawal requests in their assigned city (${adminCity}).`,
      });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const walletData = await Wallet.lockForUser(request.delivery_person_id, connection);
      if (walletData.balance < request.amount) {
        await connection.rollback();
        return res.status(422).json({
          success: false,
          message: `Delivery partner has insufficient wallet balance (Current balance: ₹${walletData.balance.toFixed(2)}).`,
        });
      }

      await connection.query(
        'UPDATE wallets SET balance = (GREATEST(COALESCE(NULLIF(balance::text, \'\'), \'0\')::numeric - ?, 0))::text WHERE user_id = ? AND COALESCE(NULLIF(balance::text, \'\'), \'0\')::numeric >= ?',
        [request.amount, request.delivery_person_id, request.amount]
      );

      const [newWallet] = await connection.query('SELECT balance FROM wallets WHERE user_id = ? LIMIT 1', [request.delivery_person_id]);
      const balanceAfter = Number(newWallet[0]?.balance || 0);

      await connection.query(
        `INSERT INTO wallet_transactions
          (wallet_id, user_id, type, amount, balance_before, balance_after, reference, note, created_by)
         VALUES (?, ?, 'debit', ?, ?, ?, ?, ?, ?)`,
        [
          walletData.id,
          request.delivery_person_id,
          request.amount,
          walletData.balance,
          balanceAfter,
          `DELIVERY-WITHDRAWAL-#${request.id}`,
          `Delivery Partner Withdrawal Approved: ${adminRemark || 'Processed by admin'}`,
          currentActor.id,
        ]
      );

      const updatedRequest = await DeliveryWithdrawal.approveRequest(id, {
        adminRemark,
        processedByUserId: currentActor.id,
        processedByName: currentActor.name || 'Admin',
      });

      await connection.commit();

      const [userRows] = await pool.query('SELECT name, email, phone FROM users WHERE id = ? LIMIT 1', [request.delivery_person_id]);
      const deliveryUser = userRows[0] || {};

      try {
        notifyUserEvent({
          phone: deliveryUser.phone || '',
          email: deliveryUser.email || '',
          name: deliveryUser.name || request.delivery_person_name || 'Delivery Partner',
          eventType: 'withdrawal_approved',
          data: {
            storeName: 'Groxen',
            amount: request.amount.toFixed(2),
            remark: adminRemark || 'Approved',
            requestId: request.id,
          },
        });
      } catch (_) {}

      res.json({
        success: true,
        message: `Withdrawal request of ₹${request.amount.toFixed(2)} approved & ₹${request.amount.toFixed(2)} deducted from delivery partner wallet.`,
        request: updatedRequest,
      });
    } catch (dbErr) {
      await connection.rollback();
      throw dbErr;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error approving delivery withdrawal:', error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to approve withdrawal request' });
  }
}

async function rejectWithdrawal(req, res) {
  const currentActor = actor(req);
  const isSuper = isSuperAdminUser(currentActor);
  const adminCity = await getAssignedUserCity(currentActor);
  const id = Number(req.params.id);
  const adminRemark = String(req.body.admin_remark || req.body.remark || '').trim();

  try {
    const request = await DeliveryWithdrawal.findById(id);
    if (!request) return res.status(404).json({ success: false, message: 'Withdrawal request not found' });

    if (!isSuper && adminCity && request.city && request.city.toLowerCase() !== adminCity.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: `Admins can only manage withdrawal requests in their assigned city (${adminCity}).`,
      });
    }

    const updatedRequest = await DeliveryWithdrawal.rejectRequest(id, {
      adminRemark,
      processedByUserId: currentActor.id,
      processedByName: currentActor.name || 'Admin',
    });

    const [userRows] = await pool.query('SELECT name, email, phone FROM users WHERE id = ? LIMIT 1', [request.delivery_person_id]);
    const deliveryUser = userRows[0] || {};

    try {
      notifyUserEvent({
        phone: deliveryUser.phone || '',
        email: deliveryUser.email || '',
        name: deliveryUser.name || request.delivery_person_name || 'Delivery Partner',
        eventType: 'withdrawal_rejected',
        data: {
          storeName: 'Groxen',
          amount: request.amount.toFixed(2),
          remark: adminRemark || 'Rejected',
          requestId: request.id,
        },
      });
    } catch (_) {}

    res.json({
      success: true,
      message: `Withdrawal request of ₹${request.amount.toFixed(2)} rejected.`,
      request: updatedRequest,
    });
  } catch (error) {
    console.error('Error rejecting delivery withdrawal:', error);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Unable to reject withdrawal request' });
  }
}

module.exports = {
  getBankAccount,
  saveBankAccount,
  createRequest,
  listDeliveryWithdrawals,
  listAdminWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
};
