const mysql = require('mysql2/promise');

function buildConfigFromUrl(connectionUrl) {
  if (!connectionUrl) {
    return {};
  }

  const parsedUrl = new URL(connectionUrl);

  return {
    host: parsedUrl.hostname,
    port: Number(parsedUrl.port || 3306),
    user: decodeURIComponent(parsedUrl.username || 'root'),
    password: decodeURIComponent(parsedUrl.password || ''),
    database: decodeURIComponent(parsedUrl.pathname.replace(/^\//, '')),
  };
}

function isRailwayRuntime() {
  return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
}

function isPrivateRailwayUrl(connectionUrl) {
  if (!connectionUrl) {
    return false;
  }

  const { hostname } = new URL(connectionUrl);
  return (
    hostname.endsWith('.railway.internal') ||
    hostname.endsWith('.railway.private') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function getConnectionUrl() {
  if (isRailwayRuntime()) {
    return process.env.MYSQL_URL || process.env.DATABASE_URL || process.env.MYSQL_PUBLIC_URL;
  }

  if (process.env.MYSQL_PUBLIC_URL) {
    return process.env.MYSQL_PUBLIC_URL;
  }

  if (isPrivateRailwayUrl(process.env.MYSQL_URL)) {
    throw new Error('Render cannot connect to Railway private MYSQL_URL. Set MYSQL_PUBLIC_URL from Railway TCP Proxy and remove MYSQL_URL from Render.');
  }

  return process.env.DATABASE_URL || process.env.MYSQL_URL;
}

const connectionUrl = getConnectionUrl();
const urlConfig = buildConfigFromUrl(connectionUrl);

const dbConfig = {
  host: urlConfig.host || process.env.MYSQLHOST || process.env.DATABASE_HOST || process.env.DB_HOST || 'localhost',
  port: Number(urlConfig.port || process.env.MYSQLPORT || process.env.DATABASE_PORT || process.env.DB_PORT || 3306),
  user: urlConfig.user || process.env.MYSQLUSER || process.env.DATABASE_USER || process.env.DB_USER || 'root',
  password:
    urlConfig.password !== undefined
      ? urlConfig.password
      : process.env.MYSQLPASSWORD !== undefined
        ? process.env.MYSQLPASSWORD
        : process.env.DATABASE_PASSWORD !== undefined
          ? process.env.DATABASE_PASSWORD
          : process.env.DB_PASSWORD || '',
  database:
    urlConfig.database ||
    process.env.MYSQLDATABASE ||
    process.env.MYSQL_DATABASE ||
    process.env.DATABASE_NAME ||
    process.env.DB_NAME ||
    'jaipur_db_node',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  queueLimit: 0,
};

if (!isRailwayRuntime() && isPrivateRailwayUrl(`mysql://${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`)) {
  throw new Error('Render cannot connect to Railway private MySQL host. Use MYSQL_PUBLIC_URL with RAILWAY_TCP_PROXY_DOMAIN and RAILWAY_TCP_PROXY_PORT.');
}

const pool = mysql.createPool(dbConfig);

module.exports = pool;
