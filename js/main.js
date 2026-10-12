/* =========================================================
   Study Cycle — ações, eventos e inicialização

   Todo botão da interface declara o que faz com data-action="nome"
   (+ data-* com os parâmetros). Aqui ficam as ações genéricas; para
   uma ação nova basta adicionar uma entrada em SC.actions.

     modal   data-modal="nome" [data-id=...]    abre um modal
     set     data-key="aba" data-value="x"      muda aba / tela (state.ui)
     remove  data-col="lista" data-id [data-confirm="pergunta"]
     patch   data-col="lista" data-id data-set='{"campo":"valor"}'
   ========================================================= */
(function () {
  'use strict';
  const SC = window.SC;
  const { state, col, saveState, render, commit, closeModal } = SC;

  const persist = () => { saveState(); render(); };

  Object.assign(SC.actions, {
    modal(el) {
      const props = Object.assign({}, el.dataset);
      const name = props.modal;
      delete props.modal; delete props.action;
      SC.openModal(name, props);
    },
    'close-modal': closeModal,

    set(el) { state.ui[el.dataset.key] = el.dataset.value; render(); },
    'clear-filters'(el) { state.ui.filters[el.dataset.group] = {}; render(); },

    remove(el) {
      if (el.dataset.confirm && !confirm(el.dataset.confirm)) return;
      col.remove(el.dataset.col, el.dataset.id);
      persist();
    },
    patch(el) {
      col.patch(el.dataset.col, el.dataset.id, JSON.parse(el.dataset.set));
      persist();
    },

    'reset-cycle'() {
      state.subjects = state.subjects.map((s) => Object.assign({}, s, { completedHours: 0 }));
      state.currentBlock = null;
      persist();
    },

    // Questão do banco de revisão
    revive(el) { col.patch('questionBank', el.dataset.id, { retired: false, n: 0, nextReviewAt: Date.now() }); persist(); },
    reveal(el) { state.modal[el.dataset.what] = true; render(); }, // mostra gabarito/resolução
    grade(el) {
      const q = col.find('questionBank', el.dataset.id);
      commit(() => col.put('questionBank', SC.applyQuestionRedo(q, el.dataset.result)));
    },

    // Cabeçalho
    sync: () => SC.syncNow(),
    theme() { state.isDark = !state.isDark; SC.applyTheme(); saveState(); },
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    const fn = el && SC.actions[el.dataset.action];
    if (fn) fn(el, e);
  });

  // Filtros: <select data-filter="grupo.campo">
  document.addEventListener('change', (e) => {
    const sel = e.target.closest && e.target.closest('select[data-filter]');
    if (!sel) return;
    const [group, field] = sel.dataset.filter.split('.');
    state.ui.filters[group][field] = sel.value;
    render();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.modal) { closeModal(); return; }
    // Enter/Espaço em "botões" que não são <button> (ex.: chip "Próxima matéria").
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) {
      e.preventDefault();
      e.target.click();
    }
  });

  // ---------- INICIALIZAÇÃO ----------
  SC.loadState().then((saved) => {
    if (saved) {
      SC.applyData(saved);
      if (typeof saved.lastModifiedAt === 'number') state.lastModifiedAt = saved.lastModifiedAt;
      if (typeof saved.lastSyncedAt === 'number') state.lastSyncedAt = saved.lastSyncedAt;
    } else {
      SC.applyData({});
    }
    SC.applyTheme();
    render();
  });

  // Pede ao navegador para não apagar os dados do app quando faltar espaço
  // (o Safari, por exemplo, limpa dados de sites sem uso por ~7 dias).
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // Service Worker: deixa o app abrir offline (veja sw.js).
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
