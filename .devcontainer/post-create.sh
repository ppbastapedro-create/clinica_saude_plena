#!/usr/bin/env bash
# Roda uma vez, quando o dev container é criado.
set -euo pipefail

cd backend

# Os .env não vão pro GitHub, então são gerados a partir dos .example. Dentro
# do container o Postgres é o serviço "db" na porta padrão 5432 — não o
# localhost:5433 do Docker Compose local.
#
# SESSION_SECRET e REGISTRO_CHAVE_V1 vêm vazios nos .example; aqui gera um
# valor aleatório e diferente para cada variável de cada arquivo.
gerar_segredo() { node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"; }

for par in ".env.example:.env" ".env.test.example:.env.test"; do
  origem="${par%%:*}"
  destino="${par##*:}"
  if [ ! -f "$destino" ]; then
    sed 's#localhost:5433#db:5432#' "$origem" > "$destino"
    sed -i "s#^SESSION_SECRET=\$#SESSION_SECRET=$(gerar_segredo)#" "$destino"
    sed -i "s#^REGISTRO_CHAVE_V1=\$#REGISTRO_CHAVE_V1=$(gerar_segredo)#" "$destino"
  fi
done

npm ci
npx prisma generate
