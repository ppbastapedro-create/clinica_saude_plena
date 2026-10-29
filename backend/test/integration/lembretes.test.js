const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../src/app');
const prisma = require('../../src/config/prisma');
const { sessionStore } = require('../../src/config/session');
const lembretesService = require('../../src/services/lembretes.service');
const { emailUnico } = require('../helpers/emailUnico');

// Lembrete de sessão por e-mail (pacote 1.4.8). Dados fictícios.
//
// O "agora" é fixo em 2031: as sessões deste arquivo ficam longe das dos
// outros testes, que rodam em paralelo no mesmo banco. E nenhum e-mail sai:
// o transporte é um falso que só guarda as mensagens.
const SENHA = 'senha-de-teste-lembretes';
const PSI_A = { nome: 'Psicóloga Lembretes A (fictícia)', email: emailUnico('lembretes.a') };
const PSI_INATIVA = { nome: 'Psicóloga Lembretes Inativa (fictícia)', email: emailUnico('lembretes.inativa'), ativo: false };

const h = (dataHora) => new Date(`${dataHora}:00-03:00`);
const AGORA = h('2031-01-10T12:00'); // sexta-feira, meio-dia

let psiA;
let psiInativa;
let agenteA;

const CPFS = ['11144477735', '52998224725', '39053344705', '98765432100', '27182818205'];
let proximoCpf = 0;
const criarPaciente = (psicologo, dados = {}) =>
  prisma.paciente.create({
    data: {
      psicologoId: psicologo.id,
      nome: 'Maria Clara Souza (fictícia)',
      cpf: CPFS[proximoCpf++],
      email: 'maria.clara@exemplo.test',
      receberLembrete: true,
      // Consentimento LGPD vigente: sem ele, nada é enviado (teste próprio abaixo).
      consentimentos: { create: { versaoTermo: 'v1', aceitoEm: h('2031-01-01T10:00') } },
      ...dados,
    },
  });

const sessao = (paciente, inicio, extra = {}) =>
  prisma.agendamento.create({
    data: {
      psicologoId: paciente.psicologoId,
      pacienteId: paciente.id,
      inicio: h(inicio),
      fim: new Date(h(inicio).getTime() + 50 * 60_000),
      ...extra,
    },
  });

// Transporte falso: guarda as mensagens. `falharPara`: e-mails que dão erro.
function transporteFalso({ falharPara = [], aoEnviar } = {}) {
  const enviadas = [];
  return {
    enviadas,
    async sendMail(mensagem) {
      if (falharPara.includes(mensagem.to)) {
        // Como o Nodemailer: a mensagem do erro repete o destinatário.
        throw Object.assign(new Error(`<${mensagem.to}>: Recipient address rejected`), { code: 'EENVELOPE', responseCode: 550 });
      }
      if (aoEnviar) await aoEnviar(mensagem);
      enviadas.push(mensagem);
    },
  };
}

const enviar = (transporte, opcoes = {}) => lembretesService.enviarPendentes({ agora: AGORA, antecedenciaHoras: 24, transporte, ...opcoes });
const lembreteDe = async (ag) => (await prisma.agendamento.findUnique({ where: { id: ag.id } })).lembreteEnviadoEm;

beforeAll(async () => {
  const senhaHash = await bcrypt.hash(SENHA, 4);
  psiA = await prisma.usuario.create({ data: { ...PSI_A, senhaHash } });
  psiInativa = await prisma.usuario.create({ data: { ...PSI_INATIVA, senhaHash } });
  agenteA = request.agent(app);
  expect((await agenteA.post('/auth/login').send({ email: PSI_A.email, senha: SENHA })).status).toBe(200);
});

async function limpar() {
  const psicologoId = { in: [psiA.id, psiInativa.id] };
  await prisma.agendamento.deleteMany({ where: { psicologoId } });
  await prisma.consentimento.deleteMany({ where: { paciente: { psicologoId } } });
  await prisma.paciente.deleteMany({ where: { psicologoId } });
  proximoCpf = 0;
}
beforeEach(limpar);

afterAll(async () => {
  const ids = [psiA.id, psiInativa.id];
  await limpar();
  await prisma.$executeRaw`DELETE FROM "session" WHERE (sess -> 'usuario' ->> 'id')::int = ANY(${ids})`;
  await prisma.logAcesso.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  sessionStore.close();
});

describe('opt-in no cadastro do paciente', () => {
  test('cadastra com receberLembrete e e-mail: 201', async () => {
    const resposta = await agenteA
      .post('/pacientes')
      .send({ nome: 'Paciente Opt-in', cpf: CPFS[0], email: 'optin@exemplo.test', receberLembrete: true });

    expect(resposta.status).toBe(201);
    expect(resposta.body.receberLembrete).toBe(true);
  });

  test('receberLembrete sem e-mail: 400 no campo receberLembrete', async () => {
    const resposta = await agenteA.post('/pacientes').send({ nome: 'Paciente Sem E-mail', cpf: CPFS[0], receberLembrete: true });

    expect(resposta.status).toBe(400);
    expect(resposta.body.campos.receberLembrete).toEqual(['Para receber lembrete, informe o e-mail do paciente']);
  });

  test('PUT sem o campo desliga o lembrete (substitui o cadastro inteiro)', async () => {
    const p = await criarPaciente(psiA);

    const resposta = await agenteA.put(`/pacientes/${p.id}`).send({ nome: p.nome, cpf: p.cpf, email: p.email });

    expect(resposta.status).toBe(200);
    expect(resposta.body.receberLembrete).toBe(false);
  });

  test('o banco também recusa lembrete sem e-mail (CHECK)', async () => {
    await expect(criarPaciente(psiA, { email: null })).rejects.toThrow(/Paciente_lembrete_exige_email_check/);
  });
});

describe('quem recebe', () => {
  test('sessão nas próximas 24 h de paciente com opt-in: envia e marca', async () => {
    const ag = await sessao(await criarPaciente(psiA), '2031-01-11T10:00'); // daqui a 22 h
    const transporte = transporteFalso();

    const resultado = await enviar(transporte);

    expect(resultado).toEqual({ enviados: [ag.id], ignorados: [], falhas: [] });
    expect(transporte.enviadas).toHaveLength(1);
    expect(await lembreteDe(ag)).toBeInstanceOf(Date);
  });

  test('não envia de novo na rodada seguinte', async () => {
    await sessao(await criarPaciente(psiA), '2031-01-11T10:00');
    await enviar(transporteFalso());
    const transporte = transporteFalso();

    expect(await enviar(transporte)).toEqual({ enviados: [], ignorados: [], falhas: [] });
    expect(transporte.enviadas).toHaveLength(0);
  });

  test.each([
    ['paciente sem opt-in', { paciente: { receberLembrete: false } }, '2031-01-11T10:00'],
    ['paciente sem consentimento LGPD', { paciente: { consentimentos: undefined } }, '2031-01-11T10:00'],
    [
      'consentimento revogado',
      { paciente: { consentimentos: { create: { versaoTermo: 'v1', aceitoEm: h('2031-01-01T10:00'), revogadoEm: h('2031-01-05T10:00') } } } },
      '2031-01-11T10:00',
    ],
    ['paciente arquivado', { paciente: { arquivadoEm: h('2031-01-01T10:00') } }, '2031-01-11T10:00'],
    ['sessão cancelada', { sessao: { status: 'CANCELADO' } }, '2031-01-11T10:00'],
    ['sessão no passado (lançamento retroativo)', {}, '2031-01-10T09:00'],
    ['sessão começando agora (já não é futura)', {}, '2031-01-10T12:00'],
    ['sessão além da antecedência (25 h)', {}, '2031-01-11T13:00'],
    ['lembrete já enviado', { sessao: { lembreteEnviadoEm: h('2031-01-10T08:00') } }, '2031-01-11T10:00'],
  ])('não envia: %s', async (_caso, extra, inicio) => {
    await sessao(await criarPaciente(psiA, extra.paciente), inicio, extra.sessao);
    const transporte = transporteFalso();

    expect(await enviar(transporte)).toEqual({ enviados: [], ignorados: [], falhas: [] });
    expect(transporte.enviadas).toHaveLength(0);
  });

  test('não envia para paciente de conta de psicóloga desativada', async () => {
    await sessao(await criarPaciente(psiInativa), '2031-01-11T10:00');

    expect((await enviar(transporteFalso())).enviados).toEqual([]);
  });

  test('a antecedência é configurável: com 48 h, a sessão de daqui a 25 h entra', async () => {
    const ag = await sessao(await criarPaciente(psiA), '2031-01-11T13:00');

    expect((await enviar(transporteFalso(), { antecedenciaHoras: 48 })).enviados).toEqual([ag.id]);
  });

  test('remarcar zera o lembrete: o novo horário recebe outro', async () => {
    const ag = await sessao(await criarPaciente(psiA), '2031-01-11T10:00');
    await enviar(transporteFalso());

    const resposta = await agenteA
      .put(`/agendamentos/${ag.id}`)
      .send({ inicio: '2031-01-11T11:00:00-03:00', fim: '2031-01-11T11:50:00-03:00' });
    expect(resposta.status).toBe(200);
    expect(resposta.body.lembreteEnviadoEm).toBeNull();

    expect((await enviar(transporteFalso())).enviados).toEqual([ag.id]);
  });
});

describe('a mensagem', () => {
  test('primeiro nome, dia da semana, horário — e nada que revele terapia', async () => {
    await sessao(await criarPaciente(psiA), '2031-01-11T10:00');
    const transporte = transporteFalso();

    await enviar(transporte);
    const [mensagem] = transporte.enviadas;

    expect(mensagem.to).toBe('maria.clara@exemplo.test');
    expect(mensagem.subject).toBe('Lembrete: atendimento em 11/01 às 10:00');
    expect(mensagem.text).toContain('Olá, Maria.');
    expect(mensagem.text).toContain('sábado, 11/01/2031, das 10:00 às 10:50.');
    expect(mensagem.html).toBeUndefined(); // só texto puro
    const tudo = `${mensagem.subject}\n${mensagem.text}`.toLowerCase();
    for (const palavra of ['psic', 'terap', 'sessão', 'consulta', PSI_A.nome.toLowerCase()]) {
      expect(tudo).not.toContain(palavra);
    }
  });
});

describe('responder para (EMAIL_RESPONDER_PARA)', () => {
  const env = require('../../src/config/env');
  afterEach(() => {
    delete env.EMAIL_RESPONDER_PARA;
  });

  const mensagemDe = () =>
    lembretesService.montarMensagem({ inicio: h('2031-01-11T10:00'), fim: h('2031-01-11T10:50'), paciente: { nome: 'Maria', email: 'm@exemplo.test' } });

  test('sem a variável: sem replyTo, e o texto não pede para responder', () => {
    const mensagem = mensagemDe();
    expect(mensagem.replyTo).toBeUndefined();
    expect(mensagem.text).toContain('pelo contato de costume');
  });

  test('com a variável: replyTo e o texto pedem a resposta por e-mail', () => {
    env.EMAIL_RESPONDER_PARA = 'consultorio@exemplo.test';
    const mensagem = mensagemDe();
    expect(mensagem.replyTo).toBe('consultorio@exemplo.test');
    expect(mensagem.text).toContain('respondendo este e-mail');
  });
});

describe('script npm run lembretes:enviar', () => {
  const { spawnSync } = require('child_process');
  const path = require('path');

  // Roda o script de verdade, num processo separado. SMTP_HOST vazio: o
  // dotenv não sobrescreve variável que já existe, nem vazia — então o
  // .env de quem roda os testes não interfere.
  const rodar = (env) =>
    spawnSync(process.execPath, ['scripts/enviar-lembretes.js'], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, SMTP_HOST: '', ...env },
      encoding: 'utf8',
    });

  test('em produção sem SMTP, recusa (senão marcaria "enviado" sem enviar nada)', () => {
    const resultado = rodar({ NODE_ENV: 'production' });

    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain('NODE_ENV=production sem SMTP_HOST');
  });

  // Janela de 1 h a partir de agora (2026): as sessões deste arquivo são de
  // 2031 e as dos outros não têm opt-in — o script não encontra nada.
  test('fora de produção, sem SMTP: roda em modo simulação e respeita a antecedência', () => {
    const resultado = rodar({ NODE_ENV: 'test', LEMBRETE_ANTECEDENCIA_HORAS: '1' });

    expect(resultado.status).toBe(0);
    expect(resultado.stdout).toContain('Modo simulação');
    expect(resultado.stdout).toContain('Antecedência: 1 h');
  });
});

describe('falhas', () => {
  test('falha de envio: não marca, segue com os outros e não expõe o e-mail no motivo', async () => {
    const falha = await sessao(await criarPaciente(psiA, { email: 'invalido@exemplo.test' }), '2031-01-11T09:00');
    const ok = await sessao(await criarPaciente(psiA), '2031-01-11T10:00');

    const resultado = await enviar(transporteFalso({ falharPara: ['invalido@exemplo.test'] }));

    expect(resultado).toEqual({ enviados: [ok.id], ignorados: [], falhas: [{ id: falha.id, motivo: 'EENVELOPE / SMTP 550' }] });
    expect(await lembreteDe(falha)).toBeNull(); // tenta de novo na próxima rodada
  });

  test('sessão remarcada durante o envio: o e-mail era do horário antigo, não marca', async () => {
    const ag = await sessao(await criarPaciente(psiA), '2031-01-11T10:00');
    const transporte = transporteFalso({
      aoEnviar: () => prisma.agendamento.update({ where: { id: ag.id }, data: { inicio: h('2031-01-11T15:00'), fim: h('2031-01-11T15:50') } }),
    });

    expect(await enviar(transporte)).toEqual({ enviados: [], ignorados: [ag.id], falhas: [] });
    expect(await lembreteDe(ag)).toBeNull();
  });
});
