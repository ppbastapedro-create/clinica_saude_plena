const path = require('path');
const express = require('express');
const helmet = require('helmet');

const app = express();

app.use(helmet());
app.use(express.json());

// Frontend estático, servido pelo próprio Express (mesma origem do backend
// — simplifica o cookie de sessão quando a autenticação entrar no ar).
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = app;
