/* =========================================================
   Study Cycle — lógica pura (sem tela, sem estado global)

   Ciclo: cada matéria recebe horas proporcionais a
   (dificuldade + conteúdo + importância); a sequência sugerida
   é gulosa: sempre a matéria com mais horas restantes, sem repetir
   a mesma duas vezes seguidas (salvo "horas seguidas" / única restante).

   Revisão: repetição espaçada baseada em SM-2 (Wozniak, 1987).
   ========================================================= */
(function () {
  'use strict';
  const SC = window.SC = window.SC || {};

  // ---------- STUDY CYCLE ----------

  // Divide as horas semanais pelo método do "maior resto": cada matéria
  // leva o piso da sua fatia exata e as horas que sobram vão, uma a uma,
  // para quem tem o maior resto — assim a soma bate sempre com o total.
  // Quem ficar abaixo do mínimo configurado sobe até o mínimo (o total
  // pode passar um pouco das horas semanais; é de propósito).
  function calculateAllocations(subjects, settings) {
    const weight = (s) => s.difficulty + s.content + s.importance;
    const totalWeight = subjects.reduce((sum, s) => sum + weight(s), 0);

    if (totalWeight <= 0) {
      return subjects.map((s) => Object.assign({}, s, { allocated: settings.minHoursPerSubject }));
    }

    const shares = subjects.map((s) => {
      const exact = settings.weeklyHours * (weight(s) / totalWeight);
      const floor = Math.floor(exact);
      return { subject: s, floor, remainder: exact - floor };
    });

    const flooredTotal = shares.reduce((sum, sh) => sum + sh.floor, 0);
    const leftover = Math.max(0, Math.round(settings.weeklyHours) - flooredTotal);
    const bumpSet = new Set(
      shares.map((sh, i) => i)
        .sort((a, b) => shares[b].remainder - shares[a].remainder)
        .slice(0, leftover)
    );

    return shares.map((sh, i) => {
      const natural = sh.floor + (bumpSet.has(i) ? 1 : 0);
      return Object.assign({}, sh.subject, { allocated: Math.max(natural, settings.minHoursPerSubject) });
    });
  }

  // Monta a ordem sugerida: a cada bloco escolhe a matéria com mais horas
  // restantes (empate: a que está há mais tempo sem ser estudada na vida
  // real) e fica nela por até `streakHours` horas seguidas antes de trocar.
  // Regra opcional de diversidade: em qualquer janela de `windowHours`
  // horas, no máximo `maxSubjectsPerWindow` matérias distintas (é uma
  // restrição forte, mas se for impossível de cumprir numa virada o ciclo
  // escolhe outra matéria mesmo assim e se corrige algumas horas depois).
  function generateSequence(allocatedSubjects, settings, currentBlock) {
    settings = settings || {};
    const streakHours = Math.max(1, parseInt(settings.streakHours, 10) || 1);
    const windowHours = Math.max(0, parseInt(settings.windowHours, 10) || 0);
    const maxSubjectsPerWindow = Math.max(0, parseInt(settings.maxSubjectsPerWindow, 10) || 0);
    const windowRuleActive = windowHours > 1 && maxSubjectsPerWindow > 0;

    const sequence = [];
    const pools = allocatedSubjects.map((s) => ({
      id: s.id,
      name: s.name,
      colorIndex: s.colorIndex,
      remaining: Math.max(0, s.allocated - s.completedHours),
      recency: s.lastStudiedAt || 0, // 0 = nunca estudada = ganha qualquer empate
    }));

    // Adicionar `id` como bloco novo agora respeita o limite de matérias
    // distintas na janela? (Continuar a matéria atual nunca acrescenta uma nova.)
    function passesWindowRule(id) {
      if (!windowRuleActive) return true;
      const distinct = new Set(sequence.slice(-(windowHours - 1)).map((item) => item.id));
      return distinct.has(id) || distinct.size < maxSubjectsPerWindow;
    }

    let lastPickedId = null;
    let streakLeft = 0; // horas que ainda faltam para fechar o bloco atual
    // Retoma o bloco em andamento na vida real (ex.: 1h feita de um bloco
    // de 3h => sobram 2h). Bloco já fechado: streakLeft = 0, mas a matéria
    // continua como "última" para não repetir logo em seguida.
    if (currentBlock && pools.some((p) => p.id === currentBlock.subjectId)) {
      lastPickedId = currentBlock.subjectId;
      const doneInBlock = (parseInt(currentBlock.hoursDone, 10) || 0) % streakHours;
      streakLeft = doneInBlock > 0 ? streakHours - doneInBlock : 0;
    }
    // Relógio local da simulação (não mexe nos dados reais de recência).
    let simClock = pools.reduce((max, p) => Math.max(max, p.recency), 0);

    while (pools.some((p) => p.remaining > 0)) {
      let candidate = null;

      if (streakLeft > 0 && lastPickedId !== null) {
        candidate = pools.find((p) => p.id === lastPickedId && p.remaining > 0) || null;
      }

      if (!candidate) {
        pools.sort((a, b) => (b.remaining !== a.remaining ? b.remaining - a.remaining : a.recency - b.recency));
        const available = pools.filter((p) => p.remaining > 0);
        // Ordem de preferência: outra matéria que respeita a janela >
        // qualquer uma que respeita a janela > outra matéria (ignorando a
        // janela) > o que sobrar.
        candidate = available.find((p) => p.id !== lastPickedId && passesWindowRule(p.id))
          || available.find((p) => passesWindowRule(p.id))
          || available.find((p) => p.id !== lastPickedId)
          || available[0]
          || null;
        streakLeft = streakHours;
      }

      if (!candidate) break; // rede de segurança
      sequence.push({ id: candidate.id, name: candidate.name, colorIndex: candidate.colorIndex });
      candidate.remaining -= 1;
      simClock += 1;
      candidate.recency = simClock;
      lastPickedId = candidate.id;
      streakLeft -= 1;
    }
    return sequence;
  }

  // Tudo que a tela do ciclo precisa, calculado de uma vez.
  function getDerived(state) {
    const allocatedSubjects = calculateAllocations(state.subjects, state.settings);
    const sequence = generateSequence(allocatedSubjects, state.settings, state.currentBlock);
    const totalAllocated = allocatedSubjects.reduce((sum, s) => sum + s.allocated, 0);
    const totalCompleted = state.subjects.reduce((sum, s) => sum + s.completedHours, 0);
    return {
      allocatedSubjects,
      sequence,
      totalAllocated,
      totalCompleted,
      overallProgress: totalAllocated > 0 ? Math.min(100, Math.round((totalCompleted / totalAllocated) * 100)) : 0,
      isCycleComplete: totalAllocated > 0 && totalCompleted >= totalAllocated,
      nextStudy: sequence[0] || null,
    };
  }

  // ---------- REPETIÇÃO ESPAÇADA (SM-2) ----------
  // Questões (bookmark individual) e listas de exercícios usam a mesma
  // recorrência; a nota 0-5 vem sempre do botão que você toca (mal/médio/bem).
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const MAX_INTERVAL_DAYS = 365;
  const GRADUATE_AFTER_N = 4; // acertos seguidos até a questão sair da fila ativa
  const REDO_QUALITY = { wrong: 1, hard: 3, easy: 5 };

  function sm2Step(n, EF, prevIntervalDays, quality) {
    let interval, nextN;
    if (quality >= 3) {
      // "Fácil" (5) logo na 1ª vez pula para 3 dias; "Difícil" (3) fica em 1.
      if (n === 0) interval = quality >= 5 ? 3 : 1;
      else if (n === 1) interval = 6;
      else interval = Math.round(prevIntervalDays * EF);
      nextN = n + 1;
    } else {
      nextN = 0;
      interval = 1;
    }
    const nextEF = Math.max(1.3, EF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    return { n: nextN, EF: nextEF, intervalDays: Math.min(interval, MAX_INTERVAL_DAYS) };
  }

  // Aplica uma nota a um item de revisão (tópico OU questão) e agenda a próxima.
  function review(item, quality, historyExtra) {
    const step = sm2Step(item.n || 0, item.EF || 2.5, item.intervalDays || 1, quality);
    const now = Date.now();
    return Object.assign({}, item, {
      n: step.n,
      EF: step.EF,
      intervalDays: step.intervalDays,
      lastReviewedAt: now,
      nextReviewAt: now + step.intervalDays * MS_PER_DAY,
      history: (item.history || []).concat([Object.assign({ at: now, quality, intervalDays: step.intervalDays }, historyExtra)]),
    });
  }

  // Refazer questão: 'wrong' | 'hard' | 'easy'.
  function applyQuestionRedo(q, result) {
    const next = review(q, REDO_QUALITY[result], { result });
    next.retired = next.n >= GRADUATE_AFTER_N;
    return next;
  }

  // Refazer lista de exercícios: 'wrong' | 'hard' | 'easy'. Diferente da
  // questão, a lista NUNCA se aposenta: fica no ciclo, e o intervalo cresce
  // a cada "bem" e volta para 1 dia a cada "mal" (até o teto de 365 dias).
  function applyListRedo(list, result) {
    return review(list, REDO_QUALITY[result], { result });
  }

  // Round-robin entre matérias: a fila do dia mistura matérias em vez de
  // agrupar (interleaving).
  function interleaveBySubject(items) {
    const groups = {};
    const order = [];
    items.forEach((it) => {
      const key = it.subject || '—';
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(it);
    });
    const result = [];
    for (let more = true; more;) {
      more = false;
      order.forEach((key) => {
        if (groups[key].length) { result.push(groups[key].shift()); more = true; }
      });
    }
    return result;
  }

  // Diferença em DIAS DE CALENDÁRIO (meia-noite a meia-noite), não em blocos
  // de 24h — senão uma questão criada agora aparecia como "Atrasada 1d".
  function calendarDayDiff(targetMs, fromMs) {
    const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
    return Math.round((startOfDay(targetMs) - startOfDay(fromMs)) / MS_PER_DAY);
  }

  const formatDate = (ms) => (ms ? new Date(ms).toLocaleDateString('pt-BR') : '—');

  Object.assign(SC, {
    calculateAllocations, generateSequence, getDerived,
    GRADUATE_AFTER_N, sm2Step, applyQuestionRedo, applyListRedo,
    interleaveBySubject, calendarDayDiff, formatDate,
  });
})();
