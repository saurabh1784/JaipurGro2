function requireRoles(...allowedRoles) {
  const allowedLower = allowedRoles.map((r) => String(r).trim().toLowerCase());
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const userRoleLower = String(req.user.role || '').trim().toLowerCase();
    if (!allowedLower.includes(userRoleLower)) {
      return res.status(403).json({ success: false, message: 'You do not have permission for this action' });
    }

    next();
  };
}

module.exports = requireRoles;
