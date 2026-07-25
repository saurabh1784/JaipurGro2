const pool = require('../db');
const VendorInventory = require('../models/VendorInventory');

// 1. Get Vendor Inventory List (With filters & search)
const getInventory = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { status, stock_status, search, category_id, page = 1, limit = 50 } = req.query;

    let whereConditions = ['vpv.vendor_id = ?'];
    const params = [vendorId];

    // Status Filter (approved, pending, rejected, suspended)
    if (status && status !== 'all') {
      whereConditions.push('vpv.approval_status = ?');
      params.push(status);
    }

    // Category Filter
    if (category_id) {
      whereConditions.push('p.category_id = ?');
      params.push(category_id);
    }

    // Search query (Product name, variant name, SKU, Barcode)
    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;
      whereConditions.push('(p.name ILIKE ? OR pv.variant_name ILIKE ? OR vpv.sku ILIKE ? OR vpv.barcode ILIKE ?)');
      params.push(term, term, term, term);
    }

    const whereClause = whereConditions.join(' AND ');

    const [rows] = await pool.query(
      `SELECT vpv.*,
              p.name as product_name, p.image_url as product_image, p.category_id,
              pv.variant_name, pv.measurement_value, pv.measurement_unit, pv.weight_in_grams, pv.image as variant_image
       FROM vendor_product_variants vpv
       INNER JOIN products p ON p.id = vpv.product_id
       INNER JOIN product_variants pv ON pv.id = vpv.product_variant_id
       WHERE ${whereClause}
       ORDER BY vpv.updated_at DESC`,
      params
    );

    // Format & Stock Status filtering
    const formatted = rows.map(r => {
      const stock = parseInt(r.stock_quantity, 10) || 0;
      const reserved = parseInt(r.reserved_stock, 10) || 0;
      const available = Math.max(0, stock - reserved);
      const lowLimit = parseInt(r.low_stock_limit, 10) || 10;
      const isLowStock = available > 0 && available <= lowLimit;
      const isOutOfStock = available <= 0;

      return {
        id: r.id,
        vendor_id: r.vendor_id,
        product_id: r.product_id,
        product_variant_id: r.product_variant_id,
        product_name: r.product_name,
        variant_name: r.variant_name,
        unit: r.measurement_unit,
        value: r.measurement_value,
        weight_in_grams: r.weight_in_grams,
        image: r.variant_image || r.product_image || '/default.png',
        approval_status: r.approval_status || 'pending',
        approval_note: r.approval_note || null,
        vendor_price: parseFloat(r.vendor_price) || 0,
        mrp: parseFloat(r.mrp) || 0,
        stock_quantity: stock,
        reserved_stock: reserved,
        available_stock: available,
        low_stock_limit: lowLimit,
        is_low_stock: isLowStock,
        is_out_of_stock: isOutOfStock,
        is_available: Boolean(r.is_available),
        sku: r.sku || null,
        barcode: r.barcode || null,
        inventory_value: parseFloat((available * (parseFloat(r.vendor_price) || 0)).toFixed(2))
      };
    });

    // Stock Status Sub-filtering if requested
    let finalItems = formatted;
    if (stock_status) {
      if (stock_status === 'out_of_stock') finalItems = formatted.filter(i => i.is_out_of_stock);
      else if (stock_status === 'low_stock') finalItems = formatted.filter(i => i.is_low_stock);
      else if (stock_status === 'unavailable') finalItems = formatted.filter(i => !i.is_available);
    }

    return res.json({
      success: true,
      count: finalItems.length,
      items: finalItems
    });
  } catch (err) {
    console.error('Error fetching vendor inventory:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 2. Request Approval for a Product Variation
const requestApproval = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const {
      product_id,
      product_variant_id,
      vendor_price,
      mrp,
      stock_quantity = 0,
      minimum_order_quantity = 1,
      maximum_order_quantity = 100,
      low_stock_limit = 10,
      sku,
      barcode,
      supporting_document
    } = req.body;

    if (!product_id || !product_variant_id) {
      return res.status(400).json({ success: false, message: 'product_id and product_variant_id are required.' });
    }

    const price = parseFloat(vendor_price) || 0;
    const mrpVal = parseFloat(mrp) || price;
    const stock = parseInt(stock_quantity, 10) || 0;

    // Check existing mapping
    const [existing] = await pool.query(
      'SELECT id, approval_status, stock_quantity FROM vendor_product_variants WHERE vendor_id = ? AND product_variant_id = ?',
      [vendorId, product_variant_id]
    );

    let vpvId;
    if (existing.length) {
      vpvId = existing[0].id;
      await pool.query(
        `UPDATE vendor_product_variants
         SET vendor_price = ?, mrp = ?, stock_quantity = ?, minimum_order_quantity = ?, maximum_order_quantity = ?,
             low_stock_limit = ?, sku = ?, barcode = ?, supporting_document = ?, approval_status = 'pending',
             is_available = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [price, mrpVal, stock, minimum_order_quantity, maximum_order_quantity, low_stock_limit, sku || null, barcode || null, supporting_document || null, vpvId]
      );
    } else {
      const [ins] = await pool.query(
        `INSERT INTO vendor_product_variants
           (vendor_id, product_id, product_variant_id, vendor_price, mrp, stock_quantity, minimum_order_quantity, maximum_order_quantity, low_stock_limit, sku, barcode, supporting_document, approval_status, is_available, is_approved)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0)`,
        [vendorId, product_id, product_variant_id, price, mrpVal, stock, minimum_order_quantity, maximum_order_quantity, low_stock_limit, sku || null, barcode || null, supporting_document || null]
      );
      vpvId = ins.insertId || (ins[0] && ins[0].id);
    }

    // Record Opening Stock Transaction
    if (stock > 0) {
      await VendorInventory.recordTransaction({
        vendor_id: vendorId,
        product_variant_id,
        transaction_type: 'opening_stock',
        quantity: stock,
        stock_before: 0,
        stock_after: stock,
        note: 'Approval request submitted with opening stock'
      });
    }

    return res.json({
      success: true,
      message: 'Variation approval request submitted successfully. It is now pending admin review.',
      id: vpvId
    });
  } catch (err) {
    console.error('Error submitting variation approval request:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 3. Update Vendor Inventory Details for Approved Variation
const updateInventory = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const vpvId = parseInt(req.params.id, 10);

    const [rows] = await pool.query(
      'SELECT * FROM vendor_product_variants WHERE id = ? AND vendor_id = ?',
      [vpvId, vendorId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Vendor variation inventory record not found.' });
    }

    const current = rows[0];
    if (current.approval_status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: `Cannot update inventory. This variation is currently '${current.approval_status || 'pending'}' and must be approved by admin before inventory can be managed.`
      });
    }

    const {
      vendor_price,
      mrp,
      stock_quantity,
      minimum_order_quantity,
      maximum_order_quantity,
      low_stock_limit,
      is_available,
      sku,
      barcode
    } = req.body;

    const newPrice = vendor_price !== undefined ? parseFloat(vendor_price) : parseFloat(current.vendor_price);
    const newMrp = mrp !== undefined ? parseFloat(mrp) : parseFloat(current.mrp);
    const newMin = minimum_order_quantity !== undefined ? parseInt(minimum_order_quantity, 10) : current.minimum_order_quantity;
    const newMax = maximum_order_quantity !== undefined ? parseInt(maximum_order_quantity, 10) : current.maximum_order_quantity;
    const newLowLimit = low_stock_limit !== undefined ? parseInt(low_stock_limit, 10) : current.low_stock_limit;
    const newAvail = is_available !== undefined ? (is_available ? 1 : 0) : current.is_available;
    const newSku = sku !== undefined ? String(sku).trim() : current.sku;
    const newBarcode = barcode !== undefined ? String(barcode).trim() : current.barcode;

    let newStock = current.stock_quantity;
    if (stock_quantity !== undefined) {
      newStock = Math.max(0, parseInt(stock_quantity, 10));
      const diff = newStock - current.stock_quantity;
      if (diff !== 0) {
        const transType = diff > 0 ? 'stock_added' : 'stock_removed';
        await VendorInventory.recordTransaction({
          vendor_id: vendorId,
          product_variant_id: current.product_variant_id,
          transaction_type: transType,
          quantity: Math.abs(diff),
          stock_before: current.stock_quantity,
          stock_after: newStock,
          note: `Manual stock edit by vendor (${diff > 0 ? '+' : ''}${diff})`
        });
      }
    }

    await pool.query(
      `UPDATE vendor_product_variants
       SET vendor_price = ?, mrp = ?, stock_quantity = ?, minimum_order_quantity = ?, maximum_order_quantity = ?,
           low_stock_limit = ?, is_available = ?, sku = ?, barcode = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND vendor_id = ?`,
      [newPrice, newMrp, newStock, newMin, newMax, newLowLimit, newAvail, newSku || null, newBarcode || null, vpvId, vendorId]
    );

    return res.json({
      success: true,
      message: 'Inventory updated successfully.'
    });
  } catch (err) {
    console.error('Error updating vendor inventory:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 4. Vendor Inventory Reports
const getReports = async (req, res) => {
  try {
    const vendorId = req.user.id;

    const [variants] = await pool.query(
      `SELECT vpv.*, p.name as product_name, pv.variant_name, pv.measurement_value, pv.measurement_unit
       FROM vendor_product_variants vpv
       INNER JOIN products p ON p.id = vpv.product_id
       INNER JOIN product_variants pv ON pv.id = vpv.product_variant_id
       WHERE vpv.vendor_id = ? AND vpv.status = 'active'`,
      [vendorId]
    );

    let totalApproved = 0;
    let totalStock = 0;
    let totalReserved = 0;
    let totalAvailable = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let totalInventoryValue = 0;

    variants.forEach(v => {
      const stock = parseInt(v.stock_quantity, 10) || 0;
      const reserved = parseInt(v.reserved_stock, 10) || 0;
      const available = Math.max(0, stock - reserved);
      const lowLimit = parseInt(v.low_stock_limit, 10) || 10;
      const price = parseFloat(v.vendor_price) || 0;

      if (v.approval_status === 'approved') totalApproved++;
      totalStock += stock;
      totalReserved += reserved;
      totalAvailable += available;
      totalInventoryValue += available * price;

      if (available <= 0) outOfStockCount++;
      else if (available <= lowLimit) lowStockCount++;
    });

    // Recent stock movement transactions
    const [transactions] = await pool.query(
      `SELECT vit.*, p.name as product_name, pv.variant_name
       FROM vendor_inventory_transactions vit
       INNER JOIN product_variants pv ON pv.id = vit.product_variant_id
       INNER JOIN products p ON p.id = pv.product_id
       WHERE vit.vendor_id = ?
       ORDER BY vit.created_at DESC
       LIMIT 100`,
      [vendorId]
    );

    return res.json({
      success: true,
      summary: {
        total_approved_variations: totalApproved,
        total_stock_quantity: totalStock,
        total_reserved_stock: totalReserved,
        total_available_stock: totalAvailable,
        low_stock_items: lowStockCount,
        out_of_stock_items: outOfStockCount,
        total_inventory_value: parseFloat(totalInventoryValue.toFixed(2)),
      },
      transactions
    });
  } catch (err) {
    console.error('Error generating inventory reports:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 5. Export Inventory Report as CSV
const exportReport = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const [rows] = await pool.query(
      `SELECT vpv.*, p.name as product_name, pv.variant_name, pv.measurement_value, pv.measurement_unit
       FROM vendor_product_variants vpv
       INNER JOIN products p ON p.id = vpv.product_id
       INNER JOIN product_variants pv ON pv.id = vpv.product_variant_id
       WHERE vpv.vendor_id = ? AND vpv.status = 'active'
       ORDER BY p.name ASC`,
      [vendorId]
    );

    let csv = 'Product Name,Variation Name,Unit,Vendor Price,MRP,Stock,Reserved,Available,Approval Status,SKU,Barcode\n';
    rows.forEach(r => {
      const stock = parseInt(r.stock_quantity, 10) || 0;
      const reserved = parseInt(r.reserved_stock, 10) || 0;
      const available = Math.max(0, stock - reserved);
      csv += `"${r.product_name}","${r.variant_name}","${r.measurement_value} ${r.measurement_unit}",${r.vendor_price},${r.mrp},${stock},${reserved},${available},"${r.approval_status}","${r.sku || ''}","${r.barcode || ''}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=inventory_report_${vendorId}_${Date.now()}.csv`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Error exporting inventory report:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getInventory,
  requestApproval,
  updateInventory,
  getReports,
  exportReport
};
