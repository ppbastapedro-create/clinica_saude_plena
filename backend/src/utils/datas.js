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

module.exports = {
  formatarDiaSemanaData: (data) => diaSemanaData.format(data), // "segunda-feira, 04/03/2030"
  formatarDiaHora: (data) => diaHora.format(data), // "04/03, 14:00"
  formatarDataHora: (data) => diaMesAnoHora.format(data), // "04/03/2030, 14:00"
  formatarHora: (data) => hora.format(data), // "14:00"
};
