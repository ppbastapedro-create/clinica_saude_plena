const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { sessionStore, NOME_COOKIE, INATIVIDADE_MS, TETO_ABSOLUTO_MS } = require('../../src/config/session');

// Dados fictícios. Custo 4 no bcrypt só para o teste ser rápido — o
// compare funciona com qualquer custo.
const SENHA = 'senha-correta-de-teste';
const ATIVA = { nome: 'Psicóloga Auth (fictícia)', email: 'auth.ativa@exemplo.test' };
const INATIVA = { nome: 'Psicóloga Inativa (fictícia)', email: 'auth.inativa@exemplo.test' };

let ativa;
let inativa;

// Cookie de sessão vindo no Set-Cookie: "sp.sid=s%3A<sid>.<assinatura>; Path=/; ..."
function cookieDaSessao(resposta) {
  const cookies = resposta.headers['set-cookie'] ?? [];
  return cookies.find((c) => c.startsWith(`${NOME_COOKIE}=`));
}

function sidDoCookie(cookie) {
  const valor = decodeURIComponent(cookie.split(';')[0].split('=')[1]); // "s:<sid>.<assinatura>"
  return valor.slice(2, valor.lastIndexOf('.'));
}

async function linhaDaSessao(sid) {
  const [linha] = await prisma.$queryRaw`SELECT sess, expire FROM "session" WHERE sid = ${sid}`;
  return linha;
}

async function logar(agente = request.agent(app), credenciais = { email: ATIVA.email, senha: SENHA }) {
  const resposta = await agente.post('/auth/login').send(credenciais);
  return { agente, resposta };
}

beforeAll(async () => {
  const senhaHash = await bcrypt.hash(SENHA, 4);
  ativa = await prisma.usuario.create({ data: { ...ATIVA, senhaHash } });
  inativa = await prisma.usuario.create({ data: { ...INATIVA, senhaHash, ativo: false } });
});

afterAll(async () => {
  const ids = [ativa.id, inativa.id];
  await prisma.$executeRaw`DELETE FROM "session" WHERE (sess -> 'usuario' ->> 'id')::int = ANY(${ids})`;
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  sessionStore.close();
});

describe('POST /auth/login', () => {
  test('credenciais certas: 200, só dados públicos e cookie HttpOnly + SameSite=Strict', async () => {
    const { resposta } = await logar();

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ id: ativa.id, nome: ATIVA.nome, email: ATIVA.email, papel: 'PSICOLOGO' });

    const cookie = cookieDaSessao(resposta);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).not.toMatch(/Secure/i); // em teste/dev não há HTTPS
  });

  test('e-mail é normalizado (espaços e maiúsculas)', async () => {
    const { resposta } = await logar(undefined, { email: '  AUTH.Ativa@Exemplo.TEST ', senha: SENHA });
    expect(resposta.status).toBe(200);
  });

  test('senha errada, e-mail inexistente e conta inativa: mesmo 401, mesma mensagem, sem cookie', async () => {
    const tentativas = [
      { email: ATIVA.email, senha: 'senha-errada' },
      { email: 'ninguem@exemplo.test', senha: SENHA },
      { email: INATIVA.email, senha: SENHA },
    ];

    const respostas = await Promise.all(tentativas.map((c) => request(app).post('/auth/login').send(c)));

    for (const r of respostas) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ erro: 'E-mail ou senha inválidos' });
      expect(cookieDaSessao(r)).toBeUndefined();
    }
  });

  test.each([
    ['sem corpo', undefined],
    ['sem senha', { email: ATIVA.email }],
    ['e-mail malformado', { email: 'nao-e-email', senha: SENHA }],
    ['senha acima de 72 bytes', { email: ATIVA.email, senha: 'x'.repeat(73) }],
  ])('corpo inválido (%s): 400', async (_caso, corpo) => {
    const resposta = await request(app).post('/auth/login').send(corpo);
    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: 'Dados inválidos' });
  });

  test('cada login gera um ID de sessão novo e o antigo deixa de valer (anti session fixation)', async () => {
    const { agente, resposta: primeiro } = await logar();
    const { resposta: segundo } = await logar(agente);

    const cookieAntigo = cookieDaSessao(primeiro);
    expect(sidDoCookie(cookieAntigo)).not.toBe(sidDoCookie(cookieDaSessao(segundo)));

    const comCookieAntigo = await request(app).get('/auth/me').set('Cookie', cookieAntigo.split(';')[0]);
    expect(comCookieAntigo.status).toBe(401);
  });
});

describe('GET /auth/me', () => {
  test('sem sessão: 401', async () => {
    const resposta = await request(app).get('/auth/me');
    expect(resposta.status).toBe(401);
  });

  test('com sessão: 200 com o usuário logado', async () => {
    const { agente } = await logar();
    const resposta = await agente.get('/auth/me');

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ id: ativa.id, nome: ATIVA.nome, email: ATIVA.email, papel: 'PSICOLOGO' });
  });

  test('desativar a conta derruba a sessão já aberta na próxima requisição', async () => {
    const { agente } = await logar();
    await prisma.usuario.update({ where: { id: ativa.id }, data: { ativo: false } });

    try {
      const resposta = await agente.get('/auth/me');
      expect(resposta.status).toBe(401);
    } finally {
      await prisma.usuario.update({ where: { id: ativa.id }, data: { ativo: true } });
    }
  });

  test('inatividade: sessão expira 60 min após a última requisição, e cada requisição renova o prazo (rolling)', async () => {
    const { agente, resposta } = await logar();
    const sid = sidDoCookie(cookieDaSessao(resposta));

    // O connect-pg-simple grava o expire em segundos inteiros, arredondando
    // para cima — daí a folga de 1 s no limite superior.
    const prazoAposLogin = (await linhaDaSessao(sid)).expire.getTime() - Date.now();
    expect(prazoAposLogin).toBeGreaterThan(INATIVIDADE_MS - 60_000);
    expect(prazoAposLogin).toBeLessThanOrEqual(INATIVIDADE_MS + 1000);

    // Simula que a sessão está a 5 min de expirar; uma requisição deve renovar.
    await prisma.$executeRaw`UPDATE "session" SET expire = now() + interval '5 minutes' WHERE sid = ${sid}`;
    expect((await agente.get('/auth/me')).status).toBe(200);

    const prazoAposRequisicao = (await linhaDaSessao(sid)).expire.getTime() - Date.now();
    expect(prazoAposRequisicao).toBeGreaterThan(INATIVIDADE_MS - 60_000);
  });

  test('teto absoluto: sessão com mais de 12 h desde o login é encerrada, mesmo em uso', async () => {
    const { agente, resposta } = await logar();
    const sid = sidDoCookie(cookieDaSessao(resposta));

    // Volta o "relógio" do login para 12 h + 1 min atrás.
    const criadaEm = Date.now() - TETO_ABSOLUTO_MS - 60_000;
    await prisma.$executeRaw`
      UPDATE "session" SET sess = jsonb_set(sess::jsonb, '{criadaEm}', to_jsonb(${criadaEm}::bigint))
      WHERE sid = ${sid}`;

    const expirada = await agente.get('/auth/me');
    expect(expirada.status).toBe(401);
    expect(expirada.body).toEqual({ erro: 'Sessão expirada. Faça login novamente.' });
    expect(await linhaDaSessao(sid)).toBeUndefined();
  });
});

describe('POST /auth/logout', () => {
  test('encerra a sessão: 204, apaga a linha da tabela e o mesmo cookie passa a dar 401', async () => {
    const { agente, resposta } = await logar();
    const cookie = cookieDaSessao(resposta);
    const sid = sidDoCookie(cookie);

    const saida = await agente.post('/auth/logout');
    expect(saida.status).toBe(204);
    expect(cookieDaSessao(saida)).toMatch(/Expires=Thu, 01 Jan 1970/); // navegador apaga o cookie

    expect(await linhaDaSessao(sid)).toBeUndefined();
    const reaproveitando = await request(app).get('/auth/me').set('Cookie', cookie.split(';')[0]);
    expect(reaproveitando.status).toBe(401);
  });

  test('sem sessão: 204 mesmo assim (idempotente)', async () => {
    const resposta = await request(app).post('/auth/logout');
    expect(resposta.status).toBe(204);
  });
});
