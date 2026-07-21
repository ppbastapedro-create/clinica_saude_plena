# Sistema de Agendamento — Clínica Saúde Plena

Trabalho acadêmico individual da disciplina **Programação e Desenvolvimento Web** (CEUB) — Projeto 3: sistema de agendamento de consultas/exames de uma clínica.

Aplicação completa (frontend + backend), com persistência em arquivos JSON locais. Sem banco de dados, sem Docker, sem autenticação.

## Stack

- **Backend:** Node.js + Express, dados salvos em arquivos JSON (`fs`).
- **Frontend:** HTML + CSS + JavaScript puro (sem framework), consumindo a API via `fetch`.

## Estrutura de pastas

```
projeto clinica/
├── backend/
│   ├── data/
│   │   ├── profissionais.json   # especialidades, profissionais e horários
│   │   └── agendamentos.json    # agendamentos criados
│   ├── server.js                # servidor Express com todas as rotas
│   ├── package.json
│   └── testes.http              # requisições de teste (extensão REST Client do VS Code)
├── frontend/
│   ├── index.html                # tela de agendamento + tela de consulta/cancelamento
│   ├── script.js
│   └── style.css
└── README.md
```

## Como rodar

### 1. Backend

```
cd backend
npm install
node server.js
```

O servidor sobe em `http://localhost:3000`. Deixe esse terminal aberto.

### 2. Frontend

Com o backend rodando, abra `frontend/index.html` diretamente no navegador (duplo clique no arquivo, ou "Open with Live Server" no VS Code, se preferir).

Não precisa de build nem de servidor separado — é HTML/CSS/JS puro consumindo a API em `http://localhost:3000`.

## Funcionalidades

**Agendar consulta:** escolher especialidade → profissional → data/horário disponível → preencher nome e CPF → confirmar.

**Consultar/cancelar agendamento:** buscar por CPF, ver os agendamentos encontrados (com nome do profissional, data e hora) e cancelar qualquer um deles.

## Rotas da API

| Método | Rota | Função |
|--------|------|--------|
| GET | `/especialidades` | Lista especialidades |
| GET | `/profissionais?especialidade=cardio` | Lista profissionais (filtro opcional por especialidade) |
| GET | `/profissionais/busca?nome=ana` | Busca profissional por nome (parcial, case-insensitive) |
| GET | `/horarios/:profissionalId` | Horários livres do profissional |
| POST | `/agendamentos` | Cria agendamento (valida campos, CPF e conflito de horário) |
| GET | `/agendamentos/:cpf` | Lista agendamentos de um CPF |
| DELETE | `/agendamentos/:id` | Cancela um agendamento |

## Testando a API diretamente

O arquivo `backend/testes.http` tem requisições prontas para usar com a extensão [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) do VS Code — abra o arquivo e clique em "Send Request" acima de cada bloco.

## Autor

Pedro Paulo Basta
