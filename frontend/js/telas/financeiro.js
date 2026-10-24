// Financeiro e relatório mensal (mockup, tela 8).
//
// Hoje mostra só o que a API já sabe: sessões do mês por status. Valores
// (recebido, a receber, pagamentos) dependem do pacote 1.4.7 — aparecem
// marcados como tal, sem números inventados.
import { mensagemDe } from '../api.js';
import { el, trocar } from '../dom.js';
import * as D from '../datas.js';
import { avatar, alerta, seloStatus, emBreve } from '../formato.js';
import { cabecalho, botao, segmentado, vazio, carregando } from '../componentes.js';
import { buscarSessoes } from './agenda.js';

const FILTROS = [
  { valor: 'todas', rotulo: 'Todas' },
  { valor: 'REALIZADO', rotulo: 'Realizadas' },
  { valor: 'FALTA', rotulo: 'Faltas' },
  { valor: 'CANCELADO', rotulo: 'Canceladas' },
];

export async function montar(raiz, ctx) {
  ctx.titulo('Financeiro');
  const pedido = /^\d{4}-\d{2}$/.test(ctx.query.get('mes') ?? '') ? D.deInputData(`${ctx.query.get('mes')}-01`) : null;
  const estado = { mes: D.inicioDoMes(pedido ?? new Date()), filtro: 'todas', sessoes: [] };

  const tituloMes = el('strong', { class: 'periodo' });
  const indicadores = el('div', { class: 'indicadores' }, carregando());
  const corpoTabela = el('div', { class: 'tabela-corpo' });

  trocar(
    raiz,
    cabecalho({
      titulo: 'Financeiro',
      subtitulo: 'Relatório mensal de sessões e recebimentos',
      acoes: [
        el(
          'div',
          { class: 'navegar-mes' },
          botao('', { icone: 'esquerda', rotulo: 'Mês anterior', onclick: () => mudarMes(-1) }),
          tituloMes,
          botao('', { icone: 'direita', rotulo: 'Próximo mês', onclick: () => mudarMes(1) }),
        ),
        botao('Imprimir', { icone: 'impressora', onclick: () => window.print() }),
      ],
    }),
    indicadores,
    el(
      'section',
      { class: 'cartao cartao-tabela' },
      el(
        'div',
        { class: 'tabela-barra' },
        el('h2', {}, 'Sessões do mês'),
        segmentado(FILTROS, estado.filtro, (valor) => {
          estado.filtro = valor;
          renderizarTabela();
        }),
      ),
      corpoTabela,
    ),
    el('p', { class: 'nota' }, 'Valores recebidos e a receber entram com o controle de pagamento por sessão (pacote 1.4.7). Critério de “recebido” e cobrança de faltas a validar com a parceira.'),
  );

  function mudarMes(direcao) {
    estado.mes = new Date(estado.mes.getFullYear(), estado.mes.getMonth() + direcao, 1);
    atualizar();
  }

  let pedidoAtual = 0;
  async function atualizar() {
    ctx.atualizarQuery({ mes: D.paraInputData(estado.mes).slice(0, 7) });
    tituloMes.textContent = D.mesAno(estado.mes);
    const meu = ++pedidoAtual;
    try {
      const inicio = estado.mes;
      const fim = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 1);
      // Só as sessões que COMEÇAM no mês (a API também traz as que só encostam).
      const sessoes = (await buscarSessoes(inicio, fim, true)).filter((s) => s.inicio >= inicio && s.inicio < fim);
      if (meu !== pedidoAtual) return;
      estado.sessoes = sessoes;
      renderizarIndicadores();
      renderizarTabela();
    } catch (erro) {
      if (meu === pedidoAtual) trocar(indicadores, alerta('erro', mensagemDe(erro)));
    }
  }

  function renderizarIndicadores() {
    const contar = (status) => estado.sessoes.filter((s) => s.status === status).length;
    const agora = new Date();
    const marcadas = estado.sessoes.filter((s) => s.status !== 'CANCELADO').length;
    const aFechar = estado.sessoes.filter((s) => s.status === 'AGENDADO' && s.inicio <= agora).length;

    const indicador = (titulo, valor, detalhe, classe = '') =>
      el('div', { class: `cartao indicador ${classe}`.trim() }, el('span', {}, titulo), el('strong', {}, valor), el('small', {}, detalhe));

    trocar(
      indicadores,
      indicador('Sessões realizadas', contar('REALIZADO'), `de ${marcadas} marcadas no mês`),
      indicador('Faltas', contar('FALTA'), 'Cobrança: [a confirmar]', 'indicador-falta'),
      indicador('Cancelamentos', contar('CANCELADO'), 'Não entram na cobrança'),
      indicador('A fechar', aFechar, 'Já começaram e seguem agendadas'),
      el(
        'div',
        { class: 'cartao indicador cartao-em-breve' },
        el('span', {}, 'Recebido / a receber'),
        emBreve('1.4.7'),
        el('small', {}, 'Depende do controle de pagamento'),
      ),
    );
  }

  function renderizarTabela() {
    const lista = estado.filtro === 'todas' ? estado.sessoes : estado.sessoes.filter((s) => s.status === estado.filtro);
    if (lista.length === 0) {
      trocar(corpoTabela, vazio('Nenhuma sessão neste filtro.'));
      return;
    }
    trocar(
      corpoTabela,
      el(
        'table',
        { class: 'tabela' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Sessão'), el('th', {}, 'Paciente'), el('th', {}, 'Status'))),
        el(
          'tbody',
          {},
          lista.map((s) =>
            el(
              'tr',
              {},
              el('td', { 'data-rotulo': 'Sessão' }, el('a', { href: `#/agendamentos/${s.id}` }, `${D.diaMes(s.inicio)} · ${D.hora(s.inicio)}`)),
              el('td', { 'data-rotulo': 'Paciente' }, el('span', { class: 'celula-paciente' }, avatar(s.paciente.nome, 'avatar-pequeno'), s.paciente.nome)),
              el('td', { 'data-rotulo': 'Status' }, seloStatus(s.status)),
            ),
          ),
        ),
      ),
    );
  }

  await atualizar();
}
