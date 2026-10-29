#!/usr/bin/env bash
# Restaura um dump gerado por gerar-dump.sh num banco VAZIO.
#
#   bash backend/scripts/backup/restaurar.sh <arquivo .dump> <URL do banco destino>
#
# O dump precisa estar decifrado (age -d). Se pg_restore/psql não estiverem no
# PATH, informe a pasta em PG_BIN, ex.: PG_BIN="/c/Program Files/PostgreSQL/18/bin".
# O pg_restore precisa ser da mesma versão do pg_dump que gerou o arquivo, ou
# mais nova (o workflow usa a 18).
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Uso: $0 <arquivo .dump> <URL do banco destino>" >&2
  exit 2
fi
DUMP=$1
DESTINO=$2
PG_RESTORE="${PG_BIN:+$PG_BIN/}pg_restore"
PSQL="${PG_BIN:+$PG_BIN/}psql"

# Restaurar por cima de um banco com tabelas misturaria dados ou pararia no
# meio. Melhor recusar logo. (O tr tira o \r que o psql do Windows deixa.)
TABELAS=$("$PSQL" -X -At -v ON_ERROR_STOP=1 -d "$DESTINO" \
  -c "select count(*) from pg_tables where schemaname = 'public'" | tr -d '\r')
if [ "$TABELAS" != "0" ]; then
  echo "O banco destino já tem $TABELAS tabela(s) no schema public. Restaure num banco vazio." >&2
  exit 1
fi

LISTA=$(mktemp)
trap 'rm -f "$LISTA"' EXIT

# Duas entradas do dump saem da lista de restauração:
# - "CREATE SCHEMA public": com --schema=public o pg_dump grava esse comando,
#   que falha em qualquer banco novo (o public já vem criado);
# - "COMMENT ON EXTENSION": só o dono da extensão pode comentar, e no Supabase
#   não somos o dono.
"$PG_RESTORE" --list "$DUMP" \
  | grep -vE '^[0-9]+; [0-9]+ [0-9]+ (SCHEMA - public|COMMENT - EXTENSION) ' > "$LISTA"

# --single-transaction: restaura tudo ou nada (nunca um banco pela metade).
"$PG_RESTORE" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  --use-list="$LISTA" \
  --dbname="$DESTINO" \
  "$DUMP"

echo "Restauração concluída."
