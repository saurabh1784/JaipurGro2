const fs = require('fs');
const multer = require('multer');
const path = require('path');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'delivery-profiles');
fs.mkdirSync(uploadDir, { recursive: true });

function safeName(value) {
  return String(value || 'delivery-profile')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'delivery-profile';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const userId = (req.authUser && req.authUser.id) || 'user';
    cb(null, `${safeName(`delivery-${userId}`)}-${Date.now()}${extension}`);
  },
});

const uploadDeliveryProfileImage = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp)$/.test(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Only PNG, JPG, or WEBP profile images are allowed'));
  },
});

function deliveryProfileImagePath(file) {
  return file ? `/uploads/delivery-profiles/${file.filename}` : null;
}

function handleDeliveryProfileImageUploadError(error, req, res, next) {
  if (!error) return next();
  return res.status(422).json({ success: false, message: error.message || 'Invalid profile image upload' });
}

module.exports = {
  uploadDeliveryProfileImage,
  deliveryProfileImagePath,
  handleDeliveryProfileImageUploadError,
};
