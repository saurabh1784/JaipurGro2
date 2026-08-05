const fs = require('fs');
const multer = require('multer');
const path = require('path');

const vendorKycDir = path.join(__dirname, '..', 'public', 'uploads', 'vendor-kyc');
const deliveryKycDir = path.join(__dirname, '..', 'public', 'uploads', 'delivery-kyc');
fs.mkdirSync(vendorKycDir, { recursive: true });
fs.mkdirSync(deliveryKycDir, { recursive: true });

function safeName(value) {
  return String(value || 'doc')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'doc';
}

const vendorStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, vendorKycDir),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const userId = (req.authUser && req.authUser.id) || 'vendor';
    const field = safeName(file.fieldname);
    cb(null, `vkc-${userId}-${field}-${Date.now()}${extension}`);
  },
});

const deliveryStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, deliveryKycDir),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const userId = (req.authUser && req.authUser.id) || 'delivery';
    const field = safeName(file.fieldname);
    cb(null, `dkc-${userId}-${field}-${Date.now()}${extension}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype) || /\.(png|jpe?g|webp|pdf)$/i.test(file.originalname)) {
    return cb(null, true);
  }
  return cb(new Error('Only PNG, JPG, WEBP, or PDF files are allowed for KYC documents'));
};

const uploadVendorKyc = multer({
  storage: vendorStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter,
});

const uploadDeliveryKyc = multer({
  storage: deliveryStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter,
});

function handleKycUploadError(error, req, res, next) {
  if (!error) return next();
  return res.status(422).json({ success: false, message: error.message || 'Invalid KYC document upload' });
}

module.exports = {
  uploadVendorKyc,
  uploadDeliveryKyc,
  handleKycUploadError,
};
