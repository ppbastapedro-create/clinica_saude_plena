const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });
const { z } = require('zod');

// Linha "SMTP_HOST=" no .env chega como "": vale como não informado. O mesmo
// com secret/variável não cadastrado no GitHub Actions. Sem isso, "" viraria
// 0 num campo numérico em vez de cair no padrão.
const vazio = (v) => (v === '' ? undefined : v);
const opcional = (schema) => z.preprocess(vazio, schema.optional());
const comPadrao = (schema, padrao) => z.preprocess(vazio, schema.default(padrao));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    TZ: z.string().default('America/Sao_Paulo'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),

    // Lembretes por e-mail (pacote 1.4.8). Sem SMTP_HOST, nenhum e-mail sai de
    // verdade: o Nodemailer só monta a mensagem (ver config/email.js).
    SMTP_HOST: opcional(z.string()),
    SMTP_PORT: comPadrao(z.coerce.number().int().positive(), 587),
    SMTP_USER: opcional(z.string()),
    SMTP_PASS: opcional(z.string()),
    // Quem aparece como remetente, ex.: "Consultório <lembretes@dominio.com.br>".
    // No Brevo, o endereço precisa estar verificado.
    EMAIL_REMETENTE: opcional(z.string()),
    // Para onde vai a resposta do paciente (opcional).
    EMAIL_RESPONDER_PARA: opcional(z.email('EMAIL_RESPONDER_PARA deve ser um e-mail')),
    // Quantas horas antes da sessão o lembrete sai. PENDENTE de confirmar com a
    // parceira (o mockup sugere 24 h).
    LEMBRETE_ANTECEDENCIA_HORAS: comPadrao(z.coerce.number().int().min(1).max(168), 24),
  })
  .superRefine((e, ctx) => {
    if (!e.SMTP_HOST) return;
    for (const nome of ['SMTP_USER', 'SMTP_PASS', 'EMAIL_REMETENTE']) {
      if (!e[nome]) ctx.addIssue({ code: 'custom', path: [nome], message: `${nome} é obrigatório quando SMTP_HOST está definido` });
    }
  });

const resultado = schema.safeParse(process.env);

if (!resultado.success) {
  console.error('Variáveis de ambiente inválidas:', z.flattenError(resultado.error).fieldErrors);
  process.exit(1);
}

const env = resultado.data;

// Relatórios, lembretes e a agenda calculam limites de dia/mês no fuso da
// parceira — isso garante isso mesmo que o host (ex.: Render) rode em UTC.
process.env.TZ = env.TZ;

// Segredos que só a API usa. Ficam fora do schema acima porque o job de
// lembretes (GitHub Actions) também carrega este arquivo e NÃO deve receber a
// chave do prontuário nem o segredo da sessão — menor privilégio: cada
// processo recebe só o segredo de que precisa. Quem usa chama exigirSegredo()
// ao ser carregado, então a API continua falhando já na subida se faltar algum.
const SEGREDOS = {
  // Assina o cookie de sessão: quem souber o segredo consegue forjar cookies
  // válidos. 32 bytes aleatórios em hex = 64 caracteres.
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET precisa de pelo menos 32 caracteres'),
  // Chave AES-256 dos registros de sessão: 32 bytes aleatórios em hex = 64
  // caracteres. PERDER esta chave = perder todos os registros cifrados com
  // ela (o backup do banco não basta — guarde a chave à parte, com cuidado).
  REGISTRO_CHAVE_V1: z
    .string('REGISTRO_CHAVE_V1 é obrigatório')
    .regex(/^[0-9a-fA-F]{64}$/, 'REGISTRO_CHAVE_V1 deve ter 64 caracteres hexadecimais (32 bytes)'),
};

function exigirSegredo(nome) {
  const r = SEGREDOS[nome].safeParse(process.env[nome]);
  if (!r.success) {
    console.error(`Variável de ambiente inválida: ${nome}:`, r.error.issues.map((i) => i.message));
    process.exit(1);
  }
  return r.data;
}

module.exports = { ...env, exigirSegredo };
