# Changelog

Este arquivo existe para que qualquer pessoa (ou qualquer IA, em outro chat) consiga entender rapidamente o que foi feito e por quê, sem precisar reler o `app.js` inteiro. Sempre que alterar o app — aqui ou por fora — vale a pena adicionar uma entrada nova no topo.

## [v6] — Correção: questão nova nascendo "atrasada" + gabarito nas questões salvas

### Contexto
Dois problemas relatados na aba "Revisão de Questões": (1) toda questão nova salva já aparecia com o badge "Atrasada 1d", como se já estivesse vencida antes mesmo de existir; (2) não havia onde guardar a resposta correta de uma questão salva, então não dava pra se autotestar de verdade antes de refazer.

### Corrigido
- **Bug do badge "Atrasada 1d" no nascimento**: `dueBadgeHtml` calculava dias vencidos com `Math.floor((nextReviewAt - Date.now()) / MS_PER_DAY)` usando os timestamps exatos (com hora, minuto, segundo, milissegundo). Uma questão recém-criada nasce com `nextReviewAt = now` (o exato instante da criação); no próximo render, alguns milissegundos já tinham passado, então `nextReviewAt - Date.now()` virava um número negativo pertinho de zero — e `Math.floor` de um negativo pertinho de zero arredonda pra `-1`, não pra `0`. Resultado: "Atrasada 1d" instantaneamente. Troquei por `calendarDayDiff`, que compara só a data (zera a hora dos dois lados antes de subtrair) — agora qualquer coisa vencendo hoje mostra "Hoje", não importa a hora exata. Afeta igualmente tópicos e questões, já que os dois usam a mesma função de badge.

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
