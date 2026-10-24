const agendamentosRepository = require('../repositories/agendamentos.repository');
const pacientesRepository = require('../repositories/pacientes.repository');
const { ErroHttp } = require('../utils/erros');
const { formatarDiaHora, formatarHora } = require('../utils/datas');

// Teto de duração de uma sessão. Não é regra clínica: é uma trava contra
// erro de digitação (ex.: fim no dia seguinte), que bloquearia a agenda
// inteira por engano. PENDENTE de confirmar com a parceira.
const DURACAO_MAXIMA_MS = 4 * 60 * 60 * 1000;

// A única transição permitida é a partir de AGENDADO (ver CLAUDE.md).
const STATUS_FINAIS = ['REALIZADO', 'FALTA', 'CANCELADO'];

// 404 também para sessão de outra psicóloga: não confirma que o id existe.
const naoEncontrado = () => new ErroHttp(404, 'Agendamento não encontrado');

// Formato de saída: o paciente vem só com id e nome; do registro de evolução,
// só se ele existe.
function paraResposta(ag) {
  return {
    id: ag.id,
    inicio: ag.inicio,
    fim: ag.fim,
    status: ag.status,
    paciente: ag.paciente,
    temRegistro: Boolean(ag.registroSessao),
    criadoEm: ag.criadoEm,
  };
}

function validarIntervalo({ inicio, fim }) {
  if (fim <= inicio) throw new ErroHttp(422, 'O fim da sessão deve ser depois do início.');
  if (fim - inicio > DURACAO_MAXIMA_MS) {
    throw new ErroHttp(422, `A sessão não pode passar de ${DURACAO_MAXIMA_MS / 3_600_000} horas.`);
  }
}

// Checagem amigável: diz COM QUEM é o conflito. Não é a única proteção — duas
// requisições simultâneas podem passar juntas por aqui; quem barra a segunda
// é a exclusion constraint do banco (tratada no errorHandler, também 409).
async function garantirHorarioLivre(psicologoId, intervalo, excetoId) {
  const conflito = await agendamentosRepository.buscarConflito(psicologoId, intervalo, excetoId);
  if (!conflito) return;
  throw new ErroHttp(
    409,
    `Horário ocupado: sessão de ${conflito.paciente.nome} em ` +
      `${formatarDiaHora(conflito.inicio)}–${formatarHora(conflito.fim)}.`,
    { conflito: paraResposta(conflito) },
  );
}

async function buscarEntidade(psicologoId, id) {
  const ag = await agendamentosRepository.buscarPorId(psicologoId, id);
  if (!ag) throw naoEncontrado();
  return ag;
}

async function listar(psicologoId, filtros) {
  return (await agendamentosRepository.listarPorPeriodo(psicologoId, filtros)).map(paraResposta);
}

async function buscar(psicologoId, id) {
  return paraResposta(await buscarEntidade(psicologoId, id));
}

// Paciente de outra psicóloga (ou inexistente): 404, como no resto da API.
async function listarDoPaciente(psicologoId, pacienteId) {
  const paciente = await pacientesRepository.buscarPorId(psicologoId, pacienteId);
  if (!paciente) throw new ErroHttp(404, 'Paciente não encontrado');
  return (await agendamentosRepository.listarPorPaciente(psicologoId, pacienteId)).map(paraResposta);
}

// Sessões no passado são aceitas de propósito: permite lançar no sistema os
// atendimentos que hoje estão na agenda de papel.
async function criar(psicologoId, { pacienteId, inicio, fim }) {
  validarIntervalo({ inicio, fim });

  const paciente = await pacientesRepository.buscarPorId(psicologoId, pacienteId);
  if (!paciente) throw new ErroHttp(404, 'Paciente não encontrado');
  if (paciente.arquivadoEm) {
    throw new ErroHttp(422, 'Paciente arquivado. Reative o cadastro antes de agendar.');
  }

  await garantirHorarioLivre(psicologoId, { inicio, fim });

  // A conferência de "arquivado" acima é a amigável; esta é a garantida: o
  // repositório trava o paciente e confere de novo antes de inserir (o
  // arquivamento pode ter acontecido nesse meio-tempo).
  const criado = await agendamentosRepository.criarParaPacienteAtivo({ psicologoId, pacienteId, inicio, fim });
  if (!criado) throw new ErroHttp(422, 'Paciente arquivado. Reative o cadastro antes de agendar.');
  return paraResposta(criado);
}

function erroDeTransicao(atual, desejado) {
  return new ErroHttp(422, `Não é possível ${desejado} uma sessão com status ${atual}. Só sessões AGENDADO podem mudar.`);
}

const PACIENTE_ARQUIVADO_REMARCAR =
  'Paciente arquivado: a sessão não pode ser remarcada. Ela ainda pode ser marcada como realizada, falta ou cancelada.';

// Paciente arquivado: remarcar bloqueado (422) — senão uma sessão passada
// pendente viraria sessão futura de paciente arquivado, contornando a regra
// do arquivamento. Fechar a sessão (alterarStatus) continua permitido.
async function remarcar(psicologoId, id, intervalo) {
  const ag = await buscarEntidade(psicologoId, id);
  if (ag.status !== 'AGENDADO') throw erroDeTransicao(ag.status, 'remarcar');

  // Conferência amigável (antes da de conflito). A garantida é a do
  // repositório, com o paciente travado.
  const paciente = await pacientesRepository.buscarPorId(psicologoId, ag.paciente.id);
  if (paciente?.arquivadoEm) throw new ErroHttp(422, PACIENTE_ARQUIVADO_REMARCAR);

  validarIntervalo(intervalo);
  await garantirHorarioLivre(psicologoId, intervalo, id);

  const resultado = await agendamentosRepository.remarcar(psicologoId, id, intervalo);
  if (resultado === 'paciente_arquivado') throw new ErroHttp(422, PACIENTE_ARQUIVADO_REMARCAR);
  if (resultado === 'status_mudou') {
    // O status mudou entre a leitura acima e o update.
    const atual = await buscarEntidade(psicologoId, id);
    throw erroDeTransicao(atual.status, 'remarcar');
  }
  return buscar(psicologoId, id);
}

const VERBO = { REALIZADO: 'marcar como realizada', FALTA: 'registrar falta em', CANCELADO: 'cancelar' };

async function alterarStatus(psicologoId, id, status) {
  const ag = await buscarEntidade(psicologoId, id);

  if (!STATUS_FINAIS.includes(status)) {
    throw new ErroHttp(422, `Não é possível voltar uma sessão para ${status}.`);
  }
  if (ag.status !== 'AGENDADO') throw erroDeTransicao(ag.status, VERBO[status]);

  // Realizada ou falta só depois que a sessão começou. Cancelar pode a
  // qualquer momento.
  if (status !== 'CANCELADO' && ag.inicio > new Date()) {
    throw new ErroHttp(422, 'A sessão ainda não começou: só é possível cancelá-la ou remarcá-la.');
  }

  if ((await agendamentosRepository.alterarStatus(psicologoId, id, status)) === 0) {
    const atual = await buscarEntidade(psicologoId, id);
    throw erroDeTransicao(atual.status, VERBO[status]);
  }
  return buscar(psicologoId, id);
}

module.exports = { listar, listarDoPaciente, buscar, criar, remarcar, alterarStatus, DURACAO_MAXIMA_MS };
