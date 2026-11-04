Saúde Plena — Agendamento e Prontuário para Atendimento Psicológico

Sistema web para uma psicóloga autônoma organizar a agenda, os pacientes, o registro de
evolução de cada sessão e o financeiro do consultório.

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

