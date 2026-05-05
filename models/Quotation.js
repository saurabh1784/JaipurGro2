const pool = require('../db');

function normalizeRows(rows) {
  const requests = new Map();

  for (const row of rows) {
    if (!requests.has(row.id)) {
      requests.set(row.id, {
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
        discount_percent: Number(row.discount_percent || 0),
        actual_total: Number(row.actual_total || 0),
        savings: Number(row.savings || 0),
        vendor_id: row.vendor_id,
        vendor_name: row.vendor_name,
        vendor_email: row.vendor_email,
        created_at: row.created_at,
        items: [],
      });
    }

    requests.get(row.id).items.push({
      id: row.item_id,
      vendor_product_id: row.vendor_product_id,
      product_id: row.product_id,
      product_name: row.product_name,
      quantity: Number(row.quantity || 0),
      expected_price: Number(row.expected_price || 0),
      admin_price: Number(row.admin_price || row.expected_price || 0),
      status: row.item_status || 'available',
      in_catalog: Boolean(row.in_catalog),
      unit_price: row.unit_price === undefined || row.unit_price === null ? Number(row.default_vendor_price || row.expected_price || 0) : Number(row.unit_price || 0),
      line_total: Number(row.line_total || 0),
    });
  }

  return [...requests.values()];
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

    const vendorProductIds = items.map((item) => Number(item.vendorProductId || item.id)).filter(Boolean);
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

    const normalizedItems = items.map((item) => {
      const vendorProductId = Number(item.vendorProductId || item.id);
      const product = productMap.get(vendorProductId);
      if (!product) {
        const error = new Error(`Product not found: ${vendorProductId}`);
        error.status = 422;
        throw error;
      }

      return {
        vendorProductId,
        productId: product.product_id,
        productName: product.product_name,
        quantity: Math.max(1, Number(item.quantity || 1)),
        expectedPrice: Number(item.price || 0),
      };
    });

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
    return { id: quotationId, vendorCount: vendorRows.length, city: clientCity, totalAmount };
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
            qvr.total_amount AS response_total,
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
            vp.price AS default_vendor_price
     FROM quotation_vendor_recipients qvr
     INNER JOIN quotation_requests qr ON qr.id = qvr.quotation_request_id
     INNER JOIN users u ON u.id = qr.client_id
     LEFT JOIN quotation_request_items qri ON qri.quotation_request_id = qr.id
     LEFT JOIN products p ON p.id = qri.product_id
     LEFT JOIN vendor_products vp ON vp.vendor_id = qvr.vendor_id AND vp.product_id = qri.product_id
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
      `SELECT qri.id, qri.product_id, qri.product_name, qri.quantity, p.price AS admin_price
       FROM quotation_request_items qri
       INNER JOIN products p ON p.id = qri.product_id
       WHERE qri.quotation_request_id = ? AND qri.id IN (${placeholders})`,
      [recipientRows[0].quotation_request_id, ...requestItemIds]
    );
    const itemMap = new Map(requestItems.map((item) => [Number(item.id), item]));
    let total = 0;

    for (const submitted of items) {
      const itemId = Number(submitted.item_id || submitted.id);
      const existing = itemMap.get(itemId);
      if (!existing) continue;
      const quantity = Math.max(1, Number(submitted.quantity || existing.quantity || 1));
      const status = submitted.status === 'not_available' || submitted.status === 'NA' ? 'not_available' : 'available';
      const unitPrice = Math.max(0, Number(submitted.unit_price || submitted.price || existing.admin_price || 0));
      const lineTotal = status === 'available' ? quantity * unitPrice : 0;
      total += lineTotal;

      if (status === 'available' && submitted.add_to_catalog) {
        await connection.query(
          `INSERT INTO vendor_products (product_id, vendor_id, quantity, price, status)
           VALUES (?, ?, ?, ?, 'active')
           ON DUPLICATE KEY UPDATE
             price = VALUES(price),
             quantity = GREATEST(quantity, VALUES(quantity)),
             status = 'active'`,
          [existing.product_id, vendorId, quantity, unitPrice]
        );
      }

      await connection.query(
        `INSERT INTO quotation_vendor_response_items
         (quotation_vendor_recipient_id, quotation_request_item_id, product_name, quantity, status, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           product_name = VALUES(product_name),
           quantity = VALUES(quantity),
           status = VALUES(status),
           unit_price = VALUES(unit_price),
           line_total = VALUES(line_total)`,
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
    `UPDATE quotation_vendor_recipients qvr
     SET status = 'rejected',
         decided_at = CURRENT_TIMESTAMP
     WHERE qvr.id = ?
       AND qvr.vendor_id = ?
       AND qvr.status IN ('new', 'seen')
       AND EXISTS (
         SELECT 1
         FROM quotation_requests qr
         WHERE qr.id = qvr.quotation_request_id
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
            totals.actual_total - qvr.total_amount AS savings,
            qr.client_id,
            qr.client_city,
            qr.total_amount,
            qr.status,
            qr.created_at,
            vu.name AS vendor_name,
            vu.email AS vendor_email,
            qvri.id AS response_item_id,
            qvri.quotation_request_item_id AS item_id,
            qri.vendor_product_id,
            qri.product_id,
            qvri.product_name,
            qvri.quantity,
            qri.expected_price,
            p.price AS admin_price,
            qvri.status AS item_status,
            1 AS in_catalog,
            qvri.unit_price,
            qvri.line_total
     FROM quotation_vendor_recipients qvr
     INNER JOIN quotation_requests qr ON qr.id = qvr.quotation_request_id
     INNER JOIN users vu ON vu.id = qvr.vendor_id
     INNER JOIN (
       SELECT qvri.quotation_vendor_recipient_id,
              SUM(qvri.quantity * p.price) AS actual_total
       FROM quotation_vendor_response_items qvri
       INNER JOIN quotation_request_items qri ON qri.id = qvri.quotation_request_item_id
       INNER JOIN products p ON p.id = qri.product_id
       GROUP BY qvri.quotation_vendor_recipient_id
     ) totals ON totals.quotation_vendor_recipient_id = qvr.id
     INNER JOIN quotation_vendor_response_items qvri ON qvri.quotation_vendor_recipient_id = qvr.id
     INNER JOIN quotation_request_items qri ON qri.id = qvri.quotation_request_item_id
     INNER JOIN products p ON p.id = qri.product_id
     WHERE qr.client_id = ? AND qvr.status IN ('submitted', 'accepted', 'rejected')
     ORDER BY qr.created_at DESC, qvr.submitted_at DESC, qvri.id ASC`,
    [clientId]
  );

  return normalizeRows(rows);
}

async function decideClientResponse({ recipientId, clientId, decision }) {
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
      `SELECT qvri.*, qri.product_id, vp.id AS vendor_product_id, vp.quantity AS stock
       FROM quotation_vendor_response_items qvri
       INNER JOIN quotation_request_items qri ON qri.id = qvri.quotation_request_item_id
       INNER JOIN vendor_products vp ON vp.vendor_id = ? AND vp.product_id = qri.product_id
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
      if (Number(item.stock || 0) < Number(item.quantity || 0)) {
        const error = new Error(`Insufficient stock for ${item.product_name}`);
        error.status = 422;
        throw error;
      }
    }

    const totalAmount = items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);

    // Get client details for denormalization
    const [clientRows] = await connection.query(
      'SELECT u.name, u.phone, cp.address, cp.country, cp.state, cp.city FROM users u LEFT JOIN client_profiles cp ON cp.user_id = u.id WHERE u.id = ? LIMIT 1',
      [clientId]
    );
    const client = clientRows[0];
    const clientAddress = [client.address, client.city, client.state, client.country].filter(Boolean).join(', ');

    const [orderResult] = await connection.query(
      `INSERT INTO client_orders 
       (user_id, vendor_id, total_amount, status, delivery_status, client_name, client_phone, client_address) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [clientId, recipient.vendor_id, totalAmount, 'pending', 'pending', client.name, client.phone, clientAddress]
    );
    const orderId = orderResult.insertId;

    for (const item of items) {
      await connection.query(
        'INSERT INTO client_order_items (order_id, vendor_product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [orderId, item.vendor_product_id, item.quantity, item.unit_price]
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
    return { status: 'accepted', orderId, totalAmount };
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
