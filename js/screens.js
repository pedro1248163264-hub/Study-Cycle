/* =========================================================
   Study Cycle — telas
   Cada tela é uma entrada em SC.screens (a ordem aqui é a ordem das abas).
   ========================================================= */
(function () {
  'use strict';
  const SC = window.SC;
  const { state, esc, icon, chip, button, screenHeader, emptyState, tabs, logCard, cardMain, cardList,
    filterBar, applyFilters, subjectFilterOptions, dueBadge, formatDate } = Object.assign({}, SC);

  const STUDY_CATEGORIES = ['Book', 'Video', 'Question'];
  const CATEGORY_LABEL = { Book: 'Livro', Video: 'Vídeo', Question: 'Questões' };
  const CATEGORY_ICON = { Book: 'bookOpen', Video: 'video', Question: 'helpCircle' };

  // Tipos de erro: [valor salvo, rótulo, cor do selo]. Os valores ficam em
  // inglês porque já estão gravados nos dados existentes.
  const ERROR_TYPES = [
    ['Knowledge gap', 'Lacuna de teoria', 'violet'],
    ['Missed approach', 'Sabia, mas não viu o caminho', 'orange'],
    ['Attention / careless mistake', 'Desatenção / conta', 'amber'],
    ['Time management', 'Estourou o tempo', 'blue'],
    ['Forgot concept', 'Esqueci o conceito', 'fuchsia'],
    ['Other', 'Outro', 'neutral'],
    // antigos: continuam aparecendo nos dados já salvos, mas saíram da lista de escolha
    ['Calculation', 'Erro de cálculo (antigo)', 'rose', true],
    ['Misunderstood question', 'Interpretação errada (antigo)', 'orange', true],
  ];

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const excerpt = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

  // ---------- STUDY CYCLE ----------
  function dashboardScreen(d) {
    const overview = `
      <section class="card cycle-overview">
        <div class="cycle-overview-inner">
          <div class="cycle-info">
            <h2 class="eyebrow">Ciclo desta semana</h2>
            <div class="cycle-total">
              <span class="cycle-total-num">${d.totalCompleted}</span>
              <span class="cycle-total-label">/ ${d.totalAllocated} h concluídas</span>
            </div>
            <div class="progress-track"><div class="progress-fill" style="width:${d.overallProgress}%"></div></div>
          </div>
          <div class="cycle-actions">
            ${d.isCycleComplete
              ? button('Reiniciar ciclo', 'rotateCcw', 'reset-cycle')
              : button('Registrar tempo', 'clock', 'modal', { modal: 'logTime' })}
          </div>
        </div>
      </section>`;

    const sequence = d.isCycleComplete ? '' : `
      <section class="section">
        <div class="section-header"><h3>Sequência sugerida</h3></div>
        <div class="card sequence-card">${sequenceCard(d)}</div>
      </section>`;

    const subjects = `
      <section class="section">
        <div class="section-header">
          <h3>Suas matérias</h3>
          ${button('Adicionar matéria', 'plus', 'modal', { modal: 'subject' }, 'card-outline')}
        </div>
        <div class="subjects-grid">${subjectCards(d)}</div>
      </section>`;

    return `<div>${overview}${sequence}${subjects}</div>`; // <div> simples: o espaçamento vem do CSS de blocos
  }

  function sequenceCard(d) {
    if (!d.nextStudy) {
      const none = d.allocatedSubjects.length === 0;
      return `
        <div class="sequence-empty">
          ${icon('checkCircle')}
          <p class="sequence-empty-title">${none ? 'Adicione matérias para começar' : 'Tudo em dia!'}</p>
          <p class="sequence-empty-sub">${none ? 'Defina suas matérias e configurações para gerar a sequência.' : 'Registre mais tempo ou reinicie o ciclo.'}</p>
        </div>`;
    }
    const rest = d.sequence.slice(1, 10);
    const restHtml = rest.map((s) => `<div class="sequence-chip subject-color-${s.colorIndex}">${esc(s.name)}</div>`)
      .join('<div class="sequence-arrow">&rarr;</div>')
      + (d.sequence.length > 10 ? `<div class="sequence-more">+${d.sequence.length - 10} mais</div>` : '');
    return `
      <div class="sequence-content">
        <div class="next-study">
          <span class="next-study-label">Próxima matéria</span>
          <div class="next-study-chip subject-color-${d.nextStudy.colorIndex}" data-action="modal" data-modal="nextMaterial" data-subject="${esc(d.nextStudy.name)}" role="button" tabindex="0">
            ${icon('play')}
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

  function subjectCards(d) {
    if (d.allocatedSubjects.length === 0) {
      return `
        <div class="empty-state">
          <p class="empty-state-title">Nenhuma matéria adicionada</p>
          <p class="empty-state-sub">Toque em "Adicionar matéria" para começar a organizar seus estudos.</p>
        </div>`;
    }
    const stat = (label, value) => `
      <div><div class="subject-stat-label">${label}</div><div class="subject-stat-dots">
        ${[0, 1, 2, 3, 4].map((i) => `<span class="subject-stat-dot${i < value ? ' filled' : ''}"></span>`).join('')}
      </div></div>`;
    return d.allocatedSubjects.map((s) => {
      const pct = s.allocated > 0 ? Math.min(100, (s.completedHours / s.allocated) * 100) : 0;
      return `
      <div class="subject-card">
        <button type="button" class="subject-edit-btn" data-action="modal" data-modal="subject" data-id="${s.id}" aria-label="Editar ${esc(s.name)}">${icon('edit')}</button>
        <div class="subject-head">
          <span class="subject-dot subject-color-${s.colorIndex}"></span>
          <h4 class="subject-name">${esc(s.name)}</h4>
        </div>
        <div class="subject-hours-row">
          <div>
            <div class="subject-hours">${s.completedHours}<span class="subject-hours-total"> / ${s.allocated}h</span></div>
            <div class="subject-hours-label">Concluído</div>
          </div>
        </div>
        <div class="subject-progress-track"><div class="subject-progress-fill subject-color-${s.colorIndex}" style="width:${pct}%"></div></div>
        <div class="subject-stats">${stat('Dif.', s.difficulty)}${stat('Cont.', s.content)}${stat('Imp.', s.importance)}</div>
      </div>`;
    }).join('');
  }

  // ---------- STUDY LOG ----------
  // Linha de posição: "Capítulo 4 · Página 143", "EP 12 · 12:34" ou "Exercício 27".
  function logDetail(log) {
    const parts = {
      Book: [log.chapter, log.page && `Página ${log.page}`],
      Video: [log.episode && `EP ${log.episode}`, log.timestamp],
      Question: [log.exerciseNumber && `Exercício ${log.exerciseNumber}`],
    }[log.category] || [];
    return parts.filter(Boolean).join(' · ');
  }

  const categoryTag = (log) =>
    `<span class="log-card-category">${icon(CATEGORY_ICON[log.category] || 'helpCircle')}${esc(CATEGORY_LABEL[log.category] || log.category)}</span>`;

  // Cartão de material. compact = versão do modal "Próxima matéria".
  function studyLogCard(log, compact) {
    const done = log.status === 'completed';
    const meta = [categoryTag(log)];
    if (!compact && log.subject) meta.push(`<span class="log-card-subject">${esc(log.subject)}</span>`);
    if (!compact && done) meta.push(`<span class="pill-completed">${icon('check')}Concluído</span>`);
    const actions = compact
      ? [chip('Continuar', null, 'modal', { modal: 'studyLog', id: log.id }, 'success')]
      : [
        chip('Editar', 'edit', 'modal', { modal: 'studyLog', id: log.id }),
        done
          ? chip('Reativar', 'rotateCcw', 'patch', { col: 'studyLogs', id: log.id, set: JSON.stringify({ status: 'active' }) })
          : chip('Concluir', 'check', 'patch', { col: 'studyLogs', id: log.id, set: JSON.stringify({ status: 'completed' }) }, 'success'),
      ];
    return logCard({ cls: !compact && done ? 'is-completed' : '', main: cardMain({ meta, title: log.name, detail: logDetail(log) }), actions });
  }

  // Cartões "Você tem X para revisar" do modal "Próxima matéria": um para
  // questões e outro para listas (só aparece o que tiver pendência).
  // O botão leva à aba Revisão já filtrada por essa matéria.
  function pendingReviewCards(subject) {
    const { lists, questions } = SC.pendingReviews(state, subject);
    const card = (tab, text) => logCard({
      main: cardMain({
        meta: [`<span class="log-card-category">${icon('repeat')}Revisão</span>`],
        title: text,
      }),
      actions: [chip('Revisar', null, 'go-review', { tab, subject })],
    });
    const cards = [];
    if (questions > 0) {
      cards.push(card('questions',
        `Você tem ${questions} ${questions === 1 ? 'questão pendente' : 'questões pendentes'} para revisar`));
    }
    if (lists > 0) {
      cards.push(card('lists',
        `Você tem ${lists} ${lists === 1 ? 'lista' : 'listas'} para revisar`));
    }
    return cards;
  }

  function studyLogScreen() {
    const active = state.studyLogs.filter((l) => l.status === 'active');
    const completed = state.studyLogs.filter((l) => l.status === 'completed');
    const tab = state.ui.studyLogTab;
    const base = tab === 'active' ? active : completed;
    const shown = applyFilters(base, 'log');

    let list;
    if (base.length === 0) {
      list = tab === 'active'
        ? emptyState('bookMarked', 'Nenhum registro ativo', 'Comece a acompanhar o que você está estudando agora.', button('Adicionar registro', 'plus', 'modal', { modal: 'studyLog' }))
        : emptyState('bookMarked', 'Nenhum registro concluído', 'Materiais marcados como concluídos aparecem aqui.');
    } else if (shown.length === 0) {
      list = emptyState('filter', 'Nenhum registro corresponde aos filtros', 'Tente ajustar ou limpar os filtros.');
    } else {
      list = cardList(shown.map((l) => studyLogCard(l)));
    }

    return `<div class="screen">
      ${screenHeader('Study Log', 'Acompanhe o que você está estudando e onde parou.', button('Adicionar registro', 'plus', 'modal', { modal: 'studyLog' }))}
      ${tabs('studyLogTab', [{ key: 'active', label: 'Ativos', count: active.length }, { key: 'completed', label: 'Concluídos', count: completed.length }])}
      ${base.length ? filterBar('log', [
        { field: 'subject', all: 'Todas as matérias', options: subjectFilterOptions(state.studyLogs).map((s) => [s, s]) },
        { field: 'category', all: 'Todos os materiais', options: STUDY_CATEGORIES.map((c) => [c, CATEGORY_LABEL[c]]) },
      ], shown.length) : ''}
      ${list}
    </div>`;
  }

  // ---------- ERROR LOG ----------
  function errorLogScreen() {
    const shown = applyFilters(state.errorLogs, 'error');
    const type = (t) => ERROR_TYPES.find((x) => x[0] === t) || [t, t, 'neutral'];

    let list;
    if (state.errorLogs.length === 0) {
      list = emptyState('alertTriangle', 'Nenhum erro registrado', 'Registre seus erros ao estudar para identificar padrões e fechar lacunas.', button('Registrar erro', 'plus', 'modal', { modal: 'error' }));
    } else if (shown.length === 0) {
      list = emptyState('filter', 'Nenhum erro corresponde aos filtros', 'Tente ajustar ou limpar os filtros.');
    } else {
      list = cardList(shown.map((e) => logCard({
        cls: 'error-card',
        mainCls: 'error-card-body',
        main: `
          <div class="error-card-title">
            <span class="error-card-subject">${esc(e.subject)}</span>
            <span class="error-card-sep">&middot;</span>
            <span class="error-card-topic">${esc(e.topic)}</span>
          </div>
          <p class="error-card-desc">&ldquo;${esc(e.description)}&rdquo;</p>
          <div><span class="error-badge error-badge-${type(e.errorType)[2]}">${esc(type(e.errorType)[1])}</span></div>`,
        actions: [
          chip('Editar', 'edit', 'modal', { modal: 'error', id: e.id }),
          chip('Excluir', 'trash', 'remove', { col: 'errorLogs', id: e.id, confirm: 'Excluir este erro?' }, 'danger'),
        ],
      })));
    }

    return `<div class="screen">
      ${screenHeader('Error Log', 'Registre erros para identificar padrões e melhorar.', button('Registrar erro', 'plus', 'modal', { modal: 'error' }))}
      ${state.errorLogs.length ? filterBar('error', [
        { field: 'subject', all: 'Todas as matérias', options: subjectFilterOptions(state.errorLogs).map((s) => [s, s]) },
        { field: 'errorType', all: 'Todos os tipos', options: ERROR_TYPES.map((t) => [t[0], t[1]]) },
      ], shown.length) : ''}
      ${list}
    </div>`;
  }

  // ---------- REVISÃO: LISTAS DE EXERCÍCIOS + QUESTÕES ----------
  const typeTag = (iconName, label) => `<span class="rev-type-tag">${icon(iconName)}${label}</span>`;

  // Resposta de "como foi?" ao refazer uma lista (mesma nota 1/3/5 das questões).
  const LIST_RESULT = { wrong: 'Foi mal', hard: 'Mais ou menos', easy: 'Foi bem' };

  const redoChip = (q) => chip('Refazer', 'repeat', 'modal', { modal: 'redo', id: q.id });
  const listRedoChip = (l) => chip('Refazer', 'repeat', 'modal', { modal: 'listRedo', id: l.id });

  // Cartão de lista: matéria · nº de exercícios · como foi da última vez.
  function listCard(l, { meta, actions }) {
    const last = (l.history || []).slice(-1)[0];
    const lastText = last && LIST_RESULT[last.result]
      ? `última vez: ${LIST_RESULT[last.result].toLowerCase()} (${formatDate(l.lastReviewedAt)})`
      : 'ainda não revisada';
    return logCard({
      main: cardMain({
        meta,
        title: l.name,
        detail: [l.subject, plural(l.total, 'exercício', 'exercícios'), lastText].filter(Boolean).join(' · '),
      }),
      actions: (l.pdf ? [chip('Ver PDF', 'eye', 'modal', { modal: 'listPdf', id: l.id })] : []).concat(actions),
    });
  }

  function questionCard(q, { meta, actions, title }) {
    return logCard({
      thumb: q.imageData,
      main: cardMain({
        meta,
        title: title || [q.subject, q.topic].filter(Boolean).join(' · ') || 'Questão salva',
        detail: q.statementText ? excerpt(q.statementText, 90) : '',
      }),
      actions,
    });
  }

  // Item da fila "Hoje"/"Próximas": lista ou questão.
  function queueItem(item) {
    if (item.kind === 'list') {
      return listCard(item, { meta: [typeTag('bookMarked', 'Lista'), dueBadge(item.nextReviewAt)], actions: [listRedoChip(item)] });
    }
    return questionCard(item, { meta: [typeTag('image', 'Questão'), dueBadge(item.nextReviewAt)], actions: [redoChip(item)] });
  }

  function reviewTodayHtml() {
    const now = Date.now();
    const items = (list, kind) => list.map((x) => Object.assign({ kind }, x));
    const pending = items(state.exerciseLists, 'list')
      .concat(items(state.questionBank.filter((q) => !q.retired), 'question'))
      .filter((x) => x.nextReviewAt)
      .sort((a, b) => a.nextReviewAt - b.nextReviewAt);
    const due = SC.interleaveBySubject(pending.filter((x) => x.nextReviewAt <= now));
    const upcoming = pending.filter((x) => x.nextReviewAt > now).slice(0, 10);

    return {
      dueCount: due.length,
      html: (due.length === 0
        ? emptyState('checkCircle', 'Nada para revisar agora', 'Quando uma lista ou questão vencer, aparece aqui — misturadas entre matérias de propósito, pra treinar o reconhecimento igual na prova.')
        : cardList(due.map(queueItem)))
        + (upcoming.length ? `
        <div class="section" style="margin-top:0.5rem">
          <div class="review-section-title">${icon('clock')}Próximas revisões</div>
          ${cardList(upcoming.map(queueItem))}
        </div>` : ''),
    };
  }

  function reviewListsHtml() {
    const all = state.exerciseLists;
    const shown = applyFilters(all, 'lists').sort((a, b) => (a.nextReviewAt || 0) - (b.nextReviewAt || 0));
    let list;
    if (all.length === 0) {
      list = emptyState('bookMarked', 'Nenhuma lista no ciclo', 'Adicione uma lista de exercícios e quantos exercícios ela tem. Ela volta para você refazer em intervalos crescentes, e a cada vez o app pergunta como foi.', button('Adicionar lista', 'plus', 'modal', { modal: 'exerciseList' }));
    } else if (shown.length === 0) {
      list = emptyState('filter', 'Nenhuma lista corresponde ao filtro');
    } else {
      list = cardList(shown.map((l) => listCard(l, {
        meta: [
          dueBadge(l.nextReviewAt),
          `<span class="log-card-subject">${plural((l.history || []).length, 'revisão', 'revisões')}</span>`,
        ],
        actions: [
          listRedoChip(l),
          chip('Editar', 'edit', 'modal', { modal: 'exerciseList', id: l.id }),
          chip('Excluir', 'trash', 'remove', { col: 'exerciseLists', id: l.id, confirm: 'Excluir esta lista e o histórico dela?' }, 'danger'),
        ],
      })));
    }
    return `
      <div class="section-header" style="margin-top:-0.5rem">
        <div></div>
        ${button('Adicionar lista', 'plus', 'modal', { modal: 'exerciseList' }, 'card-outline')}
      </div>
      ${all.length ? filterBar('lists', [{ field: 'subject', all: 'Todas as matérias', options: subjectFilterOptions(all).map((s) => [s, s]) }], shown.length) : ''}
      ${list}`;
  }

  function reviewQuestionsHtml() {
    const bank = state.questionBank;
    const active = bank.filter((q) => !q.retired).sort((a, b) => (a.nextReviewAt || 0) - (b.nextReviewAt || 0));
    const graduated = bank.filter((q) => q.retired);
    const isActive = state.ui.questionSubTab === 'active';
    const base = isActive ? active : graduated;
    const shown = applyFilters(base, 'questions');

    let list;
    if (base.length === 0) {
      list = isActive
        ? emptyState('image', 'Nenhuma questão salva', 'Guarde o print ou o enunciado de uma questão difícil para o motor te lembrar de refazê-la.', button('Salvar questão', 'plus', 'modal', { modal: 'question' }))
        : emptyState('checkCircle', 'Nenhuma questão graduada ainda', `Uma questão sai da fila ativa sozinha depois de ${SC.GRADUATE_AFTER_N} acertos seguidos ao ser refeita.`);
    } else if (shown.length === 0) {
      list = emptyState('filter', 'Nenhuma questão corresponde ao filtro');
    } else {
      list = cardList(shown.map((q) => questionCard(q, {
        title: q.topic || (q.statementText ? q.statementText.slice(0, 60) : 'Questão salva'),
        meta: [
          isActive ? dueBadge(q.nextReviewAt) : `<span class="pill-completed">${icon('check')}Graduada</span>`,
          q.subject ? `<span class="log-card-subject">${esc(q.subject)}</span>` : '',
        ],
        actions: [
          chip('Editar', 'edit', 'modal', { modal: 'question', id: q.id }),
          isActive ? redoChip(q) : chip('Reativar', 'rotateCcw', 'revive', { id: q.id }),
          chip('Excluir', 'trash', 'remove', { col: 'questionBank', id: q.id, confirm: 'Excluir esta questão (imagem e histórico incluídos)?' }, 'danger'),
        ],
      })));
    }

    return `
      <div class="section-header" style="margin-top:-0.5rem">
        ${tabs('questionSubTab', [{ key: 'active', label: 'Ativas', count: active.length }, { key: 'graduated', label: 'Graduadas', count: graduated.length }])}
        ${button('Salvar questão', 'plus', 'modal', { modal: 'question' }, 'card-outline')}
      </div>
      ${base.length ? filterBar('questions', [{ field: 'subject', all: 'Todas as matérias', options: subjectFilterOptions(bank).map((s) => [s, s]) }]) : ''}
      ${list}`;
  }

  function reviewScreen() {
    const tab = state.ui.reviewTab;
    const today = reviewTodayHtml();
    const activeQuestions = state.questionBank.filter((q) => !q.retired).length;
    const body = tab === 'lists' ? reviewListsHtml() : tab === 'questions' ? reviewQuestionsHtml() : today.html;
    const stat = (num, label, due) => `
      <div class="review-stat-chip${due ? ' is-due' : ''}">
        <span class="review-stat-chip-num">${num}</span>
        <span class="review-stat-chip-label">${label}</span>
      </div>`;

    return `<div class="screen">
      ${screenHeader('Revisão', 'Listas de exercícios e questões voltam em ciclo; toda vez você diz como foi.', button('Adicionar lista', 'plus', 'modal', { modal: 'exerciseList' }))}
      <div class="review-stats-row">
        ${stat(today.dueCount, 'Para revisar hoje', today.dueCount > 0)}
        ${stat(state.exerciseLists.length, 'Listas no ciclo')}
        ${stat(activeQuestions, 'Questões no banco')}
      </div>
      ${tabs('reviewTab', [
        { key: 'today', label: 'Hoje' },
        { key: 'lists', label: 'Listas', count: state.exerciseLists.length },
        { key: 'questions', label: 'Questões', count: activeQuestions },
      ])}
      ${body}
    </div>`;
  }

  // Ordem = ordem das abas de navegação.

  // ---------- SIMULADOS ----------
  function mockScreen() {
    const exams = state.mockExams.slice().sort((a, b) => b.date.localeCompare(a.date));
    const pct = (c, t) => (t ? Math.round((100 * c) / t) : 0);
    const total = (e) => pct(e.rows.reduce((s, r) => s + r.correct, 0), e.rows.reduce((s, r) => s + r.total, 0));
    const list = exams.length === 0
      ? emptyState('target', 'Nenhum simulado ainda', 'Faça uma prova completa e cronometrada (use as provas recentes do ITA) a cada 2–3 semanas e registre o acerto por matéria.', button('Registrar simulado', 'plus', 'modal', { modal: 'mock' }))
      : cardList(exams.map((e, i) => {
        const d = exams[i + 1] ? total(e) - total(exams[i + 1]) : null;
        return logCard({
          main: cardMain({
            meta: [`<span class="error-badge error-badge-violet">${total(e)}%</span>`, d === null ? '' : `<span class="log-card-subject">${d >= 0 ? '+' : ''}${d} pp vs. anterior</span>`],
            title: e.name,
            detail: [e.date].concat(e.rows.map((r) => `${esc(r.subject)} ${pct(r.correct, r.total)}%`)).concat(e.minutes ? [e.minutes + ' min'] : []).join(' · '),
          }),
          actions: [chip('Excluir', 'trash', 'remove', { col: 'mockExams', id: e.id, confirm: 'Excluir este simulado?' }, 'danger')],
        });
      }));
    const causes = ERROR_TYPES.map((t) => [t[1], state.errorLogs.filter((x) => x.errorType === t[0]).length]).filter((c) => c[1]);
    return `<div class="screen">
      ${screenHeader('Simulados', 'A régua: prova completa, cronometrada, comparada com o simulado anterior.', button('Registrar simulado', 'plus', 'modal', { modal: 'mock' }))}
      ${causes.length ? `<div class="review-section-title">${icon('alertTriangle')}Causas dos erros (Error Log)</div><div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:1rem">${causes.map((c) => `<span class="error-badge error-badge-neutral">${esc(c[0])}: ${c[1]}</span>`).join('')}</div>` : ''}
      ${list}
    </div>`;
  }

  SC.screens.dashboard = { label: 'Study Cycle', icon: 'layoutDashboard', render: dashboardScreen };
  SC.screens['study-log'] = { label: 'Study Log', icon: 'bookMarked', render: studyLogScreen };
  SC.screens['error-log'] = { label: 'Error Log', icon: 'alertTriangle', render: errorLogScreen };
  SC.screens['question-review'] = { label: 'Revisão', icon: 'repeat', render: reviewScreen };
  SC.screens.mocks = { label: 'Simulados', icon: 'target', render: mockScreen };

  Object.assign(SC, { STUDY_CATEGORIES, CATEGORY_LABEL, CATEGORY_ICON, ERROR_TYPES, LIST_RESULT, studyLogCard, pendingReviewCards });
})();
