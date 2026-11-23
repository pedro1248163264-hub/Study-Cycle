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
  const MAX_INTERVAL_DAYS = 180; // ~6 meses
  const GRADUATE_AFTER_N = 4; // acertos seguidos até a questão sair da fila ativa
  const REDO_QUALITY = { wrong: 1, hard: 3, easy: 5 };

  // Agendamento (v24). Erro reinicia; primeiro acerto tranquilo = 5 dias.
  // Questões mantêm 3 dias para difícil; itens de lista passam 2 como override.
  // Regras fixas na 1ª vez que acerta (ou depois de um erro):
  //   errou                 -> amanhã (1 dia) e recomeça
  //   acertou com dificuldade -> 2 dias
  //   acertou tranquilo       -> 5 dias
  // Depois, o intervalo cresce a cada acerto:
  //   tranquilo -> anterior x (EF x 0,85)   (EF 2,5 => ~x2,1: 5, 11, 23, 49, 104…)
  //   dificuldade -> anterior x ~1,25 (cresce devagar, no mínimo +1 dia)
  // EF ("facilidade", 1,3 a 2,8) sobe um pouco com acertos tranquilos e cai com
  // dificuldade/erro, então o que é difícil para VOCÊ espaça menos. Teto: 180 dias (~6 meses).
  // quality: 1 = errou, 3 = acertou com dificuldade, 5 = acertou tranquilo.
  function sm2Step(n, EF, prevIntervalDays, quality, firstHardDays) {
    EF = EF || 2.5;
    if (quality < 3) {
      return { n: 0, EF: Math.max(1.3, EF - 0.2), intervalDays: 1 };
    }
    const hard = quality < 5;
    const nextEF = hard ? Math.max(1.3, EF - 0.15) : Math.min(2.8, EF + 0.05);
    let interval;
    if (n === 0) interval = hard ? (firstHardDays || 3) : 5;
    else {
      const prev = Math.max(1, prevIntervalDays || 1);
      const mult = hard ? Math.max(1.2, EF * 0.5) : EF * 0.85;
      interval = Math.max(prev + 1, Math.round(prev * mult));
    }
    return { n: n + 1, EF: nextEF, intervalDays: Math.min(interval, MAX_INTERVAL_DAYS) };
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
  // Limite diário POR LISTA (list.dailyLimit; vazio = padrão). Conta tudo que já foi
  // revisado hoje nessa lista; o que passar do limite fica para os próximos dias,
  // errados primeiro. Na 1ª vez a lista toda é feita (sem limite).
  const SESSION_MAX = 10;
  const dailyLimit = (list) => Math.max(1, parseInt(list.dailyLimit, 10) || SESSION_MAX);
  const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const startOfTomorrow = (ms) => { const d = new Date(ms); d.setHours(24, 0, 0, 0); return d.getTime(); };

  const keyNum = (k) => parseInt(k, 10);
  const keyLetter = (k) => (String(k).match(/[a-z]+$/i) || [''])[0].toLowerCase();
  const compareKeys = (a, b) => (keyNum(a) - keyNum(b)) || keyLetter(a).localeCompare(keyLetter(b));

  // Lê "3, 7, 23a, 23: a-b; 5-8; 22: e-g" e devolve { keys[], invalid[] }.
  // `max` é opcional (sem ele, qualquer número ≥ 1 vale).
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
        if (t.v < 1 || (max && t.v > max)) invalid.push(String(t.v));
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
    Object.keys(found).map(Number).filter((n) => n >= 1 && (!max || n <= max)).forEach((n) => {
      const e = found[n];
      if (e.whole || !e.letters.size) keys.push(String(n));
      else e.letters.forEach((l) => keys.push(n + l));
    });
    return { keys: keys.sort(compareKeys), invalid: Array.from(new Set(invalid)) };
  }

  // Cadastro rápido com gabarito: "1-5; 7; 9a-c; 1a: 3; 2c: 14; 6: ; 8a".
  // Cada bloco vai até ";" ou quebra de linha; "N: texto" é a resposta, e
  // "N;" / "N: ;" (sem texto) cadastra o exercício sem gabarito.
  function parseExerciseEntries(text, max) {
    const byKey = new Map();
    const invalid = [];
    String(text || '').split(/[;\n]+/).forEach((chunk) => {
      if (!chunk.trim()) return;
      const sep = /[:=]/.exec(chunk);
      const left = sep ? chunk.slice(0, sep.index) : chunk;
      const answer = sep ? chunk.slice(sep.index + 1).trim().slice(0, 200) : '';
      const r = parseExerciseKeys(left, max);
      r.invalid.forEach((x) => invalid.push(x));
      if (!r.keys.length) {
        if (!r.invalid.length) invalid.push(chunk.trim().slice(0, 20));
        return;
      }
      r.keys.forEach((k) => {
        const found = byKey.get(k);
        if (!found) byKey.set(k, { key: k, answer: answer });
        else if (answer) found.answer = answer;
      });
    });
    return {
      entries: Array.from(byKey.values()).sort((a, b) => compareKeys(a.key, b.key)),
      invalid: Array.from(new Set(invalid)),
    };
  }

  // Os exercícios da lista são os que VOCÊ cadastrou (list.keys), em qualquer ordem e
  // com buracos (pulou o 4? é só não cadastrar). Não existe "quantos exercícios a lista
  // tem". Sempre devolve um array ordenado (vazio = lista sem exercícios ainda).
  // Listas antigas (sem list.keys) são lidas do jeito que eram: "Quais revisar"
  // (list.reviewPick, ex.: "1: a; 3; 11: b, c") ou, sem isso, de 1 até list.total.
  function listScope(list) {
    if (Array.isArray(list.keys)) return list.keys.map(String).sort(compareKeys);
    const txt = String(list.reviewPick || '');
    if (txt.trim() && !/[a-zA-Z]{2,}/.test(txt)) {
      const keys = parseExerciseKeys(txt, Infinity).keys;
      if (keys.length) return keys;
    }
    const total = parseInt(list.total, 10) || 0;
    return Array.from({ length: total }, (_, i) => String(i + 1));
  }

  // "1, 2, 3, 4, 7, 9a" => "1–4, 7, 9a" (para mostrar no cartão).
  function formatKeys(keys) {
    const ks = keys.slice().sort(compareKeys);
    const whole = (k) => !/[a-z]$/i.test(k);
    const out = [];
    for (let i = 0; i < ks.length;) {
      if (!whole(ks[i])) { out.push(ks[i]); i++; continue; }
      let j = i;
      while (j + 1 < ks.length && whole(ks[j + 1]) && keyNum(ks[j + 1]) === keyNum(ks[j]) + 1) j++;
      out.push(j - i >= 2 ? `${ks[i]}–${ks[j]}` : ks.slice(i, j + 1).join(', '));
      i = j + 1;
    }
    return out.join(', ');
  }

  // Listas antigas sem estado por exercício só permitem recuperar o resultado
  // da revisão mais recente. Não usar list.n (revisões da lista) como acertos
  // de cada exercício: isso faria exercícios parecerem mais dominados do que são.

  // Item com intervalo/vencimento além do teto (dado antigo ou corrompido) é
  // trazido de volta ao teto. Não altera o objeto original.
  function clampItems(items) {
    const out = {};
    Object.keys(items).forEach((k) => {
      const it = items[k];
      const base = it.lastReviewedAt || 0;
      const limit = base ? base + MAX_INTERVAL_DAYS * MS_PER_DAY : Infinity;
      const bad = (it.intervalDays || 0) > MAX_INTERVAL_DAYS || (it.nextReviewAt || 0) > limit;
      out[k] = bad
        ? Object.assign({}, it, {
            intervalDays: Math.min(it.intervalDays || 1, MAX_INTERVAL_DAYS),
            nextReviewAt: Math.min(it.nextReviewAt, limit),
          })
        : it;
    });
    return out;
  }

  function listItems(list) {
    if (list.items) return clampItems(list.items);
    const items = {};
    const last = (list.history || []).slice(-1)[0];
    // listas muito antigas podem não ter lastReviewedAt; o histórico sabe quando foi
    const reviewedAt = list.lastReviewedAt || (last && last.at) || 0;
    if (last && reviewedAt) {
      const done = last.total || parseInt(list.total, 10) || Infinity;
      const wrong = (last.wrong || []).map(String);
      const universe = listScope(list).filter((k) => keyNum(k) <= done);
      const hard = new Set((last.hardKeys || []).map(String));
      for (const key of universe) {
        const wasWrong = wrong.includes(key) || wrong.includes(String(keyNum(key)));
        const wasHard = !wasWrong && (hard.has(key) || hard.has(String(keyNum(key))));
        const quality = wasWrong ? 1 : wasHard ? 3 : 5;
        const step = sm2Step(0, 2.5, 1, quality, 2);
        const days = wasWrong ? 1 : wasHard ? 2 : step.intervalDays;
        items[key] = {
          n: wasWrong ? 0 : 1, EF: step.EF, intervalDays: days,
          lastReviewedAt: reviewedAt, nextReviewAt: reviewedAt + days * MS_PER_DAY,
          lapses: wasWrong ? 1 : 0,
          history: [{ at: reviewedAt, result: wasWrong ? 'wrong' : wasHard ? 'hard' : 'easy', intervalDays: days }],
        };
      }
    }
    return items;
  }

  // O que fazer agora numa lista: vencidos + nunca feitos, errados primeiro.
  //  all   = tudo que está pendente, na ordem de prioridade
  //  today = só o que cabe no limite diário da lista (ou todos, se expand)
  //  first = true quando a lista nunca foi revisada (faz tudo que cadastrou)
  function listDue(list, now, expand) {
    now = now || Date.now();
    const scope = listScope(list);
    const all0 = listItems(list);
    // Só conta o que está cadastrado na lista (o resto do histórico fica guardado).
    const items = {};
    Object.keys(all0).forEach((k) => { if (scope.includes(k)) items[k] = all0[k]; });
    const keys = Object.keys(items);
    const first = keys.length === 0;           // nunca revisada
    const due = keys.filter((k) => items[k].nextReviewAt <= now);
    // exercícios cadastrados que nunca foram feitos (inclui os adicionados depois)
    const untouched = scope.filter((k) => !items[k]);
    const prio = (k) => (items[k] ? (items[k].n === 0 ? 0 : 1) : 2);
    const all = due.concat(untouched).sort((a, b) => (prio(a) - prio(b))
      || ((items[a] ? items[a].nextReviewAt : 0) - (items[b] ? items[b].nextReviewAt : 0)) || compareKeys(a, b));
    // Nada vencido (abriu antes da hora): adianta os que vencem primeiro.
    const early = !first && all.length === 0;
    if (early) keys.sort((a, b) => items[a].nextReviewAt - items[b].nextReviewAt || compareKeys(a, b)).forEach((k) => all.push(k));
    const lapsed = all.filter((k) => items[k] && items[k].n === 0 && items[k].nextReviewAt <= now);
    // Na 1ª vez faz tudo; depois, respeita o limite diário da lista (o que já foi
    // revisado hoje conta). Aberta antes da hora (early), mostra até o limite.
    // A seleção segue a prioridade (errados primeiro), mas a exibição fica em ordem
    // numérica e, dentro do mesmo número, alfabética: 1, 1a, 2c, 11b, 11c, 26e…
    const limit = dailyLimit(list);
    const t0 = startOfDay(now);
    const doneToday = keys.filter((k) => (items[k].lastReviewedAt || 0) >= t0).length;
    const quota = Math.max(0, limit - doneToday);
    const pick = (expand || first) ? all : (early ? all.slice(0, limit) : all.slice(0, quota));
    const today = pick.slice().sort(compareKeys);
    return { first, early, scope, all, lapsed, today, items, limit, doneToday, quota };
  }

  // Rótulo do exercício: "23a" fica "23a"; o resto do 23 vira "23 (restante)".
  function keyLabel(key, items) {
    if (/[a-z]$/i.test(key)) return key;
    const hasParts = Object.keys(items || {}).some((k) => keyNum(k) === keyNum(key) && /[a-z]$/i.test(k));
    return hasParts ? `${key} (restante)` : key;
  }

  // Fecha uma sessão: `session` = { keys[] (o que estava na sessão), wrong[], hardKeys[] }
  //  - wrong: errou -> volta amanhã
  //  - hardKeys: acertou, mas com dificuldade -> 2 dias
  //  - o resto da sessão: acertou tranquilo -> 5 dias
  // (session.hard === true, do formato antigo, vale para todos os acertos.)
  // Espalha o vencimento: dentro de uma folga de ~15% do intervalo (5 dias => 4 a 6),
  // escolhe o dia com menos exercícios já agendados; empate fica no mais próximo do
  // intervalo calculado. Intervalos curtos (< 4 dias: erro = 1, difícil = 2) não mexem.
  function spreadDays(base, load) {
    if (base < 4) return base;
    const w = Math.max(1, Math.round(base * 0.15));
    let best = base, bestLoad = load[base] || 0;
    for (let off = 1; off <= w; off++) {
      for (const d of [base - off, base + off]) {
        if (d < 2 || d > MAX_INTERVAL_DAYS) continue;
        const l = load[d] || 0;
        if (l < bestLoad) { best = d; bestLoad = l; }
      }
    }
    return best;
  }

  function applyListSession(list, session) {
    const now = Date.now();
    const items = Object.assign({}, listItems(list));
    const wrong = session.wrong.slice();
    const wrongNums = new Set(wrong.filter((k) => !/[a-z]$/i.test(k)).map(keyNum));
    const hardKeys = (session.hardKeys || []).map(String);
    const hardNums = new Set(hardKeys.filter((k) => !/[a-z]$/i.test(k)).map(keyNum));
    const isHard = (k) => session.hard === true || hardKeys.includes(k) || hardNums.has(keyNum(k));
    const reviewed = new Set(session.keys);
    wrong.forEach((k) => reviewed.add(k)); // "23a" pode não estar na sessão ainda
    hardKeys.forEach((k) => reviewed.add(k));
    // errou o exercício inteiro: os itens soltos dele (23a…) são redundantes
    const targets = Array.from(reviewed).filter((k) => !(/[a-z]$/i.test(k) && wrongNums.has(keyNum(k))));
    // Carga por dia (dias a partir de hoje) dos exercícios que NÃO estão sendo reagendados
    // agora: serve para espalhar os vencimentos em vez de empilhar tudo no mesmo dia.
    const scope = listScope(list);
    const load = {};
    Object.keys(items).forEach((k) => {
      if (targets.includes(k) || !scope.includes(k)) return;
      const day = calendarDayDiff(items[k].nextReviewAt, now);
      load[day] = (load[day] || 0) + 1;
    });
    let right = 0, hardCount = 0;
    targets.slice().sort(compareKeys).forEach((k) => {
      const it = items[k] || { n: 0, EF: 2.5, intervalDays: 0, lapses: 0 };
      const isWrong = wrong.includes(k);
      const hard = !isWrong && isHard(k);
      const step = sm2Step(it.n || 0, it.EF || 2.5, it.intervalDays || 1, isWrong ? 1 : (hard ? 3 : 5), 2);
      if (!isWrong) right += 1;
      if (hard) hardCount += 1;
      const days = isWrong ? step.intervalDays : spreadDays(step.intervalDays, load);
      load[days] = (load[days] || 0) + 1;
      items[k] = {
        n: step.n, EF: step.EF, intervalDays: days,
        lastReviewedAt: now, nextReviewAt: now + days * MS_PER_DAY,
        lapses: (it.lapses || 0) + (isWrong ? 1 : 0),
        history: (it.history || []).concat([{ at: now, result: isWrong ? 'wrong' : hard ? 'hard' : 'easy', quality: isWrong ? 1 : hard ? 3 : 5, intervalDays: days }]),
      };
    });
    Object.keys(items).forEach((k) => { if (/[a-z]$/i.test(k) && wrongNums.has(keyNum(k)) && !targets.includes(k)) delete items[k]; });
    const entry = {
      at: now, correct: right, total: right + wrong.length, wrong: wrong.slice().sort(compareKeys),
      hardKeys: hardKeys.length ? hardKeys.slice().sort(compareKeys) : undefined,
      hard: hardCount > 0 || undefined,
      result: wrong.length === 0 ? (hardCount > 0 ? 'hard' : 'easy') : (wrong.length > (right + wrong.length) / 2 ? 'wrong' : 'hard'),
    };
    const next = Object.assign({}, list, { items, progress: null, lastReviewedAt: now, history: (list.history || []).concat([entry]) });
    next.n = next.history.length;
    next.nextReviewAt = listNextAt(next, now);
    next.intervalDays = Math.max(1, calendarDayDiff(next.nextReviewAt, now));
    return next;
  }

  // Quando a lista vence: o MENOR vencimento entre os exercícios que contam hoje
  // (os cadastrados na lista), ou agora se sobrou exercício nunca feito.
  // É calculado a partir dos exercícios, nunca copiado de um valor antigo: antes,
  // exercícios fora do escopo (ou que não entraram na sessão de 10) com vencimento
  // velho puxavam a lista para "Atrasada 11d" mesmo sem nada vencido ao abrir.
  function listNextAt(list, now) {
    now = now || Date.now();
    const scope = listScope(list);
    if (!scope.length) return 0; // lista sem exercícios: nada a revisar (0 = sem data)
    const items = listItems(list);
    const keys = Object.keys(items).filter((k) => scope.includes(k));
    if (!keys.length) return list.nextReviewAt || now; // nunca revisada
    const d = listDue(list, now);
    // Tem coisa vencida/nunca feita, mas o limite de hoje já foi usado: só amanhã.
    if (d.all.length && !d.early && !d.today.length) return startOfTomorrow(now);
    if (d.all.some((k) => !d.items[k])) return now; // ainda há exercício nunca feito
    return Math.min.apply(null, keys.map((k) => items[k].nextReviewAt));
  }

  // ---------- GABARITO POR EXERCÍCIO ----------
  // list.answers = { "1": "C", "3a": "12" }, mesma chave dos exercícios. Vale para
  // qualquer exercício com resposta preenchida, esteja ele em revisão ou não.
  function visibleAnswers(list) {
    const out = {};
    Object.keys(list.answers || {}).forEach((k) => {
      if (String(list.answers[k]).trim()) out[k] = list.answers[k];
    });
    return out;
  }

  // Lê "1: C; 2: 42; 3a: Falso; 3b: 0,5" (separador ";" ou quebra de linha).
  function parseAnswers(text, max) {
    const answers = {}, invalid = [];
    String(text || '').split(/[;\n]+/).forEach((chunk) => {
      if (!chunk.trim()) return;
      const m = /^\s*(\d+)\s*[.)\-]?\s*([a-zA-Z])?\s*[:=]\s*([\s\S]*)$/.exec(chunk);
      if (!m) { invalid.push(chunk.trim().slice(0, 20)); return; }
      const n = parseInt(m[1], 10);
      if (n < 1 || (max && n > max)) { invalid.push(m[1] + (m[2] || '')); return; }
      const val = m[3].trim().slice(0, 200);
      if (val) answers[n + (m[2] ? m[2].toLowerCase() : '')] = val;
    });
    return { answers, invalid };
  }

  function serializeAnswers(answers) {
    return Object.keys(answers || {}).filter((k) => String(answers[k]).trim()).sort(compareKeys)
      .map((k) => `${k}: ${answers[k]}`).join('; ');
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
      lists: state.exerciseLists.filter((l) => l.subject === subject && listNextAt(l, now) && listNextAt(l, now) <= now).length,
      questions: state.questionBank.filter((q) => !q.retired && due(q)).length,
    };
  }

  // Fila de hoje (listas + questões vencidas), misturada entre matérias.
  function reviewQueue(state, now) {
    now = now || Date.now();
    const lists = state.exerciseLists.map((x) => ({ kind: 'list', id: x.id, subject: x.subject, nextReviewAt: listNextAt(x, now) }));
    const qs = state.questionBank.filter((q) => !q.retired).map((x) => ({ kind: 'question', id: x.id, subject: x.subject, nextReviewAt: x.nextReviewAt }));
    return interleaveBySubject(lists.concat(qs).filter((x) => x.nextReviewAt && x.nextReviewAt <= now)
      .sort((a, b) => a.nextReviewAt - b.nextReviewAt));
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
    SESSION_MAX, dailyLimit, MAX_INTERVAL_DAYS, parseExerciseKeys, parseExerciseEntries, listScope, formatKeys, listItems, listDue, listNextAt, keyLabel, compareKeys,
    visibleAnswers, parseAnswers, serializeAnswers,
    interleaveBySubject, reviewQueue, pendingReviews, calendarDayDiff, formatDate,
  });
})();
