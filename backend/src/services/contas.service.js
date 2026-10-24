const usuariosRepository = require('../repositories/usuarios.repository');
const { gerarHash, problemaNaSenha } = require('../utils/senha');

// Gestão de contas feita fora da API (scripts de terminal). Não existe rota
// HTTP para isto: quem roda o script já tem acesso ao servidor e ao banco.
// Por isso a mensagem pode dizer que o e-mail não existe — aqui não há
// atacante anônimo do outro lado, como no login.

// Redefine a senha da conta e devolve os dados públicos dela. Lança Error
// com mensagem para exibir no terminal se algo impedir.
async function redefinirSenha(email, novaSenha) {
  const problema = problemaNaSenha(novaSenha);
  if (problema) throw new Error(problema);

  const emailNormalizado = String(email).trim().toLowerCase();
  const usuario = await usuariosRepository.buscarPorEmail(emailNormalizado);
  if (!usuario) throw new Error(`Nenhuma conta com o e-mail ${emailNormalizado}.`);

  await usuariosRepository.redefinirSenha(usuario.id, await gerarHash(novaSenha));
  return usuario;
}

module.exports = { redefinirSenha };
