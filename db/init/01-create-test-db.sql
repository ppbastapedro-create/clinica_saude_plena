-- Roda só na primeira inicialização do volume do Postgres. Se o container já
-- existia antes desta mudança, crie o banco de teste manualmente:
--   docker compose exec db createdb -U saude_plena saude_plena_test
CREATE DATABASE saude_plena_test;
