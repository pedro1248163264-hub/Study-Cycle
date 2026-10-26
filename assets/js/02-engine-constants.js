/* =====================================================================
   assets/js/02-engine-constants.js — constantes do motor de progressão
   (trilhas, levels, XP, zonas de tempo, adaptação contínua, rodadas).
   Depende de: nada.
   Usado por: 06-tracks.js, 07-storage.js, 08-speed-engine.js, 10-progress.js,
   11-session.js e 14-ui.js.

   Todas as constantes são "pontos de partida razoáveis", nomeadas de propósito
   para serem ajustadas aqui, sem caçar números mágicos pelo código.
   ===================================================================== */

const ONE_HOUR = 3600*1000;
const ONE_DAY = 24*ONE_HOUR;

/* ---------- 1. ZONAS DE TEMPO ----------
   Cada level tem uma META DE TEMPO absoluta (goalMs, em 06-tracks.js). O que a pessoa
   fez em relação a ela define a "zona" da resposta (razão = tempo cognitivo / meta):
     fast  ≤ ZONE_FAST         → dentro da meta
     ok    ≤ ZONE_OK           → bom, ainda a caminho da meta
     slow  > ZONE_OK           → correta, porém lenta
   Erro nunca tem zona. */
const ZONE_FAST = 1.0;
const ZONE_OK = 1.7;
const IMPULSE_FLOOR = 350; // ms — erro abaixo disso é lapso motor, não erro de cálculo

/* ---------- 2. XP ----------
   XP por conta correta, conforme a zona. O mesmo valor enche a barra do level da trilha
   e soma no XP geral do jogador. Erro vale 0 (nunca negativo: errar não tira nada). */
const XP_BY_ZONE = {fast:10, ok:6, slow:3};
const XP_M_BASE = 0.8, XP_M_SPAN = 0.4;  // multiplicador por m: 0.8 (fácil do level) … 1.2 (difícil do level)
const WARMUP_XP_MULT = 0.5;              // aquecimento/reforço rende metade
const COMBO_STEP = 5, COMBO_MAX_BONUS = 4; // +1 XP a cada 5 acertos seguidos, até +4
const ROUND_COMPLETE_XP = 20;            // bônus por concluir uma rodada
const DAILY_GOAL_XP = 50;                // bônus único por bater a meta do dia
const TEST_PASS_XP = {1:40, 2:70, 3:100};// bônus ao passar na prova de nível, por estrelas
const PLACEMENT_XP_MULT = 0.5;
const REINFORCE_XP_MULT = 0.7;           // bloco de reforço (um level abaixo)

// XP necessário para encher a barra do level L: BASE + STEP*(L-1)
const TRACK_XP_BASE = 120, TRACK_XP_STEP = 40;
// Depois do último level, a trilha entra em "Mestre": cada patente custa RANK_XP e a meta
// de tempo encolhe RANK_GOAL_DECAY por patente — o treino de velocidade nunca acaba.
const RANK_XP = 400, RANK_MAX = 5, RANK_GOAL_DECAY = 0.93;

/* ---------- 3. PROVA DE NÍVEL ----------
   Barra cheia → prova de TEST_ITEMS contas no level. Passa com ≥ TEST_PASS_CORRECT acertos
   e mediana dos acertos ≤ TEST_PASS_MEDIAN_RATIO × meta. Estrelas: 1 = passou;
   2 = passou com ≥ TEST_STAR2_HITS dentro da meta; 3 = TEST_ITEMS acertos e ≥ TEST_STAR3_HITS
   dentro da meta. Reprovar nunca derruba o level: só devolve a barra a TEST_FAIL_XP_KEEP. */
const TEST_ITEMS = 8;
const TEST_PASS_CORRECT = 7;
const TEST_PASS_MEDIAN_RATIO = 1.7;
const TEST_STAR2_HITS = 5, TEST_STAR3_HITS = 7;
const TEST_FAIL_XP_KEEP = 0.55;
const TEST_READY_M = 0.55; // barra cheia só libera a prova quando m já está na metade de cima do level
const TEST_MIN_M = 0.6;    // a prova mira o topo do level

/* ---------- 3b. SUBIDA DE LEVEL PEDIDA PELA PESSOA ----------
   A qualquer momento a pessoa pede para subir de level numa trilha. O app passa a misturar,
   nas rodadas, CLIMB_ITEMS contas do level seguinte DAQUELA trilha (blocos "subida") e, ao
   fim, decide: sobe com ≥ CLIMB_PASS_FRAC de acertos E mediana ≤ TEST_PASS_MEDIAN_RATIO × meta
   do level novo. Se não passar, nada se perde (o pedido some e dá para pedir de novo).
   A barra cheia (+ m alto) só passa a RECOMENDAR o pedido — não há mais prova automática. */
const CLIMB_ITEMS = 12;
const CLIMB_PASS_FRAC = 0.75;
const CLIMB_M = 0.4;            // posição fixa dentro do level novo (parte mais fácil dele)
const CLIMB_BLOCK_MAX = 8;      // por rodada geral, no máx. 8 contas de subida seguidas (o resto vem na próxima)
const CLIMB_MAX_PER_ROUND = 2;  // trilhas com subida em andamento tratadas por rodada

/* ---------- 4. NIVELAMENTO (primeira vez numa trilha) ----------
   Escada simples: acerto "bom" sobe um level, o resto desce um. O resultado é a média dos
   levels das últimas PLACEMENT_TAIL contas (arredondada para baixo, sem passar do melhor
   level acertado) — começa um pouco abaixo da habilidade, para as primeiras contas
   serem vitórias. */
const PLACEMENT_ITEMS = 6;
const PLACEMENT_TAIL = 4;
const PLACEMENT_M = 0.5;
const PLACEMENT_START_FRAC = 0.4; // começa em ~40% da escada da trilha

/* ---------- 5. ADAPTAÇÃO CONTÍNUA DENTRO DO LEVEL ----------
   m ∈ [0,1] é a "posição" dentro do level: m=0 ≈ o fim do level anterior, m=1 ≈ o começo do
   próximo. Os geradores só variam coisas SUAVES com m (tamanho dos números dentro da mesma
   quantidade de dígitos, presença de vai-um...) — nunca o nº de dígitos. A cada conta:
       m ← m + M_ETA × (y − ρ*)        y = acerto dentro da zona "ok" ou melhor (1/0)
   (aproximação estocástica de Robbins-Monro): converge para o ponto onde a taxa de sucesso
   é ρ*. Passo de subida pequeno, de descida maior, mas ambos MINÚSCULOS por conta. */
const M_START = 0.3;
const M_AFTER_LEVELUP = 0.15;
const M_ETA = 0.06;
const CHALLENGE_LEVELS = { gentle:0.90, balanced:0.82, intense:0.72 }; // ρ* por "Desafio"
const STRENGTH_ALPHA = 0.15;   // suavização da "força" (0..1) usada para escolher trilhas
const WINDOW_SIZE = 30;

// Reforço suave (substitui a "cascata" e a pausa por frustração): se a pessoa seguir
// acertando pouco mesmo com m no mínimo, o PRÓXIMO bloco da trilha roda no level anterior
// (sem perder level, sem aviso humilhante) e o m volta a um ponto confortável.
const REINFORCE_MIN_ITEMS = 12;
const REINFORCE_ACC = 0.55;
const REINFORCE_M = 0.12;
const REINFORCE_M_RESET = 0.4;

/* ---------- 6. RODADAS E BLOCOS ----------
   Uma rodada é uma sequência de BLOCOS; cada bloco tem contas de UMA trilha e UM level
   (é isso que acaba com "conta de 4 dígitos, depois de 2"). A mistura entre trilhas
   acontece entre blocos, não entre contas. */
const BLOCK_MIN = 6, BLOCK_MAX = 8;
const WARMUP_ITEMS = 3;          // primeiras contas do 1º bloco da trilha, um level abaixo
const WARMUP_M = 0.7;
const ROUND_SIZES = { short:16, normal:24, long:40 };
const MAX_TESTS_PER_ROUND = 2;
const MAX_PLACEMENTS_PER_ROUND = 6;
const TIMEOUT_MULT = 4, TIMEOUT_MIN_MS = 6000, TIMEOUT_MAX_MS = 25000;

/* ---------- 7. JOGADOR (level geral) ---------- */
const PLAYER_LEVEL_EXP = 1.6, PLAYER_LEVEL_SCALE = 100; // XP acumulado p/ nível n = SCALE*(n-1)^EXP
const DAILY_GOALS = [20, 40, 80, 150];
const DEFAULT_DAILY_GOAL = 40;
const DAILY_KEEP_DAYS = 400;
const LOG_MAX = 5000, EVENTS_MAX = 400;   // registro por conta / eventos (para o relatório de IA)
const HISTORY_MAX = 500;          // rodadas guardadas no histórico

/* ---------- 8. PADRÕES DENTRO DO LEVEL (herdado do motor anterior) ---------- */
// Peso por padrão (vai-um, empréstimo, % usada, casas decimais, caso da fração): nunca repete
// uma conta específica — só inclina a geração para onde a pessoa erra/demora mais.
const PATTERN_WEIGHT_NUDGE = 0.06, PATTERN_WEIGHT_MIN = 0.2, PATTERN_WEIGHT_MAX = 3;
// Andaime: dica de método só depois de PATTERN_HINT_STREAK erros SEGUIDOS no mesmo padrão.
const PATTERN_HINT_STREAK = 3;
// Pontos cegos dentro do dígito da tabuada (pares específicos lentos entram de volta).
const HOTPAIR_MIN_SAMPLES = 3;
const HOTPAIR_RT_RATIO = 1.45;
const HOTPAIR_INJECT_CHANCE = 0.25;
const HOTPAIR_CLEAR_STREAK = 2;
const HOTPAIR_EWMA_ALPHA = 0.3;
// Inversão de baixa frequência: "? × 8 = 56" / "? ÷ 8 = 7" na tabuada.
const REVERSE_PATH_RATE = 0.08;
// Ocultação progressiva: no aquecimento (level já conquistado) a conta borra após este tempo.
const MASTERY_FLASH_MS = 1500;
const FLASH_TRACKS = ['soma','subtracao','multiplicacao','divisao']; // trilhas onde o aquecimento relâmpago vale
