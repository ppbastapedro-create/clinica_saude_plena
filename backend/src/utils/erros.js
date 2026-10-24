// Erro "esperado", que o service lança para o errorHandler transformar em
// resposta HTTP: status + mensagem pensada para o cliente (diferente de um
// erro inesperado, cuja mensagem nunca sai do servidor). `extras` entra no
// corpo da resposta — ex.: { campos: {...} } na validação.
class ErroHttp extends Error {
  constructor(status, mensagem, extras = {}) {
    super(mensagem);
    this.name = 'ErroHttp';
    this.status = status;
    this.extras = extras;
  }
}

module.exports = { ErroHttp };
