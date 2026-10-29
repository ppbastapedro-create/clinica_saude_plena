const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { sessionStore } = require('../../src/config/session');
const { emailUnico } = require('../helpers/emailUnico');

// Termo de consentimento LGPD do paciente (escopo da EAP). Dados fictícios.
const SENHA = 'senha-de-teste-consentimento';
const PSI_A = { nome: 'Psicóloga Consentimento A (fictícia)', email: emailUnico('consentimento.a') };
const PSI_B = { nome: 'Psicóloga Consentimento B (fictícia)', email: emailUnico('consentimento.b') };

const iso = (dataHora) => `${dataHora}:00-03:00`;

let psiA;
let psiB;
let agenteA;
let agenteB;

const CPFS = ['11144477735', '52998224725', '39053344705'];
let proximoCpf = 0;
const criarPaciente = (dados = {}) =>
  prisma.paciente.create({ data: { psicologoId: psiA.id, nome: 'Paciente Consentimento (fictício)', cpf: CPFS[proximoCpf++], ...dados } });

const url = (p, sufixo = '') => `/pacientes/${p.id}/consentimentos${sufixo}`;

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

async function limpar() {
  const psicologoId = { in: [psiA.id, psiB.id] };
  await prisma.consentimento.deleteMany({ where: { paciente: { psicologoId } } });
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

describe('registrar o aceite', () => {
  test('paciente novo: sem histórico, e a ficha diz que não há consentimento vigente', async () => {
    const p = await criarPaciente();

    expect((await agenteA.get(url(p))).body).toEqual({ versaoAtual: 'v1', vigente: null, historico: [] });
    expect((await agenteA.get(`/pacientes/${p.id}`)).body.consentimentoVigente).toBe(false);
  });

  test('registra com a versão atual do termo e a data de agora (201)', async () => {
    const p = await criarPaciente();
    const antes = Date.now();

    const resposta = await agenteA.post(url(p)).send({});

    expect(resposta.status).toBe(201);
    expect(resposta.body).toEqual({ id: expect.any(Number), versaoTermo: 'v1', aceitoEm: expect.any(String), revogadoEm: null });
    expect(new Date(resposta.body.aceitoEm).getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect((await agenteA.get(`/pacientes/${p.id}`)).body.consentimentoVigente).toBe(true);
  });

  test('termo assinado em papel dias antes: aceita a data no passado', async () => {
    const p = await criarPaciente();

    const resposta = await agenteA.post(url(p)).send({ aceitoEm: iso('2026-10-01T12:00') });

    expect(resposta.status).toBe(201);
    expect(resposta.body.aceitoEm).toBe('2026-10-01T15:00:00.000Z');
  });

  test('data no futuro: 400 no campo aceitoEm', async () => {
    const p = await criarPaciente();

    const resposta = await agenteA.post(url(p)).send({ aceitoEm: iso('2099-01-01T12:00') });

    expect(resposta.status).toBe(400);
    expect(resposta.body.campos.aceitoEm).toEqual(['A data da assinatura não pode estar no futuro']);
  });

  test('a versão do termo não vem do cliente: um versaoTermo no corpo é ignorado', async () => {
    const p = await criarPaciente();

    expect((await agenteA.post(url(p)).send({ versaoTermo: 'v999' })).body.versaoTermo).toBe('v1');
  });

  test('já existe um vigente: 422, e continua um só', async () => {
    const p = await criarPaciente();
    await agenteA.post(url(p)).send({ aceitoEm: iso('2026-10-01T12:00') });

    const resposta = await agenteA.post(url(p)).send({});

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro).toBe('Já existe um consentimento vigente (termo v1, aceito em 01/10/2026).');
    expect(await prisma.consentimento.count({ where: { pacienteId: p.id } })).toBe(1);
  });

  test('dois registros simultâneos: um passa, o outro dá 422 (a linha do paciente fica travada)', async () => {
    const p = await criarPaciente();

    const status = (await Promise.all([agenteA.post(url(p)).send({}), agenteA.post(url(p)).send({})])).map((r) => r.status);

    expect(status.sort()).toEqual([201, 422]);
    expect(await prisma.consentimento.count({ where: { pacienteId: p.id, revogadoEm: null } })).toBe(1);
  });

  test('paciente arquivado: 422 (não está em acompanhamento)', async () => {
    const p = await criarPaciente({ arquivadoEm: new Date() });

    const resposta = await agenteA.post(url(p)).send({});

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro).toMatch(/Reative o cadastro/);
  });
});

describe('revogar', () => {
  test('marca a revogação, desliga o lembrete e mantém o aceite no histórico', async () => {
    const p = await criarPaciente({ email: 'revoga@exemplo.test', receberLembrete: true });
    await agenteA.post(url(p)).send({ aceitoEm: iso('2026-10-01T12:00') });

    const resposta = await agenteA.patch(url(p, '/revogar'));

    expect(resposta.status).toBe(200);
    expect(resposta.body.revogadoEm).toEqual(expect.any(String));
    const ficha = (await agenteA.get(`/pacientes/${p.id}`)).body;
    expect(ficha.consentimentoVigente).toBe(false);
    expect(ficha.receberLembrete).toBe(false);
    const { historico, vigente } = (await agenteA.get(url(p))).body;
    expect(vigente).toBeNull();
    expect(historico).toHaveLength(1);
    expect(historico[0].aceitoEm).toBe('2026-10-01T15:00:00.000Z');
  });

  test('sem consentimento vigente: 422', async () => {
    const p = await criarPaciente();

    const resposta = await agenteA.patch(url(p, '/revogar'));

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro).toBe('Este paciente não tem consentimento vigente para revogar.');
  });

  test('paciente arquivado também pode revogar (direito do titular a qualquer momento)', async () => {
    const p = await criarPaciente();
    await agenteA.post(url(p)).send({});
    await prisma.paciente.update({ where: { id: p.id }, data: { arquivadoEm: new Date() } });

    expect((await agenteA.patch(url(p, '/revogar'))).status).toBe(200);
  });

  test('depois de revogar, um novo aceite pode ser registrado; o histórico guarda os dois', async () => {
    const p = await criarPaciente();
    await agenteA.post(url(p)).send({ aceitoEm: iso('2026-09-01T12:00') });
    await agenteA.patch(url(p, '/revogar'));

    expect((await agenteA.post(url(p)).send({})).status).toBe(201);

    const { historico, vigente } = (await agenteA.get(url(p))).body;
    expect(historico).toHaveLength(2);
    expect(historico[0].revogadoEm).toBeNull(); // mais recente primeiro
    expect(historico[1].revogadoEm).toEqual(expect.any(String));
    expect(vigente.id).toBe(historico[0].id);
  });
});

test('a versão registrada é a mesma impressa no modelo do termo (mudou um, mude o outro)', () => {
  const fs = require('fs');
  const path = require('path');
  const { VERSAO_TERMO_ATUAL } = require('../../src/services/consentimentos.service');
  const modelo = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'frontend', 'termo-consentimento.html'), 'utf8');

  expect(modelo).toContain(`versão ${VERSAO_TERMO_ATUAL} `);
});

describe('isolamento entre psicólogas', () => {
  test.each([
    ['get', ''],
    ['post', ''],
    ['patch', '/revogar'],
  ])('B não vê nem altera o consentimento de paciente da A (%s → 404)', async (metodo, sufixo) => {
    const p = await criarPaciente();
    await agenteA.post(url(p)).send({});

    const resposta = await agenteB[metodo](url(p, sufixo)).send({});

    expect(resposta.status).toBe(404);
    expect(await prisma.consentimento.count({ where: { pacienteId: p.id, revogadoEm: null } })).toBe(1);
  });
});
