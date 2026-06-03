const pool = require('../db');
const Promotion = require('./Promotion');

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
      const unitPrice = row.unit_price === undefined || row.unit_price === null ? Number(row.default_vendor_price || row.expected_price || 0) : Number(row.unit_price || 0);
      const quantity = Number(row.quantity || row.requested_quantity || 0);
      requests.get(requestKey).items.push({
        id: row.item_id,
        vendor_product_id: row.vendor_product_id,
        product_id: row.product_id,
        product_name: row.product_name,
        quantity,
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
    if (['submitted', 'accepted'].includes(request.recipient_status)) {
      request.response_total = request.items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
      request.savings = Number(request.actual_total || 0) - request.response_total;
    }
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
      `SELECT vp.id AS vendor_product_id, vp.product_id, p.name AS product_name
       FROM vendor_products vp
       INNER JOIN products p ON p.id = vp.product_id
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
        productName: product.product_name,
        quantity: Math.max(1, Number(item.quantity || 1)),
        expectedPrice: Number(item.price || 0),
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

    const totalAmount = normalizedItems.reduce((sum, item) => sum + item.expectedPrice * item.quantity, 0);

    const [vendorRows] = await connection.query(
      `SELECT u.id
       FROM users u
       INNER JOIN vendor_profiles vp ON vp.user_id = u.id
       WHERE u.role = 'Vendor'
         AND u.status = 'active'
         AND u.is_deleted = 0
         AND LOWER(TRIM(vp.city)) = LOWER(TRIM(?))`,
      [clientCity]
    );

    if (vendorRows.length === 0) {
      const error = new Error(`No vendors found in ${clientCity}`);
      error.status = 404;
      throw error;
    }

    const [requestResult] = await connection.query(
      'INSERT INTO quotation_requests (client_id, client_city, total_amount, status) VALUES (?, ?, ?, ?)',
      [clientId, clientCity, totalAmount, 'pending']
    );
    const quotationId = requestResult.insertId;

    for (const item of normalizedItems) {
      await connection.query(
        `INSERT INTO quotation_request_items
         (quotation_request_id, vendor_product_id, product_id, product_name, quantity, expected_price)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [quotationId, item.vendorProductId, item.productId, item.productName, item.quantity, item.expectedPrice]
      );
    }

    for (const vendor of vendorRows) {
      await connection.query(
        'INSERT INTO quotation_vendor_recipients (quotation_request_id, vendor_id, status, is_seen) VALUES (?, ?, ?, ?)',
        [quotationId, vendor.id, 'new', 0]
      );
    }

    await connection.commit();
    return {
      id: quotationId,
      vendorCount: vendorRows.length,
      vendorIds: vendorRows.map((vendor) => Number(vendor.id)),
      city: clientCity,
      totalAmount,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listForVendor(vendorId) {
  const [rows] = await pool.query(
    `SELECT qr.id,
            qvr.id AS recipient_id,
            qvr.vendor_id,
            qr.client_id,
            qr.client_city,
            qr.total_amount,
            qr.status,
            qr.created_at,
            qvr.status AS recipient_status,
            CASE WHEN qvr.status IN ('submitted', 'accepted') THEN qvr.total_amount ELSE 0 END AS response_total,
            bid_totals.min_bid_price,
            qvr.discount_percent,
            u.name AS client_name,
            u.email AS client_email,
            qri.id AS item_id,
            qri.vendor_product_id,
            qri.product_id,
            qri.product_name,
            qri.quantity,
            qri.expected_price,
            p.price AS admin_price,
            qvri.status AS item_status,
            CASE WHEN vp.id IS NULL THEN 0 ELSE 1 END AS in_catalog,
            COALESCE(qvri.unit_price, NULLIF(vp.price, 0), p.price, qri.expected_price) AS unit_price,
            qvri.line_total,
            vp.price AS default_vendor_price,
            vp.quantity AS stock,
            vp.status AS vendor_product_status
     FROM quotation_vendor_recipients qvr
     INNER JOIN quotation_requests qr ON qr.id = qvr.quotation_request_id
     INNER JOIN users u ON u.id = qr.client_id
     LEFT JOIN quotation_request_items qri ON qri.quotation_request_id = qr.id
     LEFT JOIN products p ON p.id = qri.product_id
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
     WHERE qvr.vendor_id = ?
       AND qr.status = 'pending'
       AND qvr.status IN ('new', 'seen')
     ORDER BY qr.created_at DESC, qri.id ASC`,
    [vendorId]
  );

  return normalizeRows(rows);
}

async function submitVendorResponse({ recipientId, vendorId, items, discountPercent = 0 }) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [recipientRows] = await connection.query(
      `SELECT qvr.id, qvr.quotation_request_id
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
      [vendorId, recipientRows[0].quotation_request_id, ...requestItemIds]
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

      if (status === 'available' && submitted.add_to_catalog) {
        await connection.query(
          `INSERT INTO vendor_products (product_id, vendor_id, quantity, price, status)
           VALUES (?, ?, ?, ?, 'active')
           ON CONFLICT (product_id, vendor_id) DO UPDATE
           SET price = EXCLUDED.price,
               quantity = GREATEST(vendor_products.quantity, EXCLUDED.quantity),
               status = 'active'`,
          [existing.product_id, vendorId, quantity, unitPrice]
        );
      }

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
       SET status = 'submitted', total_amount = ?, discount_percent = ?, submitted_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [total, discount, recipientId]
    );
    await connection.commit();
    return { recipientId, totalAmount: total };
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
            qvr.submitted_at,
            qvr.decided_at,
            vu.name AS vendor_name,
            vu.email AS vendor_email,
            vprof.business_name AS vendor_store_name,
            qvri.id AS response_item_id,
            qri.id AS item_id,
            qri.vendor_product_id,
            qri.product_id,
            COALESCE(qvri.product_name, qri.product_name) AS product_name,
            qvri.quantity,
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

    const [orderResult] = await connection.query(
      `INSERT INTO client_orders 
       (user_id, vendor_id, subtotal_amount, discount_amount, savings_amount, coupon_id, coupon_code, discount_id, discount_label, order_type, total_amount, status, delivery_status, client_name, client_phone, client_address) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    return { status: 'accepted', orderId, vendorId: recipient.vendor_id, totalAmount };
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
