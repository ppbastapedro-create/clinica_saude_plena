const { z } = require('zod');
const authService = require('../services/auth.service');
const { encerrarSessao } = require('../config/session');
const { MAX_BYTES_SENHA } = require('../utils/senha');

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  senha: z
    .string()
    .min(1)
    .refine((s) => Buffer.byteLength(s, 'utf8') <= MAX_BYTES_SENHA),
});

const CREDENCIAIS_INVALIDAS = { erro: 'E-mail ou senha inválidos' };

// express-session usa callbacks; estas versões em Promise deixam o fluxo
// linear com await.
const regenerar = (req) => new Promise((ok, falha) => req.session.regenerate((e) => (e ? falha(e) : ok())));
const salvar = (req) => new Promise((ok, falha) => req.session.save((e) => (e ? falha(e) : ok())));

async function login(req, res) {
  const dados = loginSchema.safeParse(req.body);
  if (!dados.success) return res.status(400).json({ erro: 'Dados inválidos' });

  const usuario = await authService.autenticar(dados.data);
  if (!usuario) return res.status(401).json(CREDENCIAIS_INVALIDAS);

  // Novo ID de sessão a cada login: um ID plantado no navegador antes do
  // login (ataque de "session fixation") não vira uma sessão autenticada.
  await regenerar(req);
  req.session.usuario = { id: usuario.id };
  req.session.criadaEm = Date.now();
  await salvar(req);

  return res.json(usuario);
}

// Idempotente: sem sessão, só confirma (204) e manda apagar o cookie.
async function logout(req, res) {
  await encerrarSessao(req, res);
  return res.status(204).end();
}

function me(req, res) {
  return res.json(req.usuario);
}

module.exports = { login, logout, me };
