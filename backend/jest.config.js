module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setupEnv.js'],

  // Cobertura (pacote 1.5.1) — `npm run test:cobertura`. Mede só o código da
  // aplicação; server.js só sobe o servidor (app.listen), sem regra nenhuma.
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageReporters: ['text', 'text-summary', 'html'],
  // Critério de aceitação da EAP: "cobertura mínima de 70% nas regras". As
  // regras de negócio moram nos services; abaixo disso, o Jest (e o CI)
  // falham. O total do projeto segue o mesmo piso.
  coverageThreshold: {
    global: { statements: 70, branches: 70, functions: 70, lines: 70 },
    './src/services/': { statements: 70, branches: 70, functions: 70, lines: 70 },
  },
};
