const fs = require('fs');
const path = require('path');
const pool = require('../db');

const PUBLIC_ROOT = path.join(__dirname, '..', 'public');

async function initFileStorageTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS uploaded_files_backup (
        file_path VARCHAR(255) PRIMARY KEY,
        mime_type VARCHAR(100) NOT NULL,
        file_data LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Sync any existing files from public/uploads to DB on startup asynchronously
    setTimeout(() => {
      syncAllUploadsToDatabase().catch((e) => console.error('Startup upload sync error:', e));
    }, 2000);
  } catch (err) {
    console.error('Error initializing uploaded_files_backup table:', err);
  }
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

async function backupFileToDatabase(relPath, fullDiskPath) {
  try {
    const cleanRelPath = relPath.startsWith('/') ? relPath : `/${relPath}`;
    if (!fs.existsSync(fullDiskPath)) return false;

    const fileBuffer = fs.readFileSync(fullDiskPath);
    if (!fileBuffer || fileBuffer.length === 0) return false;

    const base64Data = fileBuffer.toString('base64');
    const mimeType = getMimeType(fullDiskPath);

    await pool.query(
      `INSERT INTO uploaded_files_backup (file_path, mime_type, file_data)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), file_data = VALUES(file_data), updated_at = CURRENT_TIMESTAMP`,
      [cleanRelPath, mimeType, base64Data]
    );
    return true;
  } catch (err) {
    console.error(`Failed to backup file ${relPath} to DB:`, err.message);
    return false;
  }
}

async function syncAllUploadsToDatabase() {
  const uploadsDir = path.join(PUBLIC_ROOT, 'uploads');
  if (!fs.existsSync(uploadsDir)) return;

  function scanDirectory(dirPath) {
    let filesList = [];
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        filesList = filesList.concat(scanDirectory(fullPath));
      } else if (item.isFile()) {
        filesList.push(fullPath);
      }
    }
    return filesList;
  }

  try {
    const allFiles = scanDirectory(uploadsDir);
    for (const fullPath of allFiles) {
      const relPath = fullPath.substring(PUBLIC_ROOT.length).replace(/\\/g, '/');
      await backupFileToDatabase(relPath, fullPath);
    }
  } catch (err) {
    console.error('Error scanning uploads directory for sync:', err);
  }
}

async function handleFileBackupMiddleware(req, res, next) {
  // Only process GET/HEAD requests to /uploads/*
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  const relPath = req.baseUrl ? `${req.baseUrl}${req.path}` : req.originalUrl.split('?')[0];
  const fullDiskPath = path.join(PUBLIC_ROOT, relPath);

  // 1. If file already exists on local disk, let express.static serve it (fast)
  if (fs.existsSync(fullDiskPath)) {
    // Proactively backup to DB in background if not backed up yet
    backupFileToDatabase(relPath, fullDiskPath).catch(() => {});
    return next();
  }

  // 2. If file is missing on local disk (wiped by Render container redeploy), restore from MySQL DB!
  try {
    const [rows] = await pool.query(
      'SELECT mime_type, file_data FROM uploaded_files_backup WHERE file_path = ? LIMIT 1',
      [relPath]
    );

    if (rows && rows[0] && rows[0].file_data) {
      const fileBuffer = Buffer.from(rows[0].file_data, 'base64');

      // Re-create the file on local disk so subsequent requests serve instantly from disk
      try {
        fs.mkdirSync(path.dirname(fullDiskPath), { recursive: true });
        fs.writeFileSync(fullDiskPath, fileBuffer);
      } catch (_) {}

      res.type(rows[0].mime_type || getMimeType(fullDiskPath));
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(fileBuffer);
    }
  } catch (err) {
    console.error(`Error restoring file ${relPath} from DB:`, err);
  }

  next();
}

module.exports = {
  initFileStorageTable,
  backupFileToDatabase,
  syncAllUploadsToDatabase,
  handleFileBackupMiddleware,
};
