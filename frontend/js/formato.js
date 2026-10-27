// Formatação de dados para exibição e peças visuais repetidas (avatar,
// selo de status, aviso de "pacote futuro").
import { el } from './dom.js';
import { icone } from './icones.js';

// Status da sessão: rótulo na tela e classe CSS da cor.
export const STATUS = {
  AGENDADO: { rotulo: 'Agendada', classe: 'agendado' },
  REALIZADO: { rotulo: 'Realizada', classe: 'realizado' },
  FALTA: { rotulo: 'Falta', classe: 'falta' },
  CANCELADO: { rotulo: 'Cancelada', classe: 'cancelado' },
};

export function seloStatus(status) {
  const info = STATUS[status] ?? { rotulo: status, classe: '' };
  return el('span', { class: `selo selo-${info.classe}` }, info.rotulo);
}

export function selo(texto, classe = '') {
  return el('span', { class: `selo ${classe}`.trim() }, texto);
}

// "Maria Silva (fictícia)" → "MS". Ignora o que estiver entre parênteses.
export function iniciais(nome = '') {
  const partes = nome.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (primeira + ultima).toUpperCase();
}

export function avatar(nome, classeExtra = '') {
  return el('span', { class: `avatar ${classeExtra}`.trim(), 'aria-hidden': 'true' }, iniciais(nome));
}

// CPF completo (ficha): 000.111.222-33.
export function cpf(digitos = '') {
  const d = String(digitos).replace(/\D/g, '');
  if (d.length !== 11) return digitos;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

// CPF mascarado (listas): ***.111.222-**. Na lista o CPF completo não
// acrescenta nada e fica exposto a quem olhar a tela (LGPD: minimização).
export function cpfMascarado(digitos = '') {
  const d = String(digitos).replace(/\D/g, '');
  if (d.length !== 11) return '—';
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

// (61) 90000-0001 / (61) 3000-0001
export function telefone(digitos) {
  const d = String(digitos ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || '—';
}

// Máscaras aplicadas enquanto digita. O backend aceita com ou sem máscara.
export function mascararCpf(texto) {
  const d = texto.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

export function mascararTelefone(texto) {
  const d = texto.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export const numero = (n) => new Intl.NumberFormat('pt-BR').format(n);

// Dinheiro. A API manda o valor como texto com 2 casas ("180.50"); aqui ele
// só é formatado para exibir (as contas são feitas no backend, em centavos).
const fReais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const reais = (valor) => fReais.format(Number(valor));

// "180,50" digitado → "180.50" (ou null se não for um valor válido). Só para
// a prévia na tela; quem valida de verdade é o backend.
export function lerValor(texto) {
  const normalizado = String(texto ?? '').trim().replace(',', '.');
  return /^\d{1,8}(\.\d{1,2})?$/.test(normalizado) ? Number(normalizado).toFixed(2) : null;
}

// Valor da API ("180.50") → texto para o campo ("180,50").
export const valorParaCampo = (valor) => (valor ? valor.replace('.', ',') : '');

export const FORMAS_PAGAMENTO = { PIX: 'PIX', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão', TRANSFERENCIA: 'Transferência' };

// Cobrança de uma sessão nas listas: o valor e, quando for o caso, se ela
// ficou fora da conta ("não cobrada") ou está sem valor definido.
export function cobrancaDaSessao(s) {
  const fechada = s.status === 'REALIZADO' || s.status === 'FALTA';
  if (s.status === 'CANCELADO') return el('span', { class: 'texto-suave' }, '—');
  if (fechada && !s.cobravel) return el('span', { class: 'celula-cobranca' }, s.valor ? reais(s.valor) : '', selo('Não cobrada', 'selo-cancelado'));
  if (s.cobravel && !s.valor) return selo('Sem valor', 'selo-falta');
  return el('span', {}, s.valor ? reais(s.valor) : '—');
}

// Saldo da conta corrente: negativo = a receber; positivo = crédito.
export function seloSaldo(saldo) {
  const c = Number(saldo);
  if (c < 0) return selo(`A receber ${reais(-c)}`, 'selo-falta');
  if (c > 0) return selo(`Crédito ${reais(c)}`, 'selo-agendado');
  return selo('Em dia', 'selo-cancelado');
}

// Aviso de funcionalidade prevista na EAP mas ainda sem backend. Mostra o
// lugar da funcionalidade sem inventar dados.
export function emBreve(pacote) {
  return el('span', { class: 'selo selo-em-breve', title: `Previsto no pacote ${pacote} da EAP` }, `Pacote ${pacote}`);
}

// Caixa de alerta (erro, aviso, info, sucesso) com ícone.
const ICONE_ALERTA = { erro: 'erro', aviso: 'aviso', info: 'cadeado', sucesso: 'ok' };
export function alerta(tipo, ...conteudo) {
  return el(
    'div',
    { class: `alerta alerta-${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' },
    icone(ICONE_ALERTA[tipo] ?? 'erro'),
    el('p', {}, ...conteudo),
  );
}
