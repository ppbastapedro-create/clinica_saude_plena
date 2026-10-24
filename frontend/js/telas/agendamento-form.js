// Novo agendamento e remarcação (mockup, tela 3). O mesmo formulário serve
// aos dois: ao remarcar, o paciente fica fixo e só data/horário mudam.
//
// A checagem de conflito daqui é só para orientar (horários riscados e
// aviso antes de salvar). Quem garante é o backend: o service responde 409 e,
// por último, a exclusion constraint do banco.
import { api, mensagemDe } from '../api.js';
import { el, trocar } from '../dom.js';
import { icone } from '../icones.js';
import * as D from '../datas.js';
import { avatar, alerta, cpfMascarado, emBreve } from '../formato.js';
import { cabecalho, botao, linkVoltar, cartao, linhaInfo } from '../componentes.js';
import { buscarSessoes } from './agenda.js';

const HORARIOS = Array.from({ length: 12 }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`); // 08:00–19:00
const DURACOES = [30, 40, 45, 50, 60, 90, 120];
const DURACAO_PADRAO = 50;
const MAX_RESULTADOS = 8;

export async function montarNovo(raiz, ctx) {
  ctx.titulo('Novo agendamento');
  const pacientes = await api('/pacientes'); // só ativos (padrão da API)
  const pacienteId = Number(ctx.query.get('pacienteId'));
  return montarFormulario(raiz, {
    modo: 'novo',
    pacientes,
    paciente: pacientes.find((p) => p.id === pacienteId) ?? null,
    data: D.deInputData(ctx.query.get('data')) ?? D.inicioDoDia(new Date()),
    hora: /^\d{2}:\d{2}$/.test(ctx.query.get('hora') ?? '') ? ctx.query.get('hora') : null,
    duracao: DURACAO_PADRAO,
  });
}

export async function montarRemarcar(raiz, ctx) {
  ctx.titulo('Remarcar sessão');
  const ag = await api(`/agendamentos/${ctx.params[0]}`);
  const inicio = new Date(ag.inicio);
  const fim = new Date(ag.fim);
  if (ag.status !== 'AGENDADO') {
    trocar(
      raiz,
      linkVoltar(`#/agendamentos/${ag.id}`, 'Sessão'),
      alerta('aviso', 'Só sessões agendadas podem ser remarcadas. Esta sessão já está fechada.'),
    );
    return undefined;
  }
  return montarFormulario(raiz, {
    modo: 'remarcar',
    agendamento: { ...ag, inicio, fim },
    paciente: ag.paciente,
    data: D.inicioDoDia(inicio),
    hora: D.hora(inicio),
    duracao: D.minutosEntre(inicio, fim),
  });
}

async function montarFormulario(raiz, inicial) {
  const remarcando = inicial.modo === 'remarcar';
  const ag = inicial.agendamento;
  const estado = { ...inicial, ocupadas: [], enviando: false, erroServidor: null };

  // ── Paciente ──
  let blocoPaciente;
  if (remarcando) {
    blocoPaciente = el(
      'div',
      { class: 'grupo' },
      el('span', { class: 'rotulo' }, 'Paciente'),
      el('input', { class: 'campo', value: estado.paciente.nome, readOnly: true }),
    );
  } else {
    blocoPaciente = seletorPaciente(estado.pacientes, estado.paciente, (p) => {
      estado.paciente = p;
      estado.erroServidor = null;
      atualizarTela();
    });
  }

  // ── Data e duração ──
  const campoData = el('input', {
    class: 'campo',
    type: 'date',
    id: 'campo-data',
    required: true,
    value: D.paraInputData(estado.data),
    onchange: async (e) => {
      const nova = D.deInputData(e.target.value);
      if (!nova) return;
      estado.data = nova;
      estado.erroServidor = null;
      await carregarOcupadas();
    },
  });

  const opcoesDuracao = DURACOES.includes(estado.duracao) ? DURACOES : [...DURACOES, estado.duracao].sort((a, b) => a - b);
  const campoDuracao = el(
    'select',
    {
      class: 'campo',
      id: 'campo-duracao',
      onchange: (e) => {
        estado.duracao = Number(e.target.value);
        estado.erroServidor = null;
        atualizarTela();
      },
    },
    opcoesDuracao.map((m) => el('option', { value: String(m), selected: m === estado.duracao }, `${m} minutos`)),
  );

  // ── Horário ──
  const chips = el('div', { class: 'chips-horario', role: 'group', 'aria-label': 'Horário de início' });
  const campoOutroHorario = el('input', {
    class: 'campo campo-hora',
    type: 'time',
    step: '300',
    'aria-label': 'Outro horário de início',
    onchange: (e) => {
      if (!e.target.value) return;
      estado.hora = e.target.value;
      estado.erroServidor = null;
      atualizarTela();
    },
  });
  const ajudaHorario = el('p', { class: 'ajuda' });
  const mensagens = el('div', { class: 'mensagens' });

  const botaoSalvar = botao(remarcando ? 'Salvar novo horário' : 'Salvar agendamento', { primario: true, type: 'submit' });
  const voltarPara = remarcando ? `#/agendamentos/${ag.id}` : '#/agenda';

  const form = el(
    'form',
    { class: 'cartao formulario', novalidate: true, onsubmit: salvar },
    blocoPaciente,
    el(
      'div',
      { class: 'grupo-duplo' },
      el('div', { class: 'grupo' }, el('label', { class: 'rotulo', for: 'campo-data' }, 'Data'), campoData),
      el('div', { class: 'grupo' }, el('label', { class: 'rotulo', for: 'campo-duracao' }, 'Duração'), campoDuracao),
    ),
    el(
      'div',
      { class: 'grupo' },
      el('span', { class: 'rotulo' }, 'Horário de início'),
      chips,
      el('div', { class: 'outro-horario' }, el('span', {}, 'Outro horário:'), campoOutroHorario),
      ajudaHorario,
    ),
    mensagens,
    el('div', { class: 'formulario-acoes' }, botao('Cancelar', { href: voltarPara }), botaoSalvar),
  );

  const resumo = el('div'); // preenchido em atualizarTela

  trocar(
    raiz,
    cabecalho({
      voltar: linkVoltar(voltarPara, remarcando ? 'Sessão' : 'Agenda'),
      titulo: remarcando ? 'Remarcar sessão' : 'Novo agendamento',
    }),
    el('div', { class: 'grade-form' }, form, resumo),
  );

  // ── Cálculos ──
  const inicioEscolhido = () => (estado.hora ? D.comHora(estado.data, estado.hora) : null);
  const fimDe = (inicio) => new Date(inicio.getTime() + estado.duracao * D.MINUTO);

  // Sessão (ativa) que ocupa parte do intervalo. Ao remarcar, a própria
  // sessão não conta.
  function conflito(inicio) {
    const fim = fimDe(inicio);
    return estado.ocupadas.find((s) => s.id !== ag?.id && s.inicio < fim && s.fim > inicio);
  }

  async function carregarOcupadas() {
    try {
      const inicio = D.inicioDoDia(estado.data);
      estado.ocupadas = await buscarSessoes(inicio, D.somarDias(inicio, 1));
    } catch (erro) {
      estado.ocupadas = [];
      estado.erroServidor = mensagemDe(erro);
    }
    atualizarTela();
  }

  function atualizarTela() {
    // Chips de horário: riscados se o horário + duração bate com outra sessão.
    trocar(
      chips,
      HORARIOS.map((h) => {
        const ocupado = Boolean(conflito(D.comHora(estado.data, h)));
        return el(
          'button',
          {
            type: 'button',
            class: `chip${ocupado ? ' ocupado' : ''}${estado.hora === h ? ' selecionado' : ''}`,
            'aria-pressed': String(estado.hora === h),
            disabled: ocupado && estado.hora !== h,
            title: ocupado ? 'Horário ocupado' : undefined,
            onclick: () => {
              estado.hora = h;
              estado.erroServidor = null;
              campoOutroHorario.value = '';
              atualizarTela();
            },
          },
          h,
        );
      }),
    );
    if (estado.hora && !HORARIOS.includes(estado.hora)) campoOutroHorario.value = estado.hora;

    const inicio = inicioEscolhido();
    const choque = inicio && conflito(inicio);
    ajudaHorario.textContent = inicio
      ? `Término às ${D.hora(fimDe(inicio))}. Horários riscados já estão ocupados.`
      : 'Escolha um horário. Horários riscados já estão ocupados.';

    const itens = [];
    if (choque) {
      itens.push(
        alerta(
          'aviso',
          el('strong', {}, 'Conflito de horário. '),
          `${choque.paciente.nome} já tem sessão das ${D.hora(choque.inicio)} às ${D.hora(choque.fim)} nesse dia. Escolha outro horário para salvar.`,
        ),
      );
    }
    if (inicio && inicio < new Date() && !choque) {
      itens.push(
        alerta('info', 'Data e horário no passado: a sessão será lançada como histórico (ex.: atendimento da agenda de papel).'),
      );
    }
    if (estado.erroServidor) itens.push(alerta('erro', estado.erroServidor));
    trocar(mensagens, itens);

    botaoSalvar.disabled = estado.enviando || !estado.paciente || !inicio || Boolean(choque);
    renderizarResumo(inicio);
  }

  function renderizarResumo(inicio) {
    trocar(
      resumo,
      cartao(
        { titulo: 'Resumo', classe: 'resumo' },
        estado.paciente
          ? el('div', { class: 'resumo-paciente' }, avatar(estado.paciente.nome), el('strong', {}, estado.paciente.nome))
          : el('p', { class: 'texto-suave' }, 'Nenhum paciente selecionado.'),
        el(
          'div',
          { class: 'resumo-linhas' },
          remarcando && linhaInfo('Horário atual', `${D.semanaCurta(ag.inicio)}, ${D.diaMes(ag.inicio)} · ${D.intervalo(ag.inicio, ag.fim)}`),
          linhaInfo(remarcando ? 'Novo dia' : 'Data', `${D.semanaCurta(estado.data)}, ${D.diaMes(estado.data)}`),
          linhaInfo(remarcando ? 'Novo horário' : 'Horário', inicio ? D.intervalo(inicio, fimDe(inicio)) : '—'),
          el('div', { class: 'linha-info' }, el('span', {}, 'Valor da sessão'), emBreve('1.4.7')),
          el('div', { class: 'linha-info' }, el('span', {}, 'Lembrete por e-mail'), emBreve('1.4.8')),
        ),
      ),
    );
  }

  async function salvar(evento) {
    evento.preventDefault();
    const inicio = inicioEscolhido();
    if (!estado.paciente || !inicio || conflito(inicio) || estado.enviando) return;

    estado.enviando = true;
    estado.erroServidor = null;
    atualizarTela();
    const intervalo = { inicio: D.isoComFuso(inicio), fim: D.isoComFuso(fimDe(inicio)) };
    try {
      const salvo = remarcando
        ? await api(`/agendamentos/${ag.id}`, { metodo: 'PUT', corpo: intervalo })
        : await api('/agendamentos', { metodo: 'POST', corpo: { pacienteId: estado.paciente.id, ...intervalo } });
      window.location.hash = `#/agendamentos/${salvo.id}`;
    } catch (erro) {
      estado.enviando = false;
      estado.erroServidor = mensagemDe(erro);
      // 409: alguém ocupou o horário nesse meio-tempo — recarrega o dia para
      // os chips refletirem a agenda atual.
      if (erro.status === 409) await carregarOcupadas();
      else atualizarTela();
    }
  }

  await carregarOcupadas();
  return undefined;
}

// Campo de busca de paciente (combobox): digita nome ou CPF e escolhe na lista.
function seletorPaciente(pacientes, selecionado, aoEscolher) {
  const lista = el('ul', { class: 'combo-lista', id: 'combo-pacientes', role: 'listbox', hidden: true });
  const campo = el('input', {
    class: 'campo campo-com-icone',
    id: 'campo-paciente',
    type: 'search',
    autocomplete: 'off',
    placeholder: 'Buscar por nome ou CPF',
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-controls': 'combo-pacientes',
    'aria-autocomplete': 'list',
    value: selecionado?.nome ?? '',
  });

  function filtrar() {
    const termo = campo.value.trim().toLowerCase();
    const digitos = termo.replace(/\D/g, '');
    return pacientes
      .filter((p) => !termo || p.nome.toLowerCase().includes(termo) || (digitos.length >= 3 && p.cpf.startsWith(digitos)))
      .slice(0, MAX_RESULTADOS);
  }

  function abrir() {
    const achados = filtrar();
    trocar(
      lista,
      achados.length === 0
        ? el('li', { class: 'combo-vazio' }, pacientes.length ? 'Nenhum paciente encontrado.' : 'Nenhum paciente ativo cadastrado.')
        : achados.map((p) =>
            el(
              'li',
              {
                role: 'option',
                // mousedown + preventDefault: escolhe antes de o campo perder
                // o foco (o blur fecharia a lista antes do clique).
                onmousedown: (e) => {
                  e.preventDefault();
                  escolher(p);
                },
              },
              avatar(p.nome, 'avatar-pequeno'),
              el('span', {}, p.nome),
              el('small', {}, cpfMascarado(p.cpf)),
            ),
          ),
    );
    lista.hidden = false;
    campo.setAttribute('aria-expanded', 'true');
    return achados;
  }

  function fechar() {
    lista.hidden = true;
    campo.setAttribute('aria-expanded', 'false');
  }

  function escolher(p) {
    campo.value = p.nome;
    fechar();
    aoEscolher(p);
  }

  campo.addEventListener('focus', abrir);
  campo.addEventListener('input', () => {
    aoEscolher(null); // digitou de novo: desfaz a escolha até selecionar
    abrir();
  });
  campo.addEventListener('blur', fechar);
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fechar();
    if (e.key === 'Enter') {
      e.preventDefault();
      const [primeiro] = filtrar();
      if (primeiro) escolher(primeiro);
    }
  });

  return el(
    'div',
    { class: 'grupo' },
    el('label', { class: 'rotulo', for: 'campo-paciente' }, 'Paciente'),
    el('div', { class: 'combo' }, icone('busca', 'combo-icone'), campo, lista),
    el('p', { class: 'ajuda' }, 'Não encontrou? ', el('a', { href: '#/pacientes/novo?voltar=agendamento' }, 'Cadastrar novo paciente')),
  );
}
