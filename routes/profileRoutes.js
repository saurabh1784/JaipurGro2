const express = require('express');
const profileController = require('../controllers/profileController');
const authenticateJwt = require('../middleware/authMiddleware');
const requireRoles = require('../middleware/roleMiddleware');

const router = express.Router();

const allowedProfileRoles = ['Admin', 'admin', 'superadmin', 'Vendor', 'vendor', 'Client', 'client', 'deliveryPerson', 'deliveryperson', 'delivery_partner', 'delivery', 'driver', 'staff', 'rider'];

router.get('/', authenticateJwt, requireRoles(...allowedProfileRoles), profileController.getProfile);
router.put('/update', authenticateJwt, requireRoles(...allowedProfileRoles), profileController.updateProfile);

module.exports = router;
