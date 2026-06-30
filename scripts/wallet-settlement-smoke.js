const assert = require('assert');
const db = require('../db');
const Wallet = require('../models/Wallet');
const Settlement = require('../services/orderWalletSettlementService');

async function firstUser(connection, role) {
  const [rows] = await connection.query(
    `SELECT id FROM users WHERE LOWER(role) = ? AND is_deleted = 0 ORDER BY id LIMIT 1`,
    [role]
  );
  assert(rows.length, `A ${role} user is required for the wallet smoke test`);
  return Number(rows[0].id);
}

async function run() {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const clientId = await firstUser(connection, 'client');
    const vendorId = await firstUser(connection, 'vendor');
    const deliveryPersonId = await firstUser(connection, 'deliveryperson');
    const clientWallet = await Wallet.lockForUser(clientId, connection);
    await connection.query('UPDATE wallets SET balance = 1000 WHERE id = ?', [clientWallet.id]);

    const [orderResult] = await connection.query(
      `INSERT INTO client_orders
       (user_id, vendor_id, subtotal_amount, discount_amount, delivery_charge, total_amount,
        status, delivery_status, delivery_partner_id, delivery_method, delivery_type)
       VALUES (?, ?, 500, 0, 50, 550, 'pending', 'pending', ?, 'partner', 'delivery_partner')`,
      [clientId, vendorId, deliveryPersonId]
    );
    const orderId = Number(orderResult.insertId);

    const placement = await Settlement.settleOrderPlacement({
      orderId,
      actorId: clientId,
      connection,
    });
    assert.strictEqual(placement.totalPaid, 550);
    assert.strictEqual(placement.deliveryCharge, 50);
    assert.strictEqual(placement.platformFee, 0);

    const [placementRows] = await connection.query(
      'SELECT component, amount FROM wallet_transactions WHERE order_id = ? ORDER BY component',
      [orderId]
    );
    assert.deepStrictEqual(
      placementRows.map((row) => row.component).sort(),
      ['client_order_payment']
    );

    await Settlement.settleOrderPlacement({ orderId, actorId: clientId, connection });
    const [idempotentRows] = await connection.query(
      'SELECT COUNT(*) AS total FROM wallet_transactions WHERE order_id = ?',
      [orderId]
    );
    assert.strictEqual(Number(idempotentRows[0].total), 1);

    await connection.query(
      "UPDATE client_orders SET status = 'completed', delivery_status = 'delivered' WHERE id = ?",
      [orderId]
    );

    const delivery = await Settlement.settleDeliveryCompletion({
      orderId,
      deliveryPersonId,
      actorId: deliveryPersonId,
      connection,
    });
    assert.strictEqual(delivery.deliveryEarning, 50);
    assert.strictEqual(Number((delivery.orderSettlement.platformFee + delivery.orderSettlement.orderCommission + delivery.orderSettlement.vendorEarning).toFixed(2)), 500);
    const [allRows] = await connection.query(
      'SELECT component, amount FROM wallet_transactions WHERE order_id = ? ORDER BY component',
      [orderId]
    );
    assert.strictEqual(allRows.length, 6);
    const credits = allRows
      .filter((row) => row.component !== 'client_order_payment')
      .reduce((sum, row) => sum + Number(row.amount), 0);
    assert.strictEqual(Number(credits.toFixed(2)), 550);

    console.log(JSON.stringify({ success: true, orderId, placement, delivery, ledgerEntries: allRows.length }));
  } finally {
    await connection.rollback();
    connection.release();
    await db.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
