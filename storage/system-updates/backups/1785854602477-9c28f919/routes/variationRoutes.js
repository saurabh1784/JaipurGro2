const express = require('express');
const router = express.Router();
const variationController = require('../controllers/variationController');

// Web Admin Routes
router.get('/admin/variation-types', variationController.index);
router.post('/admin/variation-types', variationController.saveType);
router.post('/admin/variation-types/:id/delete', variationController.deleteType);
router.post('/admin/variation-values', variationController.saveValue);
router.post('/admin/variation-values/:id/delete', variationController.deleteValue);

// API Routes
router.get('/api/variation-types', variationController.getTypesApi);
router.post('/api/variation-values/quick-add', variationController.quickAddValue);

module.exports = router;
