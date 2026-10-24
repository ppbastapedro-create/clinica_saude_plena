const { z } = require('zod');
const { ErroHttp } = require('./erros');

// Mensagens padrão do Zod em português ("esperava um texto, recebeu um
// número"). Configuração global: vale para todo schema da aplicação. As
// mensagens não repetem o valor enviado — não vazam dados na resposta.
z.config(z.locales.pt());

// Valida `dados` com o schema e devolve os dados já limpos (trim, máscara
// removida etc.). Se inválido, lança 400 com a lista de erros por campo, para
// o frontend mostrar a mensagem ao lado do campo certo.
function validar(schema, dados) {
  const resultado = schema.safeParse(dados);
  if (!resultado.success) {
    throw new ErroHttp(400, 'Dados inválidos', { campos: z.flattenError(resultado.error).fieldErrors });
  }
  return resultado.data;
}

// Parâmetro :id da URL. O teto é o maior INTEGER do Postgres: um número maior
// faria o banco recusar a consulta (erro 500) em vez de responder 400.
const idSchema = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });

module.exports = { validar, idSchema };
