// Ficha do paciente (mockup, tela 6) e cadastro de paciente novo. Os dois
// usam o mesmo formulário de dados cadastrais. A ficha também mostra a conta
// corrente do paciente (saldo, recebimentos e extrato).
import { api, mensagemDe, ErroApi } from '../api.js';
import { el, trocar } from '../dom.js';
import * as D from '../datas.js';
import {
  avatar,
  alerta,
  cpf,
  telefone,
  mascararCpf,
  mascararTelefone,
  seloStatus,
  selo,
  seloSaldo,
  emBreve,
  reais,
  lerValor,
  valorParaCampo,
  cobrancaDaSessao,
  FORMAS_PAGAMENTO,
} from '../formato.js';
import { cabecalho, botao, linkVoltar, cartao, linhaInfo, vazio } from '../componentes.js';

// ── Formulário de dados cadastrais ───────────────────────────────────

const CAMPOS = [
  { nome: 'nome', rotulo: 'Nome completo', tipo: 'text', autocomplete: 'off', obrigatorio: true },
  { nome: 'cpf', rotulo: 'CPF', tipo: 'text', inputmode: 'numeric', mascara: mascararCpf, placeholder: '000.000.000-00', obrigatorio: true },
  { nome: 'email', rotulo: 'E-mail', tipo: 'email', autocomplete: 'off', placeholder: 'opcional' },
  { nome: 'telefone', rotulo: 'Telefone', tipo: 'tel', inputmode: 'tel', mascara: mascararTelefone, placeholder: '(61) 90000-0000' },
  // Preço padrão: vem preenchido ao marcar sessão (cada paciente tem o seu).
  { nome: 'valorSessao', rotulo: 'Preço da sessão', tipo: 'text', inputmode: 'decimal', placeholder: '0,00', moeda: true },
];

function valorInicialDoCampo(nome, paciente) {
  if (nome === 'cpf') return cpf(paciente?.cpf ?? '');
  if (nome === 'telefone') return paciente?.telefone ? telefone(paciente.telefone) : '';
  if (nome === 'valorSessao') return valorParaCampo(paciente?.valorSessao);
  return paciente?.[nome] ?? '';
}

// aoSalvar(dados) devolve uma Promise; se ela falhar com ErroApi, os erros
// por campo (400) aparecem embaixo de cada campo e o resto vira alerta.
function formularioPaciente(paciente, { textoBotao, aoSalvar, primario = false }) {
  const entradas = {};
  const errosCampo = {};
  const mensagens = el('div', { class: 'mensagens' });

  const grupos = CAMPOS.map((c) => {
    const valorInicial = valorInicialDoCampo(c.nome, paciente);
    const entrada = el('input', {
      class: 'campo',
      id: `paciente-${c.nome}`,
      name: c.nome,
      type: c.tipo,
      inputmode: c.inputmode,
      autocomplete: c.autocomplete ?? 'off',
      placeholder: c.placeholder,
      required: c.obrigatorio,
      value: valorInicial,
    });
    if (c.mascara) entrada.addEventListener('input', () => (entrada.value = c.mascara(entrada.value)));
    entradas[c.nome] = entrada;
    errosCampo[c.nome] = el('p', { class: 'erro-campo', id: `erro-${c.nome}`, hidden: true });
    return el(
      'div',
      { class: `grupo grupo-${c.nome}` },
      el('label', { class: 'rotulo', for: entrada.id }, c.rotulo, c.obrigatorio ? '' : el('span', { class: 'opcional' }, ' (opcional)')),
      c.moeda ? el('div', { class: 'campo-moeda' }, el('span', {}, 'R$'), entrada) : entrada,
      errosCampo[c.nome],
    );
  });

  // Opt-in do lembrete por e-mail (pacote 1.4.8). É caixa de seleção: o que
  // vai para a API é `checked`, não `value` (ver o submit abaixo).
  const caixaLembrete = el('input', {
    type: 'checkbox',
    id: 'paciente-receberLembrete',
    name: 'receberLembrete',
    checked: Boolean(paciente?.receberLembrete),
  });
  entradas.receberLembrete = caixaLembrete;
  errosCampo.receberLembrete = el('p', { class: 'erro-campo', id: 'erro-receberLembrete', hidden: true });
  const grupoLembrete = el(
    'div',
    { class: 'grupo grupo-receberLembrete' },
    el('label', { class: 'legenda-check' }, caixaLembrete, 'Enviar lembrete das sessões por e-mail'),
    el('p', { class: 'nota' }, 'Só com a concordância do paciente. O e-mail diz apenas "lembrete de atendimento", com data e hora — nada sobre psicologia.'),
    errosCampo.receberLembrete,
  );

  const botaoSalvar = botao(textoBotao, { type: 'submit', primario });

  function limparErros() {
    trocar(mensagens);
    for (const nome of Object.keys(entradas)) {
      entradas[nome].removeAttribute('aria-invalid');
      entradas[nome].removeAttribute('aria-describedby');
      errosCampo[nome].hidden = true;
    }
  }

  function mostrarErro(erro) {
    const campos = erro instanceof ErroApi ? erro.campos : {};
    let algumCampo = false;
    for (const [nome, lista] of Object.entries(campos)) {
      if (!entradas[nome] || !lista?.length) continue;
      algumCampo = true;
      entradas[nome].setAttribute('aria-invalid', 'true');
      entradas[nome].setAttribute('aria-describedby', `erro-${nome}`);
      errosCampo[nome].textContent = lista[0];
      errosCampo[nome].hidden = false;
    }
    if (algumCampo) {
      entradas[Object.keys(campos).find((n) => entradas[n])]?.focus();
      return;
    }
    // CPF já cadastrado (409): oferece abrir o cadastro existente.
    const existente = erro?.corpo?.pacienteId;
    trocar(
      mensagens,
      alerta('erro', mensagemDe(erro), existente && ' ', existente && el('a', { href: `#/pacientes/${existente}` }, 'Abrir o cadastro existente')),
    );
  }

  const form = el('form', { class: 'form-paciente', novalidate: true }, ...grupos, grupoLembrete, mensagens, el('div', { class: 'formulario-acoes' }, botaoSalvar));
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    limparErros();
    botaoSalvar.disabled = true;
    const dados = Object.fromEntries(
      Object.entries(entradas).map(([nome, entrada]) => [nome, entrada.type === 'checkbox' ? entrada.checked : entrada.value]),
    );
    try {
      await aoSalvar(dados);
    } catch (erro) {
      mostrarErro(erro);
    } finally {
      botaoSalvar.disabled = false;
    }
  });

  return { form, mensagens };
}

// ── Novo paciente ────────────────────────────────────────────────────

export async function montarNovo(raiz, ctx) {
  ctx.titulo('Novo paciente');
  const vindoDoAgendamento = ctx.query.get('voltar') === 'agendamento';
  const { form } = formularioPaciente(null, {
    textoBotao: vindoDoAgendamento ? 'Cadastrar e voltar ao agendamento' : 'Cadastrar paciente',
    primario: true,
    aoSalvar: async (dados) => {
      const criado = await api('/pacientes', { metodo: 'POST', corpo: dados });
      window.location.hash = vindoDoAgendamento ? `#/agenda/novo?pacienteId=${criado.id}` : `#/pacientes/${criado.id}`;
    },
  });

  trocar(
    raiz,
    cabecalho({
      voltar: linkVoltar(vindoDoAgendamento ? '#/agenda/novo' : '#/pacientes', vindoDoAgendamento ? 'Novo agendamento' : 'Pacientes'),
      titulo: 'Novo paciente',
    }),
    el(
      'div',
      { class: 'grade-form' },
      cartao({ titulo: 'Dados cadastrais', classe: 'formulario' }, form),
      cartao(
        { titulo: 'Sobre os dados', classe: 'resumo' },
        el('p', { class: 'texto-suave' }, 'Use somente os dados necessários ao atendimento (LGPD, princípio da necessidade).'),
        el('p', { class: 'texto-suave' }, 'O CPF é validado pelos dígitos verificadores e não pode se repetir entre seus pacientes.'),
      ),
    ),
  );
}

// ── Ficha ────────────────────────────────────────────────────────────

export async function montarFicha(raiz, ctx) {
  const id = ctx.params[0];
  let aviso = null; // alerta mostrado abaixo do cabeçalho após uma ação

  let avisoConta = null; // alerta no cartão da conta (recebimento/estorno)

  async function carregar() {
    const [paciente, sessoesBrutas, conta] = await Promise.all([
      api(`/pacientes/${id}`),
      api(`/pacientes/${id}/sessoes`),
      api(`/pacientes/${id}/financeiro`),
    ]);
    const sessoes = sessoesBrutas.map((s) => ({ ...s, inicio: new Date(s.inicio), fim: new Date(s.fim) }));
    ctx.titulo(paciente.nome);
    renderizar(paciente, sessoes, conta);
  }

  async function registrarRecebimento(corpo) {
    try {
      await api(`/pacientes/${id}/recebimentos`, { metodo: 'POST', corpo });
      avisoConta = alerta('sucesso', `Recebimento de ${reais(lerValor(corpo.valor))} registrado.`);
    } catch (erro) {
      avisoConta = alerta('erro', mensagemDe(erro));
    }
    await carregar();
  }

  async function estornar(recebimento) {
    if (!window.confirm(`Estornar o recebimento de ${reais(recebimento.valor)} de ${D.data(new Date(recebimento.recebidoEm))}? Ele continua no histórico, mas sai do saldo. Use só para corrigir um lançamento errado.`)) return;
    try {
      await api(`/recebimentos/${recebimento.id}/estornar`, { metodo: 'PATCH' });
      avisoConta = alerta('sucesso', 'Recebimento estornado.');
    } catch (erro) {
      avisoConta = alerta('erro', mensagemDe(erro));
    }
    await carregar();
  }

  // Conta corrente: saldo, formulário de recebimento e extrato.
  function cartaoConta(conta) {
    const valorSessao = conta.paciente.valorSessao;
    let valorEditado = false;
    const campoSessoes = el('input', { class: 'campo', id: 'receb-sessoes', type: 'number', min: '1', max: '100', step: '1', value: '1' });
    const campoValor = el('input', {
      class: 'campo',
      id: 'receb-valor',
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      placeholder: '0,00',
      value: valorParaCampo(valorSessao),
      oninput: () => {
        valorEditado = true;
      },
    });
    // Sugestão: preço do paciente × sessões (pacote de 2, de 4…), até a
    // pessoa digitar um valor próprio (ex.: pacote com desconto).
    campoSessoes.addEventListener('input', () => {
      const n = Number(campoSessoes.value);
      if (!valorEditado && valorSessao && n >= 1) campoValor.value = valorParaCampo((Number(valorSessao) * n).toFixed(2));
    });
    const campoData = el('input', { class: 'campo', id: 'receb-data', type: 'date', value: D.paraInputData(new Date()), max: D.paraInputData(new Date()) });
    const campoForma = el(
      'select',
      { class: 'campo', id: 'receb-forma' },
      Object.entries(FORMAS_PAGAMENTO).map(([chave, rotulo]) => el('option', { value: chave }, rotulo)),
    );

    function enviar(evento) {
      evento.preventDefault();
      const dia = D.deInputData(campoData.value);
      // Hoje = agora; outro dia = meio-dia daquele dia (a hora não importa,
      // e meio-dia nunca cai no dia vizinho por causa de fuso).
      const recebidoEm = !dia || D.mesmoDia(dia, new Date()) ? undefined : D.isoComFuso(D.comHora(dia, '12:00'));
      registrarRecebimento({
        valor: campoValor.value.trim(),
        formaPagamento: campoForma.value,
        sessoes: campoSessoes.value ? Number(campoSessoes.value) : null,
        ...(recebidoEm && { recebidoEm }),
      });
    }

    const formulario = el(
      'form',
      { class: 'form-recebimento', novalidate: true, onsubmit: enviar },
      el('h3', {}, 'Registrar recebimento'),
      el(
        'div',
        { class: 'grupo-duplo' },
        el('div', { class: 'grupo' }, el('label', { class: 'rotulo', for: 'receb-valor' }, 'Valor recebido'), el('div', { class: 'campo-moeda' }, el('span', {}, 'R$'), campoValor)),
        el('div', { class: 'grupo' }, el('label', { class: 'rotulo', for: 'receb-sessoes' }, 'Sessões que cobre'), campoSessoes),
      ),
      el(
        'div',
        { class: 'grupo-duplo' },
        el('div', { class: 'grupo' }, el('label', { class: 'rotulo', for: 'receb-data' }, 'Data'), campoData),
        el('div', { class: 'grupo' }, el('label', { class: 'rotulo', for: 'receb-forma' }, 'Forma'), campoForma),
      ),
      el('div', { class: 'acoes-status' }, botao('Registrar recebimento', { primario: true, icone: 'ok', type: 'submit' })),
    );

    const mensagem = avisoConta;
    avisoConta = null; // mostra uma vez só
    return cartao(
      { titulo: 'Conta do paciente', icone: 'cartao', extra: seloSaldo(conta.saldo), classe: 'cartao-conta' },
      mensagem,
      linhaInfo(`Sessões cobradas (${conta.sessoesCobradas})`, reais(conta.cobrado)),
      linhaInfo('Recebido', reais(conta.recebido)),
      conta.sessoesSemValor > 0 &&
        alerta('aviso', `${conta.sessoesSemValor === 1 ? '1 sessão cobrável está' : `${conta.sessoesSemValor} sessões cobráveis estão`} sem valor e fora do saldo. Defina o valor na sessão.`),
      !valorSessao && el('p', { class: 'nota' }, 'Dica: preencha o "Preço da sessão" nos dados cadastrais para o valor vir sugerido.'),
      formulario,
      extrato(conta.lancamentos, estornar),
    );
  }

  async function arquivarOuReativar(paciente) {
    const arquivado = Boolean(paciente.arquivadoEm);
    if (
      !arquivado &&
      !window.confirm(`Arquivar ${paciente.nome}? O paciente sai da lista de ativos; o histórico é preservado e o cadastro pode ser reativado depois.`)
    ) {
      return;
    }
    try {
      await api(`/pacientes/${id}/${arquivado ? 'reativar' : 'arquivar'}`, { metodo: 'PATCH' });
      aviso = alerta('sucesso', arquivado ? 'Cadastro reativado.' : 'Paciente arquivado.');
    } catch (erro) {
      // 422 com sessões futuras: a mensagem do backend já lista as datas.
      aviso = alerta('erro', mensagemDe(erro));
    }
    await carregar();
  }

  function renderizar(paciente, sessoes, conta) {
    const arquivado = Boolean(paciente.arquivadoEm);
    const realizadas = sessoes.filter((s) => s.status === 'REALIZADO').length;
    const primeira = sessoes.at(-1)?.inicio; // a lista vem da mais recente para a mais antiga
    const desde = primeira && primeira < new Date(paciente.criadoEm) ? primeira : new Date(paciente.criadoEm);
    const subtitulo = [
      arquivado ? `Arquivado em ${D.data(new Date(paciente.arquivadoEm))}` : `Em atendimento desde ${D.mesAno(desde).toLowerCase()}`,
      `${realizadas} ${realizadas === 1 ? 'sessão realizada' : 'sessões realizadas'}`,
    ].join(' · ');

    const { form } = formularioPaciente(paciente, {
      textoBotao: 'Salvar alterações',
      aoSalvar: async (dados) => {
        await api(`/pacientes/${id}`, { metodo: 'PUT', corpo: dados });
        aviso = alerta('sucesso', 'Alterações salvas.');
        await carregar();
      },
    });

    trocar(
      raiz,
      cabecalho({
        voltar: linkVoltar(arquivado ? '#/pacientes?situacao=arquivados' : '#/pacientes', 'Pacientes'),
        avatar: avatar(paciente.nome, 'avatar-grande'),
        titulo: paciente.nome,
        selo: arquivado && selo('Arquivado', 'selo-cancelado'),
        subtitulo,
        acoes: [
          botao(arquivado ? 'Reativar' : 'Arquivar', { icone: 'arquivo', onclick: () => arquivarOuReativar(paciente) }),
          !arquivado && botao('Agendar sessão', { primario: true, icone: 'mais', href: `#/agenda/novo?pacienteId=${id}` }),
        ].filter(Boolean),
      }),
      aviso && el('div', { class: 'mensagens' }, aviso),
      el(
        'div',
        { class: 'grade-ficha' },
        el(
          'div',
          { class: 'coluna' },
          cartao({ titulo: 'Dados cadastrais' }, form),
          cartao(
            { titulo: 'Consentimento LGPD', icone: 'escudo', extra: emBreve('futuro'), classe: 'cartao-em-breve' },
            el('p', { class: 'texto-suave' }, 'Registro do aceite do termo (versão e data) e da revogação. O banco já guarda esse histórico; as telas e rotas ainda não foram implementadas.'),
            el('p', { class: 'nota' }, 'A revogação é direito do paciente (LGPD art. 8º, §5º). Aceites e revogações ficam no histórico.'),
          ),
        ),
        el('div', { class: 'coluna' }, cartaoConta(conta), cartao({ titulo: 'Histórico de sessões', classe: 'cartao-tabela' }, historico(sessoes))),
      ),
    );
    aviso = null; // mostra uma vez só
  }

  await carregar();
}

// Extrato da conta, como o de um banco: mais recente primeiro, com o saldo
// depois de cada lançamento. Mostra os últimos lançamentos e esconde o resto
// atrás de um <details> (sem JavaScript extra).
const VISIVEIS_NO_EXTRATO = 8;
const DESCRICAO_SESSAO = { REALIZADO: 'Sessão realizada', FALTA: 'Falta cobrada' };

function linhaExtrato(l, estornar) {
  const data = D.data(new Date(l.data));
  if (l.tipo === 'SESSAO') {
    return el(
      'li',
      { class: 'extrato-debito' },
      el('a', { href: `#/agendamentos/${l.sessao.id}` }, el('span', {}, data), el('strong', {}, DESCRICAO_SESSAO[l.sessao.status] ?? 'Sessão')),
      el('span', { class: 'extrato-valor' }, `− ${reais(l.valor)}`),
      el('span', { class: 'extrato-saldo' }, reais(l.saldoApos)),
    );
  }
  const r = l.recebimento;
  const detalhes = [FORMAS_PAGAMENTO[r.formaPagamento], r.sessoes && `${r.sessoes} ${r.sessoes === 1 ? 'sessão' : 'sessões'}`].filter(Boolean).join(' · ');
  return el(
    'li',
    { class: `extrato-credito${r.estornadoEm ? ' estornado' : ''}` },
    el('div', {}, el('span', {}, data), el('strong', {}, 'Recebimento', r.estornadoEm && ' (estornado)'), el('small', {}, detalhes)),
    el('span', { class: 'extrato-valor' }, `+ ${reais(l.valor)}`),
    el(
      'span',
      { class: 'extrato-saldo' },
      reais(l.saldoApos),
      !r.estornadoEm && el('button', { type: 'button', class: 'link-estornar', onclick: () => estornar(r) }, 'estornar'),
    ),
  );
}

function extrato(lancamentos, estornar) {
  if (lancamentos.length === 0) return el('p', { class: 'nota' }, 'Ainda sem lançamentos: sessões realizadas e recebimentos aparecem aqui.');
  const primeiros = lancamentos.slice(0, VISIVEIS_NO_EXTRATO);
  const resto = lancamentos.slice(VISIVEIS_NO_EXTRATO);
  return el(
    'div',
    { class: 'extrato' },
    el('h3', {}, 'Extrato'),
    el('ul', {}, primeiros.map((l) => linhaExtrato(l, estornar))),
    resto.length > 0 &&
      el('details', {}, el('summary', {}, `Ver mais ${resto.length} lançamento${resto.length === 1 ? '' : 's'}`), el('ul', {}, resto.map((l) => linhaExtrato(l, estornar)))),
  );
}

function historico(sessoes) {
  if (sessoes.length === 0) return vazio('Nenhuma sessão registrada para este paciente.');
  return el(
    'table',
    { class: 'tabela tabela-historico' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Data'), el('th', {}, 'Status'), el('th', {}, 'Cobrança'), el('th', {}, 'Registro'))),
    el(
      'tbody',
      {},
      sessoes.map((s) =>
        el(
          'tr',
          {},
          el('td', { 'data-rotulo': 'Data' }, el('a', { href: `#/agendamentos/${s.id}` }, `${D.data(s.inicio)} · ${D.hora(s.inicio)}`)),
          el('td', { 'data-rotulo': 'Status' }, seloStatus(s.status)),
          el('td', { 'data-rotulo': 'Cobrança' }, cobrancaDaSessao(s)),
          el(
            'td',
            { 'data-rotulo': 'Registro' },
            s.status === 'REALIZADO'
              ? el('a', { href: `#/agendamentos/${s.id}/registro` }, s.temRegistro ? 'Abrir' : 'Escrever')
              : el('span', { class: 'texto-suave' }, '—'),
          ),
        ),
      ),
    ),
  );
}
