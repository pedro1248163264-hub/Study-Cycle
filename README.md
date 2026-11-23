# Study Cycle

Site estático (HTML + CSS + JS puro, **sem build**) para organizar ciclos de estudo semanais, acompanhar o que você está estudando. Funciona offline depois da primeira visita e roda direto no GitHub Pages.

> Histórico de mudanças e decisões: [`CHANGELOG.md`](./CHANGELOG.md). Ao alterar o app (aqui ou em outro chat), registre lá uma entrada nova no topo.

## Telas

| Tela | Para quê |
|---|---|
| **Study Cycle** | Decide quanto e em que ordem estudar cada matéria na semana. |
| **Study Log** | O que você está estudando agora e onde parou (livro, vídeo, questões). |
| **Simulados** | Provas completas por matéria, tempo e comparação com o simulado anterior. |
| **Revisão** | Listas de exercícios com revisão por exercício (marque só os que errou)  e SM-2 para questões individuais (texto/imagem, OCR, resolução). |

As telas são independentes: nada nelas altera a alocação de horas do Study Cycle.

## Publicar (GitHub Pages)

1. Suba **todos** os arquivos desta pasta para a raiz de um repositório (mantendo `css/`, `js/`, `icons/`).
2. **Settings → Pages → Deploy from a branch →** `main` / `(root)`.
3. Em alguns minutos: `https://SEU_USUARIO.github.io/NOME_DO_REPOSITORIO/`.

Para atualizar o site depois, é só subir os arquivos alterados. **Não há mais número de versão para trocar**: com internet o app sempre busca a versão mais nova; sem internet usa a última cópia guardada.

## Estrutura

```
index.html          cabeçalho + <main id="screen"> + ordem dos scripts
css/styles.css      todo o visual (tema claro/escuro, componentes)
js/icons.js         ícones SVG
js/store.js         estado, IndexedDB, coleções (col.put/patch/remove), lista SYNCED
js/logic.js         cálculo do ciclo e SM-2 (funções puras)
js/sync.js          sincronização Supabase (última alteração vence)
js/ocr.js           redimensionar imagem + OCR (Tesseract, baixado sob demanda)
js/math.js          gabarito com LaTeX/MathJax (KaTeX, baixado sob demanda)
js/ui.js            peças reutilizáveis: botões, cartões, filtros, abas, campos, bindForm
js/screens.js       as 4 telas
js/modals.js        todos os modais
js/main.js          ações (data-action), eventos, inicialização
sw.js               Service Worker (offline; rede primeiro)
supabase/pdf-storage.sql  bucket + políticas dos PDFs (rodar 1 vez no Supabase)
manifest.webmanifest  instalável como app (PWA)
```

## Como alterar (receitas)

- **Nova tela**: uma entrada em `SC.screens` (`screens.js`) — a aba aparece sozinha.
- **Novo modal**: uma entrada em `SC.modals` (`modals.js`); abra com `data-action="modal" data-modal="nome"` (+ `data-id`, etc.). Formulário = campos com `name` + `formActions()` + `bindForm()`.
- **Novo dado que precisa salvar/sincronizar**: acrescente a chave em `state` e em `SYNCED` (`store.js`). Só isso.
- **Nova ação de botão**: `data-action="remove|patch|set"` já cobrem excluir, alterar campos e trocar abas; algo especial vira uma entrada em `SC.actions` (`main.js`).
- **Novo arquivo em `js/`**: inclua no `index.html` (na ordem certa) **e** em `APP_FILES` no `sw.js`.

## Lógica

### Study Cycle
- **Horas por matéria**: fatia das horas semanais proporcional a `dificuldade + conteúdo + importância`, pelo método do maior resto (a soma sempre bate). Abaixo do "mínimo por matéria" sobe até o mínimo (o total pode passar um pouco, de propósito).
- **Sequência sugerida**: sempre a matéria com mais horas restantes, sem repetir a mesma duas vezes seguidas (salvo "horas seguidas" ou se for a única). Empate: a que está há mais tempo sem ser estudada. Regra opcional: máx. de matérias distintas numa faixa de X horas.
- **Horas seguidas**: o app lembra do bloco em andamento (ex.: bloco de 3h com 1h feita → mostra as 2h restantes).
- **Fim do ciclo**: "Reiniciar ciclo" zera as horas concluídas (mantém matérias e histórico de "última vez estudada").

### Study Log
Nome, categoria (Livro/Vídeo/Questões), status ativo/concluído, matéria opcional. Campos de posição por categoria (capítulo+página / episódio+tempo / exercício). Tocar em "Próxima matéria" mostra só os materiais ativos daquela matéria.

### Revisão
Dois motores independentes com a mesma recorrência (SM-2 adaptado, ver CHANGELOG v22); a nota vem sempre do que você marca.
- **Listas de exercícios**: você informa nome, matéria (opcional) e vai **cadastrando os exercícios** (número, ou 23a para itens; resposta do gabarito opcional; “Revisar” marcado = entra na fila). Não há total: as linhas aparecem conforme você digita, em qualquer ordem e pulando números. Cada exercício tem sua própria revisão e histórico de resultados. Ao refazer, marque o que **errou** (volta em **1 dia**) ou acertou **com dificuldade** (**2 dias**); o restante conta como tranquilo (**5 dias**, espalhados em 4–6 dias na primeira vez). Depois, cada exercício aumenta o próprio intervalo conforme seus acertos anteriores (teto de 180 dias). O atraso da lista não altera esse cálculo. A lista aparece como pendente se qualquer exercício venceu; ao abri-la, só os exercícios vencidos entram, errados primeiro. Para a carga não acumular, cada lista tem um **limite diário** (campo "Limite por dia"; padrão 10); o que passar disso fica para os próximos dias. Cada exercício pode ter **gabarito** (editando a lista ou direto na tela de refazer), por exercício (aparece para todo exercício que tem resposta). **A lista nunca sai do ciclo** — só você a exclui. Dá para anexar o **PDF da lista** (até 25 MB) e vê-lo no site, inclusive na hora de avaliar. O PDF vai para o **Supabase Storage** (bucket privado `list-pdfs`) e abre em qualquer aparelho (visualizador + abrir em outra aba + baixar). **Nada fica salvo no aparelho**: o PDF é baixado só para a tela e descartado ao fechar (precisa de internet para ver). Com a lista viajam só `pdf: { name, size, path }`. Setup único: rodar `supabase/pdf-storage.sql` no SQL Editor.
- **Gabarito com matemática**: escreva a resposta com `$...$` (ou `\(...\)`, `$$...$$`) — ou só um comando como `\frac` — e ela aparece formatada ao refazer a lista ou a questão. Ex.: `1: $\frac{1}{2}$; 2: \sqrt{3}`. Sem marcação, a resposta continua sendo texto normal. O renderizador (KaTeX) é baixado na primeira vez e fica em cache para uso offline.
- **Questões**: bookmark de questão (imagem e/ou texto); ao refazer: Errei / Difícil / Fácil (1/3/5). Erro volta em 1 dia; difícil em 3 dias; fácil começa em 5 dias e os próximos prazos dependem dos resultados anteriores. 4 acertos seguidos "graduam" a questão.
- **Fila "Hoje"**: vencidos de ambos, em round-robin por matéria (interleaving).
- Rodadas de fixação do mesmo dia **não** devem ser registradas (decisão de uso).
- **OCR**: "Extrair texto da imagem" preenche o campo para você revisar (precisa de internet na 1ª vez).
- Revisão de **tópicos** (escada de domínio) foi removida no v15; dados antigos (`topicReviews`) continuam guardados, só sem tela.

### Atalho que poupa tempo (v23)
- **Começar revisões** (Study Cycle, quando há algo vencido): abre a primeira revisão da fila de hoje e, ao concluir, já abre a seguinte, até acabar.

### Persistência e sincronização
Tudo é salvo automaticamente no **IndexedDB** do navegador (PDFs das listas não ficam no aparelho: vão para o Storage da nuvem) (e o app pede ao navegador para não apagá-lo). O botão de sincronizar (com senha) envia/recebe os dados pela nuvem: vence a alteração mais recente. Imagens salvas viajam junto, então um banco com muitas imagens deixa a sincronização mais pesada.
