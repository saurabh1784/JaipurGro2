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

async function linkProductImages() {
  const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'products');
  const files = fs
    .readdirSync(uploadDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name));

  const [products] = await pool.query(
    `SELECT id, name, image_url
     FROM products
     WHERE is_deleted = 0
       AND NULLIF(NULLIF(image_url, ''), '/default.png') IS NULL`
  );

  let linked = 0;
  for (const product of products) {
    const productSlug = slugify(product.name);
    const file = files.find((name) => (
      name.toLowerCase().startsWith(`${productSlug}-`)
    ));
    if (!file) continue;

    const imageUrl = `/uploads/products/${file}`;
    await pool.query('UPDATE products SET image_url = ? WHERE id = ?', [
      imageUrl,
      product.id,
    ]);
    linked += 1;
    console.log(`Linked ${product.name} -> ${imageUrl}`);
  }

  console.log(`Linked ${linked} product image(s).`);
}

linkProductImages()
  .then(() => pool.end())
  .catch((error) => {
    console.error(`Unable to link product images: ${pool.formatError(error)}`);
    pool.end().finally(() => process.exit(1));
  });
