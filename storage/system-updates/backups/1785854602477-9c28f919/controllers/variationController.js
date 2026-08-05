const pool = require('../db');
const ProductVariant = require('../models/ProductVariant');

// Helper: Check permission for managing variations
function canManageVariations(user) {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase();
  if (['superadmin', 'admin', 'vendor', 'manager', 'staff'].includes(role)) return true;

  // Check staff permissions
  if (Array.isArray(user.permissions) && (user.permissions.includes('products.manage') || user.permissions.includes('variations.manage'))) {
    return true;
  }
  return false;
}

// Render Admin Variation Types & Values Management Page or Return JSON
const index = async (req, res) => {
  try {
    const user = req.session.user || req.user;
    if (!canManageVariations(user)) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
      return res.status(403).send('Forbidden: You do not have permission to manage variation types.');
    }

    const types = await ProductVariant.getAllVariationTypes();

    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.json({ success: true, types });
    }

    const shell = req.shell || res.locals.shell || { navItems: [] };

    res.render('variation_types', {
      title: 'Variation Types & Values Management',
      user,
      shell,
      types,
      message: req.query.msg || null,
      error: req.query.err || null,
    });
  } catch (err) {
    console.error('Error rendering variation types:', err);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(500).send('Error loading variation types page');
  }
};

// API Endpoint: Get All Variation Types
const getTypesApi = async (req, res) => {
  try {
    const types = await ProductVariant.getAllVariationTypes();
    return res.json({ success: true, types });
  } catch (err) {
    console.error('Error fetching variation types API:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Create / Edit Variation Type
const saveType = async (req, res) => {
  try {
    const user = req.session.user || req.user;
    if (!canManageVariations(user)) {
      return res.status(403).send('Forbidden');
    }

    const { id, name, code, status } = req.body;
    const cleanName = String(name || '').trim();
    const cleanCode = String(code || cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_')).trim();
    const st = status === 'inactive' ? 'inactive' : 'active';

    if (id) {
      await pool.query(
        'UPDATE variation_types SET name = ?, code = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [cleanName, cleanCode, st, id]
      );
    } else {
      await pool.query(
        'INSERT INTO variation_types (name, code, status, created_by) VALUES (?, ?, ?, ?)',
        [cleanName, cleanCode, st, user.id]
      );
    }

    res.redirect('/admin/variation-types?msg=Variation+type+saved+successfully');
  } catch (err) {
    console.error('Error saving variation type:', err);
    res.redirect(`/admin/variation-types?err=${encodeURIComponent(err.message)}`);
  }
};

// Create / Edit Variation Value
const saveValue = async (req, res) => {
  try {
    const user = req.session.user || req.user;
    if (!canManageVariations(user)) {
      return res.status(403).send('Forbidden');
    }

    const { id, variation_type_id, value, unit, numeric_value, status } = req.body;
    const cleanVal = String(value || '').trim();
    const cleanUnit = String(unit || '').trim();
    const numVal = parseFloat(numeric_value) || parseFloat(cleanVal) || 0;
    const st = status === 'inactive' ? 'inactive' : 'active';

    if (id) {
      await pool.query(
        'UPDATE variation_values SET variation_type_id = ?, value = ?, unit = ?, numeric_value = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [variation_type_id, cleanVal, cleanUnit, numVal, st, id]
      );
    } else {
      await ProductVariant.createVariationValue({
        variation_type_id,
        value: cleanVal,
        unit: cleanUnit,
        numeric_value: numVal,
        created_by: user.id,
      });
    }

    res.redirect('/admin/variation-types?msg=Variation+value+saved+successfully');
  } catch (err) {
    console.error('Error saving variation value:', err);
    res.redirect(`/admin/variation-types?err=${encodeURIComponent(err.message)}`);
  }
};

// Quick-Add Variation Value API (Called via AJAX from Product Form without leaving)
const quickAddValue = async (req, res) => {
  try {
    const user = req.session.user || req.user;
    if (!canManageVariations(user)) {
      return res.status(403).json({ success: false, message: 'Unauthorized permission' });
    }

    const { variation_type_id, value, unit, numeric_value } = req.body;

    if (!variation_type_id || !value) {
      return res.status(400).json({ success: false, message: 'Variation type and value are required.' });
    }

    const newVal = await ProductVariant.createVariationValue({
      variation_type_id: parseInt(variation_type_id, 10),
      value: String(value).trim(),
      unit: String(unit || '').trim(),
      numeric_value: parseFloat(numeric_value) || parseFloat(value) || 0,
      created_by: user ? user.id : null,
    });

    return res.json({
      success: true,
      message: 'Variation value added successfully',
      value: newVal,
    });
  } catch (err) {
    console.error('Error in quickAddValue API:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
// Delete Variation Type (Soft disable)
const deleteType = async (req, res) => {
  try {
    const user = req.session.user || req.user;
    if (!canManageVariations(user)) {
      return res.status(403).send('Forbidden');
    }
    const typeId = parseInt(req.params.id || req.body.id, 10);
    if (!typeId) {
      return res.redirect('/admin/variation-types?err=Invalid+variation+type+ID');
    }

    await pool.query("UPDATE variation_types SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [typeId]);
    await pool.query("UPDATE variation_values SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE variation_type_id = ?", [typeId]);

    res.redirect('/admin/variation-types?msg=Variation+type+deleted+successfully');
  } catch (err) {
    console.error('Error deleting variation type:', err);
    res.redirect(`/admin/variation-types?err=${encodeURIComponent(err.message)}`);
  }
};

// Delete Variation Value (Soft disable)
const deleteValue = async (req, res) => {
  try {
    const user = req.session.user || req.user;
    if (!canManageVariations(user)) {
      return res.status(403).send('Forbidden');
    }
    const valueId = parseInt(req.params.id || req.body.id, 10);
    if (!valueId) {
      return res.redirect('/admin/variation-types?err=Invalid+variation+value+ID');
    }

    await pool.query("UPDATE variation_values SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [valueId]);

    res.redirect('/admin/variation-types?msg=Variation+value+deleted+successfully');
  } catch (err) {
    console.error('Error deleting variation value:', err);
    res.redirect(`/admin/variation-types?err=${encodeURIComponent(err.message)}`);
  }
};

module.exports = {
  index,
  getTypesApi,
  saveType,
  saveValue,
  quickAddValue,
  deleteType,
  deleteValue,
};
