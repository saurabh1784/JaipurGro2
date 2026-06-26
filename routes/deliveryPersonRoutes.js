const express = require('express');
const controller = require('../controllers/deliveryPersonController');
const router = express.Router();

router.get('/', controller.index);
router.post('/', controller.create);
router.get('/:id/profile', controller.showPage);
router.get('/:id', controller.show);
router.put('/:id', controller.update);
router.put('/:id/status', controller.setStatus);
router.post('/:id/reset-password', controller.resetPassword);
router.post('/:id/wallet', controller.adjustWallet);

module.exports = router;
