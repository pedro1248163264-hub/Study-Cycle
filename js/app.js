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
        if (rd.settings) state.settings = rd.settings;
        if (typeof rd.studyCounter === 'number') state.studyCounter = rd.studyCounter;
        if (Array.isArray(rd.studyLogs)) state.studyLogs = rd.studyLogs;
        if (Array.isArray(rd.errorLogs)) state.errorLogs = rd.errorLogs;
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

    // --- Navigation (Study Cycle is untouched; these are additive screens) ---
    screen: 'dashboard', // 'dashboard' | 'study-log' | 'error-log'

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

  // Builds the suggested study order: always the subject with the most
  // hours left, never the same subject twice in a row (unless it's the
  // only one with hours left). When two or more subjects are tied on
  // hours remaining, the one that has gone longest without being
  // studied in real life wins the tie — not just whichever happens to
  // be first in the list.
  function generateSequence(allocatedSubjects) {
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

    let lastPickedId = null;
    // Local clock for this simulated run: once a subject is picked here,
    // it's treated as "just studied" for tie-breaking the rest of this
    // same sequence, without touching the subject's real recency data.
    let simClock = pools.reduce((max, p) => Math.max(max, p.recency), 0);

    while (pools.some(p => p.remaining > 0)) {
      pools.sort((a, b) => {
        if (b.remaining !== a.remaining) return b.remaining - a.remaining;
        return a.recency - b.recency; // tie: longest-waiting subject goes first
      });

      let candidate = pools.find(p => p.id !== lastPickedId && p.remaining > 0);
      if (!candidate) {
        candidate = pools.find(p => p.remaining > 0);
      }

      if (candidate) {
        sequence.push({ id: candidate.id, name: candidate.name, colorIndex: candidate.colorIndex });
        candidate.remaining -= 1;
        simClock += 1;
        candidate.recency = simClock;
        lastPickedId = candidate.id;
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

  // ---------- DERIVED STATE ----------
  function getDerived() {
    const allocatedSubjects = calculateAllocations(state.subjects, state.settings);
    const sequence = generateSequence(allocatedSubjects);
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

    if (state.screen === 'dashboard') {
      // --- Study Cycle: existing, finished feature — logic untouched ---
      renderCycleOverview(d);
      renderSequence(d);
      renderSubjects(d);
    } else if (state.screen === 'study-log') {
      renderStudyLogScreen();
    } else if (state.screen === 'error-log') {
      renderErrorLogScreen();
    }

    renderModal(d);
  }

  function renderNav() {
    const NAV_ITEMS = [
      { key: 'dashboard', label: 'Study Cycle', icon: ICONS.layoutDashboard },
      { key: 'study-log', label: 'Study Log', icon: ICONS.bookMarked },
      { key: 'error-log', label: 'Error Log', icon: ICONS.alertTriangle },
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
        <div id="settings-error"></div>
        <button type="button" id="settings-save-btn" class="btn-primary-block settings-save">Salvar configurações</button>
      </div>`;
    return modalShell('Configurações do ciclo', body);
  }

  function wireSettingsModal() {
    const weeklyInput = document.getElementById('input-weekly');
    const minInput = document.getElementById('input-min-hours');
    const errorBox = document.getElementById('settings-error');
    const saveBtn = document.getElementById('settings-save-btn');
    const subjectsCount = state.subjects.length;

    function refresh() {
      const weekly = parseInt(weeklyInput.value, 10) || 0;
      const minHours = parseInt(minInput.value, 10) || 0;
      const totalMin = subjectsCount * minHours;
      const hasError = totalMin > weekly;

      errorBox.innerHTML = hasError ? `
        <div class="error-box">
          ${ICONS.alertCircle}
          <p>Com ${subjectsCount} matérias e um mínimo de ${minHours}h cada, você precisa de pelo menos ${totalMin}h. Aumente o total de horas semanais ou diminua o mínimo.</p>
        </div>` : '';

      saveBtn.disabled = hasError;
    }

    weeklyInput.addEventListener('input', refresh);
    minInput.addEventListener('input', refresh);
    refresh();

    saveBtn.addEventListener('click', () => {
      const weekly = parseInt(weeklyInput.value, 10) || 0;
      const minHours = parseInt(minInput.value, 10) || 0;
      if (subjectsCount * minHours > weekly) return;
      state.settings = { weeklyHours: weekly, minHoursPerSubject: minHours };
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
      if (saved.settings) state.settings = saved.settings;
      if (typeof saved.studyCounter === 'number') state.studyCounter = saved.studyCounter;
      if (Array.isArray(saved.studyLogs)) state.studyLogs = saved.studyLogs;
      if (Array.isArray(saved.errorLogs)) state.errorLogs = saved.errorLogs;
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
