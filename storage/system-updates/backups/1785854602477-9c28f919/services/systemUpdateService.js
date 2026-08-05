const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const projectRoot = path.resolve(__dirname, '..');
const updateRoot = path.join(projectRoot, 'storage', 'system-updates');
const backupRoot = path.join(updateRoot, 'backups');
const historyFile = path.join(updateRoot, 'history.json');
const protectedRoots = new Set(['.git', 'node_modules', 'uploads', 'storage', 'backups', 'db-backups', 'db-snapshots']);
const protectedFiles = new Set(['.env']);
let updateInProgress = false;

function ensureDirs() {
  fs.mkdirSync(backupRoot, { recursive: true });
}

function safeRelative(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return null;
  const clean = path.posix.normalize(normalized);
  if (clean === '..' || clean.startsWith('../') || path.posix.isAbsolute(clean)) return null;
  return clean;
}

function isProtected(relative) {
  const clean = safeRelative(relative);
  if (!clean) return true;
  const first = clean.split('/')[0];
  return protectedRoots.has(first) || protectedFiles.has(clean);
}

function readHistory() {
  try {
    const rows = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

function saveHistory(entry) {
  ensureDirs();
  const rows = [entry, ...readHistory()].slice(0, 50);
  fs.writeFileSync(historyFile, JSON.stringify(rows, null, 2));
}

function resolveArchiveRoot(zip) {
  const files = zip.getEntries().filter((entry) => !entry.isDirectory);
  const names = files.map((entry) => safeRelative(entry.entryName)).filter(Boolean);
  if (names.includes('package.json')) return '';
  const roots = [...new Set(names.map((name) => name.split('/')[0]))];
  if (roots.length === 1 && names.includes(`${roots[0]}/package.json`)) return `${roots[0]}/`;
  throw new Error('ZIP must contain package.json at its root (or inside one top-level folder)');
}

function inspectPackage(buffer) {
  if (!buffer || buffer.length < 4) throw new Error('ZIP file is empty');
  const zip = new AdmZip(buffer);
  const prefix = resolveArchiveRoot(zip);
  const allEntries = zip.getEntries();
  if (allEntries.length > 10000) throw new Error('ZIP contains too many entries');
  const expandedBytes = allEntries.reduce((sum, entry) => sum + Number((entry.header && entry.header.size) || 0), 0);
  const maxExpandedBytes = Number(process.env.SYSTEM_UPDATE_MAX_EXPANDED_MB || 500) * 1024 * 1024;
  if (expandedBytes > maxExpandedBytes) throw new Error('Expanded ZIP is larger than the allowed update size');
  const packageEntry = zip.getEntry(`${prefix}package.json`);
  let packageJson;
  try {
    packageJson = JSON.parse(packageEntry.getData().toString('utf8'));
  } catch (_) {
    throw new Error('ZIP contains an invalid package.json');
  }
  if (!packageJson.name || !packageJson.main) throw new Error('package.json must contain name and main');
  const installedPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  if (packageJson.name !== installedPackage.name) throw new Error(`Package name must be ${installedPackage.name}`);

  const entries = [];
  for (const entry of allEntries) {
    if (entry.isDirectory) continue;
    const raw = entry.entryName.replace(/\\/g, '/');
    if (!raw.startsWith(prefix)) continue;
    const relative = safeRelative(raw.slice(prefix.length));
    if (!relative) throw new Error(`Unsafe ZIP path: ${entry.entryName}`);
    if ((entry.attr >>> 16 & 0o170000) === 0o120000) throw new Error(`Symbolic links are not allowed: ${relative}`);
    if (isProtected(relative)) continue;
    entries.push({ entry, relative });
  }
  if (!entries.some((item) => item.relative === packageJson.main)) throw new Error(`ZIP is missing main file: ${packageJson.main}`);
  return { zip, packageJson, entries };
}

function copyFileWithDirs(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

async function applyUpdate({ buffer, originalName, actor }) {
  if (updateInProgress) {
    const error = new Error('Another system update is already in progress');
    error.status = 409;
    throw error;
  }
  updateInProgress = true;
  ensureDirs();
  const updateId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groxen-update-'));
  const backupDir = path.join(backupRoot, updateId);
  const changed = [];
  const created = [];
  try {
    const inspected = inspectPackage(buffer);
    for (const { entry, relative } of inspected.entries) {
      const staged = path.resolve(stageDir, relative);
      if (!staged.startsWith(`${path.resolve(stageDir)}${path.sep}`)) throw new Error(`Unsafe destination: ${relative}`);
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      fs.writeFileSync(staged, entry.getData());
    }

    fs.mkdirSync(backupDir, { recursive: true });
    for (const { relative } of inspected.entries) {
      const target = path.resolve(projectRoot, relative);
      if (!target.startsWith(`${projectRoot}${path.sep}`)) throw new Error(`Unsafe target: ${relative}`);
      if (fs.existsSync(target)) {
        copyFileWithDirs(target, path.join(backupDir, relative));
        changed.push(relative);
      } else {
        created.push(relative);
      }
    }
    fs.writeFileSync(path.join(backupDir, 'rollback-manifest.json'), JSON.stringify({ changed, created }, null, 2));

    for (const { relative } of inspected.entries) {
      copyFileWithDirs(path.join(stageDir, relative), path.join(projectRoot, relative));
    }

    const result = {
      id: updateId,
      status: 'applied',
      file: path.basename(originalName || 'update.zip'),
      package: inspected.packageJson.name,
      version: inspected.packageJson.version || '',
      changed: changed.length,
      created: created.length,
      actor: actor ? { id: actor.id, name: actor.name || '', role: actor.role || '' } : null,
      applied_at: new Date().toISOString(),
      restart_required: true,
    };
    saveHistory(result);
    return result;
  } catch (error) {
    if (fs.existsSync(path.join(backupDir, 'rollback-manifest.json'))) {
      const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'rollback-manifest.json'), 'utf8'));
      for (const relative of manifest.changed) copyFileWithDirs(path.join(backupDir, relative), path.join(projectRoot, relative));
      for (const relative of manifest.created) {
        const target = path.join(projectRoot, relative);
        if (fs.existsSync(target) && fs.statSync(target).isFile()) fs.unlinkSync(target);
      }
    }
    saveHistory({ id: updateId, status: 'failed', file: path.basename(originalName || 'update.zip'), error: error.message, applied_at: new Date().toISOString() });
    throw error;
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
    updateInProgress = false;
  }
}

module.exports = { applyUpdate, inspectPackage, readHistory };
