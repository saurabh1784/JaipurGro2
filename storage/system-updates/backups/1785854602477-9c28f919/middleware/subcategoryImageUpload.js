const path = require('path');
const fs = require('fs');
const multer = require('multer');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'subcategories');
fs.mkdirSync(uploadDir, { recursive: true });

function safeName(value) {
  return String(value || 'subcategory')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'subcategory';
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    cb(null, `${safeName(req.body.name)}-${Date.now()}${ext}`);
  },
});

const uploadSubcategoryImage = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Only PNG, JPG, WEBP, or GIF subcategory images are allowed'));
  },
});

function subcategoryImagePath(file) {
  return file ? `/uploads/subcategories/${file.filename}` : null;
}

function handleSubcategoryImageUploadError(error, req, res, next) {
  if (!error) return next();
  return res.status(422).json({ success: false, message: error.message || 'Invalid subcategory image upload' });
}

module.exports = {
  uploadSubcategoryImage,
  subcategoryImagePath,
  handleSubcategoryImageUploadError,
};
