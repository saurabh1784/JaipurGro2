const pool = require('../db');
const Product = require('../models/Product');
const Catalog = require('../models/Catalog');
const { processUploadedFile, deleteLocalImageFile, cleanupProductImages } = require('../services/imageProcessingService');

async function getProductImagesPage(req, res) {
  try {
    const user = req.authUser || (req.session && req.session.user) || {};
    const shell = req.shell || (res.locals && res.locals.shell);
    const categories = await Catalog.listCategories();
    const subcategories = await Catalog.listSubcategories();
    const brands = await Catalog.listBrands();
    const roleNorm = String(user.role || '').toLowerCase();
    const isSuperAdmin = roleNorm === 'superadmin';

    return res.render('product_images', {
      shell,
      user,
      isSuperAdmin,
      categories,
      subcategories,
      brands,
    });
  } catch (error) {
    console.error('Error rendering product images page:', error);
    return res.status(500).send('Error loading product images page');
  }
}

async function listProductImages(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 16));
    const result = await Product.list({
      page,
      limit,
      search: String(req.query.search || req.query.name || '').trim(),
      category_id: parseInt(req.query.category_id, 10) || '',
      sub_category_id: parseInt(req.query.sub_category_id, 10) || '',
      brand_name: String(req.query.brand_name || req.query.brand || '').trim(),
      image_type: String(req.query.image_type || '').trim().toLowerCase(),
    });

    const items = (result.products || []).map((product) => {
      const imageUrl = String(product.image_url || '/default.png').trim() || '/default.png';
      const isDefault = imageUrl === '/default.png' || imageUrl.toLowerCase().includes('placeholder');
      return {
        id: product.id,
        product_id: product.id,
        product_name: product.name,
        description: product.description || '',
        price: Number(product.price || 0),
        weight: product.weight_label || `${Number(product.weight_value || product.weight_kg || 0)} ${product.weight_unit || 'kg'}`,
        approval_status: product.approval_status || 'approved',
        category_id: product.category_id,
        category_name: product.category_name || 'Uncategorized',
        main_category: product.category_name || 'Uncategorized',
        sub_category_id: product.sub_category_id,
        sub_category_name: product.sub_category_name || 'Unassigned',
        brand_id: product.brand_id,
        brand_name: product.brand_name || 'Generic',
        brand_logo: product.brand_logo_path || '',
        image_url: imageUrl,
        image_version: product.image_version || 0,
        filename: imageUrl.split('/').pop() || 'default.png',
        image_type: isDefault ? 'Default Placeholder' : 'Main Image',
        is_default: isDefault,
      };
    });

    return res.json({
      success: true,
      items,
      pagination: {
        page: result.pagination.page,
        limit: result.pagination.limit,
        totalItems: Number(result.pagination.total || 0),
        totalPages: result.pagination.totalPages,
      },
    });
  } catch (error) {
    console.error('listProductImages error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch product images' });
  }
}
async function replaceProductImage(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(422).json({ success: false, message: 'Valid product ID is required' });

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    let newImageUrl = req.body && req.body.image_url ? req.body.image_url.trim() : null;

    if (req.file) {
      newImageUrl = await processUploadedFile(req.file, 'product', `${product.name}-${id}`);
    }

    if (!newImageUrl) {
      return res.status(400).json({ success: false, message: 'New image file or URL is required' });
    }

    const oldImageUrl = product.image_url;
    await Product.updateImage(id, newImageUrl);

    if (oldImageUrl && oldImageUrl !== '/default.png' && oldImageUrl !== newImageUrl) {
      const [shared] = await pool.query(
        'SELECT id FROM products WHERE image_url = ? AND id <> ? AND is_deleted = 0 LIMIT 1',
        [oldImageUrl, id]
      ).catch(() => [[]]);
      if (!shared || !shared.length) {
        deleteLocalImageFile(oldImageUrl);
      }
    }

    return res.json({
      success: true,
      message: 'Product image updated successfully',
      image_url: newImageUrl,
    });
  } catch (error) {
    console.error('replaceProductImage error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update product image' });
  }
}

async function deleteProductImage(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(422).json({ success: false, message: 'Valid product ID is required' });

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const oldImageUrl = product.image_url;
    await Product.updateImage(id, '/default.png');

    if (oldImageUrl && oldImageUrl !== '/default.png') {
      const [shared] = await pool.query(
        'SELECT id FROM products WHERE image_url = ? AND id <> ? AND is_deleted = 0 LIMIT 1',
        [oldImageUrl, id]
      ).catch(() => [[]]);
      if (!shared || !shared.length) {
        deleteLocalImageFile(oldImageUrl);
      }
    }

    return res.json({
      success: true,
      message: 'Product image deleted. Product reset to default placeholder without deleting product entity.',
      image_url: '/default.png',
    });
  } catch (error) {
    console.error('deleteProductImage error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete product image' });
  }
}

async function bulkDeleteProductImages(req, res) {
  try {
    const isWipeAllSystem = Boolean(req.body && (req.body.select_all || req.body.wipe_all || req.body.all || req.body.all_pages));

    if (isWipeAllSystem) {
      const [rows] = await pool.query(`SELECT id, image_url FROM products WHERE is_deleted = 0 AND image_url IS NOT NULL AND TRIM(image_url) <> '' AND image_url <> '/default.png'`).catch(() => [[]]);
      const targetCount = rows ? rows.length : 0;

      await pool.query(`UPDATE products SET image_url = '/default.png', updated_at = CURRENT_TIMESTAMP WHERE is_deleted = 0 AND image_url IS NOT NULL AND TRIM(image_url) <> '' AND image_url <> '/default.png'`);

      const cleanupStats = await cleanupProductImages(null, pool);
      const deletedFiles = cleanupStats.deletedFilesCount || 0;

      return res.json({
        success: true,
        message: `Successfully reset images for all ${targetCount} product(s) in system and cleaned ${deletedFiles} file(s) from server storage.`,
        deletedCount: targetCount,
        deletedFiles,
        wipe_all: true,
      });
    }

    const rawIds = req.body ? (req.body.ids || req.body.product_ids || req.body.productIds || (Array.isArray(req.body) ? req.body : [])) : [];
    const idsArray = Array.isArray(rawIds) ? rawIds : [rawIds];
    const ids = idsArray.map((id) => parseInt(id, 10)).filter((id) => Number.isFinite(id) && id > 0);

    if (!ids.length) {
      return res.status(400).json({ success: false, message: 'No product IDs provided for bulk image deletion' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(`SELECT id, image_url FROM products WHERE id IN (${placeholders})`, ids);

    await pool.query(`UPDATE products SET image_url = '/default.png', updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, ids);

    let deletedFileCount = 0;
    for (const row of rows || []) {
      const oldUrl = row.image_url;
      if (oldUrl && oldUrl !== '/default.png') {
        const [shared] = await pool.query(
          'SELECT id FROM products WHERE image_url = ? AND id NOT IN (' + placeholders + ') AND is_deleted = 0 LIMIT 1',
          [oldUrl, ...ids]
        ).catch(() => [[]]);
        if (!shared || !shared.length) {
          if (deleteLocalImageFile(oldUrl)) deletedFileCount++;
        }
      }
    }

    return res.json({
      success: true,
      message: `Successfully reset images for ${ids.length} product(s) and cleaned ${deletedFileCount} file(s) from server.`,
      deletedCount: ids.length,
      deletedFiles: deletedFileCount,
    });
  } catch (error) {
    console.error('bulkDeleteProductImages error:', error);
    return res.status(500).json({ success: false, message: 'Failed to bulk delete product images' });
  }
}

module.exports = {
  getProductImagesPage,
  listProductImages,
  replaceProductImage,
  deleteProductImage,
  bulkDeleteProductImages,
};
