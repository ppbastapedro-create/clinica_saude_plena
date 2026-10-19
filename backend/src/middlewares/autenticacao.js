const usuariosRepository = require('../repositories/usuarios.repository');
const { encerrarSessao, TETO_ABSOLUTO_MS } = require('../config/session');

const NAO_AUTENTICADO = { erro: 'Não autenticado' };

// Exige sessão válida. Além de olhar o cookie, consulta o usuário no banco a
// cada requisição: se a conta foi desativada, as sessões abertas dela param
// de valer na hora (sem a consulta, durariam até expirar). Deixa em
// req.usuario os dados atuais (id, nome, email, papel).
async function exigirAutenticacao(req, res, next) {
  const id = req.session?.usuario?.id;
  if (!id) return res.status(401).json(NAO_AUTENTICADO);

  const criadaEm = req.session.criadaEm;
  if (typeof criadaEm !== 'number' || Date.now() - criadaEm > TETO_ABSOLUTO_MS) {
    await encerrarSessao(req, res);
    return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
  }

  const usuario = await usuariosRepository.buscarPorId(id);
  if (!usuario || !usuario.ativo) {
    await encerrarSessao(req, res);
    return res.status(401).json(NAO_AUTENTICADO);
  }

  const { nome, email, papel } = usuario;
  req.usuario = { id, nome, email, papel };
  return next();
}

// Exige que o usuário (já autenticado) tenha um dos papéis informados. Usar
// sempre DEPOIS de exigirAutenticacao. Ex.: exigirPapel('PSICOLOGO', 'ADMIN').
function exigirPapel(...papeis) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json(NAO_AUTENTICADO);
    if (!papeis.includes(req.usuario.papel)) {
      return res.status(403).json({ erro: 'Acesso negado' });
    }
    return next();
  };
}

module.exports = { exigirAutenticacao, exigirPapel };
