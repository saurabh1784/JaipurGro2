const express = require('express');
const router = express.Router();
const variationApprovalController = require('../controllers/variationApprovalController');

// Web Admin Routes
router.get('/admin/variation-approvals', variationApprovalController.index);
router.post('/admin/variation-approvals/:id/approve', variationApprovalController.approve);
router.post('/admin/variation-approvals/:id/reject', variationApprovalController.reject);
router.post('/admin/variation-approvals/:id/suspend', variationApprovalController.suspend);
router.post('/admin/variation-approvals/:id/restore', variationApprovalController.restore);

module.exports = router;
