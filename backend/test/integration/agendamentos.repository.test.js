const prisma = require('../../src/config/prisma');
const agendamentosRepository = require('../../src/repositories/agendamentos.repository');

// As violações de EXCLUDE, CHECK e RESTRICT chegam como
// PrismaClientUnknownRequestError, sem `code` — o código Postgres (23P01,
// 23514, 23001) só aparece dentro do texto. Por isso os testes conferem o
// NOME da constraint na mensagem: é o que prova que foi aquela regra que
// barrou o insert, e não depende do idioma do servidor (lc_messages).
const SOBREPOSICAO = /Agendamento_sem_sobreposicao_excl/;
const FIM_MAIOR_QUE_INICIO = /Agendamento_fim_maior_que_inicio_check/;
const FK_PACIENTE_PSICOLOGO = /Agendamento_pacienteId_psicologoId_fkey/;

// Horários sempre com fuso explícito (-03:00), pra não depender do TZ da máquina.
const h = (dataHora) => new Date(`${dataHora}:00-03:00`);

describe('AgendamentoRepository — constraints de agenda no banco', () => {
  let psicologa;
  let outraPsicologa;
  let paciente;
  let pacienteDaOutra;

  beforeAll(async () => {
    psicologa = await prisma.usuario.create({
      data: { nome: 'Psicóloga Teste (fictícia)', email: 'psicologa.teste@exemplo.test', senhaHash: 'x' },
    });
    outraPsicologa = await prisma.usuario.create({
      data: { nome: 'Outra Psicóloga Teste (fictícia)', email: 'outra.teste@exemplo.test', senhaHash: 'x' },
    });
    paciente = await prisma.paciente.create({
      data: { psicologoId: psicologa.id, nome: 'Paciente Teste (fictício)', cpf: '11144477735' },
    });
    pacienteDaOutra = await prisma.paciente.create({
      data: { psicologoId: outraPsicologa.id, nome: 'Paciente da Outra (fictício)', cpf: '18056488707' },
    });
  });

  afterEach(async () => {
    await prisma.agendamento.deleteMany({
      where: { psicologoId: { in: [psicologa.id, outraPsicologa.id] } },
    });
  });

  // Ordem importa: todas as FKs são ON DELETE RESTRICT, então apaga dos
  // filhos para os pais. (Apagar é aceitável só aqui, no banco de teste.)
  afterAll(async () => {
    await prisma.paciente.deleteMany({ where: { id: { in: [paciente.id, pacienteDaOutra.id] } } });
    await prisma.usuario.deleteMany({ where: { id: { in: [psicologa.id, outraPsicologa.id] } } });
    await prisma.$disconnect();
  });

  const agendar = (inicio, fim, dono = { psicologoId: psicologa.id, pacienteId: paciente.id }) =>
    agendamentosRepository.criar({ ...dono, inicio: h(inicio), fim: h(fim) });

  test('rejeita sobreposição de horários do mesmo psicólogo', async () => {
    await agendar('2026-12-01T14:00', '2026-12-01T15:00');

    await expect(agendar('2026-12-01T14:30', '2026-12-01T15:30')).rejects.toThrow(SOBREPOSICAO);
  });

  test('agendamento CANCELADO não bloqueia o horário', async () => {
    const original = await agendar('2026-12-02T10:00', '2026-12-02T11:00');
    await prisma.agendamento.update({ where: { id: original.id }, data: { status: 'CANCELADO' } });

    await expect(agendar('2026-12-02T10:00', '2026-12-02T11:00')).resolves.toMatchObject({
      pacienteId: paciente.id,
      status: 'AGENDADO',
    });
  });

  test('sessões encostadas (14h–15h e 15h–16h) são aceitas', async () => {
    await agendar('2026-12-03T14:00', '2026-12-03T15:00');

    await expect(agendar('2026-12-03T15:00', '2026-12-03T16:00')).resolves.toMatchObject({
      pacienteId: paciente.id,
    });
  });

  test('psicólogos diferentes podem ter o mesmo horário', async () => {
    await agendar('2026-12-04T14:00', '2026-12-04T15:00');

    await expect(
      agendar('2026-12-04T14:00', '2026-12-04T15:00', {
        psicologoId: outraPsicologa.id,
        pacienteId: pacienteDaOutra.id,
      }),
    ).resolves.toMatchObject({ psicologoId: outraPsicologa.id });
  });

  test('rejeita fim igual ao início', async () => {
    await expect(agendar('2026-12-05T14:00', '2026-12-05T14:00')).rejects.toThrow(FIM_MAIOR_QUE_INICIO);
  });

  test('rejeita fim antes do início', async () => {
    await expect(agendar('2026-12-05T15:00', '2026-12-05T14:00')).rejects.toThrow(FIM_MAIOR_QUE_INICIO);
  });

  test('rejeita agendar paciente de outro psicólogo (FK composta)', async () => {
    // Aqui o Prisma reconhece o erro (P2003), mas esconde o nome da constraint
    // ("constraint": null) — então a verificação é pelo código + modelo.
    await expect(
      agendar('2026-12-06T14:00', '2026-12-06T15:00', {
        psicologoId: outraPsicologa.id,
        pacienteId: paciente.id,
      }),
    ).rejects.toMatchObject({ code: 'P2003', meta: { modelName: 'Agendamento' } });
  });

  test('impede transferir paciente com agendamentos para outro psicólogo (ON UPDATE RESTRICT)', async () => {
    await agendar('2026-12-07T14:00', '2026-12-07T15:00');

    await expect(
      prisma.paciente.update({ where: { id: paciente.id }, data: { psicologoId: outraPsicologa.id } }),
    ).rejects.toThrow(FK_PACIENTE_PSICOLOGO);
  });
});
