-- Pacote 1.4.8: lembrete de sessão por e-mail, só para paciente com opt-in.
-- Pacientes já cadastrados ficam com "não" (o padrão): ninguém passa a
-- receber e-mail sem a psicóloga marcar.

-- AlterTable
ALTER TABLE "Paciente" ADD COLUMN     "receberLembrete" BOOLEAN NOT NULL DEFAULT false;

-- ── SQL manual (o Prisma não expressa CHECK) ─────────────────────────
-- Quem recebe lembrete precisa ter e-mail. A API já valida (400 com mensagem
-- amigável); o banco é a garantia final.
ALTER TABLE "Paciente" ADD CONSTRAINT "Paciente_lembrete_exige_email_check" CHECK (NOT "receberLembrete" OR "email" IS NOT NULL);
