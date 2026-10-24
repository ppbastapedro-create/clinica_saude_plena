const crypto = require('crypto');

// Sufixo aleatório, um por execução (cada arquivo de teste roda num processo
// próprio do Jest). Com e-mail fixo, uma execução interrompida antes do
// afterAll deixava o usuário no banco de teste, e a seguinte quebrava no
// UNIQUE do e-mail. Hexadecimal minúsculo: o e-mail continua igual depois da
// normalização (trim + toLowerCase) do login.
const EXECUCAO = crypto.randomBytes(4).toString('hex');

// emailUnico('agenda.a') → "agenda.a+3f9c01ab@exemplo.test"
const emailUnico = (local) => `${local}+${EXECUCAO}@exemplo.test`;

module.exports = { emailUnico, EXECUCAO };
