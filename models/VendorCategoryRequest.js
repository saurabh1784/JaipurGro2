const pool = require('../db');
const Vendor = require('./Vendor');

function publicRequest(row) {
  return {
    id: row.id,
    vendor_id: row.vendor_id,
    vendor_name: row.vendor_name || '',
    vendor_email: row.vendor_email || '',
    business_name: row.business_name || '',
    category_id: row.category_id,
    category_name: row.category_name || '',
    status: row.status,
    note: row.note || '',
    admin_note: row.admin_note || '',
    created_at: row.created_at,
    decided_at: row.decided_at,
  };
}

async function pendingForVendor(vendorId) {
  const [rows] = await pool.query(
    `SELECT vcr.*, c.name AS category_name
     FROM vendor_category_requests vcr
     INNER JOIN categories c ON c.id = vcr.category_id
     WHERE vcr.vendor_id = ? AND vcr.status = 'pending'
     ORDER BY vcr.created_at DESC
     LIMIT 1`,
    [vendorId]
  );
  return rows[0] ? publicRequest(rows[0]) : null;
}

async function pendingForVendorList(vendorId) {
  const [rows] = await pool.query(
    `SELECT vcr.*, c.name AS category_name
     FROM vendor_category_requests vcr
     INNER JOIN categories c ON c.id = vcr.category_id
     WHERE vcr.vendor_id = ? AND vcr.status = 'pending'
     ORDER BY vcr.created_at DESC`,
    [vendorId]
  );
  return rows.map(publicRequest);
}

async function listForVendor(vendorId) {
  const [rows] = await pool.query(
    `SELECT vcr.*, c.name AS category_name
     FROM vendor_category_requests vcr
     INNER JOIN categories c ON c.id = vcr.category_id
     WHERE vcr.vendor_id = ?
     ORDER BY vcr.created_at DESC
     LIMIT 20`,
    [vendorId]
  );
  return rows.map(publicRequest);
}

async function availableCategoriesForVendor(vendorId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.slug, c.status
     FROM categories c
     WHERE c.is_deleted = 0
       AND c.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM vendor_categories vc
         WHERE vc.vendor_id = ? AND vc.category_id = c.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM vendor_category_requests vcr
         WHERE vcr.vendor_id = ? AND vcr.category_id = c.id AND vcr.status = 'pending'
       )
     ORDER BY c.name ASC`,
    [vendorId, vendorId]
  );
  return rows;
}

function normalizeCategoryIds(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw
    .map((item) => parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item > 0))];
}

async function create(vendorId, categoryIds, note = '') {
  const ids = normalizeCategoryIds(categoryIds);
  if (!ids.length) {
    const error = new Error('Select at least one category');
    error.status = 422;
    throw error;
  }

  const [categoryRows] = await pool.query(
    `SELECT id FROM categories
     WHERE id IN (${ids.map(() => '?').join(',')})
       AND is_deleted = 0
       AND status = 'active'`,
    ids
  );
  const validIds = new Set(categoryRows.map((row) => Number(row.id)));
  if (validIds.size !== ids.length) {
    const error = new Error('Selected category is not available');
    error.status = 422;
    throw error;
  }

  const assigned = await Vendor.assignedCategories([vendorId]);
  const assignedIds = new Set((assigned.get(Number(vendorId)) || []).map((category) => Number(category.id)));
  if (ids.some((id) => assignedIds.has(id))) {
    const error = new Error('One or more selected categories are already assigned to your account');
    error.status = 409;
    throw error;
  }

  const [pendingRows] = await pool.query(
    `SELECT category_id FROM vendor_category_requests
     WHERE vendor_id = ? AND status = 'pending'
       AND category_id IN (${ids.map(() => '?').join(',')})`,
    [vendorId, ...ids]
  );
  if (pendingRows.length) {
    const error = new Error('One or more selected categories already have pending requests');
    error.status = 409;
    throw error;
  }

  const createdIds = [];
  for (const categoryId of ids) {
    const [result] = await pool.query(
      `INSERT INTO vendor_category_requests (vendor_id, category_id, status, note)
       VALUES (?, ?, 'pending', ?)`,
      [vendorId, categoryId, String(note || '').trim() || null]
    );
    createdIds.push(result.insertId);
  }
  return createdIds;
}

async function list({ status = 'pending' } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push('vcr.status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT vcr.*, u.name AS vendor_name, u.email AS vendor_email,
            vp.business_name, c.name AS category_name
     FROM vendor_category_requests vcr
     INNER JOIN users u ON u.id = vcr.vendor_id
     LEFT JOIN vendor_profiles vp ON vp.user_id = vcr.vendor_id
     INNER JOIN categories c ON c.id = vcr.category_id
     ${whereSql}
     ORDER BY vcr.created_at DESC
     LIMIT 100`,
    params
  );
  return rows.map(publicRequest);
}

async function decide(id, status, adminId, adminNote = '') {
  if (!['approved', 'rejected'].includes(status)) {
    const error = new Error('Status must be approved or rejected');
    error.status = 422;
    throw error;
  }

  const [rows] = await pool.query(
    "SELECT * FROM vendor_category_requests WHERE id = ? AND status = 'pending' LIMIT 1",
    [id]
  );
  const request = rows[0];
  if (!request) {
    const error = new Error('Pending request not found');
    error.status = 404;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (status === 'approved') {
      const assignedByVendor = await Vendor.assignedCategories([request.vendor_id], connection);
      const assignedCategories = assignedByVendor.get(Number(request.vendor_id)) || [];
      await Vendor.setCategories(
        request.vendor_id,
        [
          ...assignedCategories.map((category) => category.id),
          request.category_id,
        ],
        connection
      );
    }
    await connection.query(
      `UPDATE vendor_category_requests
       SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP, admin_note = ?
       WHERE id = ?`,
      [status, adminId, String(adminNote || '').trim() || null, id]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  pendingForVendor,
  pendingForVendorList,
  listForVendor,
  availableCategoriesForVendor,
  create,
  list,
  decide,
};
