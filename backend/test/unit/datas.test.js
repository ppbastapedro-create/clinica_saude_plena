const { meiaNoiteNoFuso } = require('../../src/utils/datas');
const { limitesDoMes } = require('../../src/services/relatorios.service');

// Limites do mês no fuso da parceira (America/Sao_Paulo, UTC−3 desde 2019),
// qualquer que seja o fuso do servidor. Este teste existe porque o cálculo
// antigo (new Date(ano, mes, 1)) usava o fuso do PROCESSO: passava no PC do
// autor (Windows em Brasília) e falhava no CI (UTC) — o mês começava às 21h
// do dia anterior. Rode com TZ=UTC para reproduzir o servidor:
//   $env:TZ="UTC"; npx jest test/unit/datas.test.js

describe('meiaNoiteNoFuso', () => {
  test('00:00 em Brasília = 03:00 UTC', () => {
    expect(meiaNoiteNoFuso(2020, 10, 1).toISOString()).toBe('2020-10-01T03:00:00.000Z');
  });

  test('mês 13 vira janeiro do ano seguinte', () => {
    expect(meiaNoiteNoFuso(2026, 13, 1).toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  test('época de horário de verão (antes de 2019): 00:00 de 01/01/2018 era UTC−2', () => {
    expect(meiaNoiteNoFuso(2018, 1, 1).toISOString()).toBe('2018-01-01T02:00:00.000Z');
  });
});

describe('limitesDoMes', () => {
  test('outubro de 2020: de 01/10 00:00 a 01/11 00:00, horário de Brasília', () => {
    const { inicio, fim } = limitesDoMes('2020-10');

    expect(inicio.toISOString()).toBe('2020-10-01T03:00:00.000Z');
    expect(fim.toISOString()).toBe('2020-11-01T03:00:00.000Z');
  });

  test('dezembro fecha em 1º de janeiro do ano seguinte', () => {
    expect(limitesDoMes('2026-12').fim.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  test('31/10 às 23:30 de Brasília (já 01/11 em UTC) fica em outubro', () => {
    const { inicio, fim } = limitesDoMes('2020-10');
    const sessao = new Date('2020-10-31T23:30:00-03:00');

    expect(sessao >= inicio && sessao < fim).toBe(true);
  });
});
