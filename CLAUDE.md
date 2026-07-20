# CLAUDE.md — Sistema de Agendamento Clínica Saúde Plena

Contexto permanente do projeto. Leia antes de qualquer alteração.

## O que é

Trabalho acadêmico individual da disciplina **Programação e Desenvolvimento Web (CEUB)**.
Escolhido o **Projeto 3**: sistema de agendamento de consultas/exames de uma clínica.
Aplicação completa (frontend + backend) com persistência em arquivos JSON locais.

**Importante:** NÃO usar banco de dados nem Docker. Isso é escopo do Projeto 4, fora deste trabalho.

## Restrições do autor

- Disponibilidade real: ~3 horas por semana, 9 semanas (~27h no total). Priorizar simplicidade.
- Ambiente: Windows, VS Code, terminal PowerShell (atenção: `curl` no PowerShell é `Invoke-WebRequest`, sintaxe diferente; testes de API feitos pela extensão REST Client via arquivo `testes.http`).
- Node v24.15.0 instalado e funcionando.
- Preferir soluções diretas e fáceis de entender. Evitar over-engineering (ex.: não trocar `readFileSync` por async/await sem necessidade; não adicionar libs além do Express sem justificar).
- O autor está aprendendo: explicar o "porquê" das decisões, não só entregar código.

## Stack

- **Backend:** Node.js + Express. Persistência em arquivos JSON lidos/escritos com `fs`.
- **Frontend:** HTML + CSS + JavaScript puro (Vanilla, sem framework). Consome a API via `fetch`.
- **Sem** banco de dados, sem Docker, sem autenticação, sem envio de e-mail.

## Estrutura de pastas

```
projeto clinica/
├── backend/
│   ├── data/
│   │   ├── profissionais.json   # especialidades, profissionais e horários (dados fixos)
│   │   └── agendamentos.json     # agendamentos criados (começa como [])
│   ├── server.js                 # servidor Express com todas as rotas
│   ├── package.json
│   └── node_modules/
├── frontend/                     # A CONSTRUIR
├── docs/
│   └── EAP.pdf                   # planejamento (Marco 1)
├── testes.http                   # requisições de teste (extensão REST Client)
└── README.md
```

## Modelos de dados

**profissionais.json**
```json
{
  "especialidades": [
    { "id": "cardio", "nome": "Cardiologia" }
  ],
  "profissionais": [
    {
      "id": 1,
      "nome": "Dra. Ana Souza",
      "especialidade": "cardio",
      "horarios": [
        { "data": "2026-08-03", "hora": "09:00" }
      ]
    }
  ]
}
```
- Especialidade referenciada por `id` (string), nunca texto livre — evita inconsistência.
- Datas no formato ISO `AAAA-MM-DD` — ordenável e legível pelo JavaScript.
- Cada profissional carrega sua própria lista de horários.

**agendamentos.json** — array; cada item:
```json
{ "id": 1753041234567, "nome": "Maria Silva", "cpf": "11144477735", "profissionalId": 1, "data": "2026-08-03", "hora": "09:00" }
```
- `id` gerado por `Date.now()`.
- `profissionalId` liga o agendamento ao profissional (número, não nome).

## Contrato da API (backend) — TODAS AS 6 ROTAS JÁ IMPLEMENTADAS E TESTADAS

| Método | Rota | Função |
|--------|------|--------|
| GET | `/especialidades` | Lista especialidades |
| GET | `/profissionais?especialidade=cardio` | Lista profissionais (filtro opcional por especialidade) |
| GET | `/profissionais/busca?nome=ana` | Busca profissional por nome (parcial, case-insensitive) |
| GET | `/horarios/:profissionalId` | Horários LIVRES do profissional (exclui os já agendados) |
| POST | `/agendamentos` | Cria agendamento (valida campos, valida CPF, checa conflito de horário) |
| GET | `/agendamentos/:cpf` | Lista agendamentos de um CPF |
| DELETE | `/agendamentos/:id` | Cancela um agendamento |

Regras de negócio já implementadas no backend:
- Validação de CPF com dígitos verificadores (função `validarCPF`).
- Anti-duplo-agendamento: horário agendado some de `/horarios`; ao cancelar, reaparece.
- Códigos HTTP corretos: 201 criado, 400 dados inválidos, 404 não encontrado, 409 conflito.

## Onde paramos

**Backend: COMPLETO.** As 6 rotas implementadas e testadas. Servidor sobe em `http://localhost:3000`.

**Próximo: FRONTEND (ainda não iniciado).** Precisa de:
1. Tela de agendamento: escolher especialidade → profissional → data/horário → preencher nome e CPF → confirmar.
2. Tela de consulta: buscar agendamentos por CPF, com botão de cancelar em cada um.
3. Consumir a API via `fetch`. Layout simples e responsivo.
4. Validação de CPF também no frontend (feedback rápido ao usuário).

**Depois do frontend:**
- README com instruções de execução (roda backend com `node server.js`, abre o frontend).
- Deploy online (backend no Render, frontend no Vercel ou GitHub Pages) — vale pontuação extra.
- Vídeo de apresentação (até 5 min) e PDF final com links do GitHub e do vídeo.

## Cronograma (referência da EAP)

| Semana | Foco | Marco |
|--------|------|-------|
| 1-2 | Modelagem de dados + rotas da API | — |
| 3 | Entrega EAP + início backend | Marco 1 |
| 4-5 | Backend completo + início frontend | — |
| 6 | Fluxo de agendamento funcionando | Marco 2 |
| 7 | Consulta/cancelamento + tratamento de erros | — |
| 8 | Testes + deploy + README | — |
| 9 | Vídeo, PDF, entrega | Marco 3 |

## Critérios de avaliação (para orientar prioridades)

- Funcionamento sem erros: 10 pts → tratar entradas inválidas em tudo.
- Publicação no GitHub: 5 pts → commits incrementais, não um push único.
- Instruções de execução (README): 2 pts.
- Apresentação clara (vídeo): 8 pts.
- Extra: solução online: até 5 pts.

## Convenções

- Commits pequenos e frequentes, em português, ao fim de cada sessão de trabalho.
- `.gitignore` deve conter `node_modules/`.
- Não subir `node_modules` para o GitHub.
