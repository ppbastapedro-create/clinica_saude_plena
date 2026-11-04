# Saúde Plena — Agendamento e Prontuário para Atendimento Psicológico

Sistema web para uma psicóloga autônoma organizar a agenda, os pacientes, o registro de
evolução de cada sessão e o financeiro do consultório.

Projeto Integrador de TI do CEUB (2º/2026), uma Atividade Curricular de Extensão (ACE)
feita com uma parceira real da comunidade externa, uma psicóloga do DF. Orientação do
Prof. Daniel Barbosa Santos.

> O sistema tem **uma usuária só, a psicóloga**. O paciente não acessa o sistema.

## Funcionalidades

- **Login** com sessão no banco, bloqueio por tentativas e expiração por inatividade.
- **Pacientes:** cadastro com validação de CPF, preço padrão da sessão e arquivamento
  lógico (nada é apagado: a guarda mínima é de 5 anos, pela Resolução CFP nº 001/2009).
- **Agenda** em calendário (FullCalendar): marcar, remarcar, cancelar, registrar
  realização ou falta. O banco impede sessões sobrepostas.
- **Registro de evolução** por sessão, **cifrado em repouso** (AES-256-GCM). Toda leitura
  e escrita fica registrada no log de auditoria.
- **Financeiro em conta corrente por paciente:** a sessão realizada gera débito e o
  recebimento gera crédito. Atende pacote, sessão avulsa e pagamento adiantado.
- **Relatório mensal:** sessões realizadas, faltas, valor atendido e valor recebido, mais o
  saldo de cada paciente.
- **Lembrete de sessão por e-mail**, só para paciente com opt-in e consentimento vigente.
- **Termo de consentimento LGPD:** modelo imprimível, mais o registro e a revogação do
  aceite.
- **Backup diário cifrado**, com teste de restauração a cada execução.

Fora do escopo: teleconsulta, nota fiscal, convênios, aplicativo nativo (o site é
responsivo), WhatsApp e acesso do paciente.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js 24 + Express 5, em camadas: rotas → controllers → services → repositórios |
| Banco | PostgreSQL via Prisma ORM, com migrações versionadas. Em produção, Supabase (São Paulo) |
| Autenticação | bcryptjs + express-session + connect-pg-simple (cookie `HttpOnly`, `Secure`, `SameSite=Strict`) |
| Segurança | Helmet (CSP sem `unsafe-inline`), express-rate-limit, Zod, AES-256-GCM (`crypto` nativo) |
| E-mail | Nodemailer + Brevo (SMTP) |
| Frontend | HTML, CSS e JavaScript puros (sem framework, sem build), FullCalendar |
| Testes | Jest + Supertest, cobertura mínima de 70% |
| CI e rotinas | GitHub Actions: testes, OWASP ZAP, lembretes de hora em hora, backup diário |
| Hospedagem | Render |

## Estrutura

```
├── backend/
│   ├── src/
│   │   ├── routes/          # URLs e middlewares de acesso (exigirPapel)
│   │   ├── controllers/     # lê a requisição, chama o service, responde
│   │   ├── services/        # regras de negócio (conflito, status, saldo...)
│   │   ├── repositories/    # acesso ao banco (Prisma / SQL)
│   │   ├── middlewares/     # autenticação, erros, limite de taxa, id da requisição
│   │   ├── config/          # variáveis de ambiente, Prisma, sessão, e-mail
│   │   └── utils/           # CPF, criptografia, datas, dinheiro, validação
│   ├── prisma/              # schema.prisma, migrações, seed fictício
│   ├── scripts/             # contas de usuário, lembretes, backup/restauração
│   ├── test/                # unit/ e integration/
│   ├── testes.http          # requisições para a extensão REST Client do VS Code
│   └── server.js, data/     # Projeto 3 (histórico, não roda mais; ver abaixo)
├── frontend/                # login, aplicação, termo de consentimento
├── docs/                    # segurança, implantação, backup, aceite
├── db/init/                 # cria o banco de testes no Postgres do docker-compose
├── .github/workflows/       # ci, seguranca, seguranca-producao, lembretes, backup
├── .devcontainer/           # ambiente pronto para Codespaces
└── docker-compose.yml       # Postgres local
```

## Como rodar localmente

Pré-requisitos: **Node.js 24** e um **PostgreSQL 16 ou mais recente**. Há três opções:

- **Docker:** `docker compose up -d` na raiz sobe o Postgres 16 na porta **5433**, já com
  os bancos `saude_plena` e `saude_plena_test`. Antes, copie `.env.example` para `.env`.
- **Codespaces / devcontainer:** abra o repositório no Codespaces. O `post-create.sh`
  instala tudo e gera os `.env`.
- **Postgres instalado na máquina:** crie um usuário dono dos bancos `saude_plena` e
  `saude_plena_test`, com permissão `CREATEDB` (o `prisma migrate dev` precisa dela para o
  *shadow database*). Ajuste o `DATABASE_URL` do `backend/.env`.

Os comandos `npm` rodam **dentro de `backend/`** (o `package.json` fica lá):

```powershell
cd backend
npm install
copy .env.example .env      # preencha SESSION_SECRET e REGISTRO_CHAVE_V1 (veja o próprio arquivo)
npx prisma migrate dev      # cria as tabelas
npm run db:seed             # dados FICTÍCIOS de demonstração
npm run usuario:criar       # cria a conta de acesso (a senha é digitada no terminal)
npm run dev                 # http://localhost:3000
```

Para gerar os dois segredos:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Nunca use dados reais de pacientes fora da produção.** O seed e os testes usam só
> dados fictícios.

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` / `npm start` | Sobe a API e o frontend (com e sem recarga automática) |
| `npm test` | Roda os testes no banco `saude_plena_test`. Antes, uma vez: copie `.env.test.example` para `.env.test` e rode `npm run db:test:migrate` |
| `npm run test:cobertura` | Testes com relatório de cobertura (`coverage/`) |
| `npm run db:seed` | Popula o banco de desenvolvimento com dados fictícios |
| `npm run prisma:studio` | Abre o Prisma Studio para inspecionar o banco |
| `npm run usuario:criar` / `usuario:senha` / `usuario:email` | Gerenciam contas pelo terminal (não há rota HTTP para isso, de propósito) |
| `npm run lembretes:enviar` | Envia os lembretes pendentes. Sem `SMTP_HOST`, só simula |

## API

Todas as rotas exigem login, exceto `POST /auth/login`, `POST /auth/logout` e `GET /health`.
As rotas clínicas exigem o papel `PSICOLOGO`: o `ADMIN` só gerencia contas e não vê dado
clínico (sigilo profissional).

| Método | Rota | Função |
|---|---|---|
| POST | `/auth/login` · `/auth/logout` | Entrar e sair |
| GET | `/auth/me` | Usuário logado |
| GET · POST | `/pacientes` | Listar e cadastrar |
| GET · PUT | `/pacientes/:id` | Ver e editar |
| PATCH | `/pacientes/:id/arquivar` · `/reativar` | Arquivamento lógico |
| GET | `/pacientes/:id/sessoes` | Sessões do paciente |
| GET | `/pacientes/:id/financeiro` | Extrato (débitos, créditos, saldo) |
| POST | `/pacientes/:id/recebimentos` | Registrar recebimento |
| GET · POST | `/pacientes/:id/consentimentos` | Histórico e registro de aceite do termo |
| PATCH | `/pacientes/:id/consentimentos/revogar` | Revogar o consentimento |
| GET · POST | `/agendamentos` | Listar (por período) e marcar |
| GET · PUT | `/agendamentos/:id` | Ver e remarcar (só `AGENDADO`) |
| PATCH | `/agendamentos/:id/status` | `REALIZADO`, `FALTA` ou `CANCELADO` |
| PATCH | `/agendamentos/:id/cobranca` | Cobrar ou não a sessão (exceção ao padrão) |
| GET · PUT | `/agendamentos/:id/registro` | Ler e salvar o registro de evolução (cifrado) |
| PATCH | `/recebimentos/:id/estornar` | Estornar um lançamento (não apaga) |
| GET | `/relatorios/mensal` | Relatório do mês |
| GET | `/relatorios/saldos` | Saldo de cada paciente |

## Segurança e LGPD

O registro de evolução é dado sensível de saúde (LGPD, art. 11). Em resumo:

- Conteúdo cifrado com AES-256-GCM. A chave fica fora do banco e fora do backup.
- Log de auditoria de logins e de todo acesso a registro de evolução.
- Sem exclusão física: arquivamento, cancelamento e estorno no lugar de `DELETE`.
- Checklist OWASP Top 10, varredura ZAP automatizada e Dependabot.

Detalhes em [docs/seguranca-owasp.md](docs/seguranca-owasp.md).

## Documentação

- [docs/implantacao.md](docs/implantacao.md): roteiro de implantação (Supabase, Render,
  domínio, lembretes)
- [docs/backup-restauracao.md](docs/backup-restauracao.md): backup cifrado e como
  restaurar
- [docs/seguranca-owasp.md](docs/seguranca-owasp.md): checklist de segurança e riscos
  aceitos
- [docs/aceite/](docs/aceite/): roteiro de aceitação com a parceira e modelo do termo de
  aceite
- [CLAUDE.md](CLAUDE.md): contexto e decisões de projeto, em detalhe

## Histórico

O repositório começou como o Projeto 3 da disciplina *Programação e Desenvolvimento Web*:
uma clínica multiprofissional fictícia, com dados em JSON e sem autenticação. O
`backend/server.js` e o `backend/data/` ficam só como registro. Eles não rodam mais e os
dados não foram migrados (eram só testes, de um modelo incompatível).

## Como rodar localmente

Pré-requisitos: **Node.js 24** e um **PostgreSQL 16 ou mais recente**. Há três opções:

- **Docker:** `docker compose up -d` na raiz sobe o Postgres 16 na porta **5433**, já com
  os bancos `saude_plena` e `saude_plena_test`. Antes, copie `.env.example` para `.env`.
- **Codespaces / devcontainer:** abra o repositório no Codespaces. O `post-create.sh`
  instala tudo e gera os `.env`.
- **Postgres instalado na máquina:** crie um usuário dono dos bancos `saude_plena` e
  `saude_plena_test`, com permissão `CREATEDB` (o `prisma migrate dev` precisa dela para o
  *shadow database*). Ajuste o `DATABASE_URL` do `backend/.env`.

Os comandos `npm` rodam **dentro de `backend/`** (o `package.json` fica lá):

```powershell
cd backend
npm install
copy .env.example .env      # preencha SESSION_SECRET e REGISTRO_CHAVE_V1 (veja o próprio arquivo)
npx prisma migrate dev      # cria as tabelas
npm run db:seed             # dados FICTÍCIOS de demonstração
npm run usuario:criar       # cria a conta de acesso (a senha é digitada no terminal)
npm run dev                 # http://localhost:3000
```

Para gerar os dois segredos:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

