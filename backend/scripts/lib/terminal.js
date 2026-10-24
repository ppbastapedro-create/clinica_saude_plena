// Perguntas no terminal, com opção de não ecoar o que é digitado (senhas).
// Mesmo mecanismo do criar-usuario.js: silencia a saída do readline enquanto
// a resposta oculta é digitada (_writeToOutput é interno do Node, mas é a
// forma usual de fazer isso sem dependência extra).
//
// O que é digitado no prompt chega ao Node como texto puro — não passa pelo
// PowerShell, então $, crase e aspas não são interpretados, e nada vai para o
// histórico do terminal.
const readline = require('readline');

function criarPrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
  });
  const linhas = rl[Symbol.asyncIterator]();

  let mudo = false;
  const escreverOriginal = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (texto) => {
    if (!mudo) escreverOriginal(texto);
  };

  async function perguntar(texto, { oculto = false } = {}) {
    process.stdout.write(texto);
    mudo = oculto;
    const { value, done } = await linhas.next();
    if (oculto) {
      mudo = false;
      process.stdout.write('\n');
    }
    if (done) throw new Error('Entrada encerrada antes do fim.');
    return value;
  }

  return { perguntar, fechar: () => rl.close() };
}

module.exports = { criarPrompt };
