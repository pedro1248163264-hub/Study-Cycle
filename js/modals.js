/* =========================================================
   Study Cycle — modais
   Cada modal é uma entrada em SC.modals: (m, d) => { title, body, wire }.
     m = state.modal ({ name, id?, ...dados do botão })
     d = dados derivados do ciclo
   Para abrir um modal a partir de qualquer botão:
     data-action="modal" data-modal="nome" data-id="..." (+ outros data-*)
   ========================================================= */
(function () {
  'use strict';
  const SC = window.SC;
  const { state, esc, uid, col, icon, inputField, selectField, selectControl, subjectField, choice, ratingRow,
    formActions, bindForm, commit, closeModal, emptyState, button, cardList, studyLogCard } = Object.assign({}, SC);

  const int = (v, fallback) => parseInt(v, 10) || fallback || 0;
  const pick = (obj, keys) => keys.reduce((o, k) => { o[k] = obj[k]; return o; }, {});

  // ---------- SINCRONIZAÇÃO (senha) ----------
  SC.modals.sync = () => ({
    title: 'Sincronização',
    body: `
      <p class="field-help" data-intro>Verificando…</p>
      ${inputField({ name: 'code', label: 'Senha de sincronização', type: 'password', placeholder: 'Digite sua senha', attrs: 'autocomplete="off"' })}
      ${formActions({ save: 'Verificando…', cancel: false, saveCls: 'btn-primary-block' })}`,
    wire() {
      const root = document.querySelector('.modal-body');
      const intro = root.querySelector('[data-intro]');
      const btn = root.querySelector('[data-save]');
      let mode = 'checking'; // 'create' | 'enter'

      const form = bindForm({
        validate: (v) => mode !== 'checking' && !!v.code,
        onSave(v) {
          const proceed = () => {
            SC.sync.setCode(v.code);
            state.modal = null;
            SC.render();
            SC.performSync(v.code);
          };
          btn.disabled = true;
          // Se outro aparelho acabou de registrar a senha, tenta usá-la assim
          // mesmo; se estiver errada, performSync reabre este modal com aviso.
          if (mode === 'create') SC.sync.claimCode(v.code).then(proceed).catch(proceed);
          else proceed();
        },
      });
      if (state.sync.error) { form.showError(state.sync.error); state.sync.error = null; }

      const ready = (exists, text) => {
        mode = exists ? 'enter' : 'create';
        intro.textContent = text;
        btn.textContent = exists ? 'Sincronizar' : 'Criar senha e sincronizar';
        form.sync();
      };
      SC.sync.codeExists()
        .then((exists) => ready(exists, exists
          ? 'Digite a senha de sincronização que você configurou antes neste ou em outro aparelho.'
          : 'Ainda não há uma senha configurada. Escolha uma agora — você vai digitar a mesma nos seus outros aparelhos.'))
        .catch(() => ready(true, 'Não foi possível verificar (sem internet?). Se você já tem uma senha, digite-a abaixo.'));

      const input = root.querySelector('[name="code"]');
      input.focus();
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
    },
  });

  // ---------- CONFIGURAÇÕES DO CICLO ----------
  // [campo, rótulo, mín, máx, ajuda]
  const SETTINGS_FIELDS = [
    ['weeklyHours', 'Total de horas semanais', 1, 168, 'O tempo total que você tem para estudar nesta semana.'],
    ['minHoursPerSubject', 'Mínimo de horas por matéria', 1, 20],
    ['streakHours', 'Horas seguidas por matéria', 1, 12, 'Quantas horas seguidas o ciclo tenta manter na mesma matéria antes de trocar. Use 1 para nunca repetir a matéria em seguida.'],
    ['windowHours', 'Faixa de horas (diversidade)', 0, 48, 'Opcional. Dentro de uma faixa de X horas seguidas, limita quantas matérias diferentes podem aparecer. Deixe 0 para desativar.'],
    ['maxSubjectsPerWindow', 'Máx. de matérias diferentes na faixa', 0, 20, 'Ex.: faixa de 6 horas com no máximo 2 matérias diferentes. Deixe 0 para desativar.'],
  ];

  SC.modals.settings = () => ({
    title: 'Configurações do ciclo',
    body: SETTINGS_FIELDS.map(([name, label, min, max, help]) =>
      inputField({ name, label, help, type: 'number', value: state.settings[name], attrs: `min="${min}" max="${max}"` })).join('')
      + formActions({ save: 'Salvar configurações', cancel: false, saveCls: 'btn-primary-block settings-save' }),
    wire() {
      const n = state.subjects.length;
      bindForm({
        validate(v) {
          const weekly = int(v.weeklyHours), minH = int(v.minHoursPerSubject), streak = int(v.streakHours);
          const win = int(v.windowHours), maxS = int(v.maxSubjectsPerWindow);
          const errors = [];
          if (n * minH > weekly) errors.push(`Com ${n} matérias e um mínimo de ${minH}h cada, você precisa de pelo menos ${n * minH}h. Aumente o total de horas semanais ou diminua o mínimo.`);
          if (streak < 1) errors.push('Horas seguidas por matéria precisa ser pelo menos 1.');
          if ((win > 0) !== (maxS > 0)) errors.push('Para usar a regra de diversidade, preencha tanto a faixa de horas quanto o número máximo de matérias (ou deixe as duas em 0 para desativar).');
          else if (win > 0 && win <= streak) errors.push('A faixa de horas precisa ser maior que as horas seguidas por matéria para fazer diferença.');
          return errors.length ? errors : true;
        },
        onSave: (v) => commit(() => {
          state.settings = {
            weeklyHours: int(v.weeklyHours), minHoursPerSubject: int(v.minHoursPerSubject), streakHours: int(v.streakHours, 1),
            windowHours: int(v.windowHours), maxSubjectsPerWindow: int(v.maxSubjectsPerWindow),
          };
        }),
      });
    },
  });

  // ---------- MATÉRIA (adicionar / editar) ----------
  SC.modals.subject = (m) => {
    const s = m.id ? col.find('subjects', m.id) : null;
    if (m.id && !s) return null;
    const val = (k) => (s ? s[k] : 3);
    return {
      title: s ? 'Editar matéria' : 'Adicionar matéria',
      body: `
        ${inputField({ name: 'name', label: 'Nome da matéria', value: s ? s.name : '', placeholder: 'ex: Matemática', bold: true })}
        <div class="ratings">
          ${ratingRow('difficulty', 'Dificuldade', val('difficulty'), 'Fácil', 'Difícil')}
          ${ratingRow('content', 'Quantidade de conteúdo', val('content'), 'Pouco', 'Muito')}
          ${ratingRow('importance', 'Importância', val('importance'), 'Baixa', 'Alta')}
        </div>
        ${formActions({ save: s ? 'Salvar alterações' : 'Adicionar matéria', cancel: false, del: s ? 'Excluir' : null })}`,
      wire: () => bindForm({
        validate: (v) => v.name.length > 0,
        onSave: (v) => commit(() => {
          const data = { name: v.name, difficulty: int(v.difficulty), content: int(v.content), importance: int(v.importance) };
          if (s) col.patch('subjects', s.id, data);
          else col.put('subjects', Object.assign({ id: uid(), completedHours: 0, colorIndex: state.subjects.length % 8, lastStudiedAt: 0 }, data));
        }),
        onDelete() {
          if (!confirm(`Excluir a matéria "${s.name}"?`)) return;
          commit(() => col.remove('subjects', s.id));
        },
      }),
    };
  };

  // ---------- REGISTRAR TEMPO ----------
  SC.modals.logTime = (m, d) => {
    const nextId = d.nextStudy ? d.nextStudy.id : (d.allocatedSubjects[0] ? d.allocatedSubjects[0].id : '');
    return {
      title: 'Registrar tempo de estudo',
      body: `
        ${selectField({
          name: 'subjectId', label: 'Matéria', value: nextId,
          options: d.allocatedSubjects.map((s) => [s.id, `${s.name} (${Math.max(0, s.allocated - s.completedHours)}h restantes)`]),
        })}
        <div class="field">
          <label>Horas estudadas</label>
          ${choice({ name: 'hours', value: 1, options: [[1, '1 h'], [2, '2 hrs'], [3, '3 hrs'], [4, '4 hrs']], wrapCls: 'hours-grid', btnCls: 'hours-btn' })}
        </div>
        ${formActions({ save: 'Adicionar 1 hora', cancel: false, saveCls: 'btn-primary-block log-submit' })}`,
      wire() {
        const saveBtn = document.querySelector('[data-save]');
        bindForm({
          validate(v) {
            saveBtn.textContent = `Adicionar ${v.hours} ${v.hours === '1' ? 'hora' : 'horas'}`;
            return !!v.subjectId;
          },
          onSave: (v) => commit(() => {
            const hours = int(v.hours, 1);
            const stamp = ++state.studyCounter;
            const prev = state.currentBlock;
            // Mesma matéria soma no bloco em andamento; outra matéria começa bloco novo.
            state.currentBlock = { subjectId: v.subjectId, hoursDone: (prev && prev.subjectId === v.subjectId ? (prev.hoursDone || 0) : 0) + hours };
            col.patch('subjects', v.subjectId, (s) => ({ completedHours: s.completedHours + hours, lastStudiedAt: stamp }));
          }),
        });
      },
    };
  };

  // ---------- STUDY LOG (adicionar / editar) ----------
  // Campos de posição de cada categoria (rótulo, dica). Nomes = campos salvos.
  const LOG_FIELDS = {
    Book: [['chapter', 'Capítulo', 'ex: Capítulo 4 — Derivadas'], ['page', 'Página', 'ex: 143']],
    Video: [['episode', 'Episódio', 'ex: 12'], ['timestamp', 'Tempo (min:seg)', 'ex: 12:34']],
    Question: [['exerciseNumber', 'Exercício', 'ex: 27']],
  };
  const ALL_LOG_FIELDS = [].concat(...Object.keys(LOG_FIELDS).map((c) => LOG_FIELDS[c].map((f) => f[0])));

  SC.modals.studyLog = (m) => {
    const log = m.id ? col.find('studyLogs', m.id) : null;
    if (m.id && !log) return null;
    const category = log ? log.category : 'Book';
    return {
      title: log ? 'Editar registro' : 'Adicionar registro',
      body: `
        ${inputField({ name: 'name', label: 'Nome', value: log ? log.name : '', placeholder: 'ex: Análise Matemática — Módulo 2, Aula 17', bold: true })}
        ${subjectField({ label: 'Matéria (opcional)', value: log ? log.subject || '' : m.subject || '', none: 'Nenhuma / Geral' })}
        <div class="field">
          <label>Categoria</label>
          ${choice({
            name: 'category', value: category, wrapCls: 'category-picker', btnCls: 'category-option',
            options: SC.STUDY_CATEGORIES.map((c) => [c, `${icon(SC.CATEGORY_ICON[c])}${esc(SC.CATEGORY_LABEL[c])}`]),
          })}
        </div>
        ${SC.STUDY_CATEGORIES.map((c) => `
          <div class="field category-fields" data-when="category=${c}">
            ${LOG_FIELDS[c].map(([name, label, ph], i) => {
              const f = inputField({ name, label, placeholder: ph, value: log ? log[name] || '' : '', bare: true });
              return i ? `<div class="subfield">${f}</div>` : f;
            }).join('')}
          </div>`).join('')}
        ${formActions({ save: log ? 'Salvar' : 'Adicionar' })}`,
      wire: () => bindForm({
        validate: (v) => v.name.length > 0,
        onSave: (v) => commit(() => {
          // Ao editar, descarta os campos de posição da categoria anterior.
          const base = log ? Object.assign({}, log) : { id: uid(), status: 'active' };
          ALL_LOG_FIELDS.forEach((k) => delete base[k]);
          col.put('studyLogs', Object.assign(base, pick(v, ['name', 'subject', 'category']),
            pick(v, LOG_FIELDS[v.category].map((f) => f[0]))));
        }),
      }),
    };
  };

  // Aberto ao tocar em "Próxima matéria": só os materiais ativos daquela matéria.
  SC.modals.nextMaterial = (m) => {
    const logs = state.studyLogs.filter((l) => l.status === 'active' && l.subject === m.subject);
    return {
      title: m.subject,
      body: logs.length
        ? cardList(logs.map((l) => studyLogCard(l, true)))
        : emptyState('bookMarked', 'Nenhum material ativo', `Não há registros de Study Log ativos para ${m.subject}.`,
          button('Adicionar registro', 'plus', 'modal', { modal: 'studyLog', subject: m.subject }), 'padding:2rem 1rem;'),
    };
  };

  // ---------- ERROR LOG (registrar / editar) ----------
  SC.modals.error = (m) => {
    const err = m.id ? col.find('errorLogs', m.id) : null;
    if (m.id && !err) return null;
    return {
      title: err ? 'Editar erro' : 'Registrar erro',
      body: `
        ${subjectField({ value: err ? err.subject : (state.subjects[0] || {}).name || '', custom: true })}
        ${inputField({ name: 'topic', label: 'Tópico', value: err ? err.topic : '', placeholder: 'ex: Limites', bold: true })}
        ${inputField({ name: 'description', label: 'Descrição', value: err ? err.description : '', placeholder: 'O que deu errado?', rows: 3 })}
        ${selectField({ name: 'errorType', label: 'Tipo de erro', value: err ? err.errorType : SC.ERROR_TYPES[0][0], options: SC.ERROR_TYPES.map((t) => [t[0], t[1]]) })}
        ${formActions({ save: err ? 'Salvar' : 'Registrar erro' })}`,
      wire: () => bindForm({
        validate: (v) => !!(v.subject && v.topic && v.description),
        onSave: (v) => commit(() => col.put('errorLogs', Object.assign(err ? Object.assign({}, err) : { id: uid() }, pick(v, ['subject', 'topic', 'description', 'errorType'])))),
      }),
    };
  };

  // ---------- REVISÃO: REGISTRAR RODADA ----------
  SC.modals.round = (m) => ({
    title: 'Registrar rodada de questões',
    body: `
      ${subjectField({ value: m.subject || '', custom: true })}
      ${inputField({ name: 'topic', label: 'Tópico', value: m.topic || '', placeholder: 'ex: Cinemática', bold: true, help: 'Se já existir um tópico com essa matéria + esse nome, a rodada entra no histórico dele. Senão, cria um novo.' })}
      ${inputField({ name: 'count', label: 'Quantas questões você fez', type: 'number', placeholder: 'ex: 12', attrs: 'min="1"' })}
      ${inputField({ name: 'wrong', label: 'Quantas você errou', type: 'number', placeholder: 'ex: 3', attrs: 'min="0"' })}
      ${ratingRow('difficulty', 'Dificuldade sentida', 3, 'Muito difícil', 'Muito fácil')}
      ${formActions({ save: 'Registrar rodada' })}`,
    wire: () => bindForm({
      validate(v) {
        const count = parseInt(v.count, 10), wrong = parseInt(v.wrong, 10);
        if (!(v.subject && v.topic && count > 0 && wrong >= 0)) return false;
        return wrong > count ? 'O número de erradas não pode ser maior que o total de questões.' : true;
      },
      onSave: (v) => commit(() => {
        const norm = (s) => s.trim().toLowerCase();
        const existing = state.topicReviews.find((t) => norm(t.subject) === norm(v.subject) && norm(t.topic) === norm(v.topic));
        const base = existing || { id: uid(), subject: v.subject, topic: v.topic, n: 0, EF: 2.5, intervalDays: 1, totalRounds: 0, history: [] };
        col.put('topicReviews', SC.applyTopicRound(base, int(v.count), int(v.wrong), int(v.difficulty, 3)));
      }),
    }),
  });

  // ---------- REVISÃO: SALVAR / EDITAR QUESTÃO ----------
  SC.modals.question = (m) => {
    const q = m.id ? col.find('questionBank', m.id) : null;
    if (m.id && !q) return null;
    const v = (k) => (q ? q[k] || '' : '');
    return {
      title: q ? 'Editar questão' : 'Salvar questão para refazer',
      body: `
        ${subjectField({ label: 'Matéria (opcional)', value: v('subject'), none: 'Sem matéria' })}
        ${inputField({ name: 'topic', label: 'Tópico (opcional)', value: v('topic'), placeholder: 'ex: Termoquímica', bold: true })}
        ${inputField({ name: 'statementText', label: 'Enunciado (opcional se anexar imagem)', value: v('statementText'), rows: 4, placeholder: 'Cole o enunciado, ou anexe a imagem abaixo e toque em “Extrair texto”' })}
        <div class="field"><label>Imagem (opcional se escreveu o enunciado)</label><div data-image-area="statement"></div></div>
        ${inputField({ name: 'answerKey', label: 'Gabarito (opcional)', value: v('answerKey'), placeholder: 'ex: C, 42, Verdadeiro', bold: true, attrs: 'maxlength="200"' })}
        ${inputField({ name: 'resolutionText', label: 'Resolução (opcional, texto)', value: v('resolutionText'), rows: 4, placeholder: 'Explique o passo a passo da resolução, se quiser' })}
        <div class="field"><label>Resolução (opcional, imagem)</label><div data-image-area="resolution"></div></div>
        ${formActions({ save: q ? 'Salvar alterações' : 'Salvar questão' })}`,
      wire() {
        let statementImg, resolutionImg;
        const form = bindForm({
          validate: (vals) => !!(vals.statementText || (statementImg && statementImg.get())),
          onSave(vals) {
            commit(() => {
              const fields = Object.assign(pick(vals, ['subject', 'topic', 'statementText', 'answerKey', 'resolutionText']), {
                imageData: statementImg.get(), resolutionImageData: resolutionImg.get(),
              });
              if (q) col.patch('questionBank', q.id, fields); // só conteúdo; o progresso de revisão não é tocado
              else {
                const now = Date.now();
                col.put('questionBank', Object.assign({
                  id: uid(), createdAt: now, n: 0, EF: 2.5, intervalDays: 0,
                  lastReviewedAt: null, nextReviewAt: now, retired: false, history: [],
                }, fields));
              }
            });
          },
        });
        const area = (k) => form.root.querySelector(`[data-image-area="${k}"]`);
        const field = (n) => form.root.querySelector(`[name="${n}"]`);
        statementImg = imageField(form, area('statement'), field('statementText'), 'Toque para escolher uma foto/print', q && q.imageData);
        resolutionImg = imageField(form, area('resolution'), field('resolutionText'), 'Toque para escolher uma foto/print da resolução', q && q.resolutionImageData);
        form.sync();

        // Ctrl+V / "Colar" com imagem vai para o campo em que você estava por
        // último (resolução ou enunciado). Colar só texto continua normal. O
        // listener se remove sozinho quando o modal fecha.
        const resolutionFields = [field('resolutionText').closest('.field'), area('resolution').closest('.field')];
        let lastField = null;
        const track = (e) => { lastField = e.target.closest ? e.target.closest('.field') : null; };
        form.root.addEventListener('focusin', track);
        form.root.addEventListener('pointerdown', track);
        function onPaste(e) {
          if (!document.body.contains(form.root)) { document.removeEventListener('paste', onPaste); return; }
          const items = e.clipboardData && e.clipboardData.items;
          if (!items) return;
          for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file' && items[i].type.indexOf('image/') === 0) {
              e.preventDefault();
              (resolutionFields.indexOf(lastField) !== -1 ? resolutionImg : statementImg).setFile(items[i].getAsFile());
              return;
            }
          }
        }
        document.addEventListener('paste', onPaste);
      },
    };
  };

  // Campo de imagem reutilizável (enunciado e resolução): escolher/colar,
  // pré-visualizar, remover e extrair texto por OCR para o textarea
  // correspondente (o texto entra para você revisar; nunca é salvo direto).
  function imageField(form, area, textarea, dropLabel, initial) {
    let data = initial || null;
    let originalFile = null; // foto original (melhor p/ OCR que a versão comprimida)

    function showDrop() {
      area.innerHTML = `
        <label class="image-drop">${icon('image')} <span>${dropLabel}</span><input type="file" accept="image/*"></label>
        <div class="ocr-row">
          <button type="button" class="btn-chip" data-role="paste">${icon('image', true)}Colar imagem</button>
          <span class="field-help" data-role="paste-hint">ou use Ctrl+V / “Colar” no teclado</span>
        </div>`;
      area.querySelector('input[type="file"]').addEventListener('change', (e) => setFile(e.target.files && e.target.files[0]));
      area.querySelector('[data-role="paste"]').addEventListener('click', onPasteButton);
    }

    // Botão "Colar imagem": lê a área de transferência (precisa de HTTPS e,
    // em alguns navegadores, de permissão). Ctrl+V continua funcionando.
    function onPasteButton() {
      const hint = area.querySelector('[data-role="paste-hint"]');
      const fail = (msg) => { if (hint) hint.textContent = msg; };
      if (!navigator.clipboard || !navigator.clipboard.read) {
        fail('Seu navegador não permite o botão. Use Ctrl+V (ou segure e toque em “Colar”).');
        return;
      }
      navigator.clipboard.read().then(async (items) => {
        for (const item of items) {
          const type = item.types.find((t) => t.indexOf('image/') === 0);
          if (type) {
            const blob = await item.getType(type);
            setFile(new File([blob], 'colada.' + (type.split('/')[1] || 'png'), { type }));
            return;
          }
        }
        fail('Não há imagem na área de transferência.');
      }).catch(() => fail('Não consegui acessar a área de transferência. Use Ctrl+V.'));
    }

    function showPreview() {
      area.innerHTML = `
        <div class="image-preview-wrap">
          <img src="${data}" alt="">
          <button type="button" class="image-preview-remove" data-role="remove" aria-label="Remover imagem">${icon('x')}</button>
        </div>
        <div class="ocr-row">
          <button type="button" class="btn-chip" data-role="ocr">${icon('edit', true)}Extrair texto da imagem</button>
          <span class="field-help ocr-status" data-role="ocr-status"></span>
        </div>`;
      area.querySelector('[data-role="remove"]').addEventListener('click', () => {
        data = null; originalFile = null;
        showDrop();
        form.sync();
      });
      const ocrBtn = area.querySelector('[data-role="ocr"]');
      const status = area.querySelector('[data-role="ocr-status"]');
      ocrBtn.addEventListener('click', () => {
        ocrBtn.disabled = true;
        form.showError('');
        SC.runOcr(originalFile || data, (msg) => { status.textContent = msg; })
          .then((text) => {
            if (!text) { status.textContent = 'Não encontrei texto legível nessa imagem.'; return; }
            const cur = textarea.value.trim();
            textarea.value = cur ? cur + '\n\n' + text : text;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            status.textContent = 'Texto inserido. Revise antes de salvar — o OCR pode errar acentos e fórmulas.';
          })
          .catch(() => { status.textContent = 'Não consegui carregar o leitor de texto. Na 1ª vez é preciso estar online.'; })
          .then(() => { ocrBtn.disabled = false; });
      });
    }

    // Entrada comum: arquivo escolhido, botão Colar ou Ctrl+V.
    function setFile(file) {
      if (!file) return;
      form.showError('');
      SC.resizeImageFile(file, 1000, 0.75).then((dataUrl) => {
        data = dataUrl; originalFile = file;
        showPreview();
        form.sync();
      }).catch(() => form.showError('Não consegui ler essa imagem. Tente outra.'));
    }

    if (data) showPreview(); else showDrop();
    return { get: () => data, setFile };
  }

  // ---------- REVISÃO: REFAZER QUESTÃO ----------
  SC.modals.redo = (m) => {
    const q = col.find('questionBank', m.id);
    if (!q) return null;
    // Gabarito/resolução começam escondidos a cada rodada, para forçar a tentativa antes de espiar.
    const reveal = (what, label, shown, hasContent, shownHtml) => !hasContent ? '' : (shown
      ? shownHtml
      : `<button type="button" class="btn-chip" data-action="reveal" data-what="${what}" style="margin-bottom:1rem">${icon('eye', true)}Ver ${label}</button>`);
    const grade = (result, cls, ico, label) =>
      `<button type="button" class="quality-btn quality-btn-${cls}" data-action="grade" data-id="${q.id}" data-result="${result}">${icon(ico)}${label}</button>`;
    return {
      title: 'Refazer questão',
      body: `
        <div class="review-question-preview">
          ${q.imageData ? `<img src="${q.imageData}" alt="">` : ''}
          ${q.statementText ? `<p>${esc(q.statementText)}</p>` : ''}
          ${(q.subject || q.topic) ? `<p class="field-help">${esc([q.subject, q.topic].filter(Boolean).join(' · '))}</p>` : ''}
        </div>
        ${reveal('answer', 'gabarito', m.answer, q.answerKey,
          `<div class="review-answer-key"><span class="review-answer-key-label">Gabarito</span><span class="review-answer-key-value">${esc(q.answerKey)}</span></div>`)}
        ${reveal('resolution', 'resolução', m.resolution, q.resolutionText || q.resolutionImageData,
          `<div class="review-resolution">
             <span class="review-answer-key-label">Resolução</span>
             ${q.resolutionImageData ? `<img src="${q.resolutionImageData}" alt="">` : ''}
             ${q.resolutionText ? `<p>${esc(q.resolutionText)}</p>` : ''}
           </div>`)}
        <p class="field-help" style="margin-bottom:0.5rem">Como foi dessa vez?</p>
        <div class="quality-buttons">
          ${grade('wrong', 'wrong', 'x', 'Errei')}${grade('hard', 'hard', 'alertCircle', 'Difícil')}${grade('easy', 'easy', 'check', 'Fácil')}
        </div>
        <div class="modal-form-actions" style="margin-top:1.5rem">
          <button type="button" class="btn-secondary-block" data-action="close-modal">Cancelar</button>
        </div>`,
    };
  };

  SC.closeModal = closeModal;
})();
