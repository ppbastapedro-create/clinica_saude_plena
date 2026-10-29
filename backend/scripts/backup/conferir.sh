#!/usr/bin/env bash
# Confere a restauração: cada tabela do public precisa ter o mesmo número de
# linhas na origem e no banco restaurado.
#
#   bash backend/scripts/backup/conferir.sh <URL da origem> <URL do restaurado>
#
# Só imprime nomes de tabela e OK/DIVERGENTE — nunca as contagens. O log do
# GitHub Actions é visível no repositório público, e até "quantos pacientes"
# é informação da parceira.
#
# A contagem da origem é feita depois do dump. Se alguém gravar algo no meio
# (madrugada, improvável), dá divergência falsa: rode o workflow de novo.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Uso: $0 <URL da origem> <URL do restaurado>" >&2
  exit 2
fi
PSQL="${PG_BIN:+$PG_BIN/}psql"

# Uma consulta só, sem SQL montado no shell: query_to_xml roda o count(*) de
# cada tabela listada pelo catálogo. A `session` fica de fora (o dump leva só
# a estrutura dela).
CONTAGEM="
select table_name || ' ' || (xpath('/row/n/text()',
         query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'session'
order by table_name"

contar() {
  "$PSQL" -X -At -v ON_ERROR_STOP=1 -d "$1" -c "$CONTAGEM" | tr -d '\r'
}

ORIGEM=$(contar "$1")
RESTAURADO=$(contar "$2")

# Junta as duas listas pelo nome da tabela; tabela que só existe de um lado
# também é divergência.
RESULTADO=$(awk '
  NR == FNR { origem[$1] = $2; next }
  { restaurado[$1] = $2 }
  END {
    for (t in origem)     print t, ((t in restaurado) && restaurado[t] == origem[t] ? "OK" : "DIVERGENTE")
    for (t in restaurado) if (!(t in origem)) print t, "DIVERGENTE"
  }' <(echo "$ORIGEM") <(echo "$RESTAURADO") | sort)

echo "$RESULTADO"
if [ -z "$RESULTADO" ] || grep -q DIVERGENTE <<< "$RESULTADO"; then
  echo "Conferência FALHOU." >&2
  exit 1
fi
echo "Conferência OK: todas as tabelas com o mesmo número de linhas."
