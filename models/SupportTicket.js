const pool = require('../db');

const OPEN = 'Open';
const CLOSED = 'Closed';

function normalizeTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    requester_id: row.requester_id,
    requester_role: row.requester_role,
    subject: row.subject,
    status: row.status,
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
  return null;
}

async function hasOpenTicket(userId, requesterRole, connection = pool) {
  const [rows] = await connection.query(
    'SELECT id FROM support_tickets WHERE requester_id = ? AND requester_role = ? AND status = ? LIMIT 1',
    [userId, requesterRole, OPEN]
  );
  return rows[0] || null;
}

async function create({ user, subject, message }) {
  const requesterRole = roleScope(user && user.role);
  if (!requesterRole) {
    const error = new Error('Only clients and vendors can create support tickets');
    error.status = 403;
    throw error;
  }

  const cleanSubject = String(subject || '').trim();
  const cleanMessage = String(message || '').trim();
  if (!cleanSubject || !cleanMessage) {
    const error = new Error('Subject and message are required');
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
      `INSERT INTO support_tickets (requester_id, requester_role, subject, status)
       VALUES (?, ?, ?, ?)`,
      [user.id, requesterRole, cleanSubject, OPEN]
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
            COUNT(stm.id) AS message_count,
            MAX(stm.created_at) AS last_message_at
     FROM support_tickets st
     INNER JOIN users u ON u.id = st.requester_id
     LEFT JOIN support_ticket_messages stm ON stm.ticket_id = st.id
     ${whereSql}
     GROUP BY st.id, u.name, u.email
     ORDER BY CASE st.status WHEN 'Open' THEN 0 ELSE 1 END, COALESCE(MAX(stm.created_at), st.updated_at) DESC, st.id DESC`,
    params
  );
  return rows.map(normalizeTicket);
}

async function findById(ticketId) {
  const [rows] = await pool.query(
    `SELECT st.*, u.name AS requester_name, u.email AS requester_email,
            COUNT(stm.id) AS message_count,
            MAX(stm.created_at) AS last_message_at
     FROM support_tickets st
     INNER JOIN users u ON u.id = st.requester_id
     LEFT JOIN support_ticket_messages stm ON stm.ticket_id = st.id
     WHERE st.id = ?
     GROUP BY st.id, u.name, u.email
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
  if (ticket.status !== OPEN) {
    const error = new Error('Cannot reply to a closed ticket');
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
  if (![OPEN, CLOSED].includes(status)) {
    const error = new Error('Status must be Open or Closed');
    error.status = 422;
    throw error;
  }
  await pool.query(
    `UPDATE support_tickets
     SET status = ?, closed_at = CASE WHEN ? = 'Closed' THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, status, ticketId]
  );
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
  roleScope,
};
