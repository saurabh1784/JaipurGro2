const pool = require('../db');

function normalizeTerm(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function toPositiveInt(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
  return rows;
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
    [id, isSponsored ? 1 : 0, Number(priorityOrder) || 0]
  );
}

module.exports = {
  normalizeTerm,
  suggestions,
  trackSearch,
  trackClick,
  trackView,
  trackPurchase,
  updateProductKeywords,
  setSponsored,
};
