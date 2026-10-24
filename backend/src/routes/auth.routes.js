const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const { exigirAutenticacao } = require('../middlewares/autenticacao');
const { limiteLogin } = require('../middlewares/limiteTaxa');

const router = Router();

router.post('/login', limiteLogin, authController.login);
router.post('/logout', authController.logout);
router.get('/me', exigirAutenticacao, authController.me);

module.exports = router;
