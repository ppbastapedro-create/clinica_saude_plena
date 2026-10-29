const prisma = require('../config/prisma');

const CAMPOS = { id: true, versaoTermo: true, aceitoEm: true, revogadoEm: true };

// Consentimento não tem psicologoId: o dono é o do paciente. Por isso o
// service confere o paciente (com psicologoId) antes de listar, e as escritas
// abaixo travam a linha do paciente filtrando por psicologoId.

// Histórico do paciente, mais recente primeiro (aceites e revogações).
async function listarDoPaciente(pacienteId) {
  return prisma.consentimento.findMany({
    where: { pacienteId },
    select: CAMPOS,
    orderBy: [{ aceitoEm: 'desc' }, { id: 'desc' }],
  });
}

// Trava a linha do paciente (FOR UPDATE) até o fim da transação: dois
// registros simultâneos não criam dois consentimentos vigentes, e uma
// revogação não cruza com um registro no meio.
async function travarPaciente(tx, psicologoId, pacienteId) {
  const [linha] = await tx.$queryRaw`
    SELECT "arquivadoEm" FROM "Paciente"
    WHERE id = ${pacienteId} AND "psicologoId" = ${psicologoId}
    FOR UPDATE`;
  return linha;
}

const buscarVigente = (tx, pacienteId) =>
  tx.consentimento.findFirst({ where: { pacienteId, revogadoEm: null }, select: CAMPOS });

// Registra o aceite se não houver um vigente. Devolve a situação para o
// service decidir a resposta:
//   { situacao: 'nao_encontrado' } | { situacao: 'arquivado' }
//   { situacao: 'ja_vigente', consentimento } | { situacao: 'registrado', consentimento }
async function registrarSeSemVigente(psicologoId, pacienteId, { versaoTermo, aceitoEm }) {
  return prisma.$transaction(async (tx) => {
    const paciente = await travarPaciente(tx, psicologoId, pacienteId);
    if (!paciente) return { situacao: 'nao_encontrado' };
    if (paciente.arquivadoEm !== null) return { situacao: 'arquivado' };

    const vigente = await buscarVigente(tx, pacienteId);
    if (vigente) return { situacao: 'ja_vigente', consentimento: vigente };

    const consentimento = await tx.consentimento.create({ data: { pacienteId, versaoTermo, aceitoEm }, select: CAMPOS });
    return { situacao: 'registrado', consentimento };
  });
}

// Revoga o consentimento vigente e, na mesma transação, desliga o lembrete
// por e-mail do paciente: um aceite novo no futuro não religa os e-mails sem
// a psicóloga marcar de novo.
//   { situacao: 'nao_encontrado' } | { situacao: 'sem_vigente' }
//   { situacao: 'revogado', consentimento }
async function revogarVigente(psicologoId, pacienteId, agora) {
  return prisma.$transaction(async (tx) => {
    const paciente = await travarPaciente(tx, psicologoId, pacienteId);
    if (!paciente) return { situacao: 'nao_encontrado' };

    const vigente = await buscarVigente(tx, pacienteId);
    if (!vigente) return { situacao: 'sem_vigente' };

    const consentimento = await tx.consentimento.update({ where: { id: vigente.id }, data: { revogadoEm: agora }, select: CAMPOS });
    await tx.paciente.update({ where: { id: pacienteId }, data: { receberLembrete: false } });
    return { situacao: 'revogado', consentimento };
  });
}

module.exports = { listarDoPaciente, registrarSeSemVigente, revogarVigente };
