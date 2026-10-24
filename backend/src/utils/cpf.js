// Validação de CPF reaproveitada do Projeto 3 (backend/server.js), com uma
// correção: lá, qualquer caractere que não fosse dígito era removido antes de
// validar, então "abc111.444.777-35xyz" passava. Aqui o formato é conferido
// antes: só dígitos, com ou sem a máscara 000.000.000-00.
const FORMATO_CPF = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/;

// Remove a máscara. O banco guarda sempre os 11 dígitos, sem pontuação —
// senão "111.444.777-35" e "11144477735" seriam dois CPFs "diferentes" para a
// restrição de unicidade.
function normalizarCpf(cpf) {
  return cpf.replace(/\D/g, '');
}

// Dígito verificador: soma ponderada dos dígitos anteriores, módulo 11.
function digitoVerificador(digitos) {
  const pesoInicial = digitos.length + 1; // 10 para o 1º dígito, 11 para o 2º
  const soma = [...digitos].reduce((total, d, i) => total + Number(d) * (pesoInicial - i), 0);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

function cpfValido(cpf) {
  if (typeof cpf !== 'string' || !FORMATO_CPF.test(cpf)) return false;
  const digitos = normalizarCpf(cpf);

  // 000.000.000-00, 111.111.111-11 etc. passam na conta, mas não existem.
  if (/^(\d)\1{10}$/.test(digitos)) return false;

  return (
    digitoVerificador(digitos.slice(0, 9)) === Number(digitos[9]) &&
    digitoVerificador(digitos.slice(0, 10)) === Number(digitos[10])
  );
}

module.exports = { cpfValido, normalizarCpf };
