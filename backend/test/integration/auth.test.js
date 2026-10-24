const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { sessionStore, NOME_COOKIE, INATIVIDADE_MS, TETO_ABSOLUTO_MS } = require('../../src/config/session');
const { storeLimiteLogin } = require('../../src/middlewares/limiteTaxa');
const { MAX_TENTATIVAS, BLOQUEIO_MS } = require('../../src/services/auth.service');
const { emailUnico } = require('../helpers/emailUnico');

// Dados fictícios. Custo 4 no bcrypt só para o teste ser rápido — o
// compare funciona com qualquer custo.
const SENHA = 'senha-correta-de-teste';
const ATIVA = { nome: 'Psicóloga Auth (fictícia)', email: emailUnico('auth.ativa') };
const INATIVA = { nome: 'Psicóloga Inativa (fictícia)', email: emailUnico('auth.inativa') };
// Conta separada para os testes de bloqueio: errar a senha dela de propósito
// não interfere nos testes que usam a ATIVA.
const BLOQ = { nome: 'Psicóloga Bloqueio (fictícia)', email: emailUnico('auth.bloqueio') };
const CREDENCIAIS_INVALIDAS = { erro: 'E-mail ou senha inválidos' };

let ativa;
let inativa;
let bloq;
let idLogInicial; // maior id de LogAcesso antes deste arquivo rodar

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

async function ultimoIdLog() {
  const log = await prisma.logAcesso.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  return log?.id ?? 0;
}

// Logs gravados depois de `desdeId`, em ordem, só com os campos que importam.
async function logsDesde(desdeId, where = {}) {
  return prisma.logAcesso.findMany({
    where: { id: { gt: desdeId }, ...where },
    orderBy: { id: 'asc' },
    select: { acao: true, usuarioId: true },
  });
}

async function errarSenha(email, vezes) {
  for (let i = 0; i < vezes; i++) {
    const r = await request(app).post('/auth/login').send({ email, senha: 'senha-errada' });
    expect(r.status).toBe(401);
  }
}

beforeAll(async () => {
  idLogInicial = await ultimoIdLog();
  const senhaHash = await bcrypt.hash(SENHA, 4);
  ativa = await prisma.usuario.create({ data: { ...ATIVA, senhaHash } });
  inativa = await prisma.usuario.create({ data: { ...INATIVA, senhaHash, ativo: false } });
  bloq = await prisma.usuario.create({ data: { ...BLOQ, senhaHash } });
});

// O limite por IP é global ao app e todos os testes vêm do mesmo IP: sem
// zerar a contagem, as falhas de um teste estourariam o limite no seguinte.
beforeEach(async () => {
  await storeLimiteLogin.resetAll();
});

afterAll(async () => {
  const ids = [ativa.id, inativa.id, bloq.id];
  await prisma.$executeRaw`DELETE FROM "session" WHERE (sess -> 'usuario' ->> 'id')::int = ANY(${ids})`;
  // Logs antes dos usuários: a FK de LogAcesso é RESTRICT.
  //
  // SUPOSIÇÃO: este é o ÚNICO arquivo de teste que gera log sem usuário
  // (LOGIN_FALHO de e-mail inexistente). Log sem usuário não tem nada que o
  // ligue a quem o criou, então o filtro abaixo apaga TODOS os logs sem
  // usuário criados depois que este arquivo começou — inclusive os de outros
  // arquivos que estejam rodando em paralelo.
  // Se outro arquivo passar a fazer login com e-mail inexistente (ou a gerar
  // log sem usuário de outro jeito), este afterAll pode apagar os logs dele
  // no meio do teste, e uma asserção sobre esses logs lá falharia de forma
  // intermitente (depende da ordem de execução). Nesse caso, trocar este
  // filtro por ids coletados pelo próprio arquivo.
  await prisma.logAcesso.deleteMany({
    where: { OR: [{ usuarioId: { in: ids } }, { usuarioId: null, id: { gt: idLogInicial } }] },
  });
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
    const { resposta } = await logar(undefined, { email: `  ${ATIVA.email.toUpperCase()} `, senha: SENHA });
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
      expect(r.body).toEqual(CREDENCIAIS_INVALIDAS);
      expect(cookieDaSessao(r)).toBeUndefined();
    }
  });

  test('JSON malformado: 400 em JSON, sem detalhes do erro', async () => {
    const resposta = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "auth.ativa@exemplo.test", ');

    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({ erro: 'JSON inválido' });
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

describe('bloqueio da conta por senhas erradas', () => {
  beforeEach(async () => {
    await prisma.usuario.update({ where: { id: bloq.id }, data: { tentativasFalhas: 0, bloqueadoAte: null } });
  });

  const estadoBloq = () =>
    prisma.usuario.findUnique({ where: { id: bloq.id }, select: { tentativasFalhas: true, bloqueadoAte: true } });

  test(`${MAX_TENTATIVAS} senhas erradas seguidas bloqueiam por 15 min: nem a senha certa entra, e a resposta não denuncia o bloqueio`, async () => {
    await errarSenha(BLOQ.email, MAX_TENTATIVAS);

    const { bloqueadoAte } = await estadoBloq();
    const prazo = bloqueadoAte.getTime() - Date.now();
    expect(prazo).toBeGreaterThan(BLOQUEIO_MS - 60_000);
    expect(prazo).toBeLessThanOrEqual(BLOQUEIO_MS);

    const { resposta } = await logar(undefined, { email: BLOQ.email, senha: SENHA });
    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual(CREDENCIAIS_INVALIDAS);
    expect(cookieDaSessao(resposta)).toBeUndefined();
  });

  test('uma falha a menos que o limite não bloqueia', async () => {
    await errarSenha(BLOQ.email, MAX_TENTATIVAS - 1);

    expect(await estadoBloq()).toEqual({ tentativasFalhas: MAX_TENTATIVAS - 1, bloqueadoAte: null });
    const { resposta } = await logar(undefined, { email: BLOQ.email, senha: SENHA });
    expect(resposta.status).toBe(200);
  });

  test('tentativas durante o bloqueio não o prolongam', async () => {
    await errarSenha(BLOQ.email, MAX_TENTATIVAS);
    const antes = await estadoBloq();

    await errarSenha(BLOQ.email, 3);

    expect(await estadoBloq()).toEqual(antes);
  });

  test('bloqueio vencido: a senha certa volta a entrar e o estado é limpo', async () => {
    await prisma.usuario.update({ where: { id: bloq.id }, data: { bloqueadoAte: new Date(Date.now() - 1000) } });

    const { resposta } = await logar(undefined, { email: BLOQ.email, senha: SENHA });

    expect(resposta.status).toBe(200);
    expect(await estadoBloq()).toEqual({ tentativasFalhas: 0, bloqueadoAte: null });
  });

  test('login certo zera as falhas acumuladas (o limite é de falhas SEGUIDAS)', async () => {
    await errarSenha(BLOQ.email, MAX_TENTATIVAS - 1);
    expect((await logar(undefined, { email: BLOQ.email, senha: SENHA })).resposta.status).toBe(200);

    await errarSenha(BLOQ.email, MAX_TENTATIVAS - 1);

    expect(await estadoBloq()).toEqual({ tentativasFalhas: MAX_TENTATIVAS - 1, bloqueadoAte: null });
  });
});

describe('limite de tentativas por IP', () => {
  beforeEach(async () => {
    await prisma.usuario.update({ where: { id: bloq.id }, data: { tentativasFalhas: 0, bloqueadoAte: null } });
  });

  // As falhas usam a conta BLOQ (ela bloqueia no caminho, mas segue
  // respondendo 401 — o que importa aqui é a contagem por IP).
  test('11ª falha do mesmo IP em 15 min: 429 com mensagem em JSON', async () => {
    await errarSenha(BLOQ.email, 10);

    const resposta = await request(app).post('/auth/login').send({ email: BLOQ.email, senha: 'senha-errada' });
    expect(resposta.status).toBe(429);
    expect(resposta.body).toEqual({ erro: 'Muitas tentativas de login. Tente novamente em alguns minutos.' });
    expect(resposta.headers.ratelimit).toBeDefined();
  });

  test('logins certos não contam para o limite', async () => {
    await errarSenha(BLOQ.email, 9);
    for (let i = 0; i < 3; i++) expect((await logar()).resposta.status).toBe(200);

    // 10ª falha: ainda dentro do limite.
    await errarSenha(BLOQ.email, 1);
  });
});

describe('auditoria (LogAcesso)', () => {
  test('login certo e logout registram LOGIN e LOGOUT com o usuário', async () => {
    const desde = await ultimoIdLog();

    const { agente } = await logar();
    await agente.post('/auth/logout');

    expect(await logsDesde(desde, { usuarioId: ativa.id })).toEqual([
      { acao: 'LOGIN', usuarioId: ativa.id },
      { acao: 'LOGOUT', usuarioId: ativa.id },
    ]);
  });

  test('senha errada e conta inativa registram LOGIN_FALHO com o usuário', async () => {
    const desde = await ultimoIdLog();

    await request(app).post('/auth/login').send({ email: ATIVA.email, senha: 'senha-errada' });
    await request(app).post('/auth/login').send({ email: INATIVA.email, senha: SENHA });

    expect(await logsDesde(desde, { usuarioId: { in: [ativa.id, inativa.id] } })).toEqual([
      { acao: 'LOGIN_FALHO', usuarioId: ativa.id },
      { acao: 'LOGIN_FALHO', usuarioId: inativa.id },
    ]);

    // Volta o contador da ATIVA a zero com um login certo.
    await logar();
  });

  // Os outros arquivos de teste rodam em paralelo (outro processo) e também
  // fazem login. Por isso estes dois testes olham só os logs das usuárias
  // deste arquivo e os sem usuário (e-mail inexistente), que só este arquivo
  // gera — senão um LOGIN de outro arquivo entraria no meio.
  const logsDesteArquivo = (desde) =>
    logsDesde(desde, { OR: [{ usuarioId: null }, { usuarioId: { in: [ativa.id, inativa.id, bloq.id] } }] });

  test('e-mail inexistente registra LOGIN_FALHO sem usuário', async () => {
    const desde = await ultimoIdLog();

    await request(app).post('/auth/login').send({ email: 'ninguem@exemplo.test', senha: SENHA });

    expect(await logsDesteArquivo(desde)).toEqual([{ acao: 'LOGIN_FALHO', usuarioId: null }]);
  });

  test('logout sem sessão não registra nada', async () => {
    const desde = await ultimoIdLog();

    await request(app).post('/auth/logout');

    expect(await logsDesteArquivo(desde)).toEqual([]);
  });
});
