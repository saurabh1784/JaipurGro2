const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const publicRoot = path.join(__dirname, '..', 'public');

const presets = {
  product: { folder: 'products', width: 900, height: 900, fit: 'cover', quality: 86 },
  category: { folder: 'categories', width: 512, height: 512, fit: 'cover', quality: 86 },
  subcategory: { folder: 'subcategories', width: 512, height: 512, fit: 'cover', quality: 86 },
  brand: { folder: 'brands', width: 512, height: 512, fit: 'contain', quality: 88, background: { r: 255, g: 255, b: 255, alpha: 0 } },
  banner: { folder: 'advertisements', width: 1600, height: 600, fit: 'cover', quality: 86 },
  promotion: { folder: 'promotions', width: 1200, height: 675, fit: 'cover', quality: 86 },
  profile: { folder: 'delivery-profiles', width: 512, height: 512, fit: 'cover', quality: 86 },
  signature: { folder: 'vendor-signatures', width: 900, height: 360, fit: 'contain', quality: 88, background: { r: 255, g: 255, b: 255, alpha: 0 } },
};

function safeFileBase(value) {
  return String(value || 'image')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'image';
}

function presetFor(type) {
  return presets[type] || presets.product;
}

function publicPathFor(fullPath) {
  return `/${path.relative(publicRoot, fullPath).replace(/\\/g, '/')}`;
}

async function processImageBuffer(buffer, type, baseName) {
  const preset = presetFor(type);
  const uploadDir = path.join(publicRoot, 'uploads', preset.folder);
  fs.mkdirSync(uploadDir, { recursive: true });

  const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
  if (!metadata.width || !metadata.height || !metadata.format) {
    const error = new Error('File is not a valid image');
    error.invalidImage = true;
    throw error;
  }

  const fileName = `${safeFileBase(baseName)}-${Date.now()}.webp`;
  const outputPath = path.join(uploadDir, fileName);
  await sharp(buffer, { failOn: 'error' })
    .rotate()
    .resize({
      width: preset.width,
      height: preset.height,
      fit: preset.fit || 'cover',
      position: 'centre',
      background: preset.background || { r: 255, g: 255, b: 255, alpha: 1 },
      withoutEnlargement: false,
    })
    .webp({ quality: preset.quality || 86, effort: 5 })
    .toFile(outputPath);

  return {
    path: publicPathFor(outputPath),
    width: preset.width,
    height: preset.height,
    format: 'webp',
  };
}

async function processUploadedFile(file, type, baseName) {
  if (!file) return null;
  const buffer = file.buffer || (file.path ? await fs.promises.readFile(file.path) : null);
  if (!buffer) return null;
  const result = await processImageBuffer(buffer, type, baseName || file.originalname);
  if (file.path) {
    fs.promises.unlink(file.path).catch(() => {});
  }
  file.processedPath = result.path;
  return result.path;
}

function deleteLocalImageFile(relativeUrl) {
  if (!relativeUrl || typeof relativeUrl !== 'string') return false;
  const cleanPath = relativeUrl.trim();
  if (cleanPath.startsWith('/uploads/')) {
    const fullPath = path.join(publicRoot, cleanPath.replace(/^\//, ''));
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        return true;
      }
    } catch (err) {
      console.error(`Unable to delete old image file at ${fullPath}:`, err.message);
    }
  }
  return false;
}

module.exports = {
  presets,
  processImageBuffer,
  processUploadedFile,
  deleteLocalImageFile,
};

