// Criação de elementos sem innerHTML.
//
// Por quê: nome de paciente, e-mail e texto do registro vêm do banco. Se
// fossem colados numa string HTML (innerHTML), um nome como
// "<img src=x onerror=...>" viraria código rodando na página (XSS). Aqui todo
// texto entra como nó de texto — o navegador nunca o interpreta como HTML.
//
// Uso: el('a', { class: 'link', href: '#/pacientes' }, 'Pacientes', outroElemento)

const PROPRIEDADES = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'readOnly', 'required']);

export function el(tag, props = {}, ...filhos) {
  const elemento = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props ?? {})) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (chave === 'class') elemento.className = valor;
    else if (chave === 'dataset') Object.assign(elemento.dataset, valor);
    else if (chave.startsWith('on') && typeof valor === 'function') {
      elemento.addEventListener(chave.slice(2), valor);
    } else if (PROPRIEDADES.has(chave)) elemento[chave] = valor;
    else elemento.setAttribute(chave, valor === true ? '' : String(valor));
  }
  anexar(elemento, filhos);
  return elemento;
}

// Aceita elementos, textos, números e listas (aninhadas). null/false são
// ignorados — permite `condicao && el(...)` direto na lista de filhos.
export function anexar(pai, filhos) {
  for (const filho of [filhos].flat(Infinity)) {
    if (filho === null || filho === undefined || filho === false) continue;
    pai.append(filho instanceof Node ? filho : String(filho));
  }
  return pai;
}

export function trocar(pai, ...filhos) {
  pai.replaceChildren();
  return anexar(pai, filhos);
}
