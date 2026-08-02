const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const pool = require('../db');
const { exportSnapshot } = require('../databaseSnapshot');

const execAsync = util.promisify(exec);

const baseBackupDir = path.join(__dirname, '../backups');
const dbBackupDir = path.join(baseBackupDir, 'database');
const systemBackupDir = path.join(baseBackupDir, 'system');

function ensureDirectories() {
  if (!fs.existsSync(baseBackupDir)) fs.mkdirSync(baseBackupDir, { recursive: true });
  if (!fs.existsSync(dbBackupDir)) fs.mkdirSync(dbBackupDir, { recursive: true });
  if (!fs.existsSync(systemBackupDir)) fs.mkdirSync(systemBackupDir, { recursive: true });
}

function getTimestampString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${dateStr}_${timeStr}`;
}

async function createDatabaseBackup(triggerType = 'manual') {
  ensureDirectories();
  const timestamp = getTimestampString();
  const filename = `db_backup_${triggerType}_${timestamp}.json`;
  const filePath = path.join(dbBackupDir, filename);

  const result = await exportSnapshot(pool, filePath);
  const stats = fs.statSync(filePath);

  return {
    filename,
    filePath,
    type: 'database',
    triggerType,
    size: stats.size,
    tablesCount: result.tables,
    createdAt: new Date().toISOString(),
  };
}

async function createFileSystemBackup(triggerType = 'manual') {
  ensureDirectories();
  const timestamp = getTimestampString();
  const filename = `system_backup_${triggerType}_${timestamp}.tar.gz`;
  const filePath = path.join(systemBackupDir, filename);
  const projectRoot = path.join(__dirname, '..');
  const uploadsDir = path.join(projectRoot, 'uploads');

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const cmd = `tar -czf "${filePath}" -C "${projectRoot}" uploads`;
  await execAsync(cmd);

  const stats = fs.statSync(filePath);
  return {
    filename,
    filePath,
    type: 'system',
    triggerType,
    size: stats.size,
    createdAt: new Date().toISOString(),
  };
}

async function createFullBackup(triggerType = 'manual') {
  console.log(`[BackupService] Starting full backup (Trigger: ${triggerType})...`);
  const startTime = Date.now();

  const dbBackup = await createDatabaseBackup(triggerType);
  const sysBackup = await createFileSystemBackup(triggerType);

  await cleanOldBackups(30);

  const durationMs = Date.now() - startTime;
  console.log(`[BackupService] Full backup completed in ${durationMs}ms`);

  return {
    success: true,
    triggerType,
    durationMs,
    dbBackup,
    sysBackup,
    createdAt: new Date().toISOString(),
  };
}

async function cleanOldBackups(daysToKeep = 30) {
  ensureDirectories();
  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

  const cleanDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) return;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stats = fs.statSync(fullPath);
      if (stats.mtimeMs < cutoff) {
        fs.unlinkSync(fullPath);
        console.log(`[BackupService] Cleaned up old backup file: ${file}`);
      }
    }
  };

  cleanDir(dbBackupDir);
  cleanDir(systemBackupDir);
}

function listBackups() {
  ensureDirectories();
  const list = [];

  const scanDir = (dirPath, type) => {
    if (!fs.existsSync(dirPath)) return;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (file.startsWith('.')) continue;
      const fullPath = path.join(dirPath, file);
      const stats = fs.statSync(fullPath);
      const isAuto = file.includes('_automatic_');
      list.push({
        filename: file,
        filePath: fullPath,
        type,
        triggerType: isAuto ? 'automatic' : 'manual',
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        createdAt: stats.birthtime || stats.mtime,
      });
    }
  };

  scanDir(dbBackupDir, 'database');
  scanDir(systemBackupDir, 'system');

  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list;
}

function deleteBackup(filename) {
  ensureDirectories();
  const sanitize = path.basename(filename);
  const dbPath = path.join(dbBackupDir, sanitize);
  const sysPath = path.join(systemBackupDir, sanitize);

  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    return true;
  }
  if (fs.existsSync(sysPath)) {
    fs.unlinkSync(sysPath);
    return true;
  }
  return false;
}

function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

let midnightTimer = null;

function scheduleMidnightBackup() {
  const calculateMsUntilMidnight = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0); // 00:00:00 AM next day
    return midnight.getTime() - now.getTime();
  };

  const msUntilMidnight = calculateMsUntilMidnight();
  console.log(`[BackupService] Automated 24-Hour Midnight Backup scheduled in ${(msUntilMidnight / 1000 / 60).toFixed(1)} minutes (at 00:00 AM IST).`);

  if (midnightTimer) clearTimeout(midnightTimer);

  midnightTimer = setTimeout(async () => {
    try {
      console.log('[BackupService] 🕛 Midnight 00:00 AM Triggered Automated Backup!');
      await createFullBackup('automatic');
    } catch (err) {
      console.error('[BackupService] Automated Midnight Backup error:', err);
    } finally {
      scheduleMidnightBackup(); // Reschedule for next midnight
    }
  }, msUntilMidnight);
}

module.exports = {
  ensureDirectories,
  createDatabaseBackup,
  createFileSystemBackup,
  createFullBackup,
  listBackups,
  deleteBackup,
  scheduleMidnightBackup,
};
