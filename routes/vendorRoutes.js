const express = require('express');
const vendorController = require('../controllers/vendorController');
const {
  uploadVendorImages,
  handleVendorImageUploadError,
} = require('../middleware/vendorImageUpload');

const router = express.Router();
const vendorImageFields = uploadVendorImages.fields([
  { name: 'aadhaar_front', maxCount: 1 },
  { name: 'aadhaar_back', maxCount: 1 },
  { name: 'store_image', maxCount: 1 },
  { name: 'profile_image', maxCount: 1 },
]);

router.get('/', vendorController.index);
router.post('/', vendorImageFields, handleVendorImageUploadError, vendorController.create);
router.get('/:id', vendorController.show);
router.put('/:id', vendorImageFields, handleVendorImageUploadError, vendorController.update);
router.delete('/:id', vendorController.destroy);

module.exports = router;
