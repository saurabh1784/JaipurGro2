const express = require('express');
const vendorProductController = require('../controllers/vendorProductController');
const { uploadProductImage, handleProductImageUploadError } = require('../middleware/productImageUpload');

const router = express.Router();

router.get('/', vendorProductController.index);
router.post('/', uploadProductImage.single('image'), handleProductImageUploadError, vendorProductController.create);
router.get('/client-visible', vendorProductController.visibleForClient);
router.post('/products/:productId/approve', vendorProductController.approveProduct);
router.post('/products/:productId/reject', vendorProductController.rejectProduct);
router.get('/:id', vendorProductController.show);
router.put('/:id', uploadProductImage.single('image'), handleProductImageUploadError, vendorProductController.update);
router.put('/:id/inventory-price', vendorProductController.updateInventoryPrice);
router.post('/:id/client-prices', vendorProductController.setClientPrice);
router.delete('/:id/client-prices/:clientId', vendorProductController.deleteClientPrice);
router.delete('/:id', vendorProductController.destroy);

module.exports = router;
