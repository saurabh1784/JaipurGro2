const express = require('express');
const profileController = require('../controllers/profileController');
const authenticateJwt = require('../middleware/authMiddleware');
const requireRoles = require('../middleware/roleMiddleware');

const router = express.Router();

router.get('/', authenticateJwt, requireRoles('Admin', 'Vendor', 'Client'), profileController.getProfile);
router.put('/update', authenticateJwt, requireRoles('Admin', 'Vendor', 'Client'), profileController.updateProfile);

module.exports = router;
