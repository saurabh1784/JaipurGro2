const pool = require('../db');

const CATEGORY_DEFINITIONS = Object.freeze({
  vendor: Object.freeze({
    packing_quality: 'Packing Quality',
    fast_preparation: 'Fast Preparation',
    product_quality: 'Product Quality',
    matches_description_brand: 'Product Matches Description/Brand',
    value_for_money: 'Value for Money',
    overall_experience: 'Overall Experience',
  }),
  delivery_person: Object.freeze({
    safe_delivery: 'Safe Delivery',
    fast_delivery: 'Fast Delivery',
    polite_behavior: 'Polite Behavior',
    order_handling: 'Order Handling',
    communication: 'Communication',
    on_time_delivery: 'On-time Delivery',
    overall_experience: 'Overall Experience',
  }),
});

function definitions(subjectType) {
  return CATEGORY_DEFINITIONS[subjectType] || null;
}

function validateScores(subjectType, scores) {
  const categoryDefinitions = definitions(subjectType);
  if (!categoryDefinitions || !scores || typeof scores !== 'object' || Array.isArray(scores)) {
    const error = new Error(`Valid ${subjectType.replace('_', ' ')} ratings are required`);
    error.status = 422;
    throw error;
  }
  const normalized = {};
  for (const [key, rawScore] of Object.entries(scores)) {
    if (!Object.prototype.hasOwnProperty.call(categoryDefinitions, key)) continue;
    const score = Number(rawScore);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      const error = new Error(`${categoryDefinitions[key]} must be rated from 1 to 5 stars`);
      error.status = 422;
      throw error;
    }
    normalized[key] = score;
  }
  if (!Object.keys(normalized).length) {
    const error = new Error(`At least one ${subjectType.replace('_', ' ')} rating is required`);
    error.status = 422;
    throw error;
  }
  return normalized;
}

function overallScore(scores) {
  if (Number.isInteger(scores.overall_experience)) return scores.overall_experience;
  const values = Object.values(scores).map(Number).filter((score) => Number.isFinite(score));
  return values.length ? Math.round(values.reduce((sum, score) => sum + score, 0) / values.length) : 0;
}

function emptySummary(subjectType, subjectId) {
  return {
    subject_type: subjectType,
    subject_id: Number(subjectId),
    average_rating: 0,
    review_count: 0,
    categories: Object.entries(definitions(subjectType) || {}).map(([key, label]) => ({
      key,
      label,
      average_rating: 0,
      rating_count: 0,
    })),
  };
}

async function summaries(subjectType, subjectIds, connection = pool) {
  const ids = [...new Set((subjectIds || []).map(Number).filter((id) => id > 0))];
  const result = new Map(ids.map((id) => [id, emptySummary(subjectType, id)]));
  if (!definitions(subjectType) || !ids.length) return result;

  const placeholders = ids.map(() => '?').join(', ');
  const [overallRows] = await connection.query(
    `SELECT subject_id, ROUND(AVG(overall_rating)::numeric, 2) AS average_rating, COUNT(*) AS review_count
     FROM order_ratings
     WHERE subject_type = ? AND subject_id IN (${placeholders})
     GROUP BY subject_id`,
    [subjectType, ...ids]
  );
  const [categoryRows] = await connection.query(
    `SELECT rating.subject_id, category.category_key,
            ROUND(AVG(category.score)::numeric, 2) AS average_rating,
            COUNT(*) AS rating_count
     FROM order_rating_categories category
     INNER JOIN order_ratings rating ON rating.id = category.rating_id
     WHERE rating.subject_type = ? AND rating.subject_id IN (${placeholders})
     GROUP BY rating.subject_id, category.category_key`,
    [subjectType, ...ids]
  );

  for (const row of overallRows) {
    const summary = result.get(Number(row.subject_id));
    if (!summary) continue;
    summary.average_rating = Number(row.average_rating || 0);
    summary.review_count = Number(row.review_count || 0);
  }
  for (const row of categoryRows) {
    const summary = result.get(Number(row.subject_id));
    const category = summary && summary.categories.find((item) => item.key === row.category_key);
    if (!category) continue;
    category.average_rating = Number(row.average_rating || 0);
    category.rating_count = Number(row.rating_count || 0);
  }
  return result;
}

async function summary(subjectType, subjectId, connection = pool) {
  const values = await summaries(subjectType, [subjectId], connection);
  return values.get(Number(subjectId)) || emptySummary(subjectType, subjectId);
}

async function ratingsForOrder(orderId, clientId, connection = pool) {
  const [rows] = await connection.query(
    `SELECT rating.id, rating.subject_type, rating.subject_id, rating.overall_rating,
            rating.updated_at, category.category_key, category.score
     FROM order_ratings rating
     LEFT JOIN order_rating_categories category ON category.rating_id = rating.id
     WHERE rating.order_id = ? AND rating.client_id = ?
     ORDER BY rating.subject_type, category.category_key`,
    [orderId, clientId]
  );
  const values = {};
  for (const row of rows) {
    if (!values[row.subject_type]) {
      values[row.subject_type] = {
        subject_id: Number(row.subject_id),
        overall_rating: Number(row.overall_rating),
        scores: {},
        updated_at: row.updated_at,
      };
    }
    if (row.category_key) values[row.subject_type].scores[row.category_key] = Number(row.score);
  }
  return values;
}

async function contextForOrder(order, clientId, connection = pool) {
  const completed = ['delivered', 'completed'].includes(String(order.status || '').toLowerCase())
    || String(order.delivery_status || '').toLowerCase() === 'delivered';
  const existing = await ratingsForOrder(order.id, clientId, connection);
  const [vendorSummary, deliverySummary] = await Promise.all([
    order.vendor_id ? summary('vendor', order.vendor_id, connection) : null,
    order.delivery_partner_id ? summary('delivery_person', order.delivery_partner_id, connection) : null,
  ]);
  return {
    can_rate: completed && Number(order.user_id) === Number(clientId),
    categories: CATEGORY_DEFINITIONS,
    vendor_id: order.vendor_id ? Number(order.vendor_id) : null,
    delivery_person_id: order.delivery_partner_id ? Number(order.delivery_partner_id) : null,
    existing,
    vendor_summary: vendorSummary,
    delivery_person_summary: deliverySummary,
  };
}

async function saveForOrder({ orderId, clientId, vendorScores, deliveryPersonScores }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [orderRows] = await connection.query(
      `SELECT id, user_id, vendor_id, delivery_partner_id, status, delivery_status
       FROM client_orders WHERE id = ? FOR UPDATE`,
      [orderId]
    );
    if (!orderRows.length) {
      const error = new Error('Order not found');
      error.status = 404;
      throw error;
    }
    const order = orderRows[0];
    if (Number(order.user_id) !== Number(clientId)) {
      const error = new Error('You can rate only your own orders');
      error.status = 403;
      throw error;
    }
    const completed = ['delivered', 'completed'].includes(String(order.status || '').toLowerCase())
      || String(order.delivery_status || '').toLowerCase() === 'delivered';
    if (!completed) {
      const error = new Error('Ratings can be submitted after order completion');
      error.status = 409;
      throw error;
    }

    const submissions = [];
    if (vendorScores !== undefined) {
      if (!order.vendor_id) throw Object.assign(new Error('This order has no vendor to rate'), { status: 422 });
      const scores = validateScores('vendor', vendorScores);
      submissions.push({ type: 'vendor', subjectId: order.vendor_id, scores, overall: overallScore(scores) });
    }
    if (deliveryPersonScores !== undefined) {
      if (!order.delivery_partner_id) throw Object.assign(new Error('This order has no delivery person to rate'), { status: 422 });
      const scores = validateScores('delivery_person', deliveryPersonScores);
      submissions.push({ type: 'delivery_person', subjectId: order.delivery_partner_id, scores, overall: overallScore(scores) });
    }
    if (!submissions.length) {
      const error = new Error('Vendor or delivery person ratings are required');
      error.status = 422;
      throw error;
    }

    for (const submission of submissions) {
      const [ratingResult] = await connection.query(
        `INSERT INTO order_ratings (order_id, client_id, subject_type, subject_id, overall_rating)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (order_id, client_id, subject_type) DO UPDATE SET
           subject_id = EXCLUDED.subject_id,
           overall_rating = EXCLUDED.overall_rating,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [orderId, clientId, submission.type, submission.subjectId, submission.overall]
      );
      const ratingId = ratingResult.insertId;
      await connection.query('DELETE FROM order_rating_categories WHERE rating_id = ?', [ratingId]);
      for (const [key, score] of Object.entries(submission.scores)) {
        await connection.query(
          'INSERT INTO order_rating_categories (rating_id, category_key, score) VALUES (?, ?, ?)',
          [ratingId, key, score]
        );
      }
    }
    await connection.commit();
    return contextForOrder(order, clientId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  CATEGORY_DEFINITIONS,
  summary,
  summaries,
  contextForOrder,
  saveForOrder,
};

