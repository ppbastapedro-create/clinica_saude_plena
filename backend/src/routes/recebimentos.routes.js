const { Router } = require('express');
const financeiroController = require('../controllers/financeiro.controller');
const { exigirAutenticacao, exigirPapel } = require('../middlewares/autenticacao');

const router = Router();

// Só PSICOLOGO: dados financeiros de pacientes (sigilo profissional, CFP).
// O acesso provisório do ADMIN acabou no pacote 1.5.2.
router.use(exigirAutenticacao, exigirPapel('PSICOLOGO'));

// Criar recebimento é por paciente: POST /pacientes/:id/recebimentos.
// Sem DELETE: lançamento errado é estornado e continua no histórico.
router.patch('/:id/estornar', financeiroController.estornarRecebimento);

module.exports = router;
