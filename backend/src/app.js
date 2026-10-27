const path = require('path');
const express = require('express');
const helmet = require('helmet');
const env = require('./config/env');
const { sessionMiddleware } = require('./config/session');
const authRoutes = require('./routes/auth.routes');
const pacientesRoutes = require('./routes/pacientes.routes');
const agendamentosRoutes = require('./routes/agendamentos.routes');
const relatoriosRoutes = require('./routes/relatorios.routes');
const recebimentosRoutes = require('./routes/recebimentos.routes');
const errorHandler = require('./middlewares/errorHandler');
const requestId = require('./middlewares/requestId');

const app = express();

// Em produção (Render) o app fica atrás de um proxy que termina o HTTPS. Sem
// isso o Express acha que a conexão é HTTP, recusa enviar o cookie Secure e
// enxerga o IP do proxy em vez do IP real do cliente.
if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Primeiro de todos: até um erro no Helmet ou no parser de JSON já tem id.
app.use(requestId);
// CSP mais estrita que o padrão do Helmet (pacote 1.5.2): o padrão aceita
// estilo e fonte de QUALQUER site https e estilo inline. O frontend só usa os
// próprios arquivos + a fonte do Google Fonts. Os `elemento.style.x = ...`
// da agenda são CSSOM (via JavaScript), que a CSP não bloqueia.
// frame-ancestors 'none': nenhum site pode abrir o sistema dentro de um
// iframe (clickjacking).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'style-src': ["'self'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'frame-ancestors': ["'none'"],
      },
    },
  }),
);
// Recursos do navegador que o sistema nunca usa ficam desligados — nem um
// script injetado conseguiria pedir câmera, microfone ou localização. (O
// Helmet não envia este cabeçalho.)
app.use((req, res, next) => {
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
});
app.use(express.json());

// A raiz abre o login (que manda para app.html se já houver sessão). A
// página inicial do Projeto 3, com autoatendimento do paciente, saiu do
// escopo e foi removida no pacote 1.5.2.
app.get('/', (req, res) => res.redirect('/login.html'));

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
//
// Cache-Control: no-store em TODA resposta da API: nome, CPF, financeiro e
// prontuário não ficam no cache (nem em disco) do navegador — num computador
// compartilhado, não sobram depois que a página fecha (pacote 1.5.2).
function montar(prefixo, router) {
  app.use(
    prefixo,
    (req, res, next) => {
      req.prefixoRota = prefixo;
      res.set('Cache-Control', 'no-store');
      next();
    },
    router,
  );
}

montar('/auth', authRoutes);
montar('/pacientes', pacientesRoutes);
montar('/agendamentos', agendamentosRoutes);
montar('/relatorios', relatoriosRoutes);
montar('/recebimentos', recebimentosRoutes);

// Nenhuma rota atendeu: 404 em JSON (o padrão do Express é uma página HTML).
app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada' });
});

// Sempre o último: recebe os erros de todas as rotas acima.
app.use(errorHandler);

module.exports = app;
