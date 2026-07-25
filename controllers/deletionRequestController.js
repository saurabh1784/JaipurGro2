const pool = require('../db');
const User = require('../models/User');

async function initDeletionTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS account_deletion_requests (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        user_name VARCHAR(150) NOT NULL,
        user_email VARCHAR(180) DEFAULT NULL,
        user_phone VARCHAR(50) DEFAULT NULL,
        user_role VARCHAR(50) NOT NULL,
        city VARCHAR(100) DEFAULT NULL,
        reason TEXT DEFAULT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'pending',
        admin_notes TEXT DEFAULT NULL,
        processed_by INT UNSIGNED DEFAULT NULL,
        processed_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_del_req_user (user_id),
        KEY idx_del_req_city (city),
        KEY idx_del_req_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (err) {
    console.error('Error initializing account_deletion_requests table:', err);
  }
}

// Call table init
initDeletionTables();

function normalizeRole(value) {
  return String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
}

function isSuperAdmin(user) {
  if (!user) return false;
  if (normalizeRole(user.role) === 'superadmin' || normalizeRole(user.roleName) === 'superadmin') return true;
  return Array.isArray(user.roles) && user.roles.some((r) => normalizeRole(r.slug) === 'superadmin' || normalizeRole(r.name) === 'superadmin');
}

async function getUserCity(user) {
  if (!user) return '';
  if (user.city) return String(user.city).trim();

  try {
    const [rows] = await pool.query(
      `SELECT COALESCE(NULLIF(u.city, ''), ap.city, cp.city, vp.city, dpp.city, '') AS city
       FROM users u
       LEFT JOIN admin_profiles ap ON ap.user_id = u.id
       LEFT JOIN client_profiles cp ON cp.user_id = u.id
       LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
       LEFT JOIN delivery_person_profiles dpp ON dpp.user_id = u.id
       WHERE u.id = ? LIMIT 1`,
      [user.id]
    );
    return rows[0] && rows[0].city ? String(rows[0].city).trim() : '';
  } catch (e) {
    return '';
  }
}

// Mobile API: Submit Deletion Request
async function submitDeletionRequest(req, res) {
  try {
    const user = req.authUser || req.user || (req.session && req.session.user);
    if (!user || !user.id) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const userId = user.id;
    const reason = String(req.body.reason || '').trim();

    // Fetch latest user details and city
    const fullUser = await User.findById(userId);
    if (!fullUser) {
      return res.status(404).json({ success: false, message: 'User account not found' });
    }

    const userCity = await getUserCity(fullUser);

    // Check if pending request already exists
    const [existing] = await pool.query(
      'SELECT id FROM account_deletion_requests WHERE user_id = ? AND status = "pending" LIMIT 1',
      [userId]
    );

    if (existing && existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted an account deletion request. An admin will review it soon.',
      });
    }

    await pool.query(
      `INSERT INTO account_deletion_requests (user_id, user_name, user_email, user_phone, user_role, city, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        fullUser.id,
        fullUser.name || 'User',
        fullUser.email || null,
        fullUser.phone || null,
        fullUser.role || 'Client',
        userCity || null,
        reason || 'User requested account deletion from mobile app',
      ]
    );

    return res.json({
      success: true,
      message: 'Account deletion request submitted successfully. Your request is pending admin approval.',
    });
  } catch (error) {
    console.error('Error submitting account deletion request:', error);
    return res.status(500).json({ success: false, message: 'Failed to submit account deletion request' });
  }
}

// Admin Controller: Render Deletion Requests Page
async function renderDeletionRequests(req, res) {
  try {
    const adminUser = req.session.user || req.user || req.authUser;
    const superAdmin = isSuperAdmin(adminUser);
    const adminCity = await getUserCity(adminUser);

    const search = String(req.query.search || '').trim();
    const statusFilter = String(req.query.status || 'pending').trim().toLowerCase();
    const selectedCity = String(req.query.city || '').trim();

    let whereClauses = [];
    let params = [];

    // City scoping: if not Superadmin, strictly limit to admin's assigned city
    if (!superAdmin) {
      if (adminCity) {
        whereClauses.push('(LOWER(r.city) = LOWER(?) OR r.city IS NULL)');
        params.push(adminCity);
      }
    } else if (selectedCity && selectedCity !== 'All') {
      whereClauses.push('LOWER(r.city) = LOWER(?)');
      params.push(selectedCity);
    }

    // Status filter
    if (statusFilter && statusFilter !== 'all') {
      whereClauses.push('LOWER(r.status) = LOWER(?)');
      params.push(statusFilter);
    }

    // Search query across name, email, phone, role, city, reason
    if (search) {
      whereClauses.push(
        '(LOWER(r.user_name) LIKE ? OR LOWER(r.user_email) LIKE ? OR LOWER(r.user_phone) LIKE ? OR LOWER(r.user_role) LIKE ? OR LOWER(r.city) LIKE ? OR LOWER(r.reason) LIKE ?)'
      );
      const pattern = `%${search.toLowerCase()}%`;
      params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [requests] = await pool.query(
      `SELECT r.*, proc.name AS processor_name
       FROM account_deletion_requests r
       LEFT JOIN users proc ON proc.id = r.processed_by
       ${whereSql}
       ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.id DESC`,
      params
    );

    // Fetch cities list for superadmin filter
    let citiesList = [];
    if (superAdmin) {
      try {
        const [cityRows] = await pool.query(
          `SELECT DISTINCT city FROM (
             SELECT city FROM client_profiles WHERE city IS NOT NULL AND city != ''
             UNION
             SELECT city FROM vendor_profiles WHERE city IS NOT NULL AND city != ''
             UNION
             SELECT city FROM delivery_person_profiles WHERE city IS NOT NULL AND city != ''
           ) t ORDER BY city ASC`
        );
        citiesList = (cityRows || []).map((c) => c.city);
      } catch (_) {}
    }

    const shell = req.shell || { roleTitle: 'Admin', navItems: [] };

    res.render('deletion-requests', {
      title: 'Account Deletion Requests - JaipurGro',
      shell,
      requests: requests || [],
      superAdmin,
      adminCity,
      search,
      statusFilter,
      selectedCity,
      citiesList,
      message: req.query.msg || null,
      error: req.query.err || null,
    });
  } catch (error) {
    console.error('Error rendering deletion requests:', error);
    res.status(500).send('Unable to load Account Deletion Requests page');
  }
}

// Admin Action: Approve Deletion Request
async function approveDeletionRequest(req, res) {
  try {
    const adminUser = req.session.user || req.user || req.authUser;
    const requestId = req.params.id;

    const [rows] = await pool.query('SELECT * FROM account_deletion_requests WHERE id = ?', [requestId]);
    if (!rows || rows.length === 0) {
      return res.redirect('/users/deletion-requests?err=Request+not+found');
    }

    const requestItem = rows[0];

    // City scoping check
    if (!isSuperAdmin(adminUser)) {
      const adminCity = await getUserCity(adminUser);
      if (adminCity && requestItem.city && String(adminCity).toLowerCase() !== String(requestItem.city).toLowerCase()) {
        return res.redirect('/users/deletion-requests?err=Access+denied+for+this+city');
      }
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Mark request as approved
      const notes = String(req.body.admin_notes || 'Approved by admin').trim();
      await connection.query(
        `UPDATE account_deletion_requests
         SET status = 'approved', admin_notes = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [notes, adminUser.id, requestId]
      );

      // 2. Soft delete / deactivate user account
      await connection.query(
        `UPDATE users
         SET is_deleted = 1, status = 'inactive', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [requestItem.user_id]
      );

      await connection.commit();
      return res.redirect('/users/deletion-requests?msg=Account+deletion+approved+and+user+deleted');
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error approving deletion request:', error);
    return res.redirect('/users/deletion-requests?err=Failed+to+approve+deletion+request');
  }
}

// Admin Action: Reject Deletion Request
async function rejectDeletionRequest(req, res) {
  try {
    const adminUser = req.session.user || req.user || req.authUser;
    const requestId = req.params.id;

    const [rows] = await pool.query('SELECT * FROM account_deletion_requests WHERE id = ?', [requestId]);
    if (!rows || rows.length === 0) {
      return res.redirect('/users/deletion-requests?err=Request+not+found');
    }

    const requestItem = rows[0];

    // City scoping check
    if (!isSuperAdmin(adminUser)) {
      const adminCity = await getUserCity(adminUser);
      if (adminCity && requestItem.city && String(adminCity).toLowerCase() !== String(requestItem.city).toLowerCase()) {
        return res.redirect('/users/deletion-requests?err=Access+denied+for+this+city');
      }
    }

    const notes = String(req.body.admin_notes || 'Rejected by admin').trim();
    await pool.query(
      `UPDATE account_deletion_requests
       SET status = 'rejected', admin_notes = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [notes, adminUser.id, requestId]
    );

    return res.redirect('/users/deletion-requests?msg=Account+deletion+request+rejected');
  } catch (error) {
    console.error('Error rejecting deletion request:', error);
    return res.redirect('/users/deletion-requests?err=Failed+to+reject+deletion+request');
  }
}

module.exports = {
  initDeletionTables,
  submitDeletionRequest,
  renderDeletionRequests,
  approveDeletionRequest,
  rejectDeletionRequest,
};
