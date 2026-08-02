function validateAppRoleAccess(userRole, targetApp) {
  const normRole = String(userRole || '').trim().toLowerCase();
  const normApp = String(targetApp || 'customer').trim().toLowerCase();

  const isVendorRole = normRole === 'vendor';
  const isDeliveryRole = ['deliveryperson', 'delivery_partner', 'deliverypersonnel', 'delivery', 'staff'].includes(normRole);
  const isCustomerRole = ['client', 'customer'].includes(normRole);

  const isVendorApp = normApp === 'vendor';
  const isDeliveryApp = ['delivery', 'deliveryperson', 'delivery_partner', 'staff'].includes(normApp);
  const isCustomerApp = ['customer', 'client'].includes(normApp);

  const BLOCKED_RESPONSE = {
    allowed: false,
    message: 'This account is not allowed to access this app.',
  };

  if (isVendorApp) {
    if (!isVendorRole) {
      return BLOCKED_RESPONSE;
    }
  } else if (isDeliveryApp) {
    if (!isDeliveryRole) {
      return BLOCKED_RESPONSE;
    }
  } else if (isCustomerApp) {
    // Customer app allows Client, Vendor, and Delivery Partner roles
    if (!isCustomerRole && !isVendorRole && !isDeliveryRole) {
      return BLOCKED_RESPONSE;
    }
  }

  return { allowed: true };
}

module.exports = {
  validateAppRoleAccess,
};
