// Detalhe do agendamento (mockup, tela 4): status, cobrança (valor e "cobrar
// ou não"), registro de evolução e situação do lembrete por e-mail.
// O recebimento em si é lançado na conta do paciente (ficha), porque um
// pagamento pode cobrir várias sessões.
//
// Os botões seguem as regras do backend (CLAUDE.md, "Regras de transição"),
// para a tela não oferecer o que a API vai recusar:
// - só AGENDADO muda de status ou é remarcada;
// - realizada/falta só depois do início; cancelar a qualquer momento.
// O backend confere tudo de novo — a tela só evita o clique inútil.
import { api, mensagemDe } from '../api.js';
import { el, trocar } from '../dom.js';
import * as D from '../datas.js';
import { STATUS, seloStatus, avatar, alerta, selo, valorParaCampo } from '../formato.js';
import { cabecalho, botao, linkVoltar, cartao } from '../componentes.js';

// Regra padrão de cobrança pelo status (igual a ehCobravel no backend):
// realizada cobra, falta não cobra. Usada para decidir quando "cobrar" volta
// a null (padrão) em vez de gravar true/false explícito.
const COBRA_POR_PADRAO = { REALIZADO: true, FALTA: false };

export async function montar(raiz, ctx) {
  const id = ctx.params[0];
  let mensagem = null; // alerta mostrado no cartão de status após uma ação
  let mensagemCobranca = null; // idem, no cartão de cobrança

  // PATCH altera só o que for enviado (valor e/ou cobrar).
  async function salvarCobranca(corpo, textoSucesso) {
    try {
      await api(`/agendamentos/${id}/cobranca`, { metodo: 'PATCH', corpo });
      mensagemCobranca = alerta('sucesso', textoSucesso);
    } catch (erro) {
      mensagemCobranca = alerta('erro', mensagemDe(erro));
    }
    await carregar();
  }

  function cartaoCobranca(ag) {
    const fechada = ag.status === 'REALIZADO' || ag.status === 'FALTA';
    const situacao = ag.status === 'CANCELADO' || ag.status === 'AGENDADO' ? null : ag.cobravel ? selo('Entra na conta', 'selo-agendado') : selo('Não cobrada', 'selo-cancelado');
    const topo = { titulo: 'Cobrança', icone: 'cartao', extra: situacao };
    const linkConta = el('p', { class: 'nota' }, el('a', { href: `#/pacientes/${ag.paciente.id}` }, 'Ver a conta do paciente e lançar recebimentos'));

    if (ag.status === 'CANCELADO') {
      return cartao(topo, el('p', { class: 'texto-suave' }, 'Sessão cancelada: não entra na conta do paciente.'), linkConta);
    }

    const campoValor = el('input', {
      class: 'campo',
      id: 'cobranca-valor',
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      placeholder: '0,00',
      value: valorParaCampo(ag.valor),
    });

    // Inverte a cobrança desta sessão. Se o resultado for igual à regra
    // padrão do status, grava null (volta ao padrão) em vez de true/false.
    const inverter = () => {
      const novo = !ag.cobravel;
      salvarCobranca({ cobrar: novo === COBRA_POR_PADRAO[ag.status] ? null : novo }, novo ? 'A sessão entrou na conta do paciente.' : 'A sessão não será cobrada.');
    };

    return cartao(
      topo,
      mensagemCobranca,
      el(
        'div',
        { class: 'grupo' },
        el('label', { class: 'rotulo', for: 'cobranca-valor' }, 'Valor da sessão'),
        el('div', { class: 'campo-moeda' }, el('span', {}, 'R$'), campoValor),
      ),
      fechada && ag.cobravel && !ag.valor && alerta('aviso', 'Sessão cobrável sem valor: defina o valor para ela entrar no saldo.'),
      el(
        'div',
        { class: 'acoes-status' },
        botao('Salvar valor', { onclick: () => salvarCobranca({ valor: campoValor.value.trim() || null }, 'Valor salvo.') }),
        fechada && botao(ag.cobravel ? 'Não cobrar esta sessão' : 'Cobrar esta sessão', { perigo: ag.cobravel, onclick: inverter }),
      ),
      el(
        'p',
        { class: 'nota' },
        ag.status === 'AGENDADO'
          ? 'Entra na conta do paciente quando for marcada como realizada.'
          : ag.status === 'FALTA'
            ? 'Falta não é cobrada automaticamente [regra a confirmar com a parceira]. Use "Cobrar esta sessão" se ela foi cobrada.'
            : 'Realizada entra na conta do paciente. Use "Não cobrar" para cortesia ou acerto.',
      ),
      linkConta,
    );
  }

  // Lembrete por e-mail (pacote 1.4.8): quem envia é o job de hora em hora
  // (GitHub Actions), não esta tela — aqui só se mostra a situação. Mesmas
  // regras do backend (lembretes.service): só AGENDADO, futura, com opt-in.
  function cartaoLembrete(ag, paciente) {
    const topo = { titulo: 'Lembrete por e-mail', icone: 'email' };
    const nota = (texto) => el('p', { class: 'texto-suave' }, texto);

    if (ag.lembreteEnviadoEm) {
      const enviado = new Date(ag.lembreteEnviadoEm);
      return cartao({ ...topo, extra: selo('Enviado', 'selo-realizado') }, nota(`Enviado em ${D.data(enviado)}, às ${D.hora(enviado)}.`));
    }
    if (ag.status !== 'AGENDADO') return cartao(topo, nota('Nenhum lembrete foi enviado para esta sessão.'));
    if (ag.inicio <= new Date()) return cartao(topo, nota('A sessão já começou: o lembrete não é mais enviado.'));
    if (!paciente.receberLembrete) {
      return cartao(
        topo,
        nota('Este paciente não recebe lembretes.'),
        el('p', { class: 'nota' }, el('a', { href: `#/pacientes/${paciente.id}` }, 'Ativar no cadastro do paciente'), ' (só com a concordância dele).'),
      );
    }
    return cartao(
      { ...topo, extra: selo('Pendente', 'selo-agendado') },
      nota('Sai automaticamente para o e-mail do paciente cerca de 24 h antes da sessão [antecedência a confirmar com a parceira].'),
      el('p', { class: 'nota' }, 'Remarcar a sessão faz o lembrete sair de novo, com o horário novo.'),
    );
  }

  async function carregar() {
    const bruto = await api(`/agendamentos/${id}`);
    const ag = { ...bruto, inicio: new Date(bruto.inicio), fim: new Date(bruto.fim) };
    // O agendamento traz só id e nome do paciente; o opt-in vem do cadastro.
    const paciente = await api(`/pacientes/${ag.paciente.id}`);
    ctx.titulo(`Sessão de ${ag.paciente.nome}`);
    renderizar(ag, paciente);
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

  function renderizar(ag, paciente) {
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

    trocar(
      raiz,
      cabecalho({
        voltar: linkVoltar(`#/agenda?data=${D.paraInputData(ag.inicio)}`, 'Agenda'),
        avatar: avatar(ag.paciente.nome, 'avatar-grande'),
        titulo: el('a', { class: 'link-titulo', href: `#/pacientes/${ag.paciente.id}` }, ag.paciente.nome),
        selo: seloStatus(ag.status),
        subtitulo: `${D.dataLonga(ag.inicio)} · ${D.intervalo(ag.inicio, ag.fim)}`,
      }),
      el('div', { class: 'grade-cartoes' }, cartaoStatus, cartaoCobranca(ag), cartaoRegistro, cartaoLembrete(ag, paciente)),
    );
    mensagemCobranca = null; // mostra uma vez só
  }

  await carregar();
}
