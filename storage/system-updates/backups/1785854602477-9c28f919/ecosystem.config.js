module.exports = {
  apps: [
    {
      name: 'groxen-server',
      script: './app.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      autorestart: true,
      watch: false,
      shutdown_with_message: true,
      kill_timeout: 5000,
    },
  ],
};
