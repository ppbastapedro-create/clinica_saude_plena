const path = require('path');
const express = require('express');
const helmet = require('helmet');
const env = require('./config/env');
const { sessionMiddleware } = require('./config/session');
const authRoutes = require('./routes/auth.routes');
const pacientesRoutes = require('./routes/pacientes.routes');
const agendamentosRoutes = require('./routes/agendamentos.routes');
const errorHandler = require('./middlewares/errorHandler');
const requestId = require('./middlewares/requestId');

const app = express();

// Em produção (Render) o app fica atrás de um proxy que termina o HTTPS. Sem
// isso o Express acha que a conexão é HTTP, recusa enviar o cookie Secure e
// enxerga o IP do proxy em vez do IP real do cliente.
if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Primeiro de todos: até um erro no Helmet ou no parser de JSON já tem id.
app.use(requestId);
app.use(helmet());
app.use(express.json());

// Frontend estático, servido pelo próprio Express (mesma origem do backend
// — o cookie de sessão SameSite=Strict funciona sem configurar CORS). Vem
// antes da sessão: arquivo estático não precisa consultar a tabela `session`.
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

app.use(sessionMiddleware);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Guarda o prefixo do router em req.prefixoRota: o log de erros precisa dele
// para registrar a rota no padrão ("/pacientes/:id"), e o Express desfaz o
// req.baseUrl assim que o erro sai do router.
function montar(prefixo, router) {
  app.use(
    prefixo,
    (req, res, next) => {
      req.prefixoRota = prefixo;
      next();
    },
    router,
  );
}

montar('/auth', authRoutes);
montar('/pacientes', pacientesRoutes);
montar('/agendamentos', agendamentosRoutes);

// Nenhuma rota atendeu: 404 em JSON (o padrão do Express é uma página HTML).
app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada' });
});

// Sempre o último: recebe os erros de todas as rotas acima.
app.use(errorHandler);

module.exports = app;
