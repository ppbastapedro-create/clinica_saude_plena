// Ficha do paciente (mockup, tela 6) e cadastro de paciente novo. Os dois
// usam o mesmo formulário de dados cadastrais.
import { api, mensagemDe, ErroApi } from '../api.js';
import { el, trocar } from '../dom.js';
import * as D from '../datas.js';
import { avatar, alerta, cpf, telefone, mascararCpf, mascararTelefone, seloStatus, selo, emBreve } from '../formato.js';
import { cabecalho, botao, linkVoltar, cartao, vazio } from '../componentes.js';

// ── Formulário de dados cadastrais ───────────────────────────────────

const CAMPOS = [
  { nome: 'nome', rotulo: 'Nome completo', tipo: 'text', autocomplete: 'off', obrigatorio: true },
  { nome: 'cpf', rotulo: 'CPF', tipo: 'text', inputmode: 'numeric', mascara: mascararCpf, placeholder: '000.000.000-00', obrigatorio: true },
  { nome: 'email', rotulo: 'E-mail', tipo: 'email', autocomplete: 'off', placeholder: 'opcional' },
  { nome: 'telefone', rotulo: 'Telefone', tipo: 'tel', inputmode: 'tel', mascara: mascararTelefone, placeholder: '(61) 90000-0000' },
];

// aoSalvar(dados) devolve uma Promise; se ela falhar com ErroApi, os erros
// por campo (400) aparecem embaixo de cada campo e o resto vira alerta.
function formularioPaciente(paciente, { textoBotao, aoSalvar, primario = false }) {
  const entradas = {};
  const errosCampo = {};
  const mensagens = el('div', { class: 'mensagens' });

  const grupos = CAMPOS.map((c) => {
    const valorInicial =
      c.nome === 'cpf' ? cpf(paciente?.cpf ?? '') : c.nome === 'telefone' ? (paciente?.telefone ? telefone(paciente.telefone) : '') : (paciente?.[c.nome] ?? '');
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
      entrada,
      errosCampo[c.nome],
    );
  });

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

  const form = el('form', { class: 'form-paciente', novalidate: true }, ...grupos, mensagens, el('div', { class: 'formulario-acoes' }, botaoSalvar));
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    limparErros();
    botaoSalvar.disabled = true;
    const dados = Object.fromEntries(Object.entries(entradas).map(([nome, entrada]) => [nome, entrada.value]));
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

  async function carregar() {
    const [paciente, sessoesBrutas] = await Promise.all([api(`/pacientes/${id}`), api(`/pacientes/${id}/sessoes`)]);
    const sessoes = sessoesBrutas.map((s) => ({ ...s, inicio: new Date(s.inicio), fim: new Date(s.fim) }));
    ctx.titulo(paciente.nome);
    renderizar(paciente, sessoes);
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

  function renderizar(paciente, sessoes) {
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
        cartao({ titulo: 'Histórico de sessões', classe: 'cartao-tabela' }, historico(sessoes)),
      ),
    );
    aviso = null; // mostra uma vez só
  }

  await carregar();
}

function historico(sessoes) {
  if (sessoes.length === 0) return vazio('Nenhuma sessão registrada para este paciente.');
  return el(
    'table',
    { class: 'tabela tabela-historico' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Data'), el('th', {}, 'Status'), el('th', {}, 'Registro'))),
    el(
      'tbody',
      {},
      sessoes.map((s) =>
        el(
          'tr',
          {},
          el('td', { 'data-rotulo': 'Data' }, el('a', { href: `#/agendamentos/${s.id}` }, `${D.data(s.inicio)} · ${D.hora(s.inicio)}`)),
          el('td', { 'data-rotulo': 'Status' }, seloStatus(s.status)),
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
