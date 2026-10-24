const request = require('supertest');
const bcrypt = require('bcryptjs');
const { Prisma } = require('@prisma/client');
const app = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { sessionStore } = require('../../src/config/session');
const authService = require('../../src/services/auth.service');
const pacientesService = require('../../src/services/pacientes.service');
const { emailUnico } = require('../helpers/emailUnico');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Erro com o formato do que o Prisma devolve numa falha de banco: a mensagem
// traz o `detail` do Postgres com valores da linha (aqui, um CPF e um nome
// fictícios). Nada disso pode aparecer na resposta nem no log.
const DADO_SENSIVEL = 'Maria Sigilosa 11144477735';
const erroDoPrisma = () =>
  new Prisma.PrismaClientUnknownRequestError(`ConnectorError detail: Some("Registro (${DADO_SENSIVEL})")`, {
    clientVersion: Prisma.prismaVersion.client,
  });

// Força um erro inesperado dentro de uma rota real: o login chama o service,
// que aqui é trocado por um que falha.
const loginQueFalha = (erro) => {
  jest.spyOn(authService, 'autenticar').mockRejectedValue(erro);
  return request(app).post('/auth/login').send({ email: 'qualquer@exemplo.test', senha: 'x' });
};

let logErro;

beforeEach(() => {
  logErro = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
  sessionStore.close();
});

describe('X-Request-Id', () => {
  test('toda resposta traz um id novo (UUID), gerado pelo servidor', async () => {
    const [r1, r2] = await Promise.all([request(app).get('/health'), request(app).get('/health')]);

    expect(r1.headers['x-request-id']).toMatch(UUID);
    expect(r2.headers['x-request-id']).toMatch(UUID);
    expect(r1.headers['x-request-id']).not.toBe(r2.headers['x-request-id']);
  });

  test('id enviado pelo cliente é ignorado (não deixa escrever no log)', async () => {
    const resposta = await request(app).get('/health').set('X-Request-Id', 'texto-do-atacante');

    expect(resposta.headers['x-request-id']).toMatch(UUID);
  });
});

describe('erro desconhecido (500)', () => {
  test('o corpo traz só `erro` e `requestId` (o mesmo do cabeçalho)', async () => {
    const resposta = await loginQueFalha(erroDoPrisma());

    expect(resposta.status).toBe(500);
    expect(resposta.body).toEqual({ erro: 'Erro interno do servidor', requestId: resposta.headers['x-request-id'] });
    expect(JSON.stringify(resposta.body)).not.toContain('11144477735');
  });

  test('erro do Prisma: o log tem requestId, rota e tipo, mas não a mensagem (nem no stack)', async () => {
    const resposta = await loginQueFalha(erroDoPrisma());

    expect(logErro).toHaveBeenCalledTimes(1);
    const linha = logErro.mock.calls[0][0];
    const registro = JSON.parse(linha);
    expect(registro).toMatchObject({
      requestId: resposta.headers['x-request-id'],
      metodo: 'POST',
      rota: '/auth/login',
      tipo: 'PrismaClientUnknownRequestError',
    });
    expect(registro).not.toHaveProperty('mensagem');
    expect(registro.stack.length).toBeGreaterThan(0); // fora de produção, tem stack...
    expect(registro.stack.every((l) => l.trimStart().startsWith('at '))).toBe(true); // ...só as linhas "at"
    expect(linha).not.toContain('Maria Sigilosa');
    expect(linha).not.toContain('11144477735');
  });

  test('erro que não é do Prisma (bug no código): a mensagem entra no log', async () => {
    await loginQueFalha(new TypeError("Cannot read properties of undefined (reading 'id')"));

    const registro = JSON.parse(logErro.mock.calls[0][0]);
    expect(registro).toMatchObject({ tipo: 'TypeError', mensagem: expect.stringMatching(/reading 'id'/) });
  });

  test('query string não entra no log', async () => {
    jest.spyOn(authService, 'autenticar').mockRejectedValue(erroDoPrisma());
    await request(app).post('/auth/login?busca=Maria').send({ email: 'q@exemplo.test', senha: 'x' });

    const linha = logErro.mock.calls[0][0];
    expect(JSON.parse(linha).rota).toBe('/auth/login');
    expect(linha).not.toContain('Maria');
  });

  test('rota com parâmetro aparece no padrão (/pacientes/:id), sem o id', async () => {
    // Usuária real (fictícia) logada, para o erro acontecer DENTRO da rota.
    const senha = 'senha-de-teste-erros';
    const usuaria = await prisma.usuario.create({
      data: { nome: 'Psicóloga Erros (fictícia)', email: emailUnico('erros.log'), senhaHash: await bcrypt.hash(senha, 4) },
    });
    try {
      const agente = request.agent(app);
      await agente.post('/auth/login').send({ email: usuaria.email, senha });
      jest.spyOn(pacientesService, 'buscar').mockRejectedValue(erroDoPrisma());

      const resposta = await agente.get('/pacientes/987654');

      expect(resposta.status).toBe(500);
      const linha = logErro.mock.calls[0][0];
      expect(JSON.parse(linha)).toMatchObject({ metodo: 'GET', rota: '/pacientes/:id' });
      expect(linha).not.toContain('987654');
    } finally {
      await prisma.$executeRaw`DELETE FROM "session" WHERE (sess -> 'usuario' ->> 'id')::int = ${usuaria.id}`;
      await prisma.logAcesso.deleteMany({ where: { usuarioId: usuaria.id } });
      await prisma.usuario.delete({ where: { id: usuaria.id } });
    }
  });

  test('em produção, o log não leva stack', () => {
    const anterior = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      jest.isolateModules(() => {
        // Módulos carregados de novo, lendo NODE_ENV=production.
        const errorHandlerProd = require('../../src/middlewares/errorHandler');
        const { Prisma: PrismaProd } = require('@prisma/client');
        const res = { headersSent: false };
        res.status = jest.fn(() => res);
        res.json = jest.fn(() => res);
        const erro = new PrismaProd.PrismaClientUnknownRequestError(DADO_SENSIVEL, {
          clientVersion: PrismaProd.prismaVersion.client,
        });

        errorHandlerProd(erro, { id: 'req-prod', method: 'GET' }, res, jest.fn());

        expect(res.json).toHaveBeenCalledWith({ erro: 'Erro interno do servidor', requestId: 'req-prod' });
        const linha = logErro.mock.calls[0][0];
        expect(JSON.parse(linha)).not.toHaveProperty('stack');
        expect(linha).not.toContain('11144477735');
      });
    } finally {
      process.env.NODE_ENV = anterior;
    }
  });
});
