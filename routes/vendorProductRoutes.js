const express = require('express');
const vendorProductController = require('../controllers/vendorProductController');
const { uploadProductImage, handleProductImageUploadError } = require('../middleware/productImageUpload');

const router = express.Router();

router.get('/', vendorProductController.index);
router.post('/', vendorProductController.create);
router.post('/product-requests', uploadProductImage.array('images', 5), handleProductImageUploadError, vendorProductController.requestProduct);
router.put('/product-requests/:productId', uploadProductImage.array('images', 5), handleProductImageUploadError, vendorProductController.resubmitProductRequest);
router.get('/approved-products', vendorProductController.approvedProducts);
router.get('/client-visible', vendorProductController.visibleForClient);
router.get('/client-visible/suggestions', vendorProductController.suggestions);
router.post('/client-visible/activity', vendorProductController.trackActivity);
router.post('/products/:productId/approve', vendorProductController.approveProduct);
router.post('/products/:productId/reject', vendorProductController.rejectProduct);
router.get('/:id', vendorProductController.show);
router.put('/:id', vendorProductController.update);
router.put('/:id/inventory-price', vendorProductController.updateInventoryPrice);
router.post('/:id/client-prices', vendorProductController.setClientPrice);
router.delete('/:id/client-prices/:clientId', vendorProductController.deleteClientPrice);
router.delete('/:id', vendorProductController.destroy);

module.exports = router;
