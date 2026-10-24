// Registro de evolução da sessão (mockup, tela 7). Dado sensível (LGPD
// art. 11): o texto é cifrado no servidor, cada leitura e cada gravação vão
// para o log de acesso, e a API responde com Cache-Control: no-store.
//
// Aqui na tela:
// - o registro só é LIDO se existir (temRegistro), para não gerar leitura à toa;
// - sair com alteração não salva pede confirmação (podeSair);
// - ao sair, o texto é apagado do campo (desmontar).
import { api, mensagemDe } from '../api.js';
import { el, trocar } from '../dom.js';
import { icone } from '../icones.js';
import * as D from '../datas.js';
import { STATUS, alerta, numero } from '../formato.js';
import { cabecalho, botao, linkVoltar, cartao } from '../componentes.js';

// Mesmo teto do backend (MAX_CARACTERES em registros.controller.js) — mudou
// lá, mude aqui.
const MAX_CARACTERES = 20_000;
const MAX_ANTERIORES = 10;

const quandoCurto = (d) => `${D.diaMes(d)}, ${D.hora(d)}`;

export async function montar(raiz, ctx) {
  const id = ctx.params[0];
  ctx.titulo('Registro de evolução');
  const bruto = await api(`/agendamentos/${id}`);
  const ag = { ...bruto, inicio: new Date(bruto.inicio), fim: new Date(bruto.fim) };

  const topo = cabecalho({
    voltar: linkVoltar(`#/pacientes/${ag.paciente.id}`, ag.paciente.nome),
    titulo: 'Registro de evolução',
    subtitulo: `${ag.paciente.nome} · ${D.semanaLonga(ag.inicio)}, ${D.data(ag.inicio)} · ${D.intervalo(ag.inicio, ag.fim)} · ${STATUS[ag.status].rotulo}`,
  });

  if (ag.status !== 'REALIZADO') {
    trocar(
      raiz,
      topo,
      alerta('aviso', 'Só sessões realizadas recebem registro de evolução. Marque a sessão como realizada primeiro.'),
      el('p', {}, botao('Ir para a sessão', { href: `#/agendamentos/${id}` })),
    );
    return undefined;
  }

  const [registro, sessoes] = await Promise.all([
    ag.temRegistro ? api(`/agendamentos/${id}/registro`) : null,
    // Lista lateral: se falhar, o registro continua editável.
    api(`/pacientes/${ag.paciente.id}/sessoes`).catch(() => []),
  ]);

  let salvo = registro?.conteudo ?? '';
  let datas = registro ? { criadoEm: new Date(registro.criadoEm), atualizadoEm: new Date(registro.atualizadoEm) } : null;

  const texto = el('textarea', {
    class: 'campo registro-texto',
    id: 'registro-texto',
    maxlength: String(MAX_CARACTERES),
    placeholder: 'Descreva a evolução, as intervenções e os encaminhamentos da sessão…',
    autocomplete: 'off',
    value: salvo,
  });
  const contador = el('span', { class: 'contador-caracteres' });
  const infoDatas = el('span', { class: 'registro-datas' });
  const mensagens = el('div', { class: 'mensagens' });
  const botaoSalvar = botao('Salvar registro', { primario: true, icone: 'ok', type: 'submit' });

  function atualizarRodape() {
    const sujo = texto.value !== salvo;
    contador.textContent = `${numero(texto.value.length)} / ${numero(MAX_CARACTERES)}`;
    infoDatas.textContent = datas
      ? `Criado em ${quandoCurto(datas.criadoEm)} · Última alteração em ${quandoCurto(datas.atualizadoEm)}${sujo ? ' · alterações não salvas' : ''}`
      : sujo
        ? 'Ainda não salvo'
        : 'Sem registro ainda';
    botaoSalvar.disabled = !sujo || texto.value.trim() === '';
  }

  async function salvar(evento) {
    evento?.preventDefault();
    if (botaoSalvar.disabled) return;
    botaoSalvar.disabled = true;
    trocar(mensagens);
    const conteudo = texto.value;
    try {
      const resposta = await api(`/agendamentos/${id}/registro`, { metodo: 'PUT', corpo: { conteudo } });
      salvo = conteudo;
      datas = { criadoEm: new Date(resposta.criadoEm), atualizadoEm: new Date(resposta.atualizadoEm) };
      trocar(mensagens, alerta('sucesso', 'Registro salvo.'));
    } catch (erro) {
      trocar(mensagens, alerta('erro', mensagemDe(erro)));
    }
    atualizarRodape();
  }

  texto.addEventListener('input', () => {
    trocar(mensagens);
    atualizarRodape();
  });
  // Ctrl+S (ou Cmd+S) salva, em vez de abrir o "salvar página" do navegador.
  texto.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      salvar();
    }
  });

  const anteriores = sessoes
    .filter((s) => s.id !== id && s.status === 'REALIZADO' && new Date(s.inicio) < ag.inicio)
    .slice(0, MAX_ANTERIORES);

  trocar(
    raiz,
    topo,
    el(
      'div',
      { class: 'alerta alerta-info faixa-sigilo' },
      icone('cadeado'),
      el('p', {}, el('strong', {}, 'Conteúdo sigiloso. '), 'Guardado com criptografia. Cada leitura e cada alteração ficam registradas no log de acesso.'),
    ),
    el(
      'div',
      { class: 'grade-registro' },
      el(
        'form',
        { class: 'cartao', novalidate: true, onsubmit: salvar },
        el('div', { class: 'cartao-topo' }, el('label', { for: 'registro-texto' }, el('h2', {}, 'Evolução da sessão')), contador),
        texto,
        mensagens,
        el('div', { class: 'registro-rodape' }, infoDatas, botaoSalvar),
      ),
      cartao(
        { titulo: 'Sessões anteriores' },
        anteriores.length === 0
          ? el('p', { class: 'texto-suave' }, 'Nenhuma sessão realizada antes desta.')
          : el(
              'ul',
              { class: 'lista-anteriores' },
              anteriores.map((s) =>
                el(
                  'li',
                  {},
                  el(
                    'a',
                    { href: `#/agendamentos/${s.id}/registro` },
                    el('span', {}, D.data(new Date(s.inicio))),
                    el('small', {}, s.temRegistro ? 'Com registro' : 'Sem registro'),
                  ),
                ),
              ),
            ),
        el('p', { class: 'nota' }, 'Abrir um registro anterior também entra no log de acesso.'),
      ),
    ),
  );
  atualizarRodape();
  if (!salvo) texto.focus();

  return {
    podeSair: () => texto.value === salvo,
    desmontar: () => {
      texto.value = '';
      salvo = '';
    },
  };
}
