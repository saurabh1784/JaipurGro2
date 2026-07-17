const pool = require('../db');

const APP_VALUES = ['client', 'vendor', 'delivery'];
const PAGE_VALUES = [
  'privacy-policy',
  'terms-and-conditions',
  'cookie-policy',
  'refund-policy',
  'disclaimer',
];
const DEMO_PAGE_VALUES = ['privacy-policy', 'terms-and-conditions'];
const STATUS_VALUES = ['draft', 'published'];
const cache = new Map();

function normalizeAppName(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (normalized === 'delivery-partner' || normalized === 'delivery-partner-app') return 'delivery';
  return normalized;
}

function normalizePageType(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (normalized === 'terms' || normalized === 'terms-conditions') return 'terms-and-conditions';
  if (normalized === 'privacy') return 'privacy-policy';
  return normalized;
}

function validateAppName(value) {
  const appName = normalizeAppName(value);
  if (!APP_VALUES.includes(appName)) {
    const error = new Error('Invalid app name. Use client, vendor, or delivery.');
    error.status = 422;
    throw error;
  }
  return appName;
}

function validatePageType(value) {
  const pageType = normalizePageType(value);
  if (!PAGE_VALUES.includes(pageType)) {
    const error = new Error('Invalid page type. Use privacy-policy, terms-and-conditions, cookie-policy, refund-policy, or disclaimer.');
    error.status = 422;
    throw error;
  }
  return pageType;
}

function normalizeStatus(value) {
  const status = String(value || 'draft').trim().toLowerCase();
  return STATUS_VALUES.includes(status) ? status : 'draft';
}

function titleFor(pageType) {
  return {
    'privacy-policy': 'Privacy Policy',
    'terms-and-conditions': 'Terms & Conditions',
    'cookie-policy': 'Cookie Policy',
    'refund-policy': 'Refund Policy',
    disclaimer: 'Disclaimer',
  }[pageType] || 'Legal Page';
}

function appLabelFor(appName) {
  return {
    client: 'Client App',
    vendor: 'Vendor App',
    delivery: 'Delivery Partner App',
  }[appName] || appName;
}

function stripUnsafeHtml(value) {
  let html = String(value || '').trim();
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?\s*>/gi, '');
  html = html.replace(/\s+on[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '');
  html = html.replace(/\s+(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');
  html = html.replace(/\s+(href|src)\s*=\s*javascript:[^\s>]+/gi, ' $1="#"');
  return html;
}

function cacheKey(appName, pageType) {
  return `${appName}:${pageType}`;
}

function clearCache(appName, pageType) {
  if (appName && pageType) {
    cache.delete(cacheKey(appName, pageType));
    return;
  }
  cache.clear();
}

function validatePayload(data) {
  const appName = validateAppName(data.app_name || data.appName);
  const pageType = validatePageType(data.page_type || data.pageType);
  const title = String(data.title || titleFor(pageType)).trim().slice(0, 180);
  const contentHtml = stripUnsafeHtml(data.content_html || data.contentHtml);
  const status = normalizeStatus(data.status);
  const isEnabled = data.is_enabled === undefined && data.isEnabled === undefined
    ? true
    : Boolean(data.is_enabled ?? data.isEnabled);

  if (!contentHtml || contentHtml.replace(/<[^>]*>/g, '').trim().length < 10) {
    const error = new Error('Content must contain at least 10 characters.');
    error.status = 422;
    throw error;
  }

  if (contentHtml.length > 60000) {
    const error = new Error('Content is too long.');
    error.status = 422;
    throw error;
  }

  return {
    app_name: appName,
    page_type: pageType,
    title: title || titleFor(pageType),
    content_html: contentHtml,
    status,
    is_enabled: isEnabled ? 1 : 0,
  };
}

function normalize(row) {
  if (!row) return null;
  const appName = normalizeAppName(row.app_name);
  const pageType = normalizePageType(row.page_type);
  return {
    id: row.id,
    app_name: appName,
    appName,
    app_label: appLabelFor(appName),
    appLabel: appLabelFor(appName),
    page_type: pageType,
    pageType,
    title: row.title || titleFor(pageType),
    content_html: row.content_html || '',
    contentHtml: row.content_html || '',
    status: normalizeStatus(row.status),
    is_enabled: Number(row.is_enabled ?? 1) === 1,
    isEnabled: Number(row.is_enabled ?? 1) === 1,
    current_version: Number(row.current_version || 1),
    currentVersion: Number(row.current_version || 1),
    created_at: row.created_at,
    updated_at: row.updated_at,
    updatedAt: row.updated_at,
  };
}

function normalizeHistory(row) {
  if (!row) return null;
  return {
    id: row.id,
    page_id: row.page_id,
    pageId: row.page_id,
    version: Number(row.version || 1),
    title: row.title || '',
    content_html: row.content_html || '',
    contentHtml: row.content_html || '',
    status: normalizeStatus(row.status),
    is_enabled: Number(row.is_enabled ?? 1) === 1,
    isEnabled: Number(row.is_enabled ?? 1) === 1,
    created_at: row.created_at,
    createdAt: row.created_at,
  };
}

async function list(filters = {}) {
  const params = [];
  const where = [];
  if (filters.app_name || filters.appName) {
    where.push('app_name = ?');
    params.push(validateAppName(filters.app_name || filters.appName));
  }
  if (filters.page_type || filters.pageType) {
    where.push('page_type = ?');
    params.push(validatePageType(filters.page_type || filters.pageType));
  }
  if (filters.status) {
    where.push('status = ?');
    params.push(normalizeStatus(filters.status));
  }
  if (filters.q) {
    where.push('(LOWER(title) LIKE ? OR LOWER(content_html) LIKE ?)');
    const term = `%${String(filters.q).trim().toLowerCase()}%`;
    params.push(term, term);
  }
  const [rows] = await pool.query(
    `SELECT * FROM content_pages${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY app_name ASC, page_type ASC`,
    params
  );
  return rows.map(normalize);
}

async function find(appNameValue, pageTypeValue) {
  const appName = validateAppName(appNameValue);
  const pageType = validatePageType(pageTypeValue);
  const [rows] = await pool.query(
    'SELECT * FROM content_pages WHERE app_name = ? AND page_type = ? LIMIT 1',
    [appName, pageType]
  );
  return normalize(rows[0]);
}

async function publicFind(appNameValue, pageTypeValue) {
  const appName = validateAppName(appNameValue);
  const pageType = validatePageType(pageTypeValue);
  const key = cacheKey(appName, pageType);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.page;

  const page = await find(appName, pageType);
  if (!page) {
    const error = new Error('Legal page not found.');
    error.status = 404;
    throw error;
  }
  if (!page.is_enabled) {
    const error = new Error('This legal page is temporarily unavailable. Please try again later.');
    error.status = 404;
    error.code = 'LEGAL_PAGE_DISABLED';
    throw error;
  }
  if (page.status !== 'published') {
    const error = new Error('This legal page is not published yet.');
    error.status = 404;
    error.code = 'LEGAL_PAGE_UNPUBLISHED';
    throw error;
  }
  cache.set(key, { page, expiresAt: Date.now() + 5 * 60 * 1000 });
  return page;
}

async function recordHistory(page) {
  await pool.query(
    `INSERT INTO content_page_versions (page_id, version, title, content_html, status, is_enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [page.id, page.current_version, page.title, page.content_html, page.status, page.is_enabled ? 1 : 0]
  );
}

async function save(data) {
  const payload = validatePayload(data);
  const existing = await find(payload.app_name, payload.page_type).catch((error) => {
    if (error.status === 422) throw error;
    return null;
  });

  if (existing) {
    const nextVersion = Number(existing.current_version || 1) + 1;
    await pool.query(
      `UPDATE content_pages
       SET title = ?, content_html = ?, status = ?, is_enabled = ?, current_version = ?, updated_at = CURRENT_TIMESTAMP
       WHERE app_name = ? AND page_type = ?`,
      [payload.title, payload.content_html, payload.status, payload.is_enabled, nextVersion, payload.app_name, payload.page_type]
    );
  } else {
    await pool.query(
      `INSERT INTO content_pages (app_name, page_type, title, content_html, status, is_enabled, current_version)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [payload.app_name, payload.page_type, payload.title, payload.content_html, payload.status, payload.is_enabled]
    );
  }

  const page = await find(payload.app_name, payload.page_type);
  await recordHistory(page);
  clearCache(payload.app_name, payload.page_type);
  return page;
}

async function history(appNameValue, pageTypeValue) {
  const page = await find(appNameValue, pageTypeValue);
  if (!page) return [];
  const [rows] = await pool.query(
    'SELECT * FROM content_page_versions WHERE page_id = ? ORDER BY version DESC, id DESC',
    [page.id]
  );
  return rows.map(normalizeHistory);
}

async function restore(appNameValue, pageTypeValue, versionValue) {
  const page = await find(appNameValue, pageTypeValue);
  if (!page) {
    const error = new Error('Legal page not found.');
    error.status = 404;
    throw error;
  }
  const version = Number(versionValue || 0);
  const [rows] = await pool.query(
    'SELECT * FROM content_page_versions WHERE page_id = ? AND version = ? ORDER BY id DESC LIMIT 1',
    [page.id, version]
  );
  const snapshot = normalizeHistory(rows[0]);
  if (!snapshot) {
    const error = new Error('Version was not found.');
    error.status = 404;
    throw error;
  }
  return save({
    app_name: page.app_name,
    page_type: page.page_type,
    title: snapshot.title,
    content_html: snapshot.content_html,
    status: snapshot.status,
    is_enabled: snapshot.is_enabled,
  });
}

async function copy(sourceAppValue, sourcePageValue, targetAppValue, targetPageValue) {
  const source = await find(sourceAppValue, sourcePageValue);
  if (!source) {
    const error = new Error('Source legal page was not found.');
    error.status = 404;
    throw error;
  }
  return save({
    app_name: targetAppValue,
    page_type: targetPageValue || source.page_type,
    title: source.title,
    content_html: source.content_html,
    status: 'draft',
    is_enabled: source.is_enabled,
  });
}

function sectionList(items) {
  return `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function demoTerms(appName) {
  const appLabel = appLabelFor(appName);
  return `
<h2>Introduction</h2><p>Welcome to groxen ${appLabel}. These Terms & Conditions govern your access to and use of our grocery, delivery, marketplace, account, payment, and support services. By creating an account or using the platform, you agree to these terms.</p>
<h2>User Responsibilities</h2>${sectionList(['Provide accurate registration, contact, billing, service, and delivery information.', 'Keep your login credentials secure and notify us immediately of unauthorized account activity.', 'Use the platform only for lawful personal or business purposes connected with groxen services.'])}
<h2>Account Rules</h2><p>You are responsible for all activity under your account. groxen may verify identity, phone number, location, tax, business, or delivery eligibility details before enabling certain features.</p>
<h2>Orders and Payments</h2><p>Orders, quotations, vendor submissions, delivery assignments, fees, taxes, platform charges, and payment collections are processed according to the prices and terms shown at checkout or confirmation. You authorize groxen and its payment partners to process eligible charges, refunds, and adjustments.</p>
<h2>Cancellations and Refunds</h2><p>Cancellation and refund eligibility depends on order status, product type, vendor acceptance, dispatch state, delivery progress, and applicable law. Approved refunds may be returned to the original payment method, wallet, or another supported mode.</p>
<h2>Service Availability</h2><p>Services may vary by city, area, vendor availability, delivery capacity, inventory, weather, traffic, maintenance, and operational conditions. We may modify, pause, or discontinue features when required.</p>
<h2>Prohibited Activities</h2>${sectionList(['Misusing coupons, wallets, referral benefits, ratings, support, or payment flows.', 'Uploading false, unlawful, abusive, infringing, misleading, or harmful content.', 'Attempting to reverse engineer, overload, scrape, bypass security, or disrupt the platform.'])}
<h2>Intellectual Property</h2><p>groxen names, logos, software, workflows, product displays, content, and designs are owned by groxen or licensed to us. You may not copy, modify, resell, or exploit them without written permission.</p>
<h2>Limitation of Liability</h2><p>To the maximum extent allowed by law, groxen is not liable for indirect, incidental, special, punitive, or consequential losses, including loss of profit, revenue, data, goodwill, or business opportunity.</p>
<h2>Account Suspension</h2><p>We may restrict, suspend, or terminate access for suspected fraud, safety risks, policy violations, payment failures, repeated cancellations, abusive behavior, or legal compliance reasons.</p>
<h2>Changes to Terms</h2><p>We may update these Terms from time to time. Continued use after publication means you accept the updated Terms.</p>
<h2>Contact Information</h2><p>For questions about these Terms, contact groxen support at support@groxen.com.</p>`;
}

function demoPrivacy(appName) {
  const appLabel = appLabelFor(appName);
  return `
<h2>Information We Collect</h2><p>groxen ${appLabel} may collect your name, phone number, email address, login details, profile information, address, location, order history, transaction records, device information, support messages, ratings, uploaded documents, and operational activity required to provide our services.</p>
<h2>How We Use Your Information</h2>${sectionList(['Create and manage your account and profile.', 'Process orders, quotations, payments, deliveries, refunds, wallet entries, support tickets, and notifications.', 'Improve safety, fraud prevention, service reliability, personalization, analytics, and customer experience.'])}
<h2>Location Permissions</h2><p>When enabled, location data helps show service areas, calculate delivery charges, assign delivery partners, display route progress, and improve order accuracy. You may disable location permissions in your device settings, but some features may not work correctly.</p>
<h2>Camera and Storage Permissions</h2><p>Camera and storage permissions may be used to upload profile images, product images, business documents, delivery proof, invoices, receipts, support attachments, or other files needed for platform workflows.</p>
<h2>Payment Information</h2><p>Payments may be processed by secure payment providers. groxen may store transaction references, status, amount, refund, wallet, invoice, and reconciliation details, but does not intentionally store complete card or banking credentials unless legally and securely permitted.</p>
<h2>Cookies and Analytics</h2><p>We may use cookies, local storage, device identifiers, logs, and analytics tools to maintain sessions, understand usage, detect errors, measure performance, and improve features.</p>
<h2>Data Security</h2><p>We use reasonable administrative, technical, and organizational safeguards to protect data. No system is perfectly secure, but we work to prevent unauthorized access, misuse, alteration, and loss.</p>
<h2>Data Sharing</h2><p>We may share limited information with vendors, delivery partners, payment providers, support teams, analytics services, hosting providers, legal authorities, and operational partners only as needed to run the platform or comply with law.</p>
<h2>User Rights</h2><p>You may request access, correction, deletion, or restriction of certain personal data, subject to identity verification, operational needs, legal obligations, and record-retention requirements.</p>
<h2>Data Retention</h2><p>We retain information for as long as needed to provide services, resolve disputes, prevent fraud, comply with accounting or legal duties, and maintain business records.</p>
<h2>Children's Privacy</h2><p>groxen services are not intended for children below the age required by applicable law. We do not knowingly collect children's personal information without appropriate consent.</p>
<h2>Changes to Privacy Policy</h2><p>We may update this Privacy Policy periodically. The latest version will be available through the app or public legal page URL.</p>
<h2>Contact Information</h2><p>For privacy questions or requests, contact groxen support at support@groxen.com.</p>`;
}

function demoContent(appName, pageType) {
  if (pageType === 'privacy-policy') return demoPrivacy(appName);
  if (pageType === 'cookie-policy') {
    return `
<h2>Cookie Use</h2><p>groxen may use cookies, local storage, device identifiers, and similar technologies to keep accounts signed in, remember preferences, measure performance, protect sessions, and improve app and website features.</p>
<h2>Analytics and Diagnostics</h2><p>We may collect usage, device, browser, crash, and diagnostic information to understand service quality, detect errors, prevent abuse, and improve customer, vendor, and delivery workflows.</p>
<h2>Managing Preferences</h2><p>You can manage browser cookies and app permissions from your browser or device settings. Some features may not work correctly if required storage or identifiers are disabled.</p>
<h2>Contact Information</h2><p>For questions about cookie use, contact groxen support at support@groxen.com.</p>`;
  }
  if (pageType === 'refund-policy') {
    return `
<h2>Refund Eligibility</h2><p>Refunds depend on order status, product type, vendor acceptance, dispatch progress, delivery status, cancellation timing, and applicable law. Perishable, opened, used, customized, or delivered products may have limited refund eligibility.</p>
<h2>Refund Processing</h2><p>Approved refunds may be returned to the original payment method, groxen wallet, or another supported mode. Processing time can vary based on payment provider, bank, wallet, and reconciliation checks.</p>
<h2>Order Issues</h2><p>If an item is missing, damaged, incorrect, expired, or otherwise not as described, contact support with order details and evidence where applicable so the issue can be reviewed.</p>
<h2>Contact Information</h2><p>For refund help, contact groxen support at support@groxen.com.</p>`;
  }
  if (pageType === 'disclaimer') {
    return `
<h2>General Information</h2><p>groxen provides grocery, marketplace, delivery, wallet, quotation, support, and related operational services. Information shown in the app or website is provided for general service use and may change without prior notice.</p>
<h2>Third-Party Products and Services</h2><p>Product details, prices, offers, availability, delivery estimates, vendor information, and third-party service details may be provided by vendors, partners, or external providers. groxen works to keep information accurate but cannot guarantee every listing is error-free at all times.</p>
<h2>Service Availability</h2><p>Features and services may vary by area, city, inventory, vendor capacity, delivery partner availability, weather, traffic, maintenance, payment systems, and operational requirements.</p>
<h2>Contact Information</h2><p>For questions about this disclaimer, contact groxen support at support@groxen.com.</p>`;
  }
  return demoTerms(appName);
}

async function seedDemoPages() {
  const seeded = [];
  for (const appName of APP_VALUES) {
    for (const pageType of DEMO_PAGE_VALUES) {
      const existing = await find(appName, pageType);
      if (existing) continue;
      seeded.push(await save({
        app_name: appName,
        page_type: pageType,
        title: titleFor(pageType),
        content_html: demoContent(appName, pageType),
        status: 'published',
        is_enabled: true,
      }));
    }
  }
  return seeded;
}

module.exports = {
  APP_VALUES,
  PAGE_VALUES,
  STATUS_VALUES,
  appLabelFor,
  copy,
  demoContent,
  find,
  history,
  list,
  publicFind,
  restore,
  save,
  seedDemoPages,
  titleFor,
  validateAppName,
  validatePageType,
};


