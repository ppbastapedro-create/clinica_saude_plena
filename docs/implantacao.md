# Roteiro de implantação — Saúde Plena

Pacote 1.6.1 da EAP. Ordem pensada para que o **simulado de restauração aconteça antes de
existir qualquer dado real** (ver [backup-restauracao.md](backup-restauracao.md)).

Resumo: **Supabase** (banco, São Paulo) → **Render** (API + frontend) → **backup** →
**simulado** → **conta da parceira** → **lembretes** → **aceite**.

Antes de começar, tenha um cofre de senhas (ex.: Bitwarden). Toda senha e chave deste
roteiro vai para lá, e nenhuma vai para arquivo dentro do repositório.

## 1. Supabase (banco de produção)

1. Crie o projeto em <https://supabase.com>:
   - **Region:** South America (São Paulo);
   - **Database password:** gerada no cofre;
   - **Data API desligada** (opção "Enable Data API" desmarcada na criação; depois, fica em
     **Project Settings → Data API**).

   Por que desligar: a Data API publica as tabelas do schema `public` como uma API REST.
   O sistema não a usa, porque conecta direto no Postgres. Ligada, ela seria uma segunda
   porta de entrada para os dados.

2. Anote a **versão do Postgres** (**Project Settings → Infrastructure**). Ela vai para:
   - a variável `POSTGRES_VERSAO_PRODUCAO` do GitHub (passo 3);
   - a imagem do CI (`ci.yml` e `seguranca.yml`), para o CI testar no que roda em produção.
     **Feito em 2026-10-27: produção é Postgres 17**. Se o Supabase mudar de versão principal,
     atualize os dois arquivos.

   Se "Enable automatic RLS" tiver ficado ligado na criação, desfaça antes do primeiro
   deploy (com RLS ligado, o `pg_dump` do `backup_leitura` falha):
   ```sql
   drop event trigger ensure_rls;
   drop function public.rls_auto_enable();
   ```

3. Copie a URL do **Session pooler** (**Connect** → *Session pooler*):
   ```
   postgresql://postgres.<ref>:<senha>@<host>.pooler.supabase.com:5432/postgres
   ```
   Use essa, e não a *Direct connection*: a direta é só IPv6, e nem o Render nem o GitHub
   Actions se conectam por IPv6. Também não use o *Transaction pooler* (porta 6543), que
   exige ajustes no Prisma e não suporta o `pg_dump`.

## 2. Segredos da API

No PowerShell, rode duas vezes (um valor para cada):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- `SESSION_SECRET`: assina o cookie de login. Se vazar, basta trocar (todo mundo entra
  de novo).
- `REGISTRO_CHAVE_V1`: cifra os registros de sessão. **Nunca pode ser perdida**: guarde no
  cofre e faça a cópia offline combinada em
  [backup-restauracao.md](backup-restauracao.md#quem-tem-acesso-a-quê).

Os dois precisam ser **novos**, nunca os do `.env` de desenvolvimento.

## 3. Render (API + frontend)

1. <https://render.com> → **New → Web Service** → conecte o repositório do GitHub,
   branch `main`.
2. Configuração:

   | Campo | Valor |
   |---|---|
   | Runtime | Node |
   | Root Directory | *(vazio: o servidor também serve a pasta `frontend/`)* |
   | Build Command | `cd backend && npm ci --include=dev && npx prisma generate && npx prisma migrate deploy && npm prune --omit=dev --omit=optional` |
   | Start Command | `cd backend && npm start` |
   | Instance Type | Free |
   | Auto-Deploy | *After CI Checks Pass*, se a opção aparecer (não publica commit com teste vermelho) |

   Sobre o build:
   - `--include=dev`: com `NODE_ENV=production`, o `npm ci` pula as devDependencies, e o
     `prisma` (o CLI) é uma delas. Sem ele, o `npx prisma` baixaria da internet a versão
     mais nova do Prisma, de outra versão principal;
   - `migrate deploy` aplica só as migrações já commitadas, nunca gera migração nova;
   - `npm prune` tira o CLI depois de usado. O servidor em execução fica só com as
     dependências de produção (ver A06 em [seguranca-owasp.md](seguranca-owasp.md)).

3. **Environment** (variáveis):

   | Nome | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `NODE_VERSION` | `24` |
   | `TZ` | `America/Sao_Paulo` |
   | `DATABASE_URL` | URL do Session pooler (passo 1.3) |
   | `SESSION_SECRET` | passo 2 |
   | `REGISTRO_CHAVE_V1` | passo 2 |

   Os dados de SMTP **não** vão aqui. Quem envia os lembretes é o GitHub Actions.

4. Faça o deploy e abra `https://<nome>.onrender.com`. Deve aparecer a tela de login, com
   cadeado (HTTPS) no navegador.

No plano gratuito o serviço **dorme** depois de 15 min sem acesso, e o primeiro acesso
seguinte demora cerca de 1 min. Avise a parceira. Por isso os lembretes e o backup rodam no
GitHub Actions, e não dentro da API.

**Atenção (LGPD):** o Render não tem região na América do Sul. O banco fica em São Paulo,
mas a API processa os dados nos EUA ou na Europa, conforme a região escolhida. Isso é
transferência internacional (LGPD art. 33) e deve aparecer no termo de consentimento e no
relatório. Combine com a parceira.

## 4. Revogações no banco (depois do primeiro deploy)

Com as tabelas criadas pelo `migrate deploy`, rode no **SQL Editor** do Supabase:

```sql
-- Defesa em profundidade além da Data API desligada: os papéis da API do
-- Supabase não enxergam nada do schema public.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
revoke usage on schema public from anon, authenticated;
```

O **Security Advisor** do Supabase vai reclamar de "RLS disabled" nas tabelas. É esperado:
RLS protege acesso pela Data API, que está desligada, e o sistema controla o acesso na
própria API.

## 5. Backup e simulado de restauração

Siga [backup-restauracao.md](backup-restauracao.md):

1. **Configuração**, passos 1 a 5 (chaves age, bucket, `backup_leitura`, secrets, primeira
   execução);
2. **Simulado**, partes A e B, preenchendo o registro de evidência.

**Não continue enquanto o simulado não passar.** É critério de sucesso da EAP, e depois da
conta da parceira o banco passa a ter dado real.

## 6. Conta da parceira

Com ela ao lado, para que **ela** digite a senha. No PowerShell, em `backend/`:

```powershell
$env:DATABASE_URL = "<URL do Session pooler>"
npm run usuario:criar        # papel: PSICOLOGO
Remove-Item Env:DATABASE_URL
```

A variável definida no terminal vale só para essa janela e tem prioridade sobre o `.env`.
O `Remove-Item` evita rodar outro comando contra produção sem querer. Feche o terminal em
seguida.

## 7. Lembretes por e-mail

Configure o Brevo e os secrets descritos no cabeçalho de
[`lembretes.yml`](../.github/workflows/lembretes.yml) (`DATABASE_URL` = URL do Session
pooler). Teste com **Actions → Lembretes → Run workflow**.

## 8. Conferência final

- [ ] Login funciona em `https://...onrender.com`, só com HTTPS
- [ ] `ci.yml` usa a mesma versão do Postgres do Supabase, e o CI está verde
- [ ] Data API desligada e revogações aplicadas
- [ ] Workflow **Backup** verde, com arquivo no bucket
- [ ] Simulado de restauração A e B registrado
- [ ] Cópias offline da chave age e da `REGISTRO_CHAVE_V1` entregues
- [ ] Conta da parceira criada por ela
- [ ] Workflow **Lembretes** roda sem erro em produção. O envio real é testado em
      homologação ([aceite/roteiro-aceitacao.md](aceite/roteiro-aceitacao.md)), **não** com
      um paciente de teste em produção: sem exclusão física, ele ficaria lá para sempre
- [ ] Varredura do ZAP feita (ela roda contra o servidor local do CI; para produção, rode o
      ZAP baseline apontando para a URL do Render, uma vez, e registre o resultado no
      checklist de segurança)
