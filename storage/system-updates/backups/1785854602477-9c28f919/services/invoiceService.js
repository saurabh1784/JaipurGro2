const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const QRCode = require('qrcode');
const pool = require('../db');
const {
  DEFAULT_PLATFORM_NAME,
  DEFAULT_REVERSE_CHARGE_TEXT,
  DEFAULT_SERIAL_INFO_TEXT,
  DEFAULT_ENABLED_COLUMN_KEYS,
  getInvoiceSettings,
} = require('./invoiceSettingsService');

const invoiceDir = path.join(__dirname, '..', 'storage', 'invoices');
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 25;
const RIGHT = 570;
const CONTENT_WIDTH = RIGHT - LEFT;
const FONT = '/F1';
const BOLD_FONT = '/F2';

function cleanText(value) {
  return String(value == null ? '' : value)
    .replace(/[â‚¹₹]/g, 'Rs ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function amount(value) {
  return number(value).toFixed(2);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${date.getFullYear()}`;
}

function escapePdfText(value) {
  return cleanText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function textWidth(text, size) {
  return cleanText(text).length * size * 0.48;
}

function wrapLine(value, maxLength = 60) {
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

function drawText(lines, text, x, y, size = 8, options = {}) {
  const font = options.bold ? BOLD_FONT : FONT;
  const safeText = cleanText(text);
  let tx = x;
  if (options.align === 'right') {
    tx = x - textWidth(safeText, size);
  } else if (options.align === 'center') {
    tx = x - textWidth(safeText, size) / 2;
  }
  lines.push(`BT ${font} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfText(safeText)}) Tj ET`);
}

function drawLine(lines, x1, y1, x2, y2, width = 1) {
  lines.push(`${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
}

function drawRect(lines, x, y, width, height, lineWidth = 1) {
  lines.push(`${lineWidth} w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
}

function drawFilledRect(lines, x, y, width, height) {
  lines.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
}

function drawImage(lines, name, x, y, width, height) {
  lines.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${name} Do Q`);
}

function drawWrappedText(lines, value, x, y, maxLength, size = 8, maxLines = 3, options = {}) {
  const wrapped = wrapLine(value, maxLength).slice(0, maxLines);
  let currentY = y;
  wrapped.forEach((line) => {
    drawText(lines, line, x, currentY, size, options);
    currentY -= size + 2;
  });
  return currentY;
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

function clientAddress(order) {
  return [
    order.client_address,
    order.client_city,
  ].filter(Boolean).join(', ');
}

function shippingAddress(order) {
  const address = [
    order.shipping_address,
    order.shipping_city,
    order.shipping_state,
    order.shipping_country,
    order.shipping_pincode,
  ].filter(Boolean).join(', ');
  return address || clientAddress(order) || order.client_address || '';
}

function placeOfSupply(order) {
  return cleanText(order.vendor_state || order.client_city || 'RAJASTHAN');
}

function invoiceOrderNumber(order) {
  const orderNumber = cleanText(order.order_number);
  if (/^[0-9A-Z]{10}$/.test(orderNumber) && /[0-9]/.test(orderNumber) && /[A-Z]/.test(orderNumber)) return orderNumber;
  return `ORD${Number(order.id || 0).toString(36).toUpperCase().padStart(7, '0').slice(-7)}`;
}

function hsnForItem(item) {
  if (item.hsn_code) return cleanText(item.hsn_code);
  const tax = number(item.tax_percentage);
  if (tax >= 12) return '04039010';
  if (tax > 0) return '04012000';
  return '';
}

function itemDescription(item) {
  const parts = [item.product_name || 'Product'];
  if (item.weight_value && item.weight_unit) {
    parts.push(`${Number(item.weight_value).toFixed(3).replace(/\.?0+$/, '')} ${item.weight_unit}`);
  }
  return parts.join(' ');
}

function taxBreakdown(item) {
  const taxPercentage = number(item.tax_percentage);
  const taxAmount = number(item.tax_amount);
  return {
    cgstRate: taxPercentage / 2,
    sgstRate: taxPercentage / 2,
    cgstAmount: taxAmount / 2,
    sgstAmount: taxAmount / 2,
  };
}

function drawQr(lines, value, x, y, size = 96) {
  const qr = QRCode.create(String(value || ''), { errorCorrectionLevel: 'M' });
  const moduleCount = qr.modules.size;
  const quietZone = 4;
  const totalModules = moduleCount + quietZone * 2;
  const cell = size / totalModules;

  lines.push('1 g');
  drawFilledRect(lines, x, y - size, size, size);
  lines.push('0 g');
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      const filled = qr.modules.data[row * moduleCount + col];
      if (filled) {
        drawFilledRect(
          lines,
          x + (col + quietZone) * cell,
          y - (row + quietZone + 1) * cell,
          cell,
          cell
        );
      }
    }
  }
  drawRect(lines, x, y - size, size, size, 0.8);
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function parseJpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += 2 + length;
  }
  throw new Error('Invalid JPG signature image');
}

function pngBytesPerPixel(colorType) {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 6) return 4;
  throw new Error('Only grayscale, RGB, or RGBA PNG signatures are supported');
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function unfilterPng(raw, width, height, bytesPerPixel) {
  const rowLength = width * bytesPerPixel;
  const output = Buffer.alloc(rowLength * height);
  let source = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[source];
    source += 1;
    const rowOffset = row * rowLength;
    const previousOffset = rowOffset - rowLength;
    for (let col = 0; col < rowLength; col += 1) {
      const rawValue = raw[source + col];
      const left = col >= bytesPerPixel ? output[rowOffset + col - bytesPerPixel] : 0;
      const above = row > 0 ? output[previousOffset + col] : 0;
      const upperLeft = row > 0 && col >= bytesPerPixel ? output[previousOffset + col - bytesPerPixel] : 0;
      let value = rawValue;
      if (filter === 1) value = rawValue + left;
      if (filter === 2) value = rawValue + above;
      if (filter === 3) value = rawValue + Math.floor((left + above) / 2);
      if (filter === 4) value = rawValue + paethPredictor(left, above, upperLeft);
      output[rowOffset + col] = value & 0xff;
    }
    source += rowLength;
  }
  return output;
}

function parsePng(buffer) {
  const signature = buffer.slice(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error('Invalid PNG signature image');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = readUInt32(buffer, offset);
    const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === 'IHDR') {
      width = readUInt32(buffer, dataStart);
      height = readUInt32(buffer, dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
    } else if (type === 'IDAT') {
      idat.push(buffer.slice(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  if (bitDepth !== 8) throw new Error('Only 8-bit PNG signatures are supported');
  const bytesPerPixel = pngBytesPerPixel(colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = unfilterPng(raw, width, height, bytesPerPixel);
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < pixels.length; i += bytesPerPixel, j += 3) {
    if (colorType === 0) {
      rgb[j] = pixels[i];
      rgb[j + 1] = pixels[i];
      rgb[j + 2] = pixels[i];
    } else {
      const alpha = colorType === 6 ? pixels[i + 3] / 255 : 1;
      rgb[j] = Math.round(pixels[i] * alpha + 255 * (1 - alpha));
      rgb[j + 1] = Math.round(pixels[i + 1] * alpha + 255 * (1 - alpha));
      rgb[j + 2] = Math.round(pixels[i + 2] * alpha + 255 * (1 - alpha));
    }
  }
  return {
    width,
    height,
    data: zlib.deflateSync(rgb),
    filter: '/FlateDecode',
  };
}

function parseSignatureImage(buffer) {
  if (!buffer || !buffer.length) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    const size = parseJpegSize(buffer);
    return {
      ...size,
      data: buffer,
      filter: '/DCTDecode',
    };
  }
  return parsePng(buffer);
}

async function loadSignatureImage(signaturePath) {
  if (!signaturePath) return null;
  const normalized = String(signaturePath).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.startsWith('uploads/signatures/')) return null;
  const absolutePath = path.resolve(__dirname, '..', 'public', normalized);
  const uploadRoot = path.resolve(__dirname, '..', 'public', 'uploads', 'signatures');
  if (!absolutePath.startsWith(uploadRoot)) return null;
  try {
    return parseSignatureImage(await fs.readFile(absolutePath));
  } catch (error) {
    console.warn('Unable to load invoice signature image:', error.message);
    return null;
  }
}

function pdfObjectBuffer(object) {
  return Buffer.isBuffer(object) ? object : Buffer.from(object, 'latin1');
}

function imageObject(signatureImage) {
  const header = Buffer.from(
    `<< /Type /XObject /Subtype /Image /Width ${signatureImage.width} /Height ${signatureImage.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${signatureImage.filter} /Length ${signatureImage.data.length} >>\nstream\n`,
    'latin1'
  );
  return Buffer.concat([header, signatureImage.data, Buffer.from('\nendstream', 'latin1')]);
}

function drawCellText(lines, value, x, top, width, height, size = 7, options = {}) {
  const padding = 3;
  const maxChars = Math.max(4, Math.floor((width - padding * 2) / (size * 0.48)));
  const wrapped = wrapLine(value, maxChars).slice(0, options.maxLines || Math.max(1, Math.floor((height - 6) / (size + 2))));
  const lineHeight = size + 2;
  const blockHeight = wrapped.length * lineHeight;
  let y = top - (height - blockHeight) / 2 - size;
  wrapped.forEach((line) => {
    let tx = x + padding;
    if (options.align === 'right') {
      tx = x + width - padding;
    } else if (options.align === 'center') {
      tx = x + width / 2;
    }
    drawText(lines, line, tx, y, size, { bold: options.bold, align: options.align });
    y -= lineHeight;
  });
}

function invoiceColumns(enabledColumnKeys = DEFAULT_ENABLED_COLUMN_KEYS) {
  const enabled = new Set(enabledColumnKeys);
  const columns = [
    { label: 'SR\nNo', width: 20, key: 'sr', align: 'center' },
    { label: 'Item &\nDescription', width: 50, key: 'desc', align: 'center' },
    { label: 'Unit\nMRP/RSP', width: 44, key: 'mrp', align: 'center' },
    { label: 'HSN', width: 42, key: 'hsn', align: 'center' },
    { label: 'Qty', width: 24, key: 'qty', align: 'center' },
    { label: 'Product\nRate', width: 38, key: 'rate', align: 'center' },
    { label: 'Disc.', width: 32, key: 'disc', align: 'center' },
    { label: 'Taxable\nAmt.', width: 40, key: 'taxable', align: 'center' },
    { label: 'CGST', width: 34, key: 'cgstRate', align: 'center' },
    { label: 'S/UT\nGST', width: 34, key: 'sgstRate', align: 'center' },
    { label: 'CGST\nAmt.', width: 40, key: 'cgstAmt', align: 'center' },
    { label: 'S/UT\nGST\nAmt.', width: 40, key: 'sgstAmt', align: 'center' },
    { label: 'Cess', width: 32, key: 'cessRate', align: 'center' },
    { label: 'Cess\nAmt.', width: 32, key: 'cessAmt', align: 'center' },
    { label: 'Total\nAmt.', width: 43, key: 'total', align: 'center' },
  ];
  const visibleColumns = columns.filter((column) => enabled.has(column.key));
  return visibleColumns.length ? visibleColumns : columns;
}

function drawTable(lines, rows, top, enabledColumnKeys = DEFAULT_ENABLED_COLUMN_KEYS) {
  const columns = invoiceColumns(enabledColumnKeys);
  const baseWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const widthScale = CONTENT_WIDTH / baseWidth;
  const scaledColumns = columns.map((column) => ({
    ...column,
    width: column.width * widthScale,
  }));
  const totalWidth = scaledColumns.reduce((sum, column) => sum + column.width, 0);
  const startX = LEFT;
  const headerHeight = 46;
  const rowHeight = Math.max(48, Math.min(86, rows.length > 3 ? 52 : 72));
  const tableHeight = headerHeight + rows.length * rowHeight + 18;
  drawRect(lines, startX, top - tableHeight, totalWidth, tableHeight, 1.4);

  let x = startX;
  scaledColumns.forEach((column) => {
    drawLine(lines, x, top, x, top - tableHeight, 1.1);
    drawCellText(lines, column.label, x, top, column.width, headerHeight, 7, { bold: true, align: 'center', maxLines: 3 });
    x += column.width;
  });
  drawLine(lines, startX + totalWidth, top, startX + totalWidth, top - tableHeight, 1.1);
  drawLine(lines, startX, top - headerHeight, startX + totalWidth, top - headerHeight, 1.1);

  let rowTop = top - headerHeight;
  rows.forEach((row) => {
    drawLine(lines, startX, rowTop - rowHeight, startX + totalWidth, rowTop - rowHeight, 1.1);
    let cellX = startX;
    scaledColumns.forEach((column) => {
      drawCellText(lines, row[column.key], cellX, rowTop, column.width, rowHeight, column.key === 'desc' ? 6.8 : 7, {
        align: column.align,
        maxLines: column.key === 'desc' ? 7 : 2,
      });
      cellX += column.width;
    });
    rowTop -= rowHeight;
  });

  const totals = rows.reduce((acc, row) => {
    acc.taxable += number(row.rawTaxable);
    acc.cgst += number(row.rawCgst);
    acc.sgst += number(row.rawSgst);
    acc.cess += number(row.rawCess);
    acc.total += number(row.rawTotal);
    return acc;
  }, { taxable: 0, cgst: 0, sgst: 0, cess: 0, total: 0 });

  const totalRowTop = top - headerHeight - rows.length * rowHeight;
  const totalRowHeight = 18;
  let cellX = startX;
  scaledColumns.forEach((column) => {
    let value = '';
    if (column.key === 'taxable') value = amount(totals.taxable);
    if (column.key === 'cgstAmt') value = amount(totals.cgst);
    if (column.key === 'sgstAmt') value = amount(totals.sgst);
    if (column.key === 'cessAmt') value = amount(totals.cess);
    if (column.key === 'total') value = amount(totals.total);
    drawCellText(lines, value, cellX, totalRowTop, column.width, totalRowHeight, 7, { align: 'center' });
    cellX += column.width;
  });
  return { bottom: top - tableHeight, totals };
}

function buildRows(items) {
  return items.map((item, index) => {
    const qty = number(item.quantity);
    const rate = number(item.unit_price);
    const gross = rate * qty;
    const taxable = number(item.taxable_amount) || Math.max(0, gross - number(item.tax_amount));
    const total = number(item.line_total) || gross;
    const discount = gross > 0 ? Math.max(0, ((gross - taxable - number(item.tax_amount)) / gross) * 100) : 0;
    const tax = taxBreakdown(item);
    return {
      sr: String(index + 1),
      desc: itemDescription(item),
      mrp: amount(rate),
      hsn: hsnForItem(item),
      qty: String(qty),
      rate: amount(qty ? taxable / qty : rate),
      disc: `${discount.toFixed(2)}%`,
      taxable: amount(taxable),
      cgstRate: `${tax.cgstRate.toFixed(2)}%`,
      sgstRate: `${tax.sgstRate.toFixed(2)}%`,
      cgstAmt: amount(tax.cgstAmount),
      sgstAmt: amount(tax.sgstAmount),
      cessRate: '0.00%\n+ 0.00',
      cessAmt: '0.00',
      total: amount(total),
      rawTaxable: taxable,
      rawCgst: tax.cgstAmount,
      rawSgst: tax.sgstAmount,
      rawCess: 0,
      rawTotal: total,
    };
  });
}

function buildPdfBuffer(order, items, options = {}) {
  const invoiceNumber = order.invoice_number || `INV-${String(order.id).padStart(6, '0')}`;
  const rows = buildRows(items);
  const lines = [];
  const storeName = vendorStoreName(order);
  const storeAddress = vendorAddress(order);
  const gstNumber = cleanText(order.vendor_gst_number || '08AAKCC1645G1ZP');
  const client = cleanText(order.client_name || 'Client');
  const billingAddress = clientAddress(order) || order.client_address || '';
  const shippingName = cleanText(order.shipping_name || order.client_name || 'Client');
  const destinationAddress = shippingAddress(order);
  const invoiceDate = formatDate(order.invoice_generated_at || new Date());
  const orderNo = invoiceOrderNumber(order);
  const footerReverseChargeText = cleanText(options.reverseChargeText || DEFAULT_REVERSE_CHARGE_TEXT);
  const footerSerialInfoText = cleanText(options.serialInfoText || DEFAULT_SERIAL_INFO_TEXT);
  const footerLegalNote = cleanText(options.legalNote || '');
  const footerDeliveryName = cleanText(options.deliveryFromName || storeName);
  const footerDeliveryAddress = cleanText(options.deliveryFromAddress || storeAddress);
  const footerDeliveryFssai = cleanText(options.deliveryFromFssai || order.vendor_fssai || '');
  const footerPlatformName = cleanText(options.platformName || DEFAULT_PLATFORM_NAME);
  const footerPlatformAddress = cleanText(options.platformAddress || '');
  const footerPlatformFssai = cleanText(options.platformFssai || '');
  const footerPlatformEmail = cleanText(options.platformEmail || '');

  let y = 800;
  drawText(lines, `Seller Name: ${storeName}`, LEFT, y, 16, { bold: true });
  drawQr(lines, order.public_invoice_url || `${invoiceNumber}|${orderNo}|${amount(order.total_amount)}`, 465, 810, 96);
  y -= 24;
  drawWrappedText(lines, storeAddress || 'Plot no G30,G67,G68, Kandhari yogna, kalwar road,Govindpura, Jhotwara,Jaipur', LEFT, y, 78, 7, 2, { bold: true });
  y -= 28;
  drawText(lines, `GSTIN: ${gstNumber}`, LEFT, y, 8, { bold: true });
  y -= 15;
  drawText(lines, `FSSAI: ${cleanText(order.vendor_fssai || '12822999000310')}`, LEFT, y, 8, { bold: true });
  y -= 24;
  drawLine(lines, LEFT, y, RIGHT, y, 1.5);
  y -= 14;
  drawText(lines, 'TAX INVOICE/BILL OF SUPPLY', PAGE_WIDTH / 2, y, 9, { bold: true, align: 'center' });
  y -= 6;

  const metaTop = y;
  const metaHeight = 37;
  drawRect(lines, LEFT, metaTop - metaHeight, CONTENT_WIDTH, metaHeight, 1.2);
  drawLine(lines, LEFT + CONTENT_WIDTH / 2, metaTop, LEFT + CONTENT_WIDTH / 2, metaTop - metaHeight, 1);
  drawText(lines, `Invoice No.: ${invoiceNumber}`, LEFT + 10, metaTop - 13, 8, { bold: true });
  drawText(lines, `Order No.: ${orderNo}`, LEFT + 10, metaTop - 29, 8, { bold: true });
  drawText(lines, `Place Of Supply : ${placeOfSupply(order)} (8)`, LEFT + CONTENT_WIDTH / 2 + 10, metaTop - 13, 8, { bold: true });
  drawText(lines, `Date : ${invoiceDate}`, LEFT + CONTENT_WIDTH / 2 + 10, metaTop - 29, 8, { bold: true });

  y = metaTop - metaHeight;
  const addressTop = y;
  const addressHeight = 61;
  drawRect(lines, LEFT, addressTop - addressHeight, CONTENT_WIDTH, addressHeight, 1.2);
  drawLine(lines, LEFT + CONTENT_WIDTH / 2, addressTop, LEFT + CONTENT_WIDTH / 2, addressTop - addressHeight, 1);
  drawLine(lines, LEFT, addressTop - 17, RIGHT, addressTop - 17, 1);
  drawText(lines, 'Bill To', LEFT + 10, addressTop - 12, 8, { bold: true });
  drawText(lines, 'Shipping Address', LEFT + CONTENT_WIDTH / 2 + 10, addressTop - 12, 8, { bold: true });
  drawText(lines, client, LEFT + 10, addressTop - 31, 8, { bold: true });
  drawWrappedText(lines, billingAddress || destinationAddress, LEFT + 10, addressTop - 43, 53, 7, 3);
  drawText(lines, shippingName, LEFT + CONTENT_WIDTH / 2 + 10, addressTop - 31, 8, { bold: true });
  drawWrappedText(lines, destinationAddress || billingAddress, LEFT + CONTENT_WIDTH / 2 + 10, addressTop - 43, 53, 7, 3);

  y = addressTop - addressHeight - 10;
  const table = drawTable(
    lines,
    rows.length ? rows : buildRows([{ product_name: 'Product', quantity: 0, unit_price: 0 }]),
    y,
    options.enabledProductColumns
  );
  y = table.bottom - 18;
  const invoiceTotal = number(order.total_amount) || table.totals.total;
  const deliveryCharge = number(order.delivery_charge);
  const platformFee = number(order.platform_fee);
  const itemTotal = number(order.subtotal_amount) || Math.max(invoiceTotal - deliveryCharge - platformFee, 0) || table.totals.total;
  const roundedTotal = Math.round(invoiceTotal);
  const roundOff = roundedTotal - invoiceTotal;

  drawText(lines, 'Item Total', LEFT, y, 8, { bold: true });
  drawText(lines, amount(itemTotal), RIGHT, y, 8, { bold: true, align: 'right' });
  y -= 14;
  drawText(lines, 'Delivery Charge', LEFT, y, 8, { bold: true });
  drawText(lines, amount(deliveryCharge), RIGHT, y, 8, { bold: true, align: 'right' });
  y -= 14;
  drawText(lines, 'Platform Fee', LEFT, y, 8, { bold: true });
  drawText(lines, amount(platformFee), RIGHT, y, 8, { bold: true, align: 'right' });
  y -= 14;
  drawText(lines, 'Round off to', LEFT, y, 8);
  drawText(lines, amount(roundOff), RIGHT, y, 8, { bold: true, align: 'right' });
  y -= 6;
  drawLine(lines, LEFT, y, RIGHT, y, 1.2);
  y -= 13;
  drawText(lines, 'Invoice Value', LEFT, y, 8, { bold: true });
  drawText(lines, amount(roundedTotal), RIGHT, y, 8, { bold: true, align: 'right' });
  y -= 7;
  drawLine(lines, LEFT, y, RIGHT, y, 1.2);
  y -= 23;

  drawWrappedText(lines, footerReverseChargeText, LEFT, y, 96, 7, 1);
  y -= 19;
  drawWrappedText(lines, footerSerialInfoText, LEFT, y, 96, 7, 1);
  y -= 18;
  if (footerLegalNote) {
    drawWrappedText(lines, footerLegalNote, LEFT, y, 96, 7, 2);
  }

  drawText(lines, 'Authorized Signatory', RIGHT - 18, 116, 8, { align: 'right' });
  if (options.signatureImage) {
    const maxWidth = 110;
    const maxHeight = 40;
    const scale = Math.min(maxWidth / options.signatureImage.width, maxHeight / options.signatureImage.height);
    const width = options.signatureImage.width * scale;
    const height = options.signatureImage.height * scale;
    drawImage(lines, 'SigImg', RIGHT - 128, 123, width, height);
  } else {
    drawLine(lines, RIGHT - 120, 132, RIGHT - 24, 112, 1);
    drawLine(lines, RIGHT - 118, 123, RIGHT - 45, 142, 0.8);
  }

  drawText(lines, 'Order Delivered From -', LEFT, 78, 8, { bold: true });
  drawWrappedText(lines, footerDeliveryName, LEFT, 65, 42, 8, 1);
  if (footerDeliveryAddress) {
    drawWrappedText(lines, footerDeliveryAddress, LEFT, 47, 84, 7, 2);
  }
  if (footerDeliveryFssai) {
    drawText(lines, `FSSAI: ${footerDeliveryFssai}`, LEFT, 15, 7);
  }
  drawText(lines, 'E-commerce Platform (FBO) Information -', 350, 78, 8, { bold: true });
  drawWrappedText(lines, footerPlatformName, 350, 65, 52, 8, 1);
  if (footerPlatformAddress) {
    drawWrappedText(lines, footerPlatformAddress, 350, 51, 66, 7, 2);
  }
  if (footerPlatformFssai) {
    drawText(lines, `FSSAI Lic. No: ${footerPlatformFssai}`, 350, 24, 7);
  }
  if (footerPlatformEmail) {
    drawText(lines, `Email: ${footerPlatformEmail}`, 350, 12, 7);
  }

  const content = `q\n0 g\n1 w\n${lines.join('\n')}\nQ`;
  const xObjectResources = options.signatureImage ? ' /XObject << /SigImg 7 0 R >>' : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${xObjectResources} >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  if (options.signatureImage) {
    objects.push(imageObject(options.signatureImage));
  }
  let pdf = Buffer.from('%PDF-1.4\n', 'latin1');
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf = Buffer.concat([
      pdf,
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      pdfObjectBuffer(object),
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
  });
  const xrefOffset = pdf.length;
  let trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    trailer += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  trailer += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.concat([pdf, Buffer.from(trailer, 'latin1')]);
}

async function ensureInvoice(order, items, options = {}) {
  if (!order) throw new Error('Order is required');
  await fs.mkdir(invoiceDir, { recursive: true });

  const invoiceNumber = order.invoice_number || `INV-${String(order.id).padStart(6, '0')}`;
  const relativePath = order.invoice_pdf_path || path.join('storage', 'invoices', `${invoiceNumber}.pdf`);
  const absolutePath = path.join(__dirname, '..', relativePath);

  const generatedAt = order.invoice_generated_at || new Date();
  const signatureImage = await loadSignatureImage(order.vendor_signature_path);
  const invoiceSettings = await getInvoiceSettings();
  const buffer = buildPdfBuffer({
    ...order,
    invoice_number: invoiceNumber,
    invoice_generated_at: generatedAt,
    public_invoice_url: options.publicInvoiceUrl || order.public_invoice_url || '',
  }, items, {
    signatureImage,
    platformName: invoiceSettings.platformName,
    reverseChargeText: invoiceSettings.reverseChargeText,
    serialInfoText: invoiceSettings.serialInfoText,
    legalNote: invoiceSettings.legalNote,
    deliveryFromName: invoiceSettings.deliveryFromName,
    deliveryFromAddress: invoiceSettings.deliveryFromAddress,
    deliveryFromFssai: invoiceSettings.deliveryFromFssai,
    platformAddress: invoiceSettings.platformAddress,
    platformFssai: invoiceSettings.platformFssai,
    platformEmail: invoiceSettings.platformEmail,
    enabledProductColumns: invoiceSettings.enabledProductColumns,
  });
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
