const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { sessionStore } = require('../../src/config/session');
const contasService = require('../../src/services/contas.service');
const { emailUnico } = require('../helpers/emailUnico');

// Dados fictícios.
const SENHA = 'senha-de-teste-email-123';
const EMAIL_ORIGINAL = emailUnico('contas.email');
const EMAIL_NOVO = emailUnico('contas.email.novo');
const EMAIL_OUTRA = emailUnico('contas.email.outra');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'trocar-email.js');

let conta;
let outra;

const login = (email) => request(app).post('/auth/login').send({ email, senha: SENHA });

function rodarScript({ args = [], respostas = [] } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    input: respostas.map((r) => `${r}\n`).join(''),
    env: process.env,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

beforeAll(async () => {
  const senhaHash = await bcrypt.hash(SENHA, 4);
  conta = await prisma.usuario.create({ data: { nome: 'Psicóloga E-mail (fictícia)', email: EMAIL_ORIGINAL, senhaHash } });
  outra = await prisma.usuario.create({ data: { nome: 'Outra conta (fictícia)', email: EMAIL_OUTRA, senhaHash } });
});

// Cada teste começa com o e-mail original.
beforeEach(async () => {
  await prisma.usuario.update({ where: { id: conta.id }, data: { email: EMAIL_ORIGINAL } });
});

afterAll(async () => {
  const ids = [conta.id, outra.id];
  await prisma.$executeRaw`DELETE FROM "session" WHERE (sess -> 'usuario' ->> 'id')::int = ANY(${ids})`;
  await prisma.logAcesso.deleteMany({ where: { usuarioId: { in: ids } } }); // FK RESTRICT
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  sessionStore.close();
});

describe('contasService.trocarEmail', () => {
  test('o login passa a ser o e-mail novo, com a mesma senha', async () => {
    await contasService.trocarEmail(EMAIL_ORIGINAL, EMAIL_NOVO);

    expect((await login(EMAIL_NOVO)).status).toBe(200);
    expect((await login(EMAIL_ORIGINAL)).status).toBe(401);
  });

  test('quem já estava logado continua logado e vê o e-mail novo', async () => {
    const agente = request.agent(app);
    await agente.post('/auth/login').send({ email: EMAIL_ORIGINAL, senha: SENHA });

    await contasService.trocarEmail(EMAIL_ORIGINAL, EMAIL_NOVO);

    const me = await agente.get('/auth/me');
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).toContain(EMAIL_NOVO);
  });

  test('normaliza os dois e-mails (espaços e maiúsculas)', async () => {
    await contasService.trocarEmail(`  ${EMAIL_ORIGINAL.toUpperCase()} `, `  ${EMAIL_NOVO.toUpperCase()} `);

    const atual = await prisma.usuario.findUnique({ where: { id: conta.id } });
    expect(atual.email).toBe(EMAIL_NOVO);
  });

  test.each([
    ['inválido', 'nao-e-email', /E-mail inválido/],
    ['de outra conta', EMAIL_OUTRA, /Já existe uma conta/],
    ['igual ao atual', EMAIL_ORIGINAL, /igual ao atual/],
  ])('e-mail novo %s: recusa e não altera nada', async (_caso, novo, mensagem) => {
    await expect(contasService.trocarEmail(EMAIL_ORIGINAL, novo)).rejects.toThrow(mensagem);

    expect((await prisma.usuario.findUnique({ where: { id: conta.id } })).email).toBe(EMAIL_ORIGINAL);
  });

  test('e-mail atual sem conta: recusa', async () => {
    await expect(contasService.trocarEmail('ninguem@exemplo.test', EMAIL_NOVO)).rejects.toThrow(
      /Nenhuma conta com o e-mail ninguem@exemplo.test/,
    );
  });
});

describe('script npm run usuario:email', () => {
  test('recusa argumentos, sem alterar nada', () => {
    const resultado = rodarScript({ args: [EMAIL_ORIGINAL, EMAIL_NOVO] });

    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toMatch(/não aceita argumentos/);
    expect(resultado.stdout).toBe('');
  });

  test('pelo prompt: troca o e-mail', async () => {
    const resultado = rodarScript({ respostas: [EMAIL_ORIGINAL, EMAIL_NOVO, EMAIL_NOVO] });

    expect(resultado.stderr).toBe('');
    expect(resultado.status).toBe(0);
    expect(resultado.stdout).toMatch(/E-mail trocado/);
    expect((await login(EMAIL_NOVO)).status).toBe(200);
  }, 30_000);

  test('pelo prompt: confirmação diferente não altera nada', async () => {
    const resultado = rodarScript({ respostas: [EMAIL_ORIGINAL, EMAIL_NOVO, 'outro@exemplo.test'] });

    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toMatch(/não conferem/);
    expect((await login(EMAIL_ORIGINAL)).status).toBe(200);
  }, 30_000);
});
