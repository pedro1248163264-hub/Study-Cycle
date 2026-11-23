# Changelog

## [v30.1] — Correção: prévia do gabarito não escapa mais do retângulo

### Corrigido
- Em “Refazer lista” > “Editar gabarito”, a prévia formatada podia aparecer fora do campo da resposta. Agora o HTML do KaTeX só é injetado quando o CSS **e** o JS da biblioteca carregaram: se o CSS falhar, o texto simples continua visível, sem MathML/spans soltos voando pela tela.
- Contenção adicional nas células do gabarito, na busca “Ver” e no gabarito de questões (`min-width: 0`, rolagem horizontal dentro do próprio retângulo), para fórmulas longas nunca vazarem para os lados.
- A prévia em tempo real também aparece em campos que estavam vazios (antes só surgia depois de salvar).

### Arquivos
`js/math.js`, `js/modals.js`, `css/styles.css`.

---
## [v30] — Gabarito com LaTeX/MathJax

### Adicionado
- Respostas do gabarito podem ser escritas com notação matemática: `$...$`, `$$...$$`, `\(...\)`, `\[...\]` ou comandos soltos como `\frac` / `\sqrt`. Na hora de refazer a lista (busca “Ver” e prévia no “Editar gabarito”) e ao refazer questões, o trecho marcado é renderizado com KaTeX. Sem marcação, a resposta continua aparecendo como texto normal.
- Prévia em tempo real no “Editar gabarito”: a fórmula aparece logo abaixo do campo enquanto você digita.

### Alterado
- Campos de resposta aceitam textos maiores (até 500 caracteres, antes 200). O cadastro rápido e o campo de gabarito não confundem mais o `;` de comandos LaTeX como `\;` com o separador de respostas.
- KaTeX é carregado sob demanda e pré-cacheado pelo Service Worker (CSS, JS e fontes), então a formatação funciona offline depois da primeira visita. Sem a biblioteca disponível, o texto simples continua visível.

### Arquivos
`index.html`, `js/math.js`, `js/logic.js`, `js/modals.js`, `sw.js`, `css/styles.css`, `README.md`.

---
## [v29] — Tema escuro por padrão

### Alterado
- O app abre em modo escuro na primeira vez (e para quem nunca escolheu um tema). Quem já tinha optado pelo claro continua no claro: a preferência salva em `isDark` e no espelho `sc-dark` do `localStorage` é respeitada. O botão do sol/lua no cabeçalho continua alternando normalmente.

### Arquivos
`index.html`, `js/store.js`.

---
## [v28] — Gabarito no cadastro rápido de exercícios

### Adicionado
- Em Adicionar/Editar lista, o campo de cadastro rápido aceita o gabarito junto: `1a: 3; 2c: 14` cria as linhas com a resposta já preenchida. O que vem depois dos dois pontos é a resposta (até o `;`); `6;` ou `6: ;` cadastra o exercício sem gabarito. Intervalos (`1-5`, `9a-c`) continuam funcionando, e repetir uma chave com resposta atualiza o gabarito da linha existente.

### Arquivos
`js/logic.js`, `js/modals.js`.

---
## [v27] — Lista sem "quantos exercícios"

### Alterado
- Removido o campo "Quantos exercícios a lista tem". Em Adicionar/Editar lista, o campo "Exercícios" tem uma linha por exercício (nº, resposta do gabarito, "Revisar"); uma linha nova aparece sozinha ao digitar, e "vários: 1-5; 7; 9a-c" cria várias de uma vez. Ordem livre, números podem ser pulados.
- "Quais revisar" e o texto de gabarito foram substituídos por essas linhas. Dados novos: `list.keys` (exercícios cadastrados) e `list.answers`. Listas antigas (`total`/`reviewPick`) continuam funcionando e são convertidas ao salvar em Editar.
- Refazer lista: removido "Fiz até o exercício" (dependia de ordem); ficou o botão "Salvar e continuar depois". Exercícios cadastrados depois entram como pendentes na lista.
- Lista sem exercícios não vence nem aparece na fila.

### Arquivos
`js/logic.js`, `js/modals.js`, `js/screens.js`, `js/store.js`, `css/styles.css`, `README.md`.

---
## [v26] — Consulta de gabarito por exercício

### Alterado
- Em "Refazer lista" > Gabarito, o gabarito não abre mais inteiro. Digite o exercício (ex.: `7`, `23a`, `3, 8, 12b`) e toque em "Ver" (ou Enter) para revelar só a resposta dele; sem gabarito cadastrado aparece um aviso de erro (✕). Número sozinho mostra também as letras (3a, 3b…).
- A edição do gabarito (grade completa) fica em "Editar gabarito", recolhida por padrão.

### Arquivos
`js/modals.js`, `css/styles.css`.

---

## [v25] — Fila de revisão e reinício protegidos

### Corrigido
- A fila "Começar revisões" agora identifica itens por coleção + ID. Uma lista e uma questão com o mesmo ID não fazem uma delas ser pulada.
- "Reiniciar ciclo" pede confirmação antes de zerar as horas concluídas de todas as matérias.

### Arquivos
`js/ui.js`, `js/main.js`.

---


## [v24] — Agendamento individual sem efeito do atraso

### Corrigido
- A migração de listas legadas não copia mais `list.n` (quantas vezes a lista foi revisada) para cada exercício. Cada item começa com apenas o resultado individual mais recente que o histórico permite recuperar; resultados por questão passam a ser mantidos em `items[chave].history`.
- A data em que uma revisão foi feita não muda o próximo intervalo. Acerto tranquilo começa em 5 dias (espalhado entre 4–6), difícil em 2 dias e erro em 1 dia; acertos posteriores ampliam o intervalo individual.
- A lista ainda pode aparecer como pendente amanhã quando algum exercício foi errado, mas os exercícios acertados não são puxados para amanhã.

### Revisão geral da lógica
- O ciclo, a fila, os limites diários, os gabaritos e a graduação de questões foram inspecionados. A fila por questão permanece separada da revisão por exercício de listas; o ajuste foi concentrado no agendamento e na migração individual, onde dados agregados podiam ser confundidos com histórico individual.

### Arquivos
`js/logic.js`, `js/modals.js`, `js/store.js`, `README.md`.

Este arquivo existe para que qualquer pessoa (ou qualquer IA, em outro chat) consiga entender rapidamente o que foi feito e por quê, sem precisar reler o `app.js` inteiro. Sempre que alterar o app — aqui ou por fora — vale a pena adicionar uma entrada nova no topo.

## [v23] — Error Log aposentado + menos toques no dia a dia

### Removido
- Tela, modal e filtros do **Error Log** e o bloco "Causas dos erros" dos Simulados. `errorLogs` continua em `SYNCED` (legado, sem tela) para não apagar dados já salvos, como `topicReviews`.

### Adicionado
- **Começar revisões** (`start-queue`): `SC.reviewQueue` (`logic.js`) devolve a fila de hoje misturada por matéria; os modais abertos por ela carregam `queue: true` e `commit` abre o próximo ao concluir (
extInQueue`, `ui.js`). Fechar o modal encerra a rodada.

### Arquivos
`js/screens.js`, `js/modals.js`, `js/store.js`, `js/logic.js`, `js/ui.js`, `js/main.js`, `css/styles.css`, `README.md`.

---

## [v22.2] — Limite diário por lista, espalhamento e teto de 6 meses

### Adicionado
- **Limite diário por lista** (`list.dailyLimit`, campo "Limite por dia" em Editar lista; vazio = 10). Conta o que já foi revisado hoje naquela lista; o excedente fica para os dias seguintes, errados primeiro. Atingido o limite, a lista sai da fila de hoje (`listNextAt` devolve amanhã) e o modal avisa, com botão "Fazer também os N que sobraram" para quem quiser passar do limite. Na 1ª vez a lista toda continua sendo feita. `listDue` agora devolve `limit`, `doneToday` e `quota`.
- **Espalhamento** (`spreadDays`, usado em `applyListSession`): para intervalos de 4 dias ou mais, o app escolhe, dentro de ±15% do intervalo (5 dias => 4 a 6), o dia com menos exercícios da lista já agendados. Erro (1 dia) e difícil (3 dias) não mudam.

### Mudou
- **Teto de intervalo: 365 → 180 dias** (`MAX_INTERVAL_DAYS`), vale para exercícios e questões.
- Teste simulado de 90 dias (lista de 26, tudo tranquilo): no máximo 7 exercícios num dia, contra 26 empilhados antes.

### Arquivos
`js/logic.js`, `js/modals.js` (`exerciseList`, `listRedo`), `js/screens.js` (`listCard`), `README.md`.

---

## [v22.1] — Listas antigas: fim do "refazer tudo" e do "daqui a 2 anos"

### Corrigido
- **Migração de listas antigas** (`listItems`, `logic.js`): os exercícios que não estavam errados herdavam o vencimento e o intervalo da *lista inteira*, sem teto. Resultado: datas como "daqui a 2 anos" e a lista toda vencendo junto. Agora esses exercícios voltam no máximo **30 dias** depois da última revisão (`LEGACY_MAX_DAYS`); os errados continuam voltando em 1 dia.
- **Lista antiga sem `lastReviewedAt`** caía como "nunca revisada" (Primeira vez: a lista toda). Agora usa a data do último item do `history`.
- **Teto também nos itens já salvos** (`clampItems`): intervalo acima de `MAX_INTERVAL_DAYS` ou vencimento além do teto é trazido de volta ao teto ao ler.

### Arquivos
`js/logic.js`.

---

## [v22] — Gabarito por exercício, "acertei com dificuldade" e correção do "Atrasada 11d"

### Corrigido
- **"Atrasada 11d" logo depois de terminar a lista.** O vencimento da lista era o menor 
extReviewAt` entre *todos* os `items`, inclusive exercícios fora de "Quais revisar" ou que ficaram de fora da sessão de 10, com vencimento antigo. Ao abrir, a lista (que só olha o escopo) dizia que nada estava atrasado, mas o cartão mostrava o atraso. Agora `listNextAt(list)` (`logic.js`) calcula o vencimento só a partir dos exercícios que contam (escopo), ou "hoje" se sobrou exercício nunca feito; o cartão, a fila "Hoje", a ordenação e `pendingReviews` usam essa função, e listas antigas se corrigem sozinhas ao abrir.

### Adicionado
- **Gabarito por exercício** (`list.answers = { "1": "C", "3a": "12" }`). Preenche em "Editar lista" (`1: C; 2: 42; 3a: Falso`) ou direto na tela "Refazer lista", no bloco **Gabarito** (um campo por exercício, salva na hora sem fechar, + campo rápido para itens com letra).
- **Atrelado a "Quais revisar"**: exercício fora do escopo não mostra (nem conta) o gabarito; ele continua guardado e volta se o exercício voltar ao escopo. Apagar um gabarito nunca tira o exercício da revisão. Funções: `visibleAnswers`, `parseAnswers`, `serializeAnswers`, `answerVisible`.
- **"Acertou, mas com dificuldade?"**: campo com o mesmo formato de "Errou algum?" (`5; 9a; 12: b-c`). Tocar num exercício agora alterna: errou (vermelho) → com dificuldade (laranja) → tranquilo. Substitui o antigo botão geral "Nas que acertou, teve dificuldade?". `applyListSession` recebe `hardKeys[]`; `progress` guarda `hardKeys`.

### Mudou — agendamento (`sm2Step`, vale para exercícios e questões)
- Errou → **1 dia**. Acertou com dificuldade → **3 dias**. Acertou tranquilo → **5 dias** (na 1ª vez, ou depois de um erro).
- Depois, o intervalo **cresce**: tranquilo ≈ ×2,1 (5, 11, 24, 54, 124…); com dificuldade ≈ ×1,25 (3, 4, 5, 6…), mínimo +1 dia. `EF` (1,3–2,8) sobe com acertos tranquilos e cai com dificuldade/erro, então o que é difícil *para você* espaça menos. Teto 365 dias.
- A adaptação automática estilo FSRS (ajustar os intervalos pelo histórico) **não** foi implementada; o histórico já guarda o necessário (`history[]` e `items[k].lapses`).

### Arquivos
`js/logic.js`, `js/modals.js` (`exerciseList`, `listRedo`), `js/screens.js`, `css/styles.css`, `js/store.js` (comentário do modelo). Nenhum arquivo novo.

---

## [v21.3] — Marcar erro não exige "Fiz até"

- Removido o bloqueio "está depois de onde você parou". Marcar um exercício como errado (digitando ou tocando no chip) conta como feito até ele: se "Fiz até o exercício" estiver preenchido com número menor, ele sobe sozinho; vazio continua = lista toda.
- Com progresso salvo, os exercícios depois de "Fiz até" agora aparecem em "Fazer agora" esmaecidos (antes sumiam), e tocar neles marca e atualiza o "Fiz até".
- Arquivos: `js/modals.js` (`listRedo`), `css/styles.css`.

---

## [v21.2] — Refazer lista: ordem numérica, PDF dentro do modal e marcar por toque

- **"Fazer agora" em ordem**: os exercícios aparecem em ordem numérica e, no mesmo número, alfabética (`1a, 2c, 7, 9, 11b, 11c, 12f, 26e`). A escolha de *quais* entram na sessão continua por prioridade (errados primeiro); só a exibição é ordenada (`listDue` em `logic.js`).
- **Marcar por toque**: cada exercício de "Fazer agora" virou botão; tocar marca como errado (vermelho forte), tocar de novo desmarca. Sincroniza com o campo "Errou algum?" e com os chips de erradas. Na 1ª vez, os exercícios também aparecem como botões.
- **PDF dentro do modal**: se a lista tem PDF, "Refazer lista" mostra o PDF ao lado dos controles (telas largas, ≥ 60rem, painel fixo) ou numa seção recolhível (celular; só baixa quando aberta). O botão "Ver PDF da lista" saiu do modal de refazer; "Ver PDF" no cartão continua.
- Arquivos: `js/logic.js`, `js/modals.js` (`mountListPdf` extraída de `listPdf`, `listRedo`), `js/ui.js` (`wide: 'xl'`), `css/styles.css`.

---

## [v21.1] — "Quais revisar" delimita a revisão

- Se a lista tem "Quais revisar" (ex.: `1: a; 2: c; 3; 11: b, c`), **só esses exercícios** entram na revisão; o resto da lista é ignorado. Número sozinho = exercício inteiro; com letras = só aqueles itens. Vazio, ou texto livre com palavras (ex.: "26 toda"), = lista toda.
- Na 1ª vez faz todos os itens do escopo (sem limite de 10). Marcar erro aceita só itens do escopo; digitar `24` marca todos os itens de 24 do escopo (ex.: `24c`).
- Listas já revisadas migram respeitando o escopo (errada "24" vira `24c`).
- Campo "Quais revisar" ganhou exemplo curto; sai de "Anotações" no modal e aparece no cabeçalho ("30 em Quais revisar").
- Arquivos: `js/logic.js` (`listScope`, `listDue`, `listItems`), `js/modals.js`.

---

## [v21] — Listas: revisão por exercício (retenção ativa)

### Mudou
- **Cada exercício tem o próprio SM-2** (`list.items["7"]`, `["23a"]`). Errou → volta em 1 dia; acertou → 3 dias (ou 1, se teve dificuldade), depois 6, depois ×EF. A lista só "vence" quando algum exercício vence (`list.nextReviewAt` = o menor).
- **Sessão enxuta**: o modal mostra só o que venceu, **errados primeiro** (em vermelho), máx. 10 por vez (`SESSION_MAX`); botão "+ N que também venceram" mostra o resto.
- **Sem nota geral** (Foi mal / Mais ou menos / Foi bem) e **sem "Quantos você acertou?"**: tudo que não for marcado como errado conta como certo. Única pergunta restante: "Nas que acertou, teve dificuldade?" (Não / Sim).
- **Erros aceitam número e letra**: `3, 7`, `23a`, `23: a-b`, `5-8`, `22: e-g`. Cada item vira um exercício próprio; o resto do 23 aparece como "23 (restante)".
- **Modal reorganizado**: cabeçalho → Fazer agora → Errou algum? → Dificuldade → Concluir. "Fiz até o exercício / Salvar e continuar depois", "Anotações" (Revisar/observações) e PDF ficam recolhidos.
- **Listas antigas migram sozinhas** na 1ª abertura (`listItems`): os `wrong[]` da última revisão voltam amanhã; os outros mantêm o agendamento que a lista já tinha.
- Cartão da lista mostra "N exercícios para refazer" e a última vez como "21/26 certas · erradas: …".

### Dados
`exerciseLists[].items` (novo, sincroniza junto) e `history[].hard`. `history[].wrong` agora guarda chaves em texto ("23a").

### Arquivos
`js/logic.js` (`parseExerciseKeys`, `listItems`, `listDue`, `applyListSession`; `applyListRedo` removida), `js/modals.js` (`listRedo`), `js/main.js` (`grade` só para questões), `js/screens.js` (`listCard`, `scoreText`), `css/styles.css`. Nenhum arquivo novo.

---

## [v20] — Pausar matéria

### Adicionado
- Cada cartão em **Suas matérias** ganhou um botão **Pausar** (ao lado do lápis). A matéria pausada continua no cartão, esmaecida e com o selo **Pausada**, e um botão **Retomar matéria** aparece no rodapé dela.
- Matéria pausada **sai do ciclo**: não recebe horas semanais (as horas se redistribuem entre as ativas), não aparece na sequência sugerida nem em "Registrar tempo", e não conta no progresso do ciclo.
- Nada é apagado: horas já feitas, notas (dificuldade/conteúdo/importância), logs, listas e questões continuam como estavam. Ao retomar, ela volta ao ciclo normalmente.
- Se todas as matérias estiverem pausadas, a sequência avisa isso em vez de "Tudo em dia!".
- Configurações do ciclo: a checagem de "mínimo de horas por matéria" conta só as matérias ativas.
- Dado novo: `subject.paused` (booleano, ausente = ativa). Sincroniza junto com `subjects`.

### Arquivos
`js/logic.js` (`getDerived`), `js/screens.js` (`subjectCards`, `sequenceCard`), `js/main.js` (ação `toggle-pause`), `js/modals.js` (validação), `js/icons.js` (`pause`), `js/store.js` (comentário), `css/styles.css`. Nenhum arquivo novo.

---

## [v19] — Listas: campo "Quais revisar"

### Adicionado
- No cadastro/edição da lista, campo opcional de texto livre **"Quais revisar"** (`list.reviewPick`), para anotar só o que vale refazer: `26 toda`, `1: a,c,d`, vários separados por `;` ou quebra de linha.
- Aparece no cartão da lista (linha **Revisar: …**) e no modal **Refazer lista**.
- Não afeta SM-2, placar nem progresso. Sincroniza como qualquer campo da lista (a chave `exerciseLists` já está em `SYNCED`).

### Arquivos
`js/modals.js` (`exerciseList`, `listRedo`), `js/screens.js` (`listCard`), `css/styles.css` (`.list-pick`), `js/store.js` (comentário). Nenhum arquivo novo.

---

## [v18] — Refazer lista: acertos e exercícios errados

### Adicionado
- No modal **Refazer lista**, bloco opcional de placar: **"Quantos você acertou?"** (0 até o total da lista) e **"Errou algum?"** — digite o nº do exercício (1 até o total) e toque em **Errei**; ele vira uma etiqueta vermelha (toque para remover). Enter também adiciona.
- Se você só marcar erradas, os acertos são preenchidos sozinhos (total − erradas). Se digitar os acertos à mão, o valor é limitado a total − erradas.
- O placar é salvo no histórico da revisão (`history[].correct`, `.total`, `.wrong[]`) e aparece no cartão da lista: *"última vez: foi bem (28 out) · 27/30 acertos · erradas: 3, 7, 12"* e no próprio modal na vez seguinte.
- Totalmente opcional: sem preencher nada, tudo funciona como antes. **Não altera a nota SM-2** — quem decide o agendamento continua sendo o botão Foi mal / Mais ou menos / Foi bem.

- **Fiz até o exercício X** (opcional): vazio = lista toda. Preenchido, o placar passa a valer só até ali (acertos ≤ X − erradas; erradas só de 1 a X) e o histórico guarda `upTo`.
- **Salvar e continuar depois**: grava `list.progress = { upTo, wrong[], correct, at }` **sem avaliar nem reagendar** — a lista continua pendente, o cartão mostra *"parou no ex. 12"*, o botão vira **Continuar** e o modal reabre já com o ponto e as erradas. Dar a nota (Foi mal / Mais ou menos / Foi bem) limpa o progresso.

### Arquivos
`js/modals.js` (`listRedo`, `SC.readListScore`), `js/logic.js` (`applyListRedo`), `js/main.js` (`grade`), `js/screens.js` (`scoreText`), `css/styles.css`. Nenhum arquivo novo (sw.js sem mudança).

---

## [v17] — Revisões pendentes no modal "Próxima matéria"

### Adicionado
- Ao tocar em "Próxima matéria", além de onde você parou em cada material, o modal mostra o que está **pendente de revisão naquela matéria**, separado por tipo: *"Você tem X questões pendentes para revisar"* e *"Você tem Y listas para revisar"* (singular/plural tratados; cada linha só aparece se houver pendência).
- Botão **Revisar** em cada linha: fecha o modal e abre a aba Revisão (Questões ou Listas) já filtrada pela matéria.
- Mesmo com a matéria sem nenhum material ativo, as pendências de revisão aparecem abaixo do aviso "Nenhum material ativo".

### Regra de "pendente"
Igual à da aba Revisão > Hoje: 
extReviewAt <= agora`. Questões graduadas (`retired`) não contam; listas nunca se aposentam. Itens sem matéria não entram em nenhuma contagem (o modal é por matéria).

### Arquivos
`js/logic.js` (`pendingReviews`), `js/screens.js` (`pendingReviewCards`), `js/modals.js` (
extMaterial`), `js/main.js` (ação `go-review`).

---

## [v16] — PDF das listas na nuvem (Supabase Storage)

### Adicionado
- **PDF sincronizado entre aparelhos**: ao anexar/trocar o PDF de uma lista, ele é enviado ao bucket privado `list-pdfs`. "Ver PDF" baixa da nuvem só para a tela (blob em memória, `cache: no-store`, descartado ao fechar o modal) — **nenhuma cópia fica no aparelho**; tem *Abrir em outra aba* e *Baixar*. Exige internet.
- `list.pdf` agora é `{ name, size, path? }`; `path` é o nome do objeto no bucket e viaja com a lista pelo sync normal.
- **Anexar** envia direto à nuvem (sem internet/senha, não salva e mostra o erro). PDFs de versões anteriores que ficaram só no aparelho sobem no próximo sync e a cópia local é apagada (`SC.cloud.uploadPending`, no fim de `performSync`; se algo subiu, sincroniza de novo uma vez para publicar o `path`).
- Excluir a lista (ou remover/trocar o PDF) apaga também o arquivo da nuvem (melhor esforço; offline deixa um arquivo órfão).

### Segurança (mesmo modelo do `app_state`)
Bucket privado; a anon key sozinha não lê/lista/grava. `pdf_grant(senha, caminho, operação)` confere a senha (via `get_app_state`) e libera **um arquivo, uma operação, 10 min**; as políticas de `storage.objects` só aceitam com liberação válida. Tudo em `supabase/pdf-storage.sql` (rodar uma vez).

### Arquivos
`supabase/pdf-storage.sql` (novo), `js/sync.js` (`SC.cloud`), `js/modals.js` (`exerciseList`, `listPdf`), `js/main.js` (`remove`).

---

## [v15] — Revisão: listas de exercícios em ciclo; fim da revisão de tópicos

### Adicionado
- **Listas de exercícios** na aba Revisão: nome, matéria (opcional) e **quantidade de exercícios**. A lista entra na fila de hoje; ao refazer, o app pergunta *como foi* (Foi mal / Mais ou menos / Foi bem = SM-2 nota 1/3/5) e agenda a próxima. **Nunca se aposenta** (diferente das questões, que graduam após 4 acertos seguidos).
- Abas da Revisão agora: **Hoje** (listas + questões vencidas, misturadas por matéria), **Listas**, **Questões**.

- **PDF da lista**: anexar no cadastro/edição (máx. 25 MB), "Ver PDF" no cartão e dentro da avaliação (visualizador embutido + abrir em outra aba + baixar). Guardado em armário separado do IndexedDB (`files`, DB v2) e **fora da sincronização**: o estado inteiro vai como um JSON só para a nuvem, então PDF ali dentro seria reenviado a cada sync. Só `pdf: { name, size }` viaja com a lista; em outro aparelho aparece o aviso "PDF não está neste aparelho". Excluir a lista apaga o PDF.

### Removido
- Revisão de **tópicos**: aba Tópicos, modal "Registrar teste", escada de domínio (níveis, teste frio, 3 aprovações), sorteio semanal, `applyTopicRound/topicStatus/drawLocked/efLabel`.
- Os dados antigos (`topicReviews`) continuam em `SYNCED` só para não serem apagados ao salvar/sincronizar; não têm tela.

### Alterado
- Ação `grade` agora aceita `data-col` (`questionBank` por padrão, ou `exerciseLists`).

### Arquivos
`js/store.js` (`exerciseLists`, `SC.files`), `js/logic.js` (`applyListRedo`), `js/screens.js`, `js/modals.js` (`exerciseList`, `listRedo`, `listPdf`), `js/ui.js` (modal largo), `js/main.js`, `css/styles.css`.

---

## [v14] — Escada de domínio, Simulados e causas de erro (preparação ITA)

### Alterado
- **Tópicos (Revisão)**: o SM-2 saiu e entrou a escada de domínio. Só conta um *teste frio* (sem consulta, no tempo, questões inéditas) com acerto >= 80%. 3 aprovações espaçadas (hoje, +14d, +60d) = **travado**. Reprovou: volta a 0/3 e refaz em 3 dias. Teste não frio é só registrado.
- **Nível por tópico (1 base, 2 vestibular difícil, 3 ITA)**: "Aprofundar" reinicia a escada no nível seguinte (embasar e depois aprofundar). Dados antigos continuam abrindo (nível 1, 0/3).
- **Tipos de erro**: lista nova (lacuna de teoria / sabia mas não viu o caminho / desatenção e conta / estourou o tempo / esqueci o conceito / outro). "Cálculo" e "Interpretação errada" ficam só nos dados antigos.

### Adicionado
- **Sorteio semanal**: na aba Hoje, sorteia 5 tópicos travados, misturando matérias; reprovar um travado o devolve a instável.
- **Tela Simulados**: acerto por matéria, variação contra o simulado anterior, tempo e contagem de causas de erro.

### Removido
- Dificuldade sentida (1–5) e EF/intervalos crescentes nos tópicos. O SM-2 continua só nas questões salvas.
- Cópias mortas na raiz e `js/app.js`, que o v13 já dizia ter removido.

### Arquivos
`js/logic.js`, `js/store.js` (`mockExams`), `js/screens.js`, `js/modals.js`, `js/main.js` (`draw`).

---

## [v13] — Reorganização geral (sem mudar o que o app faz)

### Contexto
Pedido: deixar o site o mais eficiente possível, organizado, sem coisas inúteis e generalizando tarefas repetidas, para dar menos trabalho em qualquer área. **Dados existentes (IndexedDB e nuvem) continuam compatíveis**; o cálculo do ciclo e do SM-2 é o mesmo (conferido contra a v12 com os mesmos dados).

### Removido (era peso morto)
- **Cópias duplicadas na raiz** (`app.js`, `styles.css`, `icons.js`, `favicon.svg`, `icon-192.png`, `icon-512.png`): eram idênticas às de `js/`, `css/` e `icons/` e confundiam qual editar.
- **Número de versão do Service Worker** (`CACHE_VERSION`) e o aviso "Nova versão disponível": agora o app usa "rede primeiro" — com internet sempre carrega a versão mais nova, sem precisar trocar nada a cada publicação.
- Esqueleto HTML estático das telas e vários `display:none` manuais: as telas são desenhadas por JS num único `<main id="screen">`.

### Reorganizado
`js/app.js` (2880 linhas) foi dividido por função:
`store.js` (estado + IndexedDB + coleções), `logic.js` (ciclo e SM-2, puro), `sync.js` (Supabase), `ocr.js` (imagem/OCR), `ui.js` (peças reutilizáveis), `screens.js` (4 telas), `modals.js` (todos os modais), `main.js` (ações/eventos/início). Carregados por `<script>` comum (sem build; continua abrindo direto do arquivo).

### Generalizado (um lugar só em vez de vários)
- **Dados sincronizados**: lista única `SYNCED` em `store.js` — salvar, carregar e sincronizar usam a mesma (antes eram 3 blocos copiados). Dado novo = 1 linha.
- **Coleções**: `col.put / patch / remove / find` para as 5 listas (antes: `map/filter/concat` espalhados).
- **Ações**: `data-action` genérico (`modal`, `set`, `remove`, `patch`) no lugar de ~40 `case` de um `switch`. Um modal agora é uma entrada em `SC.modals`; uma tela, uma entrada em `SC.screens` (a aba de navegação nasce sozinha).
- **Estado de edição**: 8 campos soltos (`editingLogId`, `editingErrorId`, `redoingQuestionId`, prefills…) viraram um só: `state.modal = { name, id, ...dados }`.
- **Filtros**: uma barra de filtros e um `applyFilters` para as 4 listas (antes 4 cópias).
- **Formulários**: `bindForm` cuida de habilitar/desabilitar Salvar, validação com mensagem, "Outra (digitar)", botões de escolha e campos condicionais; `readForm` lê tudo por 
ame`.
- **Cartões, abas, estados vazios, botões, seletor de matéria**: componentes únicos.
- **SM-2**: `review()` único para tópico e questão; `esc()` agora também serve para atributos (some `escAttr`).

### Melhorias de uso
- **Confirmação antes de excluir** erro, tópico, questão (com imagem/histórico) e matéria.
- **Tema escuro sem "flash" branco** ao abrir (espelhado em `localStorage` e aplicado no `<head>`).
- **
avigator.storage.persist()`**: pede ao navegador para não apagar seus dados quando faltar espaço (Safari limpa dados de sites sem uso).
- IndexedDB: conexão aberta uma vez e reaproveitada (antes abria uma a cada salvamento).
- Troca de ícone lua/sol feita só por CSS.

### Arquivos
Novos: `js/store.js`, `logic.js`, `sync.js`, `ocr.js`, `ui.js`, `screens.js`, `modals.js`, `main.js`. Removidos: `js/app.js` e as cópias da raiz. Alterados: `index.html`, `css/styles.css` (aviso de atualização removido; regras do tema e de `[data-error]`), `sw.js` (reescrito).

---

## [v12] — Colar imagem nas questões

### Adicionado
- **Colar imagem** no modal de questão (enunciado e resolução): botão "Colar imagem" (lê a área de transferência) e suporte a Ctrl+V / "Colar" do teclado. A imagem colada vai para o campo em que você estava por último (resolução ou enunciado) e passa pelo mesmo redimensionamento/OCR das fotos escolhidas. Colar só texto continua normal.

### Arquivos alterados
`js/app.js` (`wireImageField` ganhou `setFile`, `onPasteButton` e listener de `paste`), `sw.js` (v11 → v12).

---

## [v11] — Horas seguidas corrigidas, editar questão salva, OCR e teto de intervalo maior

### Contexto
Três pedidos: (1) o "horas seguidas por matéria" quebrava ao registrar tempo — o motor regenerava a sequência do zero a cada registro e não lembrava que havia um bloco em andamento; (2) faltava editar uma questão salva e economizar transcrição de enunciado; (3) o teto de 90 dias nos intervalos de revisão era curto para material de base com a prova ainda distante.

### Corrigido
- **Horas seguidas (`streakHours`)**: agora existe `state.currentBlock = { subjectId, hoursDone }`, atualizado a cada "Registrar tempo" (mesma matéria soma; matéria diferente começa um bloco novo) e zerado no "Reiniciar ciclo". `generateSequence` recebe esse bloco e o retoma: com bloco de 3h e 1h já feita, a sequência mostra as 2h que faltam antes de trocar. Bloco já fechado (horas feitas múltiplo do tamanho do bloco) não repete a mesma matéria em seguida. Persistido no IndexedDB e no sync.

### Adicionado
- **Editar questão salva**: botão "Editar" nos cards (Ativas e Graduadas). Reaproveita o modal de salvar, pré-preenchido (matéria, tópico, enunciado, imagem, gabarito, resolução em texto/imagem). Só campos de conteúdo mudam — n, EF, intervalo, histórico e data da próxima revisão não são tocados.
- **OCR (Tesseract.js 5.1.1, português)**: botão "Extrair texto da imagem" abaixo da imagem do enunciado e da imagem da resolução; o texto entra no campo de texto correspondente para revisão (nunca é salvo direto). Usa a foto original quando disponível (melhor que a versão comprimida). Junta linhas do mesmo parágrafo e mantém quebras antes de alternativas. A biblioteca só é carregada no 1º toque; precisa de internet nessa 1ª vez e depois fica em cache (`sw.js` passou a cachear `cdn.jsdelivr.net` e `tessdata.projectnaptha.com`).

### Alterado
- **`MAX_INTERVAL_DAYS`: 90 → 365.** Só o teto mudou; a curva de crescimento do SM-2 continua a mesma (ajuste do "muito fácil, aumenta o tempo" ficou para decidir depois).

### Arquivos alterados
`js/app.js`, `css/styles.css` (`.ocr-row`, chips desabilitados, `flex-wrap` nas ações do card), `sw.js` (v10 → v11).

---

## [v10] — Resolução (imagem/texto) nas questões salvas + intervalo inicial maior pra "Fácil"

### Contexto
Faltava um jeito de guardar *como* resolver uma questão salva (só existia o gabarito, ou seja, a resposta final) — útil pra questões de matérias como exatas, onde o caminho importa mais que a resposta. Além disso, no motor SM-2, a primeira vez que uma questão nova era refeita e marcada como "Fácil" recebia o mesmo intervalo (1 dia) que "Difícil" — não fazia sentido tratar igual algo que já saiu de primeira tentativa sem esforço.

### Adicionado
- **Campo "Resolução" ao salvar uma questão**, em texto e/ou imagem (mesmo padrão de upload/preview já usado para a imagem do enunciado), ambos opcionais e independentes do gabarito.
- **Botão "Ver resolução" no modal "Refazer questão"** — só aparece se a questão tiver resolução salva (texto e/ou imagem), começa escondida a cada rodada nova (mesmo comportamento do "Ver gabarito", pra forçar a tentativa antes de espiar).

### Alterado
- **`sm2Step`**: quando uma questão/tópico é avaliado com nota máxima (5 = "Fácil" no motor de Questão) logo na primeira rodada (
 === 0`), o próximo intervalo passa a ser **3 dias** em vez de 1. "Difícil" (nota 3) continua com 1 dia, e uma resposta errada continua reiniciando para 1 dia. Afeta os dois motores (Tópico e Questão), já que compartilham a mesma função.

### Não incluído (escopo desta versão)
- Editar a resolução (ou qualquer outro campo) de uma questão já salva — mesma limitação que já existia para os demais campos.

### Arquivos alterados
`js/app.js` (`sm2Step`, campos `resolutionText`/`resolutionImageData` no modal de adicionar questão, bloco de revelar resolução no modal de refazer, novo `state.resolutionRevealed` + ação `toggle-resolution-reveal`), `css/styles.css` (`.review-resolution`), `sw.js` (v9 → v10).

---

## [v6] — Correção: questão nova nascendo "atrasada" + gabarito nas questões salvas

### Contexto
Dois problemas relatados na aba "Revisão de Questões": (1) toda questão nova salva já aparecia com o badge "Atrasada 1d", como se já estivesse vencida antes mesmo de existir; (2) não havia onde guardar a resposta correta de uma questão salva, então não dava pra se autotestar de verdade antes de refazer.

### Corrigido
- **Bug do badge "Atrasada 1d" no nascimento**: `dueBadgeHtml` calculava dias vencidos com `Math.floor((nextReviewAt - Date.now()) / MS_PER_DAY)` usando os timestamps exatos (com hora, minuto, segundo, milissegundo). Uma questão recém-criada nasce com 
extReviewAt = now` (o exato instante da criação); no próximo render, alguns milissegundos já tinham passado, então 
extReviewAt - Date.now()` virava um número negativo pertinho de zero — e `Math.floor` de um negativo pertinho de zero arredonda pra `-1`, não pra `0`. Resultado: "Atrasada 1d" instantaneamente. Troquei por `calendarDayDiff`, que compara só a data (zera a hora dos dois lados antes de subtrair) — agora qualquer coisa vencendo hoje mostra "Hoje", não importa a hora exata. Afeta igualmente tópicos e questões, já que os dois usam a mesma função de badge.

### Adicionado
- **Campo "Gabarito" ao salvar uma questão** — campo de texto livre (aceita letra, número, frase curta etc.), opcional, ao lado de enunciado/imagem no modal "Salvar questão".
- **Botão "Ver gabarito" no modal "Refazer questão"** — só aparece se a questão tiver gabarito salvo, e começa escondido a cada rodada nova (pra forçar tentar responder antes de espiar), com toque pra revelar.

### Não incluído (escopo desta versão)
- Editar o gabarito de uma questão já salva (mesma limitação que já existia para os outros campos — só dá pra excluir e recriar).

### Arquivos alterados
`js/app.js` (`calendarDayDiff` + `dueBadgeHtml`, campo `answerKey` no modal de adicionar questão, bloco de revelar gabarito no modal de refazer, novo `state.answerRevealed` + ação `toggle-answer-reveal`), `css/styles.css` (`.review-answer-key`), `js/icons.js` (`eye`), `sw.js` (v5 → v6).

---

## [v5] — Revisão de Questões: motor de repetição espaçada (SM-2)

### Contexto
Faltava decidir "quando refazer questões" de forma sistemática — não só a fixação do dia (Camada 1, que já existia como hábito fora do app), mas rodadas espaçadas depois, misturando matérias (interleaving) em vez de treino em bloco. Esta tela fecha esse gap com um motor de repetição espaçada de verdade, não um cronograma fixo.

### Adicionado
- **Nova tela "Revisão de Questões"**, quarta aba de navegação, com três sub-abas:
  - **Hoje** — fila unificada do que está vencido (tópicos + questões), com round-robin por matéria para forçar interleaving, mais as próximas 10 revisões futuras.
  - **Tópicos** — motor agregado: "Registrar rodada" pede matéria, tópico, quantas questões, quantas erradas e dificuldade sentida (1-5, reaproveitando o componente de rating já usado no modal de matérias). A nota que alimenta o SM-2 combina taxa de erro automática + dificuldade sentida. Rodada nova numa combinação matéria+tópico já existente (comparação case-insensitive) entra no histórico dela; senão cria um tópico novo.
  - **Questões** — banco de questões bookmarked (imagem e/ou enunciado em texto), com abas Ativas/Graduadas. Imagem é redimensionada e comprimida no navegador (máx. 1000px, JPEG 75%) antes de virar base64. Ao refazer, três botões (Errei/Difícil/Fácil) alimentam o mesmo motor SM-2. Depois de 4 acertos seguidos a questão gradua (sai da fila ativa; pode ser reativada manualmente).
- **Motor SM-2 compartilhado** (`sm2Step`): mesma recorrência clássica (Wozniak, 1987) usada pelos dois níveis (tópico e questão) — só muda como a nota 0-5 é calculada em cada um. Intervalo travado em no máximo 90 dias, pra não deixar nada sumir da fila por um semestre inteiro.
- Filtro por matéria nas abas Tópicos e Questões (mesmo padrão do Error Log/Study Log).
- Persistência: `topicReviews` e `questionBank` entram no IndexedDB e no payload de sincronização manual (incluindo as imagens em base64 — banco grande de imagens deixa a sincronização mais pesada).

### Não incluído (escopo desta versão)
- Edição de uma questão salva depois de criada (só existe adicionar/excluir/refazer) — se precisar corrigir um enunciado, hoje é excluir e recriar.
- Limiar de retenção configurável — está fixo implicitamente na própria recorrência do SM-2 (não há um número de "% de retenção alvo" separado exposto na interface).
- Nenhuma trava impede registrar uma rodada no mesmo dia do estudo — é intencional (fica a critério do usuário não fazer isso na Camada 1 de fixação), não uma regra imposta pelo código.

### Arquivos alterados
`index.html` (container da nova tela), `css/styles.css` (badges de vencimento, thumbnail de imagem, upload/preview de imagem, botões de nota), `js/app.js` (motor SM-2 + telas + modais + event delegation + sync/persistência), `js/icons.js` (`repeat`, `target`, `image`, `flame`), `sw.js` (v4 → v5).

---

## [v4] — Campos por categoria no Study Log + seleção de material ao clicar em "Próxima matéria"

### Adicionado
- **Study Log agora tem campos específicos por categoria**, além de nome e status:
  - **Livro**: Capítulo + Página.
  - **Vídeo**: Episódio + Tempo (min:seg).
  - **Questões**: Número do exercício.
  - Os campos trocam dinamicamente ao alternar a categoria no formulário (o Study Log ainda guarda só os campos da categoria atualmente selecionada — trocar de categoria antes de salvar descarta os campos da categoria anterior).
- **Vínculo opcional com uma matéria do Study Cycle** (`subject`), adicionado ao Study Log especificamente para viabilizar o item abaixo. É só uma referência pelo nome da matéria (mesmo padrão já usado no Error Log) — continua não existindo nenhum vínculo funcional (nada no Study Log altera a alocação ou a sequência do Study Cycle).
- **Clique em "Próxima matéria" agora abre um modal com os materiais ativos daquela matéria** (filtrados pelo campo `subject` acima):
  - O card "Próxima matéria" no Study Cycle continua com a aparência visual idêntica — só ganhou `cursor: pointer` e um contorno de foco para teclado. Nada muda automaticamente antes do clique.
  - Se não houver Study Log ativo para a matéria, mostra estado vazio com atalho para adicionar um já com a matéria pré-selecionada.
  - Se houver um ou mais, lista todos (categoria, nome, e os campos específicos — capítulo/página bem visíveis para livros).
  - O botão "Continuar" em cada item abre o Study Log em modo de edição, para o usuário atualizar onde parou.
  - O Study Cycle continua decidindo **apenas a matéria** (a lógica de sequência/alocação não foi tocada); o Study Log é quem informa o material específico dentro dela.

### Não alterado
- Toda a lógica do Study Cycle (alocação, arredondamento, mínimo, desempate por recência, progresso, reset).
- Error Log (nenhuma mudança).
- Visual/layout existente — a única adição visual é o cursor de "clicável" no card de próxima matéria.

### Arquivos alterados
`js/app.js`, `css/styles.css` (pequenas adições: `.subfield`, `.log-card-subject`, `.log-card-detail`, cursor no `.next-study-chip`), `sw.js` (v3 → v4).

---

## [v3] — Study Log, Error Log e correção de empate na sequência

**Contexto:** o app já vinha funcionando com persistência via IndexedDB e dados iniciais vazios (mudanças feitas fora do chat, entre sessões). O Figma foi atualizado com duas telas novas (Study Log e Error Log) mas esse export do Figma ainda usava a versão antiga do algoritmo de alocação e não tinha persistência — ele não "sabia" das mudanças feitas no app funcionando. Este update usa o app funcionando como base (preserva tudo) e só enxerta o visual + lógica novos por cima.

### Adicionado
- **Navegação por abas** no cabeçalho: Study Cycle / Study Log / Error Log.
- **Study Log** — tela para acompanhar "o que estou estudando agora e onde parei":
  - Criar registro (nome + categoria: Livro/Vídeo/Questões).
  - Editar nome e categoria.
  - Marcar como concluído (some da lista Ativos, vai para Concluídos — nunca é apagado).
  - Reativar um registro concluído.
  - Abas Ativos/Concluídos com contador.
- **Error Log** — tela para registrar erros de estudo:
  - Criar/editar/excluir erro (matéria, tópico, descrição, tipo de erro).
  - Tipo de erro é uma lista fixa de 7 opções (Lacuna de conhecimento, Desatenção, Gestão de tempo, Erro de cálculo, Interpretação errada, Esqueci o conceito, Outro), cada uma com uma cor de badge própria.
  - O campo "Matéria" sugere as matérias já cadastradas no Study Cycle (só como conveniência de digitação — não cria nenhum vínculo funcional entre as duas telas) e permite digitar uma matéria livre.
  - Filtro por matéria e por tipo de erro, com botão de limpar filtros.
- Persistência (IndexedDB) estendida para incluir `studyLogs` e `errorLogs`.

### Corrigido
- **Bug de empate na sequência sugerida**: quando duas matérias ficavam com as mesmas horas restantes, o app sempre desempatava pela ordem de cadastro (a primeira matéria cadastrada "ganhava" o empate toda vez), então às vezes sugeria estudar a mesma matéria de novo mesmo logo depois de tê-la estudado. Agora cada matéria guarda um carimbo de "última vez estudada" (um contador incrementado a cada registro de tempo), e o desempate passa a ser: quem está há mais tempo sem ser estudada vence.

### Não alterado (por design)
- Algoritmo de alocação de horas (natural share + arredondamento + reforço de mínimo) — igual.
- Regra de arredondamento (0,5 para cima) — igual.
- Progresso geral e detecção de fim de ciclo — igual.
- Study Log e Error Log são propositalmente independentes do Study Cycle: nada no Error Log muda a alocação de horas, nada no Study Log muda a sequência sugerida. Isso é intencional — são ferramentas separadas por enquanto, que podem alimentar features mais avançadas no futuro.

### Arquivos alterados
`index.html`, `css/styles.css`, `js/app.js`, `js/icons.js`, `sw.js` (versão de cache: v2 → v3).

---

## [v2] — (feito fora deste chat, entre sessões)
- Persistência via IndexedDB.
- Dados iniciais zerados (sem matérias de exemplo).
- Mensagens de estado vazio ("Adicione matérias para começar").

## [v1] — Primeira versão
- Conversão do protótipo Figma para HTML/CSS/JS estático, funcionando offline via Service Worker.
- Algoritmo de alocação de horas por matéria (peso = dificuldade + conteúdo + importância, arredondamento 0,5 para cima, reforço de mínimo por matéria).
- Sequência sugerida (evita repetir a mesma matéria duas vezes seguidas, a menos que seja a única com horas restantes).
- Registro de tempo estudado, progresso geral, reset de ciclo.
