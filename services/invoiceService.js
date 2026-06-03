const fs = require('fs/promises');
const path = require('path');
const pool = require('../db');

const invoiceDir = path.join(__dirname, '..', 'storage', 'invoices');

function cleanText(value) {
  return String(value == null ? '' : value)
    .replace(/[₹]/g, 'Rs ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .trim();
}

function money(value) {
  return `Rs ${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-IN');
}

function escapePdfText(value) {
  return cleanText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLine(value, maxLength = 86) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function drawText(lines, text, x, y, size = 10) {
  lines.push(`BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`);
}

function taxSummary(items) {
  const summary = new Map();
  for (const item of items) {
    const percentage = Number(item.tax_percentage || 0);
    const name = cleanText(item.tax_name || (percentage > 0 ? 'Tax' : 'No Tax'));
    const key = `${name}|${percentage.toFixed(2)}`;
    if (!summary.has(key)) {
      summary.set(key, { name, percentage, taxable: 0, tax: 0 });
    }
    const row = summary.get(key);
    row.taxable += Number(item.taxable_amount || 0);
    row.tax += Number(item.tax_amount || 0);
  }
  return [...summary.values()].filter((row) => row.percentage > 0 || row.tax > 0);
}

function vendorStoreName(order) {
  return cleanText(order.vendor_business_name || order.vendor_name || 'Vendor Store');
}

function vendorAddress(order) {
  return [
    order.vendor_address,
    order.vendor_city,
    order.vendor_state,
    order.vendor_country,
  ].filter(Boolean).join(', ');
}

function buildPdfBuffer(order, items) {
  const number = order.invoice_number || `INV-${String(order.id).padStart(6, '0')}`;
  const lines = [];
  let y = 790;
  const storeName = vendorStoreName(order);
  const storeAddress = vendorAddress(order);

  drawText(lines, storeName, 48, y, 20);
  drawText(lines, 'Tax Invoice', 430, y, 18);
  y -= 22;
  if (order.vendor_gst_number) {
    drawText(lines, `GSTIN: ${order.vendor_gst_number}`, 48, y, 10);
    y -= 14;
  }
  if (storeAddress) {
    for (const addressLine of wrapLine(storeAddress, 70).slice(0, 3)) {
      drawText(lines, addressLine, 48, y, 9);
      y -= 12;
    }
  }
  if (order.vendor_phone || order.vendor_email) {
    drawText(
      lines,
      [
        order.vendor_phone ? `Phone: ${order.vendor_phone}` : '',
        order.vendor_email ? `Email: ${order.vendor_email}` : '',
      ].filter(Boolean).join(' | '),
      48,
      y,
      9
    );
    y -= 12;
  }
  if (order.vendor_services) {
    drawText(lines, `Services: ${order.vendor_services}`, 48, y, 9);
    y -= 12;
  }
  y -= 8;
  lines.push(`48 ${y} m 548 ${y} l S`);
  y -= 22;

  const sectionTop = y;
  let billY = sectionTop;
  let detailsY = sectionTop;

  drawText(lines, 'Bill To', 48, billY, 12);
  billY -= 18;
  drawText(lines, order.client_name || 'Client', 48, billY, 10);
  billY -= 14;
  if (order.client_phone) {
    drawText(lines, `Phone: ${order.client_phone}`, 48, billY, 10);
    billY -= 14;
  }
  for (const addressLine of wrapLine(order.client_address || '', 48).slice(0, 4)) {
    drawText(lines, addressLine, 48, billY, 9);
    billY -= 12;
  }

  drawText(lines, 'Invoice Details', 320, detailsY, 12);
  detailsY -= 18;
  drawText(lines, `Invoice: ${number}`, 320, detailsY, 10);
  detailsY -= 14;
  drawText(lines, `Order: #${order.id}`, 320, detailsY, 10);
  detailsY -= 14;
  drawText(lines, `Invoice Date: ${formatDate(order.invoice_generated_at || new Date())}`, 320, detailsY, 10);
  detailsY -= 14;
  drawText(lines, `Order Date: ${formatDate(order.created_at)}`, 320, detailsY, 10);
  detailsY -= 14;

  y = Math.min(billY, detailsY) - 14;

  drawText(lines, 'Item', 48, y, 10);
  drawText(lines, 'Qty', 268, y, 10);
  drawText(lines, 'Rate', 315, y, 10);
  drawText(lines, 'Tax', 385, y, 10);
  drawText(lines, 'Tax Amt', 430, y, 10);
  drawText(lines, 'Amount', 500, y, 10);
  y -= 12;
  lines.push(`48 ${y} m 548 ${y} l S`);
  y -= 18;

  items.forEach((item, index) => {
    const name = `${index + 1}. ${item.product_name || 'Product'}`;
    const taxLabel = Number(item.tax_percentage || 0) > 0 ? `${Number(item.tax_percentage || 0).toFixed(2)}%` : '-';
    drawText(lines, name.length > 36 ? `${name.slice(0, 33)}...` : name, 48, y, 9);
    drawText(lines, item.quantity, 268, y, 9);
    drawText(lines, money(item.unit_price), 315, y, 9);
    drawText(lines, taxLabel, 385, y, 9);
    drawText(lines, money(item.tax_amount), 430, y, 9);
    drawText(lines, money(item.line_total || Number(item.unit_price || 0) * Number(item.quantity || 0)), 500, y, 9);
    y -= 16;
  });

  y -= 8;
  lines.push(`340 ${y} m 548 ${y} l S`);
  y -= 18;
  const taxes = taxSummary(items);
  if (taxes.length) {
    drawText(lines, 'Tax Summary', 48, y, 11);
    y -= 16;
    taxes.forEach((tax) => {
      drawText(lines, `${tax.name} ${tax.percentage.toFixed(2)}%`, 48, y, 9);
      drawText(lines, `Taxable ${money(tax.taxable)}`, 185, y, 9);
      drawText(lines, `Tax ${money(tax.tax)}`, 315, y, 9);
      y -= 14;
    });
    y -= 6;
  }
  drawText(lines, 'Subtotal', 370, y, 10);
  drawText(lines, money(order.subtotal_amount || order.total_amount), 470, y, 10);
  y -= 16;
  if (Number(order.discount_amount || 0) > 0) {
    drawText(lines, `Discount${order.coupon_code ? ` (${order.coupon_code})` : ''}`, 370, y, 10);
    drawText(lines, `- ${money(order.discount_amount)}`, 470, y, 10);
    y -= 16;
  }
  drawText(lines, 'Total', 370, y, 12);
  drawText(lines, money(order.total_amount), 470, y, 12);
  y -= 34;
  drawText(lines, `This invoice was generated automatically for ${storeName}.`, 48, y, 9);

  const content = `q\n1 w\n${lines.join('\n')}\nQ`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

async function ensureInvoice(order, items) {
  if (!order) throw new Error('Order is required');
  await fs.mkdir(invoiceDir, { recursive: true });

  const invoiceNumber = order.invoice_number || `INV-${String(order.id).padStart(6, '0')}`;
  const relativePath = order.invoice_pdf_path || path.join('storage', 'invoices', `${invoiceNumber}.pdf`);
  const absolutePath = path.join(__dirname, '..', relativePath);

  const generatedAt = order.invoice_generated_at || new Date();
  const buffer = buildPdfBuffer({ ...order, invoice_number: invoiceNumber, invoice_generated_at: generatedAt }, items);
  await fs.writeFile(absolutePath, buffer);
  await pool.query(
    `UPDATE client_orders
     SET invoice_number = ?, invoice_pdf_path = ?, invoice_generated_at = COALESCE(invoice_generated_at, NOW())
     WHERE id = ?`,
    [invoiceNumber, relativePath.replace(/\\/g, '/'), order.id]
  );
  order.invoice_generated_at = generatedAt;

  order.invoice_number = invoiceNumber;
  order.invoice_pdf_path = relativePath.replace(/\\/g, '/');
  return {
    invoiceNumber,
    relativePath: order.invoice_pdf_path,
    absolutePath,
    fileName: `${invoiceNumber}.pdf`,
  };
}

module.exports = {
  ensureInvoice,
};
