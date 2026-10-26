# Mental Math

> **Manutenção:** sempre atualize este README quando mudar o funcionamento do app, especialmente a geração, a seleção, a progressão ou a recompensa.

Treino de cálculo mental para virar uma "calculadora humana": poupar tempo em prova e no dia a dia. PWA local — roda direto no navegador (abra `index.html`), funciona offline e guarda tudo no `localStorage` do aparelho. Sem conta, sem servidor.

> **Única exceção ao offline:** as fontes do Google Fonts (`index.html`). Depois da primeira visita online ficam em cache; só a primeira abertura offline usa fontes locais de reserva.

## Ideia central (v2)

A v1 sorteava a próxima conta entre ~40 famílias, uma a uma, e ajustava a dificuldade com limiares duros — daí o "conta de 4 dígitos e depois uma de 2" e as pausas/"vou pegar mais leve". A v2 troca isso por três princípios:

1. **Trilhas com levels.** Cada operação é uma escada de levels. Um level fixa a *forma* das contas (ex.: "3 dígitos × 1 dígito") e uma **meta de tempo** própria. Só o que varia suavemente dentro do level (tamanho dos números, vai-um…) é adaptativo.
2. **Adaptação contínua e suave.** Dentro do level existe uma posição `m ∈ [0,1]` que anda um passinho a cada conta rumo à **taxa de acerto desejada** (ρ\*). Nunca há salto de dígitos entre contas seguidas.
3. **Recompensa e motivo para voltar.** XP, level por trilha, level geral, estrelas, prova de nível, rodadas curtas com fim, meta diária, sequência de dias.

## Trilhas e levels

9 trilhas; 4 ativas por padrão (as demais são ligadas na aba **Trilhas**):

| Trilha | Levels | Ativa por padrão |
|---|---|---|
| Soma | 8 (unidades → 4 dígitos + 4 dígitos) | sim |
| Subtração | 8 | sim |
| Multiplicação | 8 (tabuada 2–5 → 3 dígitos × 2 dígitos) | sim |
| Divisão | 6 | sim |
| Porcentagem | 6 (10% e 50% → acréscimo/desconto → "é quantos %?" → valor original, variação e descontos sucessivos) | não |
| Contas com vírgula | 6 | não |
| Frações | 5 (soma/subtração, multiplicação/divisão, comparação) | não |
| Expressões | 6 (parênteses, cadeias, dois parênteses, **potências, cubos e raízes simples** — quadrados até 13², cubos até 5³, com bases negativas para treinar o sinal — e **ordem das operações**) | não |
| Equações | 5 | não |

Potenciação e radiciação **não são trilhas**: aparecem só dentro das Expressões, de forma leve (quadrados de bases até 13, cubos de bases até 5 — inclusive negativas, p.ex. (−3)³ — e raízes quadradas exatas até √169), para treinar a ordem das operações.

Cada level tem nome, **meta de tempo** (ex.: Soma Nv 1 = 1,0 s … Nv 8 = 5,8 s) e uma **dica de tática** (mostrada na primeira vez que o level aparece, na prova e na aba Trilhas). **Números negativos:** nos últimos levels de Subtração (3 últimos), Multiplicação (3 últimos) e Divisão (2 últimos), de ~22% a ~38% das contas (sobe com `m`) vêm com sinal — `menor − maior`, `a − (−b)`, `(−a) × b`, `(−a) ÷ (−b)` — mantendo o número de dígitos do level. A resposta pode ser negativa (tecla ±, ✓ para confirmar) e a dica do level explica a regra de sinais. Essas contas não entram nos pesos de vai-um/empréstimo.

Os geradores ficam em `06-tracks.js` e garantem resposta exata, resposta inteira (ou decimal de ≤ 2 casas), sem resposta negativa (exceto equação, comparação e Expressões, onde a resposta pode ser negativa — digite com a tecla ±) e forma de dígitos fixa por level.

## Como a dificuldade se ajusta

- **Zonas por conta correta** (tempo ÷ meta do level): `fast ≤ 1,0` (dentro da meta), `ok ≤ 1,7`, `slow` acima. Erro nunca tem zona.
- **Passo de m:** `m ← m + 0,06 × (y − ρ*)`, com `y = 1` se acertou em zona `fast/ok`. É uma aproximação estocástica (Robbins-Monro): converge ao ponto em que a pessoa acerta ρ\* das contas. O passo por conta é minúsculo (média ≈ 0,01–0,02), sem degraus.
- **Desafio** (Ajustes): ρ\* = 0,90 *Tranquilo*, 0,82 *Equilibrado* (padrão), 0,72 *Intenso*.
- **Level nunca cai.** Errar não desconta XP nem derruba level. Se a pessoa patinar (< 55% de acerto em 12 contas com `m` no piso), o **próximo bloco** da trilha roda no level anterior (**reforço**, rende 70% do XP), `m` volta a um ponto confortável e o reforço dura um bloco só — sem aviso humilhante.
- **Lapso de digitação:** erro em < 350 ms, número invertido (45 vs 54) ou um dígito trocado (57 vs 56) é lapso motor: fica no histórico, mas não mexe em `m`, XP nem pesos (e na prova/nivelamento a conta é reposta).
- **Pesos internos por padrão** (herdado da v1): vai-um, empréstimo, grupo de %, casas decimais e caso da fração enviesam a geração para onde a pessoa erra/demora mais (sempre com piso de aleatoriedade); pesos por dígito da tabuada + "pontos cegos" (pares específicos lentos voltam até limpar); inversão rara ("? × 8 = 56"); **andaime** — dica de método após 3 erros seguidos no mesmo padrão.

## Rodadas e blocos

Uma **rodada** (Curta 16 / Normal 24 / Longa 40 contas — Ajustes) é uma sequência de **blocos**; cada bloco tem 6–8 contas de **uma trilha e um level**. A mistura entre trilhas acontece entre blocos (favorecendo trilhas mais fracas e há mais tempo sem treino; nunca a mesma trilha duas vezes seguidas).

Ordem: **nivelamentos** (trilhas novas) → **treino**, com blocos de **subida de level** no meio quando a pessoa pediu (veja abaixo). No primeiro bloco de cada trilha na rodada há **aquecimento**: 3 contas um level abaixo (rende metade do XP; com "aquecimento relâmpago" ligado — só nas 4 operações básicas — a conta borra após 1,5 s, e o app avisa uma vez por rodada, antes das primeiras contas que somem). Em Ajustes você escolhe em quais das 4 operações a conta pode sumir.

Não existem mais modos Ultimate/Intervalado/HIIT nem pausas automáticas por "frustração/fadiga": a rodada termina sozinha, e a pessoa pode pausar (também automático ao esconder o app) ou sair a qualquer momento (rodada parcial é salva).

## Nivelamento

Na primeira vez numa trilha, 6 contas em escada (acerto bom sobe 1 level, o resto desce 1), começando em ~40% da trilha. O resultado é a média dos últimos 4 levels, sem passar do melhor level acertado — começa um pouco abaixo da habilidade, para as primeiras contas serem vitórias. Levels abaixo recebem 1★.

## XP, barra e subida de level

- **XP por acerto:** `fast` 10, `ok` 6, `slow` 3, × (0,8 + 0,4·m). Erro = 0 (nunca negativo). **Combo:** +1 XP a cada 5 acertos seguidos (até +4); erro zera o combo.
- O mesmo XP enche a **barra do level da trilha** (120 + 40·(L−1) XP) e soma no **XP geral**.
- Barra cheia **e** `m ≥ 0,55` → a trilha ganha o selo **Recomendado** (a barra continua com o efeito visual de 100%). O app **não impõe** mais nenhuma prova: quem decide quando subir é a pessoa.
- **Subir de level a qualquer momento:** na aba Trilhas (ou no aviso "Recomendado" da Início) toque em **Subir de level**. A partir daí, só **aquela trilha** passa a receber contas do **level seguinte** (em rodada geral, até 8 por rodada; em "Treinar só esta", todas de uma vez), e as outras trilhas seguem normais. Ao completar **12 contas** (`CLIMB_ITEMS`), o app decide: sobe com **≥ 75% de acertos** (9/12) **e** mediana ≤ 1,7× a meta do level novo. **★** = passou; **★★** = ≥ 5 dentro da meta; **★★★** = ≥ 11 acertos e ≥ 8 dentro da meta. Bônus de XP 40/70/100. Lapsos de digitação não contam. A pessoa pode cancelar a subida a qualquer hora.
- Passou → level seguinte (`m` recomeça em 0,15, barra zerada). Não passou → **nada se perde** (nem barra, nem estrelas, nem level): o pedido some e dá para pedir de novo. No último level, "subir" conclui a trilha (patente Mestre).
- Na aba Trilhas, toque num level já conquistado com menos de 3★ na escada para **refazer a prova** (8 contas) e melhorar as estrelas (não muda o level atual).
- Terminou o último level → trilha **concluída** e entra em **Mestre**: até 5 patentes (400 XP cada), e a meta de tempo encolhe 7% por patente — o treino de velocidade nunca acaba.

## Recompensas e retenção

- **Level geral** (XP acumulado = 100·(n−1)^1,6) com títulos (Iniciante → Calculadora Humana).
- **Meta diária** (20/40/80/150 contas; padrão 40) com anel de progresso, **bônus de 50 XP** e **sequência de dias** (+ faixa da semana, aviso de sequência em risco).
- **Fim de rodada:** 1–3 estrelas (sempre ≥ 1 ao concluir), +20 XP de conclusão, XP com contagem animada, barras das trilhas "de → para", lista de conquistas (level, estrelas, patente, recordes de mediana, prova liberada…).
- **Recordes pessoais** por level (mediana do bloco), confete, sons/vibração, balões de XP e combo no treino.

## Telas

Início (nível, meta, sequência, semana, botão **Treinar** ou **Começar nivelamento**, avisos "Recomendado: subir de level") · Trilhas (liga/desliga, level, barra, estrelas, escada de levels, dica, "treinar só esta", subir de level) · Treino (barra da rodada, chip da trilha/level, combo e XP, teclado) · Resumo da rodada · Estatísticas (precisão, % dentro da meta, contas por dia, por trilha) · Ajustes (meta, tamanho da rodada, desafio, tema, idioma PT/EN, voz/TTS, vibração, sons, modo foco, exportação CSV/JSON, apagar dados).

## Relatório para IA

Em **Ajustes > Dados > Relatório para IA** há dois botões: **Copiar** (área de transferência) e **MD ↓** (baixa `mental_math_relatorio_ia.md`). O texto em Markdown começa com instruções para a IA (como o app funciona, o que é evolução esperada, o que responder) e traz: resumo geral, estado atual por trilha, evolução por semana (geral e por trilha, com a razão mediana *tempo ÷ meta*), comparação início × fim em cada level, marcos (nivelamento, provas, levels, patentes), contas por dia, últimas rodadas e o **registro bruto das últimas 1.500 contas** em CSV. O app guarda um registro compacto de cada conta (últimas 5.000) e dos marcos (últimos 400) só para isso; tudo fica no aparelho até você copiar ou baixar.

## Dados

`localStorage`, chave `calcrapido_db_v3`. Na primeira abertura, ajustes, histórico e melhor sequência do formato antigo (`calcrapido_db_v2`) são aproveitados; o progresso por família não tem equivalente nas trilhas, então o **nivelamento recomeça**.

## Estrutura do código

`assets/js/`, `<script>` comuns carregados em ordem de dependência (funciona também via `file://`):

| Arquivo | Conteúdo |
|---|---|
| `01-utils.js` | Utilitários (RNG, estatística, formatação). |
| `02-engine-constants.js` | **Todas** as constantes de ajuste (zonas, XP, prova, adaptação, rodadas, nível geral). |
| `03-i18n.js` | Textos PT/EN. |
| `04-operations.js` | Operações e comparações. |
| `05-expression-terms.js` | Termos (potência, raiz quadrada/cúbica) e contadores de vai-um/empréstimo. |
| `06-tracks.js` | Trilhas, levels (meta, forma, dica) e geradores de conta. |
| `07-storage.js` | `Store`: persistência, saneamento, migração v2 → v3. |
| `08-speed-engine.js` | `Engine`: planejamento da rodada, geração, `m`, XP, nivelamento, prova, reforço. |
| `09-feedback.js` | Fala (TTS), sons, vibração. |
| `10-progress.js` | `Progress`: XP/level geral, meta diária, sequência, semana, estrelas da rodada. |
| `11-session.js` | `Session`: percorre blocos, mede tempo, aplica XP/combo/meta, fecha a rodada. |
| `12-analytics.js` | Resumo da rodada e agregados do histórico. |
| `13-export.js` | CSV/JSON. |
| `14-ui.js` | Interface. |
| `15-init.js` | Inicialização e service worker (fora dos testes). |

## Testes

```sh
node run-tests.js
```

Sem dependências (só Node.js). Cobre geradores (exatidão, forma por level), fala, nivelamento, passo/convergência de `m`, XP, prova, reforço, patentes, simulação de usuários virtuais, `Progress`, saneamento/migração do `Store` e uma rodada completa do `Session` com UI "muda". Layout, teclado e TTS reais não são cobertos: teste manualmente no navegador (ou com Playwright).
