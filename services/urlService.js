/**
 * Centralized URL & Domain Resolution Service for JaipurGro
 * Automatically reads APP_URL and SERVER_URL from .env file with dynamic fallback to request headers.
 */

function getAppUrl(req = null) {
  let configuredUrl = (process.env.APP_URL || process.env.SERVER_URL || '').trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, '');
  }
  if (req && typeof req.get === 'function') {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    return `${protocol}://${host}`;
  }
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}

function getServerUrl(req = null) {
  let configuredUrl = (process.env.SERVER_URL || process.env.APP_URL || '').trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, '');
  }
  return getAppUrl(req);
}

function getAbsoluteUrl(path = '', req = null) {
  const baseUrl = getAppUrl(req);
  const cleanPath = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
}

module.exports = {
  getAppUrl,
  getServerUrl,
  getAbsoluteUrl,
};
