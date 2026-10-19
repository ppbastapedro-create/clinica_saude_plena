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

async function existeEmail(email) {
  return (await prisma.usuario.count({ where: { email } })) > 0;
}

async function criar({ nome, email, senhaHash, papel }) {
  return prisma.usuario.create({
    data: { nome, email, senhaHash, papel },
    select: CAMPOS_PUBLICOS,
  });
}

module.exports = { buscarParaLogin, buscarPorId, existeEmail, criar };
