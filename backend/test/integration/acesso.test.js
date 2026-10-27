const fs = require('fs');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../src/app');
const { emailUnico } = require('../helpers/emailUnico');
const prisma = require('../../src/config/prisma');
const { sessionStore } = require('../../src/config/session');

// Critério de sucesso da EAP: "nenhum acesso não autenticado aos registros de
// sessão". Em vez de uma lista escrita à mão, o teste LÊ todos os arquivos de
// src/routes e bate em cada rota sem login. Rota nova entra no teste sozinha:
// se alguém esquecer o exigirAutenticacao, o CI fica vermelho.
//
// Convenção usada: o arquivo `x.routes.js` é montado em `/x` (ver app.js).

const PASTA_ROTAS = path.join(__dirname, '..', '..', 'src', 'routes');

// As únicas rotas abertas de propósito: entrar e sair.
const PUBLICAS = new Set(['POST /auth/login', 'POST /auth/logout']);

function todasAsRotas() {
  const rotas = [];
  for (const arquivo of fs.readdirSync(PASTA_ROTAS).filter((a) => a.endsWith('.routes.js'))) {
    const prefixo = `/${arquivo.replace('.routes.js', '')}`;
    const router = require(path.join(PASTA_ROTAS, arquivo));
    for (const camada of router.stack) {
      if (!camada.route) continue; // middleware (router.use), não rota
      for (const metodo of Object.keys(camada.route.methods)) {
        // ":id" vira 1 — sem login, a resposta não pode depender do id.
        const caminho = `${prefixo}${camada.route.path === '/' ? '' : camada.route.path}`.replace(/:\w+/g, '1');
        rotas.push({ metodo: metodo.toUpperCase(), caminho, nome: `${metodo.toUpperCase()} ${prefixo}${camada.route.path}` });
      }
    }
  }
  return rotas;
}

const ROTAS = todasAsRotas();
const PROTEGIDAS = ROTAS.filter((r) => !PUBLICAS.has(r.nome.replace(/\/$/, '')));

// Conta ADMIN: entra no sistema, mas não vê dado clínico (sigilo
// profissional, CFP). Só as rotas de /auth ficam abertas para ela.
const SENHA = 'senha-de-teste-acesso';
const ADMIN = { nome: 'Administração (fictícia)', email: emailUnico('acesso.admin'), papel: 'ADMIN' };
let admin;
let agenteAdmin;

beforeAll(async () => {
  admin = await prisma.usuario.create({ data: { ...ADMIN, senhaHash: await bcrypt.hash(SENHA, 4) } });
  agenteAdmin = request.agent(app);
  expect((await agenteAdmin.post('/auth/login').send({ email: ADMIN.email, senha: SENHA })).status).toBe(200);
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "session" WHERE (sess -> 'usuario' ->> 'id')::int = ${admin.id}`;
  await prisma.logAcesso.deleteMany({ where: { usuarioId: admin.id } });
  await prisma.usuario.delete({ where: { id: admin.id } });
  await prisma.$disconnect();
  sessionStore.close();
});

test('a leitura das rotas encontrou as do prontuário (sanidade do próprio teste)', () => {
  const nomes = ROTAS.map((r) => r.nome);
  expect(nomes).toEqual(expect.arrayContaining(['GET /agendamentos/:id/registro', 'PUT /agendamentos/:id/registro']));
  expect(PROTEGIDAS.length).toBeGreaterThan(20);
});

describe.each([
  ['sem cookie', {}],
  // Cookie com formato válido mas assinatura falsa: o express-session ignora
  // e trata como "sem sessão".
  ['com cookie forjado', { Cookie: 'sp.sid=s%3Aforjado.assinaturafalsa' }],
])('%s', (_caso, cabecalhos) => {
  test.each(PROTEGIDAS.map((r) => [r.nome, r]))('%s → 401, sem dado nenhum na resposta', async (_nome, rota) => {
    const resposta = await request(app)[rota.metodo.toLowerCase()](rota.caminho).set(cabecalhos).send({});

    expect(resposta.status).toBe(401);
    expect(Object.keys(resposta.body)).toEqual(['erro']);
    expect(resposta.headers['cache-control']).toBe('no-store');
  });
});

describe('logada como ADMIN', () => {
  const CLINICAS = PROTEGIDAS.filter((r) => !r.caminho.startsWith('/auth'));

  test.each(CLINICAS.map((r) => [r.nome, r]))('%s → 403', async (_nome, rota) => {
    const resposta = await agenteAdmin[rota.metodo.toLowerCase()](rota.caminho).send({});

    expect(resposta.status).toBe(403);
    expect(resposta.body).toEqual({ erro: 'Acesso negado' });
  });

  test('GET /auth/me continua respondendo (o frontend precisa do papel para explicar a tela)', async () => {
    const resposta = await agenteAdmin.get('/auth/me');

    expect(resposta.status).toBe(200);
    expect(resposta.body.papel).toBe('ADMIN');
  });
});

describe('páginas e cabeçalhos', () => {
  test('a raiz abre o login', async () => {
    const resposta = await request(app).get('/');

    expect(resposta.status).toBe(302);
    expect(resposta.headers.location).toBe('/login.html');
  });

  test.each(['/index.html', '/agendamento.html', '/script.js'])('%s (frontend do Projeto 3, removido) não existe mais', async (url) => {
    expect((await request(app).get(url)).status).toBe(404);
  });

  test('CSP: só os próprios arquivos e o Google Fonts; sem iframe; sem estilo inline', async () => {
    const csp = (await request(app).get('/login.html')).headers['content-security-policy'];

    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' https://fonts.googleapis.com;");
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com;");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
  });

  test('Permissions-Policy desliga câmera, microfone e localização', async () => {
    const politica = (await request(app).get('/login.html')).headers['permissions-policy'];

    expect(politica).toContain('camera=()');
    expect(politica).toContain('microphone=()');
    expect(politica).toContain('geolocation=()');
  });
});

test('os arquivos de rotas estão mesmo montados no prefixo da convenção', async () => {
  // Se um router fosse montado em outro prefixo, as rotas acima dariam 404
  // (e não 401) — este teste aponta o problema com mais clareza.
  for (const prefixo of new Set(PROTEGIDAS.map((r) => r.caminho.split('/')[1]))) {
    const rota = PROTEGIDAS.find((r) => r.caminho.split('/')[1] === prefixo);
    const resposta = await request(app)[rota.metodo.toLowerCase()](rota.caminho);
    expect(resposta.status).not.toBe(404);
  }
});
