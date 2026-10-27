const { z } = require('zod');
const agendamentosService = require('../services/agendamentos.service');
const { validar, idSchema, dataHora, valorSchema } = require('../utils/validacao');

const intervaloSchema = z.object({ inicio: dataHora, fim: dataHora });

// psicologoId não está aqui (é descartado se vier no corpo): o dono é a
// usuária da sessão. `valor` (preço desta sessão): omitido = preço padrão do
// paciente; null = sem valor. Pode ser ajustado depois em PATCH /:id/cobranca.
const criarSchema = intervaloSchema.extend({
  pacienteId: z.number('Informe o paciente').int().positive().max(2_147_483_647),
  valor: valorSchema.nullable().optional(),
});

// Cobrança da sessão: o que vier é alterado, o que faltar fica como está.
// cobrar: true = cobra (inclusive uma falta); false = não cobra (ex.:
// cortesia); null = volta para a regra padrão pelo status.
const cobrancaSchema = z
  .object({
    valor: valorSchema.nullable().optional(),
    cobrar: z.boolean('cobrar deve ser true, false ou null').nullable().optional(),
  })
  .refine((d) => d.valor !== undefined || d.cobrar !== undefined, { message: 'Informe valor e/ou cobrar', path: ['valor'] });

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

async function atualizarCobranca(req, res) {
  const { id } = validar(idSchema, req.params);
  const dados = validar(cobrancaSchema, req.body ?? {});
  res.json(await agendamentosService.atualizarCobranca(donoDa(req), id, dados));
}

module.exports = { listar, buscar, criar, remarcar, alterarStatus, atualizarCobranca };
