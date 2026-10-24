// Ícones em SVG (traços no estilo Lucide), criados pelo DOM. Cada ícone é a
// lista de "d" dos <path> num quadro de 24×24.
const NS = 'http://www.w3.org/2000/svg';

const CAMINHOS = {
  coracao: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'],
  mais: ['M5 12h14', 'M12 5v14'],
  esquerda: ['m15 18-6-6 6-6'],
  direita: ['m9 18 6-6-6-6'],
  busca: ['M11 3a8 8 0 1 0 0 16a8 8 0 1 0 0-16z', 'm21 21-4.3-4.3'],
  relogio: ['M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z', 'M12 6v6l4 2'],
  cartao: ['M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M2 10h20'],
  cadeado: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  email: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'm22 7-10 6L2 7'],
  ok: ['M20 6 9 17l-5-5'],
  aviso: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z', 'M12 9v4', 'M12 17h.01'],
  erro: ['M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z', 'M12 8v4', 'M12 16h.01'],
  escudo: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'],
  impressora: ['M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 9V2h12v7', 'M6 14h12v8H6z'],
  arquivo: ['M3 3h18v5H3z', 'M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8', 'M10 12h4'],
};

export function icone(nome, classeExtra = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icone ${classeExtra}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  for (const d of CAMINHOS[nome] ?? []) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
