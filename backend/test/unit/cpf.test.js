const { cpfValido, normalizarCpf } = require('../../src/utils/cpf');

// CPFs fictícios, válidos só pela conta dos dígitos verificadores.
describe('cpfValido', () => {
  test.each(['11144477735', '111.444.777-35', '52998224725', '529.982.247-25', '98765432100'])(
    'aceita %s',
    (cpf) => expect(cpfValido(cpf)).toBe(true),
  );

  test.each([
    ['1º dígito verificador errado', '11144477745'],
    ['2º dígito verificador errado', '11144477736'],
    ['todos os dígitos iguais', '111.111.111-11'],
    ['zeros', '00000000000'],
    ['10 dígitos', '1114447773'],
    ['12 dígitos', '111444777350'],
    // Este passava no validador do Projeto 3 (letras eram removidas antes).
    ['letras em volta de um CPF válido', 'abc111.444.777-35xyz'],
    ['separador estranho', '111/444/777-35'],
    ['espaços no meio', '111 444 777 35'],
    ['vazio', ''],
  ])('recusa: %s', (_caso, cpf) => expect(cpfValido(cpf)).toBe(false));

  test.each([null, undefined, 11144477735])('recusa o que não é texto (%p)', (valor) => {
    expect(cpfValido(valor)).toBe(false);
  });
});

test('normalizarCpf remove a máscara', () => {
  expect(normalizarCpf('111.444.777-35')).toBe('11144477735');
});
