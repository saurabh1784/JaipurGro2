const express = require('express');
const router = express.Router();
const variationController = require('../controllers/variationController');

// Web Admin Routes
router.get('/admin/variation-types', variationController.index);
router.post('/admin/variation-types', variationController.saveType);
router.post('/admin/variation-values', variationController.saveValue);

// API Routes
router.post('/api/variation-values/quick-add', variationController.quickAddValue);

module.exports = router;
