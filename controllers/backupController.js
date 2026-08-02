const path = require('path');
const fs = require('fs');
const backupService = require('../services/backupService');

function actor(req) {
  return req.authUser || req.session.user;
}

function wantsJson(req) {
  return req.query.format === 'json' || req.accepts(['html', 'json']) === 'json';
}

async function listBackups(req, res) {
  try {
    const currentActor = actor(req);
    if (!currentActor) return res.status(401).json({ success: false, message: 'Authentication required' });

    const backups = backupService.listBackups();

    if (!wantsJson(req)) {
      return res.render('system-backups', {
        user: req.session.user,
        shell: res.locals.shell || {},
        backups,
      });
    }

    res.json({
      success: true,
      backups,
      totalCount: backups.length,
    });
  } catch (error) {
    console.error('Error listing backups:', error);
    res.status(500).json({ success: false, message: 'Unable to fetch backups' });
  }
}

async function createBackup(req, res) {
  try {
    const currentActor = actor(req);
    if (!currentActor) return res.status(401).json({ success: false, message: 'Authentication required' });

    const backupResult = await backupService.createFullBackup('manual');

    res.json({
      success: true,
      message: 'Full system uploads & database backup created successfully!',
      result: backupResult,
    });
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ success: false, message: error.message || 'Unable to create backup' });
  }
}

async function downloadBackup(req, res) {
  try {
    const currentActor = actor(req);
    if (!currentActor) return res.status(401).json({ success: false, message: 'Authentication required' });

    const filename = path.basename(req.params.filename);
    const dbPath = path.join(__dirname, '../backups/database', filename);
    const sysPath = path.join(__dirname, '../backups/system', filename);

    let filePath = null;
    if (fs.existsSync(dbPath)) filePath = dbPath;
    else if (fs.existsSync(sysPath)) filePath = sysPath;

    if (!filePath) {
      return res.status(404).json({ success: false, message: 'Backup file not found' });
    }

    res.download(filePath, filename);
  } catch (error) {
    console.error('Error downloading backup:', error);
    res.status(500).json({ success: false, message: 'Unable to download backup file' });
  }
}

async function deleteBackup(req, res) {
  try {
    const currentActor = actor(req);
    if (!currentActor) return res.status(401).json({ success: false, message: 'Authentication required' });

    const filename = req.params.filename;
    const deleted = backupService.deleteBackup(filename);

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Backup file not found or already deleted' });
    }

    res.json({ success: true, message: `Backup file "${filename}" deleted successfully.` });
  } catch (error) {
    console.error('Error deleting backup:', error);
    res.status(500).json({ success: false, message: 'Unable to delete backup file' });
  }
}

module.exports = {
  listBackups,
  createBackup,
  downloadBackup,
  deleteBackup,
};
