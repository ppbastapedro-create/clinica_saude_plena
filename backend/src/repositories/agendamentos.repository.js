const prisma = require('../config/prisma');

// Junto com o agendamento vem só id e nome do paciente — o suficiente para a
// agenda, sem CPF nem contato. Do registro de evolução vem só o id, para a
// tela saber se ele existe SEM lê-lo (ler grava LEITURA_SESSAO no log de
// acesso; o conteúdo cifrado nem sai do banco nesta consulta).
const COM_PACIENTE = {
  paciente: { select: { id: true, nome: true } },
  registroSessao: { select: { id: true } },
};

// Status que ocupam horário. CANCELADO libera o horário (a exclusion
// constraint do banco usa a mesma regra: WHERE status <> 'CANCELADO').
const OCUPA_HORARIO = { not: 'CANCELADO' };

// Dois intervalos [a, b) e [c, d) se sobrepõem quando a < d e c < b. Sessões
// encostadas (14h–15h e 15h–16h) NÃO se sobrepõem — igual ao tstzrange do
// Postgres, que por padrão inclui o início e exclui o fim.
const sobrepoe = ({ inicio, fim }) => ({ inicio: { lt: fim }, fim: { gt: inicio } });

async function listarPorPeriodo(psicologoId, { inicio, fim, incluirCancelados }) {
  return prisma.agendamento.findMany({
    where: {
      psicologoId,
      ...sobrepoe({ inicio, fim }), // inclui sessão que começa antes e termina dentro do período
      ...(incluirCancelados ? {} : { status: OCUPA_HORARIO }),
    },
    include: COM_PACIENTE,
    orderBy: { inicio: 'asc' },
  });
}

async function buscarPorId(psicologoId, id) {
  return prisma.agendamento.findFirst({ where: { id, psicologoId }, include: COM_PACIENTE });
}

// Histórico completo de um paciente (ficha), mais recente primeiro, com as
// canceladas. Sem limite de período: é um paciente só (uma sessão por semana
// durante os 5 anos de guarda dá ~260 linhas).
async function listarPorPaciente(psicologoId, pacienteId) {
  return prisma.agendamento.findMany({
    where: { psicologoId, pacienteId },
    include: COM_PACIENTE,
    orderBy: { inicio: 'desc' },
  });
}

// Primeira sessão da psicóloga que ocupa parte do intervalo. `excetoId`: ao
// remarcar, a própria sessão não conta como conflito.
async function buscarConflito(psicologoId, intervalo, excetoId) {
  return prisma.agendamento.findFirst({
    where: {
      psicologoId,
      status: OCUPA_HORARIO,
      ...sobrepoe(intervalo),
      ...(excetoId ? { id: { not: excetoId } } : {}),
    },
    include: COM_PACIENTE,
    orderBy: { inicio: 'asc' },
  });
}

async function criar({ psicologoId, pacienteId, inicio, fim }) {
  return prisma.agendamento.create({
    data: { psicologoId, pacienteId, inicio, fim },
    include: COM_PACIENTE,
  });
}

// Cria só se o paciente (desta psicóloga) existir e NÃO estiver arquivado,
// conferindo dentro da transação com a linha do paciente travada. FOR SHARE:
// várias marcações do mesmo paciente seguem em paralelo entre si, mas
// esperam um arquivamento em andamento (que usa FOR UPDATE — ver
// pacientes.repository). Sem a trava, uma marcação poderia entrar entre a
// conferência e o arquivamento. Devolve null se o paciente não puder receber
// agendamento.
async function criarParaPacienteAtivo({ psicologoId, pacienteId, inicio, fim }) {
  return prisma.$transaction(async (tx) => {
    const [paciente] = await tx.$queryRaw`
      SELECT "arquivadoEm" FROM "Paciente"
      WHERE id = ${pacienteId} AND "psicologoId" = ${psicologoId}
      FOR SHARE`;
    if (!paciente || paciente.arquivadoEm !== null) return null;

    return tx.agendamento.create({ data: { psicologoId, pacienteId, inicio, fim }, include: COM_PACIENTE });
  });
}

// As duas alterações abaixo só acontecem se a sessão ainda estiver AGENDADO
// NO MOMENTO DO UPDATE (o status está no where). Se duas requisições
// chegarem juntas — ex.: cancelar e marcar falta —, só a primeira altera; a
// segunda encontra 0 linhas. Devolvem quantas linhas mudaram (0 ou 1).

// Remarcar zera lembreteEnviadoEm: o lembrete enviado era do horário antigo,
// o novo horário precisa de lembrete próprio (pacote 1.4.8).
//
// Mesma trava da marcação (FOR SHARE na linha do paciente, conferindo
// arquivadoEm dentro da transação): sem ela, arquivar e remarcar simultâneos
// passariam juntos e deixariam paciente arquivado com sessão futura.
// Devolve 'remarcado' | 'paciente_arquivado' | 'status_mudou' (0 linhas: a
// sessão não está mais AGENDADO, ou não é desta psicóloga).
async function remarcar(psicologoId, id, { inicio, fim }) {
  return prisma.$transaction(async (tx) => {
    const [paciente] = await tx.$queryRaw`
      SELECT p."arquivadoEm" FROM "Paciente" p
      JOIN "Agendamento" a ON a."pacienteId" = p.id
      WHERE a.id = ${id} AND a."psicologoId" = ${psicologoId}
      FOR SHARE OF p`;
    if (paciente && paciente.arquivadoEm !== null) return 'paciente_arquivado';

    const { count } = await tx.agendamento.updateMany({
      where: { id, psicologoId, status: 'AGENDADO' },
      data: { inicio, fim, lembreteEnviadoEm: null },
    });
    return count === 1 ? 'remarcado' : 'status_mudou';
  });
}

async function alterarStatus(psicologoId, id, status) {
  const { count } = await prisma.agendamento.updateMany({
    where: { id, psicologoId, status: 'AGENDADO' },
    data: { status },
  });
  return count;
}

module.exports = {
  listarPorPeriodo,
  listarPorPaciente,
  buscarPorId,
  buscarConflito,
  criar,
  criarParaPacienteAtivo,
  remarcar,
  alterarStatus,
};
