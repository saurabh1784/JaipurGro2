const pool = require('../db');

function formatMoney(value) {
  return Number(Math.max(0, Number(value || 0)).toFixed(2));
}

function formatDate(date) {
  if (!date) return '-';
  try {
    return new Date(date).toISOString().split('T')[0];
  } catch {
    return String(date);
  }
}

async function getGstReportData({ vendorId, startDate, endDate }) {
  const [vendorRows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone,
            vp.business_name, vp.address, vp.city, vp.state, vp.pincode, vp.country, vp.gst_number
     FROM users u
     LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
     WHERE u.id = ? AND u.role = 'Vendor' AND u.is_deleted = 0
     LIMIT 1`,
    [vendorId]
  );

  const vendor = vendorRows[0] || {};
  const storeName = vendor.business_name || vendor.name || 'Vendor Store';
  const addressParts = [vendor.address, vendor.city, vendor.state, vendor.pincode, vendor.country].filter(Boolean);
  const storeAddress = addressParts.length ? addressParts.join(', ') : 'Address not specified';
  const gstNumber = vendor.gst_number || 'N/A';

  const whereConditions = [
    "(o.vendor_id = ? OR EXISTS (SELECT 1 FROM client_order_items coi2 INNER JOIN vendor_products vpi ON vpi.id = coi2.vendor_product_id WHERE coi2.order_id = o.id AND vpi.vendor_id = ?))"
  ];
  const params = [vendorId, vendorId];

  if (startDate) {
    whereConditions.push("o.created_at >= ?");
    params.push(`${startDate} 00:00:00`);
  }
  if (endDate) {
    whereConditions.push("o.created_at <= ?");
    params.push(`${endDate} 23:59:59`);
  }

  const whereSql = whereConditions.join(' AND ');

  const [rows] = await pool.query(
    `SELECT o.id,
            COALESCE(o.order_number, CONCAT('INV-', o.id)) AS bill_number,
            o.created_at AS bill_date,
            COALESCE(SUM(coi.quantity), 0) AS total_products,
            COALESCE(SUM(coi.taxable_amount), 0) AS taxable_amount,
            COALESCE(MAX(coi.tax_percentage), 0) AS gst_percentage,
            COALESCE(SUM(coi.tax_amount), 0) AS gst_amount,
            COALESCE(SUM(coi.tax_amount), 0) / 2.0 AS cgst_amount,
            COALESCE(SUM(coi.tax_amount), 0) / 2.0 AS sgst_amount,
            COALESCE(SUM(coi.taxable_amount + coi.tax_amount), o.total_amount, 0) AS invoice_total
     FROM client_orders o
     LEFT JOIN client_order_items coi ON coi.order_id = o.id
     WHERE ${whereSql}
     GROUP BY o.id, o.order_number, o.created_at, o.total_amount
     ORDER BY o.created_at DESC`,
    params
  );

  const invoices = rows.map((row) => {
    const taxable = formatMoney(row.taxable_amount > 0 ? row.taxable_amount : (row.invoice_total - row.gst_amount));
    const gstAmt = formatMoney(row.gst_amount);
    const cgstAmt = formatMoney(gstAmt / 2);
    const sgstAmt = formatMoney(gstAmt / 2);
    const total = formatMoney(taxable + gstAmt);

    return {
      id: row.id,
      billNumber: row.bill_number,
      billDate: formatDate(row.bill_date),
      totalProducts: Number(row.total_products || 0),
      taxableAmount: taxable,
      gstPercentage: Number(row.gst_percentage || 0),
      gstAmount: gstAmt,
      cgstAmount: cgstAmt,
      sgstAmount: sgstAmt,
      invoiceTotal: total > 0 ? total : formatMoney(row.invoice_total),
    };
  });

  const summary = invoices.reduce(
    (acc, inv) => {
      acc.totalInvoices += 1;
      acc.totalProducts += inv.totalProducts;
      acc.totalTaxableAmount += inv.taxableAmount;
      acc.totalGst += inv.gstAmount;
      acc.totalCgst += inv.cgstAmount;
      acc.totalSgst += inv.sgstAmount;
      acc.grandTotal += inv.invoiceTotal;
      return acc;
    },
    {
      totalInvoices: 0,
      totalProducts: 0,
      totalTaxableAmount: 0,
      totalGst: 0,
      totalCgst: 0,
      totalSgst: 0,
      grandTotal: 0,
    }
  );

  summary.totalTaxableAmount = formatMoney(summary.totalTaxableAmount);
  summary.totalGst = formatMoney(summary.totalGst);
  summary.totalCgst = formatMoney(summary.totalCgst);
  summary.totalSgst = formatMoney(summary.totalSgst);
  summary.grandTotal = formatMoney(summary.grandTotal);

  const startPeriod = startDate || (invoices.length ? invoices[invoices.length - 1].billDate : formatDate(new Date()));
  const endPeriod = endDate || formatDate(new Date());

  return {
    storeName,
    storeAddress,
    gstNumber,
    period: `${startPeriod} to ${endPeriod}`,
    startDate: startDate || '',
    endDate: endDate || '',
    invoices,
    summary,
  };
}

function resolveVendorId(req) {
  const user = req.authUser || (req.session && req.session.user);
  if (user && user.role === 'Vendor') return user.id;
  if (req.query.vendor_id || req.query.vendorId) return Number(req.query.vendor_id || req.query.vendorId);
  return user ? user.id : 0;
}

function fallbackShell(user, activePath = '/vendor/reports/gst') {
  const roleTitle = (user && (user.roleName || user.role)) || 'Vendor';
  const themeMode = (user && (user.themeMode || user.theme_mode)) || 'light';
  return {
    roleTitle,
    themeMode,
    navItems: [
      { label: 'Dashboard', href: '/dashboard', icon: 'dashboard', active: false },
      { label: 'Quotations', href: '/vendor/quotations', icon: 'orders', active: false },
      { label: 'Vendor Products', href: '/vendor-products', icon: 'products', active: false },
      { label: 'Orders', href: '/orders/vendor', icon: 'orders', active: false },
      { label: 'GST Tax Report', href: '/vendor/reports/gst', icon: 'reports', active: true },
    ],
  };
}

async function renderVendorGstReport(req, res) {
  try {
    const vendorId = resolveVendorId(req);
    const startDate = String(req.query.startDate || req.query.start_date || '').trim();
    const endDate = String(req.query.endDate || req.query.end_date || '').trim();
    const report = await getGstReportData({ vendorId, startDate, endDate });

    const user = req.authUser || (req.session && req.session.user);
    res.render('vendor-gst-report', {
      user,
      shell: fallbackShell(user, '/vendor/reports/gst'),
      report,
    });
  } catch (error) {
    console.error('Render Vendor GST Report error:', error);
    res.status(500).send('Unable to generate GST Tax Report');
  }
}

async function getVendorGstReportApi(req, res) {
  try {
    const vendorId = resolveVendorId(req);
    const startDate = String(req.query.startDate || req.query.start_date || '').trim();
    const endDate = String(req.query.endDate || req.query.end_date || '').trim();
    const report = await getGstReportData({ vendorId, startDate, endDate });
    return res.json({ success: true, report });
  } catch (error) {
    console.error('Vendor GST Report API error:', error);
    return res.status(500).json({ success: false, message: 'Unable to generate GST Tax Report' });
  }
}

async function exportVendorGstReportCsv(req, res) {
  try {
    const vendorId = resolveVendorId(req);
    const startDate = String(req.query.startDate || req.query.start_date || '').trim();
    const endDate = String(req.query.endDate || req.query.end_date || '').trim();
    const report = await getGstReportData({ vendorId, startDate, endDate });

    const csvRows = [
      [`VENDOR GST TAX REPORT`],
      [`Store Name`, `"${report.storeName.replace(/"/g, '""')}"`],
      [`Store Address`, `"${report.storeAddress.replace(/"/g, '""')}"`],
      [`GST Number`, `"${report.gstNumber}"`],
      [`Report Period`, `"${report.period}"`],
      [],
      [`Bill Number`, `Bill Date`, `Total Products`, `Taxable Amount (INR)`, `GST %`, `GST Amount (INR)`, `CGST Amount (INR)`, `SGST Amount (INR)`, `Invoice Total (INR)`]
    ];

    report.invoices.forEach((inv) => {
      csvRows.push([
        `"${inv.billNumber}"`,
        `"${inv.billDate}"`,
        inv.totalProducts,
        inv.taxableAmount.toFixed(2),
        inv.gstPercentage.toFixed(2),
        inv.gstAmount.toFixed(2),
        inv.cgstAmount.toFixed(2),
        inv.sgstAmount.toFixed(2),
        inv.invoiceTotal.toFixed(2),
      ]);
    });

    csvRows.push([]);
    csvRows.push([
      `SUMMARY TOTALS`,
      ``,
      report.summary.totalProducts,
      report.summary.totalTaxableAmount.toFixed(2),
      ``,
      report.summary.totalGst.toFixed(2),
      report.summary.totalCgst.toFixed(2),
      report.summary.totalSgst.toFixed(2),
      report.summary.grandTotal.toFixed(2),
    ]);

    const csvContent = csvRows.map((row) => row.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=GST_Tax_Report_${vendorId}_${Date.now()}.csv`);
    return res.status(200).send(csvContent);
  } catch (error) {
    console.error('Vendor GST Report CSV Export error:', error);
    return res.status(500).json({ success: false, message: 'Unable to export GST Tax Report CSV' });
  }
}

module.exports = {
  getGstReportData,
  renderVendorGstReport,
  getVendorGstReportApi,
  exportVendorGstReportCsv,
};
