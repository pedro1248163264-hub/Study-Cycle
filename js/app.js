/* =========================================================
   Study Cycle — app logic

   Allocation: each subject's weekly hours are its share of the total
   weekly hours, proportional to (difficulty + content + importance),
   rounded half-up. Subjects below the configured minimum are bumped
   up to it — the total can end up a little over the weekly target
   when that happens, which is expected.

   Sequence: a greedy "always study whichever subject currently has
   the most hours left, but never the same one twice in a row unless
   it's the only one left" algorithm. This naturally spaces subjects
   out instead of grouping all of one subject's hours together.
   ========================================================= */

(function () {
  'use strict';

  // ---------- INDEXEDDB PERSISTENCE ----------
  const DB_NAME = 'StudyCycleDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'app';
  const STATE_KEY = 'appState';

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Fields that make up the "syncable" data blob — everything that should
  // travel between devices. Kept as a helper so save/load/sync all agree
  // on exactly what's included.
  function pickSyncableData(s) {
    return {
      subjects: s.subjects,
      settings: s.settings,
      studyCounter: s.studyCounter,
      studyLogs: s.studyLogs,
      errorLogs: s.errorLogs,
      topicReviews: s.topicReviews,
      questionBank: s.questionBank,
      isDark: s.isDark,
    };
  }

  function saveState(s, opts) {
    opts = opts || {};
    // Any local change bumps lastModifiedAt, which is what the sync button
    // compares against the server's timestamp. Callers that are applying
    // data *from* a sync (not a fresh local edit) pass skipTouch so pulling
    // doesn't immediately look like a new unsynced change.
    if (!opts.skipTouch) {
      s.lastModifiedAt = Date.now();
    }
    const data = Object.assign(pickSyncableData(s), {
      lastModifiedAt: s.lastModifiedAt,
      lastSyncedAt: s.lastSyncedAt,
    });
    openDatabase().then(db => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(data, STATE_KEY);
    }).catch(() => {});
    if (!opts.skipStatusRender) renderSyncStatus();
  }

  function loadState() {
    return openDatabase().then(db => {
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(STATE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    }).catch(() => null);
  }

  // ---------- CLOUD SYNC (Supabase) ----------
  // No login screen, but not wide open either: every device shares one
  // fixed row (SYNC_KEY) in `app_state`, and that table is locked down on
  // the database side — the only way in is through two RPC functions
  // (get_app_state / set_app_state) that check a passcode you set, hashed
  // in Postgres. The "anon key" below is safe to expose in frontend code;
  // it's just an identifier, not the thing that grants access.
  const SUPABASE_URL = 'https://rhipgkcoacrarablillj.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJoaXBna2NvYWNyYXJhYmxpbGxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NzM4MjIsImV4cCI6MjEwMzQ0OTgyMn0.WfPALUnfcrwvibkb39cWh1_Vj-UdMm7lgFgiWj0u-5w';
  const SYNC_CODE_STORAGE_KEY = 'studyCycleSyncCode'; // per-device, never synced

  function supabaseHeaders(extra) {
    return Object.assign({
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    }, extra || {});
  }

  function callRpc(fnName, params) {
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + fnName, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify(params),
    }).then(res => {
      if (res.ok) return res.status === 204 ? null : res.json();
      return res.json().catch(() => null).then(body => {
        const msg = (body && (body.message || body.hint)) || ('HTTP ' + res.status);
        const err = new Error(msg);
        err.isInvalidCode = /invalid code/i.test(msg);
        err.isCodeAlreadySet = /code already set/i.test(msg);
        throw err;
      });
    });
  }

  function getSyncCode() {
    return localStorage.getItem(SYNC_CODE_STORAGE_KEY) || null;
  }

  function checkSyncCodeExists() {
    return callRpc('sync_code_exists', {});
  }

  function claimSyncCode(code) {
    return callRpc('claim_sync_code', { p_code: code });
  }

  // Fetches the remote row (if any). Returns { data, updatedAtMs } or null.
  function fetchRemoteState(code) {
    return callRpc('get_app_state', { p_code: code }).then(rows => {
      if (!rows || rows.length === 0) return null;
      return { data: rows[0].data, updatedAtMs: new Date(rows[0].updated_at).getTime() };
    });
  }

  // Upserts the local data blob to the remote row, stamped with `atMs`.
  function pushLocalState(code, dataBlob, atMs) {
    return callRpc('set_app_state', {
      p_code: code,
      p_data: dataBlob,
      p_updated_at: new Date(atMs).toISOString(),
    });
  }

  // Entry point for the sync button: makes sure a passcode is set on this
  // device before doing any network work.
  function syncNow() {
    if (state.syncStatus === 'syncing') return;
    const code = getSyncCode();
    if (!code) {
      state.activeModal = 'sync-passcode';
      render();
      return;
    }
    performSync(code);
  }

  // Runs one round of sync: whichever side (local vs. remote) has the more
  // recent change wins and overwrites the other, per last-write-wins.
  function performSync(code) {
    state.syncStatus = 'syncing';
    renderSyncStatus();

    fetchRemoteState(code).then(remote => {
      const localAt = state.lastModifiedAt || 0;
      const remoteAt = remote ? remote.updatedAtMs : 0;

      if (remote && remoteAt > localAt) {
        // Remote is newer — pull it down and apply to local state/IndexedDB.
        const rd = remote.data || {};
        if (Array.isArray(rd.subjects)) state.subjects = rd.subjects;
        if (rd.settings) state.settings = Object.assign({}, INITIAL_SETTINGS, rd.settings);
        if (typeof rd.studyCounter === 'number') state.studyCounter = rd.studyCounter;
        if (Array.isArray(rd.studyLogs)) state.studyLogs = rd.studyLogs;
        if (Array.isArray(rd.errorLogs)) state.errorLogs = rd.errorLogs;
        if (Array.isArray(rd.topicReviews)) state.topicReviews = rd.topicReviews;
        if (Array.isArray(rd.questionBank)) state.questionBank = rd.questionBank;
        if (typeof rd.isDark === 'boolean') state.isDark = rd.isDark;
        state.subjects = state.subjects.map(s => Object.assign({ lastStudiedAt: 0 }, s));

        state.lastModifiedAt = remoteAt;
        state.lastSyncedAt = Date.now();
        saveState(state, { skipTouch: true, skipStatusRender: true });

        document.documentElement.classList.toggle('dark', state.isDark);
        document.querySelector('.icon-moon').style.display = state.isDark ? 'none' : '';
        document.querySelector('.icon-sun').style.display = state.isDark ? '' : 'none';

        state.syncStatus = 'synced';
        state.syncDirection = 'pulled';
        render();
      } else {
        // Local is newer (or nothing remote yet) — push it up.
        const now = Date.now();
        return pushLocalState(code, pickSyncableData(state), now).then(() => {
          state.lastModifiedAt = now;
          state.lastSyncedAt = now;
          saveState(state, { skipTouch: true, skipStatusRender: true });
          state.syncStatus = 'synced';
          state.syncDirection = 'pushed';
          renderSyncStatus();
        });
      }
    }).catch(err => {
      if (err && err.isInvalidCode) {
        // Wrong passcode saved on this device — forget it and ask again.
        localStorage.removeItem(SYNC_CODE_STORAGE_KEY);
        state.syncStatus = 'error';
        state.syncError = 'Senha incorreta. Digite novamente.';
        state.activeModal = 'sync-passcode';
        render();
        return;
      }
      state.syncStatus = 'error';
      state.syncError = (err && err.message) || 'Erro de conexão';
      renderSyncStatus();
    });
  }

  function formatSyncTime(ms) {
    if (!ms) return null;
    const d = new Date(ms);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  // Updates only the header sync button + status line, without touching
  // the rest of the screen — cheap enough to call after every local edit.
  function renderSyncStatus() {
    const btn = document.getElementById('sync-btn');
    const dot = document.getElementById('sync-dot');
    const statusEl = document.getElementById('sync-status');
    if (!btn || !statusEl) return;

    const hasPending = (state.lastModifiedAt || 0) > (state.lastSyncedAt || 0);
    btn.classList.toggle('is-syncing', state.syncStatus === 'syncing');
    dot.hidden = !hasPending || state.syncStatus === 'syncing';

    statusEl.classList.toggle('is-error', state.syncStatus === 'error');

    if (state.syncStatus === 'syncing') {
      statusEl.innerHTML = `${ICONS.refreshCw}Sincronizando…`;
    } else if (state.syncStatus === 'error') {
      statusEl.innerHTML = `${ICONS.cloudOff}Erro ao sincronizar: ${esc(state.syncError || '')}`;
    } else if (state.lastSyncedAt) {
      const time = formatSyncTime(state.lastSyncedAt);
      const dirLabel = state.syncDirection === 'pulled' ? ' (dados recebidos)' : state.syncDirection === 'pushed' ? ' (dados enviados)' : '';
      statusEl.innerHTML = hasPending
        ? `${ICONS.refreshCw}Última sincronização às ${time}${dirLabel} · há alterações não sincronizadas`
        : `${ICONS.refreshCw}Sincronizado às ${time}${dirLabel}`;
    } else {
      statusEl.innerHTML = `${ICONS.refreshCw}Ainda não sincronizado neste aparelho`;
    }
  }

  // ---------- INITIAL DATA ----------
  const INITIAL_SUBJECTS = [];
  const INITIAL_SETTINGS = {
    weeklyHours: 0,
    minHoursPerSubject: 1,
    // Quantas horas seguidas de uma mesma matéria o ciclo tenta manter
    // antes de trocar para outra. 1 = comportamento clássico (nunca
    // repete a matéria no bloco seguinte, a não ser que seja forçado).
    streakHours: 1,
    // Regra opcional de diversidade: dentro de uma faixa de `windowHours`
    // horas seguidas, no máximo `maxSubjectsPerWindow` matérias distintas
    // podem aparecer. 0 em qualquer um dos dois desativa a regra.
    windowHours: 0,
    maxSubjectsPerWindow: 0,
  };

  const STUDY_CATEGORIES = ['Book', 'Video', 'Question'];
  const STUDY_CATEGORY_LABELS = { Book: 'Livro', Video: 'Vídeo', Question: 'Questões' };

  const ERROR_TYPES = [
    'Knowledge gap',
    'Attention / careless mistake',
    'Time management',
    'Calculation',
    'Misunderstood question',
    'Forgot concept',
    'Other',
  ];
  const ERROR_TYPE_LABELS = {
    'Knowledge gap': 'Lacuna de conhecimento',
    'Attention / careless mistake': 'Desatenção / descuido',
    'Time management': 'Gestão de tempo',
    'Calculation': 'Erro de cálculo',
    'Misunderstood question': 'Interpretação errada',
    'Forgot concept': 'Esqueci o conceito',
    'Other': 'Outro',
  };
  const ERROR_TYPE_BADGE = {
    'Knowledge gap': 'error-badge-violet',
    'Attention / careless mistake': 'error-badge-amber',
    'Time management': 'error-badge-blue',
    'Calculation': 'error-badge-rose',
    'Misunderstood question': 'error-badge-orange',
    'Forgot concept': 'error-badge-fuchsia',
    'Other': 'error-badge-neutral',
  };

  // ---------- STATE ----------
  const state = {
    subjects: JSON.parse(JSON.stringify(INITIAL_SUBJECTS)),
    settings: Object.assign({}, INITIAL_SETTINGS),
    // Bumped every time the user logs time for a subject. Each subject
    // remembers the counter value from its most recent log, so ties in
    // "hours remaining" can be broken by real recency (see generateSequence).
    studyCounter: 0,
    activeModal: null,
    editingSubjectId: null,
    isDark: false,

    // --- Study Log: what am I currently studying, and where did I stop ---
    // subject (optional) links a log to a Study Cycle subject by name, so
    // clicking "Próxima matéria" can show only the material that belongs
    // to it. Category-specific fields: Book -> chapter, page.
    // Video -> episode, timestamp. Question -> exerciseNumber.
    studyLogs: [], // { id, name, subject, category, status, ...category-specific fields }
    editingLogId: null,
    studyLogTab: 'active', // 'active' | 'completed'
    studyLogFilterSubject: '',
    studyLogFilterCategory: '',
    prefillLogSubject: null, // pre-fills the subject when adding a log from the "next material" flow
    nextMaterialSubject: null, // which subject's active logs the "next material" modal is showing

    // --- Error Log: what did I get wrong, and why ---
    errorLogs: [], // { id, subject, topic, description, errorType }
    editingErrorId: null,
    errorFilterSubject: '',
    errorFilterType: '',

    // --- Question Review: spaced repetition engine (SM-2 based) ---
    // Two independent "motors" sharing the same interval recurrence (sm2Step):
    // topicReviews = aggregate rounds of practice on a subject+topic combo.
    // questionBank = individual bookmarked questions (image and/or text),
    // graded one at a time when redone. See the SPACED REPETITION ENGINE
    // section below for the algorithm itself.
    topicReviews: [], // { id, subject, topic, n, EF, intervalDays, lastReviewedAt, nextReviewAt, totalRounds, history[] }
    questionBank: [], // { id, subject, topic, statementText, imageData, answerKey, createdAt, n, EF, intervalDays, lastReviewedAt, nextReviewAt, retired, history[] }
    reviewTab: 'today', // 'today' | 'topics' | 'questions'
    questionSubTab: 'active', // 'active' | 'graduated'
    reviewFilterSubjectTopics: '',
    reviewFilterSubjectQuestions: '',
    roundPrefillSubject: null, // pre-fills "Registrar rodada" when opened from a queue/topic card
    roundPrefillTopic: null,
    redoingQuestionId: null, // which question the "redo" modal is grading
    answerRevealed: false, // whether the gabarito is shown in the "redo" modal (starts hidden, so you self-test first)

    // --- Navigation (Study Cycle is untouched; these are additive screens) ---
    screen: 'dashboard', // 'dashboard' | 'study-log' | 'error-log' | 'question-review'

    // --- Cloud sync (manual, last-write-wins) ---
    lastModifiedAt: 0, // bumped on every local change; compared against the server's updated_at
    lastSyncedAt: 0,   // when this device last successfully synced (pulled or pushed)
    syncStatus: 'idle', // 'idle' | 'syncing' | 'synced' | 'error'
    syncDirection: null, // 'pulled' | 'pushed' — for the status line, purely informational
    syncError: null,
  };

  // ---------- HELPERS ----------

  // Splits the weekly hours across subjects proportionally to how "needy"
  // each one is (difficulty + content + importance — higher rating = more
  // hours), using the "largest remainder" method: each subject gets the
  // floor of its exact share, then the leftover hours (weeklyHours minus
  // the sum of those floors) go one-by-one to the subjects with the
  // biggest fractional remainder. This guarantees the shares always add
  // up to exactly weeklyHours — unlike rounding each share independently,
  // which can silently lose or gain an hour to rounding. If a subject's
  // share still falls below the configured minimum, it's bumped up to
  // that minimum — which can push the overall total a little past the
  // weekly hours target, and that's expected.
  function calculateAllocations(subjects, settings) {
    const totalWeight = subjects.reduce((sum, s) => sum + (s.difficulty + s.content + s.importance), 0);

    if (totalWeight <= 0) {
      return subjects.map(s => Object.assign({}, s, { allocated: settings.minHoursPerSubject }));
    }

    const shares = subjects.map(s => {
      const weight = s.difficulty + s.content + s.importance;
      const exact = settings.weeklyHours * (weight / totalWeight);
      const floor = Math.floor(exact);
      return { subject: s, floor, remainder: exact - floor };
    });

    const flooredTotal = shares.reduce((sum, sh) => sum + sh.floor, 0);
    const leftover = Math.max(0, Math.round(settings.weeklyHours) - flooredTotal);

    const bumpIndices = shares
      .map((sh, i) => i)
      .sort((a, b) => shares[b].remainder - shares[a].remainder)
      .slice(0, leftover);
    const bumpSet = new Set(bumpIndices);

    return shares.map((sh, i) => {
      const naturalShare = sh.floor + (bumpSet.has(i) ? 1 : 0);
      const allocated = Math.max(naturalShare, settings.minHoursPerSubject);
      return Object.assign({}, sh.subject, { allocated });
    });
  }

  // Builds the suggested study order: at each new "block", picks the
  // subject with the most hours left (ties go to whoever's gone longest
  // without being studied in real life), and then sticks with that same
  // subject for up to `streakHours` hours in a row before switching —
  // never repeating a subject right after its own block finishes, unless
  // it's the only one left with hours remaining. With streakHours = 1
  // this is exactly the old behaviour: never the same subject twice in a
  // row.
  //
  // Optionally, a diversity rule can also apply: within any window of
  // `windowHours` consecutive hours, at most `maxSubjectsPerWindow`
  // distinct subjects may appear (e.g. "only 2 different subjects within
  // any 6-hour stretch"). Both settings are 0/disabled unless the user
  // has turned this on. The window rule is treated as a hard constraint
  // and wins over the "switch subjects" preference. It can still be
  // impossible to fully honor right at a transition — e.g. if two
  // subjects happen to run out of hours at the same time — in which
  // case the cycle falls back to picking a different subject anyway so
  // it can keep making progress, and self-corrects a few hours later.
  function generateSequence(allocatedSubjects, settings) {
    settings = settings || {};
    const streakHours = Math.max(1, parseInt(settings.streakHours, 10) || 1);
    const windowHours = Math.max(0, parseInt(settings.windowHours, 10) || 0);
    const maxSubjectsPerWindow = Math.max(0, parseInt(settings.maxSubjectsPerWindow, 10) || 0);
    const windowRuleActive = windowHours > 1 && maxSubjectsPerWindow > 0;

    const sequence = [];
    const pools = allocatedSubjects.map(s => ({
      id: s.id,
      name: s.name,
      colorIndex: s.colorIndex,
      remaining: Math.max(0, s.allocated - s.completedHours),
      // Higher = studied more recently in real life. 0 = never studied,
      // which makes it win any tie (most "overdue").
      recency: s.lastStudiedAt || 0,
    }));

    // Would adding `id` as a new block right now keep the last
    // `windowHours` hours (this candidate hour included) within the
    // distinct-subject limit? Continuing the subject already in progress
    // never adds a new distinct subject, so this is only ever checked
    // when starting a fresh block.
    function passesWindowRule(id) {
      if (!windowRuleActive) return true;
      const recentIds = sequence.slice(-(windowHours - 1)).map(item => item.id);
      const distinct = new Set(recentIds);
      if (distinct.has(id)) return true;
      return distinct.size < maxSubjectsPerWindow;
    }

    let lastPickedId = null;
    let streakLeft = 0; // hours left to keep studying lastPickedId
    // Local clock for this simulated run: once a subject is picked here,
    // it's treated as "just studied" for tie-breaking the rest of this
    // same sequence, without touching the subject's real recency data.
    let simClock = pools.reduce((max, p) => Math.max(max, p.recency), 0);

    while (pools.some(p => p.remaining > 0)) {
      let candidate = null;

      // Keep going with the current block's subject, if it still has
      // hours left and hasn't finished its streak yet.
      if (streakLeft > 0 && lastPickedId !== null) {
        const current = pools.find(p => p.id === lastPickedId && p.remaining > 0);
        if (current) candidate = current;
      }

      if (!candidate) {
        pools.sort((a, b) => {
          if (b.remaining !== a.remaining) return b.remaining - a.remaining;
          return a.recency - b.recency; // tie: longest-waiting subject goes first
        });
        const available = pools.filter(p => p.remaining > 0);

        // Preference order: a different subject that also satisfies the
        // window rule (the ideal case) > any subject, possibly even the
        // one just finished, that at least keeps the window rule intact
        // (the window rule is a hard user constraint, so it outranks the
        // "switch subjects" preference) > a different subject regardless
        // of the window rule (variety wins if the window rule genuinely
        // can't be satisfied by anyone) > whatever's left, as a last
        // resort.
        candidate = available.find(p => p.id !== lastPickedId && passesWindowRule(p.id))
          || available.find(p => passesWindowRule(p.id))
          || available.find(p => p.id !== lastPickedId)
          || available[0]
          || null;

        streakLeft = streakHours; // fresh block starts now
      }

      if (candidate) {
        sequence.push({ id: candidate.id, name: candidate.name, colorIndex: candidate.colorIndex });
        candidate.remaining -= 1;
        simClock += 1;
        candidate.recency = simClock;
        lastPickedId = candidate.id;
        streakLeft -= 1;
      } else {
        break; // safety net; shouldn't happen while some pool still has hours
      }
    }

    return sequence;
  }

  function uid() {
    return Math.random().toString(36).substr(2, 9);
  }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ---------- SPACED REPETITION ENGINE (Question Review) ----------
  // Two "motors" — Tópico (rodadas agregadas) e Questão (bookmark individual)
  // — share the exact same interval recurrence: the classic SM-2 formula
  // (Wozniak, 1987). What differs is only how the 0-5 "quality" grade fed
  // into it is derived:
  //   - Tópico: combina a taxa de erro do lote + a dificuldade que você
  //     sentiu, porque nenhuma das duas sozinha é confiável.
  //   - Questão: vem direto de 3 botões ao refazer (Errei / Difícil / Fácil).
  // Rounds do dia da aquisição (Camada 1, fixação) nunca devem alimentar
  // esse motor — só rodadas de dias depois, porque "overlearning" no mesmo
  // dia não prediz retenção real. Isso é decisão de uso, não travado no
  // código (é só não clicar em "Registrar rodada" na fixação do dia 1).
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const MAX_INTERVAL_DAYS = 90; // trava prática: nunca deixa algo sumir por >~3 meses num ciclo ativo de vestibular
  const GRADUATE_AFTER_N = 4;   // nº de acertos seguidos até uma questão "graduar" e sair da fila ativa
  const REDO_QUALITY = { wrong: 1, hard: 3, easy: 5 };

  // The classic SM-2 recurrence itself — identical for both motors.
  function sm2Step(n, EF, prevIntervalDays, quality) {
    let interval, nextN;
    if (quality >= 3) {
      if (n === 0) interval = 1;
      else if (n === 1) interval = 6;
      else interval = Math.round(prevIntervalDays * EF);
      nextN = n + 1;
    } else {
      nextN = 0;
      interval = 1;
    }
    let nextEF = EF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (nextEF < 1.3) nextEF = 1.3;
    return { n: nextN, EF: nextEF, intervalDays: Math.min(interval, MAX_INTERVAL_DAYS) };
  }

  // % de erro no lote -> nota 0-5 (0% erro = 5, 100% erro = 0, linear).
  function errorRateToQuality(rate) {
    const q = Math.round(5 - rate * 5);
    return Math.max(0, Math.min(5, q));
  }

  // Combina a taxa de erro automática com a dificuldade sentida (1-5,
  // mesma escala 0-5 do SM-2) que o usuário informa.
  function combinedQuality(errorRate, feltDifficulty) {
    return Math.round((errorRateToQuality(errorRate) + feltDifficulty) / 2);
  }

  function applyTopicRound(topic, questionsCount, wrongCount, feltDifficulty) {
    const errorRate = questionsCount > 0 ? Math.min(1, wrongCount / questionsCount) : 0;
    const quality = combinedQuality(errorRate, feltDifficulty);
    const step = sm2Step(topic.n || 0, topic.EF || 2.5, topic.intervalDays || 1, quality);
    const now = Date.now();
    return Object.assign({}, topic, {
      n: step.n,
      EF: step.EF,
      intervalDays: step.intervalDays,
      lastReviewedAt: now,
      nextReviewAt: now + step.intervalDays * MS_PER_DAY,
      totalRounds: (topic.totalRounds || 0) + 1,
      history: (topic.history || []).concat([{ at: now, questionsCount, wrongCount, feltDifficulty, quality, intervalDays: step.intervalDays }]),
    });
  }

  function applyQuestionRedo(q, result) {
    const quality = REDO_QUALITY[result];
    const step = sm2Step(q.n || 0, q.EF || 2.5, q.intervalDays || 1, quality);
    const now = Date.now();
    return Object.assign({}, q, {
      n: step.n,
      EF: step.EF,
      intervalDays: step.intervalDays,
      lastReviewedAt: now,
      nextReviewAt: now + step.intervalDays * MS_PER_DAY,
      retired: step.n >= GRADUATE_AFTER_N,
      history: (q.history || []).concat([{ at: now, result, quality, intervalDays: step.intervalDays }]),
    });
  }

  // Round-robin entre matérias: garante que a fila do dia misture matérias
  // em vez de agrupar tudo da mesma matéria em sequência — é o que a
  // pesquisa de interleaving mostra que funciona melhor do que blocar.
  function interleaveBySubject(items) {
    const groups = {};
    const order = [];
    items.forEach((it) => {
      const key = it.subject || '—';
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(it);
    });
    const result = [];
    let more = true;
    while (more) {
      more = false;
      order.forEach((key) => {
        if (groups[key].length) {
          result.push(groups[key].shift());
          more = true;
        }
      });
    }
    return result;
  }

  function efLabel(EF) {
    if (EF >= 2.3) return { text: 'Consolidado', cls: 'error-badge-green' };
    if (EF >= 1.8) return { text: 'Em progresso', cls: 'error-badge-amber' };
    return { text: 'Frágil', cls: 'error-badge-rose' };
  }

  // Diferença em DIAS DE CALENDÁRIO (meia-noite a meia-noite) entre duas
  // datas — não em blocos fixos de 24h. Usar Math.floor((a - b) / MS_PER_DAY)
  // direto nos timestamps era o bug: uma questão criada agora tem
  // nextReviewAt = now, então por poucos milissegundos (o tempo até o
  // próximo render) "now" já ficava ligeiramente no futuro e a subtração
  // dava um número negativo pertinho de zero (ex.: -0.0000006 dia) — o
  // Math.floor arredondava isso pra -1 e a questão nascia marcada como
  // "Atrasada 1d" antes mesmo de existir há um segundo. Comparando só a
  // data (ignorando a hora), hoje é sempre diffDays = 0.
  function calendarDayDiff(targetMs, fromMs) {
    const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
    return Math.round((startOfDay(targetMs) - startOfDay(fromMs)) / MS_PER_DAY);
  }

  function dueBadgeHtml(nextReviewAt) {
    if (!nextReviewAt) return '';
    const diffDays = calendarDayDiff(nextReviewAt, Date.now());
    if (diffDays < 0) return `<span class="due-badge due-badge-overdue">${ICONS.flame}Atrasada ${Math.abs(diffDays)}d</span>`;
    if (diffDays === 0) return `<span class="due-badge due-badge-today">${ICONS.flame}Hoje</span>`;
    return `<span class="due-badge due-badge-upcoming">${ICONS.clock}Em ${diffDays}d</span>`;
  }

  function formatDate(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('pt-BR');
  }

  // Redimensiona/comprime a imagem no navegador antes de guardar em base64,
  // pra não inflar o IndexedDB nem o payload de sincronização.
  function resizeImageFile(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > h && w > maxDim) { h = Math.round(h * (maxDim / w)); w = maxDim; }
          else if (h >= w && h > maxDim) { w = Math.round(w * (maxDim / h)); h = maxDim; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ---------- DERIVED STATE ----------
  function getDerived() {
    const allocatedSubjects = calculateAllocations(state.subjects, state.settings);
    const sequence = generateSequence(allocatedSubjects, state.settings);
    const totalAllocated = allocatedSubjects.reduce((sum, s) => sum + s.allocated, 0);
    const totalCompleted = state.subjects.reduce((sum, s) => sum + s.completedHours, 0);
    const overallProgress = totalAllocated > 0 ? Math.min(100, Math.round((totalCompleted / totalAllocated) * 100)) : 0;
    const isCycleComplete = totalAllocated > 0 && totalCompleted >= totalAllocated;
    const nextStudy = sequence.length > 0 ? sequence[0] : null;

    return { allocatedSubjects, sequence, totalAllocated, totalCompleted, overallProgress, isCycleComplete, nextStudy };
  }

  // ---------- RENDER ----------
  function render() {
    const d = getDerived();
    renderNav();
    renderSyncStatus();

    document.getElementById('screen-dashboard').style.display = state.screen === 'dashboard' ? '' : 'none';
    document.getElementById('screen-study-log').style.display = state.screen === 'study-log' ? '' : 'none';
    document.getElementById('screen-error-log').style.display = state.screen === 'error-log' ? '' : 'none';
    document.getElementById('screen-question-review').style.display = state.screen === 'question-review' ? '' : 'none';

    if (state.screen === 'dashboard') {
      // --- Study Cycle: existing, finished feature — logic untouched ---
      renderCycleOverview(d);
      renderSequence(d);
      renderSubjects(d);
    } else if (state.screen === 'study-log') {
      renderStudyLogScreen();
    } else if (state.screen === 'error-log') {
      renderErrorLogScreen();
    } else if (state.screen === 'question-review') {
      renderQuestionReviewScreen();
    }

    renderModal(d);
  }

  function renderNav() {
    const NAV_ITEMS = [
      { key: 'dashboard', label: 'Study Cycle', icon: ICONS.layoutDashboard },
      { key: 'study-log', label: 'Study Log', icon: ICONS.bookMarked },
      { key: 'error-log', label: 'Error Log', icon: ICONS.alertTriangle },
      { key: 'question-review', label: 'Revisão', icon: ICONS.repeat },
    ];
    document.getElementById('nav-tabs').innerHTML = NAV_ITEMS.map(item => `
      <button type="button" class="nav-tab${state.screen === item.key ? ' active' : ''}" data-action="switch-screen" data-screen="${item.key}">
        ${item.icon}
        ${esc(item.label)}
      </button>`).join('');
  }

  function renderCycleOverview(d) {
    document.getElementById('total-completed').textContent = d.totalCompleted;
    document.getElementById('total-weekly').textContent = d.totalAllocated;
    document.getElementById('overall-progress').style.width = d.overallProgress + '%';

    const actions = document.getElementById('cycle-actions');
    if (d.isCycleComplete) {
      actions.innerHTML = `
        <button type="button" class="btn btn-primary" data-action="reset-cycle">
          ${ICONS.rotateCcw.replace('class="icon"', 'class="icon icon-sm"')}
          Reiniciar ciclo
        </button>`;
    } else {
      actions.innerHTML = `
        <button type="button" class="btn btn-primary" data-action="open-log-time">
          ${ICONS.clock.replace('class="icon"', 'class="icon icon-sm"')}
          Registrar tempo
        </button>`;
    }
  }

  function renderSequence(d) {
    const section = document.getElementById('sequence-section');
    const card = document.getElementById('sequence-card');

    if (d.isCycleComplete) {
      section.style.display = 'none';
      return;
    }
    section.style.display = '';

    if (!d.nextStudy) {
      card.innerHTML = `
        <div class="sequence-empty">
          ${ICONS.checkCircle}
          <p class="sequence-empty-title">${d.allocatedSubjects.length === 0 ? 'Adicione matérias para começar' : 'Tudo em dia!'}</p>
          <p class="sequence-empty-sub">${d.allocatedSubjects.length === 0 ? 'Defina suas matérias e configurações para gerar a sequência.' : 'Registre mais tempo ou reinicie o ciclo.'}</p>
        </div>`;
      return;
    }

    const rest = d.sequence.slice(1, 10);
    let restHtml = '';
    rest.forEach((seq, idx) => {
      restHtml += `<div class="sequence-chip subject-color-${seq.colorIndex}">${esc(seq.name)}</div>`;
      if (idx < Math.min(d.sequence.length - 2, 8)) {
        restHtml += `<div class="sequence-arrow">&rarr;</div>`;
      }
    });
    if (d.sequence.length > 10) {
      restHtml += `<div class="sequence-more">+${d.sequence.length - 10} mais</div>`;
    }

    card.innerHTML = `
      <div class="sequence-content">
        <div class="next-study">
          <span class="next-study-label">Próxima matéria</span>
          <div class="next-study-chip subject-color-${d.nextStudy.colorIndex}" data-action="show-next-material" data-subject="${esc(d.nextStudy.name)}" role="button" tabindex="0">
            ${ICONS.play}
            <div>
              <div class="next-study-name">${esc(d.nextStudy.name)}</div>
              <div class="next-study-duration">1 hora</div>
            </div>
          </div>
        </div>
        <div class="sequence-rest">
          <span class="sequence-rest-label">Depois:</span>
          ${restHtml}
        </div>
      </div>`;
  }

  function renderSubjects(d) {
    const grid = document.getElementById('subjects-grid');

    if (d.allocatedSubjects.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <p class="empty-state-title">Nenhuma matéria adicionada</p>
          <p class="empty-state-sub">Toque em "Adicionar matéria" para começar a organizar seus estudos.</p>
        </div>`;
      return;
    }

    grid.innerHTML = d.allocatedSubjects.map(subj => {
      const pct = subj.allocated > 0 ? Math.min(100, (subj.completedHours / subj.allocated) * 100) : 0;
      return `
      <div class="subject-card" data-subject-id="${subj.id}">
        <button type="button" class="subject-edit-btn" data-action="edit-subject" data-id="${subj.id}" aria-label="Editar ${esc(subj.name)}">
          ${ICONS.edit}
        </button>
        <div class="subject-head">
          <span class="subject-dot subject-color-${subj.colorIndex}"></span>
          <h4 class="subject-name">${esc(subj.name)}</h4>
        </div>
        <div class="subject-hours-row">
          <div>
            <div class="subject-hours">${subj.completedHours}<span class="subject-hours-total"> / ${subj.allocated}h</span></div>
            <div class="subject-hours-label">Concluído</div>
          </div>
        </div>
        <div class="subject-progress-track">
          <div class="subject-progress-fill subject-color-${subj.colorIndex}" style="width:${pct}%"></div>
        </div>
        <div class="subject-stats">
          ${statBlock('Dif.', subj.difficulty)}
          ${statBlock('Cont.', subj.content)}
          ${statBlock('Imp.', subj.importance)}
        </div>
      </div>`;
    }).join('');
  }

  function statBlock(label, value) {
    let dots = '';
    for (let i = 0; i < 5; i++) {
      dots += `<span class="subject-stat-dot${i < value ? ' filled' : ''}"></span>`;
    }
    return `<div><div class="subject-stat-label">${label}</div><div class="subject-stat-dots">${dots}</div></div>`;
  }

  // ---------- MODALS ----------
  function renderModal(d) {
    const root = document.getElementById('modal-root');

    if (!state.activeModal) {
      root.innerHTML = '';
      return;
    }

    if (state.activeModal === 'settings') {
      root.innerHTML = modalSettingsHtml();
      wireSettingsModal();
      return;
    }

    if (state.activeModal === 'sync-passcode') {
      root.innerHTML = modalSyncPasscodeHtml();
      wireSyncPasscodeModal();
      return;
    }

    if (state.activeModal === 'add-subject' || state.activeModal === 'edit-subject') {
      const subject = state.activeModal === 'edit-subject'
        ? state.subjects.find(s => s.id === state.editingSubjectId)
        : null;
      root.innerHTML = modalSubjectHtml(subject);
      wireSubjectModal(subject);
      return;
    }

    if (state.activeModal === 'log-time') {
      root.innerHTML = modalLogTimeHtml(d);
      wireLogTimeModal(d);
      return;
    }

    if (state.activeModal === 'add-log' || state.activeModal === 'edit-log') {
      const log = state.activeModal === 'edit-log'
        ? state.studyLogs.find(l => l.id === state.editingLogId)
        : null;
      root.innerHTML = modalStudyLogHtml(log);
      wireStudyLogModal(log);
      return;
    }

    if (state.activeModal === 'next-material') {
      root.innerHTML = modalNextMaterialHtml(state.nextMaterialSubject);
      wireNextMaterialModal();
      return;
    }

    if (state.activeModal === 'add-error' || state.activeModal === 'edit-error') {
      const err = state.activeModal === 'edit-error'
        ? state.errorLogs.find(e => e.id === state.editingErrorId)
        : null;
      root.innerHTML = modalErrorHtml(err);
      wireErrorModal(err);
      return;
    }

    if (state.activeModal === 'add-round') {
      root.innerHTML = modalRoundHtml();
      wireRoundModal();
      return;
    }

    if (state.activeModal === 'add-question') {
      root.innerHTML = modalQuestionHtml();
      wireQuestionModal();
      return;
    }

    if (state.activeModal === 'redo-question') {
      const q = state.questionBank.find(qq => qq.id === state.redoingQuestionId);
      if (!q) { root.innerHTML = ''; return; }
      root.innerHTML = modalRedoHtml(q);
      return;
    }
  }

  function modalShell(title, bodyHtml) {
    return `
      <div class="modal-overlay" data-action="close-modal-backdrop">
        <div class="modal-backdrop" data-action="close-modal"></div>
        <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="modal-header">
            <h2>${esc(title)}</h2>
            <button type="button" class="modal-close" data-action="close-modal" aria-label="Fechar">${ICONS.x}</button>
          </div>
          <div class="modal-body">${bodyHtml}</div>
        </div>
      </div>`;
  }

  // --- Sync passcode modal ---
  function modalSyncPasscodeHtml() {
    const body = `
      <div id="sync-passcode-form">
        <p class="field-help" id="sync-passcode-intro">Verificando…</p>
        <div class="field">
          <label for="input-sync-passcode">Senha de sincronização</label>
          <input id="input-sync-passcode" class="text-input" type="password" autocomplete="off" placeholder="Digite sua senha">
        </div>
        <div id="sync-passcode-error"></div>
        <button type="button" id="sync-passcode-btn" class="btn-primary-block" disabled>Verificando…</button>
      </div>`;
    return modalShell('Sincronização', body);
  }

  function wireSyncPasscodeModal() {
    const intro = document.getElementById('sync-passcode-intro');
    const input = document.getElementById('input-sync-passcode');
    const errorBox = document.getElementById('sync-passcode-error');
    const btn = document.getElementById('sync-passcode-btn');

    if (state.syncError) {
      errorBox.innerHTML = `<div class="error-box">${ICONS.alertCircle}<p>${esc(state.syncError)}</p></div>`;
      state.syncError = null;
    }

    let mode = 'checking'; // 'create' | 'enter'

    checkSyncCodeExists().then(exists => {
      mode = exists ? 'enter' : 'create';
      intro.textContent = exists
        ? 'Digite a senha de sincronização que você configurou antes neste ou em outro aparelho.'
        : 'Ainda não há uma senha configurada. Escolha uma agora — você vai digitar a mesma nos seus outros aparelhos.';
      btn.textContent = exists ? 'Sincronizar' : 'Criar senha e sincronizar';
      btn.disabled = false;
    }).catch(() => {
      mode = 'enter';
      intro.textContent = 'Não foi possível verificar (sem internet?). Se você já tem uma senha, digite-a abaixo.';
      btn.textContent = 'Sincronizar';
      btn.disabled = false;
    });

    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btn.click();
    });

    btn.addEventListener('click', () => {
      const code = input.value.trim();
      if (!code) return;
      btn.disabled = true;
      errorBox.innerHTML = '';

      const proceed = () => {
        localStorage.setItem(SYNC_CODE_STORAGE_KEY, code);
        state.activeModal = null;
        render();
        performSync(code);
      };

      if (mode === 'create') {
        claimSyncCode(code).then(proceed).catch(() => {
          // Someone (another device, or you a moment ago) may have just
          // claimed the code — just try using it as-is; if it's wrong,
          // performSync will reopen this modal with an error.
          proceed();
        });
      } else {
        proceed();
      }
    });
  }


  // --- Settings modal ---
  function modalSettingsHtml() {
    const s = state.settings;
    const body = `
      <div id="settings-form">
        <div class="field">
          <label for="input-weekly">Total de horas semanais</label>
          <input id="input-weekly" class="text-input" type="number" min="1" max="168" value="${s.weeklyHours}">
          <p class="field-help">O tempo total que você tem para estudar nesta semana.</p>
        </div>
        <div class="field">
          <label for="input-min-hours">Mínimo de horas por matéria</label>
          <input id="input-min-hours" class="text-input" type="number" min="1" max="20" value="${s.minHoursPerSubject}">
        </div>
        <div class="field">
          <label for="input-streak">Horas seguidas por matéria</label>
          <input id="input-streak" class="text-input" type="number" min="1" max="12" value="${s.streakHours}">
          <p class="field-help">Quantas horas seguidas o ciclo tenta manter na mesma matéria antes de trocar. Use 1 para nunca repetir a matéria em seguida.</p>
        </div>
        <div class="field">
          <label for="input-window-hours">Faixa de horas (diversidade)</label>
          <input id="input-window-hours" class="text-input" type="number" min="0" max="48" value="${s.windowHours}">
          <p class="field-help">Opcional. Dentro de uma faixa de X horas seguidas, limita quantas matérias diferentes podem aparecer. Deixe 0 para desativar.</p>
        </div>
        <div class="field">
          <label for="input-max-subjects-window">Máx. de matérias diferentes na faixa</label>
          <input id="input-max-subjects-window" class="text-input" type="number" min="0" max="20" value="${s.maxSubjectsPerWindow}">
          <p class="field-help">Ex.: faixa de 6 horas com no máximo 2 matérias diferentes. Deixe 0 para desativar.</p>
        </div>
        <div id="settings-error"></div>
        <button type="button" id="settings-save-btn" class="btn-primary-block settings-save">Salvar configurações</button>
      </div>`;
    return modalShell('Configurações do ciclo', body);
  }

  function wireSettingsModal() {
    const weeklyInput = document.getElementById('input-weekly');
    const minInput = document.getElementById('input-min-hours');
    const streakInput = document.getElementById('input-streak');
    const windowInput = document.getElementById('input-window-hours');
    const maxSubjectsInput = document.getElementById('input-max-subjects-window');
    const errorBox = document.getElementById('settings-error');
    const saveBtn = document.getElementById('settings-save-btn');
    const subjectsCount = state.subjects.length;

    function refresh() {
      const weekly = parseInt(weeklyInput.value, 10) || 0;
      const minHours = parseInt(minInput.value, 10) || 0;
      const streak = parseInt(streakInput.value, 10) || 0;
      const windowHours = parseInt(windowInput.value, 10) || 0;
      const maxSubjects = parseInt(maxSubjectsInput.value, 10) || 0;
      const totalMin = subjectsCount * minHours;

      const errors = [];
      if (totalMin > weekly) {
        errors.push(`Com ${subjectsCount} matérias e um mínimo de ${minHours}h cada, você precisa de pelo menos ${totalMin}h. Aumente o total de horas semanais ou diminua o mínimo.`);
      }
      if (streak < 1) {
        errors.push('Horas seguidas por matéria precisa ser pelo menos 1.');
      }
      if ((windowHours > 0) !== (maxSubjects > 0)) {
        errors.push('Para usar a regra de diversidade, preencha tanto a faixa de horas quanto o número máximo de matérias (ou deixe as duas em 0 para desativar).');
      } else if (windowHours > 0 && windowHours <= streak) {
        errors.push('A faixa de horas precisa ser maior que as horas seguidas por matéria para fazer diferença.');
      }

      errorBox.innerHTML = errors.length ? `
        <div class="error-box">
          ${ICONS.alertCircle}
          <p>${errors.join(' ')}</p>
        </div>` : '';

      saveBtn.disabled = errors.length > 0;
    }

    weeklyInput.addEventListener('input', refresh);
    minInput.addEventListener('input', refresh);
    streakInput.addEventListener('input', refresh);
    windowInput.addEventListener('input', refresh);
    maxSubjectsInput.addEventListener('input', refresh);
    refresh();

    saveBtn.addEventListener('click', () => {
      const weekly = parseInt(weeklyInput.value, 10) || 0;
      const minHours = parseInt(minInput.value, 10) || 0;
      const streak = parseInt(streakInput.value, 10) || 1;
      const windowHours = parseInt(windowInput.value, 10) || 0;
      const maxSubjects = parseInt(maxSubjectsInput.value, 10) || 0;
      if (subjectsCount * minHours > weekly) return;
      if (streak < 1) return;
      if ((windowHours > 0) !== (maxSubjects > 0)) return;
      state.settings = {
        weeklyHours: weekly,
        minHoursPerSubject: minHours,
        streakHours: streak,
        windowHours: windowHours,
        maxSubjectsPerWindow: maxSubjects,
      };
      state.activeModal = null;
      saveState(state);
      render();
    });
  }

  // --- Add/Edit subject modal ---
  function ratingRow(id, label, value, low, high) {
    let btns = '';
    for (let i = 1; i <= 5; i++) {
      btns += `<button type="button" class="rating-btn${i <= value ? ' active' : ''}" data-rating-group="${id}" data-value="${i}">${i}</button>`;
    }
    return `
      <div class="rating-row" data-rating-row="${id}">
        <div class="rating-row-label"><span>${esc(label)}</span></div>
        <div class="rating-row-scale">
          <span class="rating-endpoint low">${esc(low)}</span>
          <div class="rating-buttons">${btns}</div>
          <span class="rating-endpoint">${esc(high)}</span>
        </div>
      </div>`;
  }

  function modalSubjectHtml(subject) {
    const name = subject ? subject.name : '';
    const difficulty = subject ? subject.difficulty : 3;
    const content = subject ? subject.content : 3;
    const importance = subject ? subject.importance : 3;

    const body = `
      <div id="subject-form">
        <div class="field">
          <label for="input-subject-name">Nome da matéria</label>
          <input id="input-subject-name" class="text-input font-medium" type="text" placeholder="ex: Matemática" value="${esc(name)}">
        </div>
        <div class="ratings">
          ${ratingRow('difficulty', 'Dificuldade', difficulty, 'Fácil', 'Difícil')}
          ${ratingRow('content', 'Quantidade de conteúdo', content, 'Pouco', 'Muito')}
          ${ratingRow('importance', 'Importância', importance, 'Baixa', 'Alta')}
        </div>
        <div class="modal-form-actions">
          ${subject ? `<button type="button" class="btn-delete" id="subject-delete-btn">Excluir</button>` : ''}
          <button type="button" class="btn-save-flex" id="subject-save-btn" disabled>${subject ? 'Salvar alterações' : 'Adicionar matéria'}</button>
        </div>
      </div>`;
    return modalShell(subject ? 'Editar matéria' : 'Adicionar matéria', body);
  }

  function wireSubjectModal(subject) {
    const ratings = { difficulty: subject ? subject.difficulty : 3, content: subject ? subject.content : 3, importance: subject ? subject.importance : 3 };
    const nameInput = document.getElementById('input-subject-name');
    const saveBtn = document.getElementById('subject-save-btn');

    function refreshSaveState() {
      saveBtn.disabled = nameInput.value.trim().length === 0;
    }
    nameInput.addEventListener('input', refreshSaveState);
    refreshSaveState();

    document.querySelectorAll('.rating-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.getAttribute('data-rating-group');
        const value = parseInt(btn.getAttribute('data-value'), 10);
        ratings[group] = value;
        document.querySelectorAll(`.rating-btn[data-rating-group="${group}"]`).forEach(b => {
          b.classList.toggle('active', parseInt(b.getAttribute('data-value'), 10) <= value);
        });
      });
    });

    saveBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) return;
      if (subject) {
        state.subjects = state.subjects.map(s => s.id === subject.id
          ? Object.assign({}, s, { name, difficulty: ratings.difficulty, content: ratings.content, importance: ratings.importance })
          : s);
      } else {
        state.subjects = state.subjects.concat([{
          id: uid(),
          name,
          difficulty: ratings.difficulty,
          content: ratings.content,
          importance: ratings.importance,
          completedHours: 0,
          colorIndex: state.subjects.length % 8,
          lastStudiedAt: 0,
        }]);
      }
      state.activeModal = null;
      saveState(state);
      render();
    });

    const deleteBtn = document.getElementById('subject-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        state.subjects = state.subjects.filter(s => s.id !== subject.id);
        state.activeModal = null;
        saveState(state);
        render();
      });
    }
  }

  // --- Log time modal ---
  function modalLogTimeHtml(d) {
    const options = d.allocatedSubjects.map(s =>
      `<option value="${s.id}">${esc(s.name)} (${Math.max(0, s.allocated - s.completedHours)}h restantes)</option>`
    ).join('');

    const body = `
      <div id="log-time-form">
        <div class="field">
          <label for="log-subject-select">Matéria</label>
          <div class="select-wrap">
            <select id="log-subject-select" class="select-input">${options}</select>
            <span class="select-chevron">${ICONS.chevronDown}</span>
          </div>
        </div>
        <div class="field">
          <label>Horas estudadas</label>
          <div class="hours-grid">
            <button type="button" class="hours-btn active" data-hours="1">1 h</button>
            <button type="button" class="hours-btn" data-hours="2">2 hrs</button>
            <button type="button" class="hours-btn" data-hours="3">3 hrs</button>
            <button type="button" class="hours-btn" data-hours="4">4 hrs</button>
          </div>
        </div>
        <button type="button" class="btn-primary-block log-submit" id="log-submit-btn">Adicionar 1 hora</button>
      </div>`;
    return modalShell('Registrar tempo de estudo', body);
  }

  function wireLogTimeModal(d) {
    const select = document.getElementById('log-subject-select');
    const nextId = d.nextStudy ? d.nextStudy.id : (d.allocatedSubjects[0] ? d.allocatedSubjects[0].id : '');
    if (nextId) select.value = nextId;

    let hours = 1;
    const submitBtn = document.getElementById('log-submit-btn');

    function updateSubmitLabel() {
      submitBtn.textContent = `Adicionar ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    }

    document.querySelectorAll('.hours-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        hours = parseInt(btn.getAttribute('data-hours'), 10);
        document.querySelectorAll('.hours-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateSubmitLabel();
      });
    });

    submitBtn.addEventListener('click', () => {
      const subjectId = select.value;
      if (!subjectId) return;
      state.studyCounter += 1;
      const stamp = state.studyCounter;
      state.subjects = state.subjects.map(s => s.id === subjectId
        ? Object.assign({}, s, { completedHours: s.completedHours + hours, lastStudiedAt: stamp })
        : s);
      state.activeModal = null;
      saveState(state);
      render();
    });
  }

  // ==========================================================
  // STUDY LOG — "what am I currently studying, and where did I stop?"
  // ==========================================================
  function categoryIcon(category) {
    if (category === 'Book') return ICONS.bookOpen;
    if (category === 'Video') return ICONS.video;
    return ICONS.helpCircle;
  }

  // One-line summary of the category-specific position fields, e.g.
  // "Capítulo 4 · Página 143" or "EP 12 · 12:34" or "Exercício 27".
  function logDetailLine(log) {
    if (log.category === 'Book') {
      const parts = [];
      if (log.chapter) parts.push(log.chapter);
      if (log.page) parts.push(`Página ${log.page}`);
      return parts.join(' · ');
    }
    if (log.category === 'Video') {
      const parts = [];
      if (log.episode) parts.push(`EP ${log.episode}`);
      if (log.timestamp) parts.push(log.timestamp);
      return parts.join(' · ');
    }
    if (log.category === 'Question') {
      return log.exerciseNumber ? `Exercício ${log.exerciseNumber}` : '';
    }
    return '';
  }

  function renderStudyLogScreen() {
    const container = document.getElementById('screen-study-log');
    const activeLogs = state.studyLogs.filter(l => l.status === 'active');
    const completedLogs = state.studyLogs.filter(l => l.status === 'completed');
    const baseShown = state.studyLogTab === 'active' ? activeLogs : completedLogs;

    const subjectNames = state.subjects.map(s => s.name);
    const filterSubjectOptions = Array.from(new Set(subjectNames.concat(state.studyLogs.map(l => l.subject).filter(Boolean)))).sort((a, b) => a.localeCompare(b));

    const shown = baseShown.filter(l => {
      if (state.studyLogFilterSubject && l.subject !== state.studyLogFilterSubject) return false;
      if (state.studyLogFilterCategory && l.category !== state.studyLogFilterCategory) return false;
      return true;
    });

    let filterBarHtml = '';
    if (baseShown.length > 0) {
      const subjectOptionsHtml = filterSubjectOptions.map(s => `<option value="${esc(s)}"${state.studyLogFilterSubject === s ? ' selected' : ''}>${esc(s)}</option>`).join('');
      const categoryOptionsHtml = STUDY_CATEGORIES.map(c => `<option value="${esc(c)}"${state.studyLogFilterCategory === c ? ' selected' : ''}>${esc(STUDY_CATEGORY_LABELS[c])}</option>`).join('');
      filterBarHtml = `
        <div class="filter-bar">
          <span class="filter-label">${ICONS.filter}Filtrar:</span>
          <div class="filter-select-wrap">
            <select id="log-filter-subject" class="filter-select">
              <option value="">Todas as matérias</option>
              ${subjectOptionsHtml}
            </select>
            ${ICONS.chevronDown}
          </div>
          <div class="filter-select-wrap">
            <select id="log-filter-category" class="filter-select">
              <option value="">Todos os materiais</option>
              ${categoryOptionsHtml}
            </select>
            ${ICONS.chevronDown}
          </div>
          ${(state.studyLogFilterSubject || state.studyLogFilterCategory) ? `
            <button type="button" class="filter-clear" data-action="clear-log-filters">${ICONS.x}Limpar</button>
            <span class="filter-result-count">${shown.length} ${shown.length === 1 ? 'resultado' : 'resultados'}</span>` : ''}
        </div>`;
    }

    let listHtml;
    if (baseShown.length === 0) {
      listHtml = state.studyLogTab === 'active' ? `
        <div class="empty-state-block">
          ${ICONS.bookMarked}
          <h3>Nenhum registro ativo</h3>
          <p>Comece a acompanhar o que você está estudando agora.</p>
          <button type="button" class="btn btn-primary" data-action="add-log">
            ${ICONS.plus.replace('class="icon"', 'class="icon icon-sm"')}
            Adicionar registro
          </button>
        </div>` : `
        <div class="empty-state-block">
          ${ICONS.bookMarked}
          <h3>Nenhum registro concluído</h3>
          <p>Materiais marcados como concluídos aparecem aqui.</p>
        </div>`;
    } else if (shown.length === 0) {
      listHtml = `
        <div class="empty-state-block">
          ${ICONS.filter}
          <h3>Nenhum registro corresponde aos filtros</h3>
          <p>Tente ajustar ou limpar os filtros.</p>
        </div>`;
    } else {
      listHtml = `<div class="list-cards">` + shown.map(log => {
        const detail = logDetailLine(log);
        return `
        <div class="log-card${log.status === 'completed' ? ' is-completed' : ''}">
          <div class="log-card-main">
            <div class="log-card-meta">
              <span class="log-card-category">${categoryIcon(log.category)}${esc(STUDY_CATEGORY_LABELS[log.category] || log.category)}</span>
              ${log.subject ? `<span class="log-card-subject">${esc(log.subject)}</span>` : ''}
              ${log.status === 'completed' ? `<span class="pill-completed">${ICONS.check}Concluído</span>` : ''}
            </div>
            <p class="log-card-name">${esc(log.name)}</p>
            ${detail ? `<p class="log-card-detail">${esc(detail)}</p>` : ''}
          </div>
          <div class="log-card-actions">
            <button type="button" class="btn-chip" data-action="edit-log" data-id="${log.id}">${ICONS.edit.replace('class="icon"', 'class="icon icon-sm"')}Editar</button>
            ${log.status === 'active'
              ? `<button type="button" class="btn-chip btn-chip-success" data-action="complete-log" data-id="${log.id}">${ICONS.check}Concluir</button>`
              : `<button type="button" class="btn-chip" data-action="reactivate-log" data-id="${log.id}">${ICONS.rotateCcw.replace('class="icon"', 'class="icon icon-sm"')}Reativar</button>`}
          </div>
        </div>`;
      }).join('') + `</div>`;
    }

    container.innerHTML = `
      <div class="screen">
        <div class="screen-header">
          <div>
            <h2>Study Log</h2>
            <p>Acompanhe o que você está estudando e onde parou.</p>
          </div>
          <button type="button" class="btn btn-primary" data-action="add-log">
            ${ICONS.plus.replace('class="icon"', 'class="icon icon-sm"')}
            Adicionar registro
          </button>
        </div>
        <div class="sub-tabs">
          <button type="button" class="sub-tab${state.studyLogTab === 'active' ? ' active' : ''}" data-action="switch-log-tab" data-tab="active">
            Ativos <span class="sub-tab-count">${activeLogs.length}</span>
          </button>
          <button type="button" class="sub-tab${state.studyLogTab === 'completed' ? ' active' : ''}" data-action="switch-log-tab" data-tab="completed">
            Concluídos <span class="sub-tab-count">${completedLogs.length}</span>
          </button>
        </div>
        ${filterBarHtml}
        ${listHtml}
      </div>`;

    const subjSel = document.getElementById('log-filter-subject');
    const catSel = document.getElementById('log-filter-category');
    if (subjSel) subjSel.addEventListener('change', () => { state.studyLogFilterSubject = subjSel.value; render(); });
    if (catSel) catSel.addEventListener('change', () => { state.studyLogFilterCategory = catSel.value; render(); });
  }

  function modalStudyLogHtml(log) {
    const name = log ? log.name : '';
    const category = log ? log.category : 'Book';
    const subject = log ? (log.subject || '') : (state.prefillLogSubject || '');
    const chapter = log ? (log.chapter || '') : '';
    const page = log ? (log.page || '') : '';
    const episode = log ? (log.episode || '') : '';
    const timestamp = log ? (log.timestamp || '') : '';
    const exerciseNumber = log ? (log.exerciseNumber || '') : '';

    const categoryButtons = STUDY_CATEGORIES.map(cat => `
      <button type="button" class="category-option${cat === category ? ' active' : ''}" data-category="${cat}">
        ${categoryIcon(cat)}
        ${esc(STUDY_CATEGORY_LABELS[cat])}
      </button>`).join('');

    const subjectOptionsHtml = state.subjects.map(s =>
      `<option value="${esc(s.name)}"${subject === s.name ? ' selected' : ''}>${esc(s.name)}</option>`
    ).join('');

    const body = `
      <div id="study-log-form">
        <div class="field">
          <label for="input-log-name">Nome</label>
          <input id="input-log-name" class="text-input font-medium" type="text" placeholder="ex: Análise Matemática — Módulo 2, Aula 17" value="${esc(name)}">
        </div>
        <div class="field">
          <label for="input-log-subject">Matéria (opcional)</label>
          <div class="select-wrap">
            <select id="input-log-subject" class="select-input">
              <option value=""${subject === '' ? ' selected' : ''}>Nenhuma / Geral</option>
              ${subjectOptionsHtml}
            </select>
            <span class="select-chevron">${ICONS.chevronDown}</span>
          </div>
        </div>
        <div class="field">
          <label>Categoria</label>
          <div class="category-picker" id="category-picker">${categoryButtons}</div>
        </div>

        <div class="field category-fields" data-for-category="Book" style="${category === 'Book' ? '' : 'display:none'}">
          <label for="input-log-chapter">Capítulo</label>
          <input id="input-log-chapter" class="text-input" type="text" placeholder="ex: Capítulo 4 — Derivadas" value="${esc(chapter)}">
          <div class="subfield">
            <label for="input-log-page">Página</label>
            <input id="input-log-page" class="text-input" type="text" placeholder="ex: 143" value="${esc(page)}">
          </div>
        </div>

        <div class="field category-fields" data-for-category="Video" style="${category === 'Video' ? '' : 'display:none'}">
          <label for="input-log-episode">Episódio</label>
          <input id="input-log-episode" class="text-input" type="text" placeholder="ex: 12" value="${esc(episode)}">
          <div class="subfield">
            <label for="input-log-timestamp">Tempo (min:seg)</label>
            <input id="input-log-timestamp" class="text-input" type="text" placeholder="ex: 12:34" value="${esc(timestamp)}">
          </div>
        </div>

        <div class="field category-fields" data-for-category="Question" style="${category === 'Question' ? '' : 'display:none'}">
          <label for="input-log-exercise">Exercício</label>
          <input id="input-log-exercise" class="text-input" type="text" placeholder="ex: 27" value="${esc(exerciseNumber)}">
        </div>

        <div class="modal-form-actions">
          <button type="button" class="btn-secondary-block" data-action="close-modal">Cancelar</button>
          <button type="button" class="btn-save-flex" id="log-save-btn" disabled>${log ? 'Salvar' : 'Adicionar'}</button>
        </div>
      </div>`;
    return modalShell(log ? 'Editar registro' : 'Adicionar registro', body);
  }

  function wireStudyLogModal(log) {
    let category = log ? log.category : 'Book';
    const nameInput = document.getElementById('input-log-name');
    const subjectSelect = document.getElementById('input-log-subject');
    const saveBtn = document.getElementById('log-save-btn');

    function refresh() { saveBtn.disabled = nameInput.value.trim().length === 0; }
    nameInput.addEventListener('input', refresh);
    refresh();

    function showCategoryFields() {
      document.querySelectorAll('.category-fields').forEach(el => {
        el.style.display = el.getAttribute('data-for-category') === category ? '' : 'none';
      });
    }

    document.querySelectorAll('#category-picker .category-option').forEach(btn => {
      btn.addEventListener('click', () => {
        category = btn.getAttribute('data-category');
        document.querySelectorAll('#category-picker .category-option').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-category') === category);
        });
        showCategoryFields();
      });
    });

    saveBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) return;
      const subject = subjectSelect.value;

      const extra = {};
      if (category === 'Book') {
        extra.chapter = (document.getElementById('input-log-chapter').value || '').trim();
        extra.page = (document.getElementById('input-log-page').value || '').trim();
      } else if (category === 'Video') {
        extra.episode = (document.getElementById('input-log-episode').value || '').trim();
        extra.timestamp = (document.getElementById('input-log-timestamp').value || '').trim();
      } else if (category === 'Question') {
        extra.exerciseNumber = (document.getElementById('input-log-exercise').value || '').trim();
      }

      if (log) {
        const cleaned = Object.assign({}, log);
        delete cleaned.chapter; delete cleaned.page; delete cleaned.episode; delete cleaned.timestamp; delete cleaned.exerciseNumber;
        state.studyLogs = state.studyLogs.map(l => l.id === log.id
          ? Object.assign(cleaned, { name, subject, category }, extra)
          : l);
      } else {
        state.studyLogs = state.studyLogs.concat([Object.assign({ id: uid(), name, subject, category, status: 'active' }, extra)]);
      }
      state.editingLogId = null;
      state.prefillLogSubject = null;
      state.activeModal = null;
      saveState(state);
      render();
    });
  }

  // Modal opened when the user clicks the "Próxima matéria" card on the
  // Study Cycle screen. Shows only the ACTIVE Study Log entries linked to
  // that subject — the Study Cycle still only decides the subject; this
  // just answers "what specifically should I study within it?".
  function modalNextMaterialHtml(subjectName) {
    const logs = state.studyLogs.filter(l => l.status === 'active' && l.subject === subjectName);

    let body;
    if (logs.length === 0) {
      body = `
        <div class="empty-state-block" style="padding:2rem 1rem;">
          ${ICONS.bookMarked}
          <h3>Nenhum material ativo</h3>
          <p>Não há registros de Study Log ativos para ${esc(subjectName)}.</p>
          <button type="button" class="btn btn-primary" data-action="add-log-for-subject" data-subject="${esc(subjectName)}">
            ${ICONS.plus.replace('class="icon"', 'class="icon icon-sm"')} Adicionar registro
          </button>
        </div>`;
    } else {
      body = `<div class="list-cards">` + logs.map(log => {
        const detail = logDetailLine(log);
        return `
        <div class="log-card">
          <div class="log-card-main">
            <div class="log-card-meta">
              <span class="log-card-category">${categoryIcon(log.category)}${esc(STUDY_CATEGORY_LABELS[log.category] || log.category)}</span>
            </div>
            <p class="log-card-name">${esc(log.name)}</p>
            ${detail ? `<p class="log-card-detail">${esc(detail)}</p>` : ''}
          </div>
          <div class="log-card-actions">
            <button type="button" class="btn-chip btn-chip-success" data-action="continue-log" data-id="${log.id}">Continuar</button>
          </div>
        </div>`;
      }).join('') + `</div>`;
    }

    return modalShell(subjectName, body);
  }

  function wireNextMaterialModal() {
    // static content, no extra JS wiring needed beyond the global
    // data-action delegation (continue-log / add-log-for-subject)
  }

  // ==========================================================
  // ERROR LOG — "what did I get wrong, and why?"
  // ==========================================================
  function renderErrorLogScreen() {
    const container = document.getElementById('screen-error-log');
    const subjectNames = state.subjects.map(s => s.name);
    const filterSubjectOptions = Array.from(new Set(subjectNames.concat(state.errorLogs.map(e => e.subject)))).sort((a, b) => a.localeCompare(b));

    const filtered = state.errorLogs.filter(e => {
      if (state.errorFilterSubject && e.subject !== state.errorFilterSubject) return false;
      if (state.errorFilterType && e.errorType !== state.errorFilterType) return false;
      return true;
    });

    let filterBarHtml = '';
    if (state.errorLogs.length > 0) {
      const subjectOptionsHtml = filterSubjectOptions.map(s => `<option value="${esc(s)}"${state.errorFilterSubject === s ? ' selected' : ''}>${esc(s)}</option>`).join('');
      const typeOptionsHtml = ERROR_TYPES.map(t => `<option value="${esc(t)}"${state.errorFilterType === t ? ' selected' : ''}>${esc(ERROR_TYPE_LABELS[t])}</option>`).join('');
      filterBarHtml = `
        <div class="filter-bar">
          <span class="filter-label">${ICONS.filter}Filtrar:</span>
          <div class="filter-select-wrap">
            <select id="error-filter-subject" class="filter-select">
              <option value="">Todas as matérias</option>
              ${subjectOptionsHtml}
            </select>
            ${ICONS.chevronDown}
          </div>
          <div class="filter-select-wrap">
            <select id="error-filter-type" class="filter-select">
              <option value="">Todos os tipos</option>
              ${typeOptionsHtml}
            </select>
            ${ICONS.chevronDown}
          </div>
          ${(state.errorFilterSubject || state.errorFilterType) ? `
            <button type="button" class="filter-clear" data-action="clear-error-filters">${ICONS.x}Limpar</button>
            <span class="filter-result-count">${filtered.length} ${filtered.length === 1 ? 'resultado' : 'resultados'}</span>` : ''}
        </div>`;
    }

    let listHtml;
    if (state.errorLogs.length === 0) {
      listHtml = `
        <div class="empty-state-block">
          ${ICONS.alertTriangle}
          <h3>Nenhum erro registrado</h3>
          <p>Registre seus erros ao estudar para identificar padrões e fechar lacunas.</p>
          <button type="button" class="btn btn-primary" data-action="add-error">
            ${ICONS.plus.replace('class="icon"', 'class="icon icon-sm"')}
            Registrar erro
          </button>
        </div>`;
    } else if (filtered.length === 0) {
      listHtml = `
        <div class="empty-state-block">
          ${ICONS.filter}
          <h3>Nenhum erro corresponde aos filtros</h3>
          <p>Tente ajustar ou limpar os filtros.</p>
        </div>`;
    } else {
      listHtml = `<div class="list-cards">` + filtered.map(err => `
        <div class="log-card error-card">
          <div class="error-card-body">
            <div class="error-card-title">
              <span class="error-card-subject">${esc(err.subject)}</span>
              <span class="error-card-sep">&middot;</span>
              <span class="error-card-topic">${esc(err.topic)}</span>
            </div>
            <p class="error-card-desc">&ldquo;${esc(err.description)}&rdquo;</p>
            <div><span class="error-badge ${ERROR_TYPE_BADGE[err.errorType] || 'error-badge-neutral'}">${esc(ERROR_TYPE_LABELS[err.errorType] || err.errorType)}</span></div>
          </div>
          <div class="log-card-actions">
            <button type="button" class="btn-chip" data-action="edit-error" data-id="${err.id}">${ICONS.edit.replace('class="icon"', 'class="icon icon-sm"')}Editar</button>
            <button type="button" class="btn-chip btn-chip-danger" data-action="delete-error" data-id="${err.id}">${ICONS.trash.replace('class="icon"', 'class="icon icon-sm"')}Excluir</button>
          </div>
        </div>`).join('') + `</div>`;
    }

    container.innerHTML = `
      <div class="screen">
        <div class="screen-header">
          <div>
            <h2>Error Log</h2>
            <p>Registre erros para identificar padrões e melhorar.</p>
          </div>
          <button type="button" class="btn btn-primary" data-action="add-error">
            ${ICONS.plus.replace('class="icon"', 'class="icon icon-sm"')}
            Registrar erro
          </button>
        </div>
        ${filterBarHtml}
        ${listHtml}
      </div>`;

    const subjSel = document.getElementById('error-filter-subject');
    const typeSel = document.getElementById('error-filter-type');
    if (subjSel) subjSel.addEventListener('change', () => { state.errorFilterSubject = subjSel.value; render(); });
    if (typeSel) typeSel.addEventListener('change', () => { state.errorFilterType = typeSel.value; render(); });
  }

  function modalErrorHtml(err) {
    const subjectNames = state.subjects.map(s => s.name);
    const allSubjects = Array.from(new Set(subjectNames.concat([err ? err.subject : '']).filter(Boolean)));
    const isCustomInitially = !!err && !subjectNames.includes(err.subject);

    const subjectOptionsHtml = allSubjects.map(s =>
      `<option value="${esc(s)}"${!isCustomInitially && err && s === err.subject ? ' selected' : ''}>${esc(s)}</option>`
    ).join('');

    const body = `
      <div id="error-form">
        <div class="field">
          <label for="input-error-subject">Matéria</label>
          <div class="select-wrap">
            <select id="input-error-subject" class="select-input">
              ${subjectOptionsHtml}
              <option value="__custom__"${isCustomInitially ? ' selected' : ''}>Outra (digitar)</option>
            </select>
            <span class="select-chevron">${ICONS.chevronDown}</span>
          </div>
          <input id="input-error-subject-custom" class="text-input font-medium" style="margin-top:0.5rem;${isCustomInitially ? '' : 'display:none'}" type="text" placeholder="Nome da matéria" value="${isCustomInitially ? esc(err.subject) : ''}">
        </div>
        <div class="field">
          <label for="input-error-topic">Tópico</label>
          <input id="input-error-topic" class="text-input font-medium" type="text" placeholder="ex: Limites" value="${err ? esc(err.topic) : ''}">
        </div>
        <div class="field">
          <label for="input-error-desc">Descrição</label>
          <textarea id="input-error-desc" class="textarea-input" rows="3" placeholder="O que deu errado?">${err ? esc(err.description) : ''}</textarea>
        </div>
        <div class="field">
          <label for="input-error-type">Tipo de erro</label>
          <div class="select-wrap">
            <select id="input-error-type" class="select-input">
              ${ERROR_TYPES.map(t => `<option value="${esc(t)}"${(err ? err.errorType : ERROR_TYPES[0]) === t ? ' selected' : ''}>${esc(ERROR_TYPE_LABELS[t])}</option>`).join('')}
            </select>
            <span class="select-chevron">${ICONS.chevronDown}</span>
          </div>
        </div>
        <div class="modal-form-actions">
          <button type="button" class="btn-secondary-block" data-action="close-modal">Cancelar</button>
          <button type="button" class="btn-save-flex" id="error-save-btn" disabled>${err ? 'Salvar' : 'Registrar erro'}</button>
        </div>
      </div>`;
    return modalShell(err ? 'Editar erro' : 'Registrar erro', body);
  }

  function wireErrorModal(err) {
    const subjectSelect = document.getElementById('input-error-subject');
    const customInput = document.getElementById('input-error-subject-custom');
    const topicInput = document.getElementById('input-error-topic');
    const descInput = document.getElementById('input-error-desc');
    const typeSelect = document.getElementById('input-error-type');
    const saveBtn = document.getElementById('error-save-btn');

    function toggleCustom() {
      customInput.style.display = subjectSelect.value === '__custom__' ? '' : 'none';
    }
    function resolvedSubject() {
      return subjectSelect.value === '__custom__' ? customInput.value.trim() : subjectSelect.value;
    }
    function refresh() {
      const ok = resolvedSubject().length > 0 && topicInput.value.trim().length > 0 && descInput.value.trim().length > 0;
      saveBtn.disabled = !ok;
    }

    subjectSelect.addEventListener('change', () => { toggleCustom(); refresh(); });
    customInput.addEventListener('input', refresh);
    topicInput.addEventListener('input', refresh);
    descInput.addEventListener('input', refresh);
    toggleCustom();
    refresh();

    saveBtn.addEventListener('click', () => {
      const subject = resolvedSubject();
      const topic = topicInput.value.trim();
      const description = descInput.value.trim();
      if (!subject || !topic || !description) return;
      const errorType = typeSelect.value;

      if (err) {
        state.errorLogs = state.errorLogs.map(e => e.id === err.id ? Object.assign({}, e, { subject, topic, description, errorType }) : e);
      } else {
        state.errorLogs = state.errorLogs.concat([{ id: uid(), subject, topic, description, errorType }]);
      }
      state.editingErrorId = null;
      state.activeModal = null;
      saveState(state);
      render();
    });
  }

  // ---------- QUESTION REVIEW SCREEN ----------

  function reviewQueueItemHtml(item) {
    if (item.kind === 'topic') {
      const strength = efLabel(item.EF);
      return `
        <div class="log-card">
          <div class="log-card-main">
            <div class="log-card-meta">
              <span class="rev-type-tag">${ICONS.target}Tópico</span>
              ${dueBadgeHtml(item.nextReviewAt)}
              <span class="error-badge ${strength.cls}">${strength.text}</span>
            </div>
            <p class="log-card-name">${esc(item.subject)}</p>
            <p class="log-card-detail">${esc(item.topic)} &middot; última rodada: ${formatDate(item.lastReviewedAt)}</p>
          </div>
          <div class="log-card-actions">
            <button type="button" class="btn-chip" data-action="open-add-round" data-subject="${esc(item.subject)}" data-topic="${esc(item.topic)}">${ICONS.repeat.replace('class="icon"', 'class="icon icon-sm"')}Registrar rodada</button>
          </div>
        </div>`;
    }
    const thumb = item.imageData ? `<img class="log-card-thumb" src="${item.imageData}" alt="">` : '';
    const titleLine = [item.subject, item.topic].filter(Boolean).join(' · ') || 'Questão salva';
    return `
      <div class="log-card">
        ${thumb}
        <div class="log-card-main">
          <div class="log-card-meta">
            <span class="rev-type-tag">${ICONS.image}Questão</span>
            ${dueBadgeHtml(item.nextReviewAt)}
          </div>
          <p class="log-card-name">${esc(titleLine)}</p>
          ${item.statementText ? `<p class="log-card-detail">${esc(item.statementText.slice(0, 90))}${item.statementText.length > 90 ? '…' : ''}</p>` : ''}
        </div>
        <div class="log-card-actions">
          <button type="button" class="btn-chip" data-action="open-redo-question" data-id="${item.id}">${ICONS.repeat.replace('class="icon"', 'class="icon icon-sm"')}Refazer</button>
        </div>
      </div>`;
  }

  function renderReviewTodayHtml(dueQueue, upcoming) {
    let dueHtml;
    if (dueQueue.length === 0) {
      dueHtml = `
        <div class="empty-state-block">
          ${ICONS.checkCircle}
          <h3>Nada para revisar agora</h3>
          <p>Quando um tópico ou questão vencer, aparece aqui — misturado entre matérias de propósito, pra treinar o reconhecimento igual na prova.</p>
        </div>`;
    } else {
      dueHtml = `<div class="list-cards">${dueQueue.map(reviewQueueItemHtml).join('')}</div>`;
    }

    let upcomingHtml = '';
    if (upcoming.length > 0) {
      upcomingHtml = `
        <div class="section" style="margin-top:0.5rem">
          <div class="review-section-title">${ICONS.clock}Próximas revisões</div>
          <div class="list-cards">${upcoming.map(reviewQueueItemHtml).join('')}</div>
        </div>`;
    }

    return dueHtml + upcomingHtml;
  }

  function renderReviewTopicsHtml() {
    const subjectNames = state.subjects.map(s => s.name);
    const filterOptions = Array.from(new Set(subjectNames.concat(state.topicReviews.map(t => t.subject)))).sort((a, b) => a.localeCompare(b));
    const filtered = state.topicReviews
      .filter(t => !state.reviewFilterSubjectTopics || t.subject === state.reviewFilterSubjectTopics)
      .sort((a, b) => (a.nextReviewAt || 0) - (b.nextReviewAt || 0));

    let filterBarHtml = '';
    if (state.topicReviews.length > 0) {
      filterBarHtml = `
        <div class="filter-bar">
          <span class="filter-label">${ICONS.filter}Filtrar:</span>
          <div class="filter-select-wrap">
            <select id="review-filter-subject-topics" class="filter-select">
              <option value="">Todas as matérias</option>
              ${filterOptions.map(s => `<option value="${esc(s)}"${state.reviewFilterSubjectTopics === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}
            </select>
            ${ICONS.chevronDown}
          </div>
          ${state.reviewFilterSubjectTopics ? `<button type="button" class="filter-clear" data-action="clear-review-filter-topics">${ICONS.x}Limpar</button>` : ''}
        </div>`;
    }

    let listHtml;
    if (state.topicReviews.length === 0) {
      listHtml = `
        <div class="empty-state-block">
          ${ICONS.target}
          <h3>Nenhum tópico acompanhado ainda</h3>
          <p>Registre uma rodada de questões (a 2ª rodada em diante — não a fixação do mesmo dia) para o motor começar a agendar as próximas.</p>
          <button type="button" class="btn btn-primary" data-action="open-add-round">${ICONS.plus.replace('class="icon"', 'class="icon icon-sm"')}Registrar rodada</button>
        </div>`;
    } else if (filtered.length === 0) {
      listHtml = `<div class="empty-state-block">${ICONS.filter}<h3>Nenhum tópico corresponde ao filtro</h3></div>`;
    } else {
      listHtml = `<div class="list-cards">` + filtered.map(t => {
        const strength = efLabel(t.EF);
        return `
        <div class="log-card">
          <div class="log-card-main">
            <div class="log-card-meta">
              ${dueBadgeHtml(t.nextReviewAt)}
              <span class="error-badge ${strength.cls}">${strength.text}</span>
              <span class="log-card-subject">${t.totalRounds} rodada${t.totalRounds === 1 ? '' : 's'}</span>
            </div>
            <p class="log-card-name">${esc(t.subject)}</p>
            <p class="log-card-detail">${esc(t.topic)} &middot; última: ${formatDate(t.lastReviewedAt)} &middot; próxima: ${formatDate(t.nextReviewAt)}</p>
          </div>
          <div class="log-card-actions">
            <button type="button" class="btn-chip" data-action="open-add-round" data-subject="${esc(t.subject)}" data-topic="${esc(t.topic)}">${ICONS.repeat.replace('class="icon"', 'class="icon icon-sm"')}Nova rodada</button>
            <button type="button" class="btn-chip btn-chip-danger" data-action="delete-topic-review" data-id="${t.id}">${ICONS.trash.replace('class="icon"', 'class="icon icon-sm"')}Excluir</button>
          </div>
        </div>`;
      }).join('') + `</div>`;
    }

    return filterBarHtml + listHtml;
  }

  function renderReviewQuestionsHtml() {
    const activeQs = state.questionBank.filter(q => !q.retired).sort((a, b) => (a.nextReviewAt || 0) - (b.nextReviewAt || 0));
    const graduatedQs = state.questionBank.filter(q => q.retired);
    const baseShown = state.questionSubTab === 'active' ? activeQs : graduatedQs;

    const subjectNames = state.subjects.map(s => s.name);
    const filterOptions = Array.from(new Set(subjectNames.concat(state.questionBank.map(q => q.subject).filter(Boolean)))).sort((a, b) => a.localeCompare(b));
    const filtered = baseShown.filter(q => !state.reviewFilterSubjectQuestions || q.subject === state.reviewFilterSubjectQuestions);

    let filterBarHtml = '';
    if (baseShown.length > 0) {
      filterBarHtml = `
        <div class="filter-bar">
          <span class="filter-label">${ICONS.filter}Filtrar:</span>
          <div class="filter-select-wrap">
            <select id="review-filter-subject-questions" class="filter-select">
              <option value="">Todas as matérias</option>
              ${filterOptions.map(s => `<option value="${esc(s)}"${state.reviewFilterSubjectQuestions === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}
            </select>
            ${ICONS.chevronDown}
          </div>
          ${state.reviewFilterSubjectQuestions ? `<button type="button" class="filter-clear" data-action="clear-review-filter-questions">${ICONS.x}Limpar</button>` : ''}
        </div>`;
    }

    let listHtml;
    if (baseShown.length === 0) {
      listHtml = state.questionSubTab === 'active' ? `
        <div class="empty-state-block">
          ${ICONS.image}
          <h3>Nenhuma questão salva</h3>
          <p>Guarde o print ou o enunciado de uma questão difícil para o motor te lembrar de refazê-la.</p>
          <button type="button" class="btn btn-primary" data-action="open-add-question">${ICONS.plus.replace('class="icon"', 'class="icon icon-sm"')}Salvar questão</button>
        </div>` : `
        <div class="empty-state-block">
          ${ICONS.checkCircle}
          <h3>Nenhuma questão graduada ainda</h3>
          <p>Uma questão sai da fila ativa sozinha depois de ${GRADUATE_AFTER_N} acertos seguidos ao ser refeita.</p>
        </div>`;
    } else if (filtered.length === 0) {
      listHtml = `<div class="empty-state-block">${ICONS.filter}<h3>Nenhuma questão corresponde ao filtro</h3></div>`;
    } else {
      listHtml = `<div class="list-cards">` + filtered.map(q => {
        const thumb = q.imageData ? `<img class="log-card-thumb" src="${q.imageData}" alt="">` : '';
        const titleLine = q.topic || (q.statementText ? q.statementText.slice(0, 60) : 'Questão salva');
        return `
        <div class="log-card">
          ${thumb}
          <div class="log-card-main">
            <div class="log-card-meta">
              ${state.questionSubTab === 'active' ? dueBadgeHtml(q.nextReviewAt) : `<span class="pill-completed">${ICONS.check}Graduada</span>`}
              ${q.subject ? `<span class="log-card-subject">${esc(q.subject)}</span>` : ''}
            </div>
            <p class="log-card-name">${esc(titleLine)}</p>
            ${q.statementText ? `<p class="log-card-detail">${esc(q.statementText.slice(0, 90))}${q.statementText.length > 90 ? '…' : ''}</p>` : ''}
          </div>
          <div class="log-card-actions">
            ${state.questionSubTab === 'active'
              ? `<button type="button" class="btn-chip" data-action="open-redo-question" data-id="${q.id}">${ICONS.repeat.replace('class="icon"', 'class="icon icon-sm"')}Refazer</button>`
              : `<button type="button" class="btn-chip" data-action="revive-question" data-id="${q.id}">${ICONS.rotateCcw.replace('class="icon"', 'class="icon icon-sm"')}Reativar</button>`}
            <button type="button" class="btn-chip btn-chip-danger" data-action="delete-question" data-id="${q.id}">${ICONS.trash.replace('class="icon"', 'class="icon icon-sm"')}Excluir</button>
          </div>
        </div>`;
      }).join('') + `</div>`;
    }

    return `
      <div class="section-header" style="margin-top:-0.5rem">
        <div class="sub-tabs">
          <button type="button" class="sub-tab${state.questionSubTab === 'active' ? ' active' : ''}" data-action="switch-question-subtab" data-tab="active">Ativas <span class="sub-tab-count">${activeQs.length}</span></button>
          <button type="button" class="sub-tab${state.questionSubTab === 'graduated' ? ' active' : ''}" data-action="switch-question-subtab" data-tab="graduated">Graduadas <span class="sub-tab-count">${graduatedQs.length}</span></button>
        </div>
        <button type="button" class="btn btn-card-outline" data-action="open-add-question">
          ${ICONS.plus.replace('class="icon"', 'class="icon icon-sm"')}
          Salvar questão
        </button>
      </div>
      ${filterBarHtml}
      ${listHtml}`;
  }

  function renderQuestionReviewScreen() {
    const container = document.getElementById('screen-question-review');
    const now = Date.now();

    const dueTopics = state.topicReviews.filter(t => t.nextReviewAt && t.nextReviewAt <= now).map(t => Object.assign({ kind: 'topic' }, t));
    const dueQuestions = state.questionBank.filter(q => !q.retired && q.nextReviewAt && q.nextReviewAt <= now).map(q => Object.assign({ kind: 'question' }, q));
    const dueQueue = interleaveBySubject(dueTopics.concat(dueQuestions).sort((a, b) => a.nextReviewAt - b.nextReviewAt));

    const upcoming = state.topicReviews.filter(t => t.nextReviewAt && t.nextReviewAt > now).map(t => Object.assign({ kind: 'topic' }, t))
      .concat(state.questionBank.filter(q => !q.retired && q.nextReviewAt && q.nextReviewAt > now).map(q => Object.assign({ kind: 'question' }, q)))
      .sort((a, b) => a.nextReviewAt - b.nextReviewAt)
      .slice(0, 10);

    const activeQuestionsCount = state.questionBank.filter(q => !q.retired).length;

    let body;
    if (state.reviewTab === 'today') body = renderReviewTodayHtml(dueQueue, upcoming);
    else if (state.reviewTab === 'topics') body = renderReviewTopicsHtml();
    else body = renderReviewQuestionsHtml();

    container.innerHTML = `
      <div class="screen">
        <div class="screen-header">
          <div>
            <h2>Revisão de Questões</h2>
            <p>Motor de repetição espaçada para tópicos e questões que valem uma nova rodada.</p>
          </div>
          <button type="button" class="btn btn-primary" data-action="open-add-round">
            ${ICONS.plus.replace('class="icon"', 'class="icon icon-sm"')}
            Registrar rodada
          </button>
        </div>

        <div class="review-stats-row">
          <div class="review-stat-chip${dueQueue.length > 0 ? ' is-due' : ''}">
            <span class="review-stat-chip-num">${dueQueue.length}</span>
            <span class="review-stat-chip-label">Para revisar hoje</span>
          </div>
          <div class="review-stat-chip">
            <span class="review-stat-chip-num">${state.topicReviews.length}</span>
            <span class="review-stat-chip-label">Tópicos acompanhados</span>
          </div>
          <div class="review-stat-chip">
            <span class="review-stat-chip-num">${activeQuestionsCount}</span>
            <span class="review-stat-chip-label">Questões no banco</span>
          </div>
        </div>

        <div class="sub-tabs">
          <button type="button" class="sub-tab${state.reviewTab === 'today' ? ' active' : ''}" data-action="switch-review-tab" data-tab="today">Hoje</button>
          <button type="button" class="sub-tab${state.reviewTab === 'topics' ? ' active' : ''}" data-action="switch-review-tab" data-tab="topics">Tópicos <span class="sub-tab-count">${state.topicReviews.length}</span></button>
          <button type="button" class="sub-tab${state.reviewTab === 'questions' ? ' active' : ''}" data-action="switch-review-tab" data-tab="questions">Questões <span class="sub-tab-count">${activeQuestionsCount}</span></button>
        </div>

        ${body}
      </div>`;

    const topicSel = document.getElementById('review-filter-subject-topics');
    const qSel = document.getElementById('review-filter-subject-questions');
    if (topicSel) topicSel.addEventListener('change', () => { state.reviewFilterSubjectTopics = topicSel.value; render(); });
    if (qSel) qSel.addEventListener('change', () => { state.reviewFilterSubjectQuestions = qSel.value; render(); });
  }

  // --- Add round modal (creates or updates a topic's aggregate engine) ---
  function modalRoundHtml() {
    const subjectNames = state.subjects.map(s => s.name);
    const prefillSubject = state.roundPrefillSubject || '';
    const allSubjects = Array.from(new Set(subjectNames.concat([prefillSubject]).filter(Boolean)));
    const isCustomInitially = !!prefillSubject && !subjectNames.includes(prefillSubject);
    const subjectOptionsHtml = allSubjects.map(s =>
      `<option value="${esc(s)}"${!isCustomInitially && s === prefillSubject ? ' selected' : ''}>${esc(s)}</option>`
    ).join('');

    const body = `
      <div id="round-form">
        <div class="field">
          <label for="input-round-subject">Matéria</label>
          <div class="select-wrap">
            <select id="input-round-subject" class="select-input">
              ${subjectOptionsHtml}
              <option value="__custom__"${isCustomInitially ? ' selected' : ''}>Outra (digitar)</option>
            </select>
            <span class="select-chevron">${ICONS.chevronDown}</span>
          </div>
          <input id="input-round-subject-custom" class="text-input font-medium" style="margin-top:0.5rem;${isCustomInitially ? '' : 'display:none'}" type="text" placeholder="Nome da matéria" value="${isCustomInitially ? esc(prefillSubject) : ''}">
        </div>
        <div class="field">
          <label for="input-round-topic">Tópico</label>
          <input id="input-round-topic" class="text-input font-medium" type="text" placeholder="ex: Cinemática" value="${esc(state.roundPrefillTopic || '')}">
          <p class="field-help">Se já existir um tópico com essa matéria + esse nome, a rodada entra no histórico dele. Senão, cria um novo.</p>
        </div>
        <div class="field">
          <label for="input-round-count">Quantas questões você fez</label>
          <input id="input-round-count" class="text-input" type="number" min="1" placeholder="ex: 12">
        </div>
        <div class="field">
          <label for="input-round-wrong">Quantas você errou</label>
          <input id="input-round-wrong" class="text-input" type="number" min="0" placeholder="ex: 3">
        </div>
        ${ratingRow('round-difficulty', 'Dificuldade sentida', 3, 'Muito difícil', 'Muito fácil')}
        <div id="round-error"></div>
        <div class="modal-form-actions">
          <button type="button" class="btn-secondary-block" data-action="close-modal">Cancelar</button>
          <button type="button" class="btn-save-flex" id="round-save-btn" disabled>Registrar rodada</button>
        </div>
      </div>`;
    return modalShell('Registrar rodada de questões', body);
  }

  function wireRoundModal() {
    const subjectSelect = document.getElementById('input-round-subject');
    const customInput = document.getElementById('input-round-subject-custom');
    const topicInput = document.getElementById('input-round-topic');
    const countInput = document.getElementById('input-round-count');
    const wrongInput = document.getElementById('input-round-wrong');
    const errorBox = document.getElementById('round-error');
    const saveBtn = document.getElementById('round-save-btn');
    let difficulty = 3;

    function toggleCustom() { customInput.style.display = subjectSelect.value === '__custom__' ? '' : 'none'; }
    function resolvedSubject() { return subjectSelect.value === '__custom__' ? customInput.value.trim() : subjectSelect.value; }

    function refresh() {
      const count = parseInt(countInput.value, 10);
      const wrong = parseInt(wrongInput.value, 10);
      errorBox.innerHTML = '';
      let ok = resolvedSubject().length > 0 && topicInput.value.trim().length > 0 && count > 0 && !isNaN(wrong) && wrong >= 0;
      if (ok && wrong > count) {
        ok = false;
        errorBox.innerHTML = `<div class="error-box">${ICONS.alertCircle}<p>O número de erradas não pode ser maior que o total de questões.</p></div>`;
      }
      saveBtn.disabled = !ok;
    }

    subjectSelect.addEventListener('change', () => { toggleCustom(); refresh(); });
    customInput.addEventListener('input', refresh);
    topicInput.addEventListener('input', refresh);
    countInput.addEventListener('input', refresh);
    wrongInput.addEventListener('input', refresh);
    document.querySelectorAll('[data-rating-group="round-difficulty"]').forEach(btn => {
      btn.addEventListener('click', () => {
        difficulty = parseInt(btn.getAttribute('data-value'), 10);
        document.querySelectorAll('[data-rating-group="round-difficulty"]').forEach(b =>
          b.classList.toggle('active', parseInt(b.getAttribute('data-value'), 10) <= difficulty));
        refresh();
      });
    });
    toggleCustom();
    refresh();

    saveBtn.addEventListener('click', () => {
      const subject = resolvedSubject();
      const topic = topicInput.value.trim();
      const count = parseInt(countInput.value, 10);
      const wrong = parseInt(wrongInput.value, 10);
      if (!subject || !topic || !(count > 0) || isNaN(wrong) || wrong < 0 || wrong > count) return;

      const norm = (s) => s.trim().toLowerCase();
      const existing = state.topicReviews.find(t => norm(t.subject) === norm(subject) && norm(t.topic) === norm(topic));
      if (existing) {
        state.topicReviews = state.topicReviews.map(t => t.id === existing.id ? applyTopicRound(t, count, wrong, difficulty) : t);
      } else {
        const fresh = { id: uid(), subject, topic, n: 0, EF: 2.5, intervalDays: 1, totalRounds: 0, history: [] };
        state.topicReviews = state.topicReviews.concat([applyTopicRound(fresh, count, wrong, difficulty)]);
      }
      state.roundPrefillSubject = null;
      state.roundPrefillTopic = null;
      state.activeModal = null;
      saveState(state);
      render();
    });
  }

  // --- Add question modal (bookmark a question to redo later, image and/or text) ---
  function modalQuestionHtml() {
    const subjectNames = state.subjects.map(s => s.name);
    const subjectOptionsHtml = subjectNames.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    const body = `
      <div id="question-form">
        <div class="field">
          <label for="input-question-subject">Matéria (opcional)</label>
          <div class="select-wrap">
            <select id="input-question-subject" class="select-input">
              <option value="">Sem matéria</option>
              ${subjectOptionsHtml}
            </select>
            <span class="select-chevron">${ICONS.chevronDown}</span>
          </div>
        </div>
        <div class="field">
          <label for="input-question-topic">Tópico (opcional)</label>
          <input id="input-question-topic" class="text-input font-medium" type="text" placeholder="ex: Termoquímica">
        </div>
        <div class="field">
          <label for="input-question-statement">Enunciado (opcional se anexar imagem)</label>
          <textarea id="input-question-statement" class="textarea-input" rows="4" placeholder="Cole o enunciado, se quiser"></textarea>
        </div>
        <div class="field">
          <label>Imagem (opcional se escreveu o enunciado)</label>
          <div id="question-image-area">
            <label class="image-drop" id="question-image-drop">
              ${ICONS.image}
              <span>Toque para escolher uma foto/print</span>
              <input type="file" id="input-question-image" accept="image/*">
            </label>
          </div>
        </div>
        <div class="field">
          <label for="input-question-answer">Gabarito (opcional)</label>
          <input id="input-question-answer" class="text-input font-medium" type="text" placeholder="ex: C, 42, Verdadeiro" maxlength="200">
        </div>
        <div id="question-error"></div>
        <div class="modal-form-actions">
          <button type="button" class="btn-secondary-block" data-action="close-modal">Cancelar</button>
          <button type="button" class="btn-save-flex" id="question-save-btn" disabled>Salvar questão</button>
        </div>
      </div>`;
    return modalShell('Salvar questão para refazer', body);
  }

  function wireQuestionModal() {
    const subjectSelect = document.getElementById('input-question-subject');
    const topicInput = document.getElementById('input-question-topic');
    const statementInput = document.getElementById('input-question-statement');
    const imageArea = document.getElementById('question-image-area');
    const errorBox = document.getElementById('question-error');
    const saveBtn = document.getElementById('question-save-btn');
    let imageData = null;

    function refresh() {
      saveBtn.disabled = !(statementInput.value.trim().length > 0 || !!imageData);
    }

    function wireFileInput() {
      const input = document.getElementById('input-question-image');
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        errorBox.innerHTML = '';
        resizeImageFile(file, 1000, 0.75).then((dataUrl) => {
          imageData = dataUrl;
          imageArea.innerHTML = `
            <div class="image-preview-wrap">
              <img src="${imageData}" alt="">
              <button type="button" class="image-preview-remove" id="question-image-remove">${ICONS.x}</button>
            </div>`;
          document.getElementById('question-image-remove').addEventListener('click', () => {
            imageData = null;
            restoreDropzone();
            refresh();
          });
          refresh();
        }).catch(() => {
          errorBox.innerHTML = `<div class="error-box">${ICONS.alertCircle}<p>Não consegui ler essa imagem. Tente outra.</p></div>`;
        });
      });
    }

    function restoreDropzone() {
      imageArea.innerHTML = `
        <label class="image-drop" id="question-image-drop">
          ${ICONS.image}
          <span>Toque para escolher uma foto/print</span>
          <input type="file" id="input-question-image" accept="image/*">
        </label>`;
      wireFileInput();
    }

    wireFileInput();
    statementInput.addEventListener('input', refresh);
    refresh();

    saveBtn.addEventListener('click', () => {
      const subject = subjectSelect.value || '';
      const topic = topicInput.value.trim();
      const statementText = statementInput.value.trim();
      const answerKey = document.getElementById('input-question-answer').value.trim();
      if (!statementText && !imageData) return;
      const now = Date.now();
      const fresh = {
        id: uid(), subject, topic, statementText, imageData, answerKey,
        createdAt: now, n: 0, EF: 2.5, intervalDays: 0,
        lastReviewedAt: null, nextReviewAt: now, retired: false, history: [],
      };
      state.questionBank = state.questionBank.concat([fresh]);
      state.activeModal = null;
      saveState(state);
      render();
    });
  }

  // --- Redo modal (grades a bookmarked question: Errei / Difícil / Fácil) ---
  function modalRedoHtml(q) {
    const preview = `
      <div class="review-question-preview">
        ${q.imageData ? `<img src="${q.imageData}" alt="">` : ''}
        ${q.statementText ? `<p>${esc(q.statementText)}</p>` : ''}
        ${(q.subject || q.topic) ? `<p class="field-help">${esc([q.subject, q.topic].filter(Boolean).join(' · '))}</p>` : ''}
      </div>`;
    const answerBlock = q.answerKey ? (
      state.answerRevealed
        ? `<div class="review-answer-key"><span class="review-answer-key-label">Gabarito</span><span class="review-answer-key-value">${esc(q.answerKey)}</span></div>`
        : `<button type="button" class="btn-chip" data-action="toggle-answer-reveal" style="margin-bottom:1rem">${ICONS.eye.replace('class="icon"', 'class="icon icon-sm"')}Ver gabarito</button>`
    ) : '';
    const body = `
      ${preview}
      ${answerBlock}
      <p class="field-help" style="margin-bottom:0.5rem">Como foi dessa vez?</p>
      <div class="quality-buttons">
        <button type="button" class="quality-btn quality-btn-wrong" data-action="grade-question" data-id="${q.id}" data-result="wrong">${ICONS.x}Errei</button>
        <button type="button" class="quality-btn quality-btn-hard" data-action="grade-question" data-id="${q.id}" data-result="hard">${ICONS.alertCircle}Difícil</button>
        <button type="button" class="quality-btn quality-btn-easy" data-action="grade-question" data-id="${q.id}" data-result="easy">${ICONS.check}Fácil</button>
      </div>
      <div class="modal-form-actions" style="margin-top:1.5rem">
        <button type="button" class="btn-secondary-block" data-action="close-modal">Cancelar</button>
      </div>`;
    return modalShell('Refazer questão', body);
  }

  // ---------- GLOBAL EVENT DELEGATION ----------
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');

    switch (action) {
      case 'open-log-time':
        state.activeModal = 'log-time';
        render();
        break;
      case 'reset-cycle':
        state.subjects = state.subjects.map(s => Object.assign({}, s, { completedHours: 0 }));
        saveState(state);
        render();
        break;
      case 'edit-subject':
        state.editingSubjectId = target.getAttribute('data-id');
        state.activeModal = 'edit-subject';
        render();
        break;
      case 'close-modal':
        state.activeModal = null;
        render();
        break;
      case 'close-modal-backdrop':
        if (e.target === target) {
          state.activeModal = null;
          render();
        }
        break;

      // --- navigation ---
      case 'switch-screen':
        state.screen = target.getAttribute('data-screen');
        render();
        break;

      // --- Study Log ---
      case 'add-log':
        state.editingLogId = null;
        state.activeModal = 'add-log';
        render();
        break;
      case 'edit-log':
        state.editingLogId = target.getAttribute('data-id');
        state.activeModal = 'edit-log';
        render();
        break;
      case 'complete-log':
        state.studyLogs = state.studyLogs.map(l => l.id === target.getAttribute('data-id') ? Object.assign({}, l, { status: 'completed' }) : l);
        saveState(state);
        render();
        break;
      case 'reactivate-log':
        state.studyLogs = state.studyLogs.map(l => l.id === target.getAttribute('data-id') ? Object.assign({}, l, { status: 'active' }) : l);
        saveState(state);
        render();
        break;
      case 'switch-log-tab':
        state.studyLogTab = target.getAttribute('data-tab');
        render();
        break;
      case 'show-next-material':
        state.nextMaterialSubject = target.getAttribute('data-subject');
        state.activeModal = 'next-material';
        render();
        break;
      case 'continue-log':
        // "Continuar" opens the log for editing, so the user can update
        // where they stopped (chapter/page, episode/timestamp, exercise).
        state.editingLogId = target.getAttribute('data-id');
        state.activeModal = 'edit-log';
        render();
        break;
      case 'add-log-for-subject':
        state.editingLogId = null;
        state.prefillLogSubject = target.getAttribute('data-subject');
        state.activeModal = 'add-log';
        render();
        break;

      // --- Error Log ---
      case 'add-error':
        state.editingErrorId = null;
        state.activeModal = 'add-error';
        render();
        break;
      case 'edit-error':
        state.editingErrorId = target.getAttribute('data-id');
        state.activeModal = 'edit-error';
        render();
        break;
      case 'delete-error':
        state.errorLogs = state.errorLogs.filter(e => e.id !== target.getAttribute('data-id'));
        saveState(state);
        render();
        break;
      case 'clear-error-filters':
        state.errorFilterSubject = '';
        state.errorFilterType = '';
        render();
        break;
      case 'clear-log-filters':
        state.studyLogFilterSubject = '';
        state.studyLogFilterCategory = '';
        render();
        break;

      // --- Question Review ---
      case 'switch-review-tab':
        state.reviewTab = target.getAttribute('data-tab');
        render();
        break;
      case 'switch-question-subtab':
        state.questionSubTab = target.getAttribute('data-tab');
        render();
        break;
      case 'open-add-round':
        state.roundPrefillSubject = target.getAttribute('data-subject') || null;
        state.roundPrefillTopic = target.getAttribute('data-topic') || null;
        state.activeModal = 'add-round';
        render();
        break;
      case 'open-add-question':
        state.activeModal = 'add-question';
        render();
        break;
      case 'open-redo-question':
        state.redoingQuestionId = target.getAttribute('data-id');
        state.answerRevealed = false; // esconde o gabarito de novo a cada nova rodada, pra forçar o autoteste antes
        state.activeModal = 'redo-question';
        render();
        break;
      case 'toggle-answer-reveal':
        state.answerRevealed = true;
        render();
        break;
      case 'grade-question': {
        const gId = target.getAttribute('data-id');
        const result = target.getAttribute('data-result');
        state.questionBank = state.questionBank.map(q => q.id === gId ? applyQuestionRedo(q, result) : q);
        state.redoingQuestionId = null;
        state.activeModal = null;
        saveState(state);
        render();
        break;
      }
      case 'delete-topic-review':
        state.topicReviews = state.topicReviews.filter(t => t.id !== target.getAttribute('data-id'));
        saveState(state);
        render();
        break;
      case 'delete-question':
        state.questionBank = state.questionBank.filter(q => q.id !== target.getAttribute('data-id'));
        saveState(state);
        render();
        break;
      case 'revive-question':
        state.questionBank = state.questionBank.map(q => q.id === target.getAttribute('data-id')
          ? Object.assign({}, q, { retired: false, n: 0, nextReviewAt: Date.now() })
          : q);
        saveState(state);
        render();
        break;
      case 'clear-review-filter-topics':
        state.reviewFilterSubjectTopics = '';
        render();
        break;
      case 'clear-review-filter-questions':
        state.reviewFilterSubjectQuestions = '';
        render();
        break;
    }
  });

  document.getElementById('sync-btn').addEventListener('click', () => {
    syncNow();
  });

  document.getElementById('settings-btn').addEventListener('click', () => {
    state.activeModal = 'settings';
    render();
  });

  document.getElementById('add-subject-btn').addEventListener('click', () => {
    state.editingSubjectId = null;
    state.activeModal = 'add-subject';
    render();
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    state.isDark = !state.isDark;
    document.documentElement.classList.toggle('dark', state.isDark);
    document.querySelector('.icon-moon').style.display = state.isDark ? 'none' : '';
    document.querySelector('.icon-sun').style.display = state.isDark ? '' : 'none';
    saveState(state);
  });

  // Close modal on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.activeModal) {
      state.activeModal = null;
      render();
      return;
    }
    // Keyboard activation for non-native buttons (e.g. the clickable
    // "next study" chip, which is a div so its visual design stays
    // untouched) — Enter/Space don't auto-fire click on those.
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) {
      e.preventDefault();
      e.target.click();
    }
  });

  // ---------- INIT ----------
  loadState().then(saved => {
    if (saved) {
      if (Array.isArray(saved.subjects)) state.subjects = saved.subjects;
      if (saved.settings) state.settings = Object.assign({}, INITIAL_SETTINGS, saved.settings);
      if (typeof saved.studyCounter === 'number') state.studyCounter = saved.studyCounter;
      if (Array.isArray(saved.studyLogs)) state.studyLogs = saved.studyLogs;
      if (Array.isArray(saved.errorLogs)) state.errorLogs = saved.errorLogs;
      if (Array.isArray(saved.topicReviews)) state.topicReviews = saved.topicReviews;
      if (Array.isArray(saved.questionBank)) state.questionBank = saved.questionBank;
      if (typeof saved.isDark === 'boolean') state.isDark = saved.isDark;
      if (typeof saved.lastModifiedAt === 'number') state.lastModifiedAt = saved.lastModifiedAt;
      if (typeof saved.lastSyncedAt === 'number') state.lastSyncedAt = saved.lastSyncedAt;
    }
    // Subjects saved before "lastStudiedAt" existed won't have it — default
    // to 0 (never studied) so tie-breaking in generateSequence doesn't break.
    state.subjects = state.subjects.map(s => Object.assign({ lastStudiedAt: 0 }, s));
    document.documentElement.classList.toggle('dark', state.isDark);
    document.querySelector('.icon-moon').style.display = state.isDark ? 'none' : '';
    document.querySelector('.icon-sun').style.display = state.isDark ? '' : 'none';
    render();
    renderSyncStatus();
  });

  // ---------- SERVICE WORKER (offline support + update check) ----------
  if ('serviceWorker' in navigator) {
    // If a controller already exists when the page loads, this browser has
    // an active Service Worker from a previous visit — so a future
    // 'controllerchange' event really means "a newer version just took
    // over". On the very first-ever install there's no prior controller,
    // and we must NOT show an "update available" toast for that case.
    const hadController = !!navigator.serviceWorker.controller;

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        // Ask the browser to check for a new sw.js right away (and again
        // whenever the tab regains focus), so updates are picked up
        // whenever there's internet — without the user having to close
        // and reopen the app.
        reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      }).catch(() => {
        // Registration can fail (e.g. unsupported host); the app still
        // works normally online, just without offline caching.
      });

      if (hadController) {
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          const toast = document.getElementById('update-toast');
          toast.hidden = false;
          setTimeout(() => window.location.reload(), 600);
        });
      }
    });
  }
})();
