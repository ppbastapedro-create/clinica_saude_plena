const agendamentosRepository = require('../repositories/agendamentos.repository');
const recebimentosRepository = require('../repositories/recebimentos.repository');
const { paraResposta } = require('./agendamentos.service');
const { recebimentoParaResposta } = require('./financeiro.service');
const { paraReais, somar } = require('../utils/dinheiro');

// Relatório mensal (pacote 1.4.7): sessões do mês por status, quanto foi
// atendido (cobrável) e quanto foi recebido.
//
// "Recebido no mês" = CAIXA: recebimentos com DATA DE RECEBIMENTO no mês, como
// a parceira anota no caderno (um pacote pago em 30/09 conta em setembro,
// mesmo cobrindo sessões de outubro). "Atendido no mês" = sessões cobráveis
// que ACONTECERAM no mês. Os dois não precisam bater — a diferença é o que
// ficou a receber ou foi pago adiantado. O "a receber" de verdade é o saldo
// de cada paciente (financeiro.service.saldos), que não depende do mês.
// Critério de "recebido" pendente de confirmação com a parceira.

const totalizar = (valores) => ({ total: paraReais(somar(valores)), quantidade: valores.length });

// Mês "AAAA-MM" no fuso da parceira. O env.js define process.env.TZ, então
// new Date(ano, mes, 1) já é meia-noite em Brasília, mesmo com o servidor em UTC.
function limitesDoMes(mes) {
  const [ano, numero] = mes.split('-').map(Number);
  return { inicio: new Date(ano, numero - 1, 1), fim: new Date(ano, numero, 1) };
}

async function mensal(psicologoId, mes, agora = new Date()) {
  const { inicio, fim } = limitesDoMes(mes);
  const [sessoesBrutas, recebimentosBrutos] = await Promise.all([
    agendamentosRepository.listarQueComecamEntre(psicologoId, inicio, fim),
    recebimentosRepository.listarPorPeriodo(psicologoId, inicio, fim),
  ]);
  const sessoes = sessoesBrutas.map(paraResposta);
  const recebimentos = recebimentosBrutos.map(recebimentoParaResposta);
  const comStatus = (status) => sessoes.filter((s) => s.status === status);
  const cobraveis = sessoes.filter((s) => s.cobravel);
  const agendadas = comStatus('AGENDADO');

  return {
    mes,
    sessoes: {
      marcadas: sessoes.filter((s) => s.status !== 'CANCELADO').length,
      realizadas: comStatus('REALIZADO').length,
      faltas: comStatus('FALTA').length,
      canceladas: comStatus('CANCELADO').length,
      agendadas: agendadas.length,
      // Já começaram e continuam AGENDADO: falta marcar realizada/falta.
      aFechar: agendadas.filter((s) => new Date(s.inicio) <= agora).length,
    },
    financeiro: {
      recebido: totalizar(recebimentos.map((r) => r.valor)),
      atendido: totalizar(cobraveis.filter((s) => s.valor !== null).map((s) => s.valor)),
      // Realizadas que a psicóloga marcou para não cobrar.
      naoCobradas: comStatus('REALIZADO').filter((s) => !s.cobravel).length,
      faltasCobradas: comStatus('FALTA').filter((s) => s.cobravel).length,
      semValor: cobraveis.filter((s) => s.valor === null).length,
    },
    recebimentos,
    sessoesDoMes: sessoes,
  };
}

module.exports = { mensal, limitesDoMes };
