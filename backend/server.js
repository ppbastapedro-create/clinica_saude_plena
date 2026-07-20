const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');

function validarCPF(cpf) {
  cpf = cpf.replace(/[^\d]/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i);
  let dig1 = (soma * 10) % 11;
  if (dig1 === 10) dig1 = 0;
  if (dig1 !== parseInt(cpf[9])) return false;

  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i);
  let dig2 = (soma * 10) % 11;
  if (dig2 === 10) dig2 = 0;
  if (dig2 !== parseInt(cpf[10])) return false;

  return true;
}

const PORT = 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('API da Clínica Saúde Plena está no ar');
});

app.get('/especialidades', (req, res) => {
  const arquivo = path.join(__dirname, 'data', 'profissionais.json');
  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
  res.json(dados.especialidades);
});

app.get('/profissionais', (req, res) => {
  const arquivo = path.join(__dirname, 'data', 'profissionais.json');
  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
  const especialidade = req.query.especialidade;

  if (especialidade) {
    const filtrados = dados.profissionais.filter(p => p.especialidade === especialidade);
    res.json(filtrados);
  } else {
    res.json(dados.profissionais);
  }
});

app.get('/profissionais/busca', (req, res) => {
  const arquivo = path.join(__dirname, 'data', 'profissionais.json');
  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
  const nome = (req.query.nome || '').toLowerCase();
  const encontrados = dados.profissionais.filter(p => p.nome.toLowerCase().includes(nome));
  res.json(encontrados);
});

app.get('/profissionais', (req, res) => {
  const arquivo = path.join(__dirname, 'data', 'profissionais.json');
  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
  const especialidade = req.query.especialidade;

  if (especialidade) {
    const filtrados = dados.profissionais.filter(p => p.especialidade === especialidade);
    res.json(filtrados);
  } else {
    res.json(dados.profissionais);
  }
});

app.get('/profissionais/busca', (req, res) => {
  const arquivo = path.join(__dirname, 'data', 'profissionais.json');
  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
  const nome = (req.query.nome || '').toLowerCase();
  const encontrados = dados.profissionais.filter(p => p.nome.toLowerCase().includes(nome));
  res.json(encontrados);
});

app.get('/horarios/:profissionalId', (req, res) => {
  const arqProf = path.join(__dirname, 'data', 'profissionais.json');
  const arqAgend = path.join(__dirname, 'data', 'agendamentos.json');
  const dados = JSON.parse(fs.readFileSync(arqProf, 'utf-8'));
  const agendamentos = JSON.parse(fs.readFileSync(arqAgend, 'utf-8'));

  const id = Number(req.params.profissionalId);
  const profissional = dados.profissionais.find(p => p.id === id);

  if (!profissional) {
    return res.status(404).json({ erro: 'Profissional não encontrado' });
  }

  const ocupados = agendamentos
    .filter(a => a.profissionalId === id)
    .map(a => a.data + ' ' + a.hora);

  const livres = profissional.horarios.filter(h => {
    return !ocupados.includes(h.data + ' ' + h.hora);
  });

  res.json(livres);
});

app.post('/agendamentos', (req, res) => {
  const { nome, cpf, profissionalId, data, hora } = req.body;

  // 1. Confere se veio tudo
  if (!nome || !cpf || !profissionalId || !data || !hora) {
    return res.status(400).json({ erro: 'Todos os campos são obrigatórios' });
  }

  // 2. Valida o CPF
  if (!validarCPF(cpf)) {
    return res.status(400).json({ erro: 'CPF inválido' });
  }

  const arqAgend = path.join(__dirname, 'data', 'agendamentos.json');
  const agendamentos = JSON.parse(fs.readFileSync(arqAgend, 'utf-8'));

  const id = Number(profissionalId);

  // 3. Confere se o horário já está ocupado
  const jaOcupado = agendamentos.some(a =>
    a.profissionalId === id && a.data === data && a.hora === hora
  );
  if (jaOcupado) {
    return res.status(409).json({ erro: 'Este horário já está agendado' });
  }

  // 4. Cria e salva o agendamento
  const novo = {
    id: Date.now(),
    nome,
    cpf,
    profissionalId: id,
    data,
    hora
  };
  agendamentos.push(novo);
  fs.writeFileSync(arqAgend, JSON.stringify(agendamentos, null, 2));

  res.status(201).json(novo);
});

app.get('/agendamentos/:cpf', (req, res) => {
  const arqAgend = path.join(__dirname, 'data', 'agendamentos.json');
  const agendamentos = JSON.parse(fs.readFileSync(arqAgend, 'utf-8'));

  const cpf = req.params.cpf.replace(/[^\d]/g, '');
  const doCpf = agendamentos.filter(a => a.cpf.replace(/[^\d]/g, '') === cpf);

  res.json(doCpf);
});

app.delete('/agendamentos/:id', (req, res) => {
  const arqAgend = path.join(__dirname, 'data', 'agendamentos.json');
  const agendamentos = JSON.parse(fs.readFileSync(arqAgend, 'utf-8'));

  const id = Number(req.params.id);
  const existe = agendamentos.some(a => a.id === id);

  if (!existe) {
    return res.status(404).json({ erro: 'Agendamento não encontrado' });
  }

  const restantes = agendamentos.filter(a => a.id !== id);
  fs.writeFileSync(arqAgend, JSON.stringify(restantes, null, 2));

  res.json({ mensagem: 'Agendamento cancelado' });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});