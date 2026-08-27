# Changelog

Este arquivo existe para que qualquer pessoa (ou qualquer IA, em outro chat) consiga entender rapidamente o que foi feito e por quê, sem precisar reler o `app.js` inteiro. Sempre que alterar o app — aqui ou por fora — vale a pena adicionar uma entrada nova no topo.

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
