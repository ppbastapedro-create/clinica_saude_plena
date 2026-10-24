const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  TZ: z.string().default('America/Sao_Paulo'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),
  // Assina o cookie de sessão: quem souber o segredo consegue forjar cookies
  // válidos. 32 bytes aleatórios em hex = 64 caracteres.
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET precisa de pelo menos 32 caracteres'),
  // Chave AES-256 dos registros de sessão: 32 bytes aleatórios em hex = 64
  // caracteres. PERDER esta chave = perder todos os registros cifrados com
  // ela (o backup do banco não basta — guarde a chave à parte, com cuidado).
  REGISTRO_CHAVE_V1: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'REGISTRO_CHAVE_V1 deve ter 64 caracteres hexadecimais (32 bytes)'),
});

const resultado = schema.safeParse(process.env);

if (!resultado.success) {
  console.error('Variáveis de ambiente inválidas:', resultado.error.flatten().fieldErrors);
  process.exit(1);
}

const env = resultado.data;

// Relatórios, lembretes e a agenda calculam limites de dia/mês no fuso da
// parceira — isso garante isso mesmo que o host (ex.: Render) rode em UTC.
process.env.TZ = env.TZ;

module.exports = env;
