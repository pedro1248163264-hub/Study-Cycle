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

  function saveState(s) {
    const data = {
      subjects: s.subjects,
      settings: s.settings,
      isDark: s.isDark,
    };
    openDatabase().then(db => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(data, STATE_KEY);
    }).catch(() => {});
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

  // ---------- INITIAL DATA ----------
  const INITIAL_SUBJECTS = [];
  const INITIAL_SETTINGS = {
    weeklyHours: 0,
    minHoursPerSubject: 1,
  };

  // ---------- STATE ----------
  const state = {
    subjects: JSON.parse(JSON.stringify(INITIAL_SUBJECTS)),
    settings: Object.assign({}, INITIAL_SETTINGS),
    activeModal: null,
    editingSubjectId: null,
    isDark: false,
  };

  // ---------- HELPERS ----------

  // Splits the weekly hours across subjects proportionally to how "needy"
  // each one is (difficulty + content + importance — higher rating = more
  // hours). Each subject's natural share is rounded half-up (5.5 -> 6,
  // 5.4 -> 5). If a subject's natural share falls below the configured
  // minimum, it's bumped up to that minimum — which can push the overall
  // total a little past the weekly hours target, and that's expected.
  function calculateAllocations(subjects, settings) {
    const totalWeight = subjects.reduce((sum, s) => sum + (s.difficulty + s.content + s.importance), 0);

    return subjects.map(s => {
      const weight = s.difficulty + s.content + s.importance;
      const naturalShare = totalWeight > 0
        ? Math.round(settings.weeklyHours * (weight / totalWeight))
        : 0;
      const allocated = Math.max(naturalShare, settings.minHoursPerSubject);
      return Object.assign({}, s, { allocated });
    });
  }

  function generateSequence(allocatedSubjects) {
    const sequence = [];
    const pools = allocatedSubjects.map(s => ({
      id: s.id,
      name: s.name,
      colorIndex: s.colorIndex,
      remaining: Math.max(0, s.allocated - s.completedHours),
    }));

    let lastPickedId = null;

    while (pools.some(p => p.remaining > 0)) {
      pools.sort((a, b) => b.remaining - a.remaining);

      let candidate = pools.find(p => p.id !== lastPickedId && p.remaining > 0);
      if (!candidate) {
        candidate = pools.find(p => p.remaining > 0);
      }

      if (candidate) {
        sequence.push({ id: candidate.id, name: candidate.name, colorIndex: candidate.colorIndex });
        candidate.remaining -= 1;
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
    renderCycleOverview(d);
    renderSequence(d);
    renderSubjects(d);
    renderModal(d);
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
          <div class="next-study-chip subject-color-${d.nextStudy.colorIndex}">
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
      state.subjects = state.subjects.map(s => s.id === subjectId ? Object.assign({}, s, { completedHours: s.completedHours + hours }) : s);
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
    }
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
    }
  });

  // ---------- INIT ----------
  loadState().then(saved => {
    if (saved) {
      if (Array.isArray(saved.subjects)) state.subjects = saved.subjects;
      if (saved.settings) state.settings = saved.settings;
      if (typeof saved.isDark === 'boolean') state.isDark = saved.isDark;
    }
    document.documentElement.classList.toggle('dark', state.isDark);
    document.querySelector('.icon-moon').style.display = state.isDark ? 'none' : '';
    document.querySelector('.icon-sun').style.display = state.isDark ? '' : 'none';
    render();
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
