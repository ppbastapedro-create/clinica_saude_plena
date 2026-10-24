const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { sessionStore } = require('../../src/config/session');
const { MAX_CARACTERES } = require('../../src/controllers/registros.controller');
const { emailUnico } = require('../helpers/emailUnico');

// Dados fictícios. Duas psicólogas para provar o isolamento.
const SENHA = 'senha-de-teste-registros';
const PSI_A = { nome: 'Psicóloga Registro A (fictícia)', email: emailUnico('registro.a') };
const PSI_B = { nome: 'Psicóloga Registro B (fictícia)', email: emailUnico('registro.b') };
const TEXTO = 'Paciente relata melhora do sono.\n  - Retomar exercício de respiração na próxima sessão. 🙂';

let psiA;
let psiB;
let agenteA;
let agenteB;
let pacienteA;
let pacienteB;

const h = (dataHora) => new Date(`${dataHora}:00-03:00`);
let minuto = 0;
// Cada sessão num horário diferente (a agenda não aceita sobreposição).
const sessao = (psicologo, paciente, status = 'REALIZADO') => {
  minuto += 60;
  const inicio = new Date(h('2020-01-06T08:00').getTime() + minuto * 60_000);
  return prisma.agendamento.create({
    data: { psicologoId: psicologo.id, pacienteId: paciente.id, inicio, fim: new Date(inicio.getTime() + 50 * 60_000), status },
  });
};

const gravar = (agente, id, conteudo) => agente.put(`/agendamentos/${id}/registro`).send({ conteudo });
const ler = (agente, id) => agente.get(`/agendamentos/${id}/registro`);
const logsDa = (agendamentoId) =>
  prisma.logAcesso.findMany({ where: { agendamentoId }, orderBy: { id: 'asc' }, select: { acao: true, usuarioId: true } });

async function logar(email) {
  const agente = request.agent(app);
  expect((await agente.post('/auth/login').send({ email, senha: SENHA })).status).toBe(200);
  return agente;
}

beforeAll(async () => {
  const senhaHash = await bcrypt.hash(SENHA, 4);
  psiA = await prisma.usuario.create({ data: { ...PSI_A, senhaHash } });
  psiB = await prisma.usuario.create({ data: { ...PSI_B, senhaHash } });
  pacienteA = await prisma.paciente.create({ data: { psicologoId: psiA.id, nome: 'Paciente A (fictício)', cpf: '11144477735' } });
  pacienteB = await prisma.paciente.create({ data: { psicologoId: psiB.id, nome: 'Paciente B (fictício)', cpf: '52998224725' } });
  agenteA = await logar(PSI_A.email);
  agenteB = await logar(PSI_B.email);
});

afterAll(async () => {
  const ids = [psiA.id, psiB.id];
  // Ordem: todas as FKs são RESTRICT (logs e registros apontam para o agendamento).
  await prisma.logAcesso.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.registroSessao.deleteMany({ where: { agendamento: { psicologoId: { in: ids } } } });
  await prisma.agendamento.deleteMany({ where: { psicologoId: { in: ids } } });
  await prisma.paciente.deleteMany({ where: { psicologoId: { in: ids } } });
  await prisma.$executeRaw`DELETE FROM "session" WHERE (sess -> 'usuario' ->> 'id')::int = ANY(${ids})`;
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  sessionStore.close();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('acesso', () => {
  test.each([
    ['get', '/agendamentos/1/registro'],
    ['put', '/agendamentos/1/registro'],
  ])('sem login: %s %s dá 401', async (metodo, rota) => {
    expect((await request(app)[metodo](rota)).status).toBe(401);
  });

  test('sessão de outra psicóloga: 404 para ler e para gravar, e nada é registrado no log', async () => {
    const daB = await sessao(psiB, pacienteB);
    await gravar(agenteB, daB.id, TEXTO);
    const logsAntes = await logsDa(daB.id);

    expect((await ler(agenteA, daB.id)).status).toBe(404);
    expect((await gravar(agenteA, daB.id, 'tentativa da A')).status).toBe(404);

    expect(await logsDa(daB.id)).toEqual(logsAntes);
    expect((await ler(agenteB, daB.id)).body.conteudo).toBe(TEXTO); // conteúdo da B intacto
  });
});

describe('gravar e ler', () => {
  test('cria (201) e lê de volta o texto idêntico, com acentos, quebras de linha e emoji', async () => {
    const s = await sessao(psiA, pacienteA);

    const criado = await gravar(agenteA, s.id, TEXTO);
    expect(criado.status).toBe(201);
    expect(criado.body).toEqual({
      agendamentoId: s.id,
      conteudo: TEXTO,
      criadoEm: expect.any(String),
      atualizadoEm: expect.any(String),
    });

    const lido = await ler(agenteA, s.id);
    expect(lido.status).toBe(200);
    expect(lido.body.conteudo).toBe(TEXTO);
  });

  // A tela usa temRegistro para decidir entre "Escrever" e "Abrir" sem ler o
  // registro — ler grava LEITURA_SESSAO, e só abrir de fato deve deixar rastro.
  test('temRegistro no agendamento reflete o registro sem gerar log de leitura', async () => {
    const s = await sessao(psiA, pacienteA);
    expect((await agenteA.get(`/agendamentos/${s.id}`)).body.temRegistro).toBe(false);

    await gravar(agenteA, s.id, TEXTO);
    const logsAntes = await logsDa(s.id);

    const resposta = await agenteA.get(`/agendamentos/${s.id}`);
    expect(resposta.body.temRegistro).toBe(true);
    expect(resposta.body).not.toHaveProperty('conteudo');
    expect(await logsDa(s.id)).toEqual(logsAntes);
  });

  test('no banco fica só o cifrado: o texto não aparece em nenhuma coluna', async () => {
    const s = await sessao(psiA, pacienteA);
    await gravar(agenteA, s.id, TEXTO);

    const linha = await prisma.registroSessao.findUnique({ where: { agendamentoId: s.id } });
    expect(Buffer.from(linha.iv)).toHaveLength(12);
    expect(Buffer.from(linha.authTag)).toHaveLength(16);
    expect(linha.versaoChave).toBe(1);

    // Procura pedaços do texto dentro da linha inteira, direto no Postgres.
    for (const trecho of ['Paciente', 'sono', 'respiração']) {
      const [{ achou }] = await prisma.$queryRaw`
        SELECT (position(convert_to(${trecho}, 'UTF8') IN r."conteudoCifrado") > 0
                OR r::text ILIKE ${`%${trecho}%`}) AS achou
        FROM "RegistroSessao" r WHERE r."agendamentoId" = ${s.id}`;
      expect(achou).toBe(false);
    }
  });

  test('atualizar substitui o conteúdo (200), com IV novo e atualizadoEm avançando', async () => {
    const s = await sessao(psiA, pacienteA);
    await gravar(agenteA, s.id, TEXTO);
    const antes = await prisma.registroSessao.findUnique({ where: { agendamentoId: s.id } });

    const atualizado = await gravar(agenteA, s.id, 'Texto revisado (fictício).');

    expect(atualizado.status).toBe(200);
    expect((await ler(agenteA, s.id)).body.conteudo).toBe('Texto revisado (fictício).');
    const depois = await prisma.registroSessao.findUnique({ where: { agendamentoId: s.id } });
    expect(Buffer.from(depois.iv).equals(Buffer.from(antes.iv))).toBe(false);
    expect(depois.criadoEm).toEqual(antes.criadoEm);
    expect(depois.atualizadoEm.getTime()).toBeGreaterThan(antes.atualizadoEm.getTime());
  });

  test('sessão sem registro: 404 e nenhuma leitura registrada', async () => {
    const s = await sessao(psiA, pacienteA);

    const resposta = await ler(agenteA, s.id);

    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({ erro: 'Esta sessão ainda não tem registro.' });
    expect(await logsDa(s.id)).toEqual([]);
  });

  test('respostas do registro não podem ir para o cache do navegador', async () => {
    const s = await sessao(psiA, pacienteA);

    expect((await gravar(agenteA, s.id, TEXTO)).headers['cache-control']).toBe('no-store');
    expect((await ler(agenteA, s.id)).headers['cache-control']).toBe('no-store');
  });
});

describe('regras', () => {
  test.each(['AGENDADO', 'FALTA', 'CANCELADO'])('sessão %s não recebe registro: 422 e nada é gravado', async (status) => {
    const s = await sessao(psiA, pacienteA, status);

    const resposta = await gravar(agenteA, s.id, TEXTO);

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro).toMatch(new RegExp(`está ${status}`));
    expect(await prisma.registroSessao.count({ where: { agendamentoId: s.id } })).toBe(0);
  });

  test.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['só espaços e quebras', '  \n\t '],
    ['número', 123],
    ['acima do limite', 'x'.repeat(MAX_CARACTERES + 1)],
  ])('conteúdo %s: 400', async (_caso, conteudo) => {
    const s = await sessao(psiA, pacienteA);

    const resposta = await gravar(agenteA, s.id, conteudo);

    expect(resposta.status).toBe(400);
    expect(resposta.body.campos.conteudo).toEqual([expect.any(String)]);
  });

  test('exatamente no limite de caracteres: aceito', async () => {
    const s = await sessao(psiA, pacienteA);
    expect((await gravar(agenteA, s.id, 'x'.repeat(MAX_CARACTERES))).status).toBe(201);
  });
});

describe('auditoria (LogAcesso)', () => {
  test('cada gravação registra ESCRITA_SESSAO e cada leitura LEITURA_SESSAO, com usuária e sessão', async () => {
    const s = await sessao(psiA, pacienteA);

    await gravar(agenteA, s.id, TEXTO);
    await ler(agenteA, s.id);
    await gravar(agenteA, s.id, 'revisão');
    await ler(agenteA, s.id);

    expect(await logsDa(s.id)).toEqual([
      { acao: 'ESCRITA_SESSAO', usuarioId: psiA.id },
      { acao: 'LEITURA_SESSAO', usuarioId: psiA.id },
      { acao: 'ESCRITA_SESSAO', usuarioId: psiA.id },
      { acao: 'LEITURA_SESSAO', usuarioId: psiA.id },
    ]);
  });

  test('gravação recusada (422) ou inválida (400) não registra nada', async () => {
    const agendada = await sessao(psiA, pacienteA, 'AGENDADO');
    const realizada = await sessao(psiA, pacienteA);

    await gravar(agenteA, agendada.id, TEXTO);
    await gravar(agenteA, realizada.id, '');

    expect(await logsDa(agendada.id)).toEqual([]);
    expect(await logsDa(realizada.id)).toEqual([]);
  });
});

// Alguém com acesso ao banco copia o cifrado de uma sessão para outra. A
// decifragem tem que falhar (AAD = id da sessão) sem vazar nada.
describe('adulteração no banco', () => {
  test('registro copiado para outra sessão: 500 genérico, sem conteúdo, e a tentativa fica no log', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const origem = await sessao(psiA, pacienteA);
    const destino = await sessao(psiA, pacienteA);
    await gravar(agenteA, origem.id, TEXTO);
    const cifrado = await prisma.registroSessao.findUnique({ where: { agendamentoId: origem.id } });
    await prisma.registroSessao.create({
      data: {
        agendamentoId: destino.id,
        conteudoCifrado: cifrado.conteudoCifrado,
        iv: cifrado.iv,
        authTag: cifrado.authTag,
        versaoChave: cifrado.versaoChave,
      },
    });

    const resposta = await ler(agenteA, destino.id);

    expect(resposta.status).toBe(500);
    expect(resposta.body).toEqual({ erro: 'Erro interno do servidor', requestId: expect.any(String) });
    expect(JSON.stringify(resposta.body)).not.toMatch(/Paciente|sono/);
    expect(await logsDa(destino.id)).toEqual([{ acao: 'LEITURA_SESSAO', usuarioId: psiA.id }]);
    // O registro original continua legível.
    expect((await ler(agenteA, origem.id)).body.conteudo).toBe(TEXTO);
  });

  test('um byte do cifrado alterado no banco: 500, nunca texto adulterado', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const s = await sessao(psiA, pacienteA);
    await gravar(agenteA, s.id, TEXTO);
    await prisma.$executeRaw`
      UPDATE "RegistroSessao"
      SET "conteudoCifrado" = set_byte("conteudoCifrado", 0, get_byte("conteudoCifrado", 0) # 1)
      WHERE "agendamentoId" = ${s.id}`;

    const resposta = await ler(agenteA, s.id);

    expect(resposta.status).toBe(500);
    expect(resposta.body).not.toHaveProperty('conteudo');
  });
});
