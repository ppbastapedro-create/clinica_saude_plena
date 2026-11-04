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

Quem envia é o workflow [`lembretes.yml`](../.github/workflows/lembretes.yml), de hora em
hora, pelo SMTP do Brevo. A API no Render **não** recebe nenhum dado de SMTP.

### 7.1 Conta no Brevo

1. Crie a conta em <https://www.brevo.com> (o plano gratuito envia 300 e-mails/dia, muito
   mais do que o consultório precisa). De preferência, a conta fica **em nome da
   parceira**: o Brevo passa a tratar nome, e-mail e horário dos pacientes dela (é um
   operador, na linguagem da LGPD), e os servidores dele ficam na União Europeia. Isso entra
   no termo junto com a transferência internacional do Render.
2. **Autentique o domínio** da parceira: *Senders, Domains & Dedicated IPs → Domains → Add a
   domain*. O Brevo mostra de 3 a 4 registros DNS (código `brevo-code`, DKIM e DMARC).
   Cadastre cada um no registro.br (*Domínio → DNS → Editar zona*), do mesmo jeito que foi
   feito com o CNAME do Render, e clique em *Verify* (pode levar algumas horas).
   **Por que:** sem DKIM/DMARC do próprio domínio, Gmail e Outlook tendem a jogar o lembrete
   no spam, ou até recusá-lo.
3. **Remetente:** *Senders → Add a sender*, com um endereço do domínio autenticado, por
   exemplo `lembretes@<domínio>`. Use um **nome neutro**, como "Consultório", sem
   "psicologia", "terapia" nem o nome da profissional. O corpo do e-mail já segue essa
   regra de sigilo, e o remetente aparece até na tela de bloqueio do celular.
4. **Chave SMTP:** *SMTP & API → SMTP → Generate a new SMTP key*. Anote na hora: ela não é
   mostrada de novo. O usuário SMTP é o *Login* dessa mesma tela (algo como
   `xxxxxx@smtp-brevo.com`). **Não** é a senha da conta do Brevo.

### 7.2 Secrets no GitHub

Em *Settings → Secrets and variables → Actions*:

| Nome | Tipo | Valor |
|---|---|---|
| `DATABASE_URL` | secret | A mesma URL do Render (Session pooler, usuário da aplicação). **Não** use a do `backup_leitura`: o job grava `lembreteEnviadoEm` |
| `SMTP_HOST` | secret | `smtp-relay.brevo.com` |
| `SMTP_PORT` | secret | `587` |
| `SMTP_USER` | secret | O *Login* da tela SMTP do Brevo |
| `SMTP_PASS` | secret | A chave SMTP gerada no passo 4 |
| `EMAIL_REMETENTE` | secret | `Consultório <lembretes@<domínio>>`, exatamente o remetente cadastrado no Brevo |
| `EMAIL_RESPONDER_PARA` | secret (opcional) | E-mail da parceira, para onde vai a resposta do paciente |
| `LEMBRETE_ANTECEDENCIA_HORAS` | **variável** (aba *Variables*) | `24`, até a parceira confirmar outro valor |

Também dá para cadastrar pelo terminal com o GitHub CLI. O `gh secret set` sem `--body`
**pede o valor** sem mostrá-lo na tela, e ele não fica no histórico do PowerShell:

```powershell
gh secret set SMTP_HOST      # digite: smtp-relay.brevo.com
gh secret set SMTP_PORT      # digite: 587
gh secret set SMTP_USER
gh secret set SMTP_PASS
gh secret set EMAIL_REMETENTE
gh secret set EMAIL_RESPONDER_PARA
gh variable set LEMBRETE_ANTECEDENCIA_HORAS --body 24
gh secret list               # confere os nomes (os valores nunca são mostrados)
```

**Não** cadastre `SESSION_SECRET` nem `REGISTRO_CHAVE_V1`: este job não lê prontuário
(princípio do menor privilégio).

### 7.3 Teste

1. **Produção:** *Actions → Lembretes → Run workflow*. O esperado é execução verde com
   `Enviados: 0`, já que ainda não há paciente com opt-in, consentimento vigente e sessão
   dentro da janela. Com isso ficam validados a conexão com o banco, o login SMTP (uma
   credencial errada falha aqui) e o `NODE_ENV=production`.
2. **Envio real:** em **homologação**, nunca com paciente de teste em produção (sem exclusão
   física, ele ficaria lá para sempre). Ponha os mesmos `SMTP_*` e `EMAIL_REMETENTE` no
   `backend/.env` do ambiente de homologação, edite um paciente fictício do seed com o
   **seu** e-mail, ative o lembrete, registre o consentimento, marque uma sessão para
   daqui a algumas horas e rode `npm run lembretes:enviar`. Confira se o e-mail chegou na
   caixa de entrada (e não no spam), o remetente e o texto. Depois, **tire os `SMTP_*` do
   `.env`** de homologação. É a tarefa de lembrete do
   [roteiro de aceitação](aceite/roteiro-aceitacao.md).

O workflow roda a cada hora no minuto 17 (UTC). Se uma execução falhar (SMTP fora do ar,
chave revogada), o GitHub avisa por e-mail o dono do repositório. O log mostra só ids de
agendamento e códigos de erro, nunca nome ou e-mail de paciente.

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
- [ ] Varredura do ZAP em produção: *Actions → Segurança (produção) → Run workflow*,
      informando a URL do domínio próprio (`https://...`). O relatório fica em *Artifacts →
      zap-producao*. Cada alerta é triado: corrigido, ou aceito em `.zap/rules.tsv` com o
      motivo. Registre o resultado em [seguranca-owasp.md](seguranca-owasp.md)
