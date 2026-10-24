# CLAUDE.md — Saúde Plena (Sistema Web de Agendamento e Prontuário)

Contexto permanente do projeto. Leia antes de qualquer alteração.

## O que é

Projeto Integrador de TI (CEUB, 2º/2026), Atividade Curricular de Extensão (ACE),
disciplina Projeto Integrador de TI — Prof. Daniel Barbosa Santos.
Parceira real da comunidade externa: **Beatriz Xavier**, psicóloga autônoma do DF.

**Histórico:** o código nasceu como "Projeto 3" da disciplina *Programação e Desenvolvimento
Web* — uma clínica multiprofissional fictícia, agendamento com autoatendimento por CPF,
persistência em JSON, sem autenticação. Esse projeto está **completo e arquivado**.

**Escopo atual (vigente):** evolução para "Saúde Plena – Sistema Web de Agendamento e
Prontuário para Atendimento Psicológico", conforme a EAP aprovada na Atividade Avaliativa 01
(`EAP_SAUDE_PLENA_01_Projeto_Integrador_Pedro_Basta.pdf`). Mudanças de fundo em relação ao
Projeto 3:
- Usuária única do sistema: a psicóloga. O paciente **não** acessa o sistema — autoatendimento
  sai do escopo.
- Passa a existir registro de evolução por sessão, dado sensível (LGPD art. 11, Resolução
  CFP nº 001/2009 — guarda mínima de 5 anos).
- Persistência migra para PostgreSQL, com autenticação, controle de acesso, criptografia e
  backup.

As restrições antigas de "sem ORM / sem autenticação / sem e-mail" (do extinto "Projeto 4")
**não se aplicam mais** — foram superadas por este escopo maior, decidido conscientemente em
2026-10-18 mesmo sabendo que ampliam o esforço além da disponibilidade semanal informalmente
estimada antes. O risco de atraso por sobrecarga já está mapeado como R04 na EAP (alto,
P×I=16) — mitigação: cronograma com folga, metas semanais, priorização MoSCoW entregando
primeiro agenda, pacientes e autenticação.

## Restrições do autor

- Ambiente: Windows, VS Code, terminal PowerShell (atenção: `curl` no PowerShell é
  `Invoke-WebRequest`, sintaxe diferente; testes de API feitos pela extensão REST Client via
  arquivo `testes.http`).
- Node v24.15.0 instalado. Docker Desktop **não funciona no PC do autor** (2026-10-18).
- **Ambientes de banco.** São dois, com porta, usuário e versão diferentes de propósito.
  **Não unificar.** Os `.env.example` seguem o ambiente Docker/CI; o `.env` do PC do autor é
  ajustado à mão.
  - **Docker/CI** (o que está nos arquivos):
    - `docker-compose.yml` da raiz: `postgres:16-alpine`, host `localhost:5433` (porta
      `POSTGRES_PORT` do `.env` da raiz; dentro do container, 5432), usuário `saude_plena`.
      Bancos `saude_plena` e `saude_plena_test` (este criado por `db/init/` na 1ª subida
      do volume).
    - Devcontainer/Codespaces (`.devcontainer/`): `postgres:16`, host `db:5432`, usuário
      `saude_plena`; o `post-create.sh` gera os `.env` trocando `localhost:5433` por
      `db:5432`. O seed aceita o host `db` sem precisar de `SEED_ALLOW=1`.
    - CI (`.github/workflows/ci.yml`): service container `postgres:16`, host
      `localhost:5432`, usuário `saude_plena`, só o banco `saude_plena_test`.
  - **Windows local (PC do autor):** PostgreSQL **18** nativo (serviço
    `postgresql-x64-18`), host `localhost:5432`, usuário `app_saude_plena` (dono dos bancos
    `saude_plena` e `saude_plena_test`, com `CREATEDB` para o shadow database do
    `prisma migrate dev`).
  - Atenção à diferença de versão: o CI testa no Postgres 16 e o PC do autor roda o 18. O
    que passa local precisa passar no CI antes de ser considerado pronto.
- O autor está aprendendo: explicar o "porquê" das decisões, não só entregar código.
- Nunca usar dados reais de pacientes em testes/seeds — só dados fictícios.
- Segredos sempre em `.env` (nunca commitado); manter `.env.example` atualizado.

## Escopo

**Incluído:** autenticação (usuária única); cadastro de pacientes com validação de CPF;
agenda em calendário (marcar, remarcar, cancelar, registrar falta, impedir conflito);
registro de evolução por sessão com criptografia em repouso; controle de pagamento por
sessão; relatório mensal (sessões realizadas, faltas, valores recebidos); lembrete de sessão
por e-mail; termo de consentimento LGPD; backup automatizado com teste de restauração.

**Fora do escopo:** teleconsulta/vídeo, nota fiscal, integração com convênios, app nativo
(o sistema é responsivo), envio automático por WhatsApp (API oficial é paga), acesso do
paciente ao sistema.

## Stack

- **Backend:** Node.js (LTS) + Express, em camadas (rotas → controllers → services →
  repositórios).
- **Banco de dados:** PostgreSQL (Supabase, região São Paulo) via **Prisma ORM**, com
  migrações versionadas. Em desenvolvimento, Postgres local (ver "Ambientes de banco" em
  "Restrições do autor").
- **Autenticação:** bcryptjs (puro JS — evita compilar módulo nativo no Windows) +
  express-session + connect-pg-simple (cookie HttpOnly, Secure, SameSite).
- **Segurança:** Helmet, express-rate-limit, validação com Zod, AES-256-GCM (módulo `crypto`
  nativo) para o conteúdo dos registros de sessão.
- **E-mail:** Nodemailer + Brevo (SMTP), para lembretes de sessão.
- **Frontend:** HTML5/CSS3/JavaScript puro (sem framework), consumindo a API via `fetch`.
  FullCalendar para a visão de agenda.
- **Testes:** Jest + Supertest, cobertura mínima de 70% nas regras de negócio.
- **CI/backup:** GitHub Actions (testes; `pg_dump` agendado e criptografado).
- **Hospedagem:** Render (deploy a partir do GitHub).

## Modelo de dados (alvo, aprovado na Etapa 1)

Entidades: `Usuario` (psicólogo ou administrador — ver papéis abaixo), `Session` (tabela do `connect-pg-simple`, declarada no
schema para o Prisma não acusar drift), `Paciente`, `Consentimento` (1:N com `Paciente`,
com `revogadoEm` — revogação é direito do titular pela LGPD art. 8º §5º), `Agendamento`,
`RegistroSessao` (1:1 com `Agendamento`, conteúdo cifrado), `Pagamento` (1:1 com
`Agendamento`), `LogAcesso` (auditoria de acesso a `RegistroSessao` e eventos de login).

Não existem mais as tabelas `especialidades` / `profissionais` / `horarios` do modelo
antigo (clínica multiprofissional). Pontos importantes do desenho:

- **Vários psicólogos no modelo, uma no escopo (decidido em 2026-10-19):** o schema suporta
  vários psicólogos — `Usuario.papel` (enum `Papel`: `PSICOLOGO`, `ADMIN`), `psicologoId` em
  `Paciente` e `Agendamento`, `@@unique([psicologoId, cpf])` em `Paciente` e FK composta
  `Agendamento(pacienteId, psicologoId) → Paciente(id, psicologoId)`, que impede agendar
  paciente de outro profissional. O escopo atual, porém, entrega para **uma só psicóloga**
  (a parceira); multiusuário não é requisito de aceite.
- **Papel `ADMIN`:** gerencia contas de usuário. **Durante o desenvolvimento, o acesso é
  provisório e total:** as rotas clínicas usam `exigirPapel('PSICOLOGO', 'ADMIN')`.
  **Antes da implantação**, o `ADMIN` perde acesso a `Paciente`, `RegistroSessao` e
  `Pagamento` (sigilo profissional — CFP) — as rotas clínicas passam a
  `exigirPapel('PSICOLOGO')`. O banco não impõe isso (nem impede `psicologoId` de apontar
  para um `ADMIN`): a checagem de papel fica no service/middleware e **precisa de teste
  automatizado**.
- **Integridade referencial:** todas as FKs são `ON DELETE RESTRICT` (coerente com "sem
  exclusão física"), inclusive as de `LogAcesso` — auditoria não perde o vínculo. A FK
  composta `Agendamento → Paciente` é também `ON UPDATE RESTRICT`: transferir paciente
  entre psicólogos deve ser um processo explícito, nunca um cascade silencioso.
- **Datas:** todos os `DateTime` são `@db.Timestamptz(3)` — precisão de milissegundos, igual
  ao `Date` do JavaScript, e instante absoluto independente do fuso do servidor.
- **Sem exclusão física:** `Paciente.arquivadoEm` (arquivamento lógico) substitui
  `DELETE /pacientes/:id`; não existe `DELETE /agendamentos/:id` — cancelar é
  `PATCH .../status` para `CANCELADO`. Motivo: guarda mínima de 5 anos (Resolução CFP
  nº 001/2009).
- **Conflito de horário não é mais `UNIQUE(data, hora)`.** `Agendamento` guarda
  `inicio`/`fim` como `Timestamptz`, e uma *exclusion constraint* do Postgres
  (`EXCLUDE USING gist ("psicologoId" WITH =, tstzrange(inicio, fim) WITH &&) WHERE
  (status <> 'CANCELADO')`, exige a extensão `btree_gist` para o `=` em inteiro) impede
  qualquer sobreposição real de intervalos **do mesmo psicólogo** — não só choque de
  horário de início exato — e ignora agendamentos cancelados. A coluna é `"psicologoId"`
  entre aspas porque o Prisma cria as colunas com o nome do campo (camelCase). O Prisma não
  expressa isso: a constraint é SQL manual, acrescentada à migração gerada. O erro
  correspondente é o código Postgres `23P01` (não o `P2002` do Prisma), tratado como 409
  no `errorHandler`. A checagem de conflito também é feita antes, no service (mensagem
  amigável) — a constraint é a garantia final, não a única camada.
- **`RegistroSessao`** usa `agendamentoId` como AAD do AES-256-GCM e guarda `versaoChave`
  (permite rotacionar a chave de criptografia no futuro).
- **`formaPagamento`** é enum (`PIX`, `DINHEIRO`, `CARTAO`, `TRANSFERENCIA`), não texto livre.
- Regras de transição de status do agendamento: só `AGENDADO → REALIZADO | FALTA |
  CANCELADO`; remarcar (`PUT`) só é permitido com status `AGENDADO`; qualquer outra
  transição retorna 422.
- Cobrança por falta é configurável, pendente de confirmação com a parceira — não deve ser
  assumida no código. (Confirmado no 1.4.5: não implementada.)
- **Regras da agenda confirmadas pelo autor (2026-10-20, pacote 1.4.5):**
  - Teto de **4 h** por sessão (trava contra erro de digitação, não regra clínica) → 422.
  - Sessão **no passado é aceita** (lançamento retroativo da agenda de papel).
  - `REALIZADO`/`FALTA` só depois do **início** da sessão (`inicio <= now()`); `CANCELADO`
    a qualquer momento.
  - **Arquivar paciente com sessão futura:** bloqueado com 422 enquanto houver sessão
    `AGENDADO` com `inicio > now()`; a mensagem lista as datas. Conferência e arquivamento
    na mesma transação (opção (a), escolhida em vez de cancelar as sessões automaticamente).
    Sessões **passadas** pendentes de paciente arquivado continuam podendo ser fechadas
    (`REALIZADO`/`FALTA`/`CANCELADO`).

O `schema.prisma` completo (todas as entidades acima, com os campos e índices) e a migração
com a exclusion constraint entram no pacote 1.4.2.

## Onde paramos

- **Projeto 3 (JSON, clínica multiprofissional):** completo e arquivado — não evolui mais.
  - **Decisão (2026-10-19, pacote 1.4.2): os dados JSON são descartados, sem script de
    importação.** Motivo: `backend/data/*.json` só contém dados de teste do Projeto 3, de
    um modelo incompatível (vários profissionais/especialidades, horários fixos, paciente
    identificado só por nome+CPF no agendamento) e nenhum dado real da parceira. Na EAP,
    o pacote "1.4.2 Migração JSON→Postgres" se cumpre com a migração do **modelo** para o
    Postgres (schema Prisma + migração versionada + seed fictício), não dos registros.
  - `backend/server.js` e `backend/data/` continuam no repositório só como histórico (o
    `server.js` não roda mais: depende de `cors`, removido do `package.json`). Remoção
    física fica para quando o autor decidir — não remover sem avisar.
- **Saúde Plena (Projeto Integrador de TI):**
  - Etapa 0 (diagnóstico do repositório) — **concluída** em 2026-10-18.
  - Etapa 1 (desenho: estrutura em camadas, `schema.prisma`, lista de endpoints) — em
    andamento.
  - Pacotes da EAP a implementar em ordem, um por vez, com aprovação do autor ao fim de
    cada um: 1.4.1 Infraestrutura → 1.4.2 Migração JSON→Postgres → 1.4.3 Autenticação →
    1.4.4 Pacientes → 1.4.5 Agenda → 1.4.6 Registro de sessões → 1.4.7 Financeiro e
    relatórios → 1.4.8 Lembretes → 1.5.1 Testes → 1.5.2 Segurança (checklist OWASP Top 10).
  - Anotações para pacotes futuros:
    - **1.4.3 Autenticação:** configurar o `connect-pg-simple` com
      `createTableIfMissing: false` — a tabela `session` é criada pela migração do Prisma.
    - **1.4.5 Agenda:** `psicologoId` vem de `req.session.usuario.id`, **nunca** do corpo
      da requisição (senão um usuário poderia agendar na agenda de outro).
    - **1.4.5 Agenda (`errorHandler`):** as violações de `EXCLUDE`/`CHECK` chegam como
      `PrismaClientUnknownRequestError` **sem `code`** — o `23P01`/`23514` só aparece no
      texto. Identificar pelo nome da constraint (`Agendamento_sem_sobreposicao_excl` →
      409; `Agendamento_fim_maior_que_inicio_check` → 422). Nunca devolver `e.message` ao
      cliente: o `detail` do Postgres inclui os valores da linha.
    - **1.4.8 Lembretes:** o lembrete só considera sessões futuras (`inicio > now()`) com
      status `AGENDADO` **e de paciente não arquivado** (`paciente.arquivadoEm IS NULL`),
      independentemente da regra de arquivamento. Sessões no passado são aceitas pela
      agenda (lançamento retroativo) e nunca devem gerar lembrete.
    - **1.6.1:** conferir a versão do Postgres no Supabase e alinhar a imagem do CI
      (`postgres:16` em `.github/workflows/ci.yml`) a ela — o CI deve testar na mesma versão
      de produção.
  - Cronograma de referência da EAP: desenvolvimento previsto 02/11 a 22/11/2026; testes e
    aceitação 23/11 a 29/11/2026; implantação 30/11 a 06/12/2026.

## Forma de trabalho combinada

- Incremental: um pacote da EAP por vez. Para cada pacote: explicar o que muda e por quê,
  implementar, escrever testes, mostrar como rodar/validar, sugerir mensagem de commit, e
  **parar aguardando aprovação** antes do próximo pacote.
- Se algo da EAP for inviável ou conflitar com o código existente, apontar antes de decidir
  sozinho.
- Não remover funcionalidade existente sem avisar antes.
- Ao encontrar erro, mostrar a mensagem completa antes de propor correção.
- Comentários e mensagens de commit em português.
- **Nunca executar `git add`, `commit` ou `push`. O desenvolvedor faz os commits.** (Reforçado
  por regras `deny` em `.claude/settings.json`; o agente só sugere a mensagem de commit.)

## Critérios de avaliação (para orientar prioridades)

Conforme critérios de sucesso da EAP: sistema em uso real pela parceira até o fim do
semestre; 100% dos requisitos do escopo aceitos formalmente; nenhum acesso não autenticado
aos registros de sessão em testes de segurança; restauração de backup testada antes da
implantação; satisfação da parceira ≥ 4/5; documentação aprovada pelo docente.

## Convenções

- Commits pequenos e frequentes, em português, ao fim de cada sessão de trabalho.
- `.gitignore` deve conter `node_modules/` e `.env`.
- Não subir `node_modules` nem credenciais (`.env`) para o GitHub — usar `.env.example` como
  referência.
