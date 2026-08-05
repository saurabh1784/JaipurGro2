const express = require('express');
const controller = require('../controllers/systemUpdateController');

const router = express.Router();
router.get('/history', controller.history);
router.post('/upload', controller.upload);

module.exports = router;
