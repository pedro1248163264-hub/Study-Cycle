# Changelog

Este arquivo existe para que qualquer pessoa (ou qualquer IA, em outro chat) consiga entender rapidamente o que foi feito e por quê, sem precisar reler o `app.js` inteiro. Sempre que alterar o app — aqui ou por fora — vale a pena adicionar uma entrada nova no topo.

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
