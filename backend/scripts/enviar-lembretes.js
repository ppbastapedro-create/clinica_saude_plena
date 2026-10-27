// Envia os lembretes de sessão pendentes (pacote 1.4.8):
//   npm run lembretes:enviar
// Em produção quem roda é o workflow .github/workflows/lembretes.yml, de hora
// em hora. Localmente, sem SMTP_HOST no .env, nada sai de verdade: o script
// mostra quantos lembretes TERIAM saído (modo simulação).
//
// O log só mostra ids de agendamento e códigos de erro — nunca nome ou
// e-mail de paciente (o log do GitHub Actions fica visível no repositório).

const env = require('../src/config/env');
const prisma = require('../src/config/prisma');
const { smtpConfigurado } = require('../src/config/email');
const lembretesService = require('../src/services/lembretes.service');

async function main() {
  // Em produção, rodar sem SMTP seria marcar sessões como "lembrete enviado"
  // sem que e-mail nenhum tenha saído. Melhor falhar alto.
  if (env.NODE_ENV === 'production' && !smtpConfigurado) {
    throw new Error('NODE_ENV=production sem SMTP_HOST: configure o SMTP antes de enviar lembretes.');
  }
  if (!smtpConfigurado) console.log('Modo simulação (sem SMTP_HOST): nenhum e-mail sai de verdade.');

  const { enviados, ignorados, falhas } = await lembretesService.enviarPendentes();

  console.log(`Antecedência: ${env.LEMBRETE_ANTECEDENCIA_HORAS} h`);
  console.log(`Enviados: ${enviados.length}${enviados.length ? ` (agendamentos ${enviados.join(', ')})` : ''}`);
  if (ignorados.length) console.log(`Enviados, mas a sessão mudou durante o envio: ${ignorados.join(', ')}`);
  for (const { id, motivo } of falhas) console.error(`Falha no agendamento ${id}: ${motivo}`);

  // Código de saída 1 com falha: o GitHub Actions marca a execução em
  // vermelho (e avisa por e-mail o dono do repositório).
  if (falhas.length) process.exitCode = 1;
}

main()
  .catch((erro) => {
    console.error(`Erro: ${erro.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
