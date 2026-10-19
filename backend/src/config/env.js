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
