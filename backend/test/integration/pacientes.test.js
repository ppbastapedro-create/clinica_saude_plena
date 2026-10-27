const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { sessionStore } = require('../../src/config/session');
const { emailUnico } = require('../helpers/emailUnico');

// Dados fictícios. Duas psicólogas para provar o isolamento: uma nunca
// enxerga nem altera paciente da outra.
const SENHA = 'senha-de-teste-pacientes';
const PSI_A = { nome: 'Psicóloga A (fictícia)', email: emailUnico('pacientes.a') };
const PSI_B = { nome: 'Psicóloga B (fictícia)', email: emailUnico('pacientes.b') };

// CPFs válidos só pela conta dos dígitos verificadores.
const CPF = {
  maria: '11144477735',
  joao: '52998224725',
  ana: '98765432100',
  livre: '39053344705',
};

let psiA;
let psiB;
let agenteA; // supertest.agent guarda o cookie de sessão entre requisições
let agenteB;

async function logar(email) {
  const agente = request.agent(app);
  const resposta = await agente.post('/auth/login').send({ email, senha: SENHA });
  expect(resposta.status).toBe(200);
  return agente;
}

// Apaga os pacientes entre um teste e outro: cada teste monta o que precisa.
// Sessões antes dos pacientes: a FK é RESTRICT.
async function limparPacientes() {
  const psicologoId = { in: [psiA.id, psiB.id] };
  await prisma.agendamento.deleteMany({ where: { psicologoId } });
  await prisma.paciente.deleteMany({ where: { psicologoId } });
}

const criar = (agente, dados) => agente.post('/pacientes').send(dados);

beforeAll(async () => {
  const senhaHash = await bcrypt.hash(SENHA, 4);
  psiA = await prisma.usuario.create({ data: { ...PSI_A, senhaHash } });
  psiB = await prisma.usuario.create({ data: { ...PSI_B, senhaHash } });
  agenteA = await logar(PSI_A.email);
  agenteB = await logar(PSI_B.email);
});

beforeEach(limparPacientes);

afterAll(async () => {
  const ids = [psiA.id, psiB.id];
  await limparPacientes();
  await prisma.$executeRaw`DELETE FROM "session" WHERE (sess -> 'usuario' ->> 'id')::int = ANY(${ids})`;
  await prisma.logAcesso.deleteMany({ where: { usuarioId: { in: ids } } }); // logs dos logins (FK RESTRICT)
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  sessionStore.close();
});

describe('acesso', () => {
  test.each([
    ['get', '/pacientes'],
    ['post', '/pacientes'],
    ['get', '/pacientes/1'],
    ['put', '/pacientes/1'],
    ['patch', '/pacientes/1/arquivar'],
    ['patch', '/pacientes/1/reativar'],
    ['get', '/pacientes/1/sessoes'],
  ])('sem login: %s %s dá 401', async (metodo, rota) => {
    const resposta = await request(app)[metodo](rota);
    expect(resposta.status).toBe(401);
  });

  test('não existe exclusão física: DELETE /pacientes/:id dá 404', async () => {
    const { body } = await criar(agenteA, { nome: 'Maria', cpf: CPF.maria });

    const resposta = await agenteA.delete(`/pacientes/${body.id}`);

    expect(resposta.status).toBe(404);
    expect(await prisma.paciente.count({ where: { id: body.id } })).toBe(1);
  });
});

describe('POST /pacientes', () => {
  test('cadastra: 201, CPF e telefone sem máscara, e-mail minúsculo', async () => {
    const resposta = await criar(agenteA, {
      nome: '  Maria Silva  ',
      cpf: '111.444.777-35',
      email: ' Maria.Silva@Exemplo.TEST ',
      telefone: '+55 (61) 99999-0000',
    });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toEqual({
      id: expect.any(Number),
      nome: 'Maria Silva',
      cpf: '11144477735',
      email: 'maria.silva@exemplo.test',
      telefone: '61999990000',
      valorSessao: null,
      receberLembrete: false,
      arquivadoEm: null,
      criadoEm: expect.any(String),
    });
  });

  test('e-mail e telefone são opcionais; em branco viram null', async () => {
    const resposta = await criar(agenteA, { nome: 'João', cpf: CPF.joao, email: '', telefone: '   ' });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({ email: null, telefone: null });
  });

  test('psicologoId e arquivadoEm do corpo são ignorados: o dono é quem está logado', async () => {
    const resposta = await criar(agenteA, {
      nome: 'Maria',
      cpf: CPF.maria,
      psicologoId: psiB.id,
      arquivadoEm: '2020-01-01T00:00:00Z',
    });

    expect(resposta.status).toBe(201);
    expect(resposta.body.arquivadoEm).toBeNull();
    const noBanco = await prisma.paciente.findUnique({ where: { id: resposta.body.id } });
    expect(noBanco.psicologoId).toBe(psiA.id);
  });

  test.each([
    ['CPF com dígito errado', { nome: 'Maria', cpf: '11144477736' }, 'cpf'],
    ['CPF com letras', { nome: 'Maria', cpf: 'abc111.444.777-35' }, 'cpf'],
    ['sem CPF', { nome: 'Maria' }, 'cpf'],
    ['sem nome', { cpf: CPF.maria }, 'nome'],
    ['nome de 1 letra', { nome: 'M', cpf: CPF.maria }, 'nome'],
    ['e-mail inválido', { nome: 'Maria', cpf: CPF.maria, email: 'maria@' }, 'email'],
    ['telefone sem DDD', { nome: 'Maria', cpf: CPF.maria, telefone: '99999-0000' }, 'telefone'],
    ['telefone com letras', { nome: 'Maria', cpf: CPF.maria, telefone: '61 9999A-0000' }, 'telefone'],
  ])('inválido (%s): 400 indicando o campo', async (_caso, dados, campo) => {
    const resposta = await criar(agenteA, dados);

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro).toBe('Dados inválidos');
    expect(resposta.body.campos[campo]).toEqual([expect.any(String)]);
  });

  test('CPF já cadastrado para a mesma psicóloga: 409, com ou sem máscara', async () => {
    const primeiro = await criar(agenteA, { nome: 'Maria', cpf: CPF.maria });

    const resposta = await criar(agenteA, { nome: 'Outra Maria', cpf: '111.444.777-35' });

    expect(resposta.status).toBe(409);
    expect(resposta.body).toEqual({ erro: 'Já existe um paciente com este CPF.', pacienteId: primeiro.body.id });
  });

  test('CPF de paciente arquivado: 409 sugerindo reativar', async () => {
    const { body } = await criar(agenteA, { nome: 'Maria', cpf: CPF.maria });
    await agenteA.patch(`/pacientes/${body.id}/arquivar`);

    const resposta = await criar(agenteA, { nome: 'Maria', cpf: CPF.maria });

    expect(resposta.status).toBe(409);
    expect(resposta.body.erro).toMatch(/arquivado.*Reative/);
  });

  // O CPF ser paciente de OUTRA psicóloga não pode transparecer de jeito
  // nenhum: nem 409, nem mensagem, nem id ou dado da outra no corpo. A
  // resposta da B tem que ser idêntica à de um CPF nunca cadastrado.
  test.each([
    ['ativo', false],
    ['arquivado', true],
  ])('CPF que é paciente %s da A: a B cadastra (201) e a resposta não traz nada da A', async (_caso, arquivar) => {
    const { body: daA } = await criar(agenteA, { nome: 'Maria da A', cpf: CPF.maria, email: 'maria.a@exemplo.test' });
    if (arquivar) await agenteA.patch(`/pacientes/${daA.id}/arquivar`);
    const daAAntes = await prisma.paciente.findUnique({ where: { id: daA.id } });

    const resposta = await criar(agenteB, { nome: 'Maria da B', cpf: CPF.maria });

    expect(resposta.status).toBe(201);
    // toEqual exige exatamente estas chaves: um `erro` ou `pacienteId` a mais falharia.
    expect(resposta.body).toEqual({
      id: expect.any(Number),
      nome: 'Maria da B',
      cpf: CPF.maria,
      email: null,
      telefone: null,
      valorSessao: null,
      receberLembrete: false,
      arquivadoEm: null,
      criadoEm: expect.any(String),
    });
    expect(resposta.body.id).not.toBe(daA.id);

    // E o paciente da A não foi tocado.
    expect(await prisma.paciente.findUnique({ where: { id: daA.id } })).toEqual(daAAntes);
  });
});

describe('GET /pacientes', () => {
  beforeEach(async () => {
    await criar(agenteA, { nome: 'Maria Silva', cpf: CPF.maria });
    await criar(agenteA, { nome: 'Ana Costa', cpf: CPF.ana });
    const { body: joao } = await criar(agenteA, { nome: 'João Pereira', cpf: CPF.joao });
    await agenteA.patch(`/pacientes/${joao.id}/arquivar`);
    await criar(agenteB, { nome: 'Paciente da B', cpf: CPF.livre });
  });

  const nomes = (resposta) => resposta.body.map((p) => p.nome);

  test('lista só os pacientes ativos da psicóloga logada, em ordem alfabética', async () => {
    const resposta = await agenteA.get('/pacientes');

    expect(resposta.status).toBe(200);
    expect(nomes(resposta)).toEqual(['Ana Costa', 'Maria Silva']);
  });

  test('situacao=arquivados e situacao=todos', async () => {
    expect(nomes(await agenteA.get('/pacientes?situacao=arquivados'))).toEqual(['João Pereira']);
    expect(nomes(await agenteA.get('/pacientes?situacao=todos'))).toEqual(['Ana Costa', 'João Pereira', 'Maria Silva']);
  });

  test('situacao desconhecida: 400', async () => {
    expect((await agenteA.get('/pacientes?situacao=excluidos')).status).toBe(400);
  });

  test('busca por parte do nome, sem diferenciar maiúsculas', async () => {
    expect(nomes(await agenteA.get('/pacientes?busca=SILVA'))).toEqual(['Maria Silva']);
  });

  test('busca pelo início do CPF, com ou sem máscara', async () => {
    expect(nomes(await agenteA.get('/pacientes?busca=987.654'))).toEqual(['Ana Costa']);
    expect(nomes(await agenteA.get('/pacientes?busca=987654'))).toEqual(['Ana Costa']);
  });

  test('busca não alcança paciente de outra psicóloga', async () => {
    expect(nomes(await agenteA.get('/pacientes?busca=Paciente da B'))).toEqual([]);
  });
});

describe('GET /pacientes/:id', () => {
  test('devolve o paciente', async () => {
    const { body } = await criar(agenteA, { nome: 'Maria', cpf: CPF.maria });

    const resposta = await agenteA.get(`/pacientes/${body.id}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual(body);
  });

  test('paciente de outra psicóloga: 404 (nem confirma que existe)', async () => {
    const { body } = await criar(agenteB, { nome: 'Paciente da B', cpf: CPF.livre });

    const resposta = await agenteA.get(`/pacientes/${body.id}`);

    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({ erro: 'Paciente não encontrado' });
  });

  test.each(['abc', '0', '-1', '1.5', '99999999999'])('id inválido (%s): 400', async (id) => {
    expect((await agenteA.get(`/pacientes/${id}`)).status).toBe(400);
  });
});

describe('PUT /pacientes/:id', () => {
  test('atualiza o cadastro inteiro; opcional omitido vira null', async () => {
    const { body } = await criar(agenteA, { nome: 'Maria', cpf: CPF.maria, email: 'maria@exemplo.test' });

    const resposta = await agenteA
      .put(`/pacientes/${body.id}`)
      .send({ nome: 'Maria Souza', cpf: CPF.maria, telefone: '(61) 3333-4444' });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ nome: 'Maria Souza', email: null, telefone: '6133334444' });
  });

  test('trocar para o CPF de outro paciente da mesma psicóloga: 409', async () => {
    await criar(agenteA, { nome: 'Maria', cpf: CPF.maria });
    const { body: joao } = await criar(agenteA, { nome: 'João', cpf: CPF.joao });

    const resposta = await agenteA.put(`/pacientes/${joao.id}`).send({ nome: 'João', cpf: CPF.maria });

    expect(resposta.status).toBe(409);
  });

  test('paciente de outra psicóloga: 404 e nada muda', async () => {
    const { body } = await criar(agenteB, { nome: 'Paciente da B', cpf: CPF.livre });

    const resposta = await agenteA.put(`/pacientes/${body.id}`).send({ nome: 'Alterado pela A', cpf: CPF.livre });

    expect(resposta.status).toBe(404);
    expect((await prisma.paciente.findUnique({ where: { id: body.id } })).nome).toBe('Paciente da B');
  });

  test('dados inválidos: 400', async () => {
    const { body } = await criar(agenteA, { nome: 'Maria', cpf: CPF.maria });
    expect((await agenteA.put(`/pacientes/${body.id}`).send({ nome: 'Maria', cpf: '123' })).status).toBe(400);
  });

  // A conversão "ausente → null" vale só para email e telefone. Os campos
  // que o PUT não edita são descartados pelo schema, mesmo que venham no
  // corpo — inclusive tentando zerar o arquivamento ou trocar o dono.
  test('paciente arquivado pode ser corrigido sem desarquivar nem mudar dono, id ou datas', async () => {
    const { body } = await criar(agenteA, { nome: 'Maria', cpf: CPF.maria });
    const { body: arquivado } = await agenteA.patch(`/pacientes/${body.id}/arquivar`);
    const antes = await prisma.paciente.findUnique({ where: { id: body.id } });

    const resposta = await agenteA.put(`/pacientes/${body.id}`).send({
      nome: 'Maria Corrigida',
      cpf: CPF.maria,
      arquivadoEm: null,
      criadoEm: '2000-01-01T00:00:00.000Z',
      psicologoId: psiB.id,
      id: body.id + 1000,
    });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({
      id: body.id,
      nome: 'Maria Corrigida',
      arquivadoEm: arquivado.arquivadoEm, // a mesma data, não só "não nulo"
      criadoEm: body.criadoEm,
    });

    const depois = await prisma.paciente.findUnique({ where: { id: body.id } });
    expect(depois.arquivadoEm).toEqual(antes.arquivadoEm);
    expect(depois.criadoEm).toEqual(antes.criadoEm);
    expect(depois.psicologoId).toBe(psiA.id);
    // Continua na lista de arquivados da A e fora da de ativos.
    expect((await agenteA.get('/pacientes?situacao=arquivados')).body.map((p) => p.id)).toEqual([body.id]);
    expect((await agenteA.get('/pacientes')).body).toEqual([]);
    // Nenhum paciente com o id "injetado" foi criado.
    expect(await prisma.paciente.findUnique({ where: { id: body.id + 1000 } })).toBeNull();
  });
});

describe('arquivar e reativar', () => {
  test('arquivar marca a data; reativar limpa', async () => {
    const { body } = await criar(agenteA, { nome: 'Maria', cpf: CPF.maria });

    const arquivado = await agenteA.patch(`/pacientes/${body.id}/arquivar`);
    expect(arquivado.status).toBe(200);
    expect(new Date(arquivado.body.arquivadoEm).getTime()).toBeLessThanOrEqual(Date.now());

    const reativado = await agenteA.patch(`/pacientes/${body.id}/reativar`);
    expect(reativado.status).toBe(200);
    expect(reativado.body.arquivadoEm).toBeNull();
  });

  test('arquivar de novo mantém a data original (idempotente)', async () => {
    const { body } = await criar(agenteA, { nome: 'Maria', cpf: CPF.maria });
    const primeiro = await agenteA.patch(`/pacientes/${body.id}/arquivar`);

    const segundo = await agenteA.patch(`/pacientes/${body.id}/arquivar`);

    expect(segundo.status).toBe(200);
    expect(segundo.body.arquivadoEm).toBe(primeiro.body.arquivadoEm);
  });

  test('paciente de outra psicóloga: 404 nos dois sentidos', async () => {
    const { body } = await criar(agenteB, { nome: 'Paciente da B', cpf: CPF.livre });

    expect((await agenteA.patch(`/pacientes/${body.id}/arquivar`)).status).toBe(404);
    expect((await agenteA.patch(`/pacientes/${body.id}/reativar`)).status).toBe(404);
    expect((await prisma.paciente.findUnique({ where: { id: body.id } })).arquivadoEm).toBeNull();
  });
});

// Opção (a), decidida pelo autor: arquivar fica bloqueado (422) enquanto
// houver sessão AGENDADO com início no futuro.
describe('arquivar com sessões na agenda', () => {
  const h = (dataHora) => new Date(`${dataHora}:00-03:00`);
  const sessao = (paciente, inicio, fim, status = 'AGENDADO') =>
    prisma.agendamento.create({
      data: { psicologoId: psiA.id, pacienteId: paciente.id, inicio: h(inicio), fim: h(fim), status },
    });
  const arquivar = (paciente) => agenteA.patch(`/pacientes/${paciente.id}/arquivar`);
  const arquivadoEm = async (paciente) =>
    (await prisma.paciente.findUnique({ where: { id: paciente.id } })).arquivadoEm;

  let maria;
  beforeEach(async () => {
    maria = (await criar(agenteA, { nome: 'Maria', cpf: CPF.maria })).body;
  });

  test('sessão AGENDADO futura: 422 listando as datas, e o paciente não é arquivado', async () => {
    const s1 = await sessao(maria, '2030-03-04T14:00', '2030-03-04T14:50');
    const s2 = await sessao(maria, '2030-03-11T14:00', '2030-03-11T14:50');

    const resposta = await arquivar(maria);

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro).toBe(
      'Há 2 sessões agendadas para este paciente: 04/03/2030, 14:00; 11/03/2030, 14:00. Cancele-as antes de arquivar.',
    );
    expect(resposta.body.sessoesFuturas.map((s) => s.id)).toEqual([s1.id, s2.id]);
    expect(await arquivadoEm(maria)).toBeNull();
  });

  test('muitas sessões futuras: a mensagem lista 5 e resume o resto', async () => {
    for (let dia = 1; dia <= 7; dia++) {
      const d = String(dia).padStart(2, '0');
      await sessao(maria, `2030-04-${d}T14:00`, `2030-04-${d}T14:50`);
    }

    const resposta = await arquivar(maria);

    expect(resposta.status).toBe(422);
    expect(resposta.body.erro).toMatch(/^Há 7 sessões agendadas .* 05\/04\/2030, 14:00 e mais 2\. Cancele-as/);
    expect(resposta.body.sessoesFuturas).toHaveLength(7);
  });

  test.each(['CANCELADO'])('sessão futura %s não bloqueia', async (status) => {
    await sessao(maria, '2030-03-04T14:00', '2030-03-04T14:50', status);

    expect((await arquivar(maria)).status).toBe(200);
  });

  test('cancelando as sessões futuras, o arquivamento passa', async () => {
    const futura = await sessao(maria, '2030-03-04T14:00', '2030-03-04T14:50');
    expect((await arquivar(maria)).status).toBe(422);

    expect((await agenteA.patch(`/agendamentos/${futura.id}/status`).send({ status: 'CANCELADO' })).status).toBe(200);

    expect((await arquivar(maria)).status).toBe(200);
  });

  // A pergunta do autor: com (a), sessões antigas pendentes ainda podem ser
  // fechadas depois do arquivamento? Sim — e este teste garante que continue assim.
  test('só sessões PASSADAS pendentes: arquiva, e elas continuam podendo ser fechadas', async () => {
    const pendentes = await Promise.all([
      sessao(maria, '2020-03-02T14:00', '2020-03-02T14:50'),
      sessao(maria, '2020-03-09T14:00', '2020-03-09T14:50'),
      sessao(maria, '2020-03-16T14:00', '2020-03-16T14:50'),
    ]);

    expect((await arquivar(maria)).status).toBe(200);

    const fechar = (s, status) => agenteA.patch(`/agendamentos/${s.id}/status`).send({ status });
    expect((await fechar(pendentes[0], 'REALIZADO')).status).toBe(200);
    expect((await fechar(pendentes[1], 'FALTA')).status).toBe(200);
    expect((await fechar(pendentes[2], 'CANCELADO')).status).toBe(200);
    expect(await arquivadoEm(maria)).not.toBeNull();
  });

  test('sessões de OUTRO paciente não bloqueiam', async () => {
    const joao = (await criar(agenteA, { nome: 'João', cpf: CPF.joao })).body;
    await sessao(joao, '2030-03-04T14:00', '2030-03-04T14:50');

    expect((await arquivar(maria)).status).toBe(200);
  });

  // A conferência e o arquivamento são atômicos (mesma transação + linha do
  // paciente travada): nunca sobra paciente arquivado com sessão futura,
  // seja qual for a ordem em que as duas requisições chegarem ao banco.
  test('arquivar e marcar sessão futura AO MESMO TEMPO: só um dos dois vale, nunca os dois', async () => {
    for (let rodada = 0; rodada < 8; rodada++) {
      await prisma.agendamento.deleteMany({ where: { pacienteId: maria.id } });
      await prisma.paciente.update({ where: { id: maria.id }, data: { arquivadoEm: null } });

      const [arquivamento, marcacao] = await Promise.all([
        arquivar(maria),
        agenteA.post('/agendamentos').send({
          pacienteId: maria.id,
          inicio: '2030-05-06T14:00:00-03:00',
          fim: '2030-05-06T14:50:00-03:00',
        }),
      ]);

      const venceu = { arquivou: arquivamento.status === 200, marcou: marcacao.status === 201 };
      expect(venceu.arquivou !== venceu.marcou).toBe(true); // exatamente um
      expect((venceu.arquivou ? marcacao : arquivamento).status).toBe(422);

      const futuras = await prisma.agendamento.count({
        where: { pacienteId: maria.id, status: 'AGENDADO', inicio: { gt: new Date() } },
      });
      expect({ arquivado: (await arquivadoEm(maria)) !== null, futuras }).toEqual(
        venceu.arquivou ? { arquivado: true, futuras: 0 } : { arquivado: false, futuras: 1 },
      );
    }
  });

  // Mesmo formato, agora com remarcação: uma sessão PASSADA pendente (que não
  // bloqueia o arquivamento) sendo levada para o futuro ao mesmo tempo em que
  // o paciente é arquivado. A remarcação trava o paciente (FOR SHARE) e
  // confere arquivadoEm antes de gravar.
  test('arquivar e remarcar sessão para o futuro AO MESMO TEMPO: só um dos dois vale, nunca os dois', async () => {
    for (let rodada = 0; rodada < 8; rodada++) {
      await prisma.agendamento.deleteMany({ where: { pacienteId: maria.id } });
      await prisma.paciente.update({ where: { id: maria.id }, data: { arquivadoEm: null } });
      const pendente = await sessao(maria, '2020-03-02T14:00', '2020-03-02T14:50');

      const [arquivamento, remarcacao] = await Promise.all([
        arquivar(maria),
        agenteA.put(`/agendamentos/${pendente.id}`).send({
          inicio: '2030-05-06T14:00:00-03:00',
          fim: '2030-05-06T14:50:00-03:00',
        }),
      ]);

      const venceu = { arquivou: arquivamento.status === 200, remarcou: remarcacao.status === 200 };
      expect(venceu.arquivou !== venceu.remarcou).toBe(true); // exatamente um
      expect((venceu.arquivou ? remarcacao : arquivamento).status).toBe(422);

      const futuras = await prisma.agendamento.count({
        where: { pacienteId: maria.id, status: 'AGENDADO', inicio: { gt: new Date() } },
      });
      expect({ arquivado: (await arquivadoEm(maria)) !== null, futuras }).toEqual(
        venceu.arquivou ? { arquivado: true, futuras: 0 } : { arquivado: false, futuras: 1 },
      );
    }
  });
});

// Histórico de sessões da ficha do paciente.
describe('GET /pacientes/:id/sessoes', () => {
  const h = (dataHora) => new Date(`${dataHora}:00-03:00`);
  const sessao = (psicologo, paciente, inicio, fim, status = 'AGENDADO') =>
    prisma.agendamento.create({
      data: { psicologoId: psicologo.id, pacienteId: paciente.id, inicio: h(inicio), fim: h(fim), status },
    });

  test('todas as sessões do paciente, mais recente primeiro, com as canceladas e sem as de outros pacientes', async () => {
    const maria = (await criar(agenteA, { nome: 'Maria', cpf: CPF.maria })).body;
    const joao = (await criar(agenteA, { nome: 'João', cpf: CPF.joao })).body;
    await sessao(psiA, maria, '2020-03-02T14:00', '2020-03-02T14:50', 'REALIZADO');
    await sessao(psiA, maria, '2030-03-04T14:00', '2030-03-04T14:50');
    await sessao(psiA, maria, '2025-06-10T09:00', '2025-06-10T09:50', 'CANCELADO');
    await sessao(psiA, joao, '2025-06-11T09:00', '2025-06-11T09:50');

    const resposta = await agenteA.get(`/pacientes/${maria.id}/sessoes`);

    expect(resposta.status).toBe(200);
    expect(resposta.body.map((s) => `${s.inicio} ${s.status}`)).toEqual([
      '2030-03-04T17:00:00.000Z AGENDADO',
      '2025-06-10T12:00:00.000Z CANCELADO',
      '2020-03-02T17:00:00.000Z REALIZADO',
    ]);
    // Mesmo formato do resto da agenda: paciente só com id e nome.
    expect(resposta.body[0]).toEqual({
      id: expect.any(Number),
      inicio: '2030-03-04T17:00:00.000Z',
      fim: '2030-03-04T17:50:00.000Z',
      status: 'AGENDADO',
      paciente: { id: maria.id, nome: 'Maria' },
      temRegistro: false,
      valor: null,
      cobrar: null,
      cobravel: false,
      lembreteEnviadoEm: null,
      criadoEm: expect.any(String),
    });
  });

  test('paciente sem sessões: lista vazia', async () => {
    const maria = (await criar(agenteA, { nome: 'Maria', cpf: CPF.maria })).body;

    expect((await agenteA.get(`/pacientes/${maria.id}/sessoes`)).body).toEqual([]);
  });

  test('paciente de outra psicóloga ou inexistente: 404', async () => {
    const daB = (await criar(agenteB, { nome: 'Paciente da B', cpf: CPF.livre })).body;
    await sessao(psiB, daB, '2030-03-04T14:00', '2030-03-04T14:50');

    expect((await agenteA.get(`/pacientes/${daB.id}/sessoes`)).status).toBe(404);
    expect((await agenteA.get('/pacientes/999999999/sessoes')).status).toBe(404);
  });
});
