const { z } = require('zod');
const registrosService = require('../services/registros.service');
const { validar, idSchema } = require('../utils/validacao');

// Teto do texto: ~10 páginas. Folgado para uma evolução de sessão e bem
// abaixo do limite de 100 KB do corpo JSON do Express (até 4 bytes por
// caractere em UTF-8).
const MAX_CARACTERES = 20_000;

// Sem trim no conteúdo salvo: quebras de linha e recuo fazem parte do texto
// clínico. Só recusa o que é vazio ou só espaços.
const registroSchema = z.object({
  conteudo: z
    .string('Informe o conteúdo do registro')
    .refine((t) => t.trim().length > 0, 'O registro não pode ficar vazio')
    .refine((t) => t.length <= MAX_CARACTERES, `O registro pode ter no máximo ${MAX_CARACTERES} caracteres`),
});

// O dono é sempre a usuária da sessão, nunca algo vindo da requisição.
const donoDa = (req) => req.usuario.id;

async function ler(req, res) {
  const { id } = validar(idSchema, req.params);
  res.json(await registrosService.ler(donoDa(req), id));
}

async function salvar(req, res) {
  const { id } = validar(idSchema, req.params);
  const { conteudo } = validar(registroSchema, req.body ?? {});
  const { criado, registro } = await registrosService.salvar(donoDa(req), id, conteudo);
  res.status(criado ? 201 : 200).json(registro);
}

module.exports = { ler, salvar, MAX_CARACTERES };
