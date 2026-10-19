const path = require('path');
const express = require('express');
const helmet = require('helmet');
const env = require('./config/env');
const { sessionMiddleware } = require('./config/session');
const authRoutes = require('./routes/auth.routes');

const app = express();

// Em produção (Render) o app fica atrás de um proxy que termina o HTTPS. Sem
// isso o Express acha que a conexão é HTTP, recusa enviar o cookie Secure e
// enxerga o IP do proxy em vez do IP real do cliente.
if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

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

app.use('/auth', authRoutes);

module.exports = app;
