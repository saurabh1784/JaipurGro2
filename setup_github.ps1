# GitHub Repository Auto-Setup Script
# Run this in PowerShell after installing Git

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "GitHub Repository Setup for Jaipur" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check for git
try {
    git --version | Out-Null
} catch {
    Write-Host "ERROR: Git is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Git from https://git-scm.com/download/win" -ForegroundColor Yellow
    Write-Host "After installation, restart PowerShell and run this script again." -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

Write-Host "Git found! Setting up repository..." -ForegroundColor Green
Write-Host ""

# Navigate to project
Set-Location "G:\windowsApp\GroceryApp"

# Initialize git if needed
if (-Not (Test-Path ".git")) {
    Write-Host "Initializing git repository..." -ForegroundColor Yellow
    git init
} else {
    Write-Host "Git repository already initialized." -ForegroundColor Green
}

# Configure remote
Write-Host "Configuring remote origin..." -ForegroundColor Yellow
git remote remove origin 2>$null
git remote add origin https://github.com/saurabh1784/Jaipur.git

# Stage all files
Write-Host "Staging files..." -ForegroundColor Yellow
git add .

# Commit
Write-Host "Committing changes..." -ForegroundColor Yellow
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

# Set branch
git branch -M main

# Push confirmation
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Ready to push to GitHub!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Repository: https://github.com/saurabh1784/Jaipur" -ForegroundColor Yellow
Write-Host "Local branch: main" -ForegroundColor Yellow
Write-Host ""

$confirm = Read-Host "Do you want to push now? (y/n)"
if ($confirm -eq 'y' -or $confirm -eq 'Y') {
    Write-Host ""
    Write-Host "Pushing to GitHub..." -ForegroundColor Yellow
    git push -u origin main
    Write-Host ""
    Write-Host "SUCCESS! Your code is now on GitHub." -ForegroundColor Green
    Write-Host "Visit: https://github.com/saurabh1784/Jaipur" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "To push later, run: git push -u origin main" -ForegroundColor Cyan
    Write-Host "Or use GitHub Desktop to push changes." -ForegroundColor Cyan
}

Write-Host ""
pause
