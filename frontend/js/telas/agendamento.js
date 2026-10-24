// Detalhe do agendamento (mockup, tela 4): status, registro de evolução e,
// quando os pacotes chegarem, pagamento e lembrete.
//
// Os botões seguem as regras do backend (CLAUDE.md, "Regras de transição"),
// para a tela não oferecer o que a API vai recusar:
// - só AGENDADO muda de status ou é remarcada;
// - realizada/falta só depois do início; cancelar a qualquer momento.
// O backend confere tudo de novo — a tela só evita o clique inútil.
import { api, mensagemDe } from '../api.js';
import { el, trocar } from '../dom.js';
import * as D from '../datas.js';
import { STATUS, seloStatus, avatar, alerta, emBreve } from '../formato.js';
import { cabecalho, botao, linkVoltar, cartao } from '../componentes.js';

export async function montar(raiz, ctx) {
  const id = ctx.params[0];
  let mensagem = null; // alerta mostrado no cartão de status após uma ação

  async function carregar() {
    const bruto = await api(`/agendamentos/${id}`);
    const ag = { ...bruto, inicio: new Date(bruto.inicio), fim: new Date(bruto.fim) };
    ctx.titulo(`Sessão de ${ag.paciente.nome}`);
    renderizar(ag);
  }

  async function mudarStatus(ag, status) {
    if (status === 'CANCELADO' && !window.confirm(`Cancelar a sessão de ${ag.paciente.nome} em ${D.data(ag.inicio)}, ${D.hora(ag.inicio)}? O cancelamento é definitivo.`)) {
      return;
    }
    try {
      await api(`/agendamentos/${id}/status`, { metodo: 'PATCH', corpo: { status } });
      mensagem = alerta('sucesso', `Sessão marcada como ${STATUS[status].rotulo.toLowerCase()}.`);
    } catch (erro) {
      mensagem = alerta('erro', mensagemDe(erro));
    }
    await carregar();
  }

  function renderizar(ag) {
    const agora = new Date();
    const aberta = ag.status === 'AGENDADO';
    const comecou = ag.inicio <= agora;

    const acoes = aberta
      ? el(
          'div',
          { class: 'acoes-status' },
          comecou && botao('Marcar como realizada', { primario: true, icone: 'ok', onclick: () => mudarStatus(ag, 'REALIZADO') }),
          comecou && botao('Registrar falta', { onclick: () => mudarStatus(ag, 'FALTA') }),
          botao('Remarcar', { href: `#/agendamentos/${id}/remarcar` }),
          botao('Cancelar sessão', { perigo: true, onclick: () => mudarStatus(ag, 'CANCELADO') }),
        )
      : null;

    const cartaoStatus = cartao(
      { titulo: 'Status da sessão', icone: 'relogio' },
      mensagem,
      aberta
        ? [
            !comecou && el('p', { class: 'texto-suave' }, 'Realizada e falta ficam disponíveis a partir do horário de início da sessão.'),
            acoes,
            el('p', { class: 'nota' }, 'Realizada, falta e cancelada são definitivas. Só sessões agendadas podem ser remarcadas.'),
          ]
        : el('p', {}, 'Esta sessão está ', seloStatus(ag.status), '. O status é definitivo.'),
    );
    mensagem = null; // mostra uma vez só

    const realizada = ag.status === 'REALIZADO';
    const cartaoRegistro = cartao(
      { titulo: 'Registro de evolução', icone: 'cadeado' },
      realizada
        ? [
            el(
              'p',
              { class: 'texto-suave' },
              ag.temRegistro
                ? 'Esta sessão já tem registro. O conteúdo é criptografado e cada leitura fica no log de acesso.'
                : 'Ainda sem registro. O conteúdo é criptografado no servidor.',
            ),
            botao(ag.temRegistro ? 'Abrir registro' : 'Escrever registro', {
              primario: !ag.temRegistro,
              href: `#/agendamentos/${id}/registro`,
            }),
          ]
        : el('p', { class: 'texto-suave' }, 'Liberado depois que a sessão for marcada como realizada. O conteúdo é criptografado.'),
    );

    const cartaoPagamento = cartao(
      { titulo: 'Pagamento', icone: 'cartao', extra: emBreve('1.4.7'), classe: 'cartao-em-breve' },
      el('p', { class: 'texto-suave' }, 'Valor, situação (pendente/pago) e forma de pagamento da sessão entram com o pacote Financeiro.'),
    );

    const cartaoLembrete = cartao(
      { titulo: 'Lembrete por e-mail', icone: 'email', extra: emBreve('1.4.8'), classe: 'cartao-em-breve' },
      el('p', { class: 'texto-suave' }, 'Envio automático para o e-mail do paciente antes da sessão [antecedência a confirmar com a parceira].'),
    );

    trocar(
      raiz,
      cabecalho({
        voltar: linkVoltar(`#/agenda?data=${D.paraInputData(ag.inicio)}`, 'Agenda'),
        avatar: avatar(ag.paciente.nome, 'avatar-grande'),
        titulo: el('a', { class: 'link-titulo', href: `#/pacientes/${ag.paciente.id}` }, ag.paciente.nome),
        selo: seloStatus(ag.status),
        subtitulo: `${D.dataLonga(ag.inicio)} · ${D.intervalo(ag.inicio, ag.fim)}`,
      }),
      el('div', { class: 'grade-cartoes' }, cartaoStatus, cartaoRegistro, cartaoPagamento, cartaoLembrete),
      el('p', { class: 'nota' }, 'Cobrança de falta: [regra a confirmar com a parceira] — não implementada.'),
    );
  }

  await carregar();
}
