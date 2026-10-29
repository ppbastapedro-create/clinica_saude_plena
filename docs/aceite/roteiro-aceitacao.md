# Saúde Plena — Roteiro de teste de aceitação

**Pacote 1.5.3 da EAP — Aceite da parceira.** Neste encontro, a psicóloga
Beatriz Xavier usa o sistema sozinha, seguindo as tarefas abaixo, e marca se
cada uma deu certo. O resultado embasa o **Termo de aceite**
(`termo-aceite-modelo.md`).

- **Duração prevista:** 60 a 75 minutos.
- **Quem conduz:** Pedro Paulo Basta (só observa e anota; não opera o sistema).
- **Dados usados:** **somente fictícios**. Nenhum paciente real entra neste teste.

---

## Antes do encontro (preparação — só o Pedro)

1. **Ambiente de homologação, não o de produção.** O sistema não apaga
   registros (guarda mínima de 5 anos, CFP); pacientes fictícios lançados em
   produção ficariam lá para sempre. O teste roda no notebook do Pedro (ou num
   ambiente de teste separado), com o banco recriado e o seed fictício:
   `npx prisma migrate reset` seguido de `npm run db:seed`.
2. **Conta de teste:** `beatriz@exemplo.test` / `trocar-esta-senha` (fictícia;
   a conta real dela é criada só na implantação, com senha digitada por ela).
3. **Lembrete (tarefa 11):** preencher o SMTP do Brevo no `.env` de
   homologação e `LEMBRETE_ANTECEDENCIA_HORAS=1`. Se o Brevo ainda não estiver
   configurado, a tarefa 11 fica para a implantação (1.6.1) e é marcada como
   "não testada" aqui.
4. **Celular (tarefa 13):** notebook e celular na mesma rede; abrir pelo IP do
   notebook (`http://<ip>:3000`).
5. Imprimir este roteiro (ou abrir num segundo monitor) e ter um cronômetro à
   mão (tarefas 3, 5 e 6 medem tempo).

**CPFs fictícios para usar** (válidos só pela conta dos dígitos):
`314.159.265-90` · `161.803.398-05` · `141.421.356-51`

---

## Tarefas

Em cada tarefa: faça os passos, compare com o **resultado esperado** e marque.
Se algo for confuso, mesmo que tenha dado certo, anote em **Observações** — isso
também conta.

### 1. Entrar e sair do sistema
*Escopo: autenticação com senha forte e sessão segura.*

1. Abra o endereço informado pelo Pedro. Digite o e-mail de teste e uma senha **errada**.
2. Agora digite a senha certa e entre.
3. Clique no ícone de sair (canto inferior esquerdo) e depois no botão "voltar" do navegador.

**Esperado:** com a senha errada, aparece "E-mail ou senha inválidos" (sem dizer qual dos dois errou). Com a certa, abre a **Agenda**. Depois de sair, "voltar" leva de novo ao login — nenhuma informação aparece.

Deu certo? ( ) Sim ( ) Não — Observações: ______________________________________

### 2. Cadastrar um paciente
*Escopo: cadastro de pacientes com validação de CPF.*

1. Menu **Pacientes** → **Novo paciente**.
2. Nome: *Paciente Teste Um*. CPF: digite `123.456.789-00` e clique em **Cadastrar paciente**.
3. Troque o CPF para `314.159.265-90`. Preencha um e-mail (pode ser o seu), o **Preço da sessão** (ex.: 150,00) e marque **"Enviar lembrete das sessões por e-mail"**. Cadastre.

4. Na ficha, no cartão **Consentimento LGPD**, clique em "Imprimir o termo em branco" e leia o modelo. Feche e clique em **Registrar aceite** (data de hoje), como se o paciente tivesse assinado.

**Esperado:** com o primeiro CPF, a mensagem "CPF inválido" aparece embaixo do campo e nada é salvo. Com o segundo, abre a ficha do paciente. O termo abre pronto para imprimir; depois do registro, o cartão mostra **Vigente** com a data.

Sobre o texto do termo: está claro para seus pacientes? Falta algo? ______________________

Deu certo? ( ) Sim ( ) Não — Observações: ______________________________________

### 3. Marcar uma sessão — ⏱ cronometrar
*Escopo: agenda em calendário (marcação). Objetivo da EAP: marcar em menos de 1 minuto.*

1. Menu **Agenda** → **Novo agendamento**.
2. Busque *Paciente Teste Um*, escolha **amanhã**, horário de início **10:00**, duração 50 min. Confira que o valor veio preenchido com o preço do paciente. Salve.

**Esperado:** a sessão aparece na agenda, no dia e horário certos.

Tempo: ______ s · Deu certo? ( ) Sim ( ) Não — Observações: ______________________

### 4. Tentar marcar em cima de outra sessão
*Escopo: prevenção de conflito de horário.*

1. Cadastre rapidamente outro paciente (*Paciente Teste Dois*, CPF `161.803.398-05`).
2. Tente marcar para ele **amanhã às 10:00** (o mesmo horário da tarefa 3).

**Esperado:** o sistema avisa o conflito, diz **com quem** é, e não deixa salvar.

Deu certo? ( ) Sim ( ) Não — Observações: ______________________________________

### 5. Remarcar — ⏱ cronometrar
*Escopo: remarcação. Objetivo da EAP: menos de 1 minuto.*

1. Na agenda, abra a sessão da tarefa 3 → **Remarcar** → mude para **11:00** → salve.

**Esperado:** a sessão passa para 11:00; o horário das 10:00 fica livre.

Tempo: ______ s · Deu certo? ( ) Sim ( ) Não — Observações: ______________________

### 6. Cancelar — ⏱ cronometrar
*Escopo: cancelamento. Objetivo da EAP: menos de 1 minuto.*

1. Marque uma sessão para *Paciente Teste Dois* depois de amanhã, 14:00.
2. Abra essa sessão → **Cancelar sessão** → confirme.

**Esperado:** a sessão some da agenda (volta a aparecer marcando **"Mostrar canceladas"**) e o horário fica livre. O cancelamento não pode ser desfeito.

Tempo: ______ s · Deu certo? ( ) Sim ( ) Não — Observações: ______________________

### 7. Lançar uma sessão passada e registrar falta
*Escopo: registro de falta; lançamento da agenda de papel.*

1. Marque para *Paciente Teste Dois* uma sessão **na semana passada** (o sistema avisa que será lançada como histórico).
2. Abra a sessão → **Registrar falta**.

**Esperado:** a sessão fica com o status **Falta**. Na cobrança, aparece que a falta **não é cobrada** automaticamente, com a opção "Cobrar esta sessão".

Deu certo? ( ) Sim ( ) Não — Observações: ______________________________________

### 8. Sessão realizada e registro de evolução
*Escopo: registro da evolução por sessão, com acesso restrito e criptografia.*

1. Lance para *Paciente Teste Um* uma sessão **de ontem** → abra → **Marcar como realizada**.
2. **Escrever registro** → escreva um texto de teste (não clínico) → **Salvar registro**.
3. Volte à agenda, abra a sessão de novo e **Abrir registro**.

**Esperado:** o registro é salvo e reaparece igual. (Por trás: o texto fica cifrado no banco e cada leitura fica anotada no log de acesso.)

Deu certo? ( ) Sim ( ) Não — Observações: ______________________________________

### 9. Pagamento de pacote e saldo do paciente
*Escopo: controle financeiro (valor por sessão, pagamento e forma de pagamento).*

1. Abra a ficha de *Paciente Teste Um* (menu **Pacientes**).
2. Em **Registrar recebimento**: Valor recebido 600,00 · Sessões que cobre 4 · Data hoje · Forma PIX → **Registrar recebimento**.
3. Confira o saldo da **Conta do paciente**.
4. Registre outro recebimento **errado** (ex.: 50,00) e depois clique em **Estornar** nele.

**Esperado:** o pacote vira **crédito**; a sessão realizada da tarefa 8 é descontada. O recebimento estornado continua no extrato, mas sai do saldo.

Deu certo? ( ) Sim ( ) Não — Observações: ______________________________________

### 10. Relatório do mês
*Escopo: relatório mensal de atendimentos, faltas e recebimentos.*

1. Menu **Financeiro**. Confira o mês atual; use as setas para ver o mês anterior e voltar.
2. Clique em **Imprimir** (pode cancelar a impressão).

**Esperado:** o mês mostra as sessões realizadas, as faltas e o total recebido (tarefa 9, sem o estornado); a lista de saldos mostra quem está com crédito ou a receber.

Deu certo? ( ) Sim ( ) Não — Observações: ______________________________________

### 11. Lembrete por e-mail
*Escopo: lembrete de sessão por e-mail ao paciente.* (Depende da preparação, item 3.)

1. Marque para *Paciente Teste Um* (que tem o seu e-mail, o lembrete ligado e o consentimento registrado na tarefa 2) uma sessão para daqui a ~40 minutos.
2. O Pedro dispara o envio. Confira sua caixa de entrada (e o spam).
3. Abra a sessão no sistema e veja o cartão **Lembrete por e-mail**.

**Esperado:** chega um e-mail "Lembrete: atendimento em …" com data e hora, **sem** as palavras psicologia/terapia nem o seu nome. O cartão mostra **Enviado**.

( ) Sim ( ) Não ( ) Não testada nesta rodada — Observações: ______________________

### 12. Encerrar o acompanhamento de um paciente
*Escopo: cadastro de pacientes; guarda dos dados (sem exclusão).*

1. Marque para *Paciente Teste Dois* uma sessão **na semana que vem**.
2. Na ficha dele, clique em **Arquivar**.
3. Cancele a sessão da semana que vem e tente **Arquivar** de novo. Depois, **Reativar**.

**Esperado:** na primeira tentativa, o sistema recusa e lista a sessão futura. Depois de cancelar, arquiva (o paciente sai da lista de ativos, o histórico fica). **Reativar** traz de volta.

Deu certo? ( ) Sim ( ) Não — Observações: ______________________________________

### 13. Usar pelo celular
*Escopo: sistema responsivo (sem aplicativo).*

1. No celular, entre no sistema e abra a agenda e a ficha de um paciente.

**Esperado:** as telas se ajustam à largura do celular, sem precisar de zoom.

Deu certo? ( ) Sim ( ) Não — Observações: ______________________________________

### 14. Paciente revoga o consentimento
*Escopo: termo de consentimento (LGPD) — a revogação é direito do paciente.*

1. Na ficha de *Paciente Teste Um*, cartão **Consentimento LGPD** → **Registrar revogação** → confirme.
2. Veja os **Dados cadastrais** (caixa do lembrete) e abra a sessão de amanhã (cartão **Lembrete por e-mail**).

**Esperado:** o cartão passa a **Sem consentimento**, o aceite anterior fica no **Histórico** com a data da revogação, e a caixa "Enviar lembrete" fica desmarcada. As sessões e o registro de evolução continuam lá (a guarda de 5 anos é obrigação profissional).

Deu certo? ( ) Sim ( ) Não — Observações: ______________________________________

---

## Regras que dependem da sua decisão

O sistema foi feito com o comportamento mais conservador nestes pontos, que
ainda não foram confirmados. Responda como funciona no seu dia a dia — o que
mudar vira ajuste antes da implantação.

| # | Pergunta | Como está hoje | Sua resposta |
|---|---|---|---|
| R1 | Falta é cobrada? | Não é cobrada por padrão; dá para marcar "Cobrar esta sessão" uma a uma | |
| R2 | Com quanta antecedência o lembrete deve chegar? | 24 horas antes | |
| R3 | Crédito de pacote pago e não usado no mês vence? | Não vence; fica como crédito do paciente | |
| R4 | Pacote tem desconto (preço por sessão menor)? | Não há desconto automático; você digita o valor recebido | |
| R5 | "Recebido no mês" deve contar pela data em que o dinheiro entrou? | Sim (como no seu caderno) | |
| R6 | Sessões semanais fixas precisam ser marcadas de uma vez (repetição)? | Não existe; cada sessão é marcada separadamente | |
| R7 | Alguma sessão pode passar de 4 horas? | Não — acima disso o sistema recusa (trava contra erro de digitação) | |

## Pendências conhecidas (fora desta rodada)

- **Lista de prestadores no termo:** o item 3 do termo de consentimento cita
  prestadores de tecnologia de forma genérica; os nomes e países entram na
  implantação (1.6.1), quando estiverem definidos.
- **Manual do usuário e treinamento:** pacote 1.6.2, depois deste aceite.

## Avaliação

**De 1 a 5, quanto o sistema atende à sua rotina?** (1 = nada, 5 = totalmente)

( ) 1 ( ) 2 ( ) 3 ( ) 4 ( ) 5

O que mais ajudou: ______________________________________________________________

O que mais atrapalhou ou faltou: _________________________________________________

---

### Resumo (preenchido pelo Pedro ao final)

| Tarefas | Sim | Não | Não testadas |
|---|---|---|---|
| 1 a 14 | | | |

Tempo médio — marcar: ____ s · remarcar: ____ s · cancelar: ____ s (meta: < 60 s)

Ajustes pedidos (viram tarefas antes da implantação):

1. ____________________________________________________________________________
2. ____________________________________________________________________________
3. ____________________________________________________________________________
