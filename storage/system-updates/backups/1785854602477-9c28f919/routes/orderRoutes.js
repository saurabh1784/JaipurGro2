const express = require('express');
const orderController = require('../controllers/orderController');
const {
  uploadDeliveryProfileImage,
  handleDeliveryProfileImageUploadError,
} = require('../middleware/deliveryProfileImageUpload');

const adminRouter = express.Router();
const vendorRouter = express.Router();
const clientRouter = express.Router();
const deliveryRouter = express.Router();
const publicRouter = express.Router();

// Public invoice route used by invoice QR codes
publicRouter.get('/invoices/:id/:token', orderController.publicInvoice);

// Admin routes
adminRouter.get('/dashboard', orderController.index);
adminRouter.get('/stats/dashboard', orderController.dashboardStats);
adminRouter.get('/delivery-dashboard', orderController.deliveryDashboardOrders);
adminRouter.get('/delivery-partner-status', orderController.deliveryPartnerStatuses);
adminRouter.post('/:id/resend-delivery-offer', orderController.resendDeliveryOffer);
adminRouter.post('/:id/manual-verify-delivery', orderController.manualVerifyDelivery);
adminRouter.get('/partners/list', orderController.getDeliveryPartners);
adminRouter.get('/delivery-partners/:partnerId/rejections', orderController.deliveryPartnerRejectionDetails);
adminRouter.post('/delivery-partners/:partnerId/block-status', orderController.setDeliveryPartnerBlockStatus);
adminRouter.get('/:id/free-delivery-partners', orderController.freeDeliveryPartnersForOrder);
adminRouter.get('/:id/invoice', orderController.adminInvoice);
adminRouter.get('/:id', orderController.show);
adminRouter.post('/:id/assign-delivery', orderController.assignDelivery);
adminRouter.post('/:id/ready-to-deliver', orderController.readyToDeliver);
adminRouter.post('/:id/verify-pickup-otp', orderController.verifyPickupOtp);
adminRouter.post('/:id/status', orderController.updateAdminStatus);

// Vendor routes
vendorRouter.get('/', orderController.vendorOrders);
vendorRouter.get('/:id/invoice', orderController.vendorInvoice);
vendorRouter.post('/:id/status', orderController.updateVendorStatus);
vendorRouter.post('/:id/verify-pickup-otp', orderController.verifyPickupOtp);
vendorRouter.get('/:id', orderController.vendorOrderDetail);

// Client routes
clientRouter.get('/', orderController.clientOrders);
clientRouter.get('/:id/tracking', orderController.clientDeliveryTracking);
clientRouter.get('/:id/invoice', orderController.clientInvoice);
clientRouter.put('/:id/ratings', orderController.rateCompletedOrder);
clientRouter.get('/:id', orderController.clientOrderDetail);

// Delivery partner routes
deliveryRouter.get('/me', orderController.deliveryProfile);
deliveryRouter.put('/me', orderController.updateDeliveryProfile);
deliveryRouter.post('/heartbeat', orderController.deliveryHeartbeat);
deliveryRouter.post('/availability', orderController.updateDeliveryAvailability);
deliveryRouter.post('/me/profile-image', uploadDeliveryProfileImage.single('image'), handleDeliveryProfileImageUploadError, orderController.uploadDeliveryProfileImage);
deliveryRouter.get('/offers', orderController.deliveryOffers);
deliveryRouter.get('/', orderController.deliveryOrders);
deliveryRouter.get('/:id/tracking', orderController.deliveryPartnerTracking);
deliveryRouter.get('/:id', orderController.deliveryOrderDetail);
deliveryRouter.post('/:id/offer/:decision', orderController.deliveryOfferDecision);
deliveryRouter.post('/:id/status', orderController.deliveryUpdateStatus);
deliveryRouter.post('/:id/verify-otp', orderController.deliveryVerifyOtp);
deliveryRouter.post('/:id/delivered', orderController.deliveryMarkDelivered);
deliveryRouter.post('/:id/activity', orderController.deliveryActivity);

module.exports = {
  publicRouter,
  adminRouter,
  vendorRouter,
  clientRouter,
  deliveryRouter,
};
