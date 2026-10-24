const prisma = require('../config/prisma');

// Trilha de auditoria: só inserção. Não há update nem delete aqui de
// propósito — registro de auditoria que pode ser alterado não prova nada.
async function registrar({ acao, usuarioId = null, agendamentoId = null }) {
  return prisma.logAcesso.create({ data: { acao, usuarioId, agendamentoId } });
}

module.exports = { registrar };
