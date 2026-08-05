const express = require('express');
const vendorController = require('../controllers/vendorController');

const router = express.Router();

router.get('/', vendorController.index);
router.post('/', vendorController.create);
router.get('/:id', vendorController.show);
router.get('/:id/full-details', vendorController.fullDetails);
router.put('/:id', vendorController.update);
router.delete('/:id', vendorController.destroy);

module.exports = router;
