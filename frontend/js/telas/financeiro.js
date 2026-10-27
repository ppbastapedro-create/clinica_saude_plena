// Financeiro (mockup, tela 8), no modelo de conta corrente por paciente.
//
// Duas partes:
// - O MÊS: quanto entrou (recebimentos pela data do pagamento — caixa, como
//   no caderno da parceira) e quanto foi atendido (sessões cobráveis).
// - OS SALDOS: quem está devendo e quem tem crédito de pacote. Não dependem
//   do mês — é a "planilha de a receber".
// Os números vêm prontos do backend, somados em centavos; a tela só exibe.
import { api, mensagemDe } from '../api.js';
import { el, trocar } from '../dom.js';
import * as D from '../datas.js';
import { avatar, alerta, reais, seloSaldo, selo, FORMAS_PAGAMENTO } from '../formato.js';
import { cabecalho, botao, segmentado, vazio, carregando } from '../componentes.js';

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

const FILTROS_SALDO = [
  { valor: 'aReceber', rotulo: 'A receber' },
  { valor: 'creditos', rotulo: 'Com crédito' },
  { valor: 'todos', rotulo: 'Todos' },
];
const FILTRAR_SALDO = {
  aReceber: (l) => Number(l.saldo) < 0,
  creditos: (l) => Number(l.saldo) > 0,
  todos: () => true,
};

export async function montar(raiz, ctx) {
  ctx.titulo('Financeiro');
  const pedido = /^\d{4}-\d{2}$/.test(ctx.query.get('mes') ?? '') ? D.deInputData(`${ctx.query.get('mes')}-01`) : null;
  const estado = { mes: D.inicioDoMes(pedido ?? new Date()), filtroSaldo: 'aReceber', saldos: null };

  const tituloMes = el('strong', { class: 'periodo' });
  const indicadoresMes = el('div', { class: 'indicadores' }, carregando());
  const avisos = el('div', { class: 'avisos-financeiro' });
  const indicadoresSaldo = el('div', { class: 'indicadores indicadores-saldo' });
  const corpoSaldos = el('div', { class: 'tabela-corpo' }, carregando());
  const corpoRecebimentos = el('div', { class: 'tabela-corpo' });

  trocar(
    raiz,
    cabecalho({
      titulo: 'Financeiro',
      subtitulo: 'Recebimentos do mês e saldo de cada paciente',
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
    indicadoresMes,
    avisos,
    el(
      'section',
      { class: 'cartao cartao-tabela secao-saldos' },
      el(
        'div',
        { class: 'tabela-barra' },
        el('div', {}, el('h2', {}, 'Saldos por paciente'), el('p', { class: 'nota' }, 'Situação de hoje, independente do mês.')),
        segmentado(FILTROS_SALDO, estado.filtroSaldo, (valor) => {
          estado.filtroSaldo = valor;
          renderizarSaldos();
        }),
      ),
      indicadoresSaldo,
      corpoSaldos,
    ),
    el('section', { class: 'cartao cartao-tabela' }, el('div', { class: 'tabela-barra' }, el('h2', {}, 'Recebimentos do mês')), corpoRecebimentos),
    el(
      'p',
      { class: 'nota' },
      'Recebido conta pela data do pagamento (um pacote pago em 30/09 entra em setembro). ',
      'Faltas não são cobradas automaticamente; crédito de pacote não vence. Critérios a validar com a parceira.',
    ),
  );

  function mudarMes(direcao) {
    estado.mes = new Date(estado.mes.getFullYear(), estado.mes.getMonth() + direcao, 1);
    atualizarMes();
  }

  let pedidoAtual = 0;
  async function atualizarMes() {
    const mes = D.paraInputData(estado.mes).slice(0, 7); // AAAA-MM
    ctx.atualizarQuery({ mes });
    tituloMes.textContent = D.mesAno(estado.mes);
    const meu = ++pedidoAtual;
    try {
      const relatorio = await api('/relatorios/mensal', { query: { mes } });
      if (meu !== pedidoAtual) return;
      renderizarMes(relatorio);
    } catch (erro) {
      if (meu === pedidoAtual) trocar(indicadoresMes, alerta('erro', mensagemDe(erro)));
    }
  }

  async function carregarSaldos() {
    try {
      estado.saldos = await api('/relatorios/saldos');
      renderizarSaldos();
    } catch (erro) {
      trocar(corpoSaldos, alerta('erro', mensagemDe(erro)));
    }
  }

  const indicador = (titulo, valor, detalhe, classe = '') =>
    el('div', { class: `cartao indicador ${classe}`.trim() }, el('span', {}, titulo), el('strong', {}, valor), el('small', {}, detalhe));

  function renderizarMes({ sessoes, financeiro, recebimentos }) {
    trocar(
      indicadoresMes,
      indicador('Recebido no mês', reais(financeiro.recebido.total), plural(financeiro.recebido.quantidade, 'recebimento', 'recebimentos'), 'indicador-recebido'),
      indicador('Atendido no mês', reais(financeiro.atendido.total), plural(financeiro.atendido.quantidade, 'sessão cobrável', 'sessões cobráveis')),
      indicador('Sessões realizadas', sessoes.realizadas, `de ${plural(sessoes.marcadas, 'marcada', 'marcadas')}`),
      indicador('Faltas', sessoes.faltas, financeiro.faltasCobradas ? `${plural(financeiro.faltasCobradas, 'cobrada', 'cobradas')}` : 'Nenhuma cobrada', 'indicador-falta'),
      indicador('Cancelamentos', sessoes.canceladas, 'Não entram na conta'),
    );

    const pontas = [];
    if (financeiro.semValor) {
      pontas.push(financeiro.semValor === 1 ? '1 sessão cobrável está sem valor e fora dos totais.' : `${financeiro.semValor} sessões cobráveis estão sem valor e fora dos totais.`);
    }
    if (sessoes.aFechar) {
      pontas.push(`${plural(sessoes.aFechar, 'sessão já começou e continua', 'sessões já começaram e continuam')} como agendada — marque realizada, falta ou cancelada.`);
    }
    if (financeiro.naoCobradas) pontas.push(`${plural(financeiro.naoCobradas, 'sessão realizada foi marcada', 'sessões realizadas foram marcadas')} como "não cobrar".`);
    trocar(avisos, pontas.length ? alerta('aviso', pontas.join(' ')) : null);

    if (recebimentos.length === 0) {
      trocar(corpoRecebimentos, vazio('Nenhum recebimento neste mês.'));
      return;
    }
    trocar(
      corpoRecebimentos,
      el(
        'table',
        { class: 'tabela' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Data'), el('th', {}, 'Paciente'), el('th', {}, 'Forma'), el('th', {}, 'Sessões'), el('th', { class: 'coluna-numero' }, 'Valor'))),
        el(
          'tbody',
          {},
          recebimentos.map((r) =>
            el(
              'tr',
              {},
              el('td', { 'data-rotulo': 'Data' }, D.data(new Date(r.recebidoEm))),
              el('td', { 'data-rotulo': 'Paciente' }, el('a', { class: 'celula-paciente', href: `#/pacientes/${r.paciente.id}` }, avatar(r.paciente.nome, 'avatar-pequeno'), r.paciente.nome)),
              el('td', { 'data-rotulo': 'Forma' }, FORMAS_PAGAMENTO[r.formaPagamento]),
              el('td', { 'data-rotulo': 'Sessões' }, r.sessoes ?? '—'),
              el('td', { 'data-rotulo': 'Valor', class: 'coluna-numero' }, reais(r.valor)),
            ),
          ),
        ),
      ),
    );
  }

  function renderizarSaldos() {
    const { totais, pacientes } = estado.saldos;
    trocar(
      indicadoresSaldo,
      indicador('A receber', reais(totais.aReceber.total), plural(totais.aReceber.pacientes, 'paciente devendo', 'pacientes devendo'), 'indicador-falta'),
      indicador('Créditos de pacote', reais(totais.creditos.total), plural(totais.creditos.pacientes, 'paciente com crédito', 'pacientes com crédito'), 'indicador-recebido'),
    );

    const lista = pacientes.filter(FILTRAR_SALDO[estado.filtroSaldo]);
    if (lista.length === 0) {
      const textos = { aReceber: 'Nenhum paciente devendo.', creditos: 'Nenhum paciente com crédito.', todos: 'Nenhum paciente com movimento.' };
      trocar(corpoSaldos, vazio(textos[estado.filtroSaldo]));
      return;
    }
    trocar(
      corpoSaldos,
      el(
        'table',
        { class: 'tabela' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', {}, 'Paciente'),
            el('th', { class: 'coluna-numero' }, 'Preço'),
            el('th', { class: 'coluna-numero' }, 'Cobrado'),
            el('th', { class: 'coluna-numero' }, 'Recebido'),
            el('th', {}, 'Saldo'),
            el('th', { class: 'so-tela coluna-acao' }, ''),
          ),
        ),
        el(
          'tbody',
          {},
          lista.map((l) =>
            el(
              'tr',
              {},
              el(
                'td',
                { 'data-rotulo': 'Paciente' },
                el('a', { class: 'celula-paciente', href: `#/pacientes/${l.paciente.id}` }, avatar(l.paciente.nome, 'avatar-pequeno'), l.paciente.nome),
                l.paciente.arquivadoEm && selo('Arquivado', 'selo-cancelado'),
                l.sessoesSemValor > 0 && selo(`${l.sessoesSemValor} sem valor`, 'selo-falta'),
              ),
              el('td', { 'data-rotulo': 'Preço', class: 'coluna-numero' }, l.valorSessao ? reais(l.valorSessao) : '—'),
              el('td', { 'data-rotulo': 'Cobrado', class: 'coluna-numero' }, reais(l.cobrado)),
              el('td', { 'data-rotulo': 'Recebido', class: 'coluna-numero' }, reais(l.recebido)),
              el('td', { 'data-rotulo': 'Saldo' }, seloSaldo(l.saldo)),
              el('td', { class: 'so-tela coluna-acao' }, el('a', { href: `#/pacientes/${l.paciente.id}` }, 'Lançar recebimento')),
            ),
          ),
        ),
      ),
    );
  }

  carregarSaldos();
  await atualizarMes();
}
