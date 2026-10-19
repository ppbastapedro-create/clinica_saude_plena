// Cria uma conta de usuário (psicólogo ou administrador) de forma interativa:
//   npm run usuario:criar
// Não existe rota de cadastro na API — contas só nascem por aqui (ou pelo
// seed, em desenvolvimento). Usa o DATABASE_URL do backend/.env.
//
// A senha é digitada sem eco (nada aparece na tela) e nunca vai para a linha
// de comando, onde ficaria salva no histórico do terminal.
const readline = require('readline');
const { z } = require('zod');
require('../src/config/env');
const prisma = require('../src/config/prisma');
const usuariosRepository = require('../src/repositories/usuarios.repository');
const { gerarHash, MAX_BYTES_SENHA } = require('../src/utils/senha');

const MIN_CARACTERES_SENHA = 12;

const schema = z.object({
  nome: z.string().trim().min(2, 'Nome muito curto'),
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
  papel: z.enum(['PSICOLOGO', 'ADMIN'], 'Papel deve ser PSICOLOGO ou ADMIN'),
  senha: z
    .string()
    .min(MIN_CARACTERES_SENHA, `A senha precisa de pelo menos ${MIN_CARACTERES_SENHA} caracteres`)
    .refine((s) => Buffer.byteLength(s, 'utf8') <= MAX_BYTES_SENHA, `A senha pode ter no máximo ${MAX_BYTES_SENHA} bytes`),
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: Boolean(process.stdin.isTTY),
});
const linhas = rl[Symbol.asyncIterator]();

// Para não ecoar a senha, silencia a saída do readline enquanto ela é
// digitada (_writeToOutput é interno do Node, mas é a forma usual de fazer
// isso sem dependência extra). A pergunta em si é escrita direto no stdout.
let mudo = false;
const escreverOriginal = rl._writeToOutput.bind(rl);
rl._writeToOutput = (texto) => {
  if (!mudo) escreverOriginal(texto);
};

async function perguntar(texto, { oculto = false } = {}) {
  process.stdout.write(texto);
  mudo = oculto;
  const { value, done } = await linhas.next();
  if (oculto) {
    mudo = false;
    process.stdout.write('\n');
  }
  if (done) throw new Error('Entrada encerrada antes do fim.');
  return value;
}

async function main() {
  console.log('Criar conta no Saúde Plena\n');

  const nome = await perguntar('Nome: ');
  const email = await perguntar('E-mail: ');
  const papel = ((await perguntar('Papel [PSICOLOGO/ADMIN] (Enter = PSICOLOGO): ')).trim() || 'PSICOLOGO').toUpperCase();
  const senha = await perguntar(`Senha (mín. ${MIN_CARACTERES_SENHA} caracteres, não aparece na tela): `, { oculto: true });
  const confirmacao = await perguntar('Confirme a senha: ', { oculto: true });

  const dados = schema.safeParse({ nome, email, papel, senha });
  if (!dados.success) {
    throw new Error(dados.error.issues.map((i) => i.message).join('; '));
  }
  if (senha !== confirmacao) throw new Error('As senhas não conferem.');

  if (await usuariosRepository.existeEmail(dados.data.email)) {
    throw new Error(`Já existe uma conta com o e-mail ${dados.data.email}.`);
  }

  const usuario = await usuariosRepository.criar({
    nome: dados.data.nome,
    email: dados.data.email,
    papel: dados.data.papel,
    senhaHash: await gerarHash(dados.data.senha),
  });

  console.log(`\nConta criada: id ${usuario.id}, ${usuario.email} (${usuario.papel}).`);
}

main()
  .catch((erro) => {
    console.error(`\nErro: ${erro.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
