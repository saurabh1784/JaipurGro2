const fs = require('fs');
const path = require('path');
const pool = require('../db');
const urlService = require('../services/urlService');
const { uploadDir } = require('../middleware/tutorialVideoUpload');
const validApps = new Set(['customer', 'vendor', 'delivery']);
const normalizeApp = (value) => {
  const app = String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (['client', 'customer', 'customerapp'].includes(app)) return 'customer';
  if (['vendor', 'vendorapp'].includes(app)) return 'vendor';
  if (['delivery', 'deliveryapp', 'deliverypartner'].includes(app)) return 'delivery';
  return '';
};
const removeFile = (videoPath) => {
  if (!videoPath || !videoPath.startsWith('/uploads/tutorials/')) return;
  const target = path.resolve(uploadDir, path.basename(videoPath));
  if (target.startsWith(path.resolve(uploadDir)) && fs.existsSync(target)) fs.unlinkSync(target);
};
const normalizeYoutubeUrl = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return ['youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'].includes(host) ? url.toString() : '';
  } catch (_) { return ''; }
};
async function create(req, res) {
  const app = normalizeApp(req.body.app_type);
  const title = String(req.body.title || '').trim();
  const youtubeUrl = normalizeYoutubeUrl(req.body.youtube_url);
  if (!validApps.has(app) || !title || (!req.file && !youtubeUrl)) return res.redirect('/app-settings?err=App,+title,+and+a+video+file+or+valid+YouTube+URL+are+required');
  await pool.query(`INSERT INTO tutorial_videos(app_type,title,description,video_path,youtube_url,display_order,is_active) VALUES(?,?,?,?,?,?,?)`,
    [app, title, String(req.body.description || '').trim() || null, req.file ? `/uploads/tutorials/${req.file.filename}` : null, req.file ? null : youtubeUrl || null, Number(req.body.display_order) || 0, req.body.is_active === 'on' ? 1 : 0]);
  return res.redirect('/app-settings?msg=Tutorial+video+uploaded');
}
async function update(req, res) {
  const [rows] = await pool.query('SELECT * FROM tutorial_videos WHERE id=?', [req.params.id]);
  if (!rows.length) return res.redirect('/app-settings?err=Tutorial+not+found');
  const current = rows[0];
  const submittedYoutubeUrl = String(req.body.youtube_url || '').trim();
  const youtubeUrl = submittedYoutubeUrl ? normalizeYoutubeUrl(submittedYoutubeUrl) : '';
  if (submittedYoutubeUrl && !youtubeUrl) return res.redirect('/app-settings?err=Please+enter+a+valid+YouTube+URL');
  const nextPath = req.file ? `/uploads/tutorials/${req.file.filename}` : (youtubeUrl ? null : current.video_path);
  const nextYoutubeUrl = req.file ? null : (youtubeUrl || current.youtube_url || null);
  await pool.query(`UPDATE tutorial_videos SET app_type=?,title=?,description=?,video_path=?,youtube_url=?,file_version=file_version+?,display_order=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [normalizeApp(req.body.app_type) || current.app_type, String(req.body.title || current.title).trim(), String(req.body.description || '').trim() || null, nextPath, nextYoutubeUrl, req.file ? 1 : 0, Number(req.body.display_order) || 0, req.body.is_active === 'on' ? 1 : 0, current.id]);
  if (req.file || youtubeUrl) removeFile(current.video_path);
  return res.redirect('/app-settings?msg=Tutorial+video+updated');
}
async function remove(req, res) {
  const [rows] = await pool.query('SELECT video_path FROM tutorial_videos WHERE id=?', [req.params.id]);
  if (rows[0]) removeFile(rows[0].video_path);
  await pool.query('DELETE FROM tutorial_videos WHERE id=?', [req.params.id]);
  return res.redirect('/app-settings?msg=Tutorial+video+deleted');
}
async function list(req, res) {
  const app = normalizeApp(req.query.app || req.params.appType);
  if (!validApps.has(app)) return res.status(422).json({ success: false, message: 'Valid app type is required' });
  const [rows] = await pool.query('SELECT id,title,description,video_path,youtube_url,file_version,display_order,updated_at FROM tutorial_videos WHERE app_type=? AND is_active=1 ORDER BY display_order,id', [app]);
  return res.json({ success: true, app_type: app, videos: rows.map(v => ({ ...v, video_url: v.youtube_url ? null : `${urlService.getAbsoluteUrl(v.video_path, req)}?v=${v.file_version}` })) });
}
module.exports = { create, update, remove, list };
