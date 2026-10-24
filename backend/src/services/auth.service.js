const usuariosRepository = require('../repositories/usuarios.repository');
const logAcessoRepository = require('../repositories/logAcesso.repository');
const { compararSenha, obterHashFalso } = require('../utils/senha');

// Bloqueio por conta: 5 senhas erradas seguidas bloqueiam o login por 15 min.
// Protege contra quem tenta adivinhar a senha DESTA conta (mesmo trocando de
// IP, o que o limite por IP não pega). 15 min é curto o bastante para a
// psicóloga não ficar presa fora do consultório e longo o bastante para
// tornar inviável testar milhares de senhas.
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;

// Devolve o usuário se e-mail e senha conferem e a conta está ativa e
// desbloqueada; senão, null. Os motivos de falha (e-mail inexistente, senha
// errada, conta inativa, conta bloqueada) são indistinguíveis para quem
// chama — de propósito: a resposta da API não pode revelar se um e-mail tem
// conta. O motivo fica só na auditoria (LogAcesso), que não sai do backend.
async function autenticar({ email, senha }) {
  const usuario = await usuariosRepository.buscarParaLogin(email);

  // Compara sempre, mesmo sem usuário ou com conta bloqueada, para o tempo de
  // resposta não variar.
  const senhaConfere = await compararSenha(senha, usuario?.senhaHash ?? obterHashFalso());

  if (!usuario) {
    await logAcessoRepository.registrar({ acao: 'LOGIN_FALHO' });
    return null;
  }

  const bloqueada = usuario.bloqueadoAte !== null && usuario.bloqueadoAte > new Date();

  if (bloqueada || !senhaConfere || !usuario.ativo) {
    // Durante o bloqueio as tentativas não contam: senão o bloqueio se
    // renovaria sozinho enquanto alguém insistisse, e a dona da conta nunca
    // conseguiria voltar a entrar.
    if (!bloqueada && !senhaConfere) await registrarSenhaErrada(usuario.id);
    await logAcessoRepository.registrar({ acao: 'LOGIN_FALHO', usuarioId: usuario.id });
    return null;
  }

  if (usuario.tentativasFalhas > 0 || usuario.bloqueadoAte !== null) {
    await usuariosRepository.zerarFalhasLogin(usuario.id);
  }
  await logAcessoRepository.registrar({ acao: 'LOGIN', usuarioId: usuario.id });

  const { id, nome, papel } = usuario;
  return { id, nome, email: usuario.email, papel };
}

async function registrarSenhaErrada(usuarioId) {
  const falhas = await usuariosRepository.incrementarFalhasLogin(usuarioId);
  if (falhas >= MAX_TENTATIVAS) {
    await usuariosRepository.bloquearLogin(usuarioId, new Date(Date.now() + BLOQUEIO_MS));
  }
}

async function registrarLogout(usuarioId) {
  await logAcessoRepository.registrar({ acao: 'LOGOUT', usuarioId });
}

module.exports = { autenticar, registrarLogout, MAX_TENTATIVAS, BLOQUEIO_MS };
