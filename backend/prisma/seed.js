// Dados fictícios para desenvolvimento/teste manual. Nunca usar CPF ou
// e-mail de paciente real aqui.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const usuaria = await prisma.usuario.upsert({
    where: { email: 'beatriz@exemplo.test' },
    update: {},
    create: {
      email: 'beatriz@exemplo.test',
      senhaHash: bcrypt.hashSync('trocar-esta-senha', 10),
    },
  });

  const maria = await prisma.paciente.upsert({
    where: { cpf: '11144477735' },
    update: {},
    create: {
      nome: 'Maria Silva (fictícia)',
      cpf: '11144477735',
      email: 'maria.silva@exemplo.test',
      consentimentos: { create: { versaoTermo: 'v1' } },
    },
  });

  const joao = await prisma.paciente.upsert({
    where: { cpf: '18056488707' },
    update: {},
    create: {
      nome: 'João Pereira (fictício)',
      cpf: '18056488707',
      email: 'joao.pereira@exemplo.test',
      consentimentos: { create: { versaoTermo: 'v1' } },
    },
  });

  const ana = await prisma.paciente.upsert({
    where: { cpf: '36798214096' },
    update: {},
    create: {
      nome: 'Ana Costa (fictícia)',
      cpf: '36798214096',
      consentimentos: { create: { versaoTermo: 'v1' } },
    },
  });

  // Um agendamento de cada status, pra exercitar a agenda e os relatórios.
  await prisma.agendamento.create({
    data: {
      pacienteId: maria.id,
      inicio: new Date('2026-11-10T14:00:00-03:00'),
      fim: new Date('2026-11-10T14:50:00-03:00'),
      status: 'AGENDADO',
    },
  });

  await prisma.agendamento.create({
    data: {
      pacienteId: joao.id,
      inicio: new Date('2026-10-10T09:00:00-03:00'),
      fim: new Date('2026-10-10T09:50:00-03:00'),
      status: 'REALIZADO',
      pagamento: {
        create: {
          valor: 200,
          status: 'PAGO',
          formaPagamento: 'PIX',
          pagoEm: new Date('2026-10-10T10:00:00-03:00'),
        },
      },
    },
  });

  await prisma.agendamento.create({
    data: {
      pacienteId: ana.id,
      inicio: new Date('2026-10-12T16:00:00-03:00'),
      fim: new Date('2026-10-12T16:50:00-03:00'),
      status: 'FALTA',
    },
  });

  // Mesmo horário de outro agendamento (16:00–16:50) — prova que um slot
  // CANCELADO não conflita com a exclusion constraint.
  await prisma.agendamento.create({
    data: {
      pacienteId: maria.id,
      inicio: new Date('2026-10-12T16:00:00-03:00'),
      fim: new Date('2026-10-12T16:50:00-03:00'),
      status: 'CANCELADO',
    },
  });

  console.log('Seed concluído:', {
    usuaria: usuaria.email,
    pacientes: [maria.nome, joao.nome, ana.nome],
  });
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
