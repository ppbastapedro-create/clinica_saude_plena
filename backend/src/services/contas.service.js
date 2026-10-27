const { z } = require('zod');
const usuariosRepository = require('../repositories/usuarios.repository');
const { gerarHash, problemaNaSenha } = require('../utils/senha');

// Gestão de contas feita fora da API (scripts de terminal). Não existe rota
// HTTP para isto: quem roda o script já tem acesso ao servidor e ao banco.
// Por isso a mensagem pode dizer que o e-mail não existe — aqui não há
// atacante anônimo do outro lado, como no login.

// Mesma normalização do login (auth.controller): sem espaços e minúsculo.
const schemaEmail = z.string().trim().toLowerCase().pipe(z.email('E-mail inválido').max(254));

const normalizar = (email) => String(email).trim().toLowerCase();

async function buscarConta(email) {
  const usuario = await usuariosRepository.buscarPorEmail(normalizar(email));
  if (!usuario) throw new Error(`Nenhuma conta com o e-mail ${normalizar(email)}.`);
  return usuario;
}

// Redefine a senha da conta e devolve os dados públicos dela. Lança Error
// com mensagem para exibir no terminal se algo impedir.
async function redefinirSenha(email, novaSenha) {
  const problema = problemaNaSenha(novaSenha);
  if (problema) throw new Error(problema);

  const usuario = await buscarConta(email);
  await usuariosRepository.redefinirSenha(usuario.id, await gerarHash(novaSenha));
  return usuario;
}

// Troca o e-mail (que é o login) da conta e devolve os dados atualizados.
async function trocarEmail(emailAtual, emailNovo) {
  const validacao = schemaEmail.safeParse(emailNovo);
  if (!validacao.success) throw new Error(validacao.error.issues[0].message);
  const novo = validacao.data;

  const usuario = await buscarConta(emailAtual);
  if (novo === usuario.email) throw new Error('O e-mail novo é igual ao atual. Nada foi alterado.');
  if (await usuariosRepository.existeEmail(novo)) throw new Error(`Já existe uma conta com o e-mail ${novo}.`);

  try {
    return await usuariosRepository.trocarEmail(usuario.id, novo);
  } catch (erro) {
    // Outra conta pegou o e-mail entre a checagem acima e o UPDATE: o
    // @unique do banco é a garantia final.
    if (erro.code === 'P2002') throw new Error(`Já existe uma conta com o e-mail ${novo}.`);
    throw erro;
  }
}

module.exports = { redefinirSenha, trocarEmail };
