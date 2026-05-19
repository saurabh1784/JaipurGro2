const VendorProduct = require('../models/VendorProduct');
const Product = require('../models/Product');
const ProductSearch = require('../models/ProductSearch');

function isSuperAdmin(user) {
  return String((user && (user.role || user.roleName)) || '').toLowerCase().replace(/[\s_-]+/g, '') === 'superadmin';
}

function isAdminLike(user) {
  return Boolean(
    user &&
      (user.role === 'Admin' ||
        user.role === 'admin' ||
        isSuperAdmin(user) ||
        (Array.isArray(user.permissions) && (user.permissions.includes('all') || user.permissions.includes('products.manage'))))
  );
}

function isVendor(user) {
  return user && user.role === 'Vendor';
}

function isClient(user) {
  return user && user.role === 'Client';
}

function resolveVendorId(req) {
  if (isVendor(req.authUser)) return req.authUser.id;
  return Number(req.body.vendor_id || req.query.vendor_id || req.params.vendorId);
}

async function index(req, res) {
  if (!isVendor(req.authUser) && !isAdminLike(req.authUser)) {
    return res.status(403).json({ success: false, message: 'Use client-visible products for client catalog access' });
  }

  try {
    const vendorId = isVendor(req.authUser) ? req.authUser.id : req.query.vendor_id;
    const rows = await VendorProduct.list({
      vendor_id: vendorId,
      approval_status: req.query.approval_status,
      status: req.query.status,
      search: req.query.search,
      category_id: req.query.category_id,
      sub_category_id: req.query.sub_category_id || req.query.subcategory_id,
      brand_id: req.query.brand_id,
      brand_name: req.query.brand_name,
    });
    return res.json({ success: true, vendor_products: rows });
  } catch (error) {
    console.error('Vendor product list error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch vendor products' });
  }
}

async function show(req, res) {
  if (!isVendor(req.authUser) && !isAdminLike(req.authUser)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to view vendor product records' });
  }

  const row = await VendorProduct.findById(Number(req.params.id));
  if (!row) return res.status(404).json({ success: false, message: 'Vendor product not found' });
  if (isVendor(req.authUser) && Number(row.vendor_id) !== Number(req.authUser.id)) {
    return res.status(403).json({ success: false, message: 'You can access only your own vendor products' });
  }
  return res.json({ success: true, vendor_product: row });
}

async function approvedProducts(req, res) {
  if (!isVendor(req.authUser) && !isAdminLike(req.authUser)) {
    return res.status(403).json({ success: false, message: 'Only vendors or authorized users can view approved products' });
  }

  try {
    const products = await Product.listApproved(Number(req.query.limit) || 200);
    return res.json({ success: true, products });
  } catch (error) {
    console.error('Approved product list error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch approved products' });
  }
}

async function create(req, res) {
  if (!isVendor(req.authUser) && !isAdminLike(req.authUser)) {
    return res.status(403).json({ success: false, message: 'Only vendors or authorized users can create vendor products' });
  }

  try {
    const vendorProduct = await VendorProduct.create({
      ...req.body,
      vendor_id: resolveVendorId(req),
    });
    return res.status(201).json({
      success: true,
      message: vendorProduct.approval_status === 'pending' ? 'Product submitted for approval' : 'Vendor product saved',
      vendor_product: vendorProduct,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to save vendor product',
    });
  }
}

async function update(req, res) {
  const existing = await VendorProduct.findById(Number(req.params.id));
  if (!existing) return res.status(404).json({ success: false, message: 'Vendor product not found' });
  if (isVendor(req.authUser) && Number(existing.vendor_id) !== Number(req.authUser.id)) {
    return res.status(403).json({ success: false, message: 'You can update only your own vendor products' });
  }
  if (!isVendor(req.authUser) && !isAdminLike(req.authUser)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to update vendor products' });
  }

  try {
    const updates = {};
    ['price', 'quantity', 'status'].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        if ((field === 'price' || field === 'quantity') && (req.body[field] === '' || req.body[field] === null || req.body[field] === undefined)) {
          return;
        }
        updates[field] = req.body[field];
      }
    });

    const vendorProduct = await VendorProduct.update(existing.id, updates);
    return res.json({ success: true, message: 'Vendor product updated', vendor_product: vendorProduct });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to update vendor product',
    });
  }
}

async function destroy(req, res) {
  if (!isVendor(req.authUser)) {
    return res.status(403).json({ success: false, message: 'Only the logged-in vendor can delete vendor products' });
  }

  const existing = await VendorProduct.findById(Number(req.params.id));
  if (!existing) return res.status(404).json({ success: false, message: 'Vendor product not found' });
  if (Number(existing.vendor_id) !== Number(req.authUser.id)) {
    return res.status(403).json({ success: false, message: 'You can delete only your own vendor products' });
  }

  await VendorProduct.remove(existing.id);
  return res.json({ success: true, message: 'Vendor product deleted' });
}

async function updateInventoryPrice(req, res) {
  return update(req, res);
}

async function setClientPrice(req, res) {
  const existing = await VendorProduct.findById(Number(req.params.id));
  if (!existing) return res.status(404).json({ success: false, message: 'Vendor product not found' });
  if (isVendor(req.authUser) && Number(existing.vendor_id) !== Number(req.authUser.id)) {
    return res.status(403).json({ success: false, message: 'You can set prices only for your own products' });
  }
  if (!isVendor(req.authUser) && !isAdminLike(req.authUser)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to set client prices' });
  }

  try {
    await VendorProduct.setClientPrice({
      product_id: existing.product_id,
      vendor_id: existing.vendor_id,
      client_id: req.body.client_id,
      custom_price: req.body.custom_price,
    });
    return res.json({ success: true, message: 'Client custom price saved' });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to save custom price',
    });
  }
}

async function deleteClientPrice(req, res) {
  const existing = await VendorProduct.findById(Number(req.params.id));
  if (!existing) return res.status(404).json({ success: false, message: 'Vendor product not found' });
  if (isVendor(req.authUser) && Number(existing.vendor_id) !== Number(req.authUser.id)) {
    return res.status(403).json({ success: false, message: 'You can remove prices only for your own products' });
  }
  if (!isVendor(req.authUser) && !isAdminLike(req.authUser)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to remove client prices' });
  }
  await VendorProduct.deleteClientPrice({
    product_id: existing.product_id,
    vendor_id: existing.vendor_id,
    client_id: req.params.clientId,
  });
  return res.json({ success: true, message: 'Client custom price removed' });
}

async function approveProduct(req, res) {
  if (!isAdminLike(req.authUser)) {
    return res.status(403).json({ success: false, message: 'Only admin or authorized users can approve products' });
  }

  try {
    await VendorProduct.approveProduct({
      product_id: req.params.productId,
      approved_by: req.authUser.id,
      default_price: req.body.default_price || req.body.price,
    });
    return res.json({ success: true, message: 'Product approved' });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Unable to approve product',
    });
  }
}

async function rejectProduct(req, res) {
  if (!isAdminLike(req.authUser)) {
    return res.status(403).json({ success: false, message: 'Only admin or authorized users can reject products' });
  }

  await VendorProduct.rejectProduct({
    product_id: req.params.productId,
    rejected_by: req.authUser.id,
    reason: req.body.reason,
  });
  return res.json({ success: true, message: 'Product rejected' });
}

async function visibleForClient(req, res) {
  const clientId = isClient(req.authUser) ? req.authUser.id : req.query.client_id;
  if (!clientId && !isAdminLike(req.authUser)) {
    return res.status(422).json({ success: false, message: 'Client ID is required' });
  }

  try {
    if (req.query.search) {
      await ProductSearch.trackSearch({
        userId: clientId,
        keyword: req.query.search,
      });
    }
    const products = await VendorProduct.visibleForClient({
      client_id: clientId,
      vendor_id: req.query.vendor_id,
      search: req.query.search,
      category_id: req.query.category_id,
      sub_category_id: req.query.sub_category_id || req.query.subcategory_id,
      brand_id: req.query.brand_id,
      brand_name: req.query.brand_name,
    });
    return res.json({ success: true, products });
  } catch (error) {
    console.error('Client visible products error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch client products' });
  }
}

async function suggestions(req, res) {
  const clientId = isClient(req.authUser) ? req.authUser.id : req.query.client_id;

  try {
    const suggestions = await ProductSearch.suggestions({
      userId: clientId,
      term: req.query.q || req.query.search,
      limit: req.query.limit || 8,
    });
    return res.json({ success: true, suggestions });
  } catch (error) {
    console.error('Product suggestions error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load suggestions' });
  }
}

async function trackActivity(req, res) {
  const clientId = isClient(req.authUser) ? req.authUser.id : req.body.client_id;
  const type = req.body.type || req.body.activity_type;
  const productId = req.body.product_id;
  const keyword = req.body.keyword || req.body.search;

  try {
    if (type === 'click') {
      await ProductSearch.trackClick({ userId: clientId, productId, keyword });
    } else if (type === 'view') {
      await ProductSearch.trackView({ userId: clientId, productId, keyword });
    } else {
      return res.status(422).json({ success: false, message: 'Activity type must be click or view' });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Product activity tracking error:', error);
    return res.status(500).json({ success: false, message: 'Unable to track activity' });
  }
}

module.exports = {
  index,
  approvedProducts,
  show,
  create,
  update,
  destroy,
  updateInventoryPrice,
  setClientPrice,
  deleteClientPrice,
  approveProduct,
  rejectProduct,
  visibleForClient,
  suggestions,
  trackActivity,
};
