-- Paciente particular ou de clínica/plano de saúde (pedido da parceira,
-- 2026-11-05). Pacientes já cadastrados ficam PARTICULAR (o padrão) e todas
-- as sessões existentes ficam como pagas pelo paciente: nada muda no saldo de
-- ninguém com esta migração.

-- CreateEnum
CREATE TYPE "TipoAtendimento" AS ENUM ('PARTICULAR', 'CLINICA');

-- AlterTable
ALTER TABLE "Paciente" ADD COLUMN     "clinica" TEXT,
ADD COLUMN     "tipoAtendimento" "TipoAtendimento" NOT NULL DEFAULT 'PARTICULAR';

-- AlterTable
ALTER TABLE "Agendamento" ADD COLUMN     "pagoPelaClinica" BOOLEAN NOT NULL DEFAULT false;

-- ── SQL manual (o Prisma não expressa CHECK) ─────────────────────────
-- Paciente de clínica tem o nome da clínica/plano; particular não tem. A API
-- já valida (400 com mensagem no campo); o banco é a garantia final.
-- btrim: um nome só de espaços não conta como preenchido.
ALTER TABLE "Paciente" ADD CONSTRAINT "Paciente_clinica_conforme_tipo_check" CHECK (
  ("tipoAtendimento" = 'CLINICA' AND "clinica" IS NOT NULL AND btrim("clinica") <> '')
  OR ("tipoAtendimento" = 'PARTICULAR' AND "clinica" IS NULL)
);
