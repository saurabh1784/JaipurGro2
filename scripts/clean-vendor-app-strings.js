const fs = require('fs');
const path = require('path');

const targetFile = 'g:/windowsApp/GroceryApp/vendorapp/lib/features/dashboard/vendor_dashboard_page.dart';

let content = fs.readFileSync(targetFile, 'utf8');

// List of replacements
const replacements = [
  // Status texts
  {
    regex: /return 'Vendor Status: Active [^']+/g,
    replacement: "return 'Vendor Status: Active'"
  },
  {
    regex: /return 'Vendor Status: On Hold [^']+/g,
    replacement: "return 'Vendor Status: On Hold'"
  },
  {
    regex: /return 'Vendor Status: Account Suspended [^']+/g,
    replacement: "return 'Vendor Status: Account Suspended'"
  },
  {
    regex: /return 'Vendor Status: \$\{status\.isEmpty \? "Pending Activation [^"]+" : status\[0\]\.toUpperCase\(\) \+ status\.substring\(1\)\}';/g,
    replacement: "return 'Vendor Status: ${status.isEmpty ? \"Pending Activation\" : status[0].toUpperCase() + status.substring(1)}';"
  },

  // Quotation and Order bullet separators
  {
    regex: /'Quotation #\$\{quotation\.id\} [^']+\$\{quotation\.clientName\}'/g,
    replacement: "'Quotation #${quotation.id} • ${quotation.clientName}'"
  },
  {
    regex: /'Order #\$\{order\.id\} [^']+\$\{order\.customer\}'/g,
    replacement: "'Order #${order.id} • ${order.customer}'"
  },

  // Currency / Rupees symbol fixes
  {
    regex: /Please enter a valid amount greater than [^0]+0/g,
    replacement: "Please enter a valid amount greater than ₹0"
  },
  {
    regex: /Amount cannot exceed available wallet balance \([^)]+\$\{widget\.walletBalance\.toStringAsFixed\(2\)\}\)/g,
    replacement: "Amount cannot exceed available wallet balance (₹${widget.walletBalance.toStringAsFixed(2)})"
  },
  {
    regex: /Available Balance: [^\$]+\$\{widget\.walletBalance\.toStringAsFixed\(2\)\}/g,
    replacement: "Available Balance: ₹${widget.walletBalance.toStringAsFixed(2)}"
  },
  {
    regex: /Withdrawal Amount \([^)]+\)/g,
    replacement: "Withdrawal Amount (₹)"
  },
  {
    regex: /Vendor Selling Price \([^)]+\)/g,
    replacement: "Vendor Selling Price (₹)"
  },
  {
    regex: /MRP \([^)]+\)/g,
    replacement: "MRP (₹)"
  },
  {
    regex: /'\$\{_selectedProduct!\.category\} [^']+\$\{_selectedProduct!\.brand\}\$\{_selectedProduct!\.weightLabel\.isNotEmpty \? ' [^']+\$\{_selectedProduct!\.weightLabel\}' : ''\}'/g,
    replacement: "'${_selectedProduct!.category} • ${_selectedProduct!.brand}${_selectedProduct!.weightLabel.isNotEmpty ? ' • ${_selectedProduct!.weightLabel}' : ''}'"
  },
  {
    regex: /'\$\{product\.category\} [^']+\$\{product\.brand\}\$\{product\.weightLabel\.isNotEmpty \? ' [^']+\$\{product\.weightLabel\}' : ''\}'/g,
    replacement: "'${product.category} • ${product.brand}${product.weightLabel.isNotEmpty ? ' • ${product.weightLabel}' : ''}'"
  },

  // Search placeholder and empty result text
  {
    regex: /hintText:\s*'[^']*Type product name, e\.g\. maggi, noodles, atta\.\.\.'/g,
    replacement: "hintText:\n                            'Search product name, e.g. maggi, noodles, atta...'"
  },
  {
    regex: /'[^']*No matching products found\. Try typing another word \(e\.g\. maggi, noodles, atta\)'/g,
    replacement: "'No matching products found. Try typing another word (e.g. maggi, noodles, atta)'"
  },

  // Ratings
  {
    regex: /: '[^']* \$\{data\.profile\.averageRating\.toStringAsFixed\(1\)\} \/ 5 \(\$\{data\.profile\.reviewCount\} reviews\)'/g,
    replacement: ": '★ ${data.profile.averageRating.toStringAsFixed(1)} / 5 (${data.profile.reviewCount} reviews)'"
  },
  {
    regex: /: '[^']* \$\{category\.averageRating\.toStringAsFixed\(1\)\}'/g,
    replacement: ": '★ ${category.averageRating.toStringAsFixed(1)}'"
  },

  // Bullet items and summaries
  {
    regex: /'[^']* \$\{item\.productName\}\$\{item\.isOutOfStock \? '\(stock \$\{item\.stock\}, required \$\{item\.quantity\}\)' : ''\}'/g,
    replacement: "'• ${item.productName}${item.isOutOfStock ? ' (stock ${item.stock}, required ${item.quantity})' : ''}'"
  },
  {
    regex: /'[^']+\$\{\_report!\.summary\.totalInventoryValue\.toStringAsFixed\(0\)\}'/g,
    replacement: "'₹${_report!.summary.totalInventoryValue.toStringAsFixed(0)}'"
  },
  {
    regex: /'[^']*Top Performing Products & Variations'/g,
    replacement: "'Top Performing Products & Variations'"
  },
  {
    regex: /'Option: \$\{p\.variantName\} [^']+\$\{p\.totalOrders\} order\(s\)'/g,
    replacement: "'Option: ${p.variantName} • ${p.totalOrders} order(s)'"
  },
  {
    regex: /'[^']+\$\{p\.totalRevenue\.toStringAsFixed\(0\)\}'/g,
    replacement: "'₹${p.totalRevenue.toStringAsFixed(0)}'"
  },
  {
    regex: /'[^']*Variation request submitted to Admin for approval!'/g,
    replacement: "'✓ Variation request submitted to Admin for approval!'"
  }
];

let replacedCount = 0;
for (const r of replacements) {
  if (r.regex.test(content)) {
    content = content.replace(r.regex, r.replacement);
    replacedCount++;
  }
}

// Fallback: replace any remaining corrupted Mojibake sequences starting with ÃƒÆ
content = content.replace(/'ÃƒÆ[^']+'/g, (match) => {
  if (match.includes('•')) return match;
  if (match.includes('₹')) return match;
  return "''";
});

fs.writeFileSync(targetFile, content, 'utf8');
console.log(`Cleaned vendor_dashboard_page.dart! Replaced ${replacedCount} corrupted patterns.`);
