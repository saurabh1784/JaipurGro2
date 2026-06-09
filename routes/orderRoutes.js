const express = require('express');
const orderController = require('../controllers/orderController');

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
adminRouter.get('/partners/list', orderController.getDeliveryPartners);
adminRouter.get('/:id/invoice', orderController.adminInvoice);
adminRouter.get('/:id', orderController.show);
adminRouter.post('/:id/assign-delivery', orderController.assignDelivery);
adminRouter.post('/:id/ready-to-deliver', orderController.readyToDeliver);
adminRouter.post('/:id/status', orderController.updateAdminStatus);

// Vendor routes
vendorRouter.get('/', orderController.vendorOrders);
vendorRouter.get('/:id/invoice', orderController.vendorInvoice);
vendorRouter.post('/:id/status', orderController.updateVendorStatus);
vendorRouter.get('/:id', orderController.vendorOrderDetail);

// Client routes
clientRouter.get('/', orderController.clientOrders);
clientRouter.get('/:id/invoice', orderController.clientInvoice);
clientRouter.get('/:id', orderController.clientOrderDetail);

// Delivery partner routes
deliveryRouter.get('/me', orderController.deliveryProfile);
deliveryRouter.get('/', orderController.deliveryOrders);
deliveryRouter.get('/:id', orderController.deliveryOrderDetail);
deliveryRouter.post('/:id/status', orderController.deliveryUpdateStatus);
deliveryRouter.post('/:id/verify-otp', orderController.deliveryVerifyOtp);
deliveryRouter.post('/:id/delivered', orderController.deliveryMarkDelivered);

module.exports = {
  publicRouter,
  adminRouter,
  vendorRouter,
  clientRouter,
  deliveryRouter,
};
