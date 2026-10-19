const path = require('path');

// Em dev local, carrega backend/.env.test (DATABASE_URL do banco de teste).
// Em CI, a variável DATABASE_URL já vem definida pelo workflow apontando pro
// service container do Postgres — dotenv não sobrescreve o que já existe.
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test') });
