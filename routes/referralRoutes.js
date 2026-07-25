const express = require('express');
const referralController = require('../controllers/referralController');

const router = express.Router();

// Admin UI Routes (Referral Settings, Messages & Reports)
router.get('/referral-settings', referralController.renderReferralSettings);
router.post('/referral-settings', referralController.saveReferralSettings);
router.post('/referral-settings/delete/:id', referralController.deleteReferralSettings);

router.get('/referral-messages', referralController.renderShareMessages);
router.get('/referral-messages/share', (req, res) => res.redirect('/referral-messages?category=referral'));
router.get('/referral-messages/savings', (req, res) => res.redirect('/referral-messages?category=savings'));
router.post('/referral-messages', referralController.saveShareMessage);
router.post('/referral-messages/delete/:id', referralController.deleteShareMessage);
router.post('/referral-messages/toggle/:id', referralController.toggleShareMessageStatus);

router.get('/referral-report', referralController.renderReferralReport);
router.post('/referral-report/reverse/:id', referralController.reverseReferralReward);

// Mobile REST API Endpoints
router.get('/api/referral/config', referralController.getAppReferralConfig);
router.get('/api/referral/dashboard', referralController.getUserReferralDashboard);
router.get('/api/referral/share-message', referralController.getShareMessage);

module.exports = router;
