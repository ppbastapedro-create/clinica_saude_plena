const usuariosRepository = require('../repositories/usuarios.repository');
const { compararSenha, obterHashFalso } = require('../utils/senha');

// Devolve o usuário se e-mail e senha conferem e a conta está ativa; senão,
// null. Os três motivos de falha (e-mail inexistente, senha errada, conta
// inativa) são indistinguíveis para quem chama — de propósito: a resposta da
// API não pode revelar se um e-mail tem conta.
async function autenticar({ email, senha }) {
  const usuario = await usuariosRepository.buscarParaLogin(email);

  // Compara sempre, mesmo sem usuário, para o tempo de resposta não variar.
  const senhaConfere = await compararSenha(senha, usuario?.senhaHash ?? obterHashFalso());

  if (!usuario || !senhaConfere || !usuario.ativo) return null;

  const { id, nome, papel } = usuario;
  return { id, nome, email: usuario.email, papel };
}

module.exports = { autenticar };
