const express = require('express');
const multer = require('multer');
const productController = require('../controllers/productController');
const { uploadProductImage, handleProductImageUploadError } = require('../middleware/productImageUpload');

const productImagesController = require('../controllers/productImagesController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/zip',
      'application/x-zip-compressed',
    ];
    if (allowed.includes(file.mimetype) || /\.(csv|xls|xlsx|jpg|jpeg|png|webp|zip)$/i.test(file.originalname)) {
      return cb(null, true);
    }
    return cb(new Error('Only CSV, Excel, Image (JPG/PNG/WebP), or ZIP files are allowed'));
  },
});

// Product Images Management Routes
router.get('/images', productImagesController.getProductImagesPage);
router.get('/images/api/list', productImagesController.listProductImages);
router.get('/images/list', productImagesController.listProductImages);
router.put('/images/:id', uploadProductImage.single('image'), handleProductImageUploadError, productImagesController.replaceProductImage);
router.post('/images/:id', uploadProductImage.single('image'), handleProductImageUploadError, productImagesController.replaceProductImage);
router.delete('/images/:id', productImagesController.deleteProductImage);
router.post('/images/bulk-delete', productImagesController.bulkDeleteProductImages);
router.delete('/images/bulk-delete', productImagesController.bulkDeleteProductImages);

router.get('/', productController.index);
router.get('/catalog', productController.catalog);
router.get('/sponsored', productController.sponsoredIndex);
router.post('/sponsored', productController.sponsoredCreate);
router.post('/', uploadProductImage.single('image'), handleProductImageUploadError, productController.create);
router.post('/bulk-upload', upload.single('file'), productController.bulkUpload);
router.get('/image-upload-template', productController.downloadImageTemplate);
router.post('/bulk-image-upload', upload.single('file'), productController.bulkImageUpload);
router.post('/bulk-image', upload.single('file'), productController.bulkImageUpload);
router.post('/image-upload', upload.single('file'), productController.bulkImageUpload);
router.post('/bulk-delete', productController.bulkDeleteProducts);
router.delete('/bulk', productController.bulkDeleteProducts);
router.put('/:id/approval-status', productController.updateApprovalStatus);
router.put('/:id/search-settings', productController.updateSearchSettings);
router.put('/:id/featured', productController.setFeatured);
router.get('/:id/sponsored', productController.sponsoredShow);
router.put('/:id/sponsored', productController.sponsoredUpdate);
router.delete('/:id/sponsored', productController.sponsoredDelete);
router.put('/:id', uploadProductImage.single('image'), handleProductImageUploadError, productController.update);
router.delete('/:id', productController.destroy);

router.use((error, req, res, next) => {
  if (error) {
    return res.status(422).json({ success: false, message: error.message || 'Invalid upload' });
  }
  return next();
});

router.use((req, res) => {
  return res.status(404).json({ success: false, message: `Endpoint ${req.originalUrl} not found.` });
});

module.exports = router;
