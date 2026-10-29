# Backup e restauração — Saúde Plena

Pacote 1.6.1 da EAP. Critério de sucesso: **restauração de backup testada antes da
implantação**.

## Como funciona

Todo dia às 03:41 (Brasília), o workflow [`backup.yml`](../.github/workflows/backup.yml):

1. gera o dump do banco de produção (`pg_dump`, só o schema `public`);
2. **restaura o dump num Postgres descartável** e confere, tabela a tabela, se o número de
   linhas bate com o de produção. Se não bater, o workflow falha e o GitHub manda e-mail;
3. cifra o dump com **age**, usando a chave **pública**;
4. envia o arquivo cifrado a um **bucket privado** (Backblaze B2, compatível com S3):
   `diario/` todo dia e `mensal/` também no dia 1.

O teste de restauração do passo 2 roda a cada backup, e não só uma vez: um dump que nunca
foi restaurado não prova nada.

Os scripts ficam em [`backend/scripts/backup/`](../backend/scripts/backup/): `gerar-dump.sh`,
`restaurar.sh` e `conferir.sh`. O workflow e o simulado manual usam os mesmos scripts.

### Quem tem acesso a quê

| O quê | Onde fica | O que permite |
|---|---|---|
| Chave **pública** age | Variável do GitHub | Só cifrar. Não é segredo |
| Chave **privada** age | **Offline**: cofre de senhas e cópia impressa ou em pendrive | Decifrar os backups |
| `REGISTRO_CHAVE_V1` | Render, e cópia offline junto da chave age | Ler o conteúdo dos registros de sessão |
| Chave do bucket | Secret do GitHub, **só escrita** | Enviar arquivos. Não lê nem apaga |
| Usuário `backup_leitura` | Secret do GitHub | Ler o banco (não altera nada) |

**Duas chaves, dois cadeados.** Mesmo decifrado, o dump traz os registros de sessão ainda
cifrados com a `REGISTRO_CHAVE_V1`, que não está no backup. Dá para restaurar só com a chave
age, mas os registros só ficam legíveis com a `REGISTRO_CHAVE_V1` também. **Perder a
`REGISTRO_CHAVE_V1` é perder todos os registros de sessão, com ou sem backup.**

[a combinar com a parceira] Quem guarda as cópias offline das duas chaves. Sugestão: uma
cópia com a parceira (ela é a controladora dos dados) e outra com o autor enquanto ele der
suporte, em envelope lacrado ou no cofre de senhas.

### O que não vai no backup

- **Linhas da tabela `session`**, só a estrutura. Sessão é descartável, e o id guardado
  no banco equivale a um login. Depois de uma restauração, todo mundo entra de novo.
- **Schemas da plataforma do Supabase** (`auth`, `storage`...). O sistema não os usa, e um
  projeto novo já os traz.

### Retenção

Configurada nas regras de ciclo de vida do bucket:

| Prefixo | Guarda | Motivo |
|---|---|---|
| `diario/` | 35 dias | Desfazer um erro recente (algo apagado ou alterado por engano) |
| `mensal/` | 12 meses | Erro percebido tarde |

A guarda de 5 anos exigida pelo CFP é cumprida pelo **próprio banco**, já que o sistema não
apaga nada fisicamente. O backup protege contra perda do banco e não precisa repetir os 5
anos. Guardar cópia além do necessário vai contra o princípio de necessidade da LGPD (art. 6º,
III).

## Configuração (uma vez, na implantação)

Siga na ordem do [roteiro de implantação](implantacao.md), que indica em que ponto entra cada
passo.

### 1. Par de chaves age

No PowerShell, **fora da pasta do repositório**:

```powershell
winget install --id FiloSottile.age
# feche e abra o terminal para o PATH atualizar
age-keygen -o "$HOME\Documents\chave-backup-saude-plena.txt"
```

Se o winget não encontrar o pacote, baixe o `.zip` para Windows em
<https://github.com/FiloSottile/age/releases> e extraia `age.exe` e `age-keygen.exe`.

O comando imprime a chave pública (`Public key: age1...`). O arquivo gerado contém a chave
**privada** (`AGE-SECRET-KEY-1...`):

- guarde o conteúdo no cofre de senhas e faça a cópia offline combinada acima;
- depois, **apague o arquivo do computador**. Ele só volta a existir na hora de decifrar;
- nunca o coloque no repositório. O `.gitignore` bloqueia `chave-backup*`, mas não conte só
  com isso.

Se a parceira também for guardar uma chave própria, gere um segundo par. O workflow cifra
para as duas chaves, e qualquer uma das duas decifra.

### 2. Bucket no Backblaze B2

1. Crie a conta em <https://www.backblaze.com/cloud-storage> (a cota gratuita, de 10 GB,
   sobra para este sistema).
2. **Buckets → Create a Bucket**: nome único (ex.: `saude-plena-backup-<algo aleatório>`),
   **Private**, criptografia padrão do B2 ligada.
3. Na página do bucket, anote o **Endpoint** (ex.: `s3.us-east-005.backblazeb2.com`). A
   região é o pedaço do meio (`us-east-005`).
4. **Lifecycle Settings → Use custom lifecycle rules**:
   - prefixo `diario/`: ocultar após 35 dias, apagar 1 dia depois;
   - prefixo `mensal/`: ocultar após 365 dias, apagar 1 dia depois.
5. **Application Keys → Add a New Application Key**: acesso **só a este bucket**, tipo
   **Write Only**. Anote o `keyID` e a `applicationKey`, que aparece uma vez só.

Por que só escrita: se o secret vazar do GitHub, quem o pegar consegue enviar arquivos, mas
não consegue ler nem apagar os backups. Para baixar no simulado, use o login da conta no
site do B2.

### 3. Usuário só-leitura no Supabase

No **SQL Editor** do Supabase, depois do primeiro deploy (as tabelas já precisam existir).
Troque a senha por uma gerada no cofre de senhas:

```sql
create role backup_leitura with login password 'TROQUE-POR-UMA-SENHA-FORTE';
grant usage on schema public to backup_leitura;
grant select on all tables in schema public to backup_leitura;
grant select on all sequences in schema public to backup_leitura;
-- Tabelas que migrações futuras criarem também ficam legíveis:
alter default privileges for role postgres in schema public grant select on tables to backup_leitura;
alter default privileges for role postgres in schema public grant select on sequences to backup_leitura;
```

A URL fica no formato do **Session pooler** (Supabase → **Connect**), trocando o usuário:

```
postgresql://backup_leitura.<ref-do-projeto>:<senha>@<host-do-pooler>:5432/postgres
```

Use o pooler em modo **session** (porta 5432), não o *transaction* (6543), que não suporta
o `pg_dump`. A conexão direta (`db.<ref>.supabase.co`) também não serve: ela é só IPv6, e o
runner do GitHub não tem IPv6.

### 4. Secrets e variáveis no GitHub

**Settings → Secrets and variables → Actions**:

| Aba | Nome | Valor |
|---|---|---|
| Secrets | `BACKUP_DATABASE_URL` | URL do passo 3 |
| Secrets | `BACKUP_S3_ENDPOINT` | `https://` + endpoint do passo 2 |
| Secrets | `BACKUP_S3_BUCKET` | nome do bucket |
| Secrets | `BACKUP_S3_KEY_ID` | `keyID` |
| Secrets | `BACKUP_S3_SECRET` | `applicationKey` |
| Variables | `BACKUP_AGE_DESTINATARIOS` | chave(s) pública(s) `age1...`, uma por linha |
| Variables | `BACKUP_S3_REGIAO` | região do passo 2 (ex.: `us-east-005`) |
| Variables | `POSTGRES_VERSAO_PRODUCAO` | versão major do Postgres do Supabase (ex.: `17`) |

### 5. Primeira execução

**Actions → Backup → Run workflow**. O log deve mostrar todas as tabelas com `OK`,
`Conferência OK` e `Backup enviado: saude-plena-....dump.age`. Confira se o arquivo
apareceu em `diario/` no site do B2.

## Simulado de restauração (critério da EAP)

São duas partes, e **nenhuma delas põe dado real de paciente no computador do autor**:

- **Parte A**: todo o caminho com os dados **fictícios** do seed, no PC. Prova que os
  scripts, as chaves e os registros cifrados sobrevivem ao ciclo completo.
- **Parte B**: o caminho real de produção, **logo depois do primeiro deploy e antes de
  criar a conta da parceira**. Nesse momento o banco só tem a estrutura. Prova conexão,
  permissões, envio ao bucket e que a chave privada decifra um backup de produção.

Depois que houver dados reais, o teste diário do workflow garante que cada backup restaura.
Abrir um backup real fora da produção fica reservado para uma restauração de verdade (seção
seguinte).

Pré-requisitos no PC: Postgres 18 local (já instalado), age (passo 1) e Git Bash (vem com
o Git for Windows; no VS Code, terminal → **Git Bash**).

### Parte A: dados fictícios, no PC

No **Git Bash**, na raiz do repositório:

```bash
export PG_BIN="/c/Program Files/PostgreSQL/18/bin"
PASTA="$HOME/simulado-backup"; mkdir -p "$PASTA"     # fora do repositório
ORIGEM="postgresql://app_saude_plena:<senha>@localhost:5432/saude_plena"   # banco de dev (seed)
BASE="postgresql://app_saude_plena:<senha>@localhost:5432"

# 1. backup e cifra com a chave PÚBLICA (cole a sua age1...)
bash backend/scripts/backup/gerar-dump.sh "$ORIGEM" "$PASTA/b.dump"
age -r age1SUA_CHAVE_PUBLICA -o "$PASTA/b.dump.age" "$PASTA/b.dump"
rm "$PASTA/b.dump"

# 2. decifra com a chave PRIVADA (recupere o arquivo do cofre só agora)
age -d -i "$HOME/Documents/chave-backup-saude-plena.txt" -o "$PASTA/b.dump" "$PASTA/b.dump.age"

# 3. restaura num banco descartável e confere
"$PG_BIN/psql" "$BASE/postgres" -c "CREATE DATABASE saude_plena_simulado"
bash backend/scripts/backup/restaurar.sh "$PASTA/b.dump" "$BASE/saude_plena_simulado"
bash backend/scripts/backup/conferir.sh "$ORIGEM" "$BASE/saude_plena_simulado"
```

4\. Abra o sistema apontando para o banco restaurado e **leia um registro de sessão**. Isso
prova que a `REGISTRO_CHAVE_V1` abre o que veio do backup. No PowerShell, em `backend/`:

```powershell
$env:DATABASE_URL = "postgresql://app_saude_plena:<senha>@localhost:5432/saude_plena_simulado"
npm run dev
# entre no sistema, abra um paciente do seed e uma sessão com registro
Remove-Item Env:DATABASE_URL
```

5\. Limpeza (Git Bash):

```bash
"$PG_BIN/psql" "$BASE/postgres" -c "DROP DATABASE saude_plena_simulado"
rm -rf "$PASTA"
```

Por fim, apague de novo o arquivo da chave privada.

### Parte B: produção, antes dos dados reais

1. Depois do passo 5 da configuração (workflow verde), baixe o `.dump.age` de `diario/`
   pelo site do B2.
2. Decifre e restaure como nos passos 2 e 3 da Parte A, trocando `$ORIGEM` no
   `conferir.sh` pela `BACKUP_DATABASE_URL` (as tabelas devem estar vazias, exceto
   `_prisma_migrations`).
3. Faça a limpeza do passo 5 e apague o arquivo baixado.

### Registro de evidência

Preencha a cada simulado. Este é o documento que comprova o critério da EAP.

| Data | Parte | Arquivo de backup | Restaurou? | Conferência | Registro legível? | Quem fez |
|---|---|---|---|---|---|---|
|  | A |  |  |  |  |  |
|  | B |  |  |  | (sem registros) |  |

## Restauração de verdade (desastre)

Quando o banco de produção foi perdido ou corrompido. Faça com a parceira ciente, porque
ela é a controladora dos dados.

1. Crie um projeto novo no Supabase (ou use o mesmo, se o banco estiver acessível e vazio)
   e repita nele o **passo 1 do roteiro de implantação**: Data API desligada e revogações.
2. Baixe do bucket o backup certo: o diário mais recente, ou um anterior ao erro.
3. Decifre com a chave privada e restaure com o usuário `postgres` do projeto novo (URL do
   Session pooler):
   ```bash
   bash backend/scripts/backup/restaurar.sh b.dump "postgresql://postgres.<ref>:<senha>@<pooler>:5432/postgres"
   ```
4. Recrie o usuário `backup_leitura` (passo 3 da configuração) e atualize os secrets e as
   variáveis no Render e no GitHub com as URLs novas.
5. Entre no sistema e confira pacientes, agenda e um registro de sessão.
6. **Apague o dump decifrado e a chave privada do computador.** Ele contém dado real de
   saúde.

Os dados gravados entre o último backup e a perda não estão em backup nenhum, e é preciso
lançar de novo. Com backup diário, a perda máxima é de um dia.
