const prisma = require('../config/prisma');

// Campos que podem sair do backend. senhaHash nunca entra aqui.
const CAMPOS_PUBLICOS = { id: true, nome: true, email: true, papel: true, ativo: true };

// Único lugar que lê senhaHash — usado só pela autenticação.
async function buscarParaLogin(email) {
  return prisma.usuario.findUnique({ where: { email } });
}

async function buscarPorId(id) {
  return prisma.usuario.findUnique({ where: { id }, select: CAMPOS_PUBLICOS });
}

async function buscarPorEmail(email) {
  return prisma.usuario.findUnique({ where: { email }, select: CAMPOS_PUBLICOS });
}

async function existeEmail(email) {
  return (await prisma.usuario.count({ where: { email } })) > 0;
}

async function criar({ nome, email, senhaHash, papel }) {
  return prisma.usuario.create({
    data: { nome, email, senhaHash, papel },
    select: CAMPOS_PUBLICOS,
  });
}

// Soma 1 às falhas de login e devolve o novo total. O `increment` vira um
// único UPDATE ... SET x = x + 1 no banco: duas tentativas simultâneas não
// leem o mesmo valor e contam uma falha só (o que um ler-somar-gravar em JS
// permitiria).
async function incrementarFalhasLogin(id) {
  const { tentativasFalhas } = await prisma.usuario.update({
    where: { id },
    data: { tentativasFalhas: { increment: 1 } },
    select: { tentativasFalhas: true },
  });
  return tentativasFalhas;
}

// Bloqueia até `ate` e zera o contador: vencido o bloqueio, a conta volta a
// ter o número cheio de tentativas.
async function bloquearLogin(id, ate) {
  await prisma.usuario.update({ where: { id }, data: { tentativasFalhas: 0, bloqueadoAte: ate } });
}

async function zerarFalhasLogin(id) {
  await prisma.usuario.update({ where: { id }, data: { tentativasFalhas: 0, bloqueadoAte: null } });
}

// Troca a senha, desfaz o bloqueio e encerra todas as sessões abertas da
// conta — numa transação: ou acontece tudo, ou nada. Encerrar as sessões
// importa quando a troca é porque a senha vazou: quem entrou com a senha
// antiga não pode continuar logado.
async function redefinirSenha(id, senhaHash) {
  await prisma.$transaction([
    prisma.usuario.update({ where: { id }, data: { senhaHash, tentativasFalhas: 0, bloqueadoAte: null } }),
    prisma.$executeRaw`DELETE FROM "session" WHERE (sess -> 'usuario' ->> 'id')::int = ${id}`,
  ]);
}

module.exports = {
  buscarParaLogin,
  buscarPorId,
  buscarPorEmail,
  existeEmail,
  redefinirSenha,
  criar,
  incrementarFalhasLogin,
  bloquearLogin,
  zerarFalhasLogin,
};
