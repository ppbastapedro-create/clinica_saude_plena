const { z } = require('zod');
const relatoriosService = require('../services/relatorios.service');
const { validar } = require('../utils/validacao');

const mensalSchema = z.object({
  mes: z.string('Informe o mês').regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use o formato AAAA-MM, ex.: 2026-10'),
});

// O dono é sempre a usuária da sessão, nunca algo vindo da requisição.
const donoDa = (req) => req.usuario.id;

async function mensal(req, res) {
  const { mes } = validar(mensalSchema, req.query);
  res.json(await relatoriosService.mensal(donoDa(req), mes));
}

module.exports = { mensal };
