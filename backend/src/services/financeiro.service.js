const agendamentosRepository = require('../repositories/agendamentos.repository');
const pacientesRepository = require('../repositories/pacientes.repository');
const recebimentosRepository = require('../repositories/recebimentos.repository');
const { paraResposta: sessaoParaResposta } = require('./agendamentos.service');
const { ErroHttp } = require('../utils/erros');
const { formatarValor, centavos, paraReais, somar } = require('../utils/dinheiro');

// Conta corrente do paciente (pacote 1.4.7, refeito em 2026-10-25).
//
//   DÉBITO  = cada sessão cobrável (ver agendamentos.service.ehCobravel)
//   CRÉDITO = cada recebimento não estornado
//   SALDO   = créditos − débitos
//
// Saldo negativo = a receber. Saldo positivo = crédito: um pacote pago
// adiantado e ainda não usado. O crédito não vence (regra a confirmar com a
// parceira) — se o paciente pagou 4 e fez 3, a sessão que sobrou fica como
// crédito para o mês seguinte.
//
// Sessão cobrável SEM valor definido não entra nos totais; ela é contada à
// parte (sessoesSemValor) para a psicóloga completar.

const naoEncontrado = () => new ErroHttp(404, 'Paciente não encontrado');

function recebimentoParaResposta(r) {
  return {
    id: r.id,
    paciente: r.paciente,
    valor: formatarValor(r.valor),
    recebidoEm: r.recebidoEm,
    formaPagamento: r.formaPagamento,
    sessoes: r.sessoes,
    estornadoEm: r.estornadoEm,
    criadoEm: r.criadoEm,
  };
}

async function registrarRecebimento(psicologoId, pacienteId, dados) {
  // Paciente arquivado também recebe: pode quitar o que ficou devendo.
  const paciente = await pacientesRepository.buscarPorId(psicologoId, pacienteId);
  if (!paciente) throw naoEncontrado();
  return recebimentoParaResposta(await recebimentosRepository.criar(psicologoId, pacienteId, dados));
}

// Lançamento errado não é apagado (fica o rastro): é estornado. Idempotente —
// estornar de novo devolve o mesmo, com a data do primeiro estorno.
async function estornarRecebimento(psicologoId, id) {
  const recebimento = await recebimentosRepository.estornar(psicologoId, id, new Date());
  if (!recebimento) throw new ErroHttp(404, 'Recebimento não encontrado');
  return recebimentoParaResposta(recebimento);
}

// Extrato do paciente: débitos e créditos em ordem de data, com o saldo
// depois de cada lançamento (como um extrato de banco).
async function extrato(psicologoId, pacienteId) {
  const paciente = await pacientesRepository.buscarPorId(psicologoId, pacienteId);
  if (!paciente) throw naoEncontrado();

  const [sessoes, recebimentos] = await Promise.all([
    agendamentosRepository.listarPorPaciente(psicologoId, pacienteId),
    recebimentosRepository.listarDoPaciente(psicologoId, pacienteId),
  ]);
  const cobraveis = sessoes.map(sessaoParaResposta).filter((s) => s.cobravel);
  const comValor = cobraveis.filter((s) => s.valor !== null);
  const validos = recebimentos.filter((r) => !r.estornadoEm);

  const lancamentos = [
    ...comValor.map((s) => ({ tipo: 'SESSAO', data: s.inicio, valor: s.valor, sessao: { id: s.id, status: s.status } })),
    ...recebimentos.map((r) => ({ tipo: 'RECEBIMENTO', data: r.recebidoEm, valor: formatarValor(r.valor), recebimento: recebimentoParaResposta(r) })),
  ].sort((a, b) => new Date(a.data) - new Date(b.data));

  let saldo = 0;
  for (const l of lancamentos) {
    if (l.tipo === 'SESSAO') saldo -= centavos(l.valor);
    else if (!l.recebimento.estornadoEm) saldo += centavos(l.valor);
    l.saldoApos = paraReais(saldo);
  }

  const cobrado = somar(comValor.map((s) => s.valor));
  const recebido = somar(validos.map((r) => r.valor));
  return {
    paciente: { id: paciente.id, nome: paciente.nome, valorSessao: formatarValor(paciente.valorSessao), arquivadoEm: paciente.arquivadoEm },
    cobrado: paraReais(cobrado),
    recebido: paraReais(recebido),
    saldo: paraReais(recebido - cobrado),
    sessoesCobradas: comValor.length,
    sessoesSemValor: cobraveis.length - comValor.length,
    lancamentos: lancamentos.reverse(), // mais recente primeiro, para a tela
  };
}

// Painel de saldos: uma linha por paciente com movimento (ou ativo), com o
// total a receber e o total de créditos. Três consultas no total, não uma
// por paciente.
async function saldos(psicologoId) {
  const [pacientes, debitos, creditos] = await Promise.all([
    pacientesRepository.listar(psicologoId, { situacao: 'todos' }),
    agendamentosRepository.somarCobraveisPorPaciente(psicologoId),
    recebimentosRepository.somarPorPaciente(psicologoId),
  ]);
  const debitoDe = new Map(debitos.map((d) => [d.pacienteId, d]));
  const creditoDe = new Map(creditos.map((c) => [c.pacienteId, c]));

  const linhas = pacientes
    .map((p) => {
      const d = debitoDe.get(p.id);
      const cobrado = d?._sum.valor ? centavos(d._sum.valor) : 0;
      const recebido = creditoDe.get(p.id)?._sum.valor ? centavos(creditoDe.get(p.id)._sum.valor) : 0;
      return {
        paciente: { id: p.id, nome: p.nome, arquivadoEm: p.arquivadoEm },
        valorSessao: formatarValor(p.valorSessao),
        cobrado,
        recebido,
        saldo: recebido - cobrado,
        sessoesCobradas: d?._count.valor ?? 0,
        sessoesSemValor: d ? d._count._all - d._count.valor : 0,
      };
    })
    // Arquivado sem nada pendente não interessa ao painel.
    .filter((l) => !l.paciente.arquivadoEm || l.saldo !== 0 || l.sessoesSemValor > 0)
    .sort((a, b) => a.saldo - b.saldo || a.paciente.nome.localeCompare(b.paciente.nome, 'pt-BR'));

  const aReceber = linhas.filter((l) => l.saldo < 0);
  const comCredito = linhas.filter((l) => l.saldo > 0);
  return {
    totais: {
      aReceber: { total: paraReais(-aReceber.reduce((s, l) => s + l.saldo, 0)), pacientes: aReceber.length },
      creditos: { total: paraReais(comCredito.reduce((s, l) => s + l.saldo, 0)), pacientes: comCredito.length },
    },
    pacientes: linhas.map((l) => ({
      ...l,
      cobrado: paraReais(l.cobrado),
      recebido: paraReais(l.recebido),
      saldo: paraReais(l.saldo),
    })),
  };
}

module.exports = { registrarRecebimento, estornarRecebimento, extrato, saldos, recebimentoParaResposta };
