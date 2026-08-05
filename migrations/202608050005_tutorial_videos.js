module.exports = {
  id: '202608050005_tutorial_videos',
  name: 'Add backend-managed app tutorial videos',
  async up(db) {
    await db.query(`CREATE TABLE IF NOT EXISTS tutorial_videos (
      id BIGSERIAL PRIMARY KEY,
      app_type VARCHAR(30) NOT NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT,
      video_path VARCHAR(500) NOT NULL,
      file_version BIGINT NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_active SMALLINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.query('CREATE INDEX IF NOT EXISTS idx_tutorial_videos_app_active ON tutorial_videos(app_type, is_active, display_order)');
  },
};
