const { cifrar, decifrar, VERSAO_ATUAL } = require('../../src/utils/cripto');

// Texto fictício, com acentos e quebra de linha (precisa voltar idêntico).
const TEXTO = 'Paciente relata melhora do sono.\nRetomar exercício de respiração — próxima sessão.';
const AGENDAMENTO = 42;

describe('cifrar / decifrar (AES-256-GCM)', () => {
  test('ida e volta devolve o texto idêntico', () => {
    expect(decifrar(cifrar(TEXTO, AGENDAMENTO), AGENDAMENTO)).toBe(TEXTO);
  });

  test('formato: IV de 12 bytes, etiqueta de 16, versão atual, e o cifrado não contém o texto', () => {
    const c = cifrar(TEXTO, AGENDAMENTO);

    expect(c.iv).toHaveLength(12);
    expect(c.authTag).toHaveLength(16);
    expect(c.versaoChave).toBe(VERSAO_ATUAL);
    expect(c.conteudoCifrado.includes(Buffer.from('Paciente'))).toBe(false);
  });

  test('o mesmo texto cifrado duas vezes dá resultados diferentes (IV novo a cada vez)', () => {
    const a = cifrar(TEXTO, AGENDAMENTO);
    const b = cifrar(TEXTO, AGENDAMENTO);

    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.conteudoCifrado.equals(b.conteudoCifrado)).toBe(false);
  });

  // O GCM autentica: qualquer byte alterado é detectado na decifragem.
  test.each([
    ['um byte do cifrado', 'conteudoCifrado'],
    ['um byte do IV', 'iv'],
    ['um byte da etiqueta', 'authTag'],
  ])('alterar %s faz a decifragem falhar', (_caso, campo) => {
    const c = cifrar(TEXTO, AGENDAMENTO);
    const adulterado = Buffer.from(c[campo]);
    adulterado[0] ^= 0x01;

    expect(() => decifrar({ ...c, [campo]: adulterado }, AGENDAMENTO)).toThrow();
  });

  test('registro de um agendamento não decifra como se fosse de outro (AAD)', () => {
    const c = cifrar(TEXTO, AGENDAMENTO);

    expect(() => decifrar(c, AGENDAMENTO + 1)).toThrow();
  });

  test('versão de chave inexistente: erro claro, sem nada do conteúdo', () => {
    const c = cifrar(TEXTO, AGENDAMENTO);

    expect(() => decifrar({ ...c, versaoChave: 99 }, AGENDAMENTO)).toThrow(/versão 99 não configurada/);
  });

  test('a mensagem de erro de decifragem não contém o texto', () => {
    const c = cifrar(TEXTO, AGENDAMENTO);
    let erro;
    try {
      decifrar(c, AGENDAMENTO + 1);
    } catch (e) {
      erro = e;
    }

    expect(String(erro.message)).not.toMatch(/Paciente|sono|respiração/);
  });
});
