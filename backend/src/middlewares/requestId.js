const crypto = require('crypto');

// Dá a cada requisição um id aleatório, devolvido no cabeçalho X-Request-Id e
// no corpo dos erros 500. Liga a reclamação de um usuário ("deu erro às
// 14h") à linha certa do log do servidor, sem que o log precise conter dado
// de paciente.
//
// Sempre gerado aqui: um X-Request-Id enviado pelo cliente é ignorado, senão
// qualquer um poderia escrever o texto que quisesse no log.
function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = requestId;
