const { z } = require('zod');
const consentimentosService = require('../services/consentimentos.service');
const { validar, idSchema, dataHora } = require('../utils/validacao');

// Mesma tolerância do recebimento: relógio do computador um pouco adiantado.
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

// A versão do termo NÃO vem do cliente: é sempre a atual, definida no
// service. Só a data da assinatura pode ser informada (termo assinado em
// papel dias antes de ser lançado); padrão: agora.
const registroSchema = z.object({
  aceitoEm: dataHora
    .refine((d) => d.getTime() <= Date.now() + TOLERANCIA_FUTURO_MS, 'A data da assinatura não pode estar no futuro')
    .optional()
    .transform((d) => d ?? new Date()),
});

// O dono é sempre a usuária da sessão, nunca algo vindo da requisição.
const donoDa = (req) => req.usuario.id;

async function listar(req, res) {
  const { id } = validar(idSchema, req.params);
  res.json(await consentimentosService.listar(donoDa(req), id));
}

async function registrar(req, res) {
  const { id } = validar(idSchema, req.params);
  const dados = validar(registroSchema, req.body ?? {});
  res.status(201).json(await consentimentosService.registrar(donoDa(req), id, dados));
}

async function revogar(req, res) {
  const { id } = validar(idSchema, req.params);
  res.json(await consentimentosService.revogar(donoDa(req), id));
}

module.exports = { listar, registrar, revogar };
