const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Custo do bcrypt: cada +1 dobra o tempo de cálculo. 12 leva ~0,3 s no
// bcryptjs (JS puro) — imperceptível num login, caro para quem tenta milhões
// de senhas a partir de um hash vazado.
const CUSTO_BCRYPT = 12;

// O bcrypt só considera os primeiros 72 bytes da senha; o resto seria
// ignorado em silêncio. Senhas maiores são recusadas na entrada.
const MAX_BYTES_SENHA = 72;

// Política para senha NOVA (criação/redefinição). Comprimento pesa mais que
// regras de "tem que ter símbolo": uma frase longa é mais forte e mais fácil
// de lembrar.
const MIN_CARACTERES_SENHA = 12;

// Devolve o motivo da recusa, ou null se a senha atende à política.
function problemaNaSenha(senha) {
  if (typeof senha !== 'string' || senha.length < MIN_CARACTERES_SENHA) {
    return `A senha precisa de pelo menos ${MIN_CARACTERES_SENHA} caracteres.`;
  }
  if (Buffer.byteLength(senha, 'utf8') > MAX_BYTES_SENHA) {
    return `A senha pode ter no máximo ${MAX_BYTES_SENHA} bytes.`;
  }
  return null;
}

function gerarHash(senha) {
  return bcrypt.hash(senha, CUSTO_BCRYPT);
}

function compararSenha(senha, hash) {
  return bcrypt.compare(senha, hash);
}

// Hash de uma senha aleatória, descartada. Quando o e-mail do login não
// existe, a senha digitada é comparada com ele mesmo assim: a resposta leva o
// mesmo tempo que uma senha errada, e o tempo não denuncia quais e-mails têm
// conta. Calculado uma vez só, na primeira vez que for preciso.
let hashFalso;
function obterHashFalso() {
  hashFalso ??= bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), CUSTO_BCRYPT);
  return hashFalso;
}

module.exports = {
  gerarHash,
  compararSenha,
  obterHashFalso,
  problemaNaSenha,
  CUSTO_BCRYPT,
  MAX_BYTES_SENHA,
  MIN_CARACTERES_SENHA,
};
