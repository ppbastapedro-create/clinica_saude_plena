const prisma = require('../config/prisma');

const CAMPOS = {
  id: true,
  valor: true,
  recebidoEm: true,
  formaPagamento: true,
  sessoes: true,
  estornadoEm: true,
  criadoEm: true,
  paciente: { select: { id: true, nome: true } },
};

// Toda consulta leva psicologoId no where (isolamento entre psicólogas), e a
// FK composta (pacienteId, psicologoId) impede no banco um recebimento
// apontando para paciente de outra.

async function criar(psicologoId, pacienteId, dados) {
  return prisma.recebimento.create({ data: { psicologoId, pacienteId, ...dados }, select: CAMPOS });
}

// Do mais recente para o mais antigo, incluindo os estornados (histórico).
async function listarDoPaciente(psicologoId, pacienteId) {
  return prisma.recebimento.findMany({
    where: { psicologoId, pacienteId },
    select: CAMPOS,
    orderBy: [{ recebidoEm: 'desc' }, { id: 'desc' }],
  });
}

// Recebimentos (não estornados) com data em [inicio, fim) — o "recebido no mês".
async function listarPorPeriodo(psicologoId, inicio, fim) {
  return prisma.recebimento.findMany({
    where: { psicologoId, estornadoEm: null, recebidoEm: { gte: inicio, lt: fim } },
    select: CAMPOS,
    orderBy: [{ recebidoEm: 'asc' }, { id: 'asc' }],
  });
}

// Total recebido por paciente (sem os estornados), somado pelo próprio banco
// — Decimal exato, sem passar por float.
async function somarPorPaciente(psicologoId) {
  return prisma.recebimento.groupBy({
    by: ['pacienteId'],
    where: { psicologoId, estornadoEm: null },
    _sum: { valor: true },
  });
}

// Estorna só se ainda não estiver estornado (condição no where: dois
// estornos simultâneos não gravam duas datas). Devolve o recebimento como
// ficou, ou null se não existe / é de outra psicóloga.
async function estornar(psicologoId, id, agora) {
  await prisma.recebimento.updateMany({ where: { id, psicologoId, estornadoEm: null }, data: { estornadoEm: agora } });
  return prisma.recebimento.findFirst({ where: { id, psicologoId }, select: CAMPOS });
}

module.exports = { criar, listarDoPaciente, listarPorPeriodo, somarPorPaciente, estornar };
