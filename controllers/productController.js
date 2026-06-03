const xlsx = require('xlsx');
const Catalog = require('../models/Catalog');
const Product = require('../models/Product');
const ProductSearch = require('../models/ProductSearch');
const VendorProduct = require('../models/VendorProduct');
const { productImagePath } = require('../middleware/productImageUpload');

function wantsJson(req) {
  return req.baseUrl.startsWith('/api') || req.query.format === 'json' || req.accepts(['html', 'json']) === 'json';
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeId(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function validateProductPayload(body) {
  const errors = [];
  const name = body.name && String(body.name).trim();
  const price = toNumber(body.price);
  const category_id = normalizeId(body.category_id);
  const sub_category_id = normalizeId(body.sub_category_id || body.subcategory_id);
  const brand_id = normalizeId(body.brand_id);
  const taxName = body.tax_name === undefined ? '' : String(body.tax_name || '').trim();
  const taxPercentage = body.tax_percentage === undefined || body.tax_percentage === '' ? null : toNumber(body.tax_percentage);

  if (!name || name.length < 2) errors.push('Name must be at least 2 characters');
  if (!Number.isFinite(price) || price < 0) errors.push('Price must be a valid non-negative number');
  if (!category_id) errors.push('Category is required');
  if (!sub_category_id) errors.push('Subcategory is required');
  if (!brand_id) errors.push('Brand is required');
  if (taxPercentage !== null && (!Number.isFinite(taxPercentage) || taxPercentage < 0 || taxPercentage > 100)) {
    errors.push('Tax percentage must be between 0 and 100');
  }

  return {
    errors,
    data: {
      name,
      description: body.description ? String(body.description).trim() : '',
      price,
      tax_name: taxName,
      tax_percentage: taxPercentage,
      category_id,
      sub_category_id,
      brand_id,
    },
  };
}

async function index(req, res) {
  if (!wantsJson(req)) {
    return res.render('products', {
      user: req.session.user,
    });
  }

  try {
    const result = await Product.list({
      page: req.query.page,
      limit: req.query.limit,
      name: req.query.name,
      category_id: req.query.category_id,
      sub_category_id: req.query.sub_category_id || req.query.subcategory_id,
      brand_id: req.query.brand_id,
      brand_name: req.query.brand_name,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Product list error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch products' });
  }
}

async function create(req, res) {
  const { errors, data } = validateProductPayload(req.body);
  if (errors.length) {
    return res.status(422).json({ success: false, message: 'Validation failed', errors });
  }

  if (!(await Product.validateRelation(data))) {
    return res.status(422).json({ success: false, message: 'Selected category, subcategory, and brand do not match' });
  }

  try {
    data.image_url = productImagePath(req.file);
    const id = await Product.create(data);
    await VendorProduct.ensureProductForAllVendors(id);
    const product = await Product.findById(id);
    return res.status(201).json({ success: true, message: 'Product created', product });
  } catch (error) {
    console.error('Product create error:', error);
    return res.status(500).json({ success: false, message: 'Unable to create product' });
  }
}

async function update(req, res) {
  const id = normalizeId(req.params.id);
  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid product ID is required' });
  }

  const existing = await Product.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  if (Object.keys(req.body).length === 1 && req.body.price !== undefined) {
    const price = toNumber(req.body.price);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(422).json({ success: false, message: 'Price must be a valid non-negative number' });
    }
    await Product.updatePrice(id, price);
    return res.json({ success: true, message: 'Price updated', product: await Product.findById(id) });
  }

  const { errors, data } = validateProductPayload(req.body);
  if (errors.length) {
    return res.status(422).json({ success: false, message: 'Validation failed', errors });
  }

  if (!(await Product.validateRelation(data))) {
    return res.status(422).json({ success: false, message: 'Selected category, subcategory, and brand do not match' });
  }

  const uploadedImage = productImagePath(req.file);
  if (uploadedImage) data.image_url = uploadedImage;
  await Product.update(id, data);
  return res.json({ success: true, message: 'Product updated', product: await Product.findById(id) });
}

async function destroy(req, res) {
  const id = normalizeId(req.params.id);
  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid product ID is required' });
  }

  const existing = await Product.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  await Product.softDelete(id);
  return res.json({ success: true, message: 'Product deleted' });
}

function readRowsFromWorkbook(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  return xlsx.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: '', raw: false });
}

function getCell(row, names) {
  const lookup = {};
  for (const key of Object.keys(row)) {
    lookup[String(key).trim().toLowerCase()] = row[key];
  }
  for (const name of names) {
    const value = lookup[name];
    if (value !== undefined && String(value).trim() !== '') return value;
  }
  return '';
}

async function normalizeBulkRow(row, rowNumber) {
  const categoryId = normalizeId(getCell(row, ['category_id', 'category id']));
  const subcategoryId = normalizeId(getCell(row, ['sub_category_id', 'subcategory_id', 'sub category id', 'subcategory id']));
  const brandId = normalizeId(getCell(row, ['brand_id', 'brand id']));
  const product = {
    name: String(getCell(row, ['name', 'product name'])).trim(),
    description: String(getCell(row, ['description', 'desc'])).trim(),
    price: getCell(row, ['price']),
    tax_name: String(getCell(row, ['tax_name', 'tax name', 'gst name'])).trim(),
    tax_percentage: getCell(row, ['tax_percentage', 'tax percentage', 'gst percentage', 'gst %']),
    category_id: categoryId,
    sub_category_id: subcategoryId,
    brand_id: brandId,
  };

  if (!product.category_id || !product.sub_category_id || !product.brand_id) {
    const relation = await Product.resolveRelation({
      category: String(getCell(row, ['category', 'category name'])).trim(),
      subcategory: String(getCell(row, ['subcategory', 'sub category', 'subcategory name'])).trim(),
      brand: String(getCell(row, ['brand', 'brand name'])).trim(),
    });
    if (relation) Object.assign(product, relation);
  }

  const { errors, data } = validateProductPayload(product);
  if (errors.length) return { rowNumber, errors };
  if (!(await Product.validateRelation(data))) {
    return { rowNumber, errors: ['Selected category, subcategory, and brand do not match'] };
  }
  return { rowNumber, data };
}

async function bulkUpload(req, res) {
  if (!req.file) {
    return res.status(422).json({ success: false, message: 'CSV or Excel file is required' });
  }

  let rows = [];
  try {
    rows = readRowsFromWorkbook(req.file.buffer);
  } catch (error) {
    return res.status(422).json({ success: false, message: 'Unable to read uploaded file' });
  }

  if (!rows.length) {
    return res.status(422).json({ success: false, message: 'Upload file has no product rows' });
  }

  const created = [];
  const failed = [];
  for (let index = 0; index < rows.length; index += 1) {
    const normalized = await normalizeBulkRow(rows[index], index + 2);
    if (normalized.errors) {
      failed.push(normalized);
      continue;
    }
    try {
      const id = await Product.create(normalized.data);
      created.push(id);
    } catch (error) {
      failed.push({ rowNumber: normalized.rowNumber, errors: ['Unable to save product'] });
    }
  }
  if (created.length) {
    await VendorProduct.ensureAllProductsForAllVendors();
  }

  return res.status(failed.length && !created.length ? 422 : 201).json({
    success: failed.length === 0,
    message: `${created.length} product(s) uploaded${failed.length ? `, ${failed.length} failed` : ''}`,
    created_count: created.length,
    failed,
  });
}

async function catalog(req, res) {
  try {
    const [categories, subcategories, brands] = await Promise.all([
      Catalog.listCategories(),
      Catalog.listSubcategories(),
      Catalog.listBrands(),
    ]);
    return res.json({ success: true, categories, subcategories, brands });
  } catch (error) {
    console.error('Product catalog error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load catalog' });
  }
}

async function updateSearchSettings(req, res) {
  const id = normalizeId(req.params.id);
  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid product ID is required' });
  }

  const existing = await Product.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  try {
    await ProductSearch.updateProductKeywords(id, req.body.keywords || req.body.tags || '');
    await ProductSearch.setSponsored({
      productId: id,
      isSponsored: req.body.is_sponsored === true || req.body.is_sponsored === 'true' || req.body.is_sponsored === 1 || req.body.is_sponsored === '1',
      priorityOrder: req.body.sponsored_priority || req.body.priority_order || 0,
    });
    return res.json({ success: true, message: 'Search settings updated', product: await Product.findById(id) });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to update search settings',
    });
  }
}

module.exports = {
  index,
  create,
  update,
  destroy,
  bulkUpload,
  catalog,
  updateSearchSettings,
};
