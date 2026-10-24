// Tela de login. Mesma origem do backend: caminhos relativos, e o fetch envia
// o cookie de sessão automaticamente. Depois de entrar, o sistema em si fica
// em app.html.
const PAGINA_DO_SISTEMA = 'app.html';

const secaoLogin = document.getElementById('secao-login');
const form = document.getElementById('form-login');
const campoEmail = document.getElementById('email');
const campoSenha = document.getElementById('senha');
const botaoEntrar = document.getElementById('botao-entrar');
const caixaErro = document.getElementById('erro');
const textoErro = document.getElementById('erro-texto');
const avisoSessao = document.getElementById('aviso-sessao');

function irParaOSistema() {
  // replace (e não href): o login não fica no histórico, então o "voltar" do
  // navegador não traz a pessoa de volta para cá depois de entrar.
  window.location.replace(PAGINA_DO_SISTEMA);
}

function mostrarLogin() {
  // O app.html manda para cá com ?expirou=1 quando a sessão cai (60 min sem
  // uso ou 12 h desde o login).
  if (new URLSearchParams(window.location.search).has('expirou')) {
    avisoSessao.textContent = 'Sua sessão expirou. Entre novamente para continuar.';
    avisoSessao.hidden = false;
  }
  secaoLogin.hidden = false;
  campoEmail.focus();
}

function mostrarErro(mensagem) {
  // textContent (e não innerHTML): a mensagem é exibida como texto puro,
  // nunca interpretada como HTML (evita XSS).
  textoErro.textContent = mensagem;
  caixaErro.hidden = false;
}

async function verificarSessao() {
  try {
    const resposta = await fetch('/auth/me');
    if (resposta.ok) return irParaOSistema();
  } catch {
    // Sem conexão: fica na tela de login, que mostra o erro ao tentar entrar.
  }
  return mostrarLogin();
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  caixaErro.hidden = true;
  avisoSessao.hidden = true;
  botaoEntrar.disabled = true;

  try {
    const resposta = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: campoEmail.value, senha: campoSenha.value }),
    });
    const corpo = await resposta.json().catch(() => ({}));

    if (resposta.ok) return irParaOSistema();

    campoSenha.value = '';
    // 401 (credenciais) e 429 (limite por IP) já vêm com mensagem do backend.
    mostrarErro(corpo.erro || 'Não foi possível entrar.');
  } catch {
    mostrarErro('Falha de conexão com o servidor.');
  } finally {
    botaoEntrar.disabled = false;
  }
  return undefined;
});

verificarSessao();
