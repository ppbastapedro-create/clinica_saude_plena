// Ponto de entrada do sistema (app.html). Confere a sessão, preenche o menu
// lateral e troca de tela conforme o endereço depois do "#".
//
// Por que "#/agenda" e não "/agenda": tudo o que vem depois do # fica só no
// navegador — não é enviado ao servidor. Assim o Express só precisa servir
// app.html, e o voltar/avançar do navegador funciona sem configuração extra.
import { api, mensagemDe } from './api.js';
import { el, trocar } from './dom.js';
import { iniciais, alerta } from './formato.js';
import { carregando, botao } from './componentes.js';
import * as agenda from './telas/agenda.js';
import * as formAgendamento from './telas/agendamento-form.js';
import * as detalhe from './telas/agendamento.js';
import * as registro from './telas/registro.js';
import * as pacientes from './telas/pacientes.js';
import * as paciente from './telas/paciente.js';
import * as financeiro from './telas/financeiro.js';

// [padrão do caminho, função que monta a tela, item do menu marcado]
const ROTAS = [
  [/^\/agenda$/, agenda.montar, 'agenda'],
  [/^\/agenda\/novo$/, formAgendamento.montarNovo, 'agenda'],
  [/^\/agendamentos\/(\d+)$/, detalhe.montar, 'agenda'],
  [/^\/agendamentos\/(\d+)\/remarcar$/, formAgendamento.montarRemarcar, 'agenda'],
  [/^\/agendamentos\/(\d+)\/registro$/, registro.montar, 'pacientes'],
  [/^\/pacientes$/, pacientes.montar, 'pacientes'],
  [/^\/pacientes\/novo$/, paciente.montarNovo, 'pacientes'],
  [/^\/pacientes\/(\d+)$/, paciente.montarFicha, 'pacientes'],
  [/^\/financeiro$/, financeiro.montar, 'financeiro'],
];
const ROTA_INICIAL = '#/agenda';

const sistema = document.getElementById('sistema');
const conteudo = document.getElementById('conteudo');
const linksMenu = [...document.querySelectorAll('[data-menu]')];

let usuario = null;
let telaAtual = null; // o que a tela devolveu: { podeSair?, desmontar? }
let enderecoAtual = null;
let versao = 0; // descarta o resultado de uma tela que terminou de carregar depois de outra navegação

function lerEndereco() {
  const [caminho, query = ''] = window.location.hash.slice(1).split('?');
  return { caminho: caminho || '/', query: new URLSearchParams(query) };
}

// Telas com alteração não salva (registro de evolução) respondem false em
// podeSair(). Aí a navegação pede confirmação.
function podeSairDaTela() {
  if (!telaAtual?.podeSair || telaAtual.podeSair()) return true;
  return window.confirm('Há alterações não salvas. Sair desta tela e descartá-las?');
}

async function rotear() {
  if (telaAtual && !podeSairDaTela()) {
    // Desfaz a troca de endereço sem disparar outro hashchange.
    window.history.replaceState(null, '', enderecoAtual);
    return;
  }
  telaAtual?.desmontar?.();
  telaAtual = null;

  const { caminho, query } = lerEndereco();
  const encontrada = ROTAS.map(([padrao, montar, menu]) => ({ m: caminho.match(padrao), montar, menu })).find((r) => r.m);
  if (!encontrada) {
    window.location.replace(ROTA_INICIAL);
    return;
  }

  enderecoAtual = window.location.hash;
  linksMenu.forEach((a) => a.classList.toggle('ativo', a.dataset.menu === encontrada.menu));

  const raiz = el('div', { class: 'tela' }, carregando());
  trocar(conteudo, raiz);
  window.scrollTo(0, 0);
  conteudo.focus({ preventScroll: true }); // leitor de tela anuncia a tela nova

  const minhaVersao = ++versao;
  const ctx = {
    params: encontrada.m.slice(1).map(Number),
    query,
    usuario,
    titulo: (texto) => {
      document.title = `${texto} — Saúde Plena`;
    },
    // Atualiza o "?..." do endereço sem recarregar a tela (ex.: semana
    // exibida na agenda), para o voltar do navegador retornar ao mesmo ponto.
    atualizarQuery: (valores) => {
      const params = new URLSearchParams(Object.entries(valores).filter(([, v]) => v !== undefined && v !== ''));
      const novo = `#${caminho}${params.size ? `?${params}` : ''}`;
      window.history.replaceState(null, '', novo);
      enderecoAtual = novo;
    },
  };

  try {
    const resultado = await encontrada.montar(raiz, ctx);
    if (minhaVersao === versao) telaAtual = resultado ?? null;
  } catch (erro) {
    if (minhaVersao !== versao) return;
    trocar(raiz, alerta('erro', mensagemDe(erro)));
    if (!(erro?.status >= 400)) console.error(erro); // erro de código da página, não da API
  }
}

function preencherUsuario() {
  document.getElementById('usuario-iniciais').textContent = iniciais(usuario.nome);
  document.getElementById('usuario-nome').textContent = usuario.nome;
  document.getElementById('usuario-email').textContent = usuario.email;
}

document.getElementById('botao-sair').addEventListener('click', async () => {
  if (!podeSairDaTela()) return;
  telaAtual = null;
  try {
    await api('/auth/logout', { metodo: 'POST' });
  } finally {
    window.location.replace('login.html');
  }
});

// Fechar a aba ou recarregar com registro não salvo: o navegador pergunta.
window.addEventListener('beforeunload', (evento) => {
  if (telaAtual?.podeSair && !telaAtual.podeSair()) evento.preventDefault();
});

async function iniciar() {
  try {
    usuario = await api('/auth/me');
  } catch (erro) {
    if (erro.status === 401) return; // o api.js já mandou para o login
    trocar(document.body, el('div', { class: 'falha-inicial' }, alerta('erro', mensagemDe(erro))));
    return;
  }
  // Conta ADMIN não acessa dado clínico (a API responde 403 em tudo): em vez
  // de telas cheias de erro, uma explicação e o botão de sair.
  if (usuario.papel !== 'PSICOLOGO') {
    trocar(
      document.body,
      el(
        'div',
        { class: 'falha-inicial' },
        alerta('info', 'Esta conta é de administração. Agenda, pacientes, registros e financeiro são exclusivos da psicóloga (sigilo profissional). Contas são gerenciadas pelos scripts de terminal (npm run usuario:*).'),
        botao('Sair', { onclick: () => api('/auth/logout', { metodo: 'POST' }).finally(() => window.location.replace('login.html')) }),
      ),
    );
    return;
  }
  preencherUsuario();
  sistema.hidden = false;
  window.addEventListener('hashchange', rotear);
  if (!window.location.hash) window.location.replace(ROTA_INICIAL);
  else rotear();
}

iniciar();
