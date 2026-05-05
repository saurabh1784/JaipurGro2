const express = require('express');
const walletController = require('../controllers/walletController');

const router = express.Router();

router.get('/', walletController.index);
router.get('/me', walletController.show);
router.get('/:userId', walletController.show);
router.post('/:userId/adjust', walletController.adjust);
router.put('/:userId/status', walletController.updateStatus);

module.exports = router;
