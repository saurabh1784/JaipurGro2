const express = require('express');
const controller = require('../controllers/deliveryTypeController');

const router = express.Router();

router.get('/options', controller.options);
router.get('/settings', controller.settings);
router.post('/settings', controller.save);
router.put('/settings', controller.save);
router.post('/settings/area', controller.saveArea);
router.delete('/settings', controller.remove);
router.delete('/settings/area', controller.removeArea);

module.exports = router;
