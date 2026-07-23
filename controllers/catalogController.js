const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const xlsx = require('xlsx');
const Catalog = require('../models/Catalog');
const { processImageBuffer, processUploadedFile, deleteLocalImageFile } = require('../services/imageProcessingService');

function parseActive(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function validateName(body, errors) {
  if (!body.name || String(body.name).trim().length < 2) {
    errors.push('Name must be at least 2 characters');
  }
}

function categoryIdFrom(body) {
  return body.category_id || body.categoryId;
}

function parseTaxPayload(body, errors) {
  const taxName = String(body.tax_name || '').trim();
  const hasTaxPercentage = body.tax_percentage !== undefined && body.tax_percentage !== '';
  const taxPercentage = hasTaxPercentage ? Number(body.tax_percentage) : null;
  if (hasTaxPercentage && (!Number.isFinite(taxPercentage) || taxPercentage < 0 || taxPercentage > 100)) {
    errors.push('Tax percentage must be between 0 and 100');
  }
  return { tax_name: taxName, tax_percentage: taxPercentage };
}

function duplicateResponse(res, error) {
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ success: false, message: 'Name already exists for this parent' });
  }
  return null;
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
    lookup[String(key).trim().toLowerCase()] = row[key];
  }
  for (const name of names) {
    const value = lookup[String(name).trim().toLowerCase()];
    if (value !== undefined && String(value).trim() !== '') return value;
  }
  return '';
}

function normalizeRowForClient(row) {
  const normalized = {};
  for (const key of Object.keys(row || {})) normalized[String(key).trim()] = row[key];
  return normalized;
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

function cleanName(value) {
  return String(value || '').trim();
}

function catalogKey(...parts) {
  return parts.map((part) => cleanName(part).toLowerCase()).join('::');
}

function activeFromUpload(value) {
  const text = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (!text) return true;
  return !['inactive', 'false', '0', 'no', 'n', 'disabled'].includes(text);
}


function subcategoryBulkTemplate(req, res) {
  return csvResponse(res, 'subcategory-bulk-upload-template.csv', [
    ['name', 'code', 'status', 'image_filename'],
    ['Rice', 'rice', 'active', 'rice.png'],
    ['Pulses', 'pulses', 'active', 'pulses.png'],
    ['Tea Coffee and Beverages', 'tea-coffee-and-beverages', 'active', 'tea-coffee-and-beverages.webp'],
  ]);
}

function brandBulkTemplate(req, res) {
  return csvResponse(res, 'brand-bulk-upload-template.csv', [
    ['subcategory', 'subcategory_code', 'name', 'code', 'status', 'image_filename'],
    ['Rice', 'rice', 'India Gate', 'india-gate', 'active', 'india-gate.png'],
    ['Rice', 'rice', 'Daawat', 'daawat', 'active', 'daawat.webp'],
    ['Pulses', 'pulses', 'Tata Sampann', 'tata-sampann', 'active', 'tata-sampann.jpg'],
  ]);
}

function normalizedKey(value) {
  return Catalog.slugify(String(value || '').replace(/\.[^.]+$/, ''));
}

function requireSelectedCategory(categories, value) {
  return selectedCategory(categories, value);
}

function summarizeBulkResult(res, type, created, skipped, failed, updated) {
  const createdCount = created.length;
  const updatedCount = updated ? updated.length : 0;
  const issueCount = skipped.length + failed.length;
  const noun = type === 'brand' ? 'brand' : 'subcategory';
  return res.status(createdCount || updatedCount || skipped.length ? 200 : 422).json({
    success: failed.length === 0,
    message: `${createdCount} ${noun}(s) created${updatedCount ? `, ${updatedCount} image(s) updated` : ''}${issueCount ? `, ${issueCount} item(s) need attention` : ''}`,
    created: type === 'brand' ? { brands: created } : { subcategories: created },
    updated: type === 'brand' ? { brands: updated || [] } : { subcategories: updated || [] },
    created_count: createdCount,
    updated_count: updatedCount,
    failed,
    skipped,
  });
}

async function bulkUploadSubcategories(req, res) {
  const [categories, existingSubcategories] = await Promise.all([
    Catalog.listCategories(),
    Catalog.listSubcategories(),
  ]);
  const category = requireSelectedCategory(categories, req.body.category_id || req.body.categoryId);
  if (!category) return res.status(422).json({ success: false, message: 'Select a valid main category first' });
  if (!req.file) return res.status(422).json({ success: false, message: 'Subcategory CSV file is required' });

  let rows = [];
  try {
    rows = readRowsFromWorkbook(req.file.buffer);
  } catch (error) {
    return res.status(422).json({ success: false, message: 'Unable to read uploaded subcategory file' });
  }
  if (!rows.length) return res.status(422).json({ success: false, message: 'Upload file has no subcategory rows' });

  const existingMap = new Map(existingSubcategories
    .filter((item) => Number(item.category_id) === Number(category.id))
    .flatMap((item) => [[normalizedKey(item.name), item], [normalizedKey(item.slug), item]].filter(([key]) => key)));
  const seenRows = new Set();
  const created = [];
  const skipped = [];
  const failed = [];

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 2;
    const row = rows[index];
    const rowData = normalizeRowForClient(row);
    const name = cleanName(getCell(row, ['name', 'subcategory', 'sub category', 'sub_category', 'subcategory name']));
    const code = cleanName(getCell(row, ['code', 'slug', 'subcategory_code', 'sub category code']));
    const statusValue = getCell(row, ['status', 'is_active', 'active']);
    const imageFilename = cleanName(getCell(row, ['image_filename', 'image filename', 'filename', 'image']));
    const uploadCode = code || imageFilename || name;
    const key = normalizedKey(uploadCode);
    const errors = [];
    if (!name || name.length < 2) errors.push('Subcategory name must be at least 2 characters');
    if (seenRows.has(key)) errors.push('Duplicate subcategory in upload file');
    if (existingMap.has(normalizedKey(name)) || (code && existingMap.has(normalizedKey(code)))) errors.push('Subcategory already exists in selected main category');
    if (errors.length) {
      failed.push({ rowNumber, identifier: name || code || '-', errors, row: rowData });
      continue;
    }
    seenRows.add(key);
    try {
      const id = await Catalog.createSubcategory({
        category_id: category.id,
        name,
        slug: uploadCode,
        is_active: activeFromUpload(statusValue),
      });
      const item = { rowNumber, id, name, category: category.name, code: Catalog.slugify(uploadCode) };
      existingMap.set(normalizedKey(name), item);
      existingMap.set(normalizedKey(uploadCode), item);
      created.push(item);
    } catch (error) {
      failed.push({ rowNumber, identifier: name || code || '-', errors: [error.code === 'ER_DUP_ENTRY' ? 'Subcategory already exists in selected main category' : (error.message || 'Unable to save subcategory')], row: rowData });
    }
  }

  return summarizeBulkResult(res, 'subcategory', created, skipped, failed);
}

async function bulkUploadBrands(req, res) {
  const [categories, subcategories, existingBrands] = await Promise.all([
    Catalog.listCategories(),
    Catalog.listSubcategories(),
    Catalog.listBrands(),
  ]);
  const category = requireSelectedCategory(categories, req.body.category_id || req.body.categoryId);
  if (!category) return res.status(422).json({ success: false, message: 'Select a valid main category first' });
  if (!req.file) return res.status(422).json({ success: false, message: 'Brand CSV file is required' });

  let rows = [];
  try {
    rows = readRowsFromWorkbook(req.file.buffer);
  } catch (error) {
    return res.status(422).json({ success: false, message: 'Unable to read uploaded brand file' });
  }
  if (!rows.length) return res.status(422).json({ success: false, message: 'Upload file has no brand rows' });

  const categorySubcategories = subcategories.filter((item) => Number(item.category_id) === Number(category.id));
  const subcategoryMap = new Map(categorySubcategories
    .flatMap((item) => [[normalizedKey(item.name), item], [normalizedKey(item.slug), item]].filter(([key]) => key)));
  const brandMap = new Map(existingBrands
    .filter((item) => Number(item.category_id) === Number(category.id))
    .map((item) => [catalogKey(item.sub_category_id || item.subcategory_id, item.name), item]));
  const seenRows = new Set();
  const created = [];
  const skipped = [];
  const failed = [];

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 2;
    const row = rows[index];
    const rowData = normalizeRowForClient(row);
    const subcategoryName = cleanName(getCell(row, ['subcategory', 'sub category', 'sub_category', 'subcategory name']));
    const subcategoryCode = cleanName(getCell(row, ['subcategory_code', 'sub category code', 'sub_category_code']));
    const name = cleanName(getCell(row, ['name', 'brand', 'brand name', 'brand_name']));
    const code = cleanName(getCell(row, ['code', 'slug', 'brand_code', 'brand code']));
    const statusValue = getCell(row, ['status', 'is_active', 'active']);
    const imageFilename = cleanName(getCell(row, ['image_filename', 'image filename', 'filename', 'image']));
    const uploadCode = code || imageFilename || name;
    const subcategory = subcategoryMap.get(normalizedKey(subcategoryCode || subcategoryName));
    const rowKey = catalogKey(subcategory ? subcategory.id : subcategoryCode || subcategoryName, uploadCode);
    const errors = [];
    if (!subcategoryName && !subcategoryCode) errors.push('Subcategory name or code is required');
    if (!subcategory) errors.push('Subcategory must exist under the selected main category');
    if (!name || name.length < 2) errors.push('Brand name must be at least 2 characters');
    if (seenRows.has(rowKey)) errors.push('Duplicate brand in upload file');
    if (subcategory && brandMap.has(catalogKey(subcategory.id, name))) errors.push('Brand already exists in this selected category/subcategory');
    if (errors.length) {
      failed.push({ rowNumber, identifier: [subcategoryName || subcategoryCode, name || code].filter(Boolean).join(' / ') || '-', errors, row: rowData });
      continue;
    }
    seenRows.add(rowKey);
    try {
      const id = await Catalog.createBrand({
        category_id: category.id,
        sub_category_id: subcategory.id,
        name,
        slug: uploadCode,
        is_active: activeFromUpload(statusValue),
      });
      const item = { rowNumber, id, name, category: category.name, subcategory: subcategory.name, code: Catalog.slugify(uploadCode) };
      brandMap.set(catalogKey(subcategory.id, name), item);
      created.push(item);
    } catch (error) {
      failed.push({ rowNumber, identifier: [subcategory.name, name].join(' / '), errors: [error.code === 'ER_DUP_ENTRY' ? 'Brand already exists in this selected category/subcategory' : (error.message || 'Unable to save brand')], row: rowData });
    }
  }

  return summarizeBulkResult(res, 'brand', created, skipped, failed);
}


async function imagePublicPath(type, file, itemName, index) {
  const preset = type === 'brand' ? 'brand' : 'subcategory';
  const processed = await processImageBuffer(file.buffer, preset, `${itemName || path.basename(file.originalname || 'image')}-${index}`);
  return processed.path;
}

function buildUniqueImageMatchMap(items) {
  const map = new Map();
  const add = (key, item) => {
    if (!key) return;
    const existing = map.get(key);
    if (existing && existing.id !== item.id) {
      map.set(key, { ambiguous: true, items: [existing, item] });
    } else if (!existing) {
      map.set(key, item);
    }
  };
  for (const item of items) {
    add(normalizedKey(item.name), item);
    add(normalizedKey(item.slug), item);
    add(normalizedKey(path.basename(item.image_filename || item.logo_filename || '', path.extname(item.image_filename || item.logo_filename || ''))), item);
  }
  return map;
}

async function bulkUploadSubcategoryImages(req, res) {
  const [categories, subcategories] = await Promise.all([Catalog.listCategories(), Catalog.listSubcategories()]);
  const category = requireSelectedCategory(categories, req.body.category_id || req.body.categoryId);
  if (!category) return res.status(422).json({ success: false, message: 'Select a valid main category first' });
  const files = req.files || [];
  if (!files.length) return res.status(422).json({ success: false, message: 'Select at least one subcategory image' });

  const matchMap = buildUniqueImageMatchMap(subcategories.filter((item) => Number(item.category_id) === Number(category.id)));
  const updated = [];
  const failed = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const filename = path.basename(file.originalname || '', path.extname(file.originalname || ''));
    const match = matchMap.get(normalizedKey(filename));
    if (!match) {
      failed.push({ rowNumber: index + 1, identifier: file.originalname, errors: ['No subcategory matched this image filename in the selected main category'] });
      continue;
    }
    if (match.ambiguous) {
      failed.push({ rowNumber: index + 1, identifier: file.originalname, errors: ['Image filename matches more than one subcategory; use a unique name or code'] });
      continue;
    }
    const imagePath = await imagePublicPath('subcategory', file, match.name, index + 1);
    await Catalog.updateSubcategoryImage(match.id, imagePath);
    updated.push({ rowNumber: index + 1, id: match.id, name: match.name, category: category.name, image_path: imagePath });
  }
  return summarizeBulkResult(res, 'subcategory', [], [], failed, updated);
}

async function bulkUploadBrandImages(req, res) {
  const [categories, brands] = await Promise.all([Catalog.listCategories(), Catalog.listBrands()]);
  const category = requireSelectedCategory(categories, req.body.category_id || req.body.categoryId);
  if (!category) return res.status(422).json({ success: false, message: 'Select a valid main category first' });
  const files = req.files || [];
  if (!files.length) return res.status(422).json({ success: false, message: 'Select at least one brand image' });

  const matchMap = buildUniqueImageMatchMap(brands.filter((item) => Number(item.category_id) === Number(category.id)));
  const updated = [];
  const failed = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const filename = path.basename(file.originalname || '', path.extname(file.originalname || ''));
    const match = matchMap.get(normalizedKey(filename));
    if (!match) {
      failed.push({ rowNumber: index + 1, identifier: file.originalname, errors: ['No brand matched this image filename in the selected main category'] });
      continue;
    }
    if (match.ambiguous) {
      failed.push({ rowNumber: index + 1, identifier: file.originalname, errors: ['Image filename matches more than one brand in the selected main category; use a unique brand name or code'] });
      continue;
    }
    const logoPath = await imagePublicPath('brand', file, match.name, index + 1);
    await Catalog.updateBrandLogo(match.id, logoPath);
    updated.push({ rowNumber: index + 1, id: match.id, name: match.name, category: category.name, subcategory: match.sub_category_name || match.subcategory_name || '', logo_path: logoPath });
  }
  return summarizeBulkResult(res, 'brand', [], [], failed, updated);
}

function downloadCatalogImage(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects while fetching image URL'));
      return;
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      const err = new Error('Invalid image URL format');
      err.invalidImage = true;
      reject(err);
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, timeout: 15000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const redirectUrl = new URL(res.headers.location, parsed).toString();
        downloadCatalogImage(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`Server returned status code ${res.statusCode}`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 10 * 1024 * 1024) {
          req.destroy(new Error('Image exceeds 10MB limit'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }));
    });
    req.on('timeout', () => req.destroy(new Error('Image download timed out')));
    req.on('error', reject);
  });
}

async function downloadSubcategoryImageTemplate(req, res) {
  try {
    const [subcategories, categories] = await Promise.all([Catalog.listSubcategories(), Catalog.listCategories()]);
    const catMap = new Map(categories.map((c) => [c.id, c.name]));
    const rows = [['SubCategory ID', 'SubCategory Name', 'Category Name', 'Current Image URL', 'Image URL']];
    for (const sub of subcategories) {
      rows.push([sub.id, sub.name, catMap.get(sub.category_id) || '', sub.image_path || sub.image_url || '', '']);
    }
    return csvResponse(res, 'subcategory-image-upload-template.csv', rows);
  } catch (error) {
    console.error('Subcategory image template error:', error);
    return res.status(500).json({ success: false, message: 'Unable to download subcategory image upload template' });
  }
}

async function bulkUploadSubcategoryImageUrls(req, res) {
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
    return res.status(422).json({ success: false, message: 'Upload file has no image rows' });
  }

  const result = { successful_uploads: [], invalid_image_urls: [], failed_downloads: [], items_not_found: [] };

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 2;
    const identifier = String(getCell(rows[index], ['subcategory id', 'sub_category_id', 'subcategory_id', 'id', 'subcategory'])).trim();
    const sourceUrl = String(getCell(rows[index], ['image url', 'image_url', 'url'])).trim();

    if (!identifier || !sourceUrl) continue;

    const subId = Number(identifier);
    const subcategory = await Catalog.findSubcategoryById(subId);
    if (!subcategory) {
      result.items_not_found.push({ rowNumber, identifier, reason: 'SubCategory not found' });
      continue;
    }

    try {
      const downloaded = await downloadCatalogImage(sourceUrl);
      const processed = await processImageBuffer(downloaded.buffer, 'subcategory', `subcategory-${subcategory.name}-${subcategory.id}-${rowNumber}`);
      
      if (subcategory.image_path) {
        deleteLocalImageFile(subcategory.image_path);
      }

      await Catalog.updateSubcategoryImage(subcategory.id, processed.path);
      result.successful_uploads.push({
        rowNumber,
        id: subcategory.id,
        name: subcategory.name,
        previous_image_url: subcategory.image_path || '',
        image_url: processed.path,
      });
    } catch (error) {
      result.failed_downloads.push({ rowNumber, identifier, image_url: sourceUrl, reason: error.message || 'Unable to download image' });
    }
  }

  return res.status(result.successful_uploads.length ? 200 : 422).json({
    success: result.failed_downloads.length === 0 && result.items_not_found.length === 0,
    message: `Processed ${result.successful_uploads.length} subcategory image updates.`,
    data: result,
  });
}

async function downloadBrandImageTemplate(req, res) {
  try {
    const [brands, categories, subcategories] = await Promise.all([Catalog.listBrands(), Catalog.listCategories(), Catalog.listSubcategories()]);
    const catMap = new Map(categories.map((c) => [c.id, c.name]));
    const subMap = new Map(subcategories.map((s) => [s.id, s.name]));
    const rows = [['Brand ID', 'Brand Name', 'Category Name', 'SubCategory Name', 'Current Image URL', 'Image URL']];
    for (const b of brands) {
      rows.push([b.id, b.name, catMap.get(b.category_id) || '', subMap.get(b.sub_category_id) || '', b.logo_path || b.logo || '', '']);
    }
    return csvResponse(res, 'brand-image-upload-template.csv', rows);
  } catch (error) {
    console.error('Brand image template error:', error);
    return res.status(500).json({ success: false, message: 'Unable to download brand image upload template' });
  }
}

async function bulkUploadBrandImageUrls(req, res) {
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
    return res.status(422).json({ success: false, message: 'Upload file has no image rows' });
  }

  const result = { successful_uploads: [], invalid_image_urls: [], failed_downloads: [], items_not_found: [] };

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 2;
    const identifier = String(getCell(rows[index], ['brand id', 'brand_id', 'id', 'brand'])).trim();
    const sourceUrl = String(getCell(rows[index], ['image url', 'image_url', 'url'])).trim();

    if (!identifier || !sourceUrl) continue;

    const brandId = Number(identifier);
    const brand = await Catalog.findBrandById(brandId);
    if (!brand) {
      result.items_not_found.push({ rowNumber, identifier, reason: 'Brand not found' });
      continue;
    }

    try {
      const downloaded = await downloadCatalogImage(sourceUrl);
      const processed = await processImageBuffer(downloaded.buffer, 'brand', `brand-${brand.name}-${brand.id}-${rowNumber}`);
      
      if (brand.logo_path) {
        deleteLocalImageFile(brand.logo_path);
      }

      await Catalog.updateBrandLogo(brand.id, processed.path);
      result.successful_uploads.push({
        rowNumber,
        id: brand.id,
        name: brand.name,
        previous_image_url: brand.logo_path || '',
        image_url: processed.path,
      });
    } catch (error) {
      result.failed_downloads.push({ rowNumber, identifier, image_url: sourceUrl, reason: error.message || 'Unable to download image' });
    }
  }

  return res.status(result.successful_uploads.length ? 200 : 422).json({
    success: result.failed_downloads.length === 0 && result.items_not_found.length === 0,
    message: `Processed ${result.successful_uploads.length} brand image updates.`,
    data: result,
  });
}


function bulkCatalogTemplate(req, res) {
  return csvResponse(res, 'catalog-main-category-wise-upload-template.csv', [
    ['main_category', 'subcategory', 'brand', 'category_tax_name', 'category_tax_percentage', 'status'],
    ['Grocery', 'Rice', 'India Gate', 'GST', '5', 'active'],
    ['Grocery', 'Rice', 'Daawat', 'GST', '5', 'active'],
    ['Grocery', 'Pulses', 'Tata Sampann', 'GST', '5', 'active'],
    ['Stationery', 'Pens', 'Cello', 'GST', '12', 'active'],
    ['Pet Care', 'Dog Food', 'Pedigree', 'GST', '18', 'active'],
  ]);
}

function selectedCategory(categories, value) {
  const id = Number(value || 0);
  if (!id) return null;
  return categories.find((category) => Number(category.id) === id) || null;
}

async function downloadSubcategoryList(req, res) {
  const [categories, subcategories] = await Promise.all([
    Catalog.listCategories(),
    Catalog.listSubcategories(),
  ]);
  const category = selectedCategory(categories, req.query.category_id || req.query.categoryId);
  if (!category) {
    return res.status(422).json({ success: false, message: 'Select a valid main category first' });
  }
  const rows = [['main_category', 'subcategory', 'status']];
  subcategories
    .filter((subcategory) => Number(subcategory.category_id) === Number(category.id))
    .forEach((subcategory) => rows.push([category.name, subcategory.name, subcategory.status || 'active']));
  return csvResponse(res, `${Catalog.slugify(category.name)}-subcategories.csv`, rows);
}

async function downloadBrandList(req, res) {
  const [categories, brands] = await Promise.all([
    Catalog.listCategories(),
    Catalog.listBrands(),
  ]);
  const category = selectedCategory(categories, req.query.category_id || req.query.categoryId);
  if (!category) {
    return res.status(422).json({ success: false, message: 'Select a valid main category first' });
  }
  const rows = [['main_category', 'subcategory', 'brand', 'status']];
  brands
    .filter((brand) => Number(brand.category_id) === Number(category.id))
    .forEach((brand) => rows.push([
      category.name,
      brand.sub_category_name || brand.subcategory_name || '',
      brand.name,
      brand.status || 'active',
    ]));
  return csvResponse(res, `${Catalog.slugify(category.name)}-brands.csv`, rows);
}

async function bulkUploadCatalog(req, res) {
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
    return res.status(422).json({ success: false, message: 'Upload file has no catalog rows' });
  }

  const [existingCategories, existingSubcategories, existingBrands] = await Promise.all([
    Catalog.listCategories(),
    Catalog.listSubcategories(),
    Catalog.listBrands(),
  ]);
  const categoryMap = new Map(existingCategories.map((item) => [catalogKey(item.name), item]));
  const subcategoryMap = new Map(existingSubcategories.map((item) => [catalogKey(item.category_name, item.name), item]));
  const brandMap = new Map(existingBrands.map((item) => [catalogKey(item.category_name, item.sub_category_name || item.subcategory_name, item.name), item]));
  const seenRows = new Set();
  const created = { categories: [], subcategories: [], brands: [] };
  const skipped = [];
  const failed = [];

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 2;
    const row = rows[index];
    const rowData = normalizeRowForClient(row);
    const categoryName = cleanName(getCell(row, ['category', 'main category', 'main_category', 'category name']));
    const subcategoryName = cleanName(getCell(row, ['subcategory', 'sub category', 'sub_category', 'subcategory name']));
    const brandName = cleanName(getCell(row, ['brand', 'brand name', 'brand_name']));
    const taxName = cleanName(getCell(row, ['category_tax_name', 'category tax name', 'tax_name', 'tax name', 'gst name']));
    const taxPercentageValue = getCell(row, ['category_tax_percentage', 'category tax percentage', 'tax_percentage', 'tax percentage', 'gst percentage', 'gst %']);
    const statusValue = getCell(row, ['status', 'is_active', 'active']);
    const rowKey = catalogKey(categoryName, subcategoryName, brandName);
    const errors = [];

    if (!categoryName || categoryName.length < 2) errors.push('Category name must be at least 2 characters');
    if (subcategoryName && subcategoryName.length < 2) errors.push('Subcategory name must be at least 2 characters');
    if (brandName && !subcategoryName) errors.push('Subcategory is required when brand is provided');
    if (brandName && brandName.length < 2) errors.push('Brand name must be at least 2 characters');
    const hasTaxPercentage = taxPercentageValue !== undefined && String(taxPercentageValue).trim() !== '';
    const taxPercentage = hasTaxPercentage ? Number(taxPercentageValue) : null;
    if (hasTaxPercentage && (!Number.isFinite(taxPercentage) || taxPercentage < 0 || taxPercentage > 100)) {
      errors.push('Tax percentage must be between 0 and 100');
    }
    if (seenRows.has(rowKey)) errors.push('Duplicate catalog row in upload file');

    if (errors.length) {
      failed.push({ rowNumber, identifier: [categoryName, subcategoryName, brandName].filter(Boolean).join(' / ') || '-', errors, row: rowData });
      continue;
    }
    seenRows.add(rowKey);

    try {
      let category = categoryMap.get(catalogKey(categoryName));
      if (!category) {
        const id = await Catalog.createCategory({
          name: categoryName,
          slug: getCell(row, ['category_slug', 'category slug']),
          is_active: activeFromUpload(statusValue),
          tax_name: taxName,
          tax_percentage: taxPercentage,
        });
        category = { id, name: categoryName, tax_name: taxName, tax_percentage: taxPercentage, status: activeFromUpload(statusValue) ? 'active' : 'inactive' };
        categoryMap.set(catalogKey(categoryName), category);
        created.categories.push({ rowNumber, id, name: categoryName });
      }

      if (!subcategoryName) {
        if (!created.categories.some((item) => item.rowNumber === rowNumber)) {
          skipped.push({ rowNumber, identifier: categoryName, reason: 'Category already exists', row: rowData });
        }
        continue;
      }

      let subcategory = subcategoryMap.get(catalogKey(categoryName, subcategoryName));
      if (!subcategory) {
        const id = await Catalog.createSubcategory({
          category_id: category.id,
          name: subcategoryName,
          slug: getCell(row, ['subcategory_slug', 'subcategory slug', 'sub_category_slug']),
          is_active: activeFromUpload(statusValue),
        });
        subcategory = { id, category_id: category.id, category_name: categoryName, name: subcategoryName };
        subcategoryMap.set(catalogKey(categoryName, subcategoryName), subcategory);
        created.subcategories.push({ rowNumber, id, name: subcategoryName, category: categoryName });
      }

      if (!brandName) {
        if (!created.subcategories.some((item) => item.rowNumber === rowNumber)) {
          skipped.push({ rowNumber, identifier: `${categoryName} / ${subcategoryName}`, reason: 'Category and subcategory already exist', row: rowData });
        }
        continue;
      }

      const brandKey = catalogKey(categoryName, subcategoryName, brandName);
      if (brandMap.has(brandKey)) {
        skipped.push({ rowNumber, identifier: `${categoryName} / ${subcategoryName} / ${brandName}`, reason: 'Brand already exists', row: rowData });
        continue;
      }

      const id = await Catalog.createBrand({
        category_id: category.id,
        sub_category_id: subcategory.id,
        name: brandName,
        slug: getCell(row, ['brand_slug', 'brand slug']),
        is_active: activeFromUpload(statusValue),
      });
      brandMap.set(brandKey, { id, category_id: category.id, sub_category_id: subcategory.id, name: brandName });
      created.brands.push({ rowNumber, id, name: brandName, category: categoryName, subcategory: subcategoryName });
    } catch (error) {
      failed.push({
        rowNumber,
        identifier: [categoryName, subcategoryName, brandName].filter(Boolean).join(' / '),
        errors: [error.code === 'ER_DUP_ENTRY' ? 'Name already exists for this parent' : (error.message || 'Unable to save catalog row')],
        row: rowData,
      });
    }
  }

  const createdCount = created.categories.length + created.subcategories.length + created.brands.length;
  const issueCount = failed.length + skipped.length;
  return res.status(createdCount || skipped.length ? 200 : 422).json({
    success: failed.length === 0,
    message: `${createdCount} catalog item(s) created${issueCount ? `, ${issueCount} row(s) need attention` : ''}`,
    created,
    created_count: createdCount,
    failed,
    skipped,
  });
}

async function tree(req, res) {
  try {
    const [categories, subcategories, brands, treeData] = await Promise.all([
      Catalog.listCategories(),
      Catalog.listSubcategories(),
      Catalog.listBrands(),
      Catalog.getTree(),
    ]);

    res.json({ success: true, categories, subcategories, brands, tree: treeData });
  } catch (error) {
    console.error('Catalog tree error:', error);
    res.status(500).json({ success: false, message: 'Unable to load catalog data' });
  }
}

async function listCategories(req, res) {
  const categories = await Catalog.listCategories();
  res.json({ success: true, categories });
}

async function createCategory(req, res) {
  const errors = [];
  validateName(req.body, errors);
  const tax = parseTaxPayload(req.body, errors);
  if (errors.length) return res.status(422).json({ success: false, errors });

  try {
    const iconPath = await processUploadedFile(req.file, 'category', req.body.name);
    const id = await Catalog.createCategory({
      name: String(req.body.name).trim(),
      slug: req.body.slug,
      is_active: req.body.is_active === undefined ? true : parseActive(req.body.is_active),
      icon_path: iconPath,
      ...tax,
    });
    res.status(201).json({ success: true, message: 'Category created', id, icon_path: iconPath });
  } catch (error) {
    if (duplicateResponse(res, error)) return;
    console.error('Create category error:', error);
    res.status(500).json({ success: false, message: 'Unable to create category' });
  }
}

async function updateCategory(req, res) {
  const errors = [];
  validateName(req.body, errors);
  const tax = parseTaxPayload(req.body, errors);
  if (errors.length) return res.status(422).json({ success: false, errors });

  try {
    await Catalog.updateCategory(req.params.id, {
      name: String(req.body.name).trim(),
      slug: req.body.slug,
      is_active: req.body.is_active === undefined ? true : parseActive(req.body.is_active),
      icon_path: await processUploadedFile(req.file, 'category', req.body.name),
      ...tax,
    });
    res.json({ success: true, message: 'Category updated' });
  } catch (error) {
    if (duplicateResponse(res, error)) return;
    console.error('Update category error:', error);
    res.status(500).json({ success: false, message: 'Unable to update category' });
  }
}

async function deleteCategory(req, res) {
  try {
    await Catalog.deleteCategory(req.params.id);
    res.json({ success: true, message: 'Category deleted' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ success: false, message: 'Unable to delete category' });
  }
}

async function bulkDeleteCategories(req, res) {
  const ids = req.body && Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) {
    return res.status(400).json({ success: false, message: 'No category IDs provided for deletion' });
  }

  try {
    const deletedCount = await Catalog.bulkDeleteCategories(ids);
    res.json({ success: true, message: `${deletedCount} category(ies) deleted successfully`, deletedCount });
  } catch (error) {
    console.error('Bulk delete categories error:', error);
    res.status(500).json({ success: false, message: 'Unable to delete selected categories' });
  }
}

async function listSubcategories(req, res) {
  const subcategories = await Catalog.listSubcategories();
  res.json({ success: true, subcategories });
}

async function resolveCatalogImage(file, imageUrlInput, type, baseName, existingImagePath = null) {
  let imagePath = await processUploadedFile(file, type, baseName);

  if (!imagePath && imageUrlInput && typeof imageUrlInput === 'string' && imageUrlInput.trim()) {
    const rawUrl = imageUrlInput.trim();
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      try {
        const downloaded = await downloadCatalogImage(rawUrl);
        const processed = await processImageBuffer(downloaded.buffer, type, baseName);
        imagePath = processed.path;
      } catch (err) {
        console.error(`Unable to download ${type} image from URL ${rawUrl}:`, err.message);
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

async function createSubcategory(req, res) {
  const errors = [];
  validateName(req.body, errors);
  const categoryId = categoryIdFrom(req.body);
  if (!categoryId) errors.push('Category is required');
  if (errors.length) return res.status(422).json({ success: false, errors });

  try {
    const imageUrlInput = req.body.image_url || req.body.imageUrl || req.body.image_path;
    const imagePath = await resolveCatalogImage(req.file, imageUrlInput, 'subcategory', req.body.name);
    const id = await Catalog.createSubcategory({
      category_id: categoryId,
      name: String(req.body.name).trim(),
      slug: req.body.slug,
      image_path: imagePath,
      is_active: req.body.is_active === undefined ? true : parseActive(req.body.is_active),
    });
    res.status(201).json({ success: true, message: 'Subcategory created', id });
  } catch (error) {
    if (duplicateResponse(res, error)) return;
    console.error('Create subcategory error:', error);
    res.status(500).json({ success: false, message: 'Unable to create subcategory' });
  }
}

async function updateSubcategory(req, res) {
  const errors = [];
  validateName(req.body, errors);
  const categoryId = categoryIdFrom(req.body);
  if (!categoryId) errors.push('Category is required');
  if (errors.length) return res.status(422).json({ success: false, errors });

  try {
    const existing = await Catalog.findSubcategoryById(req.params.id);
    const imageUrlInput = req.body.image_url || req.body.imageUrl || req.body.image_path;
    const newImage = await resolveCatalogImage(req.file, imageUrlInput, 'subcategory', req.body.name, existing ? existing.image_path : null);
    await Catalog.updateSubcategory(req.params.id, {
      category_id: categoryId,
      name: String(req.body.name).trim(),
      slug: req.body.slug,
      image_path: newImage || (existing ? existing.image_path : null),
      is_active: req.body.is_active === undefined ? true : parseActive(req.body.is_active),
    });
    res.json({ success: true, message: 'Subcategory updated' });
  } catch (error) {
    if (duplicateResponse(res, error)) return;
    console.error('Update subcategory error:', error);
    res.status(500).json({ success: false, message: 'Unable to update subcategory' });
  }
}

async function deleteSubcategory(req, res) {
  await Catalog.deleteSubcategory(req.params.id);
  res.json({ success: true, message: 'Subcategory deleted' });
}

async function bulkDeleteSubcategories(req, res) {
  const ids = req.body && Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) {
    return res.status(400).json({ success: false, message: 'No subcategory IDs provided for deletion' });
  }

  try {
    const deletedCount = await Catalog.bulkDeleteSubcategories(ids);
    res.json({ success: true, message: `${deletedCount} subcategory(ies) deleted successfully`, deletedCount });
  } catch (error) {
    console.error('Bulk delete subcategories error:', error);
    res.status(500).json({ success: false, message: 'Unable to delete selected subcategories' });
  }
}

async function listBrands(req, res) {
  const brands = await Catalog.listBrands();
  res.json({ success: true, brands });
}

async function createBrand(req, res) {
  const errors = [];
  validateName(req.body, errors);
  if (!req.body.category_id) errors.push('Category is required');
  if (!req.body.sub_category_id && !req.body.subcategory_id) errors.push('Subcategory is required');
  if (errors.length) return res.status(422).json({ success: false, errors });

  try {
    const logoUrlInput = req.body.logo_url || req.body.logoUrl || req.body.image_url || req.body.logo_path || req.body.logo;
    const logoPath = await resolveCatalogImage(req.file, logoUrlInput, 'brand', req.body.name);
    const id = await Catalog.createBrand({
      category_id: req.body.category_id,
      subcategory_id: req.body.subcategory_id,
      sub_category_id: req.body.sub_category_id,
      name: String(req.body.name).trim(),
      slug: req.body.slug,
      logo_path: logoPath,
      is_active: req.body.is_active === undefined ? true : parseActive(req.body.is_active),
    });
    res.status(201).json({ success: true, message: 'Brand created', id });
  } catch (error) {
    if (duplicateResponse(res, error)) return;
    console.error('Create brand error:', error);
    res.status(500).json({ success: false, message: 'Unable to create brand' });
  }
}

async function updateBrand(req, res) {
  const errors = [];
  validateName(req.body, errors);
  if (!req.body.category_id) errors.push('Category is required');
  if (!req.body.sub_category_id && !req.body.subcategory_id) errors.push('Subcategory is required');
  if (errors.length) return res.status(422).json({ success: false, errors });

  try {
    const existing = await Catalog.findBrandById(req.params.id);
    const logoUrlInput = req.body.logo_url || req.body.logoUrl || req.body.image_url || req.body.logo_path || req.body.logo;
    const newLogo = await resolveCatalogImage(req.file, logoUrlInput, 'brand', req.body.name, existing ? existing.logo_path : null);
    await Catalog.updateBrand(req.params.id, {
      category_id: req.body.category_id,
      subcategory_id: req.body.subcategory_id,
      sub_category_id: req.body.sub_category_id,
      name: String(req.body.name).trim(),
      slug: req.body.slug,
      logo_path: newLogo || (existing ? existing.logo_path : null),
      is_active: req.body.is_active === undefined ? true : parseActive(req.body.is_active),
    });
    res.json({ success: true, message: 'Brand updated' });
  } catch (error) {
    if (duplicateResponse(res, error)) return;
    console.error('Update brand error:', error);
    res.status(500).json({ success: false, message: 'Unable to update brand' });
  }
}


async function deleteBrand(req, res) {
  await Catalog.deleteBrand(req.params.id);
  res.json({ success: true, message: 'Brand deleted' });
}

module.exports = {
  tree,
  bulkCatalogTemplate,
  subcategoryBulkTemplate,
  brandBulkTemplate,
  downloadSubcategoryList,
  downloadBrandList,
  downloadSubcategoryImageTemplate,
  bulkUploadSubcategoryImageUrls,
  downloadBrandImageTemplate,
  bulkUploadBrandImageUrls,
  bulkUploadCatalog,
  bulkUploadSubcategories,
  bulkUploadBrands,
  bulkUploadSubcategoryImages,
  bulkUploadBrandImages,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  bulkDeleteCategories,
  listSubcategories,
  createSubcategory,
  updateSubcategory,
  deleteSubcategory,
  bulkDeleteSubcategories,
  listBrands,
  createBrand,
  updateBrand,
  deleteBrand,
};
