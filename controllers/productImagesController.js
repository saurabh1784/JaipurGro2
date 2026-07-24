const pool = require('../db');
const Product = require('../models/Product');
const Catalog = require('../models/Catalog');
const { processUploadedFile, deleteLocalImageFile } = require('../services/imageProcessingService');

async function getProductImagesPage(req, res) {
  try {
    const categories = await Catalog.listCategories();
    const subcategories = await Catalog.listSubcategories();
    const brands = await Catalog.listBrands();
    return res.render('product_images', {
      shell: req.shell,
      user: req.authUser,
      isSuperAdmin: req.authUser.role === 'SuperAdmin',
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
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 16));
    const search = String(req.query.search || req.query.name || '').trim();
    const categoryId = parseInt(req.query.category_id, 10) || 0;
    const subCategoryId = parseInt(req.query.sub_category_id, 10) || 0;
    const brandName = String(req.query.brand_name || req.query.brand || '').trim();
    const imageType = String(req.query.image_type || '').trim().toLowerCase();

    let whereConditions = ['p.is_deleted = 0'];
    let queryParams = [];

    if (search) {
      if (/^\d+$/.test(search)) {
        whereConditions.push('(p.id = ? OR LOWER(p.name) LIKE ? OR LOWER(p.image_url) LIKE ?)');
        queryParams.push(parseInt(search, 10), `%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
      } else {
        whereConditions.push('(LOWER(p.name) LIKE ? OR LOWER(c.name) LIKE ? OR LOWER(s.name) LIKE ? OR LOWER(b.name) LIKE ? OR LOWER(p.image_url) LIKE ?)');
        const searchPattern = `%${search.toLowerCase()}%`;
        queryParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
      }
    }

    if (categoryId > 0) {
      whereConditions.push('p.category_id = ?');
      queryParams.push(categoryId);
    }

    if (subCategoryId > 0) {
      whereConditions.push('p.sub_category_id = ?');
      queryParams.push(subCategoryId);
    }

    if (brandName) {
      whereConditions.push('LOWER(b.name) = LOWER(?)');
      queryParams.push(brandName);
    }

    if (imageType) {
      if (imageType === 'main' || imageType === 'main_image') {
        whereConditions.push("(p.image_url IS NOT NULL AND p.image_url <> '' AND p.image_url <> '/default.png')");
      } else if (imageType === 'default' || imageType === 'placeholder') {
        whereConditions.push("(p.image_url IS NULL OR p.image_url = '' OR p.image_url = '/default.png')");
      }
    }

    const whereSql = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const [countRows] = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN sub_categories s ON s.id = p.sub_category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       ${whereSql}`,
      queryParams
    );

    const totalItems = Number(countRows && countRows[0] ? (countRows[0].count || countRows[0]['count(*)'] || 0) : 0);
    const totalPages = Math.ceil(totalItems / limit) || 1;
    const offset = (page - 1) * limit;

    const [rows] = await pool.query(
      `SELECT p.id AS product_id,
              p.name AS product_name,
              p.description,
              p.price,
              p.weight_value,
              p.weight_unit,
              p.weight_kg,
              p.image_url,
              p.approval_status,
              p.category_id,
              c.name AS category_name,
              p.sub_category_id,
              s.name AS sub_category_name,
              p.brand_id,
              b.name AS brand_name,
              b.logo_path AS brand_logo
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN sub_categories s ON s.id = p.sub_category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       ${whereSql}
       ORDER BY p.id DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    const items = (rows || []).map((row) => {
      const img = row.image_url && row.image_url.trim() ? row.image_url.trim() : '/default.png';
      const isDefault = img === '/default.png' || img.includes('placeholder');
      const filename = img.split('/').pop() || 'default.png';

      return {
        id: row.product_id,
        product_id: row.product_id,
        product_name: row.product_name,
        description: row.description || '',
        price: Number(row.price || 0),
        weight: `${Number(row.weight_value || row.weight_kg || 0)} ${row.weight_unit || 'kg'}`,
        approval_status: row.approval_status || 'approved',
        category_id: row.category_id,
        category_name: row.category_name || 'Uncategorized',
        main_category: row.category_name || 'Uncategorized',
        sub_category_id: row.sub_category_id,
        sub_category_name: row.sub_category_name || 'Unassigned',
        brand_id: row.brand_id,
        brand_name: row.brand_name || 'Generic',
        brand_logo: row.brand_logo || '',
        image_url: img,
        filename: filename,
        image_type: isDefault ? 'Default Placeholder' : 'Main Image',
        is_default: isDefault,
      };
    });

    return res.json({
      success: true,
      items,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
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
    const ids = req.body && Array.isArray(req.body.ids) ? req.body.ids.map((id) => parseInt(id, 10)).filter(Boolean) : [];
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
