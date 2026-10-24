const prisma = require('../config/prisma');

// Campos que saem na API. psicologoId fica de fora: é sempre a usuária
// logada, não acrescenta nada à resposta.
const CAMPOS = {
  id: true,
  nome: true,
  cpf: true,
  email: true,
  telefone: true,
  arquivadoEm: true,
  criadoEm: true,
};

// Toda consulta leva psicologoId no where. É isso que impede uma psicóloga
// de ver ou alterar paciente de outra, mesmo sabendo o id: para ela, o
// paciente simplesmente não existe.

async function listar(psicologoId, { busca, situacao }) {
  const where = { psicologoId };
  if (situacao === 'ativos') where.arquivadoEm = null;
  if (situacao === 'arquivados') where.arquivadoEm = { not: null };

  if (busca) {
    const digitos = busca.replace(/\D/g, '');
    where.OR = [
      { nome: { contains: busca, mode: 'insensitive' } },
      // Só busca por CPF com 3+ dígitos: "1" casaria com quase todo mundo.
      ...(digitos.length >= 3 ? [{ cpf: { startsWith: digitos } }] : []),
    ];
  }

  return prisma.paciente.findMany({ where, select: CAMPOS, orderBy: { nome: 'asc' } });
}

async function buscarPorId(psicologoId, id) {
  return prisma.paciente.findFirst({ where: { id, psicologoId }, select: CAMPOS });
}

async function buscarPorCpf(psicologoId, cpf) {
  return prisma.paciente.findUnique({ where: { psicologoId_cpf: { psicologoId, cpf } }, select: CAMPOS });
}

async function criar(psicologoId, dados) {
  return prisma.paciente.create({ data: { ...dados, psicologoId }, select: CAMPOS });
}

// `where: { id, psicologoId }` num único UPDATE: se o paciente não for desta
// psicóloga, nada é alterado e o Prisma lança P2025 (registro não encontrado).
// Não há janela entre "conferir o dono" e "alterar".
async function atualizar(psicologoId, id, dados) {
  return prisma.paciente.update({ where: { id, psicologoId }, data: dados, select: CAMPOS });
}

// Arquiva só se não houver sessão AGENDADO futura (inicio > agora). Conferir
// e arquivar acontecem na mesma transação, com a linha do paciente travada
// (FOR UPDATE): uma marcação simultânea (que trava a mesma linha com FOR
// SHARE — ver agendamentos.repository) espera esta terminar e então vê o
// paciente já arquivado. Devolve o resultado para o service decidir a
// resposta:
//   { situacao: 'nao_encontrado' }
//   { situacao: 'ja_arquivado', paciente }
//   { situacao: 'sessoes_futuras', sessoes: [{ id, inicio, fim }] }
//   { situacao: 'arquivado', paciente }
async function arquivarSeSemSessoesFuturas(psicologoId, id, agora) {
  return prisma.$transaction(async (tx) => {
    const [linha] = await tx.$queryRaw`
      SELECT "arquivadoEm" FROM "Paciente"
      WHERE id = ${id} AND "psicologoId" = ${psicologoId}
      FOR UPDATE`;
    if (!linha) return { situacao: 'nao_encontrado' };

    // Já arquivado: idempotente, mantém a data original.
    if (linha.arquivadoEm !== null) {
      return { situacao: 'ja_arquivado', paciente: await tx.paciente.findUnique({ where: { id }, select: CAMPOS }) };
    }

    const sessoes = await tx.agendamento.findMany({
      where: { pacienteId: id, psicologoId, status: 'AGENDADO', inicio: { gt: agora } },
      select: { id: true, inicio: true, fim: true },
      orderBy: { inicio: 'asc' },
    });
    if (sessoes.length > 0) return { situacao: 'sessoes_futuras', sessoes };

    const paciente = await tx.paciente.update({ where: { id }, data: { arquivadoEm: agora }, select: CAMPOS });
    return { situacao: 'arquivado', paciente };
  });
}

module.exports = { listar, buscarPorId, buscarPorCpf, criar, atualizar, arquivarSeSemSessoesFuturas };
