const fs = require('fs');
const multer = require('multer');
const os = require('os');
const path = require('path');

const uploadDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'uploads', 'brands')
  : path.join(__dirname, '..', 'public', 'uploads', 'brands');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase() || '.png';
    const safeName = String(req.body.name || 'brand')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'brand';
    cb(null, `${safeName}-${Date.now()}${extension}`);
  },
});

const uploadBrandLogo = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('Only PNG, JPG, WEBP, or GIF brand logos are allowed'));
  },
});

function brandLogoPath(file) {
  return file ? `/uploads/brands/${file.filename}` : null;
}

function handleUploadError(error, req, res, next) {
  if (error) {
    return res.status(422).json({ success: false, message: error.message || 'Invalid brand logo upload' });
  }
  return next();
}

module.exports = {
  uploadBrandLogo,
  brandLogoPath,
  handleUploadError,
};
