// Lista de pacientes (mockup, tela 5): busca por nome/CPF, ativos ou
// arquivados, e a próxima sessão de cada um.
import { api, mensagemDe } from '../api.js';
import { el, trocar } from '../dom.js';
import { icone } from '../icones.js';
import * as D from '../datas.js';
import { avatar, alerta, cpfMascarado, telefone } from '../formato.js';
import { cabecalho, botao, segmentado, vazio, carregando } from '../componentes.js';
import { buscarSessoes } from './agenda.js';

const ESPERA_BUSCA_MS = 300;
const DIAS_PROXIMA_SESSAO = 100; // teto de período da API

export async function montar(raiz, ctx) {
  ctx.titulo('Pacientes');
  const estado = {
    busca: ctx.query.get('busca') ?? '',
    situacao: ctx.query.get('situacao') === 'arquivados' ? 'arquivados' : 'ativos',
  };

  const subtitulo = el('span');
  const corpo = el('div', { class: 'tabela-corpo' }, carregando());

  const campoBusca = el('input', {
    class: 'campo campo-com-icone',
    type: 'search',
    placeholder: 'Buscar por nome ou CPF',
    'aria-label': 'Buscar paciente por nome ou CPF',
    value: estado.busca,
  });
  let espera;
  campoBusca.addEventListener('input', () => {
    // Espera a pessoa parar de digitar antes de consultar (uma requisição
    // por pausa, não uma por tecla).
    clearTimeout(espera);
    espera = setTimeout(() => {
      estado.busca = campoBusca.value.trim();
      atualizar();
    }, ESPERA_BUSCA_MS);
  });

  trocar(
    raiz,
    cabecalho({
      titulo: 'Pacientes',
      subtitulo,
      acoes: [botao('Novo paciente', { primario: true, icone: 'mais', href: '#/pacientes/novo' })],
    }),
    el(
      'section',
      { class: 'cartao cartao-tabela' },
      el(
        'div',
        { class: 'tabela-barra' },
        el('div', { class: 'combo busca' }, icone('busca', 'combo-icone'), campoBusca),
        segmentado(
          [
            { valor: 'ativos', rotulo: 'Ativos' },
            { valor: 'arquivados', rotulo: 'Arquivados' },
          ],
          estado.situacao,
          (valor) => {
            estado.situacao = valor;
            atualizar();
          },
        ),
      ),
      corpo,
    ),
    el('p', { class: 'nota' }, 'Pacientes não são excluídos. Arquivar tira da lista de ativos e preserva o histórico pelo prazo de guarda (5 anos, Resolução CFP nº 001/2009).'),
  );

  // Próxima sessão de cada paciente: uma consulta só para a lista toda.
  const agora = new Date();
  const proximasPromessa = buscarSessoes(agora, D.somarDias(agora, DIAS_PROXIMA_SESSAO))
    .then((sessoes) => {
      const porPaciente = new Map();
      for (const s of sessoes) {
        if (s.status === 'AGENDADO' && s.inicio > agora && !porPaciente.has(s.paciente.id)) porPaciente.set(s.paciente.id, s);
      }
      return porPaciente;
    })
    .catch(() => new Map()); // sem a coluna, a lista ainda é útil

  let pedido = 0;
  async function atualizar() {
    ctx.atualizarQuery({ busca: estado.busca, situacao: estado.situacao === 'ativos' ? undefined : estado.situacao });
    const meu = ++pedido;
    try {
      const [lista, proximas] = await Promise.all([
        api('/pacientes', { query: { situacao: estado.situacao, ...(estado.busca ? { busca: estado.busca } : {}) } }),
        proximasPromessa,
      ]);
      if (meu !== pedido) return;

      const total = `${lista.length} ${lista.length === 1 ? 'paciente' : 'pacientes'} ${estado.situacao === 'ativos' ? (lista.length === 1 ? 'ativo' : 'ativos') : lista.length === 1 ? 'arquivado' : 'arquivados'}`;
      subtitulo.textContent = estado.busca ? `${total} para “${estado.busca}”` : total;

      if (lista.length === 0) {
        trocar(
          corpo,
          estado.busca
            ? vazio('Nenhum paciente encontrado para essa busca.')
            : estado.situacao === 'ativos'
              ? vazio('Nenhum paciente ativo ainda.', botao('Cadastrar paciente', { primario: true, icone: 'mais', href: '#/pacientes/novo' }))
              : vazio('Nenhum paciente arquivado.'),
        );
        return;
      }
      trocar(corpo, tabela(lista, proximas, estado.situacao));
    } catch (erro) {
      if (meu === pedido) trocar(corpo, alerta('erro', mensagemDe(erro)));
    }
  }

  await atualizar();
  return { desmontar: () => clearTimeout(espera) };
}

function tabela(lista, proximas, situacao) {
  const arquivados = situacao === 'arquivados';
  return el(
    'table',
    { class: 'tabela tabela-pacientes' },
    el(
      'thead',
      {},
      el('tr', {}, el('th', {}, 'Paciente'), el('th', {}, 'CPF'), el('th', {}, 'Telefone'), el('th', {}, arquivados ? 'Arquivado em' : 'Próxima sessão')),
    ),
    el(
      'tbody',
      {},
      lista.map((p) => {
        const proxima = proximas.get(p.id);
        const link = `#/pacientes/${p.id}`;
        const linha = el(
          'tr',
          { class: 'linha-clicavel' },
          el('td', { 'data-rotulo': 'Paciente' }, el('a', { class: 'celula-paciente', href: link }, avatar(p.nome), el('strong', {}, p.nome))),
          el('td', { 'data-rotulo': 'CPF' }, cpfMascarado(p.cpf)),
          el('td', { 'data-rotulo': 'Telefone' }, telefone(p.telefone)),
          el(
            'td',
            { 'data-rotulo': arquivados ? 'Arquivado em' : 'Próxima sessão', class: proxima || arquivados ? '' : 'texto-suave' },
            arquivados ? D.data(new Date(p.arquivadoEm)) : proxima ? D.quando(proxima.inicio) : 'Sem sessão marcada',
          ),
        );
        // A linha inteira leva à ficha; o link no nome continua sendo o
        // caminho para teclado e leitor de tela.
        linha.addEventListener('click', (e) => {
          if (!e.target.closest('a')) window.location.hash = link;
        });
        return linha;
      }),
    ),
  );
}
