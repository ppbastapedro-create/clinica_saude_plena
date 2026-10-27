// Troca o e-mail (login) de uma conta existente, de forma interativa:
//   npm run usuario:email
// Usa o DATABASE_URL do backend/.env. A senha não muda, e quem está logado
// continua logado (a sessão guarda só o id da conta).
//
// Mesma regra do usuario:senha: nada por argumento, só pelo prompt.

// Checado antes de qualquer require: sai sem nem conectar ao banco.
if (process.argv.length > 2) {
  console.error('Erro: este script não aceita argumentos. Rode só "npm run usuario:email" e responda às perguntas.');
  process.exit(1);
}

require('../src/config/env');
const prisma = require('../src/config/prisma');
const usuariosRepository = require('../src/repositories/usuarios.repository');
const contasService = require('../src/services/contas.service');
const { criarPrompt } = require('./lib/terminal');

const prompt = criarPrompt();

async function main() {
  console.log('Trocar e-mail no Saúde Plena\n');

  const emailAtual = (await prompt.perguntar('E-mail atual da conta: ')).trim().toLowerCase();
  const usuario = await usuariosRepository.buscarPorEmail(emailAtual);
  if (!usuario) throw new Error(`Nenhuma conta com o e-mail ${emailAtual}.`);
  console.log(`Conta: ${usuario.nome} (${usuario.papel})`);

  const emailNovo = await prompt.perguntar('E-mail novo: ');
  const confirmacao = await prompt.perguntar('Confirme o e-mail novo: ');
  if (emailNovo.trim().toLowerCase() !== confirmacao.trim().toLowerCase()) {
    throw new Error('Os e-mails não conferem. Nada foi alterado.');
  }

  const atualizado = await contasService.trocarEmail(emailAtual, emailNovo);
  console.log(`\nE-mail trocado. O login agora é ${atualizado.email} (a senha continua a mesma).`);
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
