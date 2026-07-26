const fs = require('fs');
const path = require('path');
const pool = require('../db');

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractFileSlug(filename) {
  if (!filename || typeof filename !== 'string') return '';
  const base = filename.replace(/\.(png|jpe?g|webp|gif)$/i, '').toLowerCase();
  if (base.startsWith('temp-upload-') || base === 'product' || base.startsWith('product-')) return '';
  const parts = base.split('-');
  while (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join('-');
}

async function auditAndRepairProductImages() {
  const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'products');
  const files = fs
    .readdirSync(uploadDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name));

  console.log(`Found ${files.length} total image file(s) in upload directory.`);

  // Build a map of file slug -> filename
  const fileSlugMap = new Map();
  for (const file of files) {
    const fileSlug = extractFileSlug(file);
    if (fileSlug && !fileSlugMap.has(fileSlug)) {
      fileSlugMap.set(fileSlug, file);
    }
  }

  const [products] = await pool.query(
    `SELECT id, name, image_url
     FROM products
     WHERE is_deleted = 0`
  );

  let repairedCount = 0;
  let skippedCount = 0;
  let correctCount = 0;

  for (const product of products) {
    const productSlug = slugify(product.name);
    const exactFile = fileSlugMap.get(productSlug);

    const currentUrl = (product.image_url || '').trim();
    const currentFilename = currentUrl.split('/').pop() || '';
    const currentSlug = extractFileSlug(currentFilename);

    if (exactFile) {
      const correctUrl = `/uploads/products/${exactFile}`;
      if (currentUrl !== correctUrl) {
        await pool.query('UPDATE products SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
          correctUrl,
          product.id,
        ]);
        repairedCount++;
        console.log(`[REPAIRED] Product #${product.id} "${product.name}" -> ${correctUrl} (was: ${currentUrl})`);
      } else {
        correctCount++;
      }
    } else {
      // If current image slug belongs to a totally different product name
      if (currentUrl && currentUrl !== '/default.png' && currentSlug && currentSlug !== productSlug) {
        // Find if currentSlug matches any other product name
        const [otherProduct] = await pool.query(
          'SELECT id, name FROM products WHERE is_deleted = 0 AND id <> ? AND name = ? LIMIT 1',
          [product.id, currentSlug]
        );
        if (otherProduct && otherProduct.length) {
          // Reset mislinked image to default placeholder
          await pool.query("UPDATE products SET image_url = '/default.png', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [product.id]);
          repairedCount++;
          console.log(`[RESET MISLINKED] Product #${product.id} "${product.name}" reset to /default.png (was mislinked to ${currentUrl})`);
        } else {
          skippedCount++;
        }
      } else {
        skippedCount++;
      }
    }
  }

  console.log(`\nAudit complete: ${repairedCount} mislinked product(s) repaired/reset, ${correctCount} correct, ${skippedCount} skipped.`);
}

auditAndRepairProductImages()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Audit failed:', err);
    pool.end().finally(() => process.exit(1));
  });
