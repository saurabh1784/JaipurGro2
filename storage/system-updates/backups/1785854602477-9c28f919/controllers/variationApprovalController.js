const pool = require('../db');

// Helper: Check permission for approving vendor variation requests
function canApproveVariations(user) {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'superadmin' || role === 'admin') return true;
  if (Array.isArray(user.permissions) && (user.permissions.includes('products.manage') || user.permissions.includes('variations.approve'))) {
    return true;
  }
  return false;
}

// Render Admin Vendor Variation Approvals Page
const index = async (req, res) => {
  try {
    const user = req.session.user || req.user;
    if (!canApproveVariations(user)) {
      return res.status(403).send('Forbidden: You do not have permission to review vendor variation requests.');
    }

    const statusFilter = String(req.query.status || 'all').toLowerCase();
    let whereClause = '';
    const params = [];

    if (statusFilter !== 'all') {
      whereClause = "WHERE COALESCE(vpv.approval_status, 'pending') = ?";
      params.push(statusFilter);
    }

    // Role/Location filter for City Admin
    if (user.role === 'admin' && (user.assigned_city_id || user.city)) {
      whereClause += (whereClause ? ' AND ' : ' WHERE ') + 'LOWER(u.city) = LOWER(?)';
      params.push(String(user.city || user.assigned_city_id || ''));
    }

    const [requests] = await pool.query(
      `SELECT vpv.*,
              COALESCE(vpv.approval_status, 'pending') as approval_status,
              p.name as product_name, p.image_url as product_image, p.category_id,
              pv.variant_name, pv.measurement_value, pv.measurement_unit, pv.weight_in_grams, pv.image as variant_image,
              u.name as vendor_name, u.email as vendor_email, u.phone as vendor_phone,
              ab.name as approved_by_name
       FROM vendor_product_variants vpv
       INNER JOIN products p ON p.id = vpv.product_id
       INNER JOIN product_variants pv ON pv.id = vpv.product_variant_id
       INNER JOIN users u ON u.id = vpv.vendor_id
       LEFT JOIN users ab ON ab.id = vpv.approved_by
       ${whereClause}
       ORDER BY CASE WHEN COALESCE(vpv.approval_status, 'pending') = 'pending' THEN 1 ELSE 2 END, vpv.created_at DESC`,
      params
    );

    const shell = req.shell || res.locals.shell || { navItems: [] };

    res.render('variation_approvals', {
      title: 'Vendor Variation Approvals Management',
      user,
      shell,
      requests,
      statusFilter,
      message: req.query.msg || null,
      error: req.query.err || null,
    });
  } catch (err) {
    console.error('Error rendering variation approvals:', err);
    res.status(500).send('Error loading variation approvals page');
  }
};

// Approve Vendor Variation Request
const approve = async (req, res) => {
  try {
    const user = req.session.user || req.user;
    if (!canApproveVariations(user)) {
      return res.status(403).send('Forbidden');
    }

    const id = parseInt(req.params.id || req.body.id, 10);
    const note = String(req.body.note || 'Approved by administrator').trim();
    const userId = user ? (user.id || user.user_id) : null;

    await pool.query(
      `UPDATE vendor_product_variants
       SET approval_status = 'approved', is_available = 1, is_approved = 1, approval_note = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [note, userId, id]
    );

    res.redirect('/admin/variation-approvals?msg=Vendor+variation+request+approved+successfully');
  } catch (err) {
    console.error('Error approving variation request:', err);
    res.redirect(`/admin/variation-approvals?err=${encodeURIComponent(err.message)}`);
  }
};

// Reject Vendor Variation Request
const reject = async (req, res) => {
  try {
    const user = req.session.user || req.user;
    if (!canApproveVariations(user)) {
      return res.status(403).send('Forbidden');
    }

    const id = parseInt(req.params.id || req.body.id, 10);
    const note = String(req.body.note || 'Rejected by administrator').trim();
    const userId = user ? (user.id || user.user_id) : null;

    await pool.query(
      `UPDATE vendor_product_variants
       SET approval_status = 'rejected', is_available = 0, is_approved = 0, approval_note = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [note, userId, id]
    );

    res.redirect('/admin/variation-approvals?msg=Vendor+variation+request+rejected');
  } catch (err) {
    console.error('Error rejecting variation request:', err);
    res.redirect(`/admin/variation-approvals?err=${encodeURIComponent(err.message)}`);
  }
};

// Suspend Approved Variation
const suspend = async (req, res) => {
  try {
    const user = req.session.user || req.user;
    if (!canApproveVariations(user)) {
      return res.status(403).send('Forbidden');
    }

    const id = parseInt(req.params.id || req.body.id, 10);
    const note = String(req.body.note || 'Suspended by administrator').trim();

    await pool.query(
      `UPDATE vendor_product_variants
       SET approval_status = 'suspended', is_available = 0, is_approved = 0, approval_note = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [note, id]
    );

    res.redirect('/admin/variation-approvals?msg=Vendor+variation+suspended');
  } catch (err) {
    console.error('Error suspending variation:', err);
    res.redirect(`/admin/variation-approvals?err=${encodeURIComponent(err.message)}`);
  }
};

// Restore Suspended Variation
const restore = async (req, res) => {
  try {
    const user = req.session.user || req.user;
    if (!canApproveVariations(user)) {
      return res.status(403).send('Forbidden');
    }

    const id = parseInt(req.params.id || req.body.id, 10);
    const note = String(req.body.note || 'Restored by administrator').trim();

    await pool.query(
      `UPDATE vendor_product_variants
       SET approval_status = 'approved', is_available = 1, is_approved = 1, approval_note = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [note, id]
    );

    res.redirect('/admin/variation-approvals?msg=Vendor+variation+restored+to+approved');
  } catch (err) {
    console.error('Error restoring variation:', err);
    res.redirect(`/admin/variation-approvals?err=${encodeURIComponent(err.message)}`);
  }
};

module.exports = {
  index,
  approve,
  reject,
  suspend,
  restore,
};
