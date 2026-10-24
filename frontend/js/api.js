// Acesso à API. Um ponto só para: montar a requisição JSON, tratar falta de
// conexão, mandar para o login quando a sessão cai (401) e transformar a
// resposta de erro do backend ({ erro, campos? }) numa exceção com mensagem.

export class ErroApi extends Error {
  constructor(status, corpo) {
    super(corpo?.erro || 'Não foi possível concluir a operação.');
    this.status = status;
    this.corpo = corpo ?? {};
  }

  // Erros de validação por campo (400 do Zod): { nome: ['Nome muito curto'] }.
  get campos() {
    return this.corpo.campos ?? {};
  }
}

let redirecionando = false;

function irParaLogin() {
  if (redirecionando) return;
  redirecionando = true;
  window.location.replace('login.html?expirou=1');
}

export async function api(caminho, { metodo = 'GET', corpo, query } = {}) {
  const url = query ? `${caminho}?${new URLSearchParams(query)}` : caminho;
  let resposta;
  try {
    resposta = await fetch(url, {
      method: metodo,
      headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      // Nada da API fica no cache do navegador (dados de paciente).
      cache: 'no-store',
    });
  } catch {
    throw new ErroApi(0, { erro: 'Falha de conexão com o servidor. Verifique a internet e tente de novo.' });
  }

  if (resposta.status === 401) {
    irParaLogin();
    throw new ErroApi(401, { erro: 'Sessão encerrada. Faça login novamente.' });
  }
  if (resposta.status === 204) return null;

  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) throw new ErroApi(resposta.status, dados);
  return dados;
}

// Texto para mostrar ao usuário a partir de qualquer erro (da API ou não).
export function mensagemDe(erro) {
  if (erro instanceof ErroApi) {
    const primeiros = Object.values(erro.campos).map((lista) => lista?.[0]).filter(Boolean);
    return primeiros.length ? `${erro.message}: ${primeiros.join('; ')}.` : erro.message;
  }
  return 'Erro inesperado na página. Recarregue e tente de novo.';
}
