const express = require('express');
const appSettingsController = require('../controllers/appSettingsController');
const { uploadAppLogos, uploadSocialIcon, handleUploadError } = require('../middleware/appLogoUpload');
const tutorialVideoController = require('../controllers/tutorialVideoController');
const { uploadTutorialVideo } = require('../middleware/tutorialVideoUpload');

const router = express.Router();

router.get('/app-settings', appSettingsController.renderAppSettings);
router.post('/app-settings/logos', uploadAppLogos, handleUploadError, appSettingsController.updateAppLogos);

// Social Profiles Admin Routes
router.post('/app-settings/social-profiles', uploadSocialIcon, handleUploadError, appSettingsController.saveSocialProfile);
router.post('/app-settings/social-profiles/update/:id', uploadSocialIcon, handleUploadError, appSettingsController.updateSocialProfile);
router.post('/app-settings/social-profiles/delete/:id', appSettingsController.deleteSocialProfile);
router.post('/app-settings/social-profiles/toggle/:id', appSettingsController.toggleSocialProfileStatus);

router.post('/app-settings/tutorial-videos', uploadTutorialVideo.single('video'), handleUploadError, tutorialVideoController.create);
router.post('/app-settings/tutorial-videos/:id', uploadTutorialVideo.single('video'), handleUploadError, tutorialVideoController.update);
router.post('/app-settings/tutorial-videos/:id/delete', tutorialVideoController.remove);

// Public REST API routes for apps
router.get('/api/app-settings/tutorial-videos/:appType', tutorialVideoController.list);
router.get('/api/app-settings/logos', appSettingsController.getPublicAppLogos);
router.get('/api/app-settings/update-check', appSettingsController.getAppUpdateConfig);
router.get('/api/app-update-check', appSettingsController.getAppUpdateConfig);
router.get('/api/app-settings/social-profiles', appSettingsController.getPublicSocialProfiles);
router.get('/api/social-profiles', appSettingsController.getPublicSocialProfiles);
router.get('/api/app-settings/registration-config', appSettingsController.getPublicRegistrationConfig);
router.get('/api/registration-config', appSettingsController.getPublicRegistrationConfig);

module.exports = router;

