const crypto = require('crypto');

const ORDER_NUMBER_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ORDER_NUMBER_DIGITS = '0123456789';
const ORDER_NUMBER_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ORDER_NUMBER_LENGTH = 10;
const MAX_ORDER_NUMBER_ATTEMPTS = 12;

function generateOrderNumber() {
  let value = '';
  for (let index = 0; index < ORDER_NUMBER_LENGTH; index += 1) {
    value += ORDER_NUMBER_ALPHABET[crypto.randomInt(ORDER_NUMBER_ALPHABET.length)];
  }
  if (!/[0-9]/.test(value)) {
    const index = crypto.randomInt(ORDER_NUMBER_LENGTH);
    return `${value.slice(0, index)}${ORDER_NUMBER_DIGITS[crypto.randomInt(ORDER_NUMBER_DIGITS.length)]}${value.slice(index + 1)}`;
  }
  if (!/[A-Z]/.test(value)) {
    const index = crypto.randomInt(ORDER_NUMBER_LENGTH);
    return `${value.slice(0, index)}${ORDER_NUMBER_LETTERS[crypto.randomInt(ORDER_NUMBER_LETTERS.length)]}${value.slice(index + 1)}`;
  }
  return value;
}

function isUniqueConstraintError(error) {
  const message = String(error && error.message ? error.message : '');
  return error && (
    error.code === '23505' ||
    error.code === 'ER_DUP_ENTRY' ||
    /unique|duplicate/i.test(message)
  );
}

async function insertClientOrderWithOrderNumber(connection, insertSql, values) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_ORDER_NUMBER_ATTEMPTS; attempt += 1) {
    const orderNumber = generateOrderNumber();
    try {
      const [result] = await connection.query(insertSql, [orderNumber, ...values]);
      return { result, orderNumber };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError || new Error('Unable to generate a unique order number');
}

async function backfillMissingOrderNumbers(connection) {
  const [rows] = await connection.query(
    `SELECT id
     FROM client_orders
     WHERE order_number IS NULL
        OR order_number !~ '^[0-9A-Z]{10}$'
        OR order_number !~ '[0-9]'
        OR order_number !~ '[A-Z]'
     ORDER BY id ASC`
  );

  for (const row of rows) {
    let updated = false;
    for (let attempt = 0; attempt < MAX_ORDER_NUMBER_ATTEMPTS && !updated; attempt += 1) {
      try {
        const orderNumber = generateOrderNumber();
        const [result] = await connection.query(
          `UPDATE client_orders
           SET order_number = ?
           WHERE id = ?
             AND (order_number IS NULL
               OR order_number !~ '^[0-9A-Z]{10}$'
               OR order_number !~ '[0-9]'
               OR order_number !~ '[A-Z]')`,
          [orderNumber, row.id]
        );
        updated = Number(result.affectedRows || result.rowCount || 0) > 0;
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
      }
    }
    if (!updated) {
      throw new Error(`Unable to assign unique order number for order ${row.id}`);
    }
  }
}

module.exports = {
  generateOrderNumber,
  insertClientOrderWithOrderNumber,
  backfillMissingOrderNumbers,
  isUniqueConstraintError,
};
