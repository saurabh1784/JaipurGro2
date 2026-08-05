const express = require('express');
const router = express.Router();
const vendorInventoryController = require('../controllers/vendorInventoryController');
const mrpRevisionController = require('../controllers/mrpRevisionController');
const { uploadProductImage, handleProductImageUploadError } = require('../middleware/productImageUpload');
const { webOrJwtAuth, requireAuthRole } = require('../middleware/webOrJwtAuth');

const vendorAuth = [webOrJwtAuth, requireAuthRole('Vendor')];

// Inventory list & details
router.get('/api/vendor/inventory', vendorAuth, vendorInventoryController.getInventory);

// Request variation approval
router.post('/api/vendor/variants/request-approval', vendorAuth, vendorInventoryController.requestApproval);

// Update inventory details for variation
router.put('/api/vendor/inventory/:id', vendorAuth, vendorInventoryController.updateInventory);
router.get('/api/vendor/mrp-revision-requests', vendorAuth, mrpRevisionController.list);
router.post('/api/vendor/mrp-revision-requests', vendorAuth, uploadProductImage.single('proof'), handleProductImageUploadError, mrpRevisionController.create);

// Reports & Analytics
router.get('/api/vendor/inventory/reports', vendorAuth, vendorInventoryController.getReports);

// Export inventory
router.get('/api/vendor/inventory/export', vendorAuth, vendorInventoryController.exportReport);

module.exports = router;

