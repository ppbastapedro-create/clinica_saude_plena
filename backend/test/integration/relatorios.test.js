const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { sessionStore } = require('../../src/config/session');
const { emailUnico } = require('../helpers/emailUnico');

// Dados fictícios. Critério de aceitação do pacote 1.4.7 na EAP: "totais
// conferidos com dados de teste" — os números esperados abaixo foram
// calculados à mão a partir do cenário montado no beforeAll.
const SENHA = 'senha-de-teste-relatorios';
const PSI_A = { nome: 'Psicóloga Relatório A (fictícia)', email: emailUnico('relatorio.a') };
const PSI_B = { nome: 'Psicóloga Relatório B (fictícia)', email: emailUnico('relatorio.b') };

const h = (dataHora) => new Date(`${dataHora}:00-03:00`);

let psiA;
let psiB;
let agenteA;

const sessao = (psicologo, paciente, inicio, status, extra = {}) =>
  prisma.agendamento.create({
    data: {
      psicologoId: psicologo.id,
      pacienteId: paciente.id,
      inicio: h(inicio),
      fim: new Date(h(inicio).getTime() + 50 * 60_000),
      status,
      ...extra,
    },
  });

const recebimento = (psicologo, paciente, recebidoEm, valor, extra = {}) =>
  prisma.recebimento.create({
    data: { psicologoId: psicologo.id, pacienteId: paciente.id, recebidoEm: h(recebidoEm), valor, formaPagamento: 'PIX', ...extra },
  });

async function logar(email) {
  const agente = request.agent(app);
  expect((await agente.post('/auth/login').send({ email, senha: SENHA })).status).toBe(200);
  return agente;
}

beforeAll(async () => {
  const senhaHash = await bcrypt.hash(SENHA, 4);
  psiA = await prisma.usuario.create({ data: { ...PSI_A, senhaHash } });
  psiB = await prisma.usuario.create({ data: { ...PSI_B, senhaHash } });
  const ana = await prisma.paciente.create({ data: { psicologoId: psiA.id, nome: 'Ana (fictícia)', cpf: '11144477735' } });
  const beto = await prisma.paciente.create({ data: { psicologoId: psiA.id, nome: 'Beto (fictício)', cpf: '52998224725' } });
  const daB = await prisma.paciente.create({ data: { psicologoId: psiB.id, nome: 'Paciente da B', cpf: '39053344705' } });

  // ── Sessões de outubro de 2020 (passado) ──
  await sessao(psiA, ana, '2020-10-05T09:00', 'REALIZADO', { valor: '87.50' }); // atendido
  await sessao(psiA, beto, '2020-10-05T10:00', 'REALIZADO', { valor: '120.00' }); // atendido
  await sessao(psiA, ana, '2020-10-12T09:00', 'REALIZADO', { valor: '87.50', cobrar: false }); // não cobrada
  await sessao(psiA, beto, '2020-10-12T10:00', 'REALIZADO'); // cobrável sem valor
  await sessao(psiA, ana, '2020-10-19T09:00', 'FALTA', { valor: '87.50' }); // falta não cobrada (padrão)
  await sessao(psiA, beto, '2020-10-19T10:00', 'FALTA', { valor: '120.00', cobrar: true }); // falta cobrada
  await sessao(psiA, ana, '2020-10-26T09:00', 'CANCELADO', { valor: '87.50' });
  await sessao(psiA, beto, '2020-10-28T10:00', 'AGENDADO', { valor: '120.00' }); // "a fechar"
  await sessao(psiA, ana, '2020-10-31T23:30', 'REALIZADO', { valor: '0.10' }); // 01/11 em UTC, mas é OUTUBRO

  // ── Recebimentos (caixa: conta a DATA DO RECEBIMENTO) ──
  await recebimento(psiA, ana, '2020-09-30T23:30', '350.00', { sessoes: 4 }); // 01/10 em UTC, mas é SETEMBRO
  await recebimento(psiA, beto, '2020-10-01T00:30', '240.00', { sessoes: 2 }); // outubro
  await recebimento(psiA, ana, '2020-10-15T12:00', '0.10'); // outubro (centavos)
  await recebimento(psiA, ana, '2020-10-16T12:00', '0.20'); // outubro (centavos)
  await recebimento(psiA, beto, '2020-10-20T12:00', '999.00', { estornadoEm: new Date() }); // estornado: não conta
  await recebimento(psiA, beto, '2020-11-01T00:30', '120.00'); // novembro

  // Da outra psicóloga, no mesmo mês: não pode aparecer.
  await sessao(psiB, daB, '2020-10-05T09:00', 'REALIZADO', { valor: '9999.00' });
  await recebimento(psiB, daB, '2020-10-05T12:00', '9999.00');

  agenteA = await logar(PSI_A.email);
});

afterAll(async () => {
  const ids = [psiA.id, psiB.id];
  await prisma.recebimento.deleteMany({ where: { psicologoId: { in: ids } } });
  await prisma.agendamento.deleteMany({ where: { psicologoId: { in: ids } } });
  await prisma.paciente.deleteMany({ where: { psicologoId: { in: ids } } });
  await prisma.$executeRaw`DELETE FROM "session" WHERE (sess -> 'usuario' ->> 'id')::int = ANY(${ids})`;
  await prisma.logAcesso.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  sessionStore.close();
});

describe('GET /relatorios/mensal', () => {
  test('sem login: 401', async () => {
    expect((await request(app).get('/relatorios/mensal?mes=2020-10')).status).toBe(401);
  });

  test.each([['sem mês', ''], ['formato errado', '?mes=10/2020'], ['mês 13', '?mes=2020-13']])('%s: 400', async (_caso, query) => {
    expect((await agenteA.get(`/relatorios/mensal${query}`)).status).toBe(400);
  });

  test('contagens por status de outubro (fuso de Brasília, só da psicóloga logada)', async () => {
    const { body } = await agenteA.get('/relatorios/mensal?mes=2020-10');

    expect(body.mes).toBe('2020-10');
    expect(body.sessoes).toEqual({
      marcadas: 8, // 9 sessões de outubro menos 1 cancelada
      realizadas: 5,
      faltas: 2,
      canceladas: 1,
      agendadas: 1,
      aFechar: 1, // a de 28/10/2020 já começou e continua AGENDADO
    });
    expect(body.sessoesDoMes).toHaveLength(9);
  });

  test('recebido pela data do recebimento (caixa) e atendido pelas sessões cobráveis do mês', async () => {
    const { body } = await agenteA.get('/relatorios/mensal?mes=2020-10');

    expect(body.financeiro).toEqual({
      // 240 + 0,10 + 0,20 (o de 30/09 23:30 é setembro; o estornado não conta)
      recebido: { total: '240.30', quantidade: 3 },
      // 87,50 + 120 + 120 (falta cobrada) + 0,10 (31/10 23:30)
      atendido: { total: '327.60', quantidade: 4 },
      naoCobradas: 1,
      faltasCobradas: 1,
      semValor: 1,
    });
    expect(body.recebimentos.map((r) => r.valor)).toEqual(['240.00', '0.10', '0.20']);
  });

  test('limites do mês no fuso de Brasília: 30/09 23:30 é setembro, 01/11 00:30 é novembro', async () => {
    const setembro = (await agenteA.get('/relatorios/mensal?mes=2020-09')).body;
    const novembro = (await agenteA.get('/relatorios/mensal?mes=2020-11')).body;

    expect(setembro.financeiro.recebido).toEqual({ total: '350.00', quantidade: 1 });
    expect(novembro.financeiro.recebido).toEqual({ total: '120.00', quantidade: 1 });
    expect(novembro.sessoesDoMes).toEqual([]); // a de 31/10 23:30 ficou em outubro
  });

  test('mês sem movimento: tudo zerado', async () => {
    const { body } = await agenteA.get('/relatorios/mensal?mes=2019-01');

    expect(body.sessoes.marcadas).toBe(0);
    expect(body.financeiro.recebido).toEqual({ total: '0.00', quantidade: 0 });
    expect(body.financeiro.atendido).toEqual({ total: '0.00', quantidade: 0 });
  });
});
