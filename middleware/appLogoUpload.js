const fs = require('fs');
const multer = require('multer');
const path = require('path');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'app_settings');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase() || '.png';
    const field = file.fieldname || 'app_logo';
    const safeField = String(field)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_');
    cb(null, `${safeField}_${Date.now()}${extension}`);
  },
});

const uploadAppLogos = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.mimetype) || file.originalname.match(/\.(png|jpe?g|webp|gif|svg)$/i)) {
      return cb(null, true);
    }
    return cb(new Error('Only PNG, JPG, WEBP, GIF, or SVG images are allowed for app logos.'));
  },
}).fields([
  { name: 'client_app_logo', maxCount: 1 },
  { name: 'vendor_app_logo', maxCount: 1 },
  { name: 'delivery_app_logo', maxCount: 1 },
]);

function handleUploadError(error, req, res, next) {
  if (error) {
    if (req.accepts('html')) {
      req.flash ? req.flash('error', error.message) : null;
      return res.redirect('/app-settings');
    }
    return res.status(422).json({ success: false, message: error.message || 'Invalid logo upload' });
  }
  return next();
}

module.exports = {
  uploadAppLogos,
  handleUploadError,
};
