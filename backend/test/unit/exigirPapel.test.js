const { exigirPapel } = require('../../src/middlewares/autenticacao');

// Teste de unidade do middleware: req/res falsos, sem banco nem HTTP. A
// checagem de papel é regra de segurança (o banco não a impõe), por isso tem
// teste próprio — exigência registrada no CLAUDE.md.
function respostaFalsa() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function executar(middleware, usuario) {
  const req = { usuario };
  const res = respostaFalsa();
  const next = jest.fn();
  middleware(req, res, next);
  return { res, next };
}

describe('exigirPapel', () => {
  test('papel permitido: segue (next)', () => {
    const { res, next } = executar(exigirPapel('PSICOLOGO'), { id: 1, papel: 'PSICOLOGO' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('papel não permitido: 403 e não segue', () => {
    const { res, next } = executar(exigirPapel('PSICOLOGO'), { id: 1, papel: 'ADMIN' });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ erro: 'Acesso negado' });
    expect(next).not.toHaveBeenCalled();
  });

  test('sem usuário autenticado: 401 e não segue', () => {
    const { res, next } = executar(exigirPapel('PSICOLOGO', 'ADMIN'), undefined);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test.each(['PSICOLOGO', 'ADMIN'])(
    "com vários papéis, aceita qualquer um deles (%s)",
    (papel) => {
      const { next } = executar(exigirPapel('PSICOLOGO', 'ADMIN'), { id: 1, papel });
      expect(next).toHaveBeenCalledTimes(1);
    },
  );

  test('papel desconhecido é recusado', () => {
    const { res, next } = executar(exigirPapel('PSICOLOGO', 'ADMIN'), { id: 1, papel: 'PACIENTE' });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
