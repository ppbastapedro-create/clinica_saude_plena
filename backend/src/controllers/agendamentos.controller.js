const { z } = require('zod');
const agendamentosService = require('../services/agendamentos.service');
const { validar, idSchema } = require('../utils/validacao');

// Data/hora sempre com fuso (ex.: 2026-11-10T14:00:00-03:00 ou ...Z). Sem
// fuso, "14:00" seria interpretado no fuso de quem lê — o servidor no Render
// roda em UTC, e a sessão cairia 3 horas fora do lugar.
const dataHora = z
  .iso.datetime({ offset: true, error: 'Use data/hora ISO 8601 com fuso, ex.: 2026-11-10T14:00:00-03:00' })
  .transform((texto) => new Date(texto));

const intervaloSchema = z.object({ inicio: dataHora, fim: dataHora });

// psicologoId não está aqui (é descartado se vier no corpo): o dono é a
// usuária da sessão.
const criarSchema = intervaloSchema.extend({
  pacienteId: z.number('Informe o paciente').int().positive().max(2_147_483_647),
});

// Aceita os 4 status para que pedir "AGENDADO" responda 422 (transição não
// permitida, regra de negócio) e não 400 (valor desconhecido).
const statusSchema = z.object({ status: z.enum(['AGENDADO', 'REALIZADO', 'FALTA', 'CANCELADO']) });

// Período da agenda (o que a tela de calendário pede ao trocar de semana ou
// mês). Teto de 100 dias: evita uma consulta que traga anos de sessões.
const PERIODO_MAXIMO_MS = 100 * 24 * 60 * 60 * 1000;
const periodoSchema = intervaloSchema
  .extend({ incluirCancelados: z.enum(['true', 'false']).default('false').transform((v) => v === 'true') })
  .refine((p) => p.fim > p.inicio, { path: ['fim'], message: 'O fim do período deve ser depois do início' })
  .refine((p) => p.fim - p.inicio <= PERIODO_MAXIMO_MS, { path: ['fim'], message: 'Período máximo de 100 dias' });

// O dono é sempre a usuária da sessão, nunca algo vindo da requisição.
const donoDa = (req) => req.usuario.id;

async function listar(req, res) {
  const filtros = validar(periodoSchema, req.query);
  res.json(await agendamentosService.listar(donoDa(req), filtros));
}

async function buscar(req, res) {
  const { id } = validar(idSchema, req.params);
  res.json(await agendamentosService.buscar(donoDa(req), id));
}

async function criar(req, res) {
  const dados = validar(criarSchema, req.body ?? {});
  res.status(201).json(await agendamentosService.criar(donoDa(req), dados));
}

async function remarcar(req, res) {
  const { id } = validar(idSchema, req.params);
  const intervalo = validar(intervaloSchema, req.body ?? {});
  res.json(await agendamentosService.remarcar(donoDa(req), id, intervalo));
}

async function alterarStatus(req, res) {
  const { id } = validar(idSchema, req.params);
  const { status } = validar(statusSchema, req.body ?? {});
  res.json(await agendamentosService.alterarStatus(donoDa(req), id, status));
}

module.exports = { listar, buscar, criar, remarcar, alterarStatus };
