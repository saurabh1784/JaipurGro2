# GitHub Repository Setup Guide

## Current Status
- Local project: `G:\windowsApp\GroceryApp\Server_node`
- GitHub repo: https://github.com/saurabh1784/Jaipur
- Repository appears to be empty or has existing files

## Prerequisites
1. **Install Git** from https://git-scm.com/download/win (if not installed)
2. **GitHub CLI** (optional) from https://cli.github.com/

## Automated Setup (After Git Installation)

### Option A: Command Line (Recommended)
```bash
cd G:\windowsApp\GroceryApp

# Initialize git if not already done
git init

# Add GitHub remote
git remote add origin https://github.com/saurabh1784/Jaipur.git

# Add all files
git add .

# Commit changes
git commit -m "feat: Add order management system with delivery tracking

- Added delivery tracking to client_orders (vendor_id, delivery_status, delivery_partner_id, delivery_otp, client details)
- Created Order model with assign/ready/deliver/verify OTP methods
- Updated Quotation.js to denormalize client details on order creation
- Added orderController.js with admin, vendor, and client endpoints
- Added orderRoutes.js (split admin/vendor/client routers)
- Created admin orders dashboard (orders.ejs) with stats and assignment modal
- Created vendor orders view (vendor-orders.ejs)
- Created client orders view (client-orders.ejs)
- Updated navigation to include Orders menu items
- Fixed vendor-products loading by adding missing Product and VendorProduct imports"

# Set branch name and push
git branch -M main
git push -u origin main
```

### Option B: GitHub Desktop
1. Install GitHub Desktop: https://desktop.github.com/
2. Open GitHub Desktop → File → Add Local Repository
3. Choose `G:\windowsApp\GroceryApp`
4. Commit and push to `main` branch

### Option C: Using GitHub CLI
```bash
# Install GitHub CLI first, then:
gh auth login
cd G:\windowsApp\GroceryApp
gh repo create saurabh1784/Jaipur --public --source=. --push
```

## Files Modified in This Session

### New Files Created:
1. `Server_node/models/Order.js` - Order model with delivery tracking
2. `Server_node/controllers/orderController.js` - Order management endpoints
3. `Server_node/routes/orderRoutes.js` - Order routing (admin/vendor/client)
4. `Server_node/views/orders.ejs` - Admin order dashboard
5. `Server_node/views/vendor-orders.ejs` - Vendor order listing
6. `Server_node/views/client-orders.ejs` - Client order history

### Modified Files:
1. `Server_node/app.js`:
   - Enhanced `client_orders` table with delivery tracking columns
   - Added column migration for existing installations
   - Imported new models (Order, Product, VendorProduct, Wallet)
   - Registered order routes
   - Updated navigation (Orders link for Vendor/Client/Admin)

2. `Server_node/models/Quotation.js`:
   - `decideClientResponse()` now stores `vendor_id`, `client_name`, `client_phone`, `client_address` in orders

## Database Schema Changes

### New columns added to `client_orders`:
- `vendor_id` INT UNSIGNED (foreign key to users)
- `delivery_status` VARCHAR(20) DEFAULT 'pending'
- `delivery_partner_id` INT UNSIGNED (foreign key to staff users)
- `delivery_otp` VARCHAR(10)
- `client_name` VARCHAR(100)
- `client_phone` VARCHAR(30)
- `client_address` TEXT
- `assigned_at` TIMESTAMP NULL
- `ready_at` TIMESTAMP NULL
- `delivered_at` TIMESTAMP NULL

All changes are backward-compatible; existing orders will have NULL values for new columns.

## Order Flow Summary

**Client Action:**
1. Accepts quotation → order created with `delivery_status = 'pending'`

**Admin/Staff Actions:**
1. Views all orders in `/orders/admin/dashboard`
2. Assigns delivery partner + OTP → `delivery_status = 'assigned'`
3. Marks "Ready to Deliver" → `delivery_status = 'ready_to_deliver'`

**Delivery Partner:**
- Receives assignment with OTP
- Verifies OTP on delivery → status becomes 'out_for_delivery' → 'delivered'

## Testing After Deployment

1. Start server: `cd Server_node && npm start` (or `node app.js`)
2. Login as Admin: `admin@example.com` / `admin123`
3. Navigate to Orders → Dashboard
4. Create test order via quotation flow (Client → Vendor → Accept)
5. Assign delivery partner to test order
6. Verify vendor can view their orders
7. Verify client can view their order history

## Need Help?
- Check console logs in browser DevTools (F12)
- Check server logs for errors
- Verify database tables were auto-created/updated
- Confirm user roles: Admin, Staff, Vendor, Client
