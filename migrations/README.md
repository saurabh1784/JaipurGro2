# Database migrations

Add one file here for every database change that must run automatically on
deploy. Files run once, in filename order, before the Node server starts.

Use this format for JavaScript migrations:

```js
module.exports = {
  id: '202605190001_add_example_table',
  name: 'Add example table',
  async up(db) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS example_table (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  },
};
```

Use safe SQL: prefer `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN`
through helper code, and data-preserving changes.
