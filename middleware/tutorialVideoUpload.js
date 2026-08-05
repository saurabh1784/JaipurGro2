const fs = require('fs');
const path = require('path');
const multer = require('multer');
const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'tutorials');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, `tutorial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname).toLowerCase() || '.mp4'}`),
});
const uploadTutorialVideo = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_, file, cb) => /^(video\/(mp4|webm|quicktime|x-m4v))$/.test(file.mimetype)
    ? cb(null, true) : cb(new Error('Only MP4, WebM, MOV, or M4V tutorial videos are allowed')),
});
module.exports = { uploadTutorialVideo, uploadDir };
