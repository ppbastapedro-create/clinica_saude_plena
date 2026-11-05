const env = require('../config/env');

// Datas nas mensagens ao usuário, sempre no fuso da parceira (o servidor no
// Render roda em UTC).
const diaHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: env.TZ,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const diaMesAnoHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: env.TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: env.TZ, hour: '2-digit', minute: '2-digit' });
const diaSemanaData = new Intl.DateTimeFormat('pt-BR', {
  timeZone: env.TZ,
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const diaMesAno = new Intl.DateTimeFormat('pt-BR', { timeZone: env.TZ, day: '2-digit', month: '2-digit', year: 'numeric' });

// Partes de data/hora de um instante NO FUSO DA PARCEIRA (ano, mês, dia...).
const partesNoFuso = new Intl.DateTimeFormat('en-US', {
  timeZone: env.TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

// Quanto o fuso está à frente do UTC naquele instante, em ms (Brasília: -3 h).
function deslocamentoDoFuso(instante) {
  const p = Object.fromEntries(partesNoFuso.formatToParts(instante).map(({ type, value }) => [type, Number(value)]));
  const comoSeFosseUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return comoSeFosseUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

// Meia-noite de um dia NO FUSO DA PARCEIRA, como instante absoluto. `mes` de
// 1 a 12; mês 13 vira janeiro do ano seguinte (como no Date.UTC).
//
// Por que não `new Date(ano, mes - 1, dia)`: esse construtor usa o fuso do
// PROCESSO, que depende do servidor — e mudar process.env.TZ em tempo de
// execução não vale dentro do Jest (o process.env dos testes é uma cópia).
// No PC do autor (Windows em Brasília) dava certo por coincidência; no CI
// (UTC) o mês começava às 21h do dia anterior. O Intl usa o fuso informado,
// em qualquer servidor.
function meiaNoiteNoFuso(ano, mes, dia) {
  const meiaNoiteUtc = Date.UTC(ano, mes - 1, dia);
  const palpite = meiaNoiteUtc - deslocamentoDoFuso(new Date(meiaNoiteUtc));
  // Confere o deslocamento no próprio instante calculado (diferente só se a
  // virada cair numa troca de horário de verão).
  return new Date(meiaNoiteUtc - deslocamentoDoFuso(new Date(palpite)));
}

module.exports = {
  meiaNoiteNoFuso,
  formatarData: (data) => diaMesAno.format(data), // "04/03/2030"
  formatarDiaSemanaData: (data) => diaSemanaData.format(data), // "segunda-feira, 04/03/2030"
  formatarDiaHora: (data) => diaHora.format(data), // "04/03, 14:00"
  formatarDataHora: (data) => diaMesAnoHora.format(data), // "04/03/2030, 14:00"
  formatarHora: (data) => hora.format(data), // "14:00"
};
