const nodemailer = require('nodemailer');
const env = require('./env');

// Com SMTP_HOST (produção: Brevo), envia de verdade. Sem ele (desenvolvimento
// e testes), usa o jsonTransport do Nodemailer: monta a mensagem inteira e a
// devolve como JSON, sem abrir conexão nenhuma — nenhum e-mail sai por
// engano para um paciente fictício (ou real).
const smtpConfigurado = Boolean(env.SMTP_HOST);

const transporte = smtpConfigurado
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // 465 = TLS desde o início; 587 = começa sem TLS e sobe com STARTTLS.
      // requireTLS: recusa enviar se o servidor não oferecer STARTTLS (o
      // e-mail leva nome do paciente e horário da sessão).
      secure: env.SMTP_PORT === 465,
      requireTLS: env.SMTP_PORT !== 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    })
  : nodemailer.createTransport({ jsonTransport: true });

const remetente = env.EMAIL_REMETENTE ?? 'Saúde Plena (desenvolvimento) <nao-responda@exemplo.test>';

module.exports = { transporte, remetente, smtpConfigurado };
