const pacientesRepository = require('../repositories/pacientes.repository');
const { ErroHttp } = require('../utils/erros');
const { formatarDataHora } = require('../utils/datas');
const { formatarValor } = require('../utils/dinheiro');

// 404 também para paciente de OUTRA psicóloga (e não 403): responder
// "acesso negado" confirmaria que aquele id existe.
const naoEncontrado = () => new ErroHttp(404, 'Paciente não encontrado');

// Preço como texto com 2 casas ("120.00"), como todo valor da API. Do
// consentimento LGPD, só se há um vigente (o histórico tem rota própria).
const paraResposta = (p) => {
  if (!p) return p;
  const { consentimentos, ...dados } = p;
  return { ...dados, valorSessao: formatarValor(p.valorSessao), consentimentoVigente: consentimentos.length > 0 };
};

// Códigos de erro do Prisma: P2002 = violou restrição UNIQUE (aqui, o
// @@unique([psicologoId, cpf])); P2025 = registro do update não encontrado.
const CPF_DUPLICADO = 'P2002';
const REGISTRO_INEXISTENTE = 'P2025';

async function listar(psicologoId, filtros) {
  return (await pacientesRepository.listar(psicologoId, filtros)).map(paraResposta);
}

async function buscar(psicologoId, id) {
  const paciente = await pacientesRepository.buscarPorId(psicologoId, id);
  if (!paciente) throw naoEncontrado();
  return paraResposta(paciente);
}

// A unicidade do CPF fica a cargo do banco: o service não confere antes e
// depois grava (duas requisições simultâneas passariam juntas pela
// conferência). Tenta gravar e, se o banco recusar, explica o motivo.
async function comTratamentoDeErro(psicologoId, cpf, operacao) {
  try {
    return paraResposta(await operacao());
  } catch (erro) {
    if (erro.code === REGISTRO_INEXISTENTE) throw naoEncontrado();
    if (erro.code === CPF_DUPLICADO) throw await erroCpfDuplicado(psicologoId, cpf);
    throw erro;
  }
}

async function erroCpfDuplicado(psicologoId, cpf) {
  const existente = await pacientesRepository.buscarPorCpf(psicologoId, cpf);
  // Diz qual é o paciente (é a própria psicóloga quem cadastrou) e, se estiver
  // arquivado, que o caminho é reativá-lo — não cadastrar de novo.
  const mensagem = existente?.arquivadoEm
    ? 'Já existe um paciente arquivado com este CPF. Reative o cadastro em vez de criar outro.'
    : 'Já existe um paciente com este CPF.';
  return new ErroHttp(409, mensagem, { pacienteId: existente?.id });
}

async function criar(psicologoId, dados) {
  return comTratamentoDeErro(psicologoId, dados.cpf, () => pacientesRepository.criar(psicologoId, dados));
}

// Paciente arquivado pode ser editado: corrigir dados é direito do titular
// (LGPD art. 18, III), inclusive depois do fim do acompanhamento.
async function atualizar(psicologoId, id, dados) {
  return comTratamentoDeErro(psicologoId, dados.cpf, () => pacientesRepository.atualizar(psicologoId, id, dados));
}

// Quantas datas a mensagem lista antes de resumir ("e mais N").
const MAX_DATAS_NA_MENSAGEM = 5;

function mensagemSessoesFuturas(sessoes) {
  const datas = sessoes.slice(0, MAX_DATAS_NA_MENSAGEM).map((s) => formatarDataHora(s.inicio));
  const resto = sessoes.length - datas.length;
  const lista = datas.join('; ') + (resto > 0 ? ` e mais ${resto}` : '');
  const quantas = sessoes.length === 1 ? 'Há 1 sessão agendada' : `Há ${sessoes.length} sessões agendadas`;
  return `${quantas} para este paciente: ${lista}. Cancele-as antes de arquivar.`;
}

// Bloqueia (422) enquanto houver sessão AGENDADO futura — decisão do autor,
// opção (a): nada é cancelado sem a psicóloga ver. Sessões passadas
// pendentes não bloqueiam e continuam podendo ser fechadas depois.
// Idempotente: arquivar de novo mantém a data original, que registra quando
// o acompanhamento terminou de fato.
async function arquivar(psicologoId, id) {
  const resultado = await pacientesRepository.arquivarSeSemSessoesFuturas(psicologoId, id, new Date());

  switch (resultado.situacao) {
    case 'nao_encontrado':
      throw naoEncontrado();
    case 'sessoes_futuras':
      throw new ErroHttp(422, mensagemSessoesFuturas(resultado.sessoes), { sessoesFuturas: resultado.sessoes });
    default: // 'arquivado' ou 'ja_arquivado'
      return paraResposta(resultado.paciente);
  }
}

async function reativar(psicologoId, id) {
  const paciente = await buscar(psicologoId, id);
  if (!paciente.arquivadoEm) return paciente;
  return comTratamentoDeErro(psicologoId, null, () =>
    pacientesRepository.atualizar(psicologoId, id, { arquivadoEm: null }),
  );
}

module.exports = { listar, buscar, criar, atualizar, arquivar, reativar };
