// Tela de login mínima (pacote 1.4.3). Mesma origem do backend: caminhos
// relativos, e o fetch envia o cookie de sessão automaticamente.
const secaoLogin = document.getElementById('secao-login');
const secaoLogado = document.getElementById('secao-logado');
const form = document.getElementById('form-login');
const campoEmail = document.getElementById('email');
const campoSenha = document.getElementById('senha');
const botaoEntrar = document.getElementById('botao-entrar');
const textoErro = document.getElementById('erro');
const saudacao = document.getElementById('saudacao');
const botaoSair = document.getElementById('botao-sair');

function mostrarLogado(usuario) {
  // textContent (e não innerHTML): o nome vem do banco e é exibido como texto
  // puro — nunca interpretado como HTML (evita XSS).
  saudacao.textContent = `Logado como ${usuario.nome} (${usuario.papel})`;
  secaoLogin.hidden = true;
  secaoLogado.hidden = false;
}

function mostrarLogin() {
  secaoLogado.hidden = true;
  secaoLogin.hidden = false;
  campoEmail.focus();
}

function mostrarErro(mensagem) {
  textoErro.textContent = mensagem;
  textoErro.hidden = false;
}

async function verificarSessao() {
  try {
    const resposta = await fetch('/auth/me');
    if (resposta.ok) return mostrarLogado(await resposta.json());
  } catch {
    // Sem conexão: cai na tela de login, que mostra o erro ao tentar entrar.
  }
  return mostrarLogin();
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  textoErro.hidden = true;
  botaoEntrar.disabled = true;

  try {
    const resposta = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: campoEmail.value, senha: campoSenha.value }),
    });
    const corpo = await resposta.json().catch(() => ({}));

    if (resposta.ok) {
      form.reset();
      mostrarLogado(corpo);
    } else {
      campoSenha.value = '';
      mostrarErro(corpo.erro || 'Não foi possível entrar.');
    }
  } catch {
    mostrarErro('Falha de conexão com o servidor.');
  } finally {
    botaoEntrar.disabled = false;
  }
});

botaoSair.addEventListener('click', async () => {
  botaoSair.disabled = true;
  try {
    await fetch('/auth/logout', { method: 'POST' });
  } finally {
    botaoSair.disabled = false;
    mostrarLogin();
  }
});

verificarSessao();
