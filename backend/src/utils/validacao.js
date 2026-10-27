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

// Data/hora sempre com fuso (ex.: 2026-11-10T14:00:00-03:00 ou ...Z). Sem
// fuso, "14:00" seria interpretado no fuso de quem lê — o servidor no Render
// roda em UTC, e a sessão cairia 3 horas fora do lugar.
const dataHora = z
  .iso.datetime({ offset: true, error: 'Use data/hora ISO 8601 com fuso, ex.: 2026-11-10T14:00:00-03:00' })
  .transform((texto) => new Date(texto));

// Valor em reais, como texto ou número: "200", "180.5", "180,50". Até 8
// dígitos e 2 casas — o limite da coluna Decimal(10, 2). Sai como texto com 2
// casas ("180.50"): o Prisma grava texto em Decimal sem passar por float.
// Número com "sujeira" de ponto flutuante (0.1 + 0.2) é recusado de propósito.
const valorSchema = z
  .union([z.number(), z.string().trim()], 'Informe o valor')
  .transform((v) => String(v).replace(',', '.'))
  .refine((v) => /^\d{1,8}(\.\d{1,2})?$/.test(v), 'Valor inválido: use até 2 casas decimais, ex.: 200 ou 180,50')
  .transform((v) => Number(v).toFixed(2));

module.exports = { validar, idSchema, dataHora, valorSchema };
