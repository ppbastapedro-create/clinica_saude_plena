const { Router } = require('express');
const pacientesController = require('../controllers/pacientes.controller');
const financeiroController = require('../controllers/financeiro.controller');
const { exigirAutenticacao, exigirPapel } = require('../middlewares/autenticacao');

const router = Router();

// Só PSICOLOGO: o ADMIN gerencia contas, mas não vê dado clínico — sigilo
// profissional (CFP). O acesso provisório do ADMIN acabou no pacote 1.5.2.
router.use(exigirAutenticacao, exigirPapel('PSICOLOGO'));

router.get('/', pacientesController.listar);
router.post('/', pacientesController.criar);
router.get('/:id', pacientesController.buscar);
router.get('/:id/sessoes', pacientesController.sessoes);
// Conta corrente do paciente: extrato (débitos e créditos) e recebimentos.
router.get('/:id/financeiro', financeiroController.extrato);
router.post('/:id/recebimentos', financeiroController.registrarRecebimento);
router.put('/:id', pacientesController.atualizar);
router.patch('/:id/arquivar', pacientesController.arquivar);
router.patch('/:id/reativar', pacientesController.reativar);
// Sem DELETE: paciente nunca é excluído fisicamente (guarda mínima de 5 anos,
// Resolução CFP nº 001/2009). Encerrar o acompanhamento = arquivar.

module.exports = router;
