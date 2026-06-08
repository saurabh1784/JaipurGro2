const pool = require('../db');
const Promotion = require('./Promotion');
const { insertClientOrderWithOrderNumber } = require('../utils/orderNumber');

function cleanWeightUnit(value) {
  const unit = String(value || 'kg').trim();
  if (!unit) return 'kg';
  const lower = unit.toLowerCase();
  if (['gram', 'grams', 'g'].includes(lower)) return 'g';
  if (['kilogram', 'kilograms', 'kg'].includes(lower)) return 'kg';
  if (['liter', 'liters', 'litre', 'litres', 'l'].includes(lower)) return 'L';
  if (['milliliter', 'milliliters', 'millilitre', 'millilitres', 'ml'].includes(lower)) return 'ml';
  return unit.slice(0, 20);
}

function formatWeightLabel(value, unit) {
  const amount = Number(value || 0);
  if (!amount) return 'Not set';
  return `${Number(amount.toFixed(3))} ${cleanWeightUnit(unit)}`;
}

async function quotationSubmissionMinutes(connection = pool) {
  try {
    const [rows] = await connection.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'quotation_submission_minutes' LIMIT 1"
    );
    const minutes = Number(rows[0] && rows[0].setting_value);
    return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 1440;
  } catch {
    return 1440;
  }
}

function quotationExpiryFromNow(minutes) {
  return new Date(Date.now() + Math.max(1, Number(minutes || 1440)) * 60000);
}

function normalizeRows(rows) {
  const requests = new Map();
  const itemKeysByRequest = new Map();

  for (const row of rows) {
    const requestKey = `${row.id}:${row.recipient_id || row.vendor_id || 'request'}`;
    if (!requests.has(requestKey)) {
      requests.set(requestKey, {
        id: row.id,
        client_id: row.client_id,
        client_name: row.client_name,
        client_email: row.client_email,
        client_city: row.client_city,
        total_amount: Number(row.total_amount || 0),
        status: row.status,
        recipient_status: row.recipient_status,
        recipient_id: row.recipient_id,
        response_total: Number(row.response_total || 0),
        min_bid_price: row.min_bid_price === undefined || row.min_bid_price === null ? null : Number(row.min_bid_price || 0),
        discount_percent: Number(row.discount_percent || 0),
        actual_total: Number(row.actual_total || 0),
        savings: Number(row.savings || 0),
        vendor_id: row.vendor_id,
        vendor_name: row.vendor_name,
        vendor_email: row.vendor_email,
        vendor_store_name: row.vendor_store_name,
        submitted_at: row.submitted_at,
        decided_at: row.decided_at,
        bid_updated_at: row.bid_updated_at,
        expires_at: row.expires_at,
        bid_editable: row.bid_editable === undefined || row.bid_editable === null ? true : Boolean(Number(row.bid_editable)),
        created_at: row.created_at,
        items: [],
      });
      itemKeysByRequest.set(requestKey, new Set());
    }

    if (row.item_id) {
      const itemKeys = itemKeysByRequest.get(requestKey);
      const itemKey = String(row.product_id || row.item_id);
      if (itemKeys.has(itemKey)) continue;
      itemKeys.add(itemKey);

      const catalogUnavailable = row.vendor_product_status === 'unavailable' || (row.stock !== undefined && row.stock !== null && Number(row.stock || 0) <= 0);
      const itemStatus = catalogUnavailable ? 'not_available' : (row.item_status || 'available');
      const unitPrice = row.unit_price === undefined || row.unit_price === null ? Number(row.default_vendor_price || row.admin_price || row.expected_price || 0) : Number(row.unit_price || 0);
      const quantity = Number(row.quantity || row.requested_quantity || 0);
      const weightValue = Number(row.weight_value ?? row.product_weight_value ?? row.weight_kg ?? 0);
      const weightUnit = cleanWeightUnit(row.weight_unit || row.product_weight_unit || 'kg');
      const weightKg = Number(row.weight_kg ?? row.product_weight_kg ?? 0);
      const totalWeightKg = weightKg * quantity;
      requests.get(requestKey).items.push({
        id: row.item_id,
        vendor_product_id: row.vendor_product_id,
        product_id: row.product_id,
        category_id: row.category_id,
        category_name: row.category_name || '',
        product_name: row.product_name,
        quantity,
        weight_value: weightValue,
        weight_unit: weightUnit,
        weight_kg: weightKg,
        weight_label: formatWeightLabel(weightValue, weightUnit),
        total_weight_kg: totalWeightKg,
        total_weight_label: `${Number(totalWeightKg.toFixed(3))} kg`,
        expected_price: Number(row.expected_price || 0),
        admin_price: Number(row.admin_price || row.expected_price || 0),
        status: itemStatus,
        in_catalog: Boolean(row.in_catalog),
        stock: row.stock === undefined || row.stock === null ? null : Number(row.stock || 0),
        vendor_product_status: row.vendor_product_status,
        unit_price: unitPrice,
        line_total: itemStatus === 'not_available' ? 0 : Number(row.line_total || unitPrice * quantity || 0),
        master_line_total: Number(row.master_line_total || 0),
      });
    }
  }

  return [...requests.values()].map((request) => {
    const categoryNames = [...new Set(request.items.map((item) => item.category_name).filter(Boolean))];
    const categoryIds = [...new Set(request.items.map((item) => Number(item.category_id)).filter(Boolean))];
    request.category_id = categoryIds.length === 1 ? categoryIds[0] : null;
    request.category_name = categoryNames.length === 1 ? categoryNames[0] : categoryNames.join(', ');
    if (['submitted', 'accepted'].includes(request.recipient_status)) {
      request.response_total = request.items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
      request.savings = Number(request.actual_total || 0) - request.response_total;
    }
    request.total_weight_kg = request.items.reduce((sum, item) => sum + Number(item.total_weight_kg || 0), 0);
    return request;
  });
}

function cheapestClientResponses(quotations) {
  const byRequest = new Map();
  for (const quotation of quotations) {
    const existing = byRequest.get(quotation.id);
    const currentTotal = Number(quotation.response_total || 0);
    const existingTotal = existing ? Number(existing.response_total || 0) : Number.POSITIVE_INFINITY;
    if (!existing || currentTotal < existingTotal) {
      byRequest.set(quotation.id, quotation);
    }
  }
  return [...byRequest.values()];
}

async function createForCityVendors({ clientId, items }) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [clientRows] = await connection.query(
      'SELECT city FROM client_profiles WHERE user_id = ? LIMIT 1',
      [clientId]
    );
    const clientCity = String(clientRows[0] && clientRows[0].city ? clientRows[0].city : '').trim();
    if (!clientCity) {
      const error = new Error('Please update your profile city before sending a quotation');
      error.status = 422;
      throw error;
    }

    const vendorProductIds = items.map((item) => Number(item.vendorProductId || item.vendor_product_id || item.id)).filter(Boolean);
    if (vendorProductIds.length === 0) {
      const error = new Error('No valid products were selected');
      error.status = 422;
      throw error;
    }

    const placeholders = vendorProductIds.map(() => '?').join(',');
    const [productRows] = await connection.query(
      `SELECT vp.id AS vendor_product_id, vp.product_id, p.name AS product_name,
              p.category_id, c.name AS category_name, p.weight_value, p.weight_unit, p.weight_kg
       FROM vendor_products vp
       INNER JOIN products p ON p.id = vp.product_id
       INNER JOIN categories c ON c.id = p.category_id
       WHERE vp.id IN (${placeholders})`,
      vendorProductIds
    );
    const productMap = new Map(productRows.map((row) => [Number(row.vendor_product_id), row]));

    const normalizedItemsByProduct = new Map();
    for (const item of items) {
      const vendorProductId = Number(item.vendorProductId || item.vendor_product_id || item.id);
      const product = productMap.get(vendorProductId);
      if (!product) {
        const error = new Error(`Product not found: ${vendorProductId}`);
        error.status = 422;
        throw error;
      }

      const normalized = {
        vendorProductId,
        productId: product.product_id,
        categoryId: Number(product.category_id),
        categoryName: product.category_name || 'Category',
        productName: product.product_name,
        quantity: Math.max(1, Number(item.quantity || 1)),
        expectedPrice: Number(item.price || 0),
        weightValue: Number(product.weight_value ?? product.weight_kg ?? 0),
        weightUnit: cleanWeightUnit(product.weight_unit || 'kg'),
        weightKg: Number(product.weight_kg || 0),
      };

      const existing = normalizedItemsByProduct.get(Number(normalized.productId));
      if (!existing) {
        normalizedItemsByProduct.set(Number(normalized.productId), normalized);
      } else {
        existing.quantity = Math.max(existing.quantity, normalized.quantity);
        if (normalized.expectedPrice > 0 && (existing.expectedPrice <= 0 || normalized.expectedPrice < existing.expectedPrice)) {
          existing.vendorProductId = normalized.vendorProductId;
          existing.expectedPrice = normalized.expectedPrice;
        }
      }
    }
    const normalizedItems = [...normalizedItemsByProduct.values()];
    const itemsByCategory = new Map();
    for (const item of normalizedItems) {
      const categoryId = Number(item.categoryId);
      if (!categoryId) continue;
      if (!itemsByCategory.has(categoryId)) {
        itemsByCategory.set(categoryId, {
          categoryId,
          categoryName: item.categoryName,
          items: [],
        });
      }
      itemsByCategory.get(categoryId).items.push(item);
    }

    if (itemsByCategory.size === 0) {
      const error = new Error('No valid product categories were selected');
      error.status = 422;
      throw error;
    }

    const quotations = [];
    const skippedCategories = [];
    for (const categoryGroup of itemsByCategory.values()) {
      const [vendorRows] = await connection.query(
        `SELECT DISTINCT u.id
         FROM users u
         INNER JOIN vendor_profiles vp ON vp.user_id = u.id
         INNER JOIN vendor_categories vc ON vc.vendor_id = u.id AND vc.category_id = ?
         WHERE u.role = 'Vendor'
           AND u.status = 'active'
           AND u.is_deleted = 0
           AND LOWER(TRIM(vp.city)) = LOWER(TRIM(?))`,
        [categoryGroup.categoryId, clientCity]
      );

      if (vendorRows.length === 0) {
        skippedCategories.push({
          categoryId: categoryGroup.categoryId,
          categoryName: categoryGroup.categoryName,
          itemCount: categoryGroup.items.length,
          reason: `No ${categoryGroup.categoryName} vendors found in ${clientCity}`,
        });
        continue;
      }

      const totalAmount = categoryGroup.items.reduce((sum, item) => sum + item.expectedPrice * item.quantity, 0);
      const expiryMinutes = await quotationSubmissionMinutes(connection);
      const expiresAt = quotationExpiryFromNow(expiryMinutes);
      const [requestResult] = await connection.query(
        'INSERT INTO quotation_requests (client_id, client_city, total_amount, status, expires_at) VALUES (?, ?, ?, ?, ?)',
        [clientId, clientCity, totalAmount, 'pending', expiresAt]
      );
      const quotationId = requestResult.insertId;

      for (const item of categoryGroup.items) {
        await connection.query(
          `INSERT INTO quotation_request_items
           (quotation_request_id, vendor_product_id, product_id, product_name, quantity, expected_price, weight_value, weight_unit, weight_kg)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [quotationId, item.vendorProductId, item.productId, item.productName, item.quantity, item.expectedPrice, item.weightValue, item.weightUnit, item.weightKg]
        );
      }

      for (const vendor of vendorRows) {
        await connection.query(
          'INSERT INTO quotation_vendor_recipients (quotation_request_id, vendor_id, status, is_seen) VALUES (?, ?, ?, ?)',
          [quotationId, vendor.id, 'new', 0]
        );
      }

      quotations.push({
        id: quotationId,
        categoryId: categoryGroup.categoryId,
        categoryName: categoryGroup.categoryName,
        vendorCount: vendorRows.length,
        vendorIds: vendorRows.map((vendor) => Number(vendor.id)),
        city: clientCity,
        totalAmount,
        expiresAt,
      });
    }

    if (quotations.length === 0) {
      const categoryNames = skippedCategories.map((category) => category.categoryName).filter(Boolean).join(', ');
      const error = new Error(
        categoryNames
          ? `No activated vendors found in ${clientCity} for: ${categoryNames}`
          : `No activated vendors found in ${clientCity}`
      );
      error.status = 404;
      error.skippedCategories = skippedCategories;
      throw error;
    }

    await connection.commit();
    const vendorIds = [...new Set(quotations.flatMap((quotation) => quotation.vendorIds || []))];
    const totalAmount = quotations.reduce((sum, quotation) => sum + Number(quotation.totalAmount || 0), 0);
    return {
      id: quotations[0] && quotations[0].id,
      quotationCount: quotations.length,
      categoryCount: quotations.length,
      vendorCount: vendorIds.length,
      vendorIds,
      city: clientCity,
      totalAmount,
      quotations,
      skippedCategories,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listForVendor(vendorId, { categoryId } = {}) {
  const where = [
    'qvr.vendor_id = ?',
    "qr.status = 'pending'",
    "qvr.status IN ('new', 'seen', 'submitted')",
  ];
  const params = [vendorId];
  const normalizedCategoryId = Number(categoryId || 0);
  if (normalizedCategoryId > 0) {
    where.push('p.category_id = ?');
    params.push(normalizedCategoryId);
  }

  const [rows] = await pool.query(
    `SELECT qr.id,
            qvr.id AS recipient_id,
            qvr.vendor_id,
            qr.client_id,
            qr.client_city,
            qr.total_amount,
            qr.status,
            qr.created_at,
            qr.expires_at,
            CASE WHEN qr.expires_at IS NULL OR qr.expires_at > CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS bid_editable,
            qvr.status AS recipient_status,
            CASE WHEN qvr.status IN ('submitted', 'accepted') THEN qvr.total_amount ELSE 0 END AS response_total,
            bid_totals.min_bid_price,
            qvr.discount_percent,
            qvr.updated_at AS bid_updated_at,
            u.name AS client_name,
            u.email AS client_email,
            qri.id AS item_id,
            qri.vendor_product_id,
            qri.product_id,
            p.category_id,
            c.name AS category_name,
            qri.product_name,
            qri.quantity,
            qri.weight_value,
            qri.weight_unit,
            qri.weight_kg,
            qri.expected_price,
            p.price AS admin_price,
            qvri.status AS item_status,
            CASE WHEN vp.id IS NULL THEN 0 ELSE 1 END AS in_catalog,
            COALESCE(qvri.unit_price, p.price, qri.expected_price) AS unit_price,
            qvri.line_total,
            p.price AS default_vendor_price,
            vp.quantity AS stock,
            vp.status AS vendor_product_status
     FROM quotation_vendor_recipients qvr
     INNER JOIN quotation_requests qr ON qr.id = qvr.quotation_request_id
     INNER JOIN users u ON u.id = qr.client_id
     LEFT JOIN quotation_request_items qri ON qri.quotation_request_id = qr.id
     LEFT JOIN products p ON p.id = qri.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN vendor_products vp ON vp.vendor_id = qvr.vendor_id AND vp.product_id = qri.product_id
     LEFT JOIN (
       SELECT quotation_request_id, MIN(total_amount) AS min_bid_price
       FROM quotation_vendor_recipients
       WHERE status IN ('submitted', 'accepted')
         AND total_amount > 0
       GROUP BY quotation_request_id
     ) bid_totals ON bid_totals.quotation_request_id = qr.id
     LEFT JOIN quotation_vendor_response_items qvri
       ON qvri.quotation_vendor_recipient_id = qvr.id
      AND qvri.quotation_request_item_id = qri.id
     WHERE ${where.join(' AND ')}
     ORDER BY qr.created_at DESC, qri.id ASC`,
    params
  );

  return normalizeRows(rows);
}

async function submitVendorResponse({ recipientId, vendorId, items, discountPercent = 0 }) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [recipientRows] = await connection.query(
      `SELECT qvr.id, qvr.quotation_request_id, qvr.status, qvr.total_amount, qr.client_id, qr.expires_at
       FROM quotation_vendor_recipients qvr
       INNER JOIN quotation_requests qr ON qr.id = qvr.quotation_request_id
       WHERE qvr.id = ? AND qvr.vendor_id = ? AND qr.status = 'pending'
       FOR UPDATE`,
      [recipientId, vendorId]
    );
    if (!recipientRows.length) {
      const error = new Error('Quotation request not found for this vendor');
      error.status = 404;
      throw error;
    }
    const recipient = recipientRows[0];
    if (!['new', 'seen', 'submitted'].includes(recipient.status)) {
      const error = new Error('Quotation request cannot be edited');
      error.status = 422;
      throw error;
    }
    if (recipient.expires_at && new Date(recipient.expires_at).getTime() <= Date.now()) {
      const error = new Error('Quotation submission deadline has passed');
      error.status = 422;
      throw error;
    }

    const requestItemIds = items.map((item) => Number(item.item_id || item.id)).filter(Boolean);
    if (!requestItemIds.length) {
      const error = new Error('At least one quotation item is required');
      error.status = 422;
      throw error;
    }

    const placeholders = requestItemIds.map(() => '?').join(',');
    const [requestItems] = await connection.query(
      `SELECT qri.id, qri.product_id, qri.product_name, qri.quantity, p.price AS admin_price,
              vp.quantity AS stock, vp.status AS vendor_product_status
       FROM quotation_request_items qri
       INNER JOIN products p ON p.id = qri.product_id
       LEFT JOIN vendor_products vp ON vp.vendor_id = ? AND vp.product_id = qri.product_id
       WHERE qri.quotation_request_id = ? AND qri.id IN (${placeholders})`,
      [vendorId, recipient.quotation_request_id, ...requestItemIds]
    );
    const itemMap = new Map(requestItems.map((item) => [Number(item.id), item]));
    let total = 0;

    for (const submitted of items) {
      const itemId = Number(submitted.item_id || submitted.id);
      const existing = itemMap.get(itemId);
      if (!existing) continue;
      const quantity = Math.max(1, Number(submitted.quantity || existing.quantity || 1));
      const catalogUnavailable = existing.vendor_product_status === 'unavailable' || (existing.stock !== null && existing.stock !== undefined && Number(existing.stock || 0) <= 0);
      const status = catalogUnavailable || submitted.status === 'not_available' || submitted.status === 'NA' ? 'not_available' : 'available';
      const unitPrice = Math.max(0, Number(submitted.unit_price || submitted.price || existing.admin_price || 0));
      const lineTotal = status === 'available' ? quantity * unitPrice : 0;
      total += lineTotal;

      await connection.query(
        `INSERT INTO quotation_vendor_response_items
         (quotation_vendor_recipient_id, quotation_request_item_id, product_name, quantity, status, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (quotation_vendor_recipient_id, quotation_request_item_id) DO UPDATE
         SET product_name = EXCLUDED.product_name,
             quantity = EXCLUDED.quantity,
             status = EXCLUDED.status,
             unit_price = EXCLUDED.unit_price,
             line_total = EXCLUDED.line_total`,
        [recipientId, itemId, existing.product_name, quantity, status, unitPrice, lineTotal]
      );
    }

    const discount = Math.min(Math.max(Number(discountPercent || 0), 0), 100);
    await connection.query(
      `UPDATE quotation_vendor_recipients
       SET status = 'submitted',
           total_amount = ?,
           discount_percent = ?,
           submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [total, discount, recipientId]
    );
    await connection.commit();
    return {
      recipientId,
      quotationId: recipient.quotation_request_id,
      clientId: recipient.client_id,
      totalAmount: total,
      previousTotalAmount: Number(recipient.total_amount || 0),
      isUpdate: recipient.status === 'submitted',
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function rejectVendorRequest({ recipientId, vendorId }) {
  const [result] = await pool.query(
    `UPDATE quotation_vendor_recipients
     SET status = 'rejected',
         decided_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND vendor_id = ?
       AND status IN ('new', 'seen')
       AND EXISTS (
         SELECT 1 FROM quotation_requests qr
         WHERE qr.id = quotation_vendor_recipients.quotation_request_id
           AND qr.status = 'pending'
       )`,
    [recipientId, vendorId]
  );

  if (result.affectedRows === 0) {
    const error = new Error('Quotation cannot be rejected');
    error.status = 422;
    throw error;
  }

  return { recipientId, status: 'rejected' };
}

async function listForClient(clientId) {
  const [rows] = await pool.query(
    `SELECT qr.id,
            qvr.id AS recipient_id,
            qvr.vendor_id,
            qvr.status AS recipient_status,
            qvr.total_amount AS response_total,
            qvr.discount_percent,
            totals.actual_total,
            totals.actual_total - COALESCE(NULLIF(qvr.total_amount, 0), totals.actual_total) AS savings,
            qr.client_id,
            qr.client_city,
            qr.total_amount,
            qr.status,
            qr.created_at,
            qr.expires_at,
            CASE WHEN qr.expires_at IS NULL OR qr.expires_at > CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS bid_editable,
            qvr.submitted_at,
            qvr.decided_at,
            qvr.updated_at AS bid_updated_at,
            vu.name AS vendor_name,
            vu.email AS vendor_email,
            vprof.business_name AS vendor_store_name,
            qvri.id AS response_item_id,
            qri.id AS item_id,
            qri.vendor_product_id,
            qri.product_id,
            p.category_id,
            c.name AS category_name,
            COALESCE(qvri.product_name, qri.product_name) AS product_name,
            qvri.quantity,
            qri.weight_value,
            qri.weight_unit,
            qri.weight_kg,
            qri.expected_price,
            p.price AS admin_price,
            qvri.status AS item_status,
            1 AS in_catalog,
            qvri.unit_price,
            qvri.line_total,
            qri.quantity AS requested_quantity,
            qri.quantity * p.price AS master_line_total,
            vprod.quantity AS stock,
            vprod.status AS vendor_product_status
     FROM quotation_vendor_recipients qvr
     INNER JOIN quotation_requests qr ON qr.id = qvr.quotation_request_id
     INNER JOIN users vu ON vu.id = qvr.vendor_id
     LEFT JOIN vendor_profiles vprof ON vprof.user_id = qvr.vendor_id
     INNER JOIN (
       SELECT quotation_request_id,
              SUM(quantity * p.price) AS actual_total
       FROM quotation_request_items qri
       INNER JOIN products p ON p.id = qri.product_id
       GROUP BY quotation_request_id
     ) totals ON totals.quotation_request_id = qr.id
     INNER JOIN quotation_request_items qri ON qri.quotation_request_id = qr.id
     INNER JOIN products p ON p.id = qri.product_id
     INNER JOIN categories c ON c.id = p.category_id
     LEFT JOIN vendor_products vprod ON vprod.vendor_id = qvr.vendor_id AND vprod.product_id = qri.product_id
     LEFT JOIN quotation_vendor_response_items qvri
       ON qvri.quotation_vendor_recipient_id = qvr.id
      AND qvri.quotation_request_item_id = qri.id
     WHERE qr.client_id = ?
       AND qvr.status = 'submitted'
     ORDER BY qr.created_at DESC, qvr.submitted_at DESC NULLS LAST, qvr.id ASC, qri.id ASC`,
    [clientId]
  );

  return cheapestClientResponses(normalizeRows(rows));
}

async function decideClientResponse({ recipientId, clientId, decision, couponCode = '' }) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [recipientRows] = await connection.query(
      `SELECT qvr.*, qr.client_id, qr.status AS request_status
       FROM quotation_vendor_recipients qvr
       INNER JOIN quotation_requests qr ON qr.id = qvr.quotation_request_id
       WHERE qvr.id = ? AND qr.client_id = ?
       FOR UPDATE`,
      [recipientId, clientId]
    );
    if (!recipientRows.length || recipientRows[0].status !== 'submitted') {
      const error = new Error('Submitted quotation response not found');
      error.status = 404;
      throw error;
    }

    if (decision === 'rejected') {
      await connection.query(
        "UPDATE quotation_vendor_recipients SET status = 'rejected', decided_at = CURRENT_TIMESTAMP WHERE id = ?",
        [recipientId]
      );
      await connection.commit();
      return { status: 'rejected' };
    }

    const recipient = recipientRows[0];
    const [items] = await connection.query(
      `SELECT qvri.*, qri.product_id, vp.id AS vendor_product_id, vp.quantity AS stock, vp.status AS vendor_product_status,
              CASE WHEN p.tax_percentage IS NULL THEN COALESCE(c.tax_name, '') ELSE COALESCE(NULLIF(p.tax_name, ''), c.tax_name, '') END AS tax_name,
              COALESCE(p.tax_percentage, c.tax_percentage, 0) AS tax_percentage
       FROM quotation_vendor_response_items qvri
       INNER JOIN quotation_request_items qri ON qri.id = qvri.quotation_request_item_id
       INNER JOIN vendor_products vp ON vp.vendor_id = ? AND vp.product_id = qri.product_id
       INNER JOIN products p ON p.id = qri.product_id
       INNER JOIN categories c ON c.id = p.category_id
       WHERE qvri.quotation_vendor_recipient_id = ?
       FOR UPDATE`,
      [recipient.vendor_id, recipientId]
    );
    if (!items.length) {
      const error = new Error('Quotation response has no items');
      error.status = 422;
      throw error;
    }

    for (const item of items) {
      if (item.status === 'not_available' || item.vendor_product_status === 'unavailable') {
        continue;
      }
      if (Number(item.stock || 0) < Number(item.quantity || 0)) {
        const error = new Error(`Insufficient stock for ${item.product_name}`);
        error.status = 422;
        throw error;
      }
    }

    const purchasableItems = items.filter((item) => item.status !== 'not_available' && item.vendor_product_status !== 'unavailable');
    if (!purchasableItems.length) {
      const error = new Error('Quotation has no available items to order');
      error.status = 422;
      throw error;
    }
    const subtotalAmount = purchasableItems.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
    const [quoteTotalRows] = await connection.query(
      `SELECT SUM(qri.quantity * p.price) AS actual_total
       FROM quotation_request_items qri
       INNER JOIN products p ON p.id = qri.product_id
       WHERE qri.quotation_request_id = ?`,
      [recipient.quotation_request_id]
    );
    const quotationAppTotal = Number(quoteTotalRows[0]?.actual_total || subtotalAmount || 0);
    const promotion = await Promotion.resolveOrderPromotion({
      couponCode,
      orderType: 'quotation',
      subtotal: subtotalAmount,
      userId: clientId,
    }, connection);
    const discountAmount = Number(promotion.discountAmount || 0);
    const totalAmount = Math.max(subtotalAmount - discountAmount, 0);
    const savingsAmount = Math.max(quotationAppTotal - subtotalAmount, 0) + discountAmount;

    // Get client details for denormalization
    const [clientRows] = await connection.query(
      'SELECT u.name, u.phone, cp.address, cp.country, cp.state, cp.city FROM users u LEFT JOIN client_profiles cp ON cp.user_id = u.id WHERE u.id = ? LIMIT 1',
      [clientId]
    );
    const client = clientRows[0];
    const clientAddress = [client.address, client.city, client.state, client.country].filter(Boolean).join(', ');
    const shippingName = client.name || null;
    const shippingPhone = client.phone || null;
    const shippingAddress = clientAddress || null;

    const { result: orderResult, orderNumber } = await insertClientOrderWithOrderNumber(
      connection,
      `INSERT INTO client_orders 
       (order_number, user_id, vendor_id, subtotal_amount, discount_amount, savings_amount, coupon_id, coupon_code, discount_id, discount_label, order_type, total_amount, status, delivery_status, client_name, client_phone, client_address, shipping_name, shipping_phone, shipping_address, shipping_city, shipping_state, shipping_country) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clientId,
        recipient.vendor_id,
        subtotalAmount,
        discountAmount,
        savingsAmount,
        promotion.coupon ? promotion.coupon.id : null,
        promotion.code || null,
        promotion.discount ? promotion.discount.id : null,
        promotion.discount ? promotion.discount.name : null,
        'quotation',
        totalAmount,
        'pending',
        'pending',
        client.name,
        client.phone,
        clientAddress,
        shippingName,
        shippingPhone,
        shippingAddress,
        client.city || null,
        client.state || null,
        client.country || null,
      ]
    );
    const orderId = orderResult.insertId;
    await Promotion.recordUsage({
      orderId,
      userId: clientId,
      orderType: 'quotation',
      subtotal: subtotalAmount,
      discountAmount,
      coupon: promotion.coupon,
      discount: promotion.discount,
    }, connection);
    await connection.query(
      `INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_by_role, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orderId, null, 'pending', clientId, 'Client', 'Quotation accepted']
    );

    for (const item of purchasableItems) {
      const lineTotal = Number(item.line_total || (Number(item.unit_price || 0) * Number(item.quantity || 0)));
      const taxPercentage = Math.max(0, Number(item.tax_percentage || 0));
      const taxAmount = taxPercentage > 0 ? lineTotal * taxPercentage / (100 + taxPercentage) : 0;
      const taxableAmount = lineTotal - taxAmount;
      await connection.query(
        `INSERT INTO client_order_items
         (order_id, vendor_product_id, quantity, unit_price, tax_name, tax_percentage, tax_amount, taxable_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          item.vendor_product_id,
          item.quantity,
          item.unit_price,
          item.tax_name || null,
          taxPercentage,
          taxAmount,
          taxableAmount,
        ]
      );
      await connection.query(
        'UPDATE vendor_products SET quantity = quantity - ? WHERE id = ?',
        [item.quantity, item.vendor_product_id]
      );
    }

    await connection.query(
      "UPDATE quotation_vendor_recipients SET status = 'accepted', decided_at = CURRENT_TIMESTAMP WHERE id = ?",
      [recipientId]
    );
    await connection.query(
      "UPDATE quotation_vendor_recipients SET status = 'rejected', decided_at = CURRENT_TIMESTAMP WHERE quotation_request_id = ? AND id <> ? AND status = 'submitted'",
      [recipient.quotation_request_id, recipientId]
    );
    await connection.query(
      "UPDATE quotation_requests SET status = 'accepted' WHERE id = ?",
      [recipient.quotation_request_id]
    );

    await connection.commit();
    return { status: 'accepted', orderId, orderNumber, vendorId: recipient.vendor_id, totalAmount };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function pendingCountForVendor(vendorId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM quotation_vendor_recipients qvr
     INNER JOIN quotation_requests qr ON qr.id = qvr.quotation_request_id
     WHERE qvr.vendor_id = ? AND qr.status = 'pending' AND qvr.is_seen = 0`,
    [vendorId]
  );

  return Number(rows[0] && rows[0].total ? rows[0].total : 0);
}

async function markSeenForVendor(vendorId) {
  await pool.query(
    "UPDATE quotation_vendor_recipients SET is_seen = 1, status = CASE WHEN status = 'new' THEN 'seen' ELSE status END WHERE vendor_id = ?",
    [vendorId]
  );
}

module.exports = {
  createForCityVendors,
  listForVendor,
  submitVendorResponse,
  rejectVendorRequest,
  listForClient,
  decideClientResponse,
  pendingCountForVendor,
  markSeenForVendor,
};
