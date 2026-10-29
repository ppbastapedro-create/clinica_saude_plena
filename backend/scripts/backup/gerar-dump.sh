#!/usr/bin/env bash
# Gera o dump do banco do Saúde Plena (formato custom do pg_dump).
#
#   bash backend/scripts/backup/gerar-dump.sh <URL do banco> <arquivo de saída>
#
# Usado pelo workflow de backup (.github/workflows/backup.yml) e no simulado de
# restauração (docs/backup-restauracao.md). Se pg_dump não estiver no PATH,
# informe a pasta em PG_BIN, ex.: PG_BIN="/c/Program Files/PostgreSQL/18/bin".
#
# A URL é a do driver `pg`, sem o "?schema=public" do Prisma (o pg_dump recusa
# parâmetros que não conhece).
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Uso: $0 <URL do banco> <arquivo de saída>" >&2
  exit 2
fi
ORIGEM=$1
SAIDA=$2

# --schema=public: só o que é do sistema. No Supabase o banco tem também os
#   schemas da plataforma (auth, storage...), que não são nossos e que um
#   projeto novo já traz prontos.
# --extension=btree_gist: com --schema, o pg_dump deixa as extensões de fora;
#   sem ela, a exclusion constraint da agenda não seria recriada.
# --no-owner/--no-privileges: o dono e as permissões de produção não existem
#   no banco onde se restaura; quem restaura vira o dono.
# --exclude-table-data=session: a estrutura vai, as linhas não. Sessão é
#   descartável e o id dela no banco equivale a um login — não deve ficar em
#   backup nenhum.
"${PG_BIN:+$PG_BIN/}pg_dump" \
  --format=custom \
  --schema=public \
  --extension=btree_gist \
  --no-owner \
  --no-privileges \
  --exclude-table-data=session \
  --file="$SAIDA" \
  "$ORIGEM"

echo "Dump gerado: $(wc -c < "$SAIDA" | tr -d ' ') bytes"
