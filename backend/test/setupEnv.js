const path = require('path');

// Em dev local, carrega backend/.env.test (DATABASE_URL do banco de teste).
// Em CI, a variável DATABASE_URL já vem definida pelo workflow apontando pro
// service container do Postgres — dotenv não sobrescreve o que já existe.
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test'), quiet: true });

// Trava de segurança: os testes apagam dados. Se o DATABASE_URL apontar para
// qualquer banco cujo nome não termine em _test (ex.: o de desenvolvimento,
// por um .env.test faltando ou mal copiado), aborta antes de encostar nele.
const url = process.env.DATABASE_URL;
const nomeBanco = url ? new URL(url).pathname.replace(/^\//, '') : '';
if (!nomeBanco.endsWith('_test')) {
  throw new Error(
    `Testes abortados: DATABASE_URL aponta para o banco "${nomeBanco || '(vazio)'}", ` +
      'que não termina em _test. Confira backend/.env.test.',
  );
}
