/* =========================================================
   Study Cycle — dados
   Estado do app, persistência (IndexedDB) e helpers de coleção.

   COMO ADICIONAR UM DADO NOVO QUE PRECISA SALVAR/SINCRONIZAR:
   basta incluí-lo em SYNCED (abaixo) e no objeto `state`.
   Salvar no aparelho, carregar ao abrir e sincronizar usam essa
   mesma lista — não há mais lugar nenhum para lembrar de editar.
   ========================================================= */
(function () {
  'use strict';
  const SC = window.SC = window.SC || {};

  // ---------- O QUE É SALVO E SINCRONIZADO ----------
  // chave -> tipo esperado (valida o que vem do disco / da nuvem).
  const SYNCED = {
    subjects: 'array',
    settings: 'object',
    studyCounter: 'number',
    currentBlock: 'object',
    studyLogs: 'array',
    errorLogs: 'array',
    topicReviews: 'array', // sem tela desde o v15; fica aqui só para não apagar dados antigos
    exerciseLists: 'array',
    mockExams: 'array',
    questionBank: 'array',
    isDark: 'boolean',
  };

  const DEFAULT_SETTINGS = {
    weeklyHours: 0,
    minHoursPerSubject: 1,
    streakHours: 1,          // horas seguidas na mesma matéria antes de trocar
    windowHours: 0,          // regra de diversidade: faixa de horas...
    maxSubjectsPerWindow: 0, // ...e máx. de matérias distintas nela (0 = desligada)
  };

  // ---------- ESTADO ----------
  const state = {
    // Dados (persistidos + sincronizados)
    subjects: [],      // { id, name, difficulty, content, importance, completedHours, colorIndex, lastStudiedAt }
    settings: Object.assign({}, DEFAULT_SETTINGS),
    studyCounter: 0,   // sobe a cada registro de tempo; desempata "há mais tempo sem estudar"
    currentBlock: null, // { subjectId, hoursDone } — bloco de horas seguidas em andamento
    studyLogs: [],     // { id, name, subject, category, status, ...campos da categoria }
    errorLogs: [],     // { id, subject, topic, description, errorType }
    mockExams: [],     // { id, name, date, minutes, rows: [{ subject, correct, total }] }
    topicReviews: [],  // LEGADO (v14): não tem mais tela; preservado nos dados
    exerciseLists: [], // { id, name, subject, total, notes, pdf: { name, size } | null, progress: { upTo, wrong[], correct|null, at } | null, createdAt, n, EF, intervalDays, lastReviewedAt, nextReviewAt, history[{ at, quality, intervalDays, result }] }
    questionBank: [],  // { id, subject, topic, statementText, imageData, answerKey, resolutionText, resolutionImageData, createdAt, n, EF, intervalDays, lastReviewedAt, nextReviewAt, retired, history[] }
    isDark: false,

    // Controle de sync (persistido só neste aparelho)
    lastModifiedAt: 0, // sobe a cada alteração local
    lastSyncedAt: 0,   // última sincronização bem-sucedida

    // Interface (nunca persistido)
    modal: null,       // { name, id?, ...dados do botão que abriu }
    sync: { status: 'idle', direction: null, error: null },
    ui: {
      screen: 'dashboard',
      studyLogTab: 'active',   // 'active' | 'completed'
      reviewTab: 'today',      // 'today' | 'lists' | 'questions'
      questionSubTab: 'active', // 'active' | 'graduated'
      filters: { log: {}, error: {}, lists: {}, questions: {} },
    },
  };

  const typeOf = (v) => Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;

  // Copia para o estado só o que existe e tem o tipo certo. Usado ao abrir
  // o app E ao receber dados da nuvem (antes eram dois blocos duplicados).
  function applyData(d) {
    d = d || {};
    Object.keys(SYNCED).forEach((k) => { if (typeOf(d[k]) === SYNCED[k]) state[k] = d[k]; });
    if (!d.currentBlock) state.currentBlock = null;
    state.settings = Object.assign({}, DEFAULT_SETTINGS, state.settings);
    // Matérias antigas podem não ter lastStudiedAt: 0 = "nunca estudada".
    state.subjects = state.subjects.map((s) => Object.assign({ lastStudiedAt: 0 }, s));
  }

  function pickSyncable() {
    const out = {};
    Object.keys(SYNCED).forEach((k) => { out[k] = state[k]; });
    return out;
  }

  // ---------- INDEXEDDB ----------
  const DB_NAME = 'StudyCycleDB', STORE = 'app', KEY = 'appState', FILES = 'files';
  let dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2); // v2: acrescenta o armário de arquivos (PDFs)
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
          if (!d.objectStoreNames.contains(FILES)) d.createObjectStore(FILES);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }

  // opts.skipTouch: dados vindos da nuvem não contam como "alteração local".
  // opts.skipStatus: quem chamou já vai redesenhar a barra de sync.
  function saveState(opts) {
    opts = opts || {};
    if (!opts.skipTouch) state.lastModifiedAt = Date.now();
    const data = Object.assign(pickSyncable(), {
      lastModifiedAt: state.lastModifiedAt,
      lastSyncedAt: state.lastSyncedAt,
    });
    db().then((d) => d.transaction(STORE, 'readwrite').objectStore(STORE).put(data, KEY)).catch(() => {});
    if (!opts.skipStatus && SC.renderSyncStatus) SC.renderSyncStatus();
  }

  function loadState() {
    return db().then((d) => new Promise((resolve) => {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    })).catch(() => null);
  }

  // ---------- ARQUIVOS (PDFs das listas) ----------
  // Ficam num armário separado do estado e NÃO são sincronizados: o estado
  // inteiro vai como um único JSON para a nuvem, então um PDF ali dentro
  // seria reenviado a cada sincronização. Só os metadados (nome, tamanho)
  // moram no item da lista; o arquivo mora aqui, indexado pelo id da lista.
  const files = {
    put(id, file) {
      return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error);
        fr.readAsArrayBuffer(file);
      }).then((data) => db().then((d) => new Promise((resolve, reject) => {
        const tx = d.transaction(FILES, 'readwrite');
        tx.objectStore(FILES).put({ name: file.name, type: 'application/pdf', data }, id);
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(tx.error);
      })));
    },
    get: (id) => db().then((d) => new Promise((resolve) => {
      const req = d.transaction(FILES, 'readonly').objectStore(FILES).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    })).catch(() => null),
    remove: (id) => db().then((d) => { d.transaction(FILES, 'readwrite').objectStore(FILES).delete(id); }).catch(() => {}),
  };

  // ---------- COLEÇÕES (matérias, logs, erros, tópicos, questões) ----------
  // Uma API só para as 5 listas, em vez de map/filter/concat espalhados.
  const col = {
    find: (key, id) => state[key].find((x) => x.id === id),
    // Substitui o item com o mesmo id, ou adiciona se não existir.
    put(key, item) {
      state[key] = state[key].some((x) => x.id === item.id)
        ? state[key].map((x) => (x.id === item.id ? item : x))
        : state[key].concat([item]);
    },
    // Mescla `changes` (objeto ou função item -> objeto) no item com esse id.
    patch(key, id, changes) {
      state[key] = state[key].map((x) => (x.id === id
        ? Object.assign({}, x, typeof changes === 'function' ? changes(x) : changes)
        : x));
    },
    remove(key, id) { state[key] = state[key].filter((x) => x.id !== id); },
  };

  // ---------- HELPERS ----------
  const uid = () => Math.random().toString(36).slice(2, 11);
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  // Escapa texto para HTML — serve também para dentro de atributos.
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);

  Object.assign(SC, { state, SYNCED, DEFAULT_SETTINGS, applyData, pickSyncable, saveState, loadState, col, files, uid, esc });
})();
