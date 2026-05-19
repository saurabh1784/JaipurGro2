const fs = require('fs');
const multer = require('multer');
const path = require('path');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'promotions');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase() || '.png';
    const safeName = String(req.body.name || req.body.code || 'promotion')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'promotion';
    cb(null, `${safeName}-${Date.now()}${extension}`);
  },
});

const uploadPromotionImage = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Only PNG, JPG, WEBP, or GIF promotion images are allowed'));
  },
});

function promotionImagePath(file) {
  return file ? `/uploads/promotions/${file.filename}` : null;
}

function handlePromotionImageUploadError(error, req, res, next) {
  if (error) {
    return res.status(422).json({ success: false, message: error.message || 'Invalid promotion image upload' });
  }
  return next();
}

module.exports = {
  uploadPromotionImage,
  promotionImagePath,
  handlePromotionImageUploadError,
};
