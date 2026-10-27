-- Pacote 1.4.7 (refeito em 2026-10-25): financeiro em conta corrente.
-- Sai o Pagamento 1:1 por sessão; entram o preço por paciente, o valor e o
-- "cobrar?" da sessão e o Recebimento (que pode cobrir várias sessões).
--
-- Gerado com `prisma migrate diff` e reordenado à mão: os dados do Pagamento
-- são copiados ANTES de a tabela ser apagada (nada se perde).

-- AlterTable
ALTER TABLE "Agendamento" ADD COLUMN     "cobrar" BOOLEAN,
ADD COLUMN     "valor" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "Paciente" ADD COLUMN     "valorSessao" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "Recebimento" (
    "id" SERIAL NOT NULL,
    "psicologoId" INTEGER NOT NULL,
    "pacienteId" INTEGER NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "recebidoEm" TIMESTAMPTZ(3) NOT NULL,
    "formaPagamento" "FormaPagamento" NOT NULL,
    "sessoes" INTEGER,
    "estornadoEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recebimento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recebimento_psicologoId_recebidoEm_idx" ON "Recebimento"("psicologoId", "recebidoEm");

-- CreateIndex
CREATE INDEX "Recebimento_pacienteId_idx" ON "Recebimento"("pacienteId");

-- AddForeignKey
ALTER TABLE "Recebimento" ADD CONSTRAINT "Recebimento_psicologoId_fkey" FOREIGN KEY ("psicologoId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recebimento" ADD CONSTRAINT "Recebimento_pacienteId_psicologoId_fkey" FOREIGN KEY ("pacienteId", "psicologoId") REFERENCES "Paciente"("id", "psicologoId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Migração dos dados do Pagamento ──────────────────────────────────
-- O valor vai para a sessão.
UPDATE "Agendamento" a SET "valor" = p."valor"
FROM "Pagamento" p WHERE p."agendamentoId" = a."id";

-- O que estava PAGO vira um recebimento de 1 sessão, na data do pagamento.
INSERT INTO "Recebimento" ("psicologoId", "pacienteId", "valor", "recebidoEm", "formaPagamento", "sessoes")
SELECT a."psicologoId", a."pacienteId", p."valor", COALESCE(p."pagoEm", a."inicio"), p."formaPagamento", 1
FROM "Pagamento" p JOIN "Agendamento" a ON a."id" = p."agendamentoId"
WHERE p."status" = 'PAGO' AND p."formaPagamento" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Pagamento" DROP CONSTRAINT "Pagamento_agendamentoId_fkey";

-- DropTable
DROP TABLE "Pagamento";

-- DropEnum
DROP TYPE "StatusPagamento";

-- ── SQL manual (o Prisma não expressa CHECK) ─────────────────────────
-- Valores nunca negativos; recebimento sempre maior que zero (estorno é
-- marcado em "estornadoEm", não com valor negativo).
ALTER TABLE "Paciente" ADD CONSTRAINT "Paciente_valorSessao_nao_negativo_check" CHECK ("valorSessao" >= 0);
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_valor_nao_negativo_check" CHECK ("valor" >= 0);
ALTER TABLE "Recebimento" ADD CONSTRAINT "Recebimento_valor_positivo_check" CHECK ("valor" > 0);
ALTER TABLE "Recebimento" ADD CONSTRAINT "Recebimento_sessoes_positivo_check" CHECK ("sessoes" > 0);
