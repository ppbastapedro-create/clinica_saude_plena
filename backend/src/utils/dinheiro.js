// Dinheiro na API: sempre texto com 2 casas ("180.50"), nunca número.
//
// Por quê: em float, 0.1 + 0.2 = 0.30000000000000004. O banco guarda
// Decimal(10, 2) exato; aqui a conversão também é exata, e as somas feitas no
// JavaScript são em centavos inteiros.

// Decimal do Prisma (ou texto) → "180.50". null continua null.
const formatarValor = (valor) => (valor === null || valor === undefined ? null : Number(valor).toFixed(2));

// "180.50" → 18050 (centavos). Exato: o texto sempre tem 2 casas.
function centavos(valor) {
  const [reais, cents = '00'] = formatarValor(valor).split('.');
  return Number(reais) * 100 + Number(cents);
}

// 18050 → "180.50"; -8750 → "-87.50" (saldo devedor).
function paraReais(c) {
  const sinal = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  return `${sinal}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// Soma uma lista de valores ("180.50", Decimal, null…) ignorando os nulos.
const somar = (valores) => valores.reduce((soma, v) => (v === null || v === undefined ? soma : soma + centavos(v)), 0);

module.exports = { formatarValor, centavos, paraReais, somar };
