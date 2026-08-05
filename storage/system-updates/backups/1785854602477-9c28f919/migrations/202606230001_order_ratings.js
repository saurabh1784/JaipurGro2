module.exports = {
  id: '202606230001_order_ratings',
  name: 'Add vendor and delivery person order ratings',
  async up(db) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS order_ratings (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id INT UNSIGNED NOT NULL,
        client_id INT UNSIGNED NOT NULL,
        subject_type VARCHAR(30) NOT NULL,
        subject_id INT UNSIGNED NOT NULL,
        overall_rating SMALLINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_order_rating_subject (order_id, client_id, subject_type),
        KEY idx_order_rating_subject (subject_type, subject_id),
        CONSTRAINT fk_order_rating_order FOREIGN KEY (order_id) REFERENCES client_orders(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_rating_client FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_rating_subject FOREIGN KEY (subject_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS order_rating_categories (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        rating_id INT UNSIGNED NOT NULL,
        category_key VARCHAR(60) NOT NULL,
        score SMALLINT NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_rating_category (rating_id, category_key),
        KEY idx_rating_category_key (category_key),
        CONSTRAINT fk_rating_category_rating FOREIGN KEY (rating_id) REFERENCES order_ratings(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  },
};
