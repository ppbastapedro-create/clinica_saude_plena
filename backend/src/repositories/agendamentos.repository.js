const prisma = require('../config/prisma');

// Repositório mínimo pra exercitar a constraint de horário no banco (pacote
// 1.4.2). CRUD completo e checagem prévia amigável no service entram no
// pacote 1.4.5 (Agenda), junto com as rotas.
async function criar({ psicologoId, pacienteId, inicio, fim }) {
  return prisma.agendamento.create({
    data: { psicologoId, pacienteId, inicio, fim },
  });
}

module.exports = { criar };
