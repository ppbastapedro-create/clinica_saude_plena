const { z } = require('zod');
const financeiroService = require('../services/financeiro.service');
const { validar, idSchema, dataHora, valorSchema } = require('../utils/validacao');

// Tolerância para relógio do computador um pouco adiantado em relação ao
// servidor: "recebido agora" não pode ser recusado por 30 s de diferença.
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

const recebimentoSchema = z.object({
  valor: valorSchema.refine((v) => Number(v) > 0, 'O valor recebido deve ser maior que zero'),
  formaPagamento: z.enum(['PIX', 'DINHEIRO', 'CARTAO', 'TRANSFERENCIA'], 'Informe a forma de pagamento'),
  // Data do recebimento (padrão: agora). Pode ser no passado (lançar o que
  // está no caderno), não no futuro.
  recebidoEm: dataHora
    .refine((d) => d.getTime() <= Date.now() + TOLERANCIA_FUTURO_MS, 'A data do recebimento não pode estar no futuro')
    .optional()
    .transform((d) => d ?? new Date()),
  // Quantas sessões o valor cobre (informativo).
  sessoes: z.number('Informe um número de sessões').int().min(1).max(100).nullish(),
});

// O dono é sempre a usuária da sessão, nunca algo vindo da requisição.
const donoDa = (req) => req.usuario.id;

async function extrato(req, res) {
  const { id } = validar(idSchema, req.params);
  res.json(await financeiroService.extrato(donoDa(req), id));
}

async function registrarRecebimento(req, res) {
  const { id } = validar(idSchema, req.params);
  const dados = validar(recebimentoSchema, req.body ?? {});
  res.status(201).json(await financeiroService.registrarRecebimento(donoDa(req), id, dados));
}

async function estornarRecebimento(req, res) {
  const { id } = validar(idSchema, req.params);
  res.json(await financeiroService.estornarRecebimento(donoDa(req), id));
}

async function saldos(req, res) {
  res.json(await financeiroService.saldos(donoDa(req)));
}

module.exports = { extrato, registrarRecebimento, estornarRecebimento, saldos };
