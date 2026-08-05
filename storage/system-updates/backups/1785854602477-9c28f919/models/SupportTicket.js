const pool = require('../db');

const OPEN = 'Open';
const CLOSED = 'Closed';

function normalizeTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    requester_id: row.requester_id,
    requester_role: row.requester_role,
    order_id: row.order_id || null,
    category: row.category || 'General',
    description: row.description || row.subject || '',
    subject: row.subject,
    status: row.status,
    assigned_staff_id: row.assigned_staff_id || null,
    assigned_staff_name: row.assigned_staff_name || 'Unassigned',
    resolution: row.resolution || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at,
    requester_name: row.requester_name || '',
    requester_email: row.requester_email || '',
    message_count: Number(row.message_count || 0),
    last_message_at: row.last_message_at || row.updated_at || row.created_at,
  };
}

function normalizeMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    sender_id: row.sender_id,
    sender_role: row.sender_role,
    sender_name: row.sender_name || '',
    message: row.message,
    created_at: row.created_at,
  };
}

function roleScope(role) {
  const value = String(role || '').toLowerCase();
  if (value === 'client') return 'Client';
  if (value === 'vendor') return 'Vendor';
  if (['deliveryperson', 'delivery person', 'delivery_person', 'delivery partner', 'deliverypartner'].includes(value)) return 'Delivery Partner';
  return null;
}

async function hasOpenTicket(userId, requesterRole, connection = pool) {
  const [rows] = await connection.query(
    'SELECT id FROM support_tickets WHERE requester_id = ? AND requester_role = ? AND status IN ("Open", "In Progress") LIMIT 1',
    [userId, requesterRole]
  );
  return rows[0] || null;
}

async function create({ user, subject, message, orderId = null, category = 'General', description = null }) {
  const requesterRole = roleScope(user && user.role);
  if (!requesterRole) {
    const error = new Error('Only clients, vendors and delivery partners can create support tickets');
    error.status = 403;
    throw error;
  }

  const cleanSubject = String(subject || '').trim();
  const cleanMessage = String(message || description || '').trim();
  if (!cleanSubject || !cleanMessage) {
    const error = new Error('Subject and message description are required');
    error.status = 422;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const openTicket = await hasOpenTicket(user.id, requesterRole, connection);
    if (openTicket) {
      const error = new Error('You already have an open support ticket');
      error.status = 422;
      throw error;
    }

    const [result] = await connection.query(
      `INSERT INTO support_tickets (requester_id, requester_role, order_id, category, description, subject, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.id, requesterRole, orderId || null, category || 'General', cleanMessage, cleanSubject, OPEN]
    );
    const ticketId = result.insertId;
    await connection.query(
      `INSERT INTO support_ticket_messages (ticket_id, sender_id, sender_role, sender_name, message)
       VALUES (?, ?, ?, ?, ?)`,
      [ticketId, user.id, requesterRole, user.name || requesterRole, cleanMessage]
    );

    await connection.commit();
    return ticketId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function list({ requesterId, requesterRole, status, roleType } = {}) {
  try {
    const where = [];
    const params = [];
    if (requesterId) {
      where.push('st.requester_id = ?');
      params.push(requesterId);
    }
    if (requesterRole) {
      where.push('st.requester_role = ?');
      params.push(requesterRole);
    }
    if (roleType) {
      where.push('st.requester_role = ?');
      params.push(roleType);
    }
    if (status) {
      where.push('st.status = ?');
      params.push(status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT st.*, u.name AS requester_name, u.email AS requester_email,
              staff.name AS assigned_staff_name,
              (SELECT COUNT(*) FROM support_ticket_messages stm WHERE stm.ticket_id = st.id) AS message_count,
              (SELECT MAX(stm.created_at) FROM support_ticket_messages stm WHERE stm.ticket_id = st.id) AS last_message_at
       FROM support_tickets st
       INNER JOIN users u ON u.id = st.requester_id
       LEFT JOIN users staff ON staff.id = st.assigned_staff_id
       ${whereSql}
       ORDER BY CASE st.status WHEN 'Open' THEN 0 WHEN 'In Progress' THEN 1 ELSE 2 END, st.created_at DESC, st.id DESC`,
      params
    );
    return rows.map(normalizeTicket);
  } catch (err) {
    console.error('SupportTicket.list error:', err);
    return [];
  }
}

async function findById(ticketId) {
  const [rows] = await pool.query(
    `SELECT st.*, u.name AS requester_name, u.email AS requester_email,
            staff.name AS assigned_staff_name,
            COUNT(stm.id) AS message_count,
            MAX(stm.created_at) AS last_message_at
     FROM support_tickets st
     INNER JOIN users u ON u.id = st.requester_id
     LEFT JOIN users staff ON staff.id = st.assigned_staff_id
     LEFT JOIN support_ticket_messages stm ON stm.ticket_id = st.id
     WHERE st.id = ?
     GROUP BY st.id, u.name, u.email, staff.name
     LIMIT 1`,
    [ticketId]
  );
  return normalizeTicket(rows[0]);
}

async function messages(ticketId) {
  const [rows] = await pool.query(
    `SELECT * FROM support_ticket_messages
     WHERE ticket_id = ?
     ORDER BY created_at ASC, id ASC`,
    [ticketId]
  );
  return rows.map(normalizeMessage);
}

async function addMessage({ ticketId, user, message }) {
  const cleanMessage = String(message || '').trim();
  if (!cleanMessage) {
    const error = new Error('Message is required');
    error.status = 422;
    throw error;
  }

  const ticket = await findById(ticketId);
  if (!ticket) {
    const error = new Error('Ticket not found');
    error.status = 404;
    throw error;
  }
  if (['Closed', 'Resolved'].includes(ticket.status)) {
    const error = new Error('Cannot reply to a closed/resolved ticket');
    error.status = 422;
    throw error;
  }

  await pool.query(
    `INSERT INTO support_ticket_messages (ticket_id, sender_id, sender_role, sender_name, message)
     VALUES (?, ?, ?, ?, ?)`,
    [ticketId, user.id, user.roleName || user.role || 'Staff', user.name || 'Staff', cleanMessage]
  );
  await pool.query('UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [ticketId]);
}

async function updateStatus(ticketId, status) {
  const allowed = ['Open', 'In Progress', 'Resolved', 'Closed'];
  if (!allowed.includes(status)) {
    const error = new Error(`Status must be one of: ${allowed.join(', ')}`);
    error.status = 422;
    throw error;
  }
  await pool.query(
    `UPDATE support_tickets
     SET status = ?, closed_at = CASE WHEN ? IN ('Closed', 'Resolved') THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, status, ticketId]
  );
}

async function updateResolution({ ticketId, status, resolution, assignedStaffId }) {
  const allowed = ['Open', 'In Progress', 'Resolved', 'Closed'];
  const targetStatus = status && allowed.includes(status) ? status : 'Resolved';
  await pool.query(
    `UPDATE support_tickets
     SET status = ?,
         resolution = ?,
         assigned_staff_id = COALESCE(?, assigned_staff_id),
         closed_at = CASE WHEN ? IN ('Closed', 'Resolved') THEN CURRENT_TIMESTAMP ELSE closed_at END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [targetStatus, resolution || '', assignedStaffId || null, targetStatus, ticketId]
  );
  return findById(ticketId);
}

module.exports = {
  OPEN,
  CLOSED,
  create,
  list,
  findById,
  messages,
  addMessage,
  updateStatus,
  updateResolution,
  roleScope,
};
