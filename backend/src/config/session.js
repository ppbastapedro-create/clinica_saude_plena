const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const env = require('./env');

const NOME_COOKIE = 'sp.sid';

// Prontuário é dado sensível: computador esquecido aberto no consultório não
// pode deixar a sessão viva por muito tempo.
// - Inatividade: 60 min sem requisição derruba a sessão. `rolling: true`
//   renova o prazo a cada requisição (cookie e linha da tabela `session`).
// - Teto absoluto: 12 h desde o login, mesmo com uso contínuo. O
//   express-session não tem isso nativo — é checado em exigirAutenticacao
//   usando `req.session.criadaEm`.
const INATIVIDADE_MS = 60 * 60 * 1000;
const TETO_ABSOLUTO_MS = 12 * 60 * 60 * 1000;

const opcoesCookie = {
  httpOnly: true, // JavaScript da página não lê o cookie (mitiga roubo por XSS)
  sameSite: 'strict', // navegador não envia o cookie em requisições vindas de outro site (CSRF)
  secure: env.NODE_ENV === 'production', // só HTTPS; em dev o localhost é HTTP
  path: '/',
};

// O connect-pg-simple usa o driver `pg` direto; o parâmetro ?schema= da URL é
// do Prisma e não significa nada para ele.
function urlParaPg(url) {
  const u = new URL(url);
  u.searchParams.delete('schema');
  return u.toString();
}

const sessionStore = new PgStore({
  conString: urlParaPg(env.DATABASE_URL),
  tableName: 'session',
  // A tabela é criada pela migração do Prisma (ver schema.prisma).
  createTableIfMissing: false,
  // Limpeza periódica de sessões expiradas (segundos). Desligada nos testes
  // para não deixar timer aberto segurando o Jest.
  pruneSessionInterval: env.NODE_ENV === 'test' ? false : 15 * 60,
});

const sessionMiddleware = session({
  name: NOME_COOKIE,
  secret: env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false, // só cria sessão (e cookie) no login
  rolling: true,
  cookie: { ...opcoesCookie, maxAge: INATIVIDADE_MS },
});

// Encerra a sessão no banco e manda o navegador apagar o cookie. Usado no
// logout e quando exigirAutenticacao invalida uma sessão.
function encerrarSessao(req, res) {
  return new Promise((resolve, reject) => {
    res.clearCookie(NOME_COOKIE, opcoesCookie);
    if (!req.session) return resolve();
    req.session.destroy((erro) => (erro ? reject(erro) : resolve()));
  });
}

module.exports = {
  sessionMiddleware,
  sessionStore,
  encerrarSessao,
  NOME_COOKIE,
  INATIVIDADE_MS,
  TETO_ABSOLUTO_MS,
};
