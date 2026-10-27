const crypto = require('crypto');
const env = require('../config/env');

// Criptografia do conteúdo dos registros de sessão (dado sensível, LGPD
// art. 11), com AES-256-GCM.
//
// Por que GCM: além de cifrar, ele AUTENTICA. Junto com o cifrado sai uma
// "etiqueta" (authTag); se um único byte do cifrado, do IV ou da etiqueta for
// alterado no banco, a decifragem falha em vez de devolver texto adulterado.
//
// IV (vetor de inicialização): 12 bytes aleatórios, NOVOS a cada gravação.
// Reusar IV com a mesma chave no GCM é uma falha grave (permite recuperar
// dados); com IV aleatório, o mesmo texto gravado duas vezes gera cifrados
// diferentes.
//
// AAD (dado autenticado adicional) = id do agendamento: não é cifrado nem
// guardado, mas entra na etiqueta. Se alguém com acesso ao banco copiar o
// registro de uma sessão para outra, a decifragem falha — o conteúdo fica
// preso à sessão a que pertence.
const ALGORITMO = 'aes-256-gcm';
const BYTES_IV = 12; // tamanho recomendado para o GCM
const BYTES_TAG = 16;

// Chaves por versão. A coluna versaoChave guarda com qual chave cada registro
// foi cifrado; para trocar a chave no futuro, acrescenta-se a V2 aqui, grava
// com ela e decifra os antigos com a V1 (rotação). Hoje só existe a V1.
const CHAVES = { 1: Buffer.from(env.exigirSegredo('REGISTRO_CHAVE_V1'), 'hex') };
const VERSAO_ATUAL = 1;

const aadDe = (agendamentoId) => Buffer.from(String(agendamentoId), 'utf8');

function chaveDaVersao(versao) {
  const chave = CHAVES[versao];
  if (!chave) throw new Error(`Chave de criptografia versão ${versao} não configurada`);
  return chave;
}

function cifrar(texto, agendamentoId) {
  const iv = crypto.randomBytes(BYTES_IV);
  const cifra = crypto.createCipheriv(ALGORITMO, chaveDaVersao(VERSAO_ATUAL), iv, { authTagLength: BYTES_TAG });
  cifra.setAAD(aadDe(agendamentoId));
  const conteudoCifrado = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  return { conteudoCifrado, iv, authTag: cifra.getAuthTag(), versaoChave: VERSAO_ATUAL };
}

// Lança erro se qualquer parte tiver sido alterada, se o registro pertencer a
// outro agendamento ou se a versão da chave não existir. A mensagem do erro
// não contém nada do conteúdo.
function decifrar({ conteudoCifrado, iv, authTag, versaoChave }, agendamentoId) {
  const decifra = crypto.createDecipheriv(ALGORITMO, chaveDaVersao(versaoChave), Buffer.from(iv), {
    authTagLength: BYTES_TAG,
  });
  decifra.setAAD(aadDe(agendamentoId));
  decifra.setAuthTag(Buffer.from(authTag));
  return Buffer.concat([decifra.update(Buffer.from(conteudoCifrado)), decifra.final()]).toString('utf8');
}

module.exports = { cifrar, decifrar, VERSAO_ATUAL };
