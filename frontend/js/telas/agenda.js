// Agenda (mockup, telas 2 e 9): calendário por semana, dia ou mês, com as
// próximas sessões e as pendências ao lado. No celular abre na visão "dia".
//
// O calendário é montado aqui mesmo, sem FullCalendar: a CSP do Helmet só
// aceita scripts do próprio servidor (script-src 'self'), e a visão do
// mockup é simples o bastante para não justificar a dependência.
import { api, mensagemDe } from '../api.js';
import { el, trocar } from '../dom.js';
import { icone } from '../icones.js';
import * as D from '../datas.js';
import { STATUS, seloStatus, avatar, alerta, emBreve } from '../formato.js';
import { cabecalho, botao, segmentado, cartao, carregando } from '../componentes.js';

const ALTURA_HORA = 52; // px de uma hora na visão semana
const HORA_INICIO_PADRAO = 8;
const HORA_FIM_PADRAO = 20;
const DIAS_PENDENCIAS = 60;
const DIAS_PROXIMAS = 30;
const celular = window.matchMedia('(max-width: 760px)');

// Preferência "mostrar canceladas" fica no navegador: é só conveniência de
// tela. try/catch porque o localStorage pode estar bloqueado.
const CHAVE_CANCELADAS = 'saudePlena.agenda.mostrarCanceladas';
function lerMostrarCanceladas() {
  try {
    return localStorage.getItem(CHAVE_CANCELADAS) === '1';
  } catch {
    return false;
  }
}
function salvarMostrarCanceladas(valor) {
  try {
    localStorage.setItem(CHAVE_CANCELADAS, valor ? '1' : '0');
  } catch {
    // sem localStorage: a preferência vale só até sair da tela
  }
}

// A API devolve datas como texto ISO; aqui viram Date uma vez só.
const comDatas = (s) => ({ ...s, inicio: new Date(s.inicio), fim: new Date(s.fim) });

export function buscarSessoes(inicio, fim, incluirCancelados = false) {
  return api('/agendamentos', {
    query: { inicio: D.isoComFuso(inicio), fim: D.isoComFuso(fim), incluirCancelados: String(incluirCancelados) },
  }).then((lista) => lista.map(comDatas));
}

const linkNovo = (data, hora) => `#/agenda/novo?data=${D.paraInputData(data)}${hora ? `&hora=${hora}` : ''}`;

export async function montar(raiz, ctx) {
  ctx.titulo('Agenda');
  const vistaPedida = ctx.query.get('vista');
  const estado = {
    vista: ['dia', 'semana', 'mes'].includes(vistaPedida) ? vistaPedida : celular.matches ? 'dia' : 'semana',
    data: D.deInputData(ctx.query.get('data')) ?? D.inicioDoDia(new Date()),
    canceladas: lerMostrarCanceladas(),
  };

  const subtitulo = el('span', {}, D.dataLonga(new Date(), { comAno: false }));
  const tituloPeriodo = el('h2', { class: 'periodo' });
  const corpo = el('div', { class: 'calendario-corpo' });
  const lateral = el('div', { class: 'agenda-lateral' }, carregando());

  const caixaCanceladas = el('input', {
    type: 'checkbox',
    checked: estado.canceladas,
    onchange: (e) => {
      estado.canceladas = e.target.checked;
      salvarMostrarCanceladas(estado.canceladas);
      atualizar();
    },
  });

  const legenda = el(
    'div',
    { class: 'legenda' },
    el(
      'ul',
      {},
      Object.values(STATUS).map((s) => el('li', {}, el('span', { class: `ponto ponto-${s.classe}` }), s.rotulo)),
    ),
    el('label', { class: 'legenda-check' }, caixaCanceladas, 'Mostrar canceladas'),
  );

  const barra = el(
    'div',
    { class: 'calendario-barra' },
    el(
      'div',
      { class: 'calendario-nav' },
      botao('', { icone: 'esquerda', rotulo: 'Período anterior', onclick: () => mover(-1) }),
      botao('', { icone: 'direita', rotulo: 'Próximo período', onclick: () => mover(1) }),
      botao('Hoje', {
        onclick: () => {
          estado.data = D.inicioDoDia(new Date());
          atualizar();
        },
      }),
      tituloPeriodo,
    ),
    segmentado(
      [
        { valor: 'dia', rotulo: 'Dia' },
        { valor: 'semana', rotulo: 'Semana' },
        { valor: 'mes', rotulo: 'Mês' },
      ],
      estado.vista,
      (vista) => {
        estado.vista = vista;
        atualizar();
      },
    ),
  );

  trocar(
    raiz,
    cabecalho({
      titulo: 'Agenda',
      subtitulo,
      acoes: [botao('Novo agendamento', { primario: true, icone: 'mais', href: '#/agenda/novo', classe: 'so-desktop' })],
    }),
    el('div', { class: 'agenda-grade' }, el('section', { class: 'cartao calendario' }, barra, corpo, legenda), lateral),
    // Botão flutuante "+" do celular (mockup, tela 9).
    el('a', { class: 'fab', href: '#/agenda/novo', 'aria-label': 'Novo agendamento' }, icone('mais')),
  );

  function periodo() {
    if (estado.vista === 'dia') {
      const inicio = D.inicioDoDia(estado.data);
      return { inicio, fim: D.somarDias(inicio, 1) };
    }
    if (estado.vista === 'semana') {
      const inicio = D.inicioDaSemana(estado.data);
      return { inicio, fim: D.somarDias(inicio, 7) };
    }
    // Mês: semanas inteiras (segunda a domingo) que cobrem o mês.
    const primeiro = D.inicioDoMes(estado.data);
    const ultimo = new Date(primeiro.getFullYear(), primeiro.getMonth() + 1, 0);
    return { inicio: D.inicioDaSemana(primeiro), fim: D.somarDias(D.inicioDaSemana(ultimo), 7) };
  }

  function mover(direcao) {
    if (estado.vista === 'dia') estado.data = D.somarDias(estado.data, direcao);
    else if (estado.vista === 'semana') estado.data = D.somarDias(estado.data, 7 * direcao);
    else estado.data = new Date(estado.data.getFullYear(), estado.data.getMonth() + direcao, 1);
    atualizar();
  }

  let pedido = 0; // ignora resposta antiga se a pessoa trocar de semana rápido
  async function atualizar() {
    ctx.atualizarQuery({ vista: estado.vista, data: D.paraInputData(estado.data) });
    const { inicio, fim } = periodo();
    tituloPeriodo.textContent =
      estado.vista === 'dia'
        ? D.dataLonga(inicio)
        : estado.vista === 'semana'
          ? D.rotuloPeriodo(inicio, D.somarDias(fim, -1))
          : D.mesAno(estado.data);

    const meu = ++pedido;
    corpo.classList.add('atualizando');
    try {
      const sessoes = await buscarSessoes(inicio, fim, estado.canceladas);
      if (meu !== pedido) return;
      if (estado.vista === 'semana') trocar(corpo, vistaSemana(sessoes, inicio));
      else if (estado.vista === 'dia') trocar(corpo, vistaDia(sessoes, inicio, irPara));
      else trocar(corpo, vistaMes(sessoes, inicio, fim, estado.data, irPara));
    } catch (erro) {
      if (meu === pedido) trocar(corpo, alerta('erro', mensagemDe(erro)));
    } finally {
      if (meu === pedido) corpo.classList.remove('atualizando');
    }
  }

  // Clique num dia (visão mês ou faixa de dias): abre a visão "dia".
  function irPara(data) {
    estado.data = data;
    estado.vista = 'dia';
    // Marca "Dia" no controle segmentado (último filho da barra).
    barra.lastChild.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === 0)));
    atualizar();
  }

  carregarLateral(lateral, subtitulo);
  await atualizar();
}

// ── Visão semana ─────────────────────────────────────────────────────

// Distribui sessões que se sobrepõem lado a lado (só acontece com
// canceladas visíveis: a agenda não deixa duas ativas no mesmo horário).
function distribuirColunas(sessoes) {
  const itens = [];
  let grupo = [];
  let fimGrupo = 0;
  const fecharGrupo = () => {
    const total = Math.max(...grupo.map((g) => g.coluna)) + 1;
    grupo.forEach((g) => {
      g.total = total;
    });
  };
  for (const s of [...sessoes].sort((a, b) => a.inicio - b.inicio)) {
    if (grupo.length && s.inicio >= fimGrupo) {
      fecharGrupo();
      grupo = [];
    }
    const ocupadas = grupo.filter((g) => g.s.fim > s.inicio).map((g) => g.coluna);
    let coluna = 0;
    while (ocupadas.includes(coluna)) coluna++;
    const item = { s, coluna, total: 1 };
    grupo.push(item);
    itens.push(item);
    fimGrupo = Math.max(fimGrupo, s.fim.getTime());
  }
  if (grupo.length) fecharGrupo();
  return itens;
}

function vistaSemana(sessoes, inicioSemana) {
  const hoje = new Date();
  // Domingo só aparece se tiver sessão (o mockup mostra segunda a sábado).
  const temDomingo = sessoes.some((s) => s.inicio.getDay() === 0);
  const dias = Array.from({ length: temDomingo ? 7 : 6 }, (_, i) => D.somarDias(inicioSemana, i));

  // Faixa de horas: 8h–20h, ampliada se houver sessão fora dela.
  let horaIni = HORA_INICIO_PADRAO;
  let horaFim = HORA_FIM_PADRAO;
  for (const s of sessoes) {
    horaIni = Math.min(horaIni, s.inicio.getHours());
    const fimNoMesmoDia = D.mesmoDia(s.inicio, s.fim);
    horaFim = Math.max(horaFim, fimNoMesmoDia ? Math.ceil(s.fim.getHours() + s.fim.getMinutes() / 60) : 24);
  }
  const horas = Array.from({ length: horaFim - horaIni }, (_, i) => horaIni + i);
  const alturaTotal = horas.length * ALTURA_HORA;
  const topoDe = (d) => ((d.getHours() - horaIni) * 60 + d.getMinutes()) * (ALTURA_HORA / 60);

  const grade = el('div', { class: 'semana' });
  grade.style.setProperty('--dias', dias.length);
  grade.style.setProperty('--altura-hora', `${ALTURA_HORA}px`);

  const cabecalhoDias = el(
    'div',
    { class: 'semana-cabecalho' },
    el('div'),
    dias.map((d) =>
      el(
        'div',
        { class: `semana-dia-titulo${D.mesmoDia(d, hoje) ? ' hoje' : ''}` },
        el('span', {}, D.semanaCurta(d).toUpperCase()),
        el('strong', {}, d.getDate()),
      ),
    ),
  );

  const colunaHoras = el(
    'div',
    { class: 'semana-horas' },
    horas.map((h) => el('div', {}, `${String(h).padStart(2, '0')}:00`)),
  );

  const colunasDias = dias.map((dia) => {
    const coluna = el('div', {
      class: `semana-dia${D.mesmoDia(dia, hoje) ? ' hoje' : ''}`,
      title: 'Clique num horário livre para agendar',
    });
    coluna.style.height = `${alturaTotal}px`;

    // Clique no espaço livre: novo agendamento já com o dia e a hora.
    coluna.addEventListener('click', (evento) => {
      if (evento.target !== coluna) return;
      const hora = horaIni + Math.floor(evento.offsetY / ALTURA_HORA);
      window.location.hash = linkNovo(dia, `${String(hora).padStart(2, '0')}:00`);
    });

    const doDia = sessoes.filter((s) => D.mesmoDia(s.inicio, dia));
    for (const { s, coluna: c, total } of distribuirColunas(doDia)) {
      const info = STATUS[s.status];
      // Sessão que passa da meia-noite: o bloco vai até o fim da coluna.
      const fundo = D.mesmoDia(s.inicio, s.fim) ? topoDe(s.fim) : alturaTotal;
      const evento = el(
        'a',
        {
          class: `evento evento-${info.classe}`,
          href: `#/agendamentos/${s.id}`,
          title: `${s.paciente.nome} — ${D.intervalo(s.inicio, s.fim)} · ${info.rotulo}`,
        },
        el('strong', {}, s.paciente.nome),
        el('span', {}, `${D.hora(s.inicio)} · ${info.rotulo}`),
      );
      evento.style.top = `${topoDe(s.inicio)}px`;
      evento.style.height = `${Math.max(fundo - topoDe(s.inicio), 24)}px`;
      evento.style.left = `calc(${(c / total) * 100}% + 4px)`;
      evento.style.width = `calc(${100 / total}% - 8px)`;
      coluna.append(evento);
    }

    // Linha do horário atual.
    if (D.mesmoDia(dia, hoje) && hoje.getHours() >= horaIni && hoje.getHours() < horaFim) {
      const linha = el('div', { class: 'agora', 'aria-hidden': 'true' });
      linha.style.top = `${topoDe(hoje)}px`;
      coluna.append(linha);
    }
    return coluna;
  });

  const corpoGrade = el('div', { class: 'semana-corpo' }, colunaHoras, colunasDias);
  grade.append(cabecalhoDias, corpoGrade);
  return el('div', { class: 'semana-rolagem' }, grade);
}

// ── Visão dia (também a do celular) ──────────────────────────────────

function vistaDia(sessoes, dia, irPara) {
  const hoje = new Date();
  const inicioSemana = D.inicioDaSemana(dia);
  const faixa = el(
    'div',
    { class: 'faixa-dias' },
    Array.from({ length: 7 }, (_, i) => D.somarDias(inicioSemana, i)).map((d) =>
      el(
        'button',
        {
          type: 'button',
          class: `${D.mesmoDia(d, dia) ? 'selecionado' : ''} ${D.mesmoDia(d, hoje) ? 'hoje' : ''}`.trim(),
          'aria-pressed': String(D.mesmoDia(d, dia)),
          onclick: () => irPara(d),
        },
        el('span', {}, D.semanaCurta(d)),
        el('strong', {}, d.getDate()),
      ),
    ),
  );

  const doDia = sessoes.filter((s) => D.mesmoDia(s.inicio, dia)).sort((a, b) => a.inicio - b.inicio);
  if (doDia.length === 0) {
    return el(
      'div',
      { class: 'dia' },
      faixa,
      el(
        'div',
        { class: 'vazio' },
        el('p', {}, 'Nenhuma sessão neste dia.'),
        botao('Agendar neste dia', { icone: 'mais', href: linkNovo(dia) }),
      ),
    );
  }

  const lista = el('div', { class: 'dia-lista' });
  let fimAnterior = null;
  for (const s of doDia) {
    const ativa = s.status !== 'CANCELADO';
    // Intervalo livre de 30 min ou mais entre duas sessões ativas.
    if (ativa && fimAnterior && D.minutosEntre(fimAnterior, s.inicio) >= 30) {
      lista.append(
        el('p', { class: 'dia-livre' }, el('span', {}, `Livre das ${D.hora(fimAnterior)} às ${D.hora(s.inicio)}`)),
      );
    }
    lista.append(
      el(
        'a',
        { class: `dia-sessao dia-sessao-${STATUS[s.status].classe}`, href: `#/agendamentos/${s.id}` },
        el('div', { class: 'dia-hora' }, el('strong', {}, D.hora(s.inicio)), el('span', {}, `${D.minutosEntre(s.inicio, s.fim)} min`)),
        el('div', { class: 'dia-info' }, el('strong', {}, s.paciente.nome), seloStatus(s.status)),
        icone('direita', 'dia-seta'),
      ),
    );
    if (ativa) fimAnterior = fimAnterior && fimAnterior > s.fim ? fimAnterior : s.fim;
  }
  return el('div', { class: 'dia' }, faixa, lista);
}

// ── Visão mês ────────────────────────────────────────────────────────

const MAX_POR_DIA = 3;

function vistaMes(sessoes, inicio, fim, referencia, irPara) {
  const hoje = new Date();
  const nomes = Array.from({ length: 7 }, (_, i) => D.semanaCurta(D.somarDias(inicio, i)));
  const celulas = [];
  for (let d = inicio; d < fim; d = D.somarDias(d, 1)) {
    const dia = d;
    const doDia = sessoes.filter((s) => D.mesmoDia(s.inicio, dia));
    const foraDoMes = dia.getMonth() !== referencia.getMonth();
    celulas.push(
      el(
        'div',
        { class: `mes-dia${foraDoMes ? ' fora' : ''}${D.mesmoDia(dia, hoje) ? ' hoje' : ''}` },
        el('button', { type: 'button', class: 'mes-numero', onclick: () => irPara(dia), 'aria-label': D.dataLonga(dia) }, dia.getDate()),
        doDia.slice(0, MAX_POR_DIA).map((s) =>
          el(
            'a',
            { class: `mes-evento evento-${STATUS[s.status].classe}`, href: `#/agendamentos/${s.id}`, title: `${s.paciente.nome} — ${D.intervalo(s.inicio, s.fim)}` },
            `${D.hora(s.inicio)} ${s.paciente.nome}`,
          ),
        ),
        doDia.length > MAX_POR_DIA &&
          el('button', { type: 'button', class: 'mes-mais', onclick: () => irPara(dia) }, `+${doDia.length - MAX_POR_DIA} mais`),
      ),
    );
  }
  return el(
    'div',
    { class: 'mes' },
    el('div', { class: 'mes-cabecalho' }, nomes.map((n) => el('div', {}, n))),
    el('div', { class: 'mes-grade' }, celulas),
  );
}

// ── Painel lateral: próximas sessões e pendências ────────────────────

async function carregarLateral(lateral, subtitulo) {
  const agora = new Date();
  try {
    const [proximas, recentes] = await Promise.all([
      buscarSessoes(D.inicioDoDia(agora), D.somarDias(agora, DIAS_PROXIMAS)),
      buscarSessoes(D.somarDias(agora, -DIAS_PENDENCIAS), agora),
    ]);

    const restantesHoje = proximas.filter((s) => s.status === 'AGENDADO' && D.mesmoDia(s.inicio, agora) && s.fim > agora);
    subtitulo.textContent =
      `${D.dataLonga(agora, { comAno: false })} · ` +
      (restantesHoje.length === 0
        ? 'nenhuma sessão restante hoje'
        : `${restantesHoje.length} ${restantesHoje.length === 1 ? 'sessão restante' : 'sessões restantes'} hoje`);

    const futuras = proximas.filter((s) => s.status === 'AGENDADO' && s.fim > agora).slice(0, 4);
    const aFechar = recentes.filter((s) => s.status === 'AGENDADO' && s.inicio <= agora);
    const semRegistro = recentes.filter((s) => s.status === 'REALIZADO' && !s.temRegistro);

    trocar(
      lateral,
      cartao(
        { titulo: 'Próximas sessões' },
        futuras.length === 0
          ? el('p', { class: 'texto-suave' }, `Nenhuma sessão agendada nos próximos ${DIAS_PROXIMAS} dias.`)
          : el(
              'ul',
              { class: 'lista-proximas' },
              futuras.map((s) =>
                el(
                  'li',
                  {},
                  el(
                    'a',
                    { href: `#/agendamentos/${s.id}` },
                    avatar(s.paciente.nome),
                    el('div', {}, el('strong', {}, s.paciente.nome), el('span', {}, `${D.quando(s.inicio)} – ${D.hora(s.fim)}`)),
                  ),
                ),
              ),
            ),
      ),
      cartao(
        { titulo: 'Pendências' },
        pendencia('Sessões a fechar', aFechar, 'Sessões que já começaram e ainda estão como agendadas: marque realizada, falta ou cancelada.'),
        pendencia('Registros a escrever', semRegistro, 'Sessões realizadas ainda sem registro de evolução.', (s) => `#/agendamentos/${s.id}/registro`),
        el('div', { class: 'pendencia pendencia-fixa' }, el('span', {}, 'Pagamentos pendentes'), emBreve('1.4.7')),
        el('p', { class: 'nota' }, `Considera os últimos ${DIAS_PENDENCIAS} dias.`),
      ),
    );
  } catch (erro) {
    trocar(lateral, alerta('erro', mensagemDe(erro)));
  }
}

function pendencia(titulo, sessoes, explicacao, link = (s) => `#/agendamentos/${s.id}`) {
  const contador = el('span', { class: `contador${sessoes.length ? ' contador-ativo' : ''}` }, sessoes.length);
  if (sessoes.length === 0) return el('div', { class: 'pendencia pendencia-fixa' }, el('span', {}, titulo), contador);
  return el(
    'details',
    { class: 'pendencia' },
    el('summary', {}, el('span', {}, titulo), contador),
    el('p', { class: 'nota' }, explicacao),
    el(
      'ul',
      {},
      [...sessoes]
        .sort((a, b) => b.inicio - a.inicio)
        .map((s) => el('li', {}, el('a', { href: link(s) }, `${D.diaMes(s.inicio)} · ${D.hora(s.inicio)} — ${s.paciente.nome}`))),
    ),
  );
}
