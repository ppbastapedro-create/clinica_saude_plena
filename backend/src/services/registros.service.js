const agendamentosRepository = require('../repositories/agendamentos.repository');
const registrosRepository = require('../repositories/registros.repository');
const { cifrar, decifrar } = require('../utils/cripto');
const { ErroHttp } = require('../utils/erros');

// Registro de evolução por sessão (prontuário). Regras:
// - Só a psicóloga dona da sessão lê ou escreve (sessão de outra = 404, sem
//   confirmar que existe).
// - Só sessão REALIZADO recebe registro: não há o que evoluir numa sessão
//   que não aconteceu (AGENDADO, FALTA, CANCELADO).
// - O conteúdo é cifrado antes de sair daqui para o banco, e decifrado só na
//   hora de responder. Nunca é registrado em log.

async function buscarSessao(psicologoId, agendamentoId) {
  const sessao = await agendamentosRepository.buscarPorId(psicologoId, agendamentoId);
  if (!sessao) throw new ErroHttp(404, 'Agendamento não encontrado');
  return sessao;
}

function paraResposta(agendamentoId, registro, conteudo) {
  return { agendamentoId, conteudo, criadoEm: registro.criadoEm, atualizadoEm: registro.atualizadoEm };
}

async function ler(psicologoId, agendamentoId) {
  await buscarSessao(psicologoId, agendamentoId);

  // O log de leitura é gravado ANTES de decifrar (mesma transação da busca):
  // se a decifragem falhar, a tentativa de leitura fica registrada.
  const registro = await registrosRepository.lerComAuditoria(agendamentoId, psicologoId);
  if (!registro) throw new ErroHttp(404, 'Esta sessão ainda não tem registro.');

  // Falha aqui = conteúdo adulterado no banco, registro de outra sessão ou
  // chave errada. Vira 500 genérico no errorHandler (nada do conteúdo vaza).
  return paraResposta(agendamentoId, registro, decifrar(registro, agendamentoId));
}

// Cria ou substitui. Devolve { criado, registro } para o controller escolher
// entre 201 e 200.
async function salvar(psicologoId, agendamentoId, conteudo) {
  const sessao = await buscarSessao(psicologoId, agendamentoId);
  if (sessao.status !== 'REALIZADO') {
    throw new ErroHttp(
      422,
      `Só sessões realizadas recebem registro (esta está ${sessao.status}). Marque a sessão como REALIZADO antes.`,
    );
  }

  // REALIZADO é status final (nenhuma transição sai dele), então não há
  // corrida possível entre esta checagem e a gravação.
  const criado = !(await registrosRepository.existe(agendamentoId));
  const registro = await registrosRepository.salvarComAuditoria(agendamentoId, psicologoId, cifrar(conteudo, agendamentoId));
  return { criado, registro: paraResposta(agendamentoId, registro, conteudo) };
}

module.exports = { ler, salvar };
