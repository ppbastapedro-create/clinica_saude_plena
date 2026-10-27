const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { sessionStore } = require('../../src/config/session');
const { emailUnico } = require('../helpers/emailUnico');

// Conta corrente do paciente (pacote 1.4.7). Dados fictícios; os cenários
// imitam a rotina da parceira: preço por paciente, pacote de 4 sessões pago
// adiantado, sessão "não cobrar", falta cobrada à mão, estorno.
const SENHA = 'senha-de-teste-financeiro';
const PSI_A = { nome: 'Psicóloga Financeiro A (fictícia)', email: emailUnico('financeiro.a') };
const PSI_B = { nome: 'Psicóloga Financeiro B (fictícia)', email: emailUnico('financeiro.b') };

const h = (dataHora) => new Date(`${dataHora}:00-03:00`);
const iso = (dataHora) => `${dataHora}:00-03:00`;

let psiA;
let psiB;
let agenteA;
let agenteB;

// CPFs fictícios válidos, um por paciente criado nos testes.
const CPFS = ['11144477735', '52998224725', '39053344705', '98765432100', '27182818205', '31415926590', '16180339805', '14142135651'];
let proximoCpf = 0;
const criarPaciente = (psicologo, dados = {}) =>
  prisma.paciente.create({ data: { psicologoId: psicologo.id, nome: 'Paciente (fictício)', cpf: CPFS[proximoCpf++], ...dados } });

const sessao = (psicologo, paciente, inicio, status, extra = {}) =>
  prisma.agendamento.create({
    data: { psicologoId: psicologo.id, pacienteId: paciente.id, inicio: h(inicio), fim: new Date(h(inicio).getTime() + 50 * 60_000), status, ...extra },
  });

const receber = (agente, paciente, corpo) => agente.post(`/pacientes/${paciente.id}/recebimentos`).send(corpo);
const extrato = async (agente, paciente) => (await agente.get(`/pacientes/${paciente.id}/financeiro`)).body;

async function logar(email) {
  const agente = request.agent(app);
  expect((await agente.post('/auth/login').send({ email, senha: SENHA })).status).toBe(200);
  return agente;
}

beforeAll(async () => {
  const senhaHash = await bcrypt.hash(SENHA, 4);
  psiA = await prisma.usuario.create({ data: { ...PSI_A, senhaHash } });
  psiB = await prisma.usuario.create({ data: { ...PSI_B, senhaHash } });
  agenteA = await logar(PSI_A.email);
  agenteB = await logar(PSI_B.email);
});

// Cada describe monta seus pacientes; aqui só se limpa entre testes.
async function limpar() {
  const psicologoId = { in: [psiA.id, psiB.id] };
  await prisma.recebimento.deleteMany({ where: { psicologoId } });
  await prisma.agendamento.deleteMany({ where: { psicologoId } });
  await prisma.paciente.deleteMany({ where: { psicologoId } });
  proximoCpf = 0;
}
beforeEach(limpar);

afterAll(async () => {
  const ids = [psiA.id, psiB.id];
  await limpar();
  await prisma.$executeRaw`DELETE FROM "session" WHERE (sess -> 'usuario' ->> 'id')::int = ANY(${ids})`;
  await prisma.logAcesso.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  sessionStore.close();
});

describe('acesso', () => {
  test.each([
    ['get', '/pacientes/1/financeiro'],
    ['post', '/pacientes/1/recebimentos'],
    ['patch', '/recebimentos/1/estornar'],
    ['patch', '/agendamentos/1/cobranca'],
    ['get', '/relatorios/saldos'],
  ])('sem login: %s %s dá 401', async (metodo, rota) => {
    expect((await request(app)[metodo](rota)).status).toBe(401);
  });
});

describe('preço por paciente e valor da sessão', () => {
  test('o paciente guarda o preço padrão ("120,00" vira "120.00")', async () => {
    const resposta = await agenteA.post('/pacientes').send({ nome: 'Paciente Preço', cpf: CPFS[0], valorSessao: '120,00' });

    expect(resposta.status).toBe(201);
    expect(resposta.body.valorSessao).toBe('120.00');
  });

  test('preço inválido: 400 no campo valorSessao', async () => {
    const resposta = await agenteA.post('/pacientes').send({ nome: 'Paciente Preço', cpf: CPFS[0], valorSessao: '-5' });

    expect(resposta.status).toBe(400);
    expect(resposta.body.campos).toHaveProperty('valorSessao');
  });

  test('sessão marcada sem valor herda o preço do paciente; com valor, usa o informado; null = sem valor', async () => {
    const p = await criarPaciente(psiA, { valorSessao: '87.50' });
    const marcar = (hora, extra) =>
      agenteA.post('/agendamentos').send({ pacienteId: p.id, inicio: iso(`2031-05-05T${hora}`), fim: iso(`2031-05-05T${hora.replace(':00', ':50')}`), ...extra });

    expect((await marcar('09:00', {})).body.valor).toBe('87.50');
    expect((await marcar('10:00', { valor: '100' })).body.valor).toBe('100.00');
    expect((await marcar('11:00', { valor: null })).body.valor).toBeNull();
  });
});

describe('PATCH /agendamentos/:id/cobranca', () => {
  const cobranca = (agente, s, corpo) => agente.patch(`/agendamentos/${s.id}/cobranca`).send(corpo);

  test('realizada: cobra por padrão; "não cobrar" tira da conta; null volta ao padrão', async () => {
    const p = await criarPaciente(psiA);
    const s = await sessao(psiA, p, '2020-03-02T09:00', 'REALIZADO', { valor: '87.50' });

    expect((await agenteA.get(`/agendamentos/${s.id}`)).body.cobravel).toBe(true);

    const naoCobrar = await cobranca(agenteA, s, { cobrar: false });
    expect(naoCobrar.status).toBe(200);
    expect(naoCobrar.body).toMatchObject({ cobrar: false, cobravel: false, valor: '87.50' });

    expect((await cobranca(agenteA, s, { cobrar: null })).body).toMatchObject({ cobrar: null, cobravel: true });
  });

  test('falta: não cobra por padrão; a psicóloga pode cobrar', async () => {
    const p = await criarPaciente(psiA);
    const s = await sessao(psiA, p, '2020-03-02T09:00', 'FALTA', { valor: '87.50' });

    expect((await agenteA.get(`/agendamentos/${s.id}`)).body.cobravel).toBe(false);
    expect((await cobranca(agenteA, s, { cobrar: true })).body.cobravel).toBe(true);
  });

  test('agendada: o valor pode ser ajustado, mas ela só entra na conta depois de realizada', async () => {
    const p = await criarPaciente(psiA);
    const s = await sessao(psiA, p, '2030-03-02T09:00', 'AGENDADO');

    const resposta = await cobranca(agenteA, s, { valor: '150,00', cobrar: true });

    expect(resposta.body).toMatchObject({ valor: '150.00', cobravel: false });
  });

  test('corrigir só o valor mantém o "cobrar"', async () => {
    const p = await criarPaciente(psiA);
    const s = await sessao(psiA, p, '2020-03-02T09:00', 'REALIZADO', { valor: '87.50', cobrar: false });

    expect((await cobranca(agenteA, s, { valor: '90' })).body).toMatchObject({ valor: '90.00', cobrar: false });
  });

  test('sessão cancelada: 422; de outra psicóloga: 404; corpo vazio: 400', async () => {
    const p = await criarPaciente(psiA);
    const cancelada = await sessao(psiA, p, '2020-03-02T09:00', 'CANCELADO');
    const daB = await sessao(psiB, await criarPaciente(psiB), '2020-03-02T09:00', 'REALIZADO');
    const outra = await sessao(psiA, p, '2020-03-03T09:00', 'REALIZADO');

    expect((await cobranca(agenteA, cancelada, { valor: '10' })).status).toBe(422);
    expect((await cobranca(agenteA, daB, { valor: '10' })).status).toBe(404);
    expect((await cobranca(agenteA, outra, {})).status).toBe(400);
  });
});

describe('recebimentos', () => {
  test('registra: 201 com valor em texto, forma e quantas sessões cobre', async () => {
    const p = await criarPaciente(psiA);

    const resposta = await receber(agenteA, p, { valor: '350', formaPagamento: 'PIX', sessoes: 4, recebidoEm: iso('2020-03-01T10:00') });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toEqual({
      id: expect.any(Number),
      paciente: { id: p.id, nome: 'Paciente (fictício)' },
      valor: '350.00',
      recebidoEm: '2020-03-01T13:00:00.000Z',
      formaPagamento: 'PIX',
      sessoes: 4,
      estornadoEm: null,
      criadoEm: expect.any(String),
    });
  });

  test('sem data: recebido agora', async () => {
    const p = await criarPaciente(psiA);
    const antes = Date.now();

    const { body } = await receber(agenteA, p, { valor: '87.50', formaPagamento: 'DINHEIRO' });

    expect(new Date(body.recebidoEm).getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(body.sessoes).toBeNull();
  });

  test.each([
    ['valor zero', { valor: '0', formaPagamento: 'PIX' }, 'valor'],
    ['sem forma', { valor: '100' }, 'formaPagamento'],
    ['forma fora do enum', { valor: '100', formaPagamento: 'CHEQUE' }, 'formaPagamento'],
    ['data no futuro', { valor: '100', formaPagamento: 'PIX', recebidoEm: '2099-01-01T10:00:00-03:00' }, 'recebidoEm'],
    ['zero sessões', { valor: '100', formaPagamento: 'PIX', sessoes: 0 }, 'sessoes'],
  ])('inválido (%s): 400 no campo certo e nada é gravado', async (_caso, corpo, campo) => {
    const p = await criarPaciente(psiA);

    const resposta = await receber(agenteA, p, corpo);

    expect(resposta.status).toBe(400);
    expect(resposta.body.campos).toHaveProperty(campo);
    expect(await prisma.recebimento.count({ where: { pacienteId: p.id } })).toBe(0);
  });

  test('paciente de outra psicóloga: 404 e nada é gravado', async () => {
    const daB = await criarPaciente(psiB);

    expect((await receber(agenteA, daB, { valor: '100', formaPagamento: 'PIX' })).status).toBe(404);
    expect(await prisma.recebimento.count({ where: { pacienteId: daB.id } })).toBe(0);
  });

  test('paciente arquivado também recebe (quitar o que ficou devendo)', async () => {
    const p = await criarPaciente(psiA, { arquivadoEm: new Date() });

    expect((await receber(agenteA, p, { valor: '100', formaPagamento: 'PIX' })).status).toBe(201);
  });

  test('estornar: marca a data, é idempotente e não apaga; de outra psicóloga: 404', async () => {
    const p = await criarPaciente(psiA);
    const { body: r } = await receber(agenteA, p, { valor: '100', formaPagamento: 'PIX' });

    const primeiro = await agenteA.patch(`/recebimentos/${r.id}/estornar`);
    const segundo = await agenteA.patch(`/recebimentos/${r.id}/estornar`);

    expect(primeiro.status).toBe(200);
    expect(primeiro.body.estornadoEm).not.toBeNull();
    expect(segundo.body.estornadoEm).toBe(primeiro.body.estornadoEm);
    expect(await prisma.recebimento.count({ where: { id: r.id } })).toBe(1);
    expect((await agenteB.patch(`/recebimentos/${r.id}/estornar`)).status).toBe(404);
  });
});

describe('extrato do paciente (conta corrente)', () => {
  test('pacote de 4 pago adiantado, com falta, cortesia e sessão sem valor', async () => {
    const p = await criarPaciente(psiA, { valorSessao: '87.50' });
    await receber(agenteA, p, { valor: '350', formaPagamento: 'PIX', sessoes: 4, recebidoEm: iso('2020-03-01T10:00') });
    await sessao(psiA, p, '2020-03-02T09:00', 'REALIZADO', { valor: '87.50' }); // cobra
    await sessao(psiA, p, '2020-03-09T09:00', 'REALIZADO', { valor: '87.50' }); // cobra
    const falta = await sessao(psiA, p, '2020-03-16T09:00', 'FALTA', { valor: '87.50' }); // não cobra (padrão)
    await sessao(psiA, p, '2020-03-23T09:00', 'REALIZADO', { valor: '87.50', cobrar: false }); // cortesia
    await sessao(psiA, p, '2020-03-30T09:00', 'REALIZADO', { valor: '87.50' }); // cobra
    await sessao(psiA, p, '2020-03-31T09:00', 'REALIZADO'); // cobrável, mas sem valor: fica de fora dos totais
    await sessao(psiA, p, '2030-04-06T09:00', 'AGENDADO', { valor: '87.50' }); // futura: não entra

    const e = await extrato(agenteA, p);

    // 3 cobradas × 87,50 = 262,50; recebido 350 → sobra 1 sessão de crédito.
    expect(e).toMatchObject({ cobrado: '262.50', recebido: '350.00', saldo: '87.50', sessoesCobradas: 3, sessoesSemValor: 1 });
    expect(e.paciente.valorSessao).toBe('87.50');
    // Mais recente primeiro; o saldo depois do último lançamento é o saldo final.
    expect(e.lancamentos.map((l) => l.tipo)).toEqual(['SESSAO', 'SESSAO', 'SESSAO', 'RECEBIMENTO']);
    expect(e.lancamentos[0].saldoApos).toBe('87.50');
    expect(e.lancamentos.at(-1).saldoApos).toBe('350.00');

    // A psicóloga decide cobrar a falta: o crédito é consumido.
    await agenteA.patch(`/agendamentos/${falta.id}/cobranca`).send({ cobrar: true });
    expect((await extrato(agenteA, p)).saldo).toBe('0.00');

    // Mais uma sessão realizada: agora há 87,50 a receber.
    await sessao(psiA, p, '2020-04-06T09:00', 'REALIZADO', { valor: '87.50' });
    expect((await extrato(agenteA, p)).saldo).toBe('-87.50');
  });

  test('recebimento estornado aparece no extrato, mas não conta no saldo', async () => {
    const p = await criarPaciente(psiA);
    await sessao(psiA, p, '2020-03-02T09:00', 'REALIZADO', { valor: '100' });
    const { body: r } = await receber(agenteA, p, { valor: '100', formaPagamento: 'PIX', recebidoEm: iso('2020-03-02T12:00') });
    await agenteA.patch(`/recebimentos/${r.id}/estornar`);

    const e = await extrato(agenteA, p);

    expect(e).toMatchObject({ recebido: '0.00', saldo: '-100.00' });
    expect(e.lancamentos[0].recebimento.estornadoEm).not.toBeNull();
  });

  test('somas exatas em centavos (0,10 + 0,20 = 0,30)', async () => {
    const p = await criarPaciente(psiA);
    await receber(agenteA, p, { valor: '0.10', formaPagamento: 'PIX', recebidoEm: iso('2020-03-01T10:00') });
    await receber(agenteA, p, { valor: '0.20', formaPagamento: 'PIX', recebidoEm: iso('2020-03-01T11:00') });

    expect((await extrato(agenteA, p)).recebido).toBe('0.30');
  });

  test('paciente de outra psicóloga: 404', async () => {
    const daB = await criarPaciente(psiB);

    expect((await agenteA.get(`/pacientes/${daB.id}/financeiro`)).status).toBe(404);
  });
});

describe('GET /relatorios/saldos (painel a receber / crédito)', () => {
  test('saldo por paciente, totais, arquivado zerado fora e isolamento entre psicólogas', async () => {
    const devedor = await criarPaciente(psiA, { nome: 'Devedor (fictício)' });
    const credor = await criarPaciente(psiA, { nome: 'Credor (fictício)' });
    const quitado = await criarPaciente(psiA, { nome: 'Quitado (fictício)' });
    const arquivadoZerado = await criarPaciente(psiA, { nome: 'Arquivado (fictício)', arquivadoEm: new Date() });
    const daB = await criarPaciente(psiB, { nome: 'Da B (fictício)' });

    await sessao(psiA, devedor, '2020-03-02T09:00', 'REALIZADO', { valor: '120' });
    await sessao(psiA, devedor, '2020-03-09T09:00', 'REALIZADO', { valor: '120' });
    await receber(agenteA, credor, { valor: '350', formaPagamento: 'PIX', recebidoEm: iso('2020-03-01T10:00') });
    await sessao(psiA, credor, '2020-03-03T09:00', 'REALIZADO', { valor: '87.50' });
    await sessao(psiA, quitado, '2020-03-04T09:00', 'REALIZADO', { valor: '100' });
    await receber(agenteA, quitado, { valor: '100', formaPagamento: 'DINHEIRO', recebidoEm: iso('2020-03-04T12:00') });
    await sessao(psiB, daB, '2020-03-02T09:00', 'REALIZADO', { valor: '999' });

    const { body } = await agenteA.get('/relatorios/saldos');

    expect(body.totais).toEqual({
      aReceber: { total: '240.00', pacientes: 1 },
      creditos: { total: '262.50', pacientes: 1 },
    });
    // Do mais devedor para o com mais crédito; arquivado sem pendência some.
    expect(body.pacientes.map((l) => `${l.paciente.nome} ${l.saldo}`)).toEqual([
      'Devedor (fictício) -240.00',
      'Quitado (fictício) 0.00',
      'Credor (fictício) 262.50',
    ]);
    expect(body.pacientes.find((l) => l.paciente.id === arquivadoZerado.id)).toBeUndefined();
  });
});
