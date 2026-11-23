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

  // Nenhuma ação pode rodar antes do IndexedDB devolver o estado salvo:
  // um clique no ⟳ nessa janela poderia empurrar um estado vazio para a nuvem.
  let ready = false;

  Object.assign(SC.actions, {
    modal(el) {
      const props = Object.assign({}, el.dataset);
      const name = props.modal;
      delete props.modal; delete props.action;
      SC.openModal(name, props);
    },
    'close-modal': closeModal,

    'start-queue': () => SC.startQueue(),

    set(el) { state.ui[el.dataset.key] = el.dataset.value; render({ screenOnly: true }); },
    'clear-filters'(el) { state.ui.filters[el.dataset.group] = {}; render({ screenOnly: true }); },

    remove(el) {
      if (el.dataset.confirm && !confirm(el.dataset.confirm)) return;
      const item = el.dataset.col === 'exerciseLists' ? col.find('exerciseLists', el.dataset.id) : null;
      col.remove(el.dataset.col, el.dataset.id);
      if (item) { // PDF guardado à parte: aparelho + nuvem
        SC.files.remove(el.dataset.id);
        if (item.pdf && item.pdf.path) SC.cloud.remove(item.pdf.path);
      }
      persist();
    },
    patch(el) {
      // data-set vem de HTML: um JSON quebrado não pode travar a ação.
      let changes;
      try { changes = JSON.parse(el.dataset.set); } catch (e) { return; }
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return;
      col.patch(el.dataset.col, el.dataset.id, changes);
      persist();
    },

    // Pausa/retoma uma matéria: ela sai (ou volta) do ciclo, sem perder nada.
    'toggle-pause'(el) {
      const s = col.find('subjects', el.dataset.id);
      if (!s) return;
      col.patch('subjects', s.id, { paused: !s.paused });
      // Bloco em andamento de uma matéria pausada não faz mais sentido.
      if (!s.paused && state.currentBlock && state.currentBlock.subjectId === s.id) state.currentBlock = null;
      persist();
    },

    'reset-cycle'() {
      if (!confirm('Reiniciar o ciclo? As horas concluídas de todas as matérias serão zeradas.')) return;
      state.subjects = state.subjects.map((s) => Object.assign({}, s, { completedHours: 0 }));
      state.currentBlock = null;
      persist();
    },

    // Revisão: questão do banco e lista de exercícios
    // Voltou da graduação: recomeça do zero, senão o EF antigo fazia o
    // primeiro intervalo já sair enorme com n = 0.
    revive(el) {
      col.patch('questionBank', el.dataset.id, { retired: false, n: 0, EF: 2.5, intervalDays: 0, nextReviewAt: Date.now() });
      persist();
    },
    reveal(el) {
      if (!state.modal) return; // ação só existe dentro do modal
      state.modal[el.dataset.what] = true;
      render({ modalOnly: true }); // mostra gabarito/resolução sem redesenhar a tela
    },
    // Nota de uma questão do banco (Errei / Difícil / Fácil). Listas de
    // exercícios são avaliadas dentro do próprio modal (modals.js, listRedo).
    grade(el) {
      const item = col.find('questionBank', el.dataset.id);
      if (!item) return;
      commit(() => col.put('questionBank', SC.applyQuestionRedo(item, el.dataset.result)));
    },

    // Modal "Próxima matéria" -> aba Revisão (Listas ou Questões) já filtrada pela matéria.
    'go-review'(el) {
      const { tab, subject } = el.dataset;
      state.modal = null;
      state.ui.screen = 'question-review';
      state.ui.reviewTab = tab;
      if (tab === 'questions') state.ui.questionSubTab = 'active';
      state.ui.filters[tab] = subject ? { subject } : {};
      render();
    },

    // Cabeçalho
    sync: () => SC.syncNow(),
    theme() { state.isDark = !state.isDark; SC.applyTheme(); saveState(); },
  });

  document.addEventListener('click', (e) => {
    if (!ready) return;
    const el = e.target.closest && e.target.closest('[data-action]');
    const fn = el && SC.actions[el.dataset.action];
    if (fn) fn(el, e);
  });

  // Filtros: <select data-filter="grupo.campo">
  document.addEventListener('change', (e) => {
    if (!ready) return;
    const sel = e.target.closest && e.target.closest('select[data-filter]');
    if (!sel) return;
    const [group, field] = sel.dataset.filter.split('.');
    if (!state.ui.filters[group]) return;
    state.ui.filters[group][field] = sel.value;
    render({ screenOnly: true });
  });

  document.addEventListener('keydown', (e) => {
    if (!ready) return;
    if (e.key === 'Escape' && state.modal) { closeModal(); return; }
    // Enter/Espaço em "botões" que não são <button> (ex.: chip "Próxima matéria").
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"][data-action]')) {
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
    ready = true;
  }, () => { // IndexedDB indisponível: ainda abre com dados vazios
    SC.applyData({});
    SC.applyTheme();
    render();
    ready = true;
  });

  // Pede ao navegador para não apagar os dados do app quando faltar espaço
  // (o Safari, por exemplo, limpa dados de sites sem uso por ~7 dias).
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // Service Worker: deixa o app abrir offline (veja sw.js).
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
