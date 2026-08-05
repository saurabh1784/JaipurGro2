const multer = require('multer');
const systemUpdateService = require('../services/systemUpdateService');

const uploadUpdate = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.SYSTEM_UPDATE_MAX_MB || 100) * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!/\.zip$/i.test(file.originalname || '')) return callback(new Error('Only .zip update packages are allowed'));
    return callback(null, true);
  },
});

function history(_req, res) {
  return res.json({ success: true, updates: systemUpdateService.readHistory() });
}

function upload(req, res) {
  uploadUpdate.single('update')(req, res, async (uploadError) => {
    if (uploadError) return res.status(uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 422).json({ success: false, message: uploadError.message });
    if (!req.file) return res.status(422).json({ success: false, message: 'Choose a ZIP update package' });
    if (String(req.body.confirm || '') !== 'APPLY UPDATE') {
      return res.status(422).json({ success: false, message: 'Type APPLY UPDATE to confirm' });
    }
    try {
      const result = await systemUpdateService.applyUpdate({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        actor: req.authUser || (req.session && req.session.user),
      });
      return res.json({ success: true, message: 'System update applied. Restart the backend process to load the new code.', result });
    } catch (error) {
      console.error('[SystemUpdate]', error);
      return res.status(error.status || 500).json({ success: false, message: error.message || 'System update failed and was rolled back' });
    }
  });
}

module.exports = { history, upload };
