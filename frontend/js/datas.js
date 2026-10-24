// Datas na tela. Tudo é calculado no fuso do computador da psicóloga (no DF,
// o de Brasília), e enviado à API com o fuso explícito — a API recusa
// data/hora sem fuso, porque o servidor (Render) roda em UTC.

export const MINUTO = 60_000;
export const DIA = 24 * 60 * MINUTO;

export function inicioDoDia(data) {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  return d;
}

// setDate (e não somar 24 h): em dia de mudança de horário de verão um dia
// não tem 24 h.
export function somarDias(data, dias) {
  const d = new Date(data);
  d.setDate(d.getDate() + dias);
  return d;
}

// Semana começando na segunda-feira, como no mockup.
export function inicioDaSemana(data) {
  const d = inicioDoDia(data);
  const diaDaSemana = (d.getDay() + 6) % 7; // segunda = 0 … domingo = 6
  return somarDias(d, -diaDaSemana);
}

export function inicioDoMes(data) {
  return new Date(data.getFullYear(), data.getMonth(), 1);
}

export function mesmoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const doisDigitos = (n) => String(n).padStart(2, '0');

// 2026-10-22T14:00:00-03:00 — o formato que a API espera.
export function isoComFuso(data) {
  const deslocamento = -data.getTimezoneOffset();
  const sinal = deslocamento >= 0 ? '+' : '-';
  const abs = Math.abs(deslocamento);
  return (
    `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}` +
    `T${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}:00` +
    `${sinal}${doisDigitos(Math.floor(abs / 60))}:${doisDigitos(abs % 60)}`
  );
}

// Valor de <input type="date"> (AAAA-MM-DD) e o caminho de volta.
export function paraInputData(data) {
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;
}

export function deInputData(texto) {
  const [ano, mes, dia] = String(texto ?? '').split('-').map(Number);
  if (!ano || !mes || !dia) return null;
  return new Date(ano, mes - 1, dia);
}

// Junta o dia de `data` com "HH:MM".
export function comHora(data, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(data);
  d.setHours(h, m, 0, 0);
  return d;
}

export const minutosEntre = (a, b) => Math.round((b - a) / MINUTO);

// ── Formatação (pt-BR) ───────────────────────────────────────────────
const fmt = (opcoes) => new Intl.DateTimeFormat('pt-BR', opcoes);
const fHora = fmt({ hour: '2-digit', minute: '2-digit' });
const fData = fmt({ day: '2-digit', month: '2-digit', year: 'numeric' });
const fDiaMes = fmt({ day: '2-digit', month: '2-digit' });
const fSemanaCurta = fmt({ weekday: 'short' });
const fSemanaLonga = fmt({ weekday: 'long' });
const fMesLongo = fmt({ month: 'long' });

const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export const hora = (d) => fHora.format(d); // 14:00
export const data = (d) => fData.format(d); // 22/10/2026
export const diaMes = (d) => fDiaMes.format(d); // 22/10
export const semanaCurta = (d) => maiuscula(fSemanaCurta.format(d).replace('.', '')); // Qui
export const semanaLonga = (d) => maiuscula(fSemanaLonga.format(d)); // Quinta-feira
export const mesAno = (d) => `${maiuscula(fMesLongo.format(d))} de ${d.getFullYear()}`; // Outubro de 2026

// Quinta-feira, 22 de outubro de 2026
export function dataLonga(d, { comAno = true } = {}) {
  return `${semanaLonga(d)}, ${d.getDate()} de ${fMesLongo.format(d)}${comAno ? ` de ${d.getFullYear()}` : ''}`;
}

// 14:00 – 14:50
export const intervalo = (inicio, fim) => `${hora(inicio)} – ${hora(fim)}`;

// "Hoje · 16:00", "Amanhã · 09:00" ou "Qui, 22/10 · 09:00"
export function quando(d, agora = new Date()) {
  if (mesmoDia(d, agora)) return `Hoje · ${hora(d)}`;
  if (mesmoDia(d, somarDias(agora, 1))) return `Amanhã · ${hora(d)}`;
  return `${semanaCurta(d)}, ${diaMes(d)} · ${hora(d)}`;
}

// 1º–24 de outubro de 2026 / 28 de setembro – 3 de outubro de 2026
export function rotuloPeriodo(inicio, fimInclusivo) {
  const mesmoMes = inicio.getMonth() === fimInclusivo.getMonth();
  const ini = mesmoMes ? `${inicio.getDate()}` : `${inicio.getDate()} de ${fMesLongo.format(inicio)}`;
  return `${ini} – ${fimInclusivo.getDate()} de ${fMesLongo.format(fimInclusivo)}, ${fimInclusivo.getFullYear()}`;
}

// Data/hora vinda da API (texto ISO) → Date. Aceita Date também.
export const lerData = (valor) => (valor instanceof Date ? valor : new Date(valor));
