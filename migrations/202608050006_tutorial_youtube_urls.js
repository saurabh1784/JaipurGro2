module.exports = {
  id: '202608050006_tutorial_youtube_urls',
  name: 'Allow YouTube URLs for tutorial videos',
  async up(db) {
    await db.query('ALTER TABLE tutorial_videos ADD COLUMN IF NOT EXISTS youtube_url VARCHAR(1000)');
    await db.query('ALTER TABLE tutorial_videos ALTER COLUMN video_path DROP NOT NULL');
  },
};
