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

async function cleanupProductImages(productIds = null, poolConnection = null) {
  const pool = require('../db');
  const conn = poolConnection || pool;

  const stats = {
    deletedFilesCount: 0,
    missingFilesCount: 0,
    skippedSharedCount: 0,
  };

  try {
    const candidateUrls = new Set();
    const isWipeAll = !productIds || (Array.isArray(productIds) && productIds.length === 0);

    if (isWipeAll) {
      const [prodRows] = await conn.query('SELECT image_url FROM products WHERE image_url IS NOT NULL AND TRIM(image_url) <> \'\'').catch(() => [[]]);
      const [vendorRows] = await conn.query('SELECT image_url, vendor_image_url, product_image_url FROM vendor_products').catch(() => [[]]);

      (prodRows || []).forEach((row) => { if (row.image_url) candidateUrls.add(String(row.image_url).trim()); });
      (vendorRows || []).forEach((row) => {
        if (row.image_url) candidateUrls.add(String(row.image_url).trim());
        if (row.vendor_image_url) candidateUrls.add(String(row.vendor_image_url).trim());
        if (row.product_image_url) candidateUrls.add(String(row.product_image_url).trim());
      });

      const productUploadsDir = path.join(publicRoot, 'uploads', 'products');
      if (fs.existsSync(productUploadsDir)) {
        const scanDir = (dirPath, relativePrefix) => {
          const items = fs.readdirSync(dirPath);
          for (const item of items) {
            const itemFullPath = path.join(dirPath, item);
            const itemRelative = `${relativePrefix}/${item}`;
            const stat = fs.statSync(itemFullPath);
            if (stat.isFile()) {
              candidateUrls.add(itemRelative);
            } else if (stat.isDirectory()) {
              scanDir(itemFullPath, itemRelative);
            }
          }
        };
        scanDir(productUploadsDir, '/uploads/products');
      }
    } else {
      const validIds = [...new Set([].concat(productIds).map((id) => parseInt(id, 10)).filter((id) => Number.isFinite(id) && id > 0))];
      if (!validIds.length) return stats;

      const placeholders = validIds.map(() => '?').join(',');
      const [prodRows] = await conn.query(`SELECT image_url FROM products WHERE id IN (${placeholders})`, validIds).catch(() => [[]]);
      const [vendorRows] = await conn.query(`SELECT image_url, vendor_image_url, product_image_url FROM vendor_products WHERE product_id IN (${placeholders})`, validIds).catch(() => [[]]);

      (prodRows || []).forEach((row) => { if (row.image_url) candidateUrls.add(String(row.image_url).trim()); });
      (vendorRows || []).forEach((row) => {
        if (row.image_url) candidateUrls.add(String(row.image_url).trim());
        if (row.vendor_image_url) candidateUrls.add(String(row.vendor_image_url).trim());
        if (row.product_image_url) candidateUrls.add(String(row.product_image_url).trim());
      });
    }

    const filteredCandidates = [];
    for (const rawUrl of candidateUrls) {
      if (!rawUrl || typeof rawUrl !== 'string') continue;
      const cleanUrl = rawUrl.trim();
      const lower = cleanUrl.toLowerCase();

      if (lower === '/default.png' || lower === 'default.png' || lower.includes('placeholder')) {
        continue;
      }
      if (!cleanUrl.startsWith('/uploads/products/') && !cleanUrl.startsWith('uploads/products/')) {
        continue;
      }
      filteredCandidates.push(cleanUrl.startsWith('/') ? cleanUrl : `/${cleanUrl}`);
    }

    const protectedUrls = new Set();
    const [catRows] = await conn.query('SELECT image_path FROM categories WHERE image_path IS NOT NULL AND TRIM(image_path) <> \'\'').catch(() => [[]]);
    const [subCatRows] = await conn.query('SELECT image_path FROM sub_categories WHERE image_path IS NOT NULL AND TRIM(image_path) <> \'\'').catch(() => [[]]);
    const [brandRows] = await conn.query('SELECT logo_path FROM brands WHERE logo_path IS NOT NULL AND TRIM(logo_path) <> \'\'').catch(() => [[]]);
    const [adRows] = await conn.query('SELECT image_path FROM advertisements WHERE image_path IS NOT NULL AND TRIM(image_path) <> \'\'').catch(() => [[]]);
    const [promoRows] = await conn.query('SELECT image_url FROM promotions WHERE image_url IS NOT NULL AND TRIM(image_url) <> \'\'').catch(() => [[]]);

    [catRows, subCatRows, brandRows, adRows, promoRows].forEach((rows) => {
      (rows || []).forEach((r) => {
        const val = r.image_path || r.logo_path || r.image_url;
        if (val) protectedUrls.add(String(val).trim());
      });
    });

    const remainingActiveProdUrls = new Set();
    if (!isWipeAll && productIds && productIds.length) {
      const validIds = [...new Set([].concat(productIds).map((id) => parseInt(id, 10)).filter((id) => Number.isFinite(id) && id > 0))];
      const placeholders = validIds.map(() => '?').join(',');

      const [activeProds] = await conn.query(`SELECT image_url FROM products WHERE is_deleted = 0 AND id NOT IN (${placeholders}) AND image_url IS NOT NULL`, validIds).catch(() => [[]]);
      const [activeVendors] = await conn.query(`SELECT image_url, vendor_image_url, product_image_url FROM vendor_products WHERE product_id NOT IN (${placeholders})`, validIds).catch(() => [[]]);

      (activeProds || []).forEach((row) => { if (row.image_url) remainingActiveProdUrls.add(String(row.image_url).trim()); });
      (activeVendors || []).forEach((row) => {
        if (row.image_url) remainingActiveProdUrls.add(String(row.image_url).trim());
        if (row.vendor_image_url) remainingActiveProdUrls.add(String(row.vendor_image_url).trim());
        if (row.product_image_url) remainingActiveProdUrls.add(String(row.product_image_url).trim());
      });
    }

    const productsUploadDir = path.join(publicRoot, 'uploads', 'products');

    for (const url of filteredCandidates) {
      if (protectedUrls.has(url) || remainingActiveProdUrls.has(url)) {
        stats.skippedSharedCount++;
        continue;
      }

      const relativePath = url.replace(/^\//, '');
      const fullPath = path.join(publicRoot, relativePath);

      if (!fullPath.startsWith(productsUploadDir)) {
        stats.skippedSharedCount++;
        continue;
      }

      try {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          stats.deletedFilesCount++;
        } else {
          console.warn(`[ProductImageCleanup] Image file already missing on server: ${fullPath}`);
          stats.missingFilesCount++;
        }
      } catch (err) {
        console.error(`[ProductImageCleanup] Failed to unlink file ${fullPath}:`, err.message);
      }
    }

    if (fs.existsSync(productsUploadDir)) {
      try {
        const removeEmptyDirs = (dirPath) => {
          const items = fs.readdirSync(dirPath);
          for (const item of items) {
            const itemPath = path.join(dirPath, item);
            if (fs.existsSync(itemPath) && fs.statSync(itemPath).isDirectory()) {
              removeEmptyDirs(itemPath);
              if (fs.readdirSync(itemPath).length === 0) {
                fs.rmdirSync(itemPath);
              }
            }
          }
        };
        removeEmptyDirs(productsUploadDir);
      } catch (err) {
        console.error('[ProductImageCleanup] Error cleaning empty subfolders:', err.message);
      }
    }

  } catch (error) {
    console.error('[ProductImageCleanup] Error during product image cleanup:', error);
  }

  return stats;
}

module.exports = {
  presets,
  processImageBuffer,
  processUploadedFile,
  deleteLocalImageFile,
  cleanupProductImages,
};

