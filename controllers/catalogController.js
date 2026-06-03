const Catalog = require('../models/Catalog');
const { brandLogoPath } = require('../middleware/brandLogoUpload');

function parseActive(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function validateName(body, errors) {
  if (!body.name || String(body.name).trim().length < 2) {
    errors.push('Name must be at least 2 characters');
  }
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
    const id = await Catalog.createCategory({
      name: String(req.body.name).trim(),
      slug: req.body.slug,
      is_active: req.body.is_active === undefined ? true : parseActive(req.body.is_active),
      ...tax,
    });
    res.status(201).json({ success: true, message: 'Category created', id });
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
  await Catalog.deleteCategory(req.params.id);
  res.json({ success: true, message: 'Category deleted' });
}

async function listSubcategories(req, res) {
  const subcategories = await Catalog.listSubcategories();
  res.json({ success: true, subcategories });
}

async function createSubcategory(req, res) {
  const errors = [];
  validateName(req.body, errors);
  if (!req.body.category_id) errors.push('Category is required');
  if (errors.length) return res.status(422).json({ success: false, errors });

  try {
    const id = await Catalog.createSubcategory({
      category_id: req.body.category_id,
      name: String(req.body.name).trim(),
      slug: req.body.slug,
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
  if (!req.body.category_id) errors.push('Category is required');
  if (errors.length) return res.status(422).json({ success: false, errors });

  try {
    await Catalog.updateSubcategory(req.params.id, {
      category_id: req.body.category_id,
      name: String(req.body.name).trim(),
      slug: req.body.slug,
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
    const id = await Catalog.createBrand({
      category_id: req.body.category_id,
      subcategory_id: req.body.subcategory_id,
      sub_category_id: req.body.sub_category_id,
      name: String(req.body.name).trim(),
      slug: req.body.slug,
      logo_path: brandLogoPath(req.file),
      is_active: req.body.is_active === undefined ? true : parseActive(req.body.is_active),
    });
    res.status(201).json({ success: true, message: 'Brand created', id, logo_path: brandLogoPath(req.file) });
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
    await Catalog.updateBrand(req.params.id, {
      category_id: req.body.category_id,
      subcategory_id: req.body.subcategory_id,
      sub_category_id: req.body.sub_category_id,
      name: String(req.body.name).trim(),
      slug: req.body.slug,
      logo_path: brandLogoPath(req.file),
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
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listSubcategories,
  createSubcategory,
  updateSubcategory,
  deleteSubcategory,
  listBrands,
  createBrand,
  updateBrand,
  deleteBrand,
};
