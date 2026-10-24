const { Router } = require('express');
const agendamentosController = require('../controllers/agendamentos.controller');
const registrosController = require('../controllers/registros.controller');
const { exigirAutenticacao, exigirPapel } = require('../middlewares/autenticacao');

const router = Router();

// PROVISÓRIO (desenvolvimento): ADMIN também acessa. Antes da implantação,
// trocar para exigirPapel('PSICOLOGO') — sigilo profissional (CFP). Ver
// CLAUDE.md, "Papel ADMIN".
router.use(exigirAutenticacao, exigirPapel('PSICOLOGO', 'ADMIN'));

router.get('/', agendamentosController.listar);
router.post('/', agendamentosController.criar);
router.get('/:id', agendamentosController.buscar);
router.put('/:id', agendamentosController.remarcar);
router.patch('/:id/status', agendamentosController.alterarStatus);

// Registro de evolução da sessão (prontuário, dado sensível).
// no-store: o navegador não guarda a resposta em cache (nem em disco) — o
// texto clínico não pode ficar no computador depois que a página fecha.
const semCache = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};
router.get('/:id/registro', semCache, registrosController.ler);
router.put('/:id/registro', semCache, registrosController.salvar);
// Sem DELETE: cancelar é PATCH /:id/status { "status": "CANCELADO" } — o
// histórico fica (guarda mínima de 5 anos, Resolução CFP nº 001/2009).

module.exports = router;
