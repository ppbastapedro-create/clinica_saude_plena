const { rateLimit, MemoryStore } = require('express-rate-limit');

// Limite por IP no login: 10 tentativas que falharam a cada 15 min.
// Complementa o bloqueio por conta (auth.service): este pega quem testa uma
// senha comum em muitos e-mails diferentes (o bloqueio por conta não veria
// nada, cada conta leva uma falha só) e impede que alguém ocupe a CPU do
// servidor com bcrypt (~0,3 s por tentativa) mandando logins sem parar.
//
// `skipSuccessfulRequests`: login que dá certo não conta. A psicóloga
// entrando e saindo várias vezes no dia nunca esbarra no limite.
//
// O IP certo do cliente depende do `trust proxy` configurado no app.js — sem
// ele, atrás do proxy do Render, todo mundo teria o IP do proxy e um único
// atacante bloquearia o login de todos.
//
// Contagem em memória: serve para uma instância só do servidor (o caso do
// Render no plano atual). Com várias instâncias, cada uma contaria à parte.
const storeLimiteLogin = new MemoryStore();

const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8', // cabeçalho RateLimit com quanto falta para liberar
  legacyHeaders: false,
  store: storeLimiteLogin,
  message: { erro: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

module.exports = { limiteLogin, storeLimiteLogin };
