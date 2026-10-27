const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { sessionStore } = require('../../src/config/session');
const agendamentosRepository = require('../../src/repositories/agendamentos.repository');
const errorHandler = require('../../src/middlewares/errorHandler');
const { emailUnico } = require('../helpers/emailUnico');

// Dados fictícios. Duas psicólogas para provar o isolamento.
const SENHA = 'senha-de-teste-agenda';
const PSI_A = { nome: 'Psicóloga Agenda A (fictícia)', email: emailUnico('agenda.a') };
const PSI_B = { nome: 'Psicóloga Agenda B (fictícia)', email: emailUnico('agenda.b') };

// Horários sempre com fuso explícito. 2030 = futuro; 2020 = passado.
const h = (dataHora) => `${dataHora}:00-03:00`;

let psiA;
let psiB;
let agenteA;
let agenteB;
let maria; // paciente da A
let joao; // paciente da A
let arquivada; // paciente arquivada da A
let daB; // paciente da B

async function logar(email) {
  const agente = request.agent(app);
  expect((await agente.post('/auth/login').send({ email, senha: SENHA })).status).toBe(200);
  return agente;
}

const agendar = (agente, pacienteId, inicio, fim) =>
  agente.post('/agendamentos').send({ pacienteId, inicio: h(inicio), fim: h(fim) });

// Cria direto no banco, sem passar pelas regras (para montar cenários).
const criarNoBanco = (psicologo, paciente, inicio, fim, status = 'AGENDADO') =>
  prisma.agendamento.create({
    data: { psicologoId: psicologo.id, pacienteId: paciente.id, inicio: new Date(h(inicio)), fim: new Date(h(fim)), status },
  });

const contarDaA = () => prisma.agendamento.count({ where: { psicologoId: psiA.id } });

beforeAll(async () => {
  const senhaHash = await bcrypt.hash(SENHA, 4);
  psiA = await prisma.usuario.create({ data: { ...PSI_A, senhaHash } });
  psiB = await prisma.usuario.create({ data: { ...PSI_B, senhaHash } });
  maria = await prisma.paciente.create({ data: { psicologoId: psiA.id, nome: 'Maria (fictícia)', cpf: '11144477735' } });
  joao = await prisma.paciente.create({ data: { psicologoId: psiA.id, nome: 'João (fictício)', cpf: '52998224725' } });
  arquivada = await prisma.paciente.create({
    data: { psicologoId: psiA.id, nome: 'Ana (fictícia)', cpf: '98765432100', arquivadoEm: new Date() },
  });
  daB = await prisma.paciente.create({ data: { psicologoId: psiB.id, nome: 'Paciente da B', cpf: '39053344705' } });
  agenteA = await logar(PSI_A.email);
  agenteB = await logar(PSI_B.email);
});

let avisos; // console.warn do errorHandler (constraint barrou uma gravação)

beforeEach(async () => {
  await prisma.agendamento.deleteMany({ where: { psicologoId: { in: [psiA.id, psiB.id] } } });
  // Captura (e silencia) o aviso que o errorHandler registra quando a
  // constraint do banco barra uma marcação simultânea — é esperado aqui.
  avisos = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  const ids = [psiA.id, psiB.id];
  // Filhos antes dos pais: todas as FKs são RESTRICT.
  await prisma.agendamento.deleteMany({ where: { psicologoId: { in: ids } } });
  await prisma.paciente.deleteMany({ where: { psicologoId: { in: ids } } });
  await prisma.$executeRaw`DELETE FROM "session" WHERE (sess -> 'usuario' ->> 'id')::int = ANY(${ids})`;
  await prisma.logAcesso.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  sessionStore.close();
});

describe('acesso', () => {
  test.each([
    ['get', '/agendamentos'],
    ['post', '/agendamentos'],
    ['get', '/agendamentos/1'],
    ['put', '/agendamentos/1'],
    ['patch', '/agendamentos/1/status'],
  ])('sem login: %s %s dá 401', async (metodo, rota) => {
    expect((await request(app)[metodo](rota)).status).toBe(401);
  });

  test('não existe exclusão física: DELETE dá 404 e a sessão continua no banco', async () => {
    const ag = await criarNoBanco(psiA, maria, '2030-03-04T14:00', '2030-03-04T14:50');

    expect((await agenteA.delete(`/agendamentos/${ag.id}`)).status).toBe(404);
    expect(await contarDaA()).toBe(1);
  });
});

describe('POST /agendamentos (marcar)', () => {
  test('marca: 201 com paciente (só id e nome) e status AGENDADO', async () => {
    const resposta = await agendar(agenteA, maria.id, '2030-03-04T14:00', '2030-03-04T14:50');

    expect(resposta.status).toBe(201);
    expect(resposta.body).toEqual({
      id: expect.any(Number),
      inicio: '2030-03-04T17:00:00.000Z', // 14h em Brasília = 17h UTC
      fim: '2030-03-04T17:50:00.000Z',
      status: 'AGENDADO',
      paciente: { id: maria.id, nome: 'Maria (fictícia)' },
      temRegistro: false,
      valor: null, // paciente sem preço padrão e sem valor no corpo
      cobrar: null,
      cobravel: false, // agendada ainda não entra na conta
      lembreteEnviadoEm: null,
      criadoEm: expect.any(String),
    });
  });

  test('psicologoId do corpo é ignorado: a sessão é de quem está logado', async () => {
    const resposta = await agenteA.post('/agendamentos').send({
      pacienteId: maria.id,
      psicologoId: psiB.id,
      inicio: h('2030-03-04T14:00'),
      fim: h('2030-03-04T14:50'),
    });

    expect(resposta.status).toBe(201);
    expect((await prisma.agendamento.findUnique({ where: { id: resposta.body.id } })).psicologoId).toBe(psiA.id);
  });

  test('sessão no passado é aceita (lançar atendimentos da agenda de papel)', async () => {
    expect((await agendar(agenteA, maria.id, '2020-03-04T14:00', '2020-03-04T14:50')).status).toBe(201);
  });

  test.each([
    ['sem fuso', { inicio: '2030-03-04T14:00:00', fim: '2030-03-04T14:50:00' }, 'inicio'],
    ['data sem hora', { inicio: '2030-03-04', fim: h('2030-03-04T14:50') }, 'inicio'],
    ['texto qualquer', { inicio: 'amanhã', fim: h('2030-03-04T14:50') }, 'inicio'],
    ['sem fim', { inicio: h('2030-03-04T14:00') }, 'fim'],
  ])('data/hora inválida (%s): 400 indicando o campo', async (_caso, datas, campo) => {
    const resposta = await agenteA.post('/agendamentos').send({ pacienteId: maria.id, ...datas });

    expect(resposta.status).toBe(400);
    expect(resposta.body.campos[campo]).toEqual([expect.any(String)]);
  });

  test.each([
    ['ausente', undefined],
    ['texto', 'abc'],
    ['zero', 0],
  ])('pacienteId %s: 400', async (_caso, pacienteId) => {
    const resposta = await agenteA
      .post('/agendamentos')
      .send({ pacienteId, inicio: h('2030-03-04T14:00'), fim: h('2030-03-04T14:50') });
    expect(resposta.status).toBe(400);
  });

  test.each([
    ['fim igual ao início', '2030-03-04T14:00', '2030-03-04T14:00', /depois do início/],
    ['fim antes do início', '2030-03-04T15:00', '2030-03-04T14:00', /depois do início/],
    ['mais de 4 horas', '2030-03-04T08:00', '2030-03-04T12:01', /4 horas/],
  ])('intervalo inválido (%s): 422', async (_caso, inicio, fim, mensagem) => {
    const resposta = await agendar(agenteA, maria.id, inicio, fim);

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro).toMatch(mensagem);
  });

  test('paciente de outra psicóloga ou inexistente: 404', async () => {
    expect((await agendar(agenteA, daB.id, '2030-03-04T14:00', '2030-03-04T14:50')).status).toBe(404);
    expect((await agendar(agenteA, 2_000_000_000, '2030-03-04T14:00', '2030-03-04T14:50')).status).toBe(404);
    expect(await contarDaA()).toBe(0);
  });

  test('paciente arquivado: 422', async () => {
    const resposta = await agendar(agenteA, arquivada.id, '2030-03-04T14:00', '2030-03-04T14:50');

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro).toMatch(/arquivado/);
  });
});

describe('conflito de horário', () => {
  test.each([
    ['começa no meio de outra', '2030-03-04T14:30', '2030-03-04T15:30'],
    ['termina no meio de outra', '2030-03-04T13:30', '2030-03-04T14:30'],
    ['dentro de outra', '2030-03-04T14:10', '2030-03-04T14:40'],
    ['envolve outra', '2030-03-04T13:00', '2030-03-04T16:00'],
    ['mesmo horário', '2030-03-04T14:00', '2030-03-04T15:00'],
  ])('%s: 409 dizendo com quem é o conflito', async (_caso, inicio, fim) => {
    const existente = await criarNoBanco(psiA, maria, '2030-03-04T14:00', '2030-03-04T15:00');

    const resposta = await agendar(agenteA, joao.id, inicio, fim);

    expect(resposta.status).toBe(409);
    expect(resposta.body.erro).toBe('Horário ocupado: sessão de Maria (fictícia) em 04/03, 14:00–15:00.');
    expect(resposta.body.conflito.id).toBe(existente.id);
    expect(await contarDaA()).toBe(1);
  });

  test('sessões encostadas (14h–15h e 15h–16h) são aceitas', async () => {
    await criarNoBanco(psiA, maria, '2030-03-04T14:00', '2030-03-04T15:00');

    expect((await agendar(agenteA, joao.id, '2030-03-04T15:00', '2030-03-04T16:00')).status).toBe(201);
    expect((await agendar(agenteA, joao.id, '2030-03-04T13:00', '2030-03-04T14:00')).status).toBe(201);
  });

  test('sessão CANCELADA não ocupa o horário', async () => {
    await criarNoBanco(psiA, maria, '2030-03-04T14:00', '2030-03-04T15:00', 'CANCELADO');

    expect((await agendar(agenteA, joao.id, '2030-03-04T14:00', '2030-03-04T15:00')).status).toBe(201);
  });

  test.each(['REALIZADO', 'FALTA'])('sessão %s continua ocupando o horário', async (status) => {
    await criarNoBanco(psiA, maria, '2020-03-04T14:00', '2020-03-04T15:00', status);

    expect((await agendar(agenteA, joao.id, '2020-03-04T14:30', '2020-03-04T15:30')).status).toBe(409);
  });

  test('psicólogas diferentes podem ter o mesmo horário, e o 409 não vaza a agenda da outra', async () => {
    await criarNoBanco(psiB, daB, '2030-03-04T14:00', '2030-03-04T15:00');

    expect((await agendar(agenteA, maria.id, '2030-03-04T14:00', '2030-03-04T15:00')).status).toBe(201);
  });

  test('duas psicólogas marcam o MESMO horário pela API, ao mesmo tempo: 201 para ambas', async () => {
    const [daA, daOutra] = await Promise.all([
      agendar(agenteA, maria.id, '2030-03-07T14:00', '2030-03-07T15:00'),
      agendar(agenteB, daB.id, '2030-03-07T14:00', '2030-03-07T15:00'),
    ]);

    expect(daA.status).toBe(201);
    expect(daOutra.status).toBe(201);
    // Cada uma enxerga só a própria sessão naquele horário.
    const periodo = `inicio=${encodeURIComponent(h('2030-03-07T00:00'))}&fim=${encodeURIComponent(h('2030-03-08T00:00'))}`;
    expect((await agenteA.get(`/agendamentos?${periodo}`)).body.map((a) => a.id)).toEqual([daA.body.id]);
    expect((await agenteB.get(`/agendamentos?${periodo}`)).body.map((a) => a.id)).toEqual([daOutra.body.id]);
  });

  test('5 pedidos SIMULTÂNEOS para o mesmo horário: exatamente 1 é marcado, os outros dão 409', async () => {
    // Todos podem passar juntos pela checagem do service; quem garante a
    // unicidade é a exclusion constraint do banco.
    const respostas = await Promise.all(
      [maria, joao, maria, joao, maria].map((p) => agendar(agenteA, p.id, '2030-03-05T10:00', '2030-03-05T11:00')),
    );

    const status = respostas.map((r) => r.status).sort();
    expect(status).toEqual([201, 409, 409, 409, 409]);
    expect(await contarDaA()).toBe(1);
    // Nenhum 409 vaza detalhe do Postgres (valores da linha, nome da constraint).
    for (const r of respostas.filter((x) => x.status === 409)) {
      expect(JSON.stringify(r.body)).not.toMatch(/tstzrange|excl|psicologoId|23P01/);
    }
  });
});

describe('GET /agendamentos (agenda do período)', () => {
  beforeEach(async () => {
    await criarNoBanco(psiA, joao, '2030-03-04T16:00', '2030-03-04T17:00');
    await criarNoBanco(psiA, maria, '2030-03-04T13:30', '2030-03-04T14:30'); // começa antes do período
    await criarNoBanco(psiA, maria, '2030-03-04T15:00', '2030-03-04T16:00', 'CANCELADO');
    await criarNoBanco(psiA, maria, '2030-03-05T14:00', '2030-03-05T15:00'); // fora do período
    await criarNoBanco(psiB, daB, '2030-03-04T15:00', '2030-03-04T16:00'); // da outra psicóloga
  });

  const periodo = (extra = '') =>
    agenteA.get(
      `/agendamentos?inicio=${encodeURIComponent(h('2030-03-04T14:00'))}&fim=${encodeURIComponent(h('2030-03-04T18:00'))}${extra}`,
    );
  const resumo = (r) => r.body.map((a) => `${a.paciente.nome} ${a.status}`);

  test('sessões da psicóloga que tocam o período, em ordem, sem as canceladas', async () => {
    const resposta = await periodo();

    expect(resposta.status).toBe(200);
    expect(resumo(resposta)).toEqual(['Maria (fictícia) AGENDADO', 'João (fictício) AGENDADO']);
  });

  test('incluirCancelados=true traz as canceladas', async () => {
    expect(resumo(await periodo('&incluirCancelados=true'))).toEqual([
      'Maria (fictícia) AGENDADO',
      'Maria (fictícia) CANCELADO',
      'João (fictício) AGENDADO',
    ]);
  });

  test.each([
    ['sem período', '/agendamentos'],
    ['fim antes do início', `/agendamentos?inicio=${encodeURIComponent(h('2030-03-05T00:00'))}&fim=${encodeURIComponent(h('2030-03-04T00:00'))}`],
    ['mais de 100 dias', `/agendamentos?inicio=${encodeURIComponent(h('2030-01-01T00:00'))}&fim=${encodeURIComponent(h('2030-06-01T00:00'))}`],
  ])('%s: 400', async (_caso, rota) => {
    expect((await agenteA.get(rota)).status).toBe(400);
  });
});

describe('GET /agendamentos/:id', () => {
  test('da própria psicóloga: 200; de outra: 404', async () => {
    const meu = await criarNoBanco(psiA, maria, '2030-03-04T14:00', '2030-03-04T15:00');
    const daOutra = await criarNoBanco(psiB, daB, '2030-03-04T14:00', '2030-03-04T15:00');

    expect((await agenteA.get(`/agendamentos/${meu.id}`)).body.paciente.nome).toBe('Maria (fictícia)');
    expect((await agenteA.get(`/agendamentos/${daOutra.id}`)).status).toBe(404);
  });
});

describe('PUT /agendamentos/:id (remarcar)', () => {
  test('remarca e zera o lembrete já enviado (era do horário antigo)', async () => {
    const ag = await criarNoBanco(psiA, maria, '2030-03-04T14:00', '2030-03-04T15:00');
    await prisma.agendamento.update({ where: { id: ag.id }, data: { lembreteEnviadoEm: new Date() } });

    const resposta = await agenteA
      .put(`/agendamentos/${ag.id}`)
      .send({ inicio: h('2030-03-06T09:00'), fim: h('2030-03-06T10:00') });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ inicio: '2030-03-06T12:00:00.000Z', status: 'AGENDADO' });
    expect((await prisma.agendamento.findUnique({ where: { id: ag.id } })).lembreteEnviadoEm).toBeNull();
  });

  test('pode remarcar sobrepondo o próprio horário antigo (adiar 10 min)', async () => {
    const ag = await criarNoBanco(psiA, maria, '2030-03-04T14:00', '2030-03-04T15:00');

    const resposta = await agenteA
      .put(`/agendamentos/${ag.id}`)
      .send({ inicio: h('2030-03-04T14:10'), fim: h('2030-03-04T15:10') });

    expect(resposta.status).toBe(200);
  });

  test('para horário de outra sessão: 409 e nada muda', async () => {
    await criarNoBanco(psiA, joao, '2030-03-04T16:00', '2030-03-04T17:00');
    const ag = await criarNoBanco(psiA, maria, '2030-03-04T14:00', '2030-03-04T15:00');

    const resposta = await agenteA
      .put(`/agendamentos/${ag.id}`)
      .send({ inicio: h('2030-03-04T16:30'), fim: h('2030-03-04T17:30') });

    expect(resposta.status).toBe(409);
    expect((await prisma.agendamento.findUnique({ where: { id: ag.id } })).inicio).toEqual(new Date(h('2030-03-04T14:00')));
  });

  test.each(['REALIZADO', 'FALTA', 'CANCELADO'])('sessão %s não pode ser remarcada: 422', async (status) => {
    const ag = await criarNoBanco(psiA, maria, '2020-03-04T14:00', '2020-03-04T15:00', status);

    const resposta = await agenteA
      .put(`/agendamentos/${ag.id}`)
      .send({ inicio: h('2030-03-06T09:00'), fim: h('2030-03-06T10:00') });

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro).toMatch(new RegExp(`status ${status}`));
  });

  test('intervalo inválido: 422', async () => {
    const ag = await criarNoBanco(psiA, maria, '2030-03-04T14:00', '2030-03-04T15:00');

    const resposta = await agenteA
      .put(`/agendamentos/${ag.id}`)
      .send({ inicio: h('2030-03-04T15:00'), fim: h('2030-03-04T14:00') });

    expect(resposta.status).toBe(422);
  });

  test.each([
    ['para o futuro', '2030-03-06T09:00', '2030-03-06T10:00'],
    ['para outro dia no passado', '2020-03-05T09:00', '2020-03-05T10:00'],
  ])('paciente arquivado: remarcar %s dá 422 e nada muda', async (_caso, inicio, fim) => {
    // Só sessão passada pode existir para paciente arquivado (a futura
    // bloquearia o arquivamento).
    const pendente = await criarNoBanco(psiA, arquivada, '2020-03-04T14:00', '2020-03-04T15:00');

    const resposta = await agenteA.put(`/agendamentos/${pendente.id}`).send({ inicio: h(inicio), fim: h(fim) });

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro).toMatch(/arquivado.*não pode ser remarcada/);
    expect((await prisma.agendamento.findUnique({ where: { id: pendente.id } })).inicio).toEqual(pendente.inicio);
  });

  test('sessão de outra psicóloga: 404 e nada muda', async () => {
    const daOutra = await criarNoBanco(psiB, daB, '2030-03-04T14:00', '2030-03-04T15:00');

    const resposta = await agenteA
      .put(`/agendamentos/${daOutra.id}`)
      .send({ inicio: h('2030-03-06T09:00'), fim: h('2030-03-06T10:00') });

    expect(resposta.status).toBe(404);
    expect((await prisma.agendamento.findUnique({ where: { id: daOutra.id } })).inicio).toEqual(daOutra.inicio);
  });
});

describe('PATCH /agendamentos/:id/status', () => {
  const mudar = (agente, id, status) => agente.patch(`/agendamentos/${id}/status`).send({ status });

  test('cancelar sessão futura: 200 e o horário fica livre', async () => {
    const ag = await criarNoBanco(psiA, maria, '2030-03-04T14:00', '2030-03-04T15:00');

    const resposta = await mudar(agenteA, ag.id, 'CANCELADO');

    expect(resposta.status).toBe(200);
    expect(resposta.body.status).toBe('CANCELADO');
    expect((await agendar(agenteA, joao.id, '2030-03-04T14:00', '2030-03-04T15:00')).status).toBe(201);
  });

  test.each(['REALIZADO', 'FALTA'])('%s em sessão que já começou: 200', async (status) => {
    const ag = await criarNoBanco(psiA, maria, '2020-03-04T14:00', '2020-03-04T15:00');

    const resposta = await mudar(agenteA, ag.id, status);

    expect(resposta.status).toBe(200);
    expect(resposta.body.status).toBe(status);
  });

  test.each(['REALIZADO', 'FALTA'])('%s em sessão futura: 422', async (status) => {
    const ag = await criarNoBanco(psiA, maria, '2030-03-04T14:00', '2030-03-04T15:00');

    const resposta = await mudar(agenteA, ag.id, status);

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro).toMatch(/ainda não começou/);
  });

  // Todas as transições que NÃO partem de AGENDADO, e a volta para AGENDADO.
  test.each([
    ['REALIZADO', 'FALTA'],
    ['REALIZADO', 'CANCELADO'],
    ['FALTA', 'REALIZADO'],
    ['FALTA', 'CANCELADO'],
    ['CANCELADO', 'REALIZADO'],
    ['CANCELADO', 'FALTA'],
    ['REALIZADO', 'AGENDADO'],
    ['CANCELADO', 'AGENDADO'],
    ['AGENDADO', 'AGENDADO'],
  ])('%s → %s: 422 e o status não muda', async (de, para) => {
    const ag = await criarNoBanco(psiA, maria, '2020-03-04T14:00', '2020-03-04T15:00', de);

    expect((await mudar(agenteA, ag.id, para)).status).toBe(422);
    expect((await prisma.agendamento.findUnique({ where: { id: ag.id } })).status).toBe(de);
  });

  test('status desconhecido: 400', async () => {
    const ag = await criarNoBanco(psiA, maria, '2020-03-04T14:00', '2020-03-04T15:00');
    expect((await mudar(agenteA, ag.id, 'APAGADO')).status).toBe(400);
  });

  test('sessão de outra psicóloga: 404 e nada muda', async () => {
    const daOutra = await criarNoBanco(psiB, daB, '2030-03-04T14:00', '2030-03-04T15:00');

    expect((await mudar(agenteA, daOutra.id, 'CANCELADO')).status).toBe(404);
    expect((await prisma.agendamento.findUnique({ where: { id: daOutra.id } })).status).toBe('AGENDADO');
  });

  test('FALTA e CANCELADO SIMULTÂNEOS: só um vale, o outro dá 422', async () => {
    const ag = await criarNoBanco(psiA, maria, '2020-03-04T14:00', '2020-03-04T15:00');

    const respostas = await Promise.all([mudar(agenteA, ag.id, 'FALTA'), mudar(agenteA, ag.id, 'CANCELADO')]);

    expect(respostas.map((r) => r.status).sort()).toEqual([200, 422]);
    const vencedor = respostas.find((r) => r.status === 200).body.status;
    expect((await prisma.agendamento.findUnique({ where: { id: ag.id } })).status).toBe(vencedor);
  });
});

// A constraint do banco é a última barreira. Aqui o erro REAL do Postgres
// (provocado pelo repositório, sem a checagem do service) passa pelo
// errorHandler: tem que virar a resposta certa, sem vazar o detalhe da linha.
describe('errorHandler com as constraints da agenda', () => {
  function respostaFalsa() {
    const res = { headersSent: false };
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  }

  async function erroDe(promessa) {
    try {
      await promessa;
    } catch (erro) {
      return erro;
    }
    throw new Error('era esperado um erro do banco');
  }

  test('sobreposição (EXCLUDE): 409 genérico', async () => {
    await criarNoBanco(psiA, maria, '2030-03-04T14:00', '2030-03-04T15:00');
    const erro = await erroDe(
      agendamentosRepository.criar({
        psicologoId: psiA.id,
        pacienteId: joao.id,
        inicio: new Date(h('2030-03-04T14:30')),
        fim: new Date(h('2030-03-04T15:30')),
      }),
    );
    const res = respostaFalsa();

    errorHandler(erro, { id: 'req-teste-1' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ erro: 'Horário ocupado por outra sessão.' });

    // O log tem só requestId + nome da constraint — nada da linha recusada.
    expect(avisos).toHaveBeenCalledTimes(1);
    const linha = avisos.mock.calls[0][0];
    expect(JSON.parse(linha)).toMatchObject({
      requestId: 'req-teste-1',
      constraint: 'Agendamento_sem_sobreposicao_excl',
      status: 409,
    });
    expect(linha).not.toMatch(/tstzrange|2030|psicologoId|detail|conflito/);
  });

  test('fim antes do início (CHECK), também num update: 422 genérico', async () => {
    const ag = await criarNoBanco(psiA, maria, '2030-03-04T14:00', '2030-03-04T15:00');
    const erro = await erroDe(
      agendamentosRepository.remarcar(psiA.id, ag.id, {
        inicio: new Date(h('2030-03-04T15:00')),
        fim: new Date(h('2030-03-04T14:00')),
      }),
    );
    const res = respostaFalsa();

    errorHandler(erro, {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ erro: 'O fim da sessão deve ser depois do início.' });
  });
});
