@echo off
echo ========================================
echo GitHub Repository Setup for Jaipur
echo ========================================
echo.

REM Check if git is available
git --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Git is not installed or not in PATH
    echo Please install Git from https://git-scm.com/download/win
    echo After installation, restart this script or run the commands manually.
    echo.
    pause
    exit /b 1
)

echo Git found! Setting up repository...
echo.

REM Navigate to project directory
cd /d "G:\windowsApp\GroceryApp"

REM Initialize git if not already initialized
if not exist ".git" (
    echo Initializing git repository...
    git init
) else (
    echo Git repository already initialized.
)

REM Add remote origin (replace if already exists)
echo Configuring remote origin...
git remote remove origin >nul 2>&1
git remote add origin https://github.com/saurabh1784/Jaipur.git

REM Stage all files
echo Staging files...
git add .

REM Create initial commit
echo Committing changes...
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

REM Set branch name to main
git branch -M main

REM Push to GitHub
echo.
echo ========================================
echo Ready to push to GitHub!
echo ========================================
echo.
echo This will push to: https://github.com/saurabh1784/Jaipur
echo Local branch: main
echo.
set /p confirm="Do you want to push now? (y/n): "
if /i "%confirm%"=="y" (
    echo Pushing to GitHub...
    git push -u origin main
    echo.
    echo SUCCESS! Your code is now on GitHub.
    echo Repository: https://github.com/saurabh1784/Jaipur
) else (
    echo.
    echo To push later, run: git push -u origin main
    echo Or use GitHub Desktop to push changes.
)

echo.
pause
