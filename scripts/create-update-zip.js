const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const projectRoot = path.join(__dirname, '..');
const outputZipName = 'jaipurgro2_system_update.zip';
const targetZipPath = path.join(projectRoot, outputZipName);
const workspaceZipPath = path.join(projectRoot, '..', outputZipName);

// Excluded directories and files per SYSTEM_ZIP_UPDATE.md
const EXCLUDED_PATHS = new Set([
  'node_modules',
  'storage',
  'uploads',
  'backups',
  'db-backups',
  'db-snapshots',
  '.git',
  '.env',
  '.gemini',
  '.vscode',
  '.idea',
]);

const EXCLUDED_EXTENSIONS = ['.zip', '.tar', '.gz', '.log', '.tmp'];

function shouldExclude(relPath) {
  if (!relPath) return false;
  const parts = relPath.split(path.sep);
  if (parts.some((p) => EXCLUDED_PATHS.has(p))) return true;
  const ext = path.extname(relPath).toLowerCase();
  if (EXCLUDED_EXTENSIONS.includes(ext)) return true;
  return false;
}

function buildUpdateZip() {
  console.log('--- Creating JaipurGro2 System Update ZIP ---');
  console.log('Project Root:', projectRoot);

  const zip = new AdmZip();
  let addedFilesCount = 0;

  function addDirectoryRecursively(dirPath, zipPrefix = '') {
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const relPath = path.relative(projectRoot, fullPath);

      if (shouldExclude(relPath)) continue;

      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        addDirectoryRecursively(fullPath, path.join(zipPrefix, item));
      } else if (stat.isFile()) {
        const zipPath = path.join(zipPrefix, item).replace(/\\/g, '/');
        const content = fs.readFileSync(fullPath);
        zip.addFile(zipPath, content);
        addedFilesCount++;
      }
    }
  }

  addDirectoryRecursively(projectRoot);

  // Write ZIP to project root and parent directory
  zip.writeZip(targetZipPath);
  console.log(`[ZIP Created Successfully] Target: ${targetZipPath}`);

  try {
    zip.writeZip(workspaceZipPath);
    console.log(`[Workspace Copy Created] Target: ${workspaceZipPath}`);
  } catch (err) {
    console.log('[Workspace Copy Skipped]:', err.message);
  }

  const stat = fs.statSync(targetZipPath);
  const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);

  console.log('--- Summary ---');
  console.log(`Total Files Included: ${addedFilesCount}`);
  console.log(`ZIP Archive Size: ${sizeMB} MB (${stat.size} bytes)`);
  console.log('Required Root Entries Check:');
  console.log('  - package.json:', zip.getEntry('package.json') ? '✅ Present' : '❌ Missing');
  console.log('  - app.js:', zip.getEntry('app.js') ? '✅ Present' : '❌ Missing');

  // Verify compatibility with systemUpdateService
  try {
    const systemUpdateService = require('../services/systemUpdateService');
    const zipBuffer = fs.readFileSync(targetZipPath);
    const validated = systemUpdateService.inspectPackage(zipBuffer);
    console.log('✅ Archive Validation Test PASSED with systemUpdateService!');
    console.log(`   - Main File: ${validated.packageJson.main}`);
    console.log(`   - Valid Entries count: ${validated.entries.length}`);
  } catch (valErr) {
    console.error('❌ Archive Validation Test FAILED:', valErr.message);
  }
}

buildUpdateZip();
