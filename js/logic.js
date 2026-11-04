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
  // Matérias pausadas (subject.paused) ficam de fora do ciclo: não recebem
  // horas, não entram na sequência e não contam no progresso. Os dados
  // (horas já feitas, notas) ficam guardados e voltam quando reativar.
  function getDerived(state) {
    const activeSubjects = state.subjects.filter((s) => !s.paused);
    const allocatedSubjects = calculateAllocations(activeSubjects, state.settings);
    const sequence = generateSequence(allocatedSubjects, state.settings, state.currentBlock);
    const totalAllocated = allocatedSubjects.reduce((sum, s) => sum + s.allocated, 0);
    const totalCompleted = activeSubjects.reduce((sum, s) => sum + s.completedHours, 0);
    return {
      allocatedSubjects,
      pausedCount: state.subjects.length - activeSubjects.length,
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

  // ---------- LISTAS: REVISÃO POR EXERCÍCIO ----------
  // Cada exercício da lista tem o próprio agendamento SM-2 (list.items).
  // Chave do exercício: "7" (inteiro) ou "23a" (item de dentro do 23).
  //   list.items[chave] = { n, EF, intervalDays, lastReviewedAt, nextReviewAt, lapses }
  // Quem você erra volta no dia seguinte; quem você acerta vai espaçando.
  // Exercício que nunca foi feito não tem entrada em items (= pendente).
  const SESSION_MAX = 10; // teto de exercícios por sessão (errados sempre primeiro)

  const keyNum = (k) => parseInt(k, 10);
  const keyLetter = (k) => (String(k).match(/[a-z]+$/i) || [''])[0].toLowerCase();
  const compareKeys = (a, b) => (keyNum(a) - keyNum(b)) || keyLetter(a).localeCompare(keyLetter(b));

  // Lê "3, 7, 23a, 23: a-b; 5-8; 22: e-g" e devolve { keys[], invalid[] }.
  // Aceita número, número+letra, intervalos de números (5-8) e de letras (a-c).
  function parseExerciseKeys(text, max) {
    const toks = [];
    const re = /(\d+)|([a-zA-Z])|([-–—])|(:)|([;\n])/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
      if (m[1]) toks.push({ t: 'n', v: parseInt(m[1], 10) });
      else if (m[2]) toks.push({ t: 'l', v: m[2].toLowerCase() });
      else if (m[3]) toks.push({ t: 'd' });
      else if (m[4]) toks.push({ t: 'c' });
      else toks.push({ t: 's' });
    }
    const found = {}; // número -> { whole, letters:Set }
    const invalid = [];
    const entry = (n) => (found[n] = found[n] || { whole: false, letters: new Set() });
    let cur = null;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i], prev = toks[i - 1], next = toks[i + 1];
      if (t.t === 'n') {
        if (prev && prev.t === 'd' && toks[i - 2] && toks[i - 2].t === 'n') { // 5-8
          for (let k = toks[i - 2].v + 1; k <= t.v && k - toks[i - 2].v < 200; k++) entry(k).whole = true;
          cur = t.v;
        } else { cur = t.v; entry(cur).whole = true; }
        if (t.v < 1 || t.v > max) invalid.push(String(t.v));
      } else if (t.t === 'l') {
        // "3 e 5": o "e" aqui é "e", não a letra e
        if (t.v === 'e' && prev && prev.t === 'n' && next && next.t === 'n') continue;
        if (cur == null) { invalid.push(t.v); continue; }
        const e = entry(cur);
        e.whole = false;
        if (next && next.t === 'd' && toks[i + 2] && toks[i + 2].t === 'l') { // a-c
          const to = toks[i + 2].v.charCodeAt(0);
          for (let c = t.v.charCodeAt(0); c <= to; c++) e.letters.add(String.fromCharCode(c));
          i += 2;
        } else e.letters.add(t.v);
      } else if (t.t === 's') cur = null;
    }
    const keys = [];
    Object.keys(found).map(Number).filter((n) => n >= 1 && n <= max).forEach((n) => {
      const e = found[n];
      if (e.whole || !e.letters.size) keys.push(String(n));
      else e.letters.forEach((l) => keys.push(n + l));
    });
    return { keys: keys.sort(compareKeys), invalid: Array.from(new Set(invalid)) };
  }

  // "Quais revisar" delimita a lista: "1: a; 3; 11: b, c" => ["1a","3","11b","11c"].
  // Vazio (ou texto livre com palavras, como "26 toda") = sem escopo: a lista toda.
  function listScope(list) {
    const txt = String(list.reviewPick || '');
    if (!txt.trim() || /[a-zA-Z]{2,}/.test(txt)) return null;
    const keys = parseExerciseKeys(txt, list.total).keys;
    return keys.length ? keys : null;
  }

  // Listas antigas (só tinham nota da lista toda + wrong[] no histórico) ganham
  // itens: os errados da última vez voltam em 1 dia; os outros, que passam a
  // contar como certos, mantêm o agendamento que a lista já tinha.
  function listItems(list) {
    if (list.items) return list.items;
    const items = {};
    const last = (list.history || []).slice(-1)[0];
    if (last && list.lastReviewedAt) {
      const done = last.total || list.total;
      const wrong = (last.wrong || []).map(String);
      const scope = listScope(list);
      const universe = scope ? scope.filter((k) => keyNum(k) <= done) : Array.from({ length: done }, (_, i) => String(i + 1));
      for (const key of universe) {
        items[key] = (wrong.includes(key) || wrong.includes(String(keyNum(key))))
          ? { n: 0, EF: 2.3, intervalDays: 1, lastReviewedAt: list.lastReviewedAt, nextReviewAt: list.lastReviewedAt + MS_PER_DAY, lapses: 1 }
          : { n: list.n || 1, EF: list.EF || 2.5, intervalDays: list.intervalDays || 1, lastReviewedAt: list.lastReviewedAt, nextReviewAt: list.nextReviewAt || Date.now(), lapses: 0 };
      }
    }
    return items;
  }

  // O que fazer agora numa lista: vencidos + nunca feitos, errados primeiro.
  //  all   = tudo que está pendente, na ordem de prioridade
  //  today = só os primeiros SESSION_MAX (ou todos, se expand)
  //  fresh = true quando a lista nunca foi feita (é a lista toda)
  function listDue(list, now, expand) {
    now = now || Date.now();
    const scope = listScope(list);
    const all0 = listItems(list);
    // Só conta o que está em "Quais revisar" (se houver).
    const items = {};
    Object.keys(all0).forEach((k) => { if (!scope || scope.includes(k)) items[k] = all0[k]; });
    const keys = Object.keys(items);
    const first = keys.length === 0;           // nunca revisada
    const fresh = first && !scope;             // e sem escopo: é a lista toda
    const due = keys.filter((k) => items[k].nextReviewAt <= now);
    // exercícios do escopo que nunca foram feitos
    const untouched = [];
    if (scope) scope.forEach((k) => { if (!items[k]) untouched.push(k); });
    else if (!fresh) for (let k = 1; k <= list.total; k++) if (!keys.some((x) => keyNum(x) === k)) untouched.push(String(k));
    const prio = (k) => (items[k] ? (items[k].n === 0 ? 0 : 1) : 2);
    const all = due.concat(untouched).sort((a, b) => (prio(a) - prio(b))
      || ((items[a] ? items[a].nextReviewAt : 0) - (items[b] ? items[b].nextReviewAt : 0)) || compareKeys(a, b));
    // Nada vencido (abriu antes da hora): adianta os que vencem primeiro.
    const early = !first && all.length === 0;
    if (early) keys.sort((a, b) => items[a].nextReviewAt - items[b].nextReviewAt || compareKeys(a, b)).forEach((k) => all.push(k));
    const lapsed = all.filter((k) => items[k] && items[k].n === 0 && items[k].nextReviewAt <= now);
    // Na 1ª vez faz tudo; depois, limita para não acumular.
    const today = (expand || first) ? all : all.slice(0, Math.max(SESSION_MAX, lapsed.length));
    return { fresh, first, early, scope, all, lapsed, today, items };
  }

  // Rótulo do exercício: "23a" fica "23a"; o resto do 23 vira "23 (restante)".
  function keyLabel(key, items) {
    if (/[a-z]$/i.test(key)) return key;
    const hasParts = Object.keys(items || {}).some((k) => keyNum(k) === keyNum(key) && /[a-z]$/i.test(k));
    return hasParts ? `${key} (restante)` : key;
  }

  // Fecha uma sessão: `session` = { keys[] (o que estava na sessão), wrong[], hard, upTo, total }
  // Tudo da sessão que você não marcou como errado conta como certo.
  function applyListSession(list, session) {
    const now = Date.now();
    const items = Object.assign({}, listItems(list));
    const wrong = session.wrong.slice();
    const wrongNums = new Set(wrong.filter((k) => !/[a-z]$/i.test(k)).map(keyNum));
    const reviewed = new Set(session.keys);
    wrong.forEach((k) => reviewed.add(k)); // "23a" pode não estar na sessão ainda
    // errou o exercício inteiro: os itens soltos dele (23a…) são redundantes
    const targets = Array.from(reviewed).filter((k) => !(/[a-z]$/i.test(k) && wrongNums.has(keyNum(k))));
    let right = 0;
    targets.forEach((k) => {
      const it = items[k] || { n: 0, EF: 2.5, intervalDays: 0, lapses: 0 };
      const isWrong = wrong.includes(k);
      const step = sm2Step(it.n || 0, it.EF || 2.5, it.intervalDays || 1, isWrong ? 1 : (session.hard ? 3 : 5));
      if (!isWrong) right += 1;
      items[k] = {
        n: step.n, EF: step.EF, intervalDays: step.intervalDays,
        lastReviewedAt: now, nextReviewAt: now + step.intervalDays * MS_PER_DAY,
        lapses: (it.lapses || 0) + (isWrong ? 1 : 0),
      };
    });
    Object.keys(items).forEach((k) => { if (/[a-z]$/i.test(k) && wrongNums.has(keyNum(k)) && !targets.includes(k)) delete items[k]; });
    const entry = {
      at: now, correct: right, total: right + wrong.length, wrong: wrong.slice().sort(compareKeys),
      upTo: session.upTo || undefined, hard: session.hard || undefined,
      result: wrong.length === 0 ? (session.hard ? 'hard' : 'easy') : (wrong.length > (right + wrong.length) / 2 ? 'wrong' : 'hard'),
    };
    const next = Object.assign({}, list, { items, progress: null, lastReviewedAt: now, history: (list.history || []).concat([entry]) });
    next.n = next.history.length;
    // A lista vence quando o primeiro exercício vencer (ou já, se sobrou exercício nunca feito).
    const times = Object.keys(items).map((k) => items[k].nextReviewAt);
    const untouched = listDue(next, now).all.some((k) => !items[k]);
    next.nextReviewAt = untouched ? now : (times.length ? Math.min.apply(null, times) : now);
    next.intervalDays = Math.max(1, calendarDayDiff(next.nextReviewAt, now));
    return next;
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

  // Quantas listas e questões de UMA matéria estão vencidas agora. Mesma regra
  // da aba Revisão > Hoje: vence quando nextReviewAt <= agora; questão
  // graduada (retired) não conta; lista nunca se aposenta.
  function pendingReviews(state, subject, now) {
    now = now || Date.now();
    const due = (x) => x.subject === subject && x.nextReviewAt && x.nextReviewAt <= now;
    return {
      lists: state.exerciseLists.filter(due).length,
      questions: state.questionBank.filter((q) => !q.retired && due(q)).length,
    };
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
    GRADUATE_AFTER_N, sm2Step, applyQuestionRedo, applyListSession,
    SESSION_MAX, parseExerciseKeys, listScope, listItems, listDue, keyLabel, compareKeys,
    interleaveBySubject, pendingReviews, calendarDayDiff, formatDate,
  });
})();
