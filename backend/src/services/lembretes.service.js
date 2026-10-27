const agendamentosRepository = require('../repositories/agendamentos.repository');
const env = require('../config/env');
const email = require('../config/email');
const { formatarDiaSemanaData, formatarDiaHora, formatarHora } = require('../utils/datas');

// Lembrete de sessão por e-mail (pacote 1.4.8). Roda de hora em hora pelo
// GitHub Actions (scripts/enviar-lembretes.js), não dentro da API: no plano
// gratuito do Render o servidor dorme sem acesso e um agendador interno não
// dispararia.
//
// Cada rodada pega as sessões que começam nas próximas N horas
// (LEMBRETE_ANTECEDENCIA_HORAS, padrão 24 — PENDENTE de confirmar com a
// parceira) e ainda não têm lembrete. Rodando de hora em hora, cada sessão
// recebe o lembrete ~N horas antes; sessão marcada em cima da hora recebe na
// rodada seguinte.
//
// Ordem: envia e SÓ DEPOIS marca lembreteEnviadoEm. Se o envio falha, nada é
// marcado e a próxima rodada tenta de novo. O risco inverso (enviado e não
// marcado → e-mail repetido) fica restrito a uma queda do banco entre os dois
// passos; duas rodadas simultâneas são impedidas pelo `concurrency` do
// workflow.

const primeiroNome = (nome) => nome.trim().split(/\s+/)[0];

// Sigilo: assunto e texto não dizem "psicologia", "terapia" nem o nome da
// profissional — numa caixa de e-mail compartilhada, o lembrete não revela
// que a pessoa faz acompanhamento psicológico. Só texto puro: sem HTML, sem
// imagem, sem rastreamento de abertura.
function montarMensagem({ inicio, fim, paciente }) {
  const contato = env.EMAIL_RESPONDER_PARA
    ? 'Se não puder comparecer, avise com antecedência respondendo este e-mail.'
    : 'Se não puder comparecer, avise com antecedência pelo contato de costume.';
  return {
    from: email.remetente,
    to: paciente.email,
    ...(env.EMAIL_RESPONDER_PARA ? { replyTo: env.EMAIL_RESPONDER_PARA } : {}),
    subject: `Lembrete: atendimento em ${formatarDiaHora(inicio).replace(', ', ' às ')}`,
    text: [
      `Olá, ${primeiroNome(paciente.nome)}.`,
      '',
      'Este é um lembrete do seu atendimento:',
      `${formatarDiaSemanaData(inicio)}, das ${formatarHora(inicio)} às ${formatarHora(fim)}.`,
      '',
      contato,
      '',
      'Mensagem automática.',
    ].join('\n'),
  };
}

// O que pode ir para o log sobre uma falha. A mensagem do erro NÃO: a do
// servidor SMTP costuma repetir o endereço do destinatário ("<maria@...>:
// Recipient address rejected"), e o log do GitHub Actions é visível a quem
// acessa o repositório. Só os códigos.
const motivoSeguro = (erro) =>
  [erro.code, erro.responseCode && `SMTP ${erro.responseCode}`].filter(Boolean).join(' / ') || 'erro desconhecido';

// Devolve só ids (nada de nome ou e-mail), para o script registrar no log:
//   enviados  — e-mail saiu e a sessão foi marcada;
//   ignorados — e-mail saiu, mas a sessão mudou no meio (remarcada/cancelada)
//               e não foi marcada;
//   falhas    — e-mail não saiu (tenta de novo na próxima rodada).
async function enviarPendentes({
  agora = new Date(),
  antecedenciaHoras = env.LEMBRETE_ANTECEDENCIA_HORAS,
  transporte = email.transporte,
} = {}) {
  const ate = new Date(agora.getTime() + antecedenciaHoras * 3_600_000);
  const sessoes = await agendamentosRepository.listarParaLembrete(agora, ate);
  const resultado = { enviados: [], ignorados: [], falhas: [] };

  // Um por vez: são poucos por hora, e uma falha não derruba os outros.
  for (const sessao of sessoes) {
    try {
      await transporte.sendMail(montarMensagem(sessao));
    } catch (erro) {
      resultado.falhas.push({ id: sessao.id, motivo: motivoSeguro(erro) });
      continue;
    }
    const marcou = await agendamentosRepository.marcarLembreteEnviado(sessao.id, sessao.inicio, new Date());
    (marcou ? resultado.enviados : resultado.ignorados).push(sessao.id);
  }
  return resultado;
}

module.exports = { enviarPendentes, montarMensagem };
