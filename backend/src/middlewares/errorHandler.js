const { Prisma } = require('@prisma/client');
const env = require('../config/env');
const { ErroHttp } = require('../utils/erros');

// Violações de EXCLUDE e CHECK chegam do Prisma como
// PrismaClientUnknownRequestError SEM `code`: o código Postgres (23P01,
// 23514) só aparece dentro do texto. Identifica pelo NOME da constraint (não
// depende do idioma do servidor). A mensagem original nunca vai ao cliente:
// o `detail` do Postgres traz os valores da linha.
const CONSTRAINTS_CONHECIDAS = [
  // Última barreira contra sessões sobrepostas: pega o caso em que duas
  // requisições simultâneas passaram juntas pela checagem do service.
  { nome: 'Agendamento_sem_sobreposicao_excl', status: 409, erro: 'Horário ocupado por outra sessão.' },
  { nome: 'Agendamento_fim_maior_que_inicio_check', status: 422, erro: 'O fim da sessão deve ser depois do início.' },
];

function constraintConhecida(erro) {
  if (!(erro instanceof Prisma.PrismaClientUnknownRequestError)) return undefined;
  return CONSTRAINTS_CONHECIDAS.find((c) => erro.message.includes(c.nome));
}

// ── Log ──────────────────────────────────────────────────────────────
// O log do servidor (Render) também não pode ter dado de paciente. Por isso:
// - Erro do Prisma: NUNCA a mensagem. Ela traz o `detail` do Postgres (valores
//   da linha) ou, no PrismaClientValidationError, os argumentos da consulta.
// - Rota sem valores: o padrão ("/pacientes/:id"), não a URL real, que pode
//   ter id e ?busca=nome.
// - Stack só fora de produção, e só as linhas "at ...": a 1ª linha do stack
//   repete a mensagem do erro.
const ehErroDoPrisma = (erro) => /^PrismaClient/.test(erro?.constructor?.name ?? '');

// req.prefixoRota é marcado no app.js ao montar cada router (o req.baseUrl
// já foi desfeito pelo Express quando o erro chega aqui).
function rotaSemValores(req) {
  if (!req.route) return undefined; // erro antes de casar uma rota
  return `${req.prefixoRota ?? ''}${req.route.path}`;
}

function registrar(nivel, dados) {
  console[nivel](JSON.stringify({ ...dados, em: new Date().toISOString() }));
}

function registrarErroDesconhecido(erro, req) {
  registrar('error', {
    requestId: req.id,
    metodo: req.method,
    rota: rotaSemValores(req),
    tipo: erro?.constructor?.name,
    code: erro?.code,
    ...(ehErroDoPrisma(erro) ? {} : { mensagem: erro?.message }),
    ...(env.NODE_ENV === 'production'
      ? {}
      : { stack: String(erro?.stack ?? '').split('\n').filter((l) => l.trimStart().startsWith('at ')) }),
  });
}

// Tratamento central de erros. O Express 5 já encaminha para cá as exceções
// de funções async (não precisa de try/catch em cada controller).
//
// Regra principal: nunca devolver a mensagem nem o stack do erro ao cliente.
// Eles podem conter SQL, caminhos de arquivo e até dados de pacientes (o
// `detail` do Postgres traz os valores da linha). O que vai para o log do
// servidor também é filtrado (ver "Log" acima).
//
// Os 4 parâmetros são obrigatórios mesmo sem usar `next` (só no caso raro de
// headersSent): é pela quantidade de parâmetros que o Express reconhece um
// handler de erro.
function errorHandler(erro, req, res, next) {
  // Resposta já começou a ser enviada: não dá mais para trocar o status.
  // Delega ao handler padrão, que fecha a conexão.
  if (res.headersSent) return next(erro);

  // Erro esperado, lançado pelo service com mensagem pensada para o cliente.
  if (erro instanceof ErroHttp) {
    return res.status(erro.status).json({ erro: erro.message, ...erro.extras });
  }

  const constraint = constraintConhecida(erro);
  if (constraint) {
    // Esperado (ex.: duas marcações simultâneas no mesmo horário), mas raro o
    // bastante para valer o registro — só o nome da constraint.
    registrar('warn', { requestId: req.id, constraint: constraint.nome, status: constraint.status });
    return res.status(constraint.status).json({ erro: constraint.erro });
  }

  // Corpo com JSON malformado (lançado pelo express.json).
  if (erro.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON inválido' });
  }

  // Outros erros do cliente já marcados como seguros para expor (ex.: corpo
  // grande demais, 413). Mesmo assim, mensagem genérica.
  if (erro.expose && erro.status >= 400 && erro.status < 500) {
    return res.status(erro.status).json({ erro: 'Requisição inválida' });
  }

  registrarErroDesconhecido(erro, req);
  // Só `erro` e `requestId`: o id permite achar a linha do log correspondente.
  return res.status(500).json({ erro: 'Erro interno do servidor', requestId: req.id });
}

module.exports = errorHandler;
