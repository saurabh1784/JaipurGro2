const express = require('express');
const multer = require('multer');
const productController = require('../controllers/productController');
const { uploadProductImage, handleProductImageUploadError } = require('../middleware/productImageUpload');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (allowed.includes(file.mimetype) || /\.(csv|xls|xlsx)$/i.test(file.originalname)) {
      return cb(null, true);
    }
    return cb(new Error('Only CSV or Excel files are allowed'));
  },
});

router.get('/', productController.index);
router.get('/catalog', productController.catalog);
router.get('/sponsored', productController.sponsoredIndex);
router.post('/sponsored', productController.sponsoredCreate);
router.post('/', uploadProductImage.single('image'), handleProductImageUploadError, productController.create);
router.post('/bulk-upload', upload.single('file'), productController.bulkUpload);
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

module.exports = router;
