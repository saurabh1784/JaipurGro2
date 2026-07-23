const http = require('http');
const https = require('https');
const path = require('path');
const xlsx = require('xlsx');
const Catalog = require('../models/Catalog');
const Product = require('../models/Product');
const ProductSearch = require('../models/ProductSearch');
const VendorProduct = require('../models/VendorProduct');
const { processImageBuffer, processUploadedFile, deleteLocalImageFile } = require('../services/imageProcessingService');

function wantsJson(req) {
  return req.baseUrl.startsWith('/api') || req.query.format === 'json' || req.accepts(['html', 'json']) === 'json';
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeWeightUnit(value) {
  const unit = String(value || 'kg').trim();
  if (!unit) return 'kg';
  const lower = unit.toLowerCase();
  if (['gram', 'grams', 'g'].includes(lower)) return 'g';
  if (['kilogram', 'kilograms', 'kg'].includes(lower)) return 'kg';
  if (['liter', 'liters', 'litre', 'litres', 'l'].includes(lower)) return 'L';
  if (['milliliter', 'milliliters', 'millilitre', 'millilitres', 'ml'].includes(lower)) return 'ml';
  return unit.slice(0, 20);
}

function weightToKg(value, unit, fallbackKg) {
  const amount = toNumber(value);
  if (!Number.isFinite(amount) || amount < 0) return NaN;
  const normalizedUnit = normalizeWeightUnit(unit);
  if (normalizedUnit === 'g' || normalizedUnit === 'ml') return amount / 1000;
  if (normalizedUnit === 'kg' || normalizedUnit === 'L') return amount;
  const fallback = fallbackKg === undefined || fallbackKg === '' ? NaN : toNumber(fallbackKg);
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : amount;
}

function normalizeId(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hasSponsoredPayload(body) {
  return [
    'is_sponsored',
    'sponsored',
    'featured',
    'boosted',
    'sponsored_priority',
    'priority_order',
    'priority',
    'boost_priority',
  ].some((key) => Object.prototype.hasOwnProperty.call(body, key));
}

function sponsoredPayload(body, fallbackIsSponsored = false) {
  return {
    isSponsored: ProductSearch.toSponsoredFlag(
      body.is_sponsored ?? body.sponsored ?? body.featured ?? body.boosted ?? fallbackIsSponsored
    ),
    priorityOrder:
      body.sponsored_priority ??
      body.priority_order ??
      body.priority ??
      body.boost_priority ??
      0,
  };
}

function validateProductPayload(body) {
  const errors = [];
  const name = body.name && String(body.name).trim();
  const price = toNumber(body.price);
  const hasWeightValue = body.weight_value !== undefined && body.weight_value !== '';
  const weightValue = hasWeightValue ? toNumber(body.weight_value) : (body.weight_kg === undefined || body.weight_kg === '' ? 0 : toNumber(body.weight_kg));
  const weightUnit = normalizeWeightUnit(body.weight_unit || (hasWeightValue ? 'kg' : 'kg'));
  const weightKg = weightToKg(weightValue, weightUnit, body.weight_kg);
  const category_id = normalizeId(body.category_id);
  const sub_category_id = normalizeId(body.sub_category_id || body.subcategory_id);
  const brand_id = normalizeId(body.brand_id);
  const taxName = body.tax_name === undefined ? '' : String(body.tax_name || '').trim();
  const taxPercentage = body.tax_percentage === undefined || body.tax_percentage === '' ? null : toNumber(body.tax_percentage);

  if (!name || name.length < 2) errors.push('Name must be at least 2 characters');
  if (!Number.isFinite(price) || price < 0) errors.push('Price must be a valid non-negative number');
  if (!Number.isFinite(weightValue) || weightValue < 0 || !Number.isFinite(weightKg) || weightKg < 0) errors.push('Weight must be a valid non-negative number');
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
      weight_value: weightValue,
      weight_unit: weightUnit,
      weight_kg: weightKg,
      tax_name: taxName,
      tax_percentage: taxPercentage,
      image_url: body.image_url ? String(body.image_url).trim() : null,
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
      approval_status: req.query.approval_status,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Product list error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch products' });
  }
}

async function updateApprovalStatus(req, res) {
  const id = normalizeId(req.params.id);
  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid product ID is required' });
  }

  const existing = await Product.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  const status = String(req.body.status || '').trim().toLowerCase();
  const actor = req.authUser || (req.session && req.session.user) || {};
  try {
    await Product.updateApprovalStatus(id, {
      status,
      actor_id: actor.id,
      rejection_reason: req.body.rejection_reason || req.body.reason || '',
    });
    if (status === 'approved') {
      await VendorProduct.ensureProductForAllVendors(id);
    }
    const product = await Product.findById(id);
    await notifyProductRequester(product, status);
    return res.json({ success: true, message: 'Product approval status updated', product });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to update product approval status',
    });
  }
}

async function notifyProductRequester(product, status) {
  if (!product || !product.created_by_vendor_id || !['approved', 'rejected', 'in_review'].includes(status)) return;
  try {
    const title = status === 'approved'
      ? 'Product request approved'
      : status === 'rejected'
        ? 'Product request rejected'
        : 'Product request in review';
    const message = status === 'rejected' && product.rejection_reason
      ? `${product.name}: ${product.rejection_reason}`
      : `${product.name} is now ${status.replace('_', ' ')}`;
    await require('../db').query(
      `INSERT INTO user_notifications (user_id, title, message, link)
       VALUES (?, ?, ?, ?)`,
      [product.created_by_vendor_id, title, message, '/vendor-products']
    );
  } catch (error) {
    console.warn('Product request notification failed:', error.message);
  }
}

async function resolveProductImage(file, imageUrlInput, baseName, existingImagePath = null) {
  let imagePath = await processUploadedFile(file, 'product', baseName);

  if (!imagePath && imageUrlInput && typeof imageUrlInput === 'string' && imageUrlInput.trim()) {
    const rawUrl = imageUrlInput.trim();
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      try {
        const downloaded = await downloadImage(rawUrl);
        const processed = await processImageBuffer(downloaded.buffer, 'product', baseName);
        imagePath = processed.path;
      } catch (err) {
        console.error(`Unable to download product image from URL ${rawUrl}:`, err.message);
      }
    } else if (rawUrl.startsWith('/uploads/')) {
      imagePath = rawUrl;
    }
  }

  if (imagePath && existingImagePath && existingImagePath !== imagePath) {
    deleteLocalImageFile(existingImagePath);
  }

  return imagePath;
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
    const imageUrlInput = req.body.image_url || req.body.imageUrl || req.body.image_link;
    data.image_url = await resolveProductImage(req.file, imageUrlInput, data.name);
    const id = await Product.create(data);
    if (hasSponsoredPayload(req.body)) {
      const payload = sponsoredPayload(req.body);
      await ProductSearch.setSponsored({
        productId: id,
        isSponsored: payload.isSponsored,
        priorityOrder: payload.priorityOrder,
      });
    }
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

  const imageUrlInput = req.body.image_url || req.body.imageUrl || req.body.image_link;
  const newImage = await resolveProductImage(req.file, imageUrlInput, data.name, existing.image_url);
  if (newImage) data.image_url = newImage;
  await Product.update(id, data);

  if (hasSponsoredPayload(req.body)) {
    const payload = sponsoredPayload(req.body, existing.is_sponsored);
    await ProductSearch.setSponsored({
      productId: id,
      isSponsored: payload.isSponsored,
      priorityOrder: payload.priorityOrder,
    });
  }
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
  for (const key of Object.keys(row || {})) {
    const cleanKey = String(key)
      .replace(/^\uFEFF/, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
    lookup[cleanKey] = row[key];
  }
  for (const name of names) {
    const targetKey = String(name)
      .replace(/^\uFEFF/, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
    const value = lookup[targetKey];
    if (value !== undefined && String(value).trim() !== '') return value;
  }
  return '';
}

function bulkRowIdentifier(row) {
  const id = String(getCell(row, ['product id or sku', 'product id', 'product_id', 'sku', 'id', 'code'])).trim();
  const name = String(getCell(row, ['name', 'product name'])).trim();
  return id || name || '';
}

function normalizeRowForClient(row) {
  const normalized = {};
  for (const key of Object.keys(row || {})) {
    const cleanKey = String(key).replace(/^\uFEFF/, '').trim();
    if (!cleanKey.startsWith('__EMPTY')) {
      normalized[cleanKey] = row[key];
    }
  }
  return normalized;
}
function activeFromUpload(value) {
  const text = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (!text) return true;
  return !['inactive', 'false', '0', 'no', 'n', 'disabled'].includes(text);
}

function catalogCode(value) {
  return Catalog.slugify(String(value || '').replace(/\.[^.]+$/, ''));
}

function mapCatalogByCategory(items, categoryId) {
  const map = new Map();
  for (const item of items.filter((entry) => Number(entry.category_id) === Number(categoryId))) {
    for (const key of [item.name, item.slug]) {
      const normalized = catalogCode(key);
      if (normalized) map.set(normalized, item);
    }
  }
  return map;
}

function mapBrandsByCategory(items, categoryId) {
  const map = new Map();
  for (const item of items.filter((entry) => Number(entry.category_id) === Number(categoryId))) {
    for (const key of [item.name, item.slug]) {
      const normalized = catalogCode(key);
      if (normalized) {
        map.set(`${item.sub_category_id || item.subcategory_id}:${normalized}`, item);
        map.set(`category:${normalized}`, item);
      }
    }
  }
  return map;
}

async function ensureSmartSubcategory({ row, rowNumber, category, subcategoryMap, report }) {
  const name = String(getCell(row, ['subcategory', 'sub category', 'subcategory name', 'sub_category'])).trim();
  const code = String(getCell(row, ['subcategory_code', 'sub category code', 'sub_category_code', 'subcategory slug', 'subcategory_slug'])).trim();
  const key = catalogCode(code || name);
  const byName = catalogCode(name);
  const existing = subcategoryMap.get(key) || subcategoryMap.get(byName);
  if (existing) return existing;
  if (!name || name.length < 2) {
    const error = new Error('Subcategory is required and must be at least 2 characters');
    error.validation = true;
    throw error;
  }


  const id = await Catalog.createSubcategory({
    category_id: category.id,
    name,
    slug: code || name,
    image_path: null,
    is_active: activeFromUpload(getCell(row, ['subcategory_status', 'sub category status'])),
  });
  const created = { id, category_id: category.id, category_name: category.name, name, slug: Catalog.slugify(code || name), image_path: '' };
  subcategoryMap.set(catalogCode(name), created);
  subcategoryMap.set(catalogCode(code || name), created);
  report.new_subcategories_created.push({ rowNumber, id, name, code: created.slug });
  return created;
}

async function ensureSmartBrand({ row, rowNumber, category, subcategory, brandMap, report }) {
  const name = String(getCell(row, ['brand', 'brand name', 'brand_name'])).trim();
  const code = String(getCell(row, ['brand_code', 'brand code', 'brand slug', 'brand_slug'])).trim();
  const key = `${subcategory.id}:${catalogCode(code || name)}`;
  const byName = `${subcategory.id}:${catalogCode(name)}`;
  const existing = brandMap.get(key) || brandMap.get(byName);
  if (existing) return existing;

  const categoryExisting = brandMap.get(`category:${catalogCode(code || name)}`) || brandMap.get(`category:${catalogCode(name)}`);
  if (categoryExisting) return categoryExisting;

  if (!name || name.length < 2) {
    const error = new Error('Brand is required and must be at least 2 characters');
    error.validation = true;
    throw error;
  }



  const id = await Catalog.createBrand({
    category_id: category.id,
    sub_category_id: subcategory.id,
    name,
    slug: code || name,
    logo_path: null,
    is_active: activeFromUpload(getCell(row, ['brand_status', 'brand status'])),
  });
  const created = { id, category_id: category.id, sub_category_id: subcategory.id, subcategory_id: subcategory.id, name, slug: Catalog.slugify(code || name), logo_path: '' };
  brandMap.set(`${subcategory.id}:${catalogCode(name)}`, created);
  brandMap.set(`${subcategory.id}:${catalogCode(code || name)}`, created);
  brandMap.set(`category:${catalogCode(name)}`, created);
  brandMap.set(`category:${catalogCode(code || name)}`, created);
  report.new_brands_created.push({ rowNumber, id, name, code: created.slug, subcategory: subcategory.name });
  return created;
}

async function normalizeSmartBulkRow({ row, rowNumber, category, subcategoryMap, brandMap, report }) {
  const subcategory = await ensureSmartSubcategory({ row, rowNumber, category, subcategoryMap, report });
  const brand = await ensureSmartBrand({ row, rowNumber, category, subcategory, brandMap, report });
  const product = {
    name: String(getCell(row, ['name', 'product name'])).trim(),
    description: String(getCell(row, ['description', 'desc'])).trim(),
    price: getCell(row, ['price']),
    weight_value: getCell(row, ['weight_value', 'weight value', 'weight', 'weight_kg', 'weight kg', 'kg']),
    weight_unit: getCell(row, ['weight_unit', 'weight unit', 'unit']),
    weight_kg: getCell(row, ['weight_kg', 'weight kg']),
    tax_name: String(getCell(row, ['tax_name', 'tax name', 'gst name'])).trim(),
    tax_percentage: getCell(row, ['tax_percentage', 'tax percentage', 'gst percentage', 'gst %']),
    image_url: String(getCell(row, ['image_url', 'image url', 'product_image_url', 'product image url'])).trim(),
    category_id: category.id,
    sub_category_id: subcategory.id,
    brand_id: brand.id,
  };


  const { errors, data } = validateProductPayload(product);
  if (errors.length) return { rowNumber, errors };

  return { rowNumber, data };
}
function csvEscape(value) {
  const text = String(value === null || value === undefined ? '' : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvResponse(res, filename, rows) {
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(csv);
}

function safeFileBase(value) {
  return String(value || 'product')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'product';
}

function imageExtensionFromContentType(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (type === 'image/jpeg' || type === 'image/jpg') return '.jpg';
  if (type === 'image/png') return '.png';
  if (type === 'image/webp') return '.webp';
  return '';
}

function imageExtensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const extension = path.extname(pathname);
    return ['.jpg', '.jpeg', '.png', '.webp'].includes(extension) ? extension : '';
  } catch (error) {
    return '';
  }
}

function imageExtensionFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return '';
}

function downloadImage(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(new Error('Invalid URL'));
      return;
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      reject(new Error('Only HTTP and HTTPS image URLs are supported'));
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.get(parsed, { timeout: 15000 }, (response) => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirectCount >= 3) {
          reject(new Error('Too many redirects'));
          return;
        }
        const nextUrl = new URL(response.headers.location, parsed).toString();
        downloadImage(nextUrl, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Download returned HTTP ${status}`));
        return;
      }

      const chunks = [];
      let total = 0;
      const maxBytes = 5 * 1024 * 1024;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          request.destroy(new Error('Image is larger than 5 MB'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: response.headers['content-type'] || '' }));
    });

    request.on('timeout', () => request.destroy(new Error('Download timed out')));
    request.on('error', reject);
  });
}

async function downloadImageToProduct(product, sourceUrl, rowNumber) {
  const downloaded = await downloadImage(sourceUrl);
  const contentTypeExtension = imageExtensionFromContentType(downloaded.contentType);
  const urlExtension = imageExtensionFromUrl(sourceUrl);
  const bufferExtension = imageExtensionFromBuffer(downloaded.buffer);
  const extension = bufferExtension || contentTypeExtension || urlExtension;
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    const error = new Error('URL did not return a supported JPG, JPEG, PNG, or WebP image');
    error.invalidImage = true;
    throw error;
  }

  const processed = await processImageBuffer(downloaded.buffer, 'product', `${product.name}-${product.id}-${rowNumber}`);
  return processed.path;
}

async function downloadImageTemplate(req, res) {
  try {
    const products = await Product.listForImageTemplate();
    const rows = [['Product ID', 'Product Name', 'Brand Name', 'Weight', 'Current Image URL', 'Image URL']];
    for (const product of products) {
      rows.push([product.id, product.name, product.brand_name || '', product.weight_label || '', product.image_url || '', '']);
    }
    return csvResponse(res, 'product-image-upload-template.csv', rows);
  } catch (error) {
    console.error('Product image template error:', error);
    return res.status(500).json({ success: false, message: 'Unable to download image upload template' });
  }
}

async function bulkImageUpload(req, res) {
  if (!req.file) {
    return res.status(422).json({ success: false, message: 'CSV file is required' });
  }

  let rows = [];
  try {
    rows = readRowsFromWorkbook(req.file.buffer);
  } catch (error) {
    return res.status(422).json({ success: false, message: 'Unable to read uploaded CSV file' });
  }

  if (!rows.length) {
    return res.status(422).json({ success: 422, message: 'Upload file has no image rows' });
  }

  const result = {
    successful_uploads: [],
    invalid_image_urls: [],
    failed_downloads: [],
    products_not_found: [],
    skipped_or_duplicates: [],
  };
  const seenProductKeys = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 2;
    const rowData = normalizeRowForClient(rows[index]);

    const rawIdentifier = getCell(rows[index], ['product id or sku', 'product id', 'sku', 'id', 'product_id', 'code', 'product code']);
    const identifier = rawIdentifier !== null && rawIdentifier !== undefined ? String(rawIdentifier).trim() : '';

    const rawName = getCell(rows[index], ['product name', 'name', 'product_name']);
    const productName = rawName !== null && rawName !== undefined ? String(rawName).trim() : '';

    const sourceUrl = String(getCell(rows[index], ['image url', 'image_url', 'url'])).trim();

    if (!identifier && !productName) {
      result.skipped_or_duplicates.push({
        rowNumber,
        reason: 'Product ID/SKU and Product Name are both missing or empty',
        row: rowData,
      });
      continue;
    }

    const lookupKey = identifier ? identifier.toLowerCase() : `name:${productName.toLowerCase()}`;
    if (seenProductKeys.has(lookupKey)) {
      result.skipped_or_duplicates.push({
        rowNumber,
        identifier: identifier || productName,
        reason: `Duplicate product record '${identifier || productName}' in upload file`,
        row: rowData,
      });
      continue;
    }
    seenProductKeys.add(lookupKey);

    if (!sourceUrl) {
      result.skipped_or_duplicates.push({
        rowNumber,
        identifier: identifier || productName,
        reason: 'Image URL is missing or empty',
        row: rowData,
      });
      continue;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(sourceUrl);
    } catch (error) {
      result.invalid_image_urls.push({
        rowNumber,
        identifier: identifier || productName,
        image_url: sourceUrl,
        reason: `Invalid image URL format: '${sourceUrl}'`,
        row: rowData,
      });
      continue;
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      result.invalid_image_urls.push({
        rowNumber,
        identifier: identifier || productName,
        image_url: sourceUrl,
        reason: 'Only HTTP and HTTPS image URLs are supported',
        row: rowData,
      });
      continue;
    }

    let product = null;
    if (identifier) {
      product = await Product.findByIdOrSku(identifier);
    } else if (productName) {
      product = await Product.findByName(productName);
    }

    if (!product) {
      result.products_not_found.push({
        rowNumber,
        identifier: identifier || productName,
        reason: `Product with ID/SKU '${identifier || productName}' does not exist in database`,
        row: rowData,
      });
      continue;
    }

    try {
      const savedPath = await downloadImageToProduct(product, sourceUrl, rowNumber);
      if (product.image_url && product.image_url !== savedPath) {
        deleteLocalImageFile(product.image_url);
      }
      await Product.updateImage(product.id, savedPath);
      result.successful_uploads.push({
        rowNumber,
        product_id: product.id,
        product_name: product.name,
        previous_image_url: product.image_url || '',
        image_url: savedPath,
        action: product.image_url && product.image_url !== '/default.png' ? 'updated' : 'uploaded',
      });
    } catch (error) {
      const bucket = error.invalidImage ? result.invalid_image_urls : result.failed_downloads;
      bucket.push({
        rowNumber,
        identifier: identifier || productName,
        image_url: sourceUrl,
        reason: error.message || 'Failed to download or save image',
        row: rowData,
      });
    }
  }

  const uploadedCount = result.successful_uploads.length;
  const issueCount = result.invalid_image_urls.length
    + result.failed_downloads.length
    + result.products_not_found.length
    + result.skipped_or_duplicates.length;

  return res.status(uploadedCount ? 200 : 422).json({
    success: issueCount === 0,
    message: `${uploadedCount} image(s) uploaded${issueCount ? `, ${issueCount} row(s) need attention` : ''}`,
    ...result,
  });
}
async function bulkUpload(req, res) {
  const categoryId = normalizeId(req.body.category_id || req.body.categoryId);
  if (!categoryId) {
    return res.status(422).json({ success: false, message: 'Select a valid main category before uploading products' });
  }
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

  const [categories, subcategories, brands] = await Promise.all([
    Catalog.listCategories(),
    Catalog.listSubcategories(),
    Catalog.listBrands(),
  ]);
  const category = categories.find((item) => Number(item.id) === Number(categoryId));
  if (!category) {
    return res.status(422).json({ success: false, message: 'Selected main category was not found' });
  }

  const subcategoryMap = mapCatalogByCategory(subcategories, category.id);
  const brandMap = mapBrandsByCategory(brands, category.id);
  const created = [];
  const failed = [];
  const duplicateProducts = [];
  const imageWarnings = [];
  const backgroundImageJobs = [];
  const seenProductKeys = new Set();

  const report = {
    new_subcategories_created: [],
    new_brands_created: [],
    images_uploaded: [],
  };

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 2;
    const rowData = normalizeRowForClient(row);

    let normalized;
    try {
      normalized = await normalizeSmartBulkRow({
        row,
        rowNumber,
        category,
        subcategoryMap,
        brandMap,
        report,
      });
    } catch (error) {
      failed.push({
        rowNumber,
        identifier: bulkRowIdentifier(row),
        errors: [error.message || 'Unable to prepare product row'],
        row: rowData,
      });
      continue;
    }

    if (normalized.errors) {
      failed.push({
        ...normalized,
        identifier: bulkRowIdentifier(row),
        row: rowData,
      });
      continue;
    }

    const productKey = [
      normalized.data.category_id,
      normalized.data.sub_category_id,
      normalized.data.brand_id,
      String(normalized.data.name || '').trim().toLowerCase(),
    ].join('::');
    if (seenProductKeys.has(productKey)) {
      duplicateProducts.push({ rowNumber, identifier: normalized.data.name, reason: 'Duplicate product row in upload file', row: rowData });
      continue;
    }
    seenProductKeys.add(productKey);

    const duplicate = await Product.findDuplicate(normalized.data);
    if (duplicate) {
      duplicateProducts.push({ rowNumber, identifier: normalized.data.name, product_id: duplicate.id, reason: 'Product already exists in selected category, subcategory, and brand', row: rowData });
      continue;
    }

    const imageUrl = String(getCell(row, ['image_url', 'image url', 'product_image_url', 'product image url'])).trim();
    let imageWarning = null;
    if (imageUrl) {
      let parsedUrl = null;
      try {
        parsedUrl = new URL(imageUrl);
      } catch (error) {
        imageWarning = 'Invalid image URL format';
      }
      if (!imageWarning && !['http:', 'https:'].includes(parsedUrl.protocol)) {
        imageWarning = 'Only HTTP and HTTPS image URLs are supported';
      }
    }

    try {

      const id = await Product.create(normalized.data);
      const uploaded = { id, rowNumber, identifier: normalized.data.name, image_url: normalized.data.image_url || imageUrl || '/default.png' };
      if (imageUrl && !imageWarning) {
        backgroundImageJobs.push({ id, name: normalized.data.name, imageUrl, rowNumber });
      }
      created.push(uploaded);
    } catch (error) {
      failed.push({
        rowNumber: normalized.rowNumber,
        identifier: normalized.data.name,
        errors: [error.message || 'Unable to save product'],
        row: rowData,
      });
    }
  }

  if (created.length) {
    await VendorProduct.ensureAllProductsForAllVendors();
  }

  if (backgroundImageJobs.length > 0) {
    setImmediate(async () => {
      for (const job of backgroundImageJobs) {
        try {
          const savedPath = await downloadImageToProduct({ id: job.id, name: job.name, image_url: '' }, job.imageUrl, job.rowNumber);
          if (savedPath) {
            await Product.updateImage(job.id, savedPath);
          }
        } catch (error) {
          // Ignore background download errors as product already has valid external image_url stored
        }
      }
    });
  }

  const issueCount = failed.length + duplicateProducts.length + imageWarnings.length;
  const statusCode = created.length ? 201 : (failed.length ? 422 : 200);
  return res.status(statusCode).json({
    success: failed.length === 0,
    message: `${created.length} product(s) uploaded successfully, ${report.new_subcategories_created.length} subcategor${report.new_subcategories_created.length === 1 ? 'y' : 'ies'} created, ${report.new_brands_created.length} brand(s) created${backgroundImageJobs.length ? `, ${backgroundImageJobs.length} image(s) downloading in background` : ''}${issueCount ? `, ${issueCount} item(s) need attention` : ''}`,
    created_count: created.length,
    total_products_uploaded: created.length,
    new_subcategories_count: report.new_subcategories_created.length,
    new_brands_count: report.new_brands_created.length,
    images_uploaded_count: report.images_uploaded.length,
    duplicate_products_skipped_count: duplicateProducts.length,
    created,
    new_subcategories_created: report.new_subcategories_created,
    new_brands_created: report.new_brands_created,
    images_uploaded: report.images_uploaded,
    duplicate_products_skipped: duplicateProducts,
    image_warnings: imageWarnings,
    failed,
    products_not_uploaded: failed,
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
    const payload = sponsoredPayload(req.body);
    await ProductSearch.setSponsored({
      productId: id,
      isSponsored: payload.isSponsored,
      priorityOrder: payload.priorityOrder,
    });
    return res.json({ success: true, message: 'Search settings updated', product: await Product.findById(id) });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to update search settings',
    });
  }
}

async function setFeatured(req, res) {
  const id = normalizeId(req.params.id);
  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid product ID is required' });
  }

  const existing = await Product.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  const payload = sponsoredPayload(req.body);

  try {
    await ProductSearch.setSponsored({
      productId: id,
      isSponsored: payload.isSponsored,
      priorityOrder: payload.priorityOrder,
    });
    return res.json({
      success: true,
      message: payload.isSponsored ? 'Product boosted as sponsored' : 'Product removed from sponsored',
      product: await Product.findById(id),
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to update featured status',
    });
  }
}

async function sponsoredIndex(req, res) {
  try {
    const activeOnly = req.query.active === undefined
      ? true
      : ProductSearch.toSponsoredFlag(req.query.active);
    const sponsoredProducts = await ProductSearch.listSponsored({
      activeOnly,
      limit: req.query.limit,
    });
    return res.json({
      success: true,
      sponsored_products: sponsoredProducts,
      products: sponsoredProducts,
    });
  } catch (error) {
    console.error('Sponsored product list error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch sponsored products' });
  }
}

async function sponsoredShow(req, res) {
  const id = normalizeId(req.params.id);
  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid product ID is required' });
  }

  const existing = await Product.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  return res.json({
    success: true,
    sponsored_product: await ProductSearch.getSponsored(id),
    product: existing,
  });
}

async function sponsoredUpdate(req, res) {
  const id = normalizeId(req.params.id);
  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid product ID is required' });
  }

  const existing = await Product.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  const payload = sponsoredPayload(req.body);
  try {
    const sponsoredProduct = await ProductSearch.setSponsored({
      productId: id,
      isSponsored: payload.isSponsored,
      priorityOrder: payload.priorityOrder,
    });
    return res.json({
      success: true,
      message: sponsoredProduct.is_sponsored ? 'Sponsored product saved' : 'Sponsored product disabled',
      sponsored_product: sponsoredProduct,
      product: await Product.findById(id),
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to save sponsored product',
    });
  }
}

async function sponsoredCreate(req, res) {
  const id = normalizeId(req.body.product_id || req.body.id);
  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid product ID is required' });
  }

  req.params.id = id;
  if (
    req.body.is_sponsored === undefined &&
    req.body.sponsored === undefined &&
    req.body.featured === undefined &&
    req.body.boosted === undefined
  ) {
    req.body.is_sponsored = true;
  }
  return sponsoredUpdate(req, res);
}

async function sponsoredDelete(req, res) {
  const id = normalizeId(req.params.id);
  if (!id) {
    return res.status(422).json({ success: false, message: 'Valid product ID is required' });
  }

  const existing = await Product.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  try {
    const sponsoredProduct = await ProductSearch.setSponsored({
      productId: id,
      isSponsored: false,
      priorityOrder: 0,
    });
    return res.json({
      success: true,
      message: 'Sponsored product disabled',
      sponsored_product: sponsoredProduct,
      product: await Product.findById(id),
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to disable sponsored product',
    });
  }
}

module.exports = {
  index,
  create,
  update,
  updateApprovalStatus,
  destroy,
  bulkUpload,
  downloadImageTemplate,
  bulkImageUpload,
  catalog,
  updateSearchSettings,
  setFeatured,
  sponsoredIndex,
  sponsoredCreate,
  sponsoredShow,
  sponsoredUpdate,
  sponsoredDelete,
};
