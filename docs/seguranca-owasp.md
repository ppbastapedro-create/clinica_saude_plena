# Saúde Plena — verificação de segurança (OWASP Top 10:2021)

Pacote 1.5.2 da EAP — *Testes de segurança*. Critério de aceitação: **nenhuma
vulnerabilidade alta aberta**. Revisão feita em 27/10/2026 sobre o código do
repositório (backend Node.js/Express + frontend JavaScript puro).

Como a verificação é feita:

| Camada | O quê | Onde |
|---|---|---|
| Revisão de código | Cada categoria do Top 10 abaixo, com o controle e a evidência | este documento |
| Testes automatizados | 374 testes (Jest + Supertest), cobertura ≥ 70% obrigatória | `backend/test/`, CI |
| Acesso sem login | Toda rota da API, lida dos arquivos de rotas, exige 401 sem login e com cookie forjado; 403 para conta ADMIN nas rotas clínicas | `backend/test/integration/acesso.test.js` |
| Dependências | `npm audit` (produção) a cada push; Dependabot semanal | `.github/workflows/ci.yml`, `.github/dependabot.yml` |
| Varredura dinâmica | OWASP ZAP *baseline* contra o sistema rodando (semanal e a cada push) | `.github/workflows/seguranca.yml`, `.zap/rules.tsv` |

## Resultado por categoria

### A01 — Quebra de controle de acesso
- Toda rota de dados exige sessão (`exigirAutenticacao`); só `POST /auth/login` e `POST /auth/logout` são abertas. **Teste:** `acesso.test.js` percorre todas as rotas.
- Toda consulta leva `psicologoId` da sessão no `where` — paciente/sessão de outra psicóloga responde 404 (não 403, para não confirmar que o id existe). O `psicologoId` nunca vem do corpo da requisição. **Testes:** cenários "psicóloga B" em `pacientes`, `agendamentos`, `registros`, `financeiro`.
- FK composta `Agendamento/Recebimento → Paciente(id, psicologoId)`: o próprio banco recusa vincular paciente de outra profissional.
- **Corrigido no 1.5.2:** o papel `ADMIN` tinha acesso provisório a pacientes, prontuário, financeiro e relatórios. Agora essas rotas exigem `PSICOLOGO` (sigilo profissional, CFP); o ADMIN vê só uma tela explicativa. **Teste:** `acesso.test.js` (403 em cada rota clínica).

### A02 — Falhas criptográficas
- Registro de evolução cifrado em repouso com AES-256-GCM (autenticado), IV aleatório por gravação, AAD = id do agendamento, versão de chave guardada para rotação. **Testes:** `cripto.test.js`, `registros.test.js` (o banco só guarda bytes cifrados).
- Senhas com bcrypt custo 12; senha nova com ≥ 12 caracteres e ≤ 72 bytes (limite do bcrypt).
- HTTPS no Render; `Strict-Transport-Security` (HSTS) e cookie `Secure` em produção.
- A chave do prontuário não vai para onde não é usada: o job de lembretes (GitHub Actions) não a recebe.

### A03 — Injeção
- Banco só via Prisma (consultas parametrizadas). As consultas SQL manuais usam `$queryRaw` com *template* (parâmetros, não concatenação); não há `$queryRawUnsafe`.
- Entrada validada com Zod em todos os controllers; campos fora do schema são descartados (impede *mass assignment* de `psicologoId`, `arquivadoEm`...).
- XSS: o frontend nunca usa `innerHTML` com dado — tudo entra como nó de texto (`frontend/js/dom.js`). CSP com `script-src 'self'` bloqueia script inline e de terceiros.
- **Corrigido no 1.5.2:** o frontend do Projeto 3 (`index.html`, `agendamento.html`, `script.js` com `innerHTML`) ainda era servido publicamente; foi removido e `/` leva ao login.

### A04 — Design inseguro
- Bloqueio por conta (5 senhas erradas → 15 min) e limite por IP no login (10 falhas / 15 min).
- Sem exclusão física (guarda de 5 anos): arquivar paciente, cancelar sessão, estornar recebimento.
- Conflito de horário garantido pelo banco (*exclusion constraint*), não só pela aplicação.
- Lembrete por e-mail só com opt-in do paciente **e** consentimento LGPD vigente, com texto neutro (não revela atendimento psicológico).
- Consentimento LGPD: aceite (data e versão do termo) e revogação registrados, nunca apagados; a revogação desliga o lembrete e não apaga os registros de guarda obrigatória.

### A05 — Configuração incorreta de segurança
- Helmet com CSP mais estrita que o padrão (**ajustado no 1.5.2**): estilo e fonte só do próprio site e do Google Fonts, sem `unsafe-inline`; `frame-ancestors 'none'` (clickjacking). **Teste:** `acesso.test.js`.
- `Permissions-Policy` desliga câmera, microfone e localização (**novo no 1.5.2**).
- `Cache-Control: no-store` em toda resposta da API (**ampliado no 1.5.2**; antes só no prontuário).
- Erros: o cliente nunca recebe mensagem interna nem stack; o log não registra mensagem de erro do banco (traz valores da linha). **Teste:** `erros.test.js`.
- Variáveis de ambiente validadas na subida; segredo ausente ou fraco impede o servidor de subir.

### A06 — Componentes vulneráveis e desatualizados
- **Corrigido no 1.5.2:** `body-parser` 2.3.0 (dependência do Express) tinha vulnerabilidade **alta** de negação de serviço (GHSA-27r3-jxmh-p828). Atualizado para 2.4.0; `npm audit --omit=dev` = 0 vulnerabilidades.
- Dependabot configurado (npm e GitHub Actions).
- **Risco aceito:** 3 alertas altos em `deepmerge-ts`, dependência do `prisma` (CLI de migração), que é **dependência de desenvolvimento**. A correção exige a próxima versão principal do Prisma. **Reavaliado no 1.6.1:** o build no Render instala o CLI para `prisma generate`/`migrate deploy` (que só leem arquivos do próprio repositório) e o remove em seguida com `npm prune --omit=dev --omit=optional` (testado: o client gerado continua funcionando). O processo do servidor nunca carrega o pacote. Continua aceito.

### A07 — Falhas de identificação e autenticação
- Novo ID de sessão a cada login (*session fixation*); sessão expira com 60 min sem uso e no máximo 12 h após o login; logout destrói a sessão no banco.
- Cookie `HttpOnly`, `SameSite=Strict`, `Secure` em produção.
- Resposta de login idêntica para e-mail inexistente, senha errada, conta bloqueada ou inativa — e mesmo tempo de resposta (compara com um hash falso).
- Conta desativada perde as sessões abertas na hora (o usuário é consultado a cada requisição).
- Troca de senha/e-mail só por script de terminal (sem rota HTTP de recuperação de senha a ser atacada).

### A08 — Falhas de integridade de software e dados
- `package-lock.json` versionado e `npm ci` no CI e no deploy.
- Registro de evolução com autenticação GCM: alteração direta no banco é detectada na leitura.
- Migrações versionadas (Prisma) — o banco só muda por migração revisada.

### A09 — Falhas de registro e monitoramento
- `LogAcesso`: login, falha de login, logout, leitura e escrita de registro de evolução, com usuário e data; FK `RESTRICT` (a auditoria não perde o vínculo).
- Log do servidor sem dado de paciente: rota no padrão (`/pacientes/:id`), id da requisição para correlacionar, sem mensagem de erro do banco.
- Job de lembretes registra só ids e códigos de erro (o log do GitHub Actions é visível no repositório).

### A10 — Server-Side Request Forgery
- O servidor não faz requisição a endereço vindo do usuário. A única saída é o SMTP do Brevo, com endereço fixo em variável de ambiente, e só no job de lembretes.

## Pendências e riscos aceitos

| Item | Nível | Situação |
|---|---|---|
| Primeira execução do ZAP | — | Roda no GitHub após o push. Cada alerta é triado: corrigido, ou aceito em `.zap/rules.tsv` com justificativa registrada aqui |
| `deepmerge-ts` via `prisma` (dev) | Alta, fora de produção | Aceito (ver A06); reavaliado no 1.6.1 |
| Google Fonts | Baixo | O navegador da psicóloga contata o Google para baixar a fonte (expõe o IP). Alternativa: hospedar a fonte no próprio servidor |
| Limite de login em memória | Baixo | Vale para uma instância (plano atual do Render); com várias, usar armazenamento compartilhado |
| Itens de implantação (1.6.1) | — | Roteiro em `docs/implantacao.md` (HTTPS e segredos próprios no Render, Data API do Supabase desligada e revogações, versão do Postgres do CI = produção). Backup cifrado (age, chave pública) com teste de restauração a cada execução: `docs/backup-restauracao.md`. A executar pelo autor |
