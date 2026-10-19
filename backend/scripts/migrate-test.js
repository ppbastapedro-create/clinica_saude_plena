// Aplica as migrações commitadas no banco de teste local (backend/.env.test),
// sem gerar nada novo — equivalente ao que o CI faz contra o service
// container do Postgres antes de rodar a suíte.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test') });
const { execSync } = require('child_process');

execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env, cwd: path.join(__dirname, '..') });
