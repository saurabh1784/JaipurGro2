const pool = require('../db');

function normalizeTerm(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function toPositiveInt(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toSponsoredFlag(value) {
  return value === true
    || value === 1
    || value === '1'
    || String(value || '').trim().toLowerCase() === 'true'
    || String(value || '').trim().toLowerCase() === 'yes'
    || String(value || '').trim().toLowerCase() === 'on';
}

function toPriorityOrder(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function editDistance(a, b, maxDistance = 3) {
  if (!a || !b) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[b.length];
}

function suggestionScore(keyword, label) {
  const query = normalizeSearchText(keyword);
  const text = normalizeSearchText(label);
  if (!query || !text) return 0;
  if (text === query) return 100;
  if (text.startsWith(query)) return 92;
  if (text.includes(query)) return 80;
  const queryTokens = query.split(' ').filter(Boolean);
  const tokens = text.split(' ').filter(Boolean);
  const scores = queryTokens.map((queryToken) => {
    let best = 0;
    for (const token of tokens) {
      const maxDistance = queryToken.length <= 4 ? 1 : queryToken.length <= 8 ? 2 : 3;
      const distance = editDistance(queryToken, token, maxDistance);
      if (distance <= maxDistance) {
        best = Math.max(best, Math.round((1 - distance / Math.max(queryToken.length, token.length)) * 100));
      }
      if (token.startsWith(queryToken) || queryToken.startsWith(token)) best = Math.max(best, 86);
    }
    return best;
  });
  return scores.every((score) => score >= 58) ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
}

async function trackSearch({ userId, keyword, clickedProductId = null, viewedProductId = null }) {
  const term = normalizeTerm(keyword);
  if (!term && !clickedProductId && !viewedProductId) return;

  await pool.query(
    `INSERT INTO product_search_history (user_id, search_keyword, clicked_product_id, viewed_product_id)
     VALUES (?, ?, ?, ?)`,
    [toPositiveInt(userId), term || '', toPositiveInt(clickedProductId), toPositiveInt(viewedProductId)]
  );
}

async function trackActivity({ userId, productId, activityType, metadata = null }) {
  const id = toPositiveInt(productId);
  if (!id || !activityType) return;

  await pool.query(
    `INSERT INTO user_recent_activity (user_id, product_id, activity_type, metadata)
     VALUES (?, ?, ?, ?)`,
    [toPositiveInt(userId), id, activityType, metadata ? JSON.stringify(metadata) : null]
  );
}

async function bumpRanking(productId, field, amount = 1) {
  const allowed = new Set(['popularity_score', 'click_score', 'purchase_score', 'search_score']);
  const id = toPositiveInt(productId);
  if (!id || !allowed.has(field)) return;

  await pool.query(
    `INSERT INTO product_ranking_scores (product_id, ${field})
     VALUES (?, ?)
     ON CONFLICT (product_id) DO UPDATE
     SET ${field} = product_ranking_scores.${field} + EXCLUDED.${field},
         updated_at = CURRENT_TIMESTAMP`,
    [id, amount]
  );
}

async function trackClick({ userId, productId, keyword }) {
  await trackSearch({ userId, keyword, clickedProductId: productId });
  await trackActivity({ userId, productId, activityType: 'click', metadata: { keyword: normalizeTerm(keyword) } });
  await bumpRanking(productId, 'click_score', 2);
}

async function trackView({ userId, productId, keyword }) {
  await trackSearch({ userId, keyword, viewedProductId: productId });
  await trackActivity({ userId, productId, activityType: 'view', metadata: { keyword: normalizeTerm(keyword) } });
  await bumpRanking(productId, 'popularity_score', 0.25);
}

async function trackPurchase({ userId, productId, quantity = 1 }) {
  await trackActivity({ userId, productId, activityType: 'purchase', metadata: { quantity } });
  await bumpRanking(productId, 'purchase_score', Math.max(Number(quantity) || 1, 1) * 3);
}

async function suggestions({ userId, term, limit = 8 }) {
  const keyword = normalizeTerm(term);
  if (!keyword) {
    const { rows } = await pool.query(
      `SELECT search_keyword AS label, 'history' AS type, COUNT(*) AS weight
       FROM product_search_history
       WHERE user_id = ? AND search_keyword <> ''
       GROUP BY search_keyword
       ORDER BY MAX(created_at) DESC
       LIMIT ?`,
      [toPositiveInt(userId), limit]
    );
    return rows;
  }

  const like = `%${keyword}%`;
  const prefix = `${keyword}%`;
  const { rows } = await pool.query(
    `SELECT label, type, MAX(weight) AS weight
     FROM (
       SELECT p.name AS label, 'product' AS type, 100 AS weight
       FROM products p
       WHERE p.is_deleted = 0 AND p.approval_status = 'approved' AND p.name ILIKE ?
       UNION ALL
       SELECT c.name AS label, 'category' AS type, 70 AS weight
       FROM categories c
       WHERE c.is_deleted = 0 AND c.status = 'active' AND c.name ILIKE ?
       UNION ALL
       SELECT pk.keyword AS label, 'keyword' AS type, 80 AS weight
       FROM product_keywords pk
       WHERE pk.keyword ILIKE ?
       UNION ALL
       SELECT search_keyword AS label, 'history' AS type, 90 AS weight
       FROM product_search_history
       WHERE user_id = ? AND search_keyword ILIKE ?
     ) suggestions
     GROUP BY label, type
     ORDER BY
       CASE WHEN LOWER(label) LIKE LOWER(?) THEN 0 ELSE 1 END,
       MAX(weight) DESC,
       label ASC
     LIMIT ?`,
    [like, like, like, toPositiveInt(userId), like, prefix, limit]
  );
  if (rows.length) return rows;

  const fallback = await pool.query(
    `SELECT p.name AS label, 'product' AS type, 60 AS weight
     FROM products p
     WHERE p.is_deleted = 0 AND p.approval_status = 'approved'
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT 2000`
  );
  return fallback.rows
    .map((row) => ({ ...row, weight: suggestionScore(keyword, row.label) }))
    .filter((row) => row.weight >= 58)
    .sort((a, b) => b.weight - a.weight || String(a.label).localeCompare(String(b.label)))
    .slice(0, Number(limit) || 8);
}

async function updateProductKeywords(productId, keywords = []) {
  const id = toPositiveInt(productId);
  if (!id) return;

  const cleanKeywords = [...new Set(
    String(Array.isArray(keywords) ? keywords.join(',') : keywords || '')
      .split(',')
      .map((item) => normalizeTerm(item).toLowerCase())
      .filter(Boolean)
  )];

  await pool.query('DELETE FROM product_keywords WHERE product_id = ?', [id]);
  for (const keyword of cleanKeywords) {
    await pool.query(
      `INSERT INTO product_keywords (product_id, keyword)
       VALUES (?, ?)
       ON CONFLICT (product_id, keyword) DO NOTHING`,
      [id, keyword]
    );
  }
}

async function setSponsored({ productId, isSponsored, priorityOrder = 0 }) {
  const id = toPositiveInt(productId);
  if (!id) {
    const error = new Error('Valid product ID is required');
    error.status = 422;
    throw error;
  }

  await pool.query(
    `INSERT INTO sponsored_products (product_id, is_sponsored, priority_order)
     VALUES (?, ?, ?)
     ON CONFLICT (product_id) DO UPDATE
     SET is_sponsored = EXCLUDED.is_sponsored,
         priority_order = EXCLUDED.priority_order,
         updated_at = CURRENT_TIMESTAMP`,
    [id, toSponsoredFlag(isSponsored) ? 1 : 0, toPriorityOrder(priorityOrder)]
  );

  return getSponsored(id);
}

async function getSponsored(productId) {
  const id = toPositiveInt(productId);
  if (!id) return null;

  const [rows] = await pool.query(
    `SELECT product_id, is_sponsored, priority_order, created_at, updated_at
     FROM sponsored_products
     WHERE product_id = ?
     LIMIT 1`,
    [id]
  );
  const row = rows[0];
  return row
    ? {
        product_id: Number(row.product_id),
        is_sponsored: Boolean(row.is_sponsored),
        priority_order: toPriorityOrder(row.priority_order),
        sponsored_priority: toPriorityOrder(row.priority_order),
        created_at: row.created_at,
        updated_at: row.updated_at,
      }
    : {
        product_id: id,
        is_sponsored: false,
        priority_order: 0,
        sponsored_priority: 0,
      };
}

async function listSponsored({ activeOnly = true, limit = 100 } = {}) {
  const conditions = ['p.is_deleted = 0'];
  const params = [];
  if (activeOnly) {
    conditions.push('sp.is_sponsored = 1');
    conditions.push("p.approval_status = 'approved'");
  }

  const [rows] = await pool.query(
    `SELECT sp.product_id, sp.is_sponsored, sp.priority_order, sp.created_at, sp.updated_at,
            p.name, p.price, p.image_url, p.approval_status,
            c.name AS category_name,
            s.name AS sub_category_name,
            b.name AS brand_name
     FROM sponsored_products sp
     INNER JOIN products p ON p.id = sp.product_id
     INNER JOIN categories c ON c.id = p.category_id
     INNER JOIN sub_categories s ON s.id = p.sub_category_id
     INNER JOIN brands b ON b.id = p.brand_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sp.is_sponsored DESC, sp.priority_order DESC, sp.updated_at DESC
     LIMIT ?`,
    [...params, Math.min(toPositiveInt(limit) || 100, 500)]
  );
  return rows.map((row) => ({
    ...row,
    product_id: Number(row.product_id),
    price: Number(row.price || 0),
    is_sponsored: Boolean(row.is_sponsored),
    priority_order: toPriorityOrder(row.priority_order),
    sponsored_priority: toPriorityOrder(row.priority_order),
  }));
}

module.exports = {
  normalizeTerm,
  toSponsoredFlag,
  toPriorityOrder,
  suggestions,
  trackSearch,
  trackClick,
  trackView,
  trackPurchase,
  updateProductKeywords,
  setSponsored,
  getSponsored,
  listSponsored,
};
