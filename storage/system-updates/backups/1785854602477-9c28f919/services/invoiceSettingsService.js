const pool = require('../db');

const DEFAULT_PLATFORM_NAME = 'ZEPTO MARKETPLACE PRIVATE LIMITED';
const DEFAULT_REVERSE_CHARGE_TEXT = 'Whether GST is payable on reverse-charge - No.';
const DEFAULT_SERIAL_INFO_TEXT = 'For IMEI / Serial number information, please refer to packaging / warranty slip.';
const DEFAULT_LEGAL_NOTE = 'Note: Effective 1st Feb 2026, The valuation of the tobacco and pan masala products is made in accordance with Rule 31D of the CGST Rules, 2017.';
const DEFAULT_PLATFORM_ADDRESS = 'First Floor, 773, Sarjapur Main Road, Kaikondarahalli, Bellandur, Bangalore, Karnataka, India 560103';
const DEFAULT_PLATFORM_FSSAI = '11224999000872';
const DEFAULT_PLATFORM_EMAIL = 'support@zeptonow.com';

const INVOICE_PRODUCT_COLUMNS = [
  { key: 'sr', label: 'SR No' },
  { key: 'desc', label: 'Item & Description' },
  { key: 'mrp', label: 'Unit MRP/RSP' },
  { key: 'hsn', label: 'HSN' },
  { key: 'qty', label: 'Qty' },
  { key: 'rate', label: 'Product Rate' },
  { key: 'disc', label: 'Disc.' },
  { key: 'taxable', label: 'Taxable Amt.' },
  { key: 'cgstRate', label: 'CGST' },
  { key: 'sgstRate', label: 'S/UT GST' },
  { key: 'cgstAmt', label: 'CGST Amt.' },
  { key: 'sgstAmt', label: 'S/UT GST Amt.' },
  { key: 'cessRate', label: 'Cess' },
  { key: 'cessAmt', label: 'Cess Amt.' },
  { key: 'total', label: 'Total Amt.' },
];

const DEFAULT_ENABLED_COLUMN_KEYS = INVOICE_PRODUCT_COLUMNS.map((column) => column.key);

async function settingValue(key, fallback = '') {
  const [rows] = await pool.query(
    'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
    [key]
  );
  return rows[0] && rows[0].setting_value != null ? rows[0].setting_value : fallback;
}

async function saveSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (setting_key, setting_value, is_secret)
     VALUES (?, ?, 0)
     ON CONFLICT (setting_key) DO UPDATE
     SET setting_value = EXCLUDED.setting_value,
         is_secret = 0,
         updated_at = CURRENT_TIMESTAMP`,
    [key, value]
  );
}

function normalizeEnabledColumns(value) {
  const allowed = new Set(INVOICE_PRODUCT_COLUMNS.map((column) => column.key));
  const source = Array.isArray(value) ? value : DEFAULT_ENABLED_COLUMN_KEYS;
  const normalized = source.filter((key, index) => (
    allowed.has(key) && source.indexOf(key) === index
  ));
  return normalized.length ? normalized : DEFAULT_ENABLED_COLUMN_KEYS;
}

function parseEnabledColumns(rawValue) {
  if (!rawValue) return DEFAULT_ENABLED_COLUMN_KEYS;
  try {
    return normalizeEnabledColumns(JSON.parse(rawValue));
  } catch {
    return DEFAULT_ENABLED_COLUMN_KEYS;
  }
}

async function getInvoiceSettings() {
  const [
    platformName,
    rawColumns,
    reverseChargeText,
    serialInfoText,
    legalNote,
    deliveryFromName,
    deliveryFromAddress,
    deliveryFromFssai,
    platformAddress,
    platformFssai,
    platformEmail,
  ] = await Promise.all([
    settingValue('invoice_platform_name', DEFAULT_PLATFORM_NAME),
    settingValue('invoice_product_columns', ''),
    settingValue('invoice_reverse_charge_text', DEFAULT_REVERSE_CHARGE_TEXT),
    settingValue('invoice_serial_info_text', DEFAULT_SERIAL_INFO_TEXT),
    settingValue('invoice_legal_note', DEFAULT_LEGAL_NOTE),
    settingValue('invoice_delivery_from_name', ''),
    settingValue('invoice_delivery_from_address', ''),
    settingValue('invoice_delivery_from_fssai', ''),
    settingValue('invoice_platform_address', DEFAULT_PLATFORM_ADDRESS),
    settingValue('invoice_platform_fssai', DEFAULT_PLATFORM_FSSAI),
    settingValue('invoice_platform_email', DEFAULT_PLATFORM_EMAIL),
  ]);
  return {
    platformName: String(platformName || '').trim() || DEFAULT_PLATFORM_NAME,
    reverseChargeText: String(reverseChargeText || '').trim() || DEFAULT_REVERSE_CHARGE_TEXT,
    serialInfoText: String(serialInfoText || '').trim() || DEFAULT_SERIAL_INFO_TEXT,
    legalNote: String(legalNote || '').trim() || DEFAULT_LEGAL_NOTE,
    deliveryFromName: String(deliveryFromName || '').trim(),
    deliveryFromAddress: String(deliveryFromAddress || '').trim(),
    deliveryFromFssai: String(deliveryFromFssai || '').trim(),
    platformAddress: String(platformAddress || '').trim() || DEFAULT_PLATFORM_ADDRESS,
    platformFssai: String(platformFssai || '').trim() || DEFAULT_PLATFORM_FSSAI,
    platformEmail: String(platformEmail || '').trim() || DEFAULT_PLATFORM_EMAIL,
    productColumns: INVOICE_PRODUCT_COLUMNS,
    enabledProductColumns: parseEnabledColumns(rawColumns),
  };
}

async function saveInvoiceSettings({
  platformName,
  reverseChargeText,
  serialInfoText,
  legalNote,
  deliveryFromName,
  deliveryFromAddress,
  deliveryFromFssai,
  platformAddress,
  platformFssai,
  platformEmail,
  enabledProductColumns,
}) {
  const cleanPlatformName = String(platformName || '').trim() || DEFAULT_PLATFORM_NAME;
  const cleanReverseChargeText = String(reverseChargeText || '').trim() || DEFAULT_REVERSE_CHARGE_TEXT;
  const cleanSerialInfoText = String(serialInfoText || '').trim() || DEFAULT_SERIAL_INFO_TEXT;
  const cleanLegalNote = String(legalNote || '').trim() || DEFAULT_LEGAL_NOTE;
  const cleanDeliveryFromName = String(deliveryFromName || '').trim();
  const cleanDeliveryFromAddress = String(deliveryFromAddress || '').trim();
  const cleanDeliveryFromFssai = String(deliveryFromFssai || '').trim();
  const cleanPlatformAddress = String(platformAddress || '').trim() || DEFAULT_PLATFORM_ADDRESS;
  const cleanPlatformFssai = String(platformFssai || '').trim() || DEFAULT_PLATFORM_FSSAI;
  const cleanPlatformEmail = String(platformEmail || '').trim() || DEFAULT_PLATFORM_EMAIL;
  const columns = normalizeEnabledColumns(enabledProductColumns);
  await Promise.all([
    saveSetting('invoice_platform_name', cleanPlatformName),
    saveSetting('invoice_reverse_charge_text', cleanReverseChargeText),
    saveSetting('invoice_serial_info_text', cleanSerialInfoText),
    saveSetting('invoice_legal_note', cleanLegalNote),
    saveSetting('invoice_delivery_from_name', cleanDeliveryFromName),
    saveSetting('invoice_delivery_from_address', cleanDeliveryFromAddress),
    saveSetting('invoice_delivery_from_fssai', cleanDeliveryFromFssai),
    saveSetting('invoice_platform_address', cleanPlatformAddress),
    saveSetting('invoice_platform_fssai', cleanPlatformFssai),
    saveSetting('invoice_platform_email', cleanPlatformEmail),
    saveSetting('invoice_product_columns', JSON.stringify(columns)),
  ]);
  return {
    platformName: cleanPlatformName,
    reverseChargeText: cleanReverseChargeText,
    serialInfoText: cleanSerialInfoText,
    legalNote: cleanLegalNote,
    deliveryFromName: cleanDeliveryFromName,
    deliveryFromAddress: cleanDeliveryFromAddress,
    deliveryFromFssai: cleanDeliveryFromFssai,
    platformAddress: cleanPlatformAddress,
    platformFssai: cleanPlatformFssai,
    platformEmail: cleanPlatformEmail,
    productColumns: INVOICE_PRODUCT_COLUMNS,
    enabledProductColumns: columns,
  };
}

module.exports = {
  DEFAULT_PLATFORM_NAME,
  DEFAULT_REVERSE_CHARGE_TEXT,
  DEFAULT_SERIAL_INFO_TEXT,
  DEFAULT_LEGAL_NOTE,
  DEFAULT_PLATFORM_ADDRESS,
  DEFAULT_PLATFORM_FSSAI,
  DEFAULT_PLATFORM_EMAIL,
  INVOICE_PRODUCT_COLUMNS,
  DEFAULT_ENABLED_COLUMN_KEYS,
  getInvoiceSettings,
  saveInvoiceSettings,
};
