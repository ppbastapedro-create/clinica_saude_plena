const { z } = require('zod');
const pacientesService = require('../services/pacientes.service');
const agendamentosService = require('../services/agendamentos.service');
const { validar, idSchema } = require('../utils/validacao');
const { cpfValido, normalizarCpf } = require('../utils/cpf');

// Campo opcional: formulário costuma mandar "" para campo em branco, e o
// campo pode nem vir no corpo. Os dois viram null — o banco guarda "não
// informado", não um texto vazio. E precisa ser null, não undefined: para o
// Prisma, undefined significa "não mexa neste campo", e o PUT deixaria o valor
// antigo no lugar em vez de apagá-lo.
const vazioViraNull = (valor) =>
  valor === undefined || (typeof valor === 'string' && valor.trim() === '') ? null : valor;
const opcional = (schema) => z.preprocess(vazioViraNull, schema.nullable());

// Telefone brasileiro com DDD: 10 dígitos (fixo) ou 11 (celular). Aceita
// máscara e o +55 na frente; guarda só os dígitos, sem o 55.
const telefoneSchema = z
  .string()
  .trim()
  .regex(/^[\d\s()+-]+$/, 'Telefone com caracteres inválidos')
  .transform((t) => t.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''))
  .refine((t) => t.length === 10 || t.length === 11, 'Telefone deve ter DDD + número (10 ou 11 dígitos)');

// Só os campos abaixo são aceitos — o Zod descarta o resto do corpo. Por
// isso um `psicologoId` (ou `arquivadoEm`) enviado pelo cliente é ignorado:
// o dono vem sempre da sessão.
//
// PUT usa o mesmo schema: substitui o cadastro inteiro. Campo opcional
// omitido no PUT vira null (apaga o e-mail, por exemplo).
const pacienteSchema = z.object({
  nome: z.string().trim().min(2, 'Nome muito curto').max(120, 'Nome muito longo'),
  cpf: z.string().trim().refine(cpfValido, 'CPF inválido').transform(normalizarCpf),
  email: opcional(z.string().trim().toLowerCase().pipe(z.email('E-mail inválido').max(254))),
  telefone: opcional(telefoneSchema),
});

const filtrosSchema = z.object({
  busca: z.string().trim().max(100).optional(),
  situacao: z.enum(['ativos', 'arquivados', 'todos']).default('ativos'),
});

// O dono é sempre a usuária da sessão, nunca algo vindo da requisição.
const donoDa = (req) => req.usuario.id;

async function listar(req, res) {
  const filtros = validar(filtrosSchema, req.query);
  res.json(await pacientesService.listar(donoDa(req), filtros));
}

async function buscar(req, res) {
  const { id } = validar(idSchema, req.params);
  res.json(await pacientesService.buscar(donoDa(req), id));
}

async function criar(req, res) {
  const dados = validar(pacienteSchema, req.body ?? {});
  res.status(201).json(await pacientesService.criar(donoDa(req), dados));
}

async function atualizar(req, res) {
  const { id } = validar(idSchema, req.params);
  const dados = validar(pacienteSchema, req.body ?? {});
  res.json(await pacientesService.atualizar(donoDa(req), id, dados));
}

async function arquivar(req, res) {
  const { id } = validar(idSchema, req.params);
  res.json(await pacientesService.arquivar(donoDa(req), id));
}

async function reativar(req, res) {
  const { id } = validar(idSchema, req.params);
  res.json(await pacientesService.reativar(donoDa(req), id));
}

// Histórico de sessões do paciente (ficha). A regra mora no service da agenda.
async function sessoes(req, res) {
  const { id } = validar(idSchema, req.params);
  res.json(await agendamentosService.listarDoPaciente(donoDa(req), id));
}

module.exports = { listar, buscar, criar, atualizar, arquivar, reativar, sessoes };
