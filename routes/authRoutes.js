const express = require('express');
const authController = require('../controllers/authController');
const authenticateJwt = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPasswordWithOtp);
router.get('/google-config', authController.googlePublicConfig);
router.get('/social-config', authController.socialPublicConfig);
router.get('/auth-config', authController.socialPublicConfig);
router.post('/google', authController.googleClientLogin);
router.post('/facebook', authController.facebookClientLogin);
router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);
router.get('/approval-status', authenticateJwt, async (req, res) => {
  try {
    const { getProfileCompletionStatus } = require('../services/profileCompletionService');
    const userId = req.user ? req.user.id : (req.authUser ? req.authUser.id : null);
    const statusInfo = await getProfileCompletionStatus(userId);
    return res.json({
      success: true,
      ...statusInfo,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to check approval status' });
  }
});
router.post('/logout', authenticateJwt, authController.logout);

module.exports = router;
