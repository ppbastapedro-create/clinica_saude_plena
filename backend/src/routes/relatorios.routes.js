const { Router } = require('express');
const relatoriosController = require('../controllers/relatorios.controller');
const financeiroController = require('../controllers/financeiro.controller');
const { exigirAutenticacao, exigirPapel } = require('../middlewares/autenticacao');

const router = Router();

// Só PSICOLOGO: o relatório traz pagamentos e nomes de pacientes (sigilo
// profissional, CFP). O acesso provisório do ADMIN acabou no pacote 1.5.2.
router.use(exigirAutenticacao, exigirPapel('PSICOLOGO'));

router.get('/mensal', relatoriosController.mensal);
// Saldo de cada paciente (a receber / crédito de pacote) — não depende do mês.
router.get('/saldos', financeiroController.saldos);

module.exports = router;
