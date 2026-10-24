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
const SENHA_ANTIGA = 'senha-antiga-de-teste';
const SENHA_NOVA = 'senha-nova-de-teste-123';
const CONTA = { nome: 'Psicóloga Contas (fictícia)', email: emailUnico('contas.redefinir') };

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'redefinir-senha.js');

let conta;

const login = (senha) => request(app).post('/auth/login').send({ email: CONTA.email, senha });

// Roda o script como a pessoa rodaria, mandando as respostas pela entrada
// padrão. O processo filho herda o DATABASE_URL do banco de teste.
function rodarScript({ args = [], respostas = [] } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    input: respostas.map((r) => `${r}\n`).join(''),
    env: process.env,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

beforeAll(async () => {
  conta = await prisma.usuario.create({ data: { ...CONTA, senhaHash: await bcrypt.hash(SENHA_ANTIGA, 4) } });
});

// Cada teste começa com a senha antiga e a conta desbloqueada.
beforeEach(async () => {
  await prisma.usuario.update({
    where: { id: conta.id },
    data: { senhaHash: await bcrypt.hash(SENHA_ANTIGA, 4), tentativasFalhas: 0, bloqueadoAte: null },
  });
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "session" WHERE (sess -> 'usuario' ->> 'id')::int = ${conta.id}`;
  await prisma.logAcesso.deleteMany({ where: { usuarioId: conta.id } }); // FK RESTRICT
  await prisma.usuario.delete({ where: { id: conta.id } });
  await prisma.$disconnect();
  sessionStore.close();
});

describe('contasService.redefinirSenha', () => {
  test('a senha nova passa a valer e a antiga deixa de valer', async () => {
    await contasService.redefinirSenha(CONTA.email, SENHA_NOVA);

    expect((await login(SENHA_NOVA)).status).toBe(200);
    expect((await login(SENHA_ANTIGA)).status).toBe(401);
  });

  test('desfaz o bloqueio por tentativas', async () => {
    await prisma.usuario.update({
      where: { id: conta.id },
      data: { tentativasFalhas: 3, bloqueadoAte: new Date(Date.now() + 10 * 60_000) },
    });

    await contasService.redefinirSenha(CONTA.email, SENHA_NOVA);

    const atual = await prisma.usuario.findUnique({ where: { id: conta.id } });
    expect(atual).toMatchObject({ tentativasFalhas: 0, bloqueadoAte: null });
    expect((await login(SENHA_NOVA)).status).toBe(200);
  });

  test('encerra as sessões que já estavam abertas', async () => {
    const agente = request.agent(app);
    await agente.post('/auth/login').send({ email: CONTA.email, senha: SENHA_ANTIGA });
    expect((await agente.get('/auth/me')).status).toBe(200);

    await contasService.redefinirSenha(CONTA.email, SENHA_NOVA);

    expect((await agente.get('/auth/me')).status).toBe(401);
  });

  test('aceita o e-mail com espaços e maiúsculas', async () => {
    await contasService.redefinirSenha(`  ${CONTA.email.toUpperCase()} `, SENHA_NOVA);
    expect((await login(SENHA_NOVA)).status).toBe(200);
  });

  test.each([
    ['curta demais', 'curta', /pelo menos 12/],
    ['acima de 72 bytes', 'x'.repeat(73), /no máximo 72 bytes/],
  ])('senha %s: recusa e não altera nada', async (_caso, senha, mensagem) => {
    const antes = (await prisma.usuario.findUnique({ where: { id: conta.id } })).senhaHash;

    await expect(contasService.redefinirSenha(CONTA.email, senha)).rejects.toThrow(mensagem);

    expect((await prisma.usuario.findUnique({ where: { id: conta.id } })).senhaHash).toBe(antes);
  });

  test('e-mail sem conta: recusa', async () => {
    await expect(contasService.redefinirSenha('ninguem@exemplo.test', SENHA_NOVA)).rejects.toThrow(
      /Nenhuma conta com o e-mail ninguem@exemplo.test/,
    );
  });
});

describe('script npm run usuario:senha', () => {
  test('recusa senha (ou qualquer coisa) por argumento, sem alterar nada', () => {
    const antes = rodarScript({ args: [CONTA.email, SENHA_NOVA] });

    expect(antes.status).toBe(1);
    expect(antes.stderr).toMatch(/não aceita argumentos/);
    expect(antes.stdout).toBe(''); // saiu antes de perguntar qualquer coisa
  });

  test('pelo prompt: redefine a senha', async () => {
    const resultado = rodarScript({ respostas: [CONTA.email, SENHA_NOVA, SENHA_NOVA] });

    expect(resultado.stderr).toBe('');
    expect(resultado.status).toBe(0);
    expect(resultado.stdout).toMatch(/Senha redefinida/);
    expect(resultado.stdout).not.toContain(SENHA_NOVA); // a senha não aparece na saída
    expect((await login(SENHA_NOVA)).status).toBe(200);
  }, 30_000);

  test('pelo prompt: confirmação diferente não altera nada', async () => {
    const resultado = rodarScript({ respostas: [CONTA.email, SENHA_NOVA, 'outra-senha-qualquer'] });

    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toMatch(/não conferem/);
    expect((await login(SENHA_ANTIGA)).status).toBe(200);
  }, 30_000);

  test('pelo prompt: senha com $, crase e aspas é gravada exatamente como digitada', async () => {
    // Justamente os caracteres que o PowerShell interpretaria num argumento.
    const senhaEspecial = 'a$b`c"d\'e $env:PATH';

    const resultado = rodarScript({ respostas: [CONTA.email, senhaEspecial, senhaEspecial] });

    expect(resultado.status).toBe(0);
    expect((await login(senhaEspecial)).status).toBe(200);
  }, 30_000);
});
