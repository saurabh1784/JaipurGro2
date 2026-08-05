const pool = require('../db');

async function record({
  actorId = null,
  targetUserId = null,
  action,
  details = null,
  ipAddress = null,
  userAgent = null,
}, connection = pool) {
  if (!action) return;

  await connection.query(
    `INSERT INTO user_audit_logs
      (actor_id, target_user_id, action, details, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      actorId || null,
      targetUserId || null,
      action,
      details ? JSON.stringify(details) : null,
      ipAddress || null,
      userAgent || null,
    ]
  ).catch((error) => {
    console.error('User audit log error:', error);
  });
}

module.exports = { record };
