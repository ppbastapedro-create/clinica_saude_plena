const { Router } = require('express');
const pacientesController = require('../controllers/pacientes.controller');
const { exigirAutenticacao, exigirPapel } = require('../middlewares/autenticacao');

const router = Router();

// PROVISÓRIO (desenvolvimento): ADMIN também acessa. Antes da implantação,
// trocar para exigirPapel('PSICOLOGO') — sigilo profissional (CFP). Ver
// CLAUDE.md, "Papel ADMIN".
router.use(exigirAutenticacao, exigirPapel('PSICOLOGO', 'ADMIN'));

router.get('/', pacientesController.listar);
router.post('/', pacientesController.criar);
router.get('/:id', pacientesController.buscar);
router.get('/:id/sessoes', pacientesController.sessoes);
router.put('/:id', pacientesController.atualizar);
router.patch('/:id/arquivar', pacientesController.arquivar);
router.patch('/:id/reativar', pacientesController.reativar);
// Sem DELETE: paciente nunca é excluído fisicamente (guarda mínima de 5 anos,
// Resolução CFP nº 001/2009). Encerrar o acompanhamento = arquivar.

module.exports = router;
