const express = require('express');
const clientController = require('../controllers/clientController');

const router = express.Router();

router.get('/', clientController.index);
router.post('/', clientController.create);
router.get('/:id', clientController.show);
router.put('/:id', clientController.update);
router.delete('/:id', clientController.destroy);

module.exports = router;
