const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

let initializedApp = null;

function parseServiceAccountJson(value) {
  if (!value) return null;
  const parsed = JSON.parse(value);
  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

function readServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return parseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  const configuredPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!configuredPath) return null;
  const resolvedPath = path.resolve(configuredPath);
  return parseServiceAccountJson(fs.readFileSync(resolvedPath, 'utf8'));
}

function getFirebaseAdminApp() {
  if (initializedApp) return initializedApp;
  if (admin.apps.length) {
    initializedApp = admin.app();
    return initializedApp;
  }

  const serviceAccount = readServiceAccount();
  if (!serviceAccount) return null;

  initializedApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
  return initializedApp;
}

function firebaseAdminStatus() {
  try {
    const serviceAccount = readServiceAccount();
    const app = getFirebaseAdminApp();
    return {
      configured: Boolean(app),
      projectId: serviceAccount?.project_id || '',
      clientEmail: serviceAccount?.client_email || '',
      message: app
        ? 'Firebase Admin SDK is configured'
        : 'Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH',
    };
  } catch (error) {
    return {
      configured: false,
      projectId: '',
      clientEmail: '',
      message: error.message || 'Firebase Admin SDK configuration failed',
    };
  }
}

function firebaseMessaging() {
  const app = getFirebaseAdminApp();
  return app ? admin.messaging(app) : null;
}

module.exports = {
  firebaseAdminStatus,
  firebaseMessaging,
  getFirebaseAdminApp,
};
