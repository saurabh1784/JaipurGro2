const express = require('express');
const appSettingsController = require('../controllers/appSettingsController');
const { uploadAppLogos, handleUploadError } = require('../middleware/appLogoUpload');

const router = express.Router();

router.get('/app-settings', appSettingsController.renderAppSettings);
router.post('/app-settings/logos', uploadAppLogos, handleUploadError, appSettingsController.updateAppLogos);

// Public REST API route for apps
router.get('/api/app-settings/logos', appSettingsController.getPublicAppLogos);

module.exports = router;
