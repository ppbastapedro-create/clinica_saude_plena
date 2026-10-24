const prisma = require('../config/prisma');

// Registro de sessão: só o conteúdo CIFRADO passa por aqui. Cifrar e
// decifrar é com o service (utils/cripto.js); este arquivo nunca vê texto puro.
//
// Toda leitura/escrita que entrega ou grava conteúdo registra a auditoria
// (LogAcesso) NA MESMA TRANSAÇÃO: se o log não puder ser gravado, a operação
// inteira falha — nenhum acesso ao prontuário fica sem rastro.

const CAMPOS = {
  agendamentoId: true,
  conteudoCifrado: true,
  iv: true,
  authTag: true,
  versaoChave: true,
  criadoEm: true,
  atualizadoEm: true,
};

async function existe(agendamentoId) {
  return (await prisma.registroSessao.count({ where: { agendamentoId } })) > 0;
}

// Lê e registra LEITURA_SESSAO. Devolve null (sem registrar nada) se a sessão
// ainda não tem registro.
async function lerComAuditoria(agendamentoId, usuarioId) {
  return prisma.$transaction(async (tx) => {
    const registro = await tx.registroSessao.findUnique({ where: { agendamentoId }, select: CAMPOS });
    if (!registro) return null;
    await tx.logAcesso.create({ data: { acao: 'LEITURA_SESSAO', usuarioId, agendamentoId } });
    return registro;
  });
}

// Cria ou substitui o conteúdo cifrado e registra ESCRITA_SESSAO.
async function salvarComAuditoria(agendamentoId, usuarioId, cifrado) {
  return prisma.$transaction(async (tx) => {
    const registro = await tx.registroSessao.upsert({
      where: { agendamentoId },
      create: { agendamentoId, ...cifrado },
      update: cifrado,
      select: CAMPOS,
    });
    await tx.logAcesso.create({ data: { acao: 'ESCRITA_SESSAO', usuarioId, agendamentoId } });
    return registro;
  });
}

module.exports = { existe, lerComAuditoria, salvarComAuditoria };
