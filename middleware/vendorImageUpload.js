const fs = require('fs');
const multer = require('multer');
const os = require('os');
const path = require('path');

const uploadDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'uploads', 'vendors')
  : path.join(__dirname, '..', 'public', 'uploads', 'vendors');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase() || '.png';
    const safeName = String(req.body.name || req.body.business_name || 'vendor')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'vendor';
    const fieldName = String(file.fieldname || 'image').replace(/[^a-z0-9_]+/gi, '-');
    cb(null, `${safeName}-${fieldName}-${Date.now()}${extension}`);
  },
});

const uploadVendorImages = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Only PNG, JPG, WEBP, or GIF vendor images are allowed'));
  },
});

function vendorImagePath(file) {
  return file ? `/uploads/vendors/${file.filename}` : null;
}

function handleVendorImageUploadError(error, req, res, next) {
  if (error) {
    return res.status(422).json({ success: false, message: error.message || 'Invalid vendor image upload' });
  }
  return next();
}

module.exports = {
  uploadVendorImages,
  vendorImagePath,
  handleVendorImageUploadError,
};
