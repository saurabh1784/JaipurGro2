const express = require('express');
const router = express.Router();
const vendorInventoryController = require('../controllers/vendorInventoryController');
const { webOrJwtAuth, requireAuthRole } = require('../middleware/webOrJwtAuth');

// Guard all vendor inventory endpoints with Vendor role authentication
router.use(webOrJwtAuth);
router.use(requireAuthRole('Vendor'));

// Inventory list & details
router.get('/api/vendor/inventory', vendorInventoryController.getInventory);

// Request variation approval
router.post('/api/vendor/variants/request-approval', vendorInventoryController.requestApproval);

// Update inventory details for variation
router.put('/api/vendor/inventory/:id', vendorInventoryController.updateInventory);

// Reports & Analytics
router.get('/api/vendor/inventory/reports', vendorInventoryController.getReports);

// Export inventory
router.get('/api/vendor/inventory/export', vendorInventoryController.exportReport);

module.exports = router;
