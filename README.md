# Study Cycle

Site estático (HTML + CSS + JS puro, sem build) para organizar ciclos de estudo semanais, acompanhar o que você está estudando no momento e registrar os erros que comete pelo caminho. Funciona 100% offline depois da primeira visita e roda direto no GitHub Pages.

> Histórico de mudanças: veja [`CHANGELOG.md`](./CHANGELOG.md). Toda vez que este app for atualizado (aqui ou por fora), vale registrar lá o que mudou — isso é o que permite continuar o trabalho em outro chat sem desconfigurar nada.

## Telas

- **Study Cycle** — decide quanto e com que frequência estudar cada matéria.
- **Study Log** — lembra o que você está estudando agora e onde parou (livro, vídeo ou lista de questões; ativo ou concluído).
- **Error Log** — lembra o que você errou e por quê (matéria, tópico, descrição, tipo de erro), com filtros.

As três telas são propositalmente independentes: nada no Error Log ou Study Log altera a alocação de horas ou a sequência sugerida do Study Cycle.

## Como publicar no GitHub Pages

1. Crie um repositório novo no GitHub (público, ou privado se você tiver GitHub Pro/Team).
2. Suba **todos** os arquivos desta pasta para a raiz do repositório (mantenha a estrutura de pastas: `css/`, `js/`, `icons/`, `index.html`, `sw.js`, `manifest.webmanifest`).
3. No repositório: **Settings → Pages → Build and deployment → Source: Deploy from a branch**. Escolha a branch (`main`) e a pasta `/ (root)`. Salve.
4. Em alguns minutos o site estará em `https://SEU_USUARIO.github.io/NOME_DO_REPOSITORIO/`.

Não precisa de nenhuma etapa de build (`npm install`, etc.) — é só HTML/CSS/JS estático.

## Funcionamento offline

- Um Service Worker (`sw.js`) guarda em cache o HTML, CSS, JS e ícones na primeira visita.
- Depois disso, o site abre normalmente mesmo sem internet (inclusive instalado como app via "Adicionar à tela inicial", graças ao `manifest.webmanifest`).
- As fontes (Google Fonts) são só um "extra": se não houver internet na primeira visita, o site usa fontes do sistema como substitutas — o layout não quebra.

## Verificação automática de atualização

- Toda vez que a página carrega (ou volta a ficar em foco) com internet disponível, o navegador confere se `sw.js` mudou.
- Se você publicar uma versão nova dos arquivos, o navegador do usuário baixa o novo Service Worker, apaga o cache antigo automaticamente e assume o controle da página — aparece um aviso rápido de "Nova versão disponível" e a página recarrega sozinha.
- **Importante:** para isso funcionar, sempre que você atualizar os arquivos e publicar de novo, troque o número de versão no topo do `sw.js`:

  ```js
  const CACHE_VERSION = 'v1'; // mude para 'v2', 'v3', etc a cada deploy novo
  ```

  Sem isso, alguns navegadores podem demorar a perceber que o `sw.js` mudou (o conteúdo dos outros arquivos é sempre revalidado em segundo plano, mas trocar a versão garante a limpeza do cache antigo na hora).

## Estrutura

```
index.html              → estrutura da página
css/styles.css           → todo o visual (cores, tema claro/escuro, componentes)
js/icons.js               → ícones SVG usados na interface
js/app.js                 → estado, cálculo do ciclo e toda a interação
sw.js                      → Service Worker (cache offline + atualização)
manifest.webmanifest      → deixa o site instalável como app (PWA)
icons/                    → ícones do PWA e favicon
CHANGELOG.md              → histórico do que foi mudado e por quê
```

## Lógica implementada

### Study Cycle
- **Horas por matéria**: cada matéria recebe uma fatia das horas semanais proporcional a `dificuldade + conteúdo + importância`, arredondada (0,5 para cima). Se essa fatia natural ficar abaixo do "mínimo de horas por matéria" configurado, ela é aumentada até o mínimo — o que pode fazer o total passar um pouco das horas semanais digitadas, de propósito.
- **Sequência sugerida**: a cada passo, sugere a matéria com mais horas restantes, evitando repetir a mesma matéria duas vezes seguidas — a menos que ela seja a única com horas restantes. Em caso de empate nas horas restantes, desempata pela matéria que está há mais tempo sem ser estudada de verdade (não pela ordem de cadastro).
- **Registrar tempo**: soma horas (1 a 4 por vez) à matéria escolhida.
- **Fim do ciclo**: quando o total estudado atinge o total alocado, aparece o botão "Reiniciar ciclo", que zera as horas concluídas de todas as matérias (sem apagar as matérias nem o histórico de "última vez estudada").

### Study Log
- Cada registro tem nome, categoria (Livro/Vídeo/Questões) e status (ativo/concluído). Novo registro sempre começa ativo.
- Cada categoria tem campos próprios de posição: Livro → capítulo e página; Vídeo → episódio e tempo (min:seg); Questões → número do exercício.
- Pode opcionalmente ser vinculado a uma matéria do Study Cycle. Isso é só uma referência (pelo nome) — não altera nada na alocação ou sequência do Study Cycle.
- Marcar como concluído não apaga o registro — ele só passa a aparecer na aba "Concluídos" (e pode ser reativado a qualquer momento).
- Clicar no card "Próxima matéria" do Study Cycle abre um modal mostrando só os registros ativos vinculados àquela matéria (ou um atalho para criar um, se não houver nenhum). O Study Cycle continua decidindo só a matéria; o Study Log informa o material específico.

### Error Log
- Cada erro tem matéria, tópico, descrição e tipo de erro (uma lista fixa de 7 opções).
- O campo de matéria sugere as matérias já cadastradas no Study Cycle como atalho de digitação, mas aceita qualquer texto — é só conveniência, não cria vínculo funcional entre as telas.
- Filtros por matéria e por tipo de erro, combináveis.

### Persistência
Todos os dados (matérias, configurações, registros de Study Log, erros, tema claro/escuro) são salvos automaticamente no **IndexedDB** do navegador — sobrevivem a fechar a aba e atualizar a página. Os dados ficam só no dispositivo/navegador onde foram criados (não sincronizam entre aparelhos).
