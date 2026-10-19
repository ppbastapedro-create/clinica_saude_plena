// Dados fictícios para desenvolvimento/teste manual. Nunca usar CPF, nome ou
// e-mail de pessoa real aqui.
//
// Idempotente: pode rodar quantas vezes quiser — usuária e pacientes via
// upsert (chave única), agendamentos só são criados se ainda não existirem.
const env = require('../src/config/env');

// Travas: nunca popular o banco de produção com dados de exemplo (e uma senha
// conhecida). Checadas antes de qualquer conexão com o banco.
if (env.NODE_ENV === 'production') {
  console.error('Seed abortado: NODE_ENV=production. O seed é só para desenvolvimento/teste.');
  process.exit(1);
}

// Segunda trava, independente do NODE_ENV (que pode faltar no servidor e cair
// no padrão "development"): só roda contra banco local — localhost/127.0.0.1
// (PC do autor, Docker Compose) ou "db" (serviço do devcontainer). Para
// qualquer outro host, é preciso pedir explicitamente com SEED_ALLOW=1.
const HOSTS_LOCAIS = ['localhost', '127.0.0.1', 'db'];
const host = new URL(env.DATABASE_URL).hostname;
if (!HOSTS_LOCAIS.includes(host) && process.env.SEED_ALLOW !== '1') {
  console.error(
    `Seed abortado: DATABASE_URL aponta para o host "${host}", que não é local. ` +
      'Se for intencional, rode com SEED_ALLOW=1.',
  );
  process.exit(1);
}

const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');

// Agendamento não tem chave única natural (o mesmo horário pode existir
// cancelado e ativo), então a idempotência é feita buscando antes de criar.
async function garantirAgendamento({ pagamento, ...dados }) {
  const existente = await prisma.agendamento.findFirst({
    where: {
      psicologoId: dados.psicologoId,
      pacienteId: dados.pacienteId,
      inicio: dados.inicio,
      status: dados.status,
    },
  });
  if (existente) return existente;

  return prisma.agendamento.create({
    data: { ...dados, ...(pagamento && { pagamento: { create: pagamento } }) },
  });
}

async function garantirPaciente(psicologoId, { cpf, ...dados }) {
  return prisma.paciente.upsert({
    where: { psicologoId_cpf: { psicologoId, cpf } },
    update: {},
    create: {
      psicologoId,
      cpf,
      ...dados,
      consentimentos: { create: { versaoTermo: 'v1' } },
    },
  });
}

async function main() {
  const psicologa = await prisma.usuario.upsert({
    where: { email: 'beatriz@exemplo.test' },
    update: {},
    create: {
      nome: 'Psicóloga Exemplo (fictícia)',
      email: 'beatriz@exemplo.test',
      senhaHash: bcrypt.hashSync('trocar-esta-senha', 10),
      papel: 'PSICOLOGO',
    },
  });

  const maria = await garantirPaciente(psicologa.id, {
    nome: 'Maria Silva (fictícia)',
    cpf: '11144477735',
    email: 'maria.silva@exemplo.test',
  });
  const joao = await garantirPaciente(psicologa.id, {
    nome: 'João Pereira (fictício)',
    cpf: '18056488707',
    email: 'joao.pereira@exemplo.test',
  });
  const ana = await garantirPaciente(psicologa.id, {
    nome: 'Ana Costa (fictícia)',
    cpf: '36798214096',
  });

  // Um agendamento de cada status, pra exercitar a agenda e os relatórios.
  const psicologoId = psicologa.id;
  await garantirAgendamento({
    psicologoId,
    pacienteId: maria.id,
    inicio: new Date('2026-11-10T14:00:00-03:00'),
    fim: new Date('2026-11-10T14:50:00-03:00'),
    status: 'AGENDADO',
  });
  await garantirAgendamento({
    psicologoId,
    pacienteId: joao.id,
    inicio: new Date('2026-10-10T09:00:00-03:00'),
    fim: new Date('2026-10-10T09:50:00-03:00'),
    status: 'REALIZADO',
    pagamento: {
      valor: 200,
      status: 'PAGO',
      formaPagamento: 'PIX',
      pagoEm: new Date('2026-10-10T10:00:00-03:00'),
    },
  });
  await garantirAgendamento({
    psicologoId,
    pacienteId: ana.id,
    inicio: new Date('2026-10-12T16:00:00-03:00'),
    fim: new Date('2026-10-12T16:50:00-03:00'),
    status: 'FALTA',
  });
  // Mesmo horário do anterior (16:00–16:50) — prova que um agendamento
  // CANCELADO não conflita com a exclusion constraint.
  await garantirAgendamento({
    psicologoId,
    pacienteId: maria.id,
    inicio: new Date('2026-10-12T16:00:00-03:00'),
    fim: new Date('2026-10-12T16:50:00-03:00'),
    status: 'CANCELADO',
  });

  console.log('Seed concluído:', {
    usuaria: psicologa.email,
    pacientes: [maria.nome, joao.nome, ana.nome],
    agendamentos: await prisma.agendamento.count({ where: { psicologoId } }),
  });
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
