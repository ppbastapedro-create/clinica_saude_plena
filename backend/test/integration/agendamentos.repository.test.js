const prisma = require('../../src/config/prisma');
const agendamentosRepository = require('../../src/repositories/agendamentos.repository');

describe('AgendamentoRepository — constraint de horário no banco', () => {
  let paciente;

  beforeAll(async () => {
    paciente = await prisma.paciente.create({
      data: { nome: 'Paciente Teste (integração)', cpf: '11144477735' },
    });
  });

  afterEach(async () => {
    await prisma.agendamento.deleteMany({ where: { pacienteId: paciente.id } });
  });

  afterAll(async () => {
    await prisma.paciente.delete({ where: { id: paciente.id } });
    await prisma.$disconnect();
  });

  test('rejeita sobreposição de horários', async () => {
    await agendamentosRepository.criar({
      pacienteId: paciente.id,
      inicio: new Date('2026-12-01T14:00:00-03:00'),
      fim: new Date('2026-12-01T14:50:00-03:00'),
    });

    await expect(
      agendamentosRepository.criar({
        pacienteId: paciente.id,
        inicio: new Date('2026-12-01T14:30:00-03:00'),
        fim: new Date('2026-12-01T15:20:00-03:00'),
      }),
    ).rejects.toThrow();
  });

  test('horário de sessão CANCELADA pode ser reutilizado', async () => {
    const original = await agendamentosRepository.criar({
      pacienteId: paciente.id,
      inicio: new Date('2026-12-02T10:00:00-03:00'),
      fim: new Date('2026-12-02T10:50:00-03:00'),
    });

    await prisma.agendamento.update({
      where: { id: original.id },
      data: { status: 'CANCELADO' },
    });

    await expect(
      agendamentosRepository.criar({
        pacienteId: paciente.id,
        inicio: new Date('2026-12-02T10:00:00-03:00'),
        fim: new Date('2026-12-02T10:50:00-03:00'),
      }),
    ).resolves.toMatchObject({ pacienteId: paciente.id });
  });

  test('sessões encostadas, sem gap, são aceitas', async () => {
    await agendamentosRepository.criar({
      pacienteId: paciente.id,
      inicio: new Date('2026-12-03T14:00:00-03:00'),
      fim: new Date('2026-12-03T14:50:00-03:00'),
    });

    await expect(
      agendamentosRepository.criar({
        pacienteId: paciente.id,
        inicio: new Date('2026-12-03T14:50:00-03:00'),
        fim: new Date('2026-12-03T15:40:00-03:00'),
      }),
    ).resolves.toMatchObject({ pacienteId: paciente.id });
  });

  test('rejeita fim menor ou igual ao início', async () => {
    await expect(
      agendamentosRepository.criar({
        pacienteId: paciente.id,
        inicio: new Date('2026-12-04T14:00:00-03:00'),
        fim: new Date('2026-12-04T14:00:00-03:00'),
      }),
    ).rejects.toThrow();
  });
});
