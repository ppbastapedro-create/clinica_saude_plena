#!/usr/bin/env bash
# Roda uma vez, quando o dev container é criado.
set -euo pipefail

cd backend

# Os .env não vão pro GitHub, então são gerados a partir dos .example. Dentro
# do container o Postgres é o serviço "db" na porta padrão 5432 — não o
# localhost:5433 do Docker Compose local.
[ -f .env ] || sed 's#localhost:5433#db:5432#' .env.example > .env
[ -f .env.test ] || sed 's#localhost:5433#db:5432#' .env.test.example > .env.test

npm ci
npx prisma generate
