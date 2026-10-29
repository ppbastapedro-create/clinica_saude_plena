const consentimentosRepository = require('../repositories/consentimentos.repository');
const pacientesRepository = require('../repositories/pacientes.repository');
const { ErroHttp } = require('../utils/erros');
const { formatarData } = require('../utils/datas');

// Termo de consentimento LGPD do paciente (escopo da EAP; LGPD art. 8º e 11).
//
// O termo é assinado em papel (modelo em frontend/termo-consentimento.html);
// o sistema registra QUE foi aceito, QUANDO e QUAL versão do texto. Mudou o
// texto do termo → nova versão aqui e no rodapé do modelo.
//
// Revogar é direito do titular a qualquer momento (art. 8º, §5º). A revogação
// não apaga nada: os registros de atendimento são obrigação profissional
// (guarda mínima de 5 anos, Resolução CFP nº 001/2009; LGPD art. 16, I). Ela
// interrompe o que depende do consentimento — hoje, o lembrete por e-mail.
const VERSAO_TERMO_ATUAL = 'v1';

const naoEncontrado = () => new ErroHttp(404, 'Paciente não encontrado');

async function listar(psicologoId, pacienteId) {
  const paciente = await pacientesRepository.buscarPorId(psicologoId, pacienteId);
  if (!paciente) throw naoEncontrado();
  const historico = await consentimentosRepository.listarDoPaciente(pacienteId);
  return {
    versaoAtual: VERSAO_TERMO_ATUAL,
    vigente: historico.find((c) => c.revogadoEm === null) ?? null,
    historico,
  };
}

// Um vigente por vez. Paciente arquivado não registra aceite novo (não está
// em acompanhamento) — mas pode revogar, abaixo.
async function registrar(psicologoId, pacienteId, { aceitoEm }) {
  const r = await consentimentosRepository.registrarSeSemVigente(psicologoId, pacienteId, {
    versaoTermo: VERSAO_TERMO_ATUAL,
    aceitoEm,
  });
  switch (r.situacao) {
    case 'nao_encontrado':
      throw naoEncontrado();
    case 'arquivado':
      throw new ErroHttp(422, 'Paciente arquivado. Reative o cadastro antes de registrar o consentimento.');
    case 'ja_vigente':
      throw new ErroHttp(
        422,
        `Já existe um consentimento vigente (termo ${r.consentimento.versaoTermo}, aceito em ${formatarData(r.consentimento.aceitoEm)}).`,
      );
    default:
      return r.consentimento;
  }
}

async function revogar(psicologoId, pacienteId) {
  const r = await consentimentosRepository.revogarVigente(psicologoId, pacienteId, new Date());
  if (r.situacao === 'nao_encontrado') throw naoEncontrado();
  if (r.situacao === 'sem_vigente') throw new ErroHttp(422, 'Este paciente não tem consentimento vigente para revogar.');
  return r.consentimento;
}

module.exports = { listar, registrar, revogar, VERSAO_TERMO_ATUAL };
