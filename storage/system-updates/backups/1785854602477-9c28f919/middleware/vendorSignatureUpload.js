const fs = require('fs');
const multer = require('multer');
const path = require('path');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'signatures');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase() || '.png';
    const userId = String(req.params.userId || 'vendor').replace(/[^0-9a-z_-]/gi, '');
    cb(null, `signature-${userId}-${Date.now()}${extension}`);
  },
});

const uploadVendorSignature = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g)$/.test(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Only PNG or JPG signature images are allowed'));
  },
});

function vendorSignaturePath(file) {
  return file ? `/uploads/signatures/${file.filename}` : null;
}

function handleVendorSignatureUploadError(error, req, res, next) {
  if (error) {
    return res.status(422).json({ success: false, message: error.message || 'Invalid signature upload' });
  }
  return next();
}

module.exports = {
  uploadVendorSignature,
  vendorSignaturePath,
  handleVendorSignatureUploadError,
};
