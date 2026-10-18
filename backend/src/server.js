const env = require('./config/env');
const app = require('./app');

app.listen(env.PORT, () => {
  console.log(`Servidor rodando em http://localhost:${env.PORT} (NODE_ENV=${env.NODE_ENV})`);
});
