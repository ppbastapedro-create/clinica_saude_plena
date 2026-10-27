const { Router } = require('express');
const agendamentosController = require('../controllers/agendamentos.controller');
const registrosController = require('../controllers/registros.controller');
const { exigirAutenticacao, exigirPapel } = require('../middlewares/autenticacao');

const router = Router();

// Só PSICOLOGO: o ADMIN gerencia contas, mas não vê dado clínico — sigilo
// profissional (CFP). O acesso provisório do ADMIN acabou no pacote 1.5.2.
router.use(exigirAutenticacao, exigirPapel('PSICOLOGO'));

router.get('/', agendamentosController.listar);
router.post('/', agendamentosController.criar);
router.get('/:id', agendamentosController.buscar);
router.put('/:id', agendamentosController.remarcar);
router.patch('/:id/status', agendamentosController.alterarStatus);
// Cobrança da sessão: valor e "cobrar?" (o que entra na conta do paciente).
router.patch('/:id/cobranca', agendamentosController.atualizarCobranca);

// Registro de evolução da sessão (prontuário, dado sensível). O no-store,
// que antes era só destas duas rotas, vale para toda a API (app.js).
router.get('/:id/registro', registrosController.ler);
router.put('/:id/registro', registrosController.salvar);
// Sem DELETE: cancelar é PATCH /:id/status { "status": "CANCELADO" } — o
// histórico fica (guarda mínima de 5 anos, Resolução CFP nº 001/2009).

module.exports = router;
