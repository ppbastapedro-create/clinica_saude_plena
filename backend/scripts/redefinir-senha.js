// Redefine a senha de uma conta existente, de forma interativa:
//   npm run usuario:senha
// Usa o DATABASE_URL do backend/.env. Além de trocar a senha, desfaz o
// bloqueio por tentativas e encerra as sessões abertas da conta.
//
// A senha só é aceita pelo prompt, sem eco — nunca por argumento: na linha
// de comando ela ficaria no histórico do terminal e poderia ser alterada pelo
// PowerShell ($, crase e aspas têm significado especial lá).

// Checado antes de qualquer require: sai sem nem conectar ao banco.
if (process.argv.length > 2) {
  console.error('Erro: este script não aceita argumentos. Rode só "npm run usuario:senha" e responda às perguntas.');
  process.exit(1);
}

require('../src/config/env');
const prisma = require('../src/config/prisma');
const usuariosRepository = require('../src/repositories/usuarios.repository');
const contasService = require('../src/services/contas.service');
const { MIN_CARACTERES_SENHA } = require('../src/utils/senha');
const { criarPrompt } = require('./lib/terminal');

const prompt = criarPrompt();

async function main() {
  console.log('Redefinir senha no Saúde Plena\n');

  const email = (await prompt.perguntar('E-mail da conta: ')).trim().toLowerCase();
  // Confere o e-mail antes de pedir a senha: não faz digitar duas vezes à toa.
  const usuario = await usuariosRepository.buscarPorEmail(email);
  if (!usuario) throw new Error(`Nenhuma conta com o e-mail ${email}.`);
  console.log(`Conta: ${usuario.nome} (${usuario.papel})`);

  const senha = await prompt.perguntar(`Nova senha (mín. ${MIN_CARACTERES_SENHA} caracteres, não aparece na tela): `, {
    oculto: true,
  });
  const confirmacao = await prompt.perguntar('Confirme a nova senha: ', { oculto: true });
  if (senha !== confirmacao) throw new Error('As senhas não conferem. Nada foi alterado.');

  await contasService.redefinirSenha(email, senha);
  console.log('\nSenha redefinida. Bloqueio desfeito e sessões abertas encerradas.');
}

main()
  .catch((erro) => {
    console.error(`\nErro: ${erro.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    prompt.fechar();
    await prisma.$disconnect();
  });
