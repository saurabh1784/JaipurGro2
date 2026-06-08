const express = require('express');
const authController = require('../controllers/authController');
const authenticateJwt = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/google', authController.googleClientLogin);
router.post('/logout', authenticateJwt, authController.logout);

module.exports = router;
