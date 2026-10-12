# Study Cycle

Site estático (HTML + CSS + JS puro, **sem build**) para organizar ciclos de estudo semanais, acompanhar o que você está estudando e registrar erros. Funciona offline depois da primeira visita e roda direto no GitHub Pages.

> Histórico de mudanças e decisões: [`CHANGELOG.md`](./CHANGELOG.md). Ao alterar o app (aqui ou em outro chat), registre lá uma entrada nova no topo.

## Telas

| Tela | Para quê |
|---|---|
| **Study Cycle** | Decide quanto e em que ordem estudar cada matéria na semana. |
| **Study Log** | O que você está estudando agora e onde parou (livro, vídeo, questões). |
| **Error Log** | O que você errou e por quê, com filtros. |
| **Revisão** | Repetição espaçada (SM-2): tópicos por rodada e questões individuais (texto/imagem, OCR, resolução). |

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
js/ui.js            peças reutilizáveis: botões, cartões, filtros, abas, campos, bindForm
js/screens.js       as 4 telas
js/modals.js        todos os modais
js/main.js          ações (data-action), eventos, inicialização
sw.js               Service Worker (offline; rede primeiro)
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

### Error Log
Matéria (lista ou texto livre), tópico, descrição e tipo de erro (7 opções); filtros por matéria e tipo.

### Revisão
Dois motores independentes com a mesma recorrência SM-2; só muda como a nota 0–5 é obtida.
- **Tópicos**: informa questões feitas, erradas e dificuldade sentida (1–5); nota = média entre taxa de acerto e dificuldade.
- **Questões**: bookmark de questão (imagem e/ou texto); ao refazer: Errei / Difícil / Fácil (1/3/5). 4 acertos seguidos "graduam" a questão. "Fácil" na 1ª vez agenda 3 dias.
- **Fila "Hoje"**: vencidos de ambos, em round-robin por matéria (interleaving). Teto de intervalo: 365 dias.
- Rodadas de fixação do mesmo dia **não** devem ser registradas (decisão de uso).
- **OCR**: "Extrair texto da imagem" preenche o campo para você revisar (precisa de internet na 1ª vez).

### Persistência e sincronização
Tudo é salvo automaticamente no **IndexedDB** do navegador (e o app pede ao navegador para não apagá-lo). O botão de sincronizar (com senha) envia/recebe os dados pela nuvem: vence a alteração mais recente. Imagens salvas viajam junto, então um banco com muitas imagens deixa a sincronização mais pesada.
