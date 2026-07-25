const express = require('express');
const deletionRequestController = require('../controllers/deletionRequestController');
const { webOrJwtAuth } = require('../middleware/webOrJwtAuth');

const router = express.Router();

// Admin UI Routes
router.get('/users/deletion-requests', deletionRequestController.renderDeletionRequests);
router.post('/users/deletion-requests/approve/:id', deletionRequestController.approveDeletionRequest);
router.post('/users/deletion-requests/reject/:id', deletionRequestController.rejectDeletionRequest);

// Mobile REST API Route for account deletion request
router.post('/api/user/delete-request', webOrJwtAuth, deletionRequestController.submitDeletionRequest);
router.post('/api/auth/delete-request', webOrJwtAuth, deletionRequestController.submitDeletionRequest);

module.exports = router;
