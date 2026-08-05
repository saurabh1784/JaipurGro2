function validateAppRoleAccess(userRole, targetApp) {
  const normRole = String(userRole || '').trim().toLowerCase();
  const normApp = String(targetApp || 'customer').trim().toLowerCase();

  const isVendorRole = normRole === 'vendor';
  const isDeliveryRole = ['deliveryperson', 'delivery_partner', 'deliverypersonnel', 'delivery'].includes(normRole);
  const isCustomerRole = ['client', 'customer'].includes(normRole);

  const isVendorApp = normApp === 'vendor';
  const isDeliveryApp = ['delivery', 'deliveryperson', 'delivery_partner'].includes(normApp);
  const isCustomerApp = ['customer', 'client'].includes(normApp);

  const roleLabel = isVendorRole ? 'Vendor' : (isDeliveryRole ? 'Delivery Partner' : (isCustomerRole ? 'Customer' : String(userRole || 'Unknown')));
  const appLabel = isVendorApp ? 'Vendor' : (isDeliveryApp ? 'Delivery Partner' : 'Customer');
  const BLOCKED_RESPONSE = {
    allowed: false,
    message: `This is a ${roleLabel} account and cannot log in to the ${appLabel} app. Please use the ${roleLabel} app.`,
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
    if (!isCustomerRole) {
      return BLOCKED_RESPONSE;
    }
  }

  return { allowed: true };
}

module.exports = {
  validateAppRoleAccess,
};
