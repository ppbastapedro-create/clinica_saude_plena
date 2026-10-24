// Peças de interface repetidas entre as telas (cabeçalho, cartão, botão,
// controle segmentado, estado vazio).
import { el } from './dom.js';
import { icone } from './icones.js';

// Botão ou link com cara de botão (quando recebe href).
export function botao(texto, { primario, perigo, icone: nomeIcone, rotulo, href, onclick, type = 'button', disabled, classe = '' } = {}) {
  const classes = ['botao', primario && 'botao-primario', perigo && 'botao-perigo', !texto && 'botao-icone', classe]
    .filter(Boolean)
    .join(' ');
  const filhos = [nomeIcone && icone(nomeIcone), texto];
  if (href) return el('a', { class: classes, href, 'aria-label': rotulo }, ...filhos);
  return el('button', { class: classes, type, onclick, disabled, 'aria-label': rotulo, title: rotulo }, ...filhos);
}

export function linkVoltar(href, texto) {
  return el('a', { class: 'voltar', href }, icone('esquerda'), texto);
}

// Título da tela, com subtítulo, ações à direita e, opcionalmente, um
// avatar à esquerda e o link de voltar acima.
export function cabecalho({ titulo, subtitulo, acoes = [], voltar, avatar, selo }) {
  return el(
    'header',
    { class: 'cabecalho' },
    voltar,
    el(
      'div',
      { class: 'cabecalho-linha' },
      el(
        'div',
        { class: 'cabecalho-titulo' },
        avatar,
        el('div', {}, el('h1', {}, titulo, selo && ' ', selo), subtitulo && el('p', { class: 'subtitulo' }, subtitulo)),
      ),
      acoes.length > 0 && el('div', { class: 'cabecalho-acoes' }, ...acoes),
    ),
  );
}

export function cartao({ titulo, icone: nomeIcone, extra, classe = '' } = {}, ...conteudo) {
  return el(
    'section',
    { class: `cartao ${classe}`.trim() },
    titulo &&
      el(
        'div',
        { class: 'cartao-topo' },
        nomeIcone && el('span', { class: 'cartao-icone' }, icone(nomeIcone)),
        el('h2', {}, titulo),
        extra && el('div', { class: 'cartao-extra' }, extra),
      ),
    ...conteudo,
  );
}

// Grupo de botões em que só um fica ativo (Dia/Semana/Mês, Ativos/Arquivados).
export function segmentado(opcoes, atual, aoMudar) {
  const botoes = opcoes.map(({ valor, rotulo }) =>
    el('button', { type: 'button', 'aria-pressed': String(valor === atual), onclick: () => selecionar(valor) }, rotulo),
  );
  const elemento = el('div', { class: 'segmentado', role: 'group' }, ...botoes);
  function selecionar(valor) {
    opcoes.forEach((o, i) => botoes[i].setAttribute('aria-pressed', String(o.valor === valor)));
    aoMudar(valor);
  }
  return elemento;
}

export function vazio(texto, ...acoes) {
  return el('div', { class: 'vazio' }, el('p', {}, texto), acoes.length > 0 && el('div', { class: 'vazio-acoes' }, ...acoes));
}

export const carregando = (texto = 'Carregando…') => el('p', { class: 'carregando', role: 'status' }, texto);

// Linha "rótulo ........ valor" (cartões de resumo e detalhe).
export function linhaInfo(rotulo, valor) {
  return el('div', { class: 'linha-info' }, el('span', {}, rotulo), el('strong', {}, valor));
}
