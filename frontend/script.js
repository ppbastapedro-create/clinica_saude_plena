const API_URL = 'http://localhost:3000';

async function carregarEspecialidades() {
  const resposta = await fetch(`${API_URL}/especialidades`);
  const especialidades = await resposta.json();

  const select = document.getElementById('especialidade');

  especialidades.forEach(esp => {
    const opcao = document.createElement('option');
    opcao.value = esp.id;
    opcao.textContent = esp.nome;
    select.appendChild(opcao);
  });
}

carregarEspecialidades();

const selectEspecialidade = document.getElementById('especialidade');
const selectProfissional = document.getElementById('profissional');

selectEspecialidade.addEventListener('change', async () => {
  const especialidadeId = selectEspecialidade.value;

  selectProfissional.innerHTML = '';

  if (!especialidadeId) {
    selectProfissional.disabled = true;
    selectProfissional.innerHTML = '<option value="">Selecione uma especialidade primeiro</option>';
    return;
  }

  const resposta = await fetch(`${API_URL}/profissionais?especialidade=${especialidadeId}`);
  const profissionais = await resposta.json();

  const opcaoPadrao = document.createElement('option');
  opcaoPadrao.value = '';
  opcaoPadrao.textContent = 'Selecione...';
  selectProfissional.appendChild(opcaoPadrao);

  profissionais.forEach(prof => {
    const opcao = document.createElement('option');
    opcao.value = prof.id;
    opcao.textContent = prof.nome;
    selectProfissional.appendChild(opcao);
  });

  selectProfissional.disabled = false;
});

const selectHorario = document.getElementById('horario');

selectProfissional.addEventListener('change', async () => {
  const profissionalId = selectProfissional.value;

  selectHorario.innerHTML = '';

  if (!profissionalId) {
    selectHorario.disabled = true;
    selectHorario.innerHTML = '<option value="">Selecione um profissional primeiro</option>';
    return;
  }

  const resposta = await fetch(`${API_URL}/horarios/${profissionalId}`);
  const horarios = await resposta.json();

  const opcaoPadrao = document.createElement('option');
  opcaoPadrao.value = '';
  opcaoPadrao.textContent = horarios.length ? 'Selecione...' : 'Nenhum horário disponível';
  selectHorario.appendChild(opcaoPadrao);

  horarios.forEach(h => {
    const opcao = document.createElement('option');
    opcao.value = JSON.stringify(h);
    opcao.textContent = `${h.data} às ${h.hora}`;
    selectHorario.appendChild(opcao);
  });

  selectHorario.disabled = horarios.length === 0;
});

const inputCpf = document.getElementById('cpf');

inputCpf.addEventListener('input', () => {
  inputCpf.value = inputCpf.value.replace(/\D/g, '').slice(0, 11);
});

const btnAgendar = document.getElementById('btnAgendar');
const mensagem = document.getElementById('mensagem');

btnAgendar.addEventListener('click', async () => {
  const nome = document.getElementById('nome').value.trim();
  const cpf = document.getElementById('cpf').value.trim();
  const profissionalId = selectProfissional.value;
  const horarioValor = selectHorario.value;

  mensagem.textContent = '';

  if (!nome || !cpf || !profissionalId || !horarioValor) {
    mensagem.textContent = 'Preencha todos os campos antes de confirmar.';
    mensagem.style.color = 'red';
    return;
  }

  const horario = JSON.parse(horarioValor);

  const resposta = await fetch(`${API_URL}/agendamentos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome,
      cpf,
      profissionalId: Number(profissionalId),
      data: horario.data,
      hora: horario.hora
    })
  });

  const dados = await resposta.json();

  if (resposta.ok) {
    mensagem.textContent = `Agendamento confirmado para ${horario.data} às ${horario.hora}!`;
    mensagem.style.color = 'green';

    document.getElementById('nome').value = '';
    document.getElementById('cpf').value = '';
    selectProfissional.dispatchEvent(new Event('change'));
  } else {
    mensagem.textContent = dados.erro || 'Erro ao agendar.';
    mensagem.style.color = 'red';
  }
});

const inputCpfConsulta = document.getElementById('cpfConsulta');

inputCpfConsulta.addEventListener('input', () => {
  inputCpfConsulta.value = inputCpfConsulta.value.replace(/\D/g, '').slice(0, 11);
});

const btnBuscar = document.getElementById('btnBuscar');
const mensagemConsulta = document.getElementById('mensagemConsulta');
const listaAgendamentos = document.getElementById('listaAgendamentos');

btnBuscar.addEventListener('click', async () => {
  const cpf = inputCpfConsulta.value.trim();

  mensagemConsulta.textContent = '';
  listaAgendamentos.innerHTML = '';

  if (!cpf) {
    mensagemConsulta.textContent = 'Digite um CPF para buscar.';
    mensagemConsulta.style.color = 'red';
    return;
  }

  const resposta = await fetch(`${API_URL}/agendamentos/${cpf}`);
  const agendamentos = await resposta.json();

  if (agendamentos.length === 0) {
    mensagemConsulta.textContent = 'Nenhum agendamento encontrado para este CPF.';
    mensagemConsulta.style.color = 'red';
    return;
  }

  const respostaProf = await fetch(`${API_URL}/profissionais`);
  const profissionais = await respostaProf.json();

  agendamentos.forEach(a => {
    const profissional = profissionais.find(p => p.id === a.profissionalId);
    const nomeProfissional = profissional ? profissional.nome : `Profissional #${a.profissionalId}`;

    const item = document.createElement('li');
    item.textContent = `${nomeProfissional} — ${a.data} às ${a.hora} `;

    const btnCancelar = document.createElement('button');
    btnCancelar.textContent = 'Cancelar';
    btnCancelar.addEventListener('click', async () => {
      const resposta = await fetch(`${API_URL}/agendamentos/${a.id}`, { method: 'DELETE' });

      if (resposta.ok) {
        item.remove();
      } else {
        const dados = await resposta.json();
        mensagemConsulta.textContent = dados.erro || 'Erro ao cancelar.';
        mensagemConsulta.style.color = 'red';
      }
    });

    item.appendChild(btnCancelar);
    listaAgendamentos.appendChild(item);
  });
});