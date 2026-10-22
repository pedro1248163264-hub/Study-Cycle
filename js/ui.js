/* =========================================================
   Study Cycle — peças de interface reutilizáveis

   Tudo que se repetia entre telas/modais mora aqui: botões, cartões,
   barra de filtros, abas, estados vazios, campos de formulário e a
   "cola" dos formulários (validação + salvar). Telas e modais só
   compõem essas peças.

   Registros (cada tela/modal novo é UMA entrada, sem if/switch):
     SC.screens[chave] = { label, icon, render(d) -> html }
     SC.modals[nome]   = (m, d) -> { title, body, wire?() } | null
     SC.actions[nome]  = (el, evento) => ...   (data-action="nome")
   ========================================================= */
(function () {
  'use strict';
  const SC = window.SC;
  const { state, esc, saveState } = SC;

  SC.screens = {};
  SC.modals = {};
  SC.actions = {};

  // ---------- ÍCONES / BOTÕES ----------
  const icon = (name, small) => (small ? ICONS[name].replace('class="icon"', 'class="icon icon-sm"') : ICONS[name]);

  // { a: 1, b: 'x' } -> ' data-a="1" data-b="x"'
  const dataAttrs = (o) => Object.keys(o || {})
    .filter((k) => o[k] != null && o[k] !== false)
    .map((k) => ` data-${k}="${esc(o[k])}"`).join('');

  // Botão pequeno de cartão. variant: '' | 'success' | 'danger'.
  const chip = (label, iconName, action, data, variant) =>
    `<button type="button" class="btn-chip${variant ? ' btn-chip-' + variant : ''}" data-action="${action}"${dataAttrs(data)}>${iconName ? icon(iconName, true) : ''}${label}</button>`;

  // Botão grande. kind: 'primary' | 'card-outline'.
  const button = (label, iconName, action, data, kind) =>
    `<button type="button" class="btn btn-${kind || 'primary'}" data-action="${action}"${dataAttrs(data)}>${iconName ? icon(iconName, true) : ''}${label}</button>`;

  // ---------- BLOCOS DE TELA ----------
  const screenHeader = (title, subtitle, actionHtml) => `
    <div class="screen-header">
      <div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>
      ${actionHtml || ''}
    </div>`;

  const emptyState = (iconName, title, text, actionHtml, style) => `
    <div class="empty-state-block"${style ? ` style="${style}"` : ''}>
      ${icon(iconName)}
      <h3>${esc(title)}</h3>
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${actionHtml || ''}
    </div>`;

  // Abas. items: [{ key, label, count? }]; `uiKey` é o campo de state.ui que guarda a aba.
  const tabs = (uiKey, items) => `
    <div class="sub-tabs">${items.map((t) => `
      <button type="button" class="sub-tab${state.ui[uiKey] === t.key ? ' active' : ''}" data-action="set" data-key="${uiKey}" data-value="${t.key}">
        ${esc(t.label)}${t.count != null ? ` <span class="sub-tab-count">${t.count}</span>` : ''}
      </button>`).join('')}
    </div>`;

  // Cartão de lista. `main` é o miolo; `actions` a lista de botões.
  const logCard = ({ cls = '', thumb, main, mainCls = 'log-card-main', actions = [] }) => `
    <div class="log-card${cls ? ' ' + cls : ''}">
      ${thumb ? `<img class="log-card-thumb" src="${thumb}" alt="">` : ''}
      <div class="${mainCls}">${main}</div>
      <div class="log-card-actions">${actions.join('')}</div>
    </div>`;

  // Miolo padrão: linha de etiquetas, título e detalhe.
  const cardMain = ({ meta = [], title, detail }) => `
    <div class="log-card-meta">${meta.join('')}</div>
    <p class="log-card-name">${esc(title)}</p>
    ${detail ? `<p class="log-card-detail">${esc(detail)}</p>` : ''}`;

  const cardList = (cards) => `<div class="list-cards">${cards.join('')}</div>`;

  // ---------- FILTROS ----------
  // Matérias cadastradas + as que aparecem nos itens, em ordem alfabética.
  const subjectFilterOptions = (items) =>
    Array.from(new Set(state.subjects.map((s) => s.name).concat(items.map((i) => i.subject).filter(Boolean))))
      .sort((a, b) => a.localeCompare(b));

  // Aplica os filtros do grupo: o nome de cada filtro é o campo do item.
  const applyFilters = (list, group) => {
    const f = state.ui.filters[group];
    return list.filter((x) => Object.keys(f).every((k) => !f[k] || x[k] === f[k]));
  };

  // selects: [{ field, all, options: [[valor, rótulo], ...] }]
  function filterBar(group, selects, shownCount) {
    const f = state.ui.filters[group];
    const active = Object.keys(f).some((k) => f[k]);
    return `
      <div class="filter-bar">
        <span class="filter-label">${icon('filter')}Filtrar:</span>
        ${selects.map((s) => `
          <div class="filter-select-wrap">
            <select class="filter-select" data-filter="${group}.${s.field}">
              <option value="">${esc(s.all)}</option>
              ${s.options.map(([v, label]) => `<option value="${esc(v)}"${f[s.field] === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}
            </select>
            ${icon('chevronDown')}
          </div>`).join('')}
        ${active ? `<button type="button" class="filter-clear" data-action="clear-filters" data-group="${group}">${icon('x')}Limpar</button>` : ''}
        ${active && shownCount != null ? `<span class="filter-result-count">${shownCount} ${shownCount === 1 ? 'resultado' : 'resultados'}</span>` : ''}
      </div>`;
  }

  // Selo "Atrasada 2d" / "Hoje" / "Em 3d".
  function dueBadge(nextReviewAt) {
    if (!nextReviewAt) return '';
    const diff = SC.calendarDayDiff(nextReviewAt, Date.now());
    if (diff < 0) return `<span class="due-badge due-badge-overdue">${icon('flame')}Atrasada ${Math.abs(diff)}d</span>`;
    if (diff === 0) return `<span class="due-badge due-badge-today">${icon('flame')}Hoje</span>`;
    return `<span class="due-badge due-badge-upcoming">${icon('clock')}Em ${diff}d</span>`;
  }

  // ---------- CAMPOS DE FORMULÁRIO ----------
  // Cada campo tem `name`; o formulário inteiro é lido de uma vez (readForm).

  // bare: devolve só label + campo (sem a <div class="field"> em volta).
  function inputField({ name, label, value = '', placeholder = '', type = 'text', rows, bold, help, attrs = '', bare }) {
    const id = 'f-' + name;
    const control = rows
      ? `<textarea id="${id}" name="${name}" class="textarea-input" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input id="${id}" name="${name}" class="text-input${bold ? ' font-medium' : ''}" type="${type}" placeholder="${esc(placeholder)}" value="${esc(value)}" ${attrs}>`;
    const inner = `<label for="${id}">${esc(label)}</label>${control}${help ? `<p class="field-help">${esc(help)}</p>` : ''}`;
    return bare ? inner : `<div class="field">${inner}</div>`;
  }

  // options: [[valor, rótulo], ...]
  const selectControl = (name, options, value, extra = '') => `
    <div class="select-wrap">
      <select id="f-${name}" name="${name}" class="select-input" ${extra}>
        ${options.map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(label)}</option>`).join('')}
      </select>
      <span class="select-chevron">${icon('chevronDown')}</span>
    </div>`;

  const selectField = ({ name, label, options, value }) =>
    `<div class="field"><label for="f-${name}">${esc(label)}</label>${selectControl(name, options, value)}</div>`;

  // Escolha de matéria (usada em 5 modais).
  //   none:   texto da opção "sem matéria" (omite a opção se não vier)
  //   custom: permite "Outra (digitar)" — o valor lido já vem resolvido.
  function subjectField({ name = 'subject', label = 'Matéria', value = '', none, custom }) {
    const names = state.subjects.map((s) => s.name);
    const known = names.includes(value);
    const opts = (none != null ? [['', none]] : []).concat(names.map((n) => [n, n]));
    if (value && !known && !custom) opts.push([value, value]);
    if (custom) opts.push(['__custom__', 'Outra (digitar)']);
    const isCustom = !!custom && !!value && !known;
    return `
      <div class="field">
        <label for="f-${name}">${esc(label)}</label>
        ${selectControl(name, opts, isCustom ? '__custom__' : value, custom ? 'data-custom' : '')}
        ${custom ? `<input name="${name}Custom" class="text-input font-medium subject-custom" style="${isCustom ? '' : 'display:none'}" type="text" placeholder="Nome da matéria" value="${isCustom ? esc(value) : ''}">` : ''}
      </div>`;
  }

  // Grupo de botões que grava num <input hidden name=...>.
  //   cumulative: marca todos até o escolhido (notas 1-5); senão só o escolhido.
  function choice({ name, value, options, wrapCls, btnCls, cumulative }) {
    return `
      <input type="hidden" name="${name}" value="${esc(value)}">
      <div class="${wrapCls}">${options.map(([v, html]) => {
        const on = cumulative ? +v <= +value : String(v) === String(value);
        return `<button type="button" class="${btnCls}${on ? ' active' : ''}" data-choice="${name}" data-value="${esc(v)}"${cumulative ? ' data-cum="1"' : ''}>${html}</button>`;
      }).join('')}</div>`;
  }

  const ratingRow = (name, label, value, low, high) => `
    <div class="rating-row">
      <div class="rating-row-label"><span>${esc(label)}</span></div>
      <div class="rating-row-scale">
        <span class="rating-endpoint low">${esc(low)}</span>
        ${choice({ name, value, options: [1, 2, 3, 4, 5].map((i) => [i, i]), wrapCls: 'rating-buttons', btnCls: 'rating-btn', cumulative: true })}
        <span class="rating-endpoint">${esc(high)}</span>
      </div>
    </div>`;

  // Rodapé padrão dos formulários: caixa de erros + botões.
  //   cancel: mostra "Cancelar"; del: rótulo do botão Excluir (opcional).
  //   saveCls 'btn-primary-block...': botão único de largura total, sem a barra de ações.
  const formActions = ({ save, cancel = true, del, saveCls = 'btn-save-flex' }) => /btn-primary-block/.test(saveCls) ? `
    <div data-error></div>
    <button type="button" class="${saveCls}" data-save disabled>${esc(save)}</button>` : `
    <div data-error></div>
    <div class="modal-form-actions">
      ${del ? `<button type="button" class="btn-delete" data-delete>${esc(del)}</button>` : ''}
      ${cancel ? '<button type="button" class="btn-secondary-block" data-action="close-modal">Cancelar</button>' : ''}
      <button type="button" class="${saveCls}" data-save disabled>${esc(save)}</button>
    </div>`;

  const errorBox = (msg) => `<div class="error-box">${icon('alertCircle')}<p>${esc(msg)}</p></div>`;

  // Lê todos os campos [name] do formulário (texto já aparado). Selects com
  // "Outra (digitar)" devolvem o texto digitado.
  function readForm(root) {
    const v = {};
    root.querySelectorAll('[name]').forEach((el) => {
      if (/Custom$/.test(el.name)) return;
      v[el.name] = el.value.trim();
      if (el.value === '__custom__') {
        const c = root.querySelector(`[name="${el.name}Custom"]`);
        v[el.name] = c ? c.value.trim() : '';
      }
    });
    return v;
  }

  // Liga um formulário de modal:
  //   validate(valores) -> true (ok) | false (desabilita sem avisar) |
  //                        texto/lista de textos (desabilita e mostra o aviso)
  //   onSave(valores), onDelete() opcional.
  // Cuida sozinho de: habilitar/desabilitar Salvar, campo "Outra (digitar)",
  // botões de escolha (notas, categorias, horas) e campos condicionais
  // (data-when="campo=valor").
  function bindForm({ validate, onSave, onDelete }) {
    const root = document.querySelector('.modal-body');
    const saveBtn = root.querySelector('[data-save]');
    const errBox = root.querySelector('[data-error]');
    let validationShown = false;

    function sync() {
      root.querySelectorAll('select[data-custom]').forEach((sel) => {
        const c = root.querySelector(`[name="${sel.name}Custom"]`);
        if (c) c.style.display = sel.value === '__custom__' ? '' : 'none';
      });
      const v = readForm(root);
      root.querySelectorAll('[data-when]').forEach((el) => {
        const [k, val] = el.dataset.when.split('=');
        el.style.display = v[k] === val ? '' : 'none';
      });
      const res = validate ? validate(v) : true;
      const msgs = res === true || res === false ? [] : [].concat(res);
      if (msgs.length) { errBox.innerHTML = errorBox(msgs.join(' ')); validationShown = true; }
      else if (validationShown) { errBox.innerHTML = ''; validationShown = false; }
      saveBtn.disabled = res !== true;
    }

    root.addEventListener('input', sync);
    root.addEventListener('change', sync);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-choice]');
      if (!b) return;
      const name = b.dataset.choice;
      const value = b.dataset.value;
      root.querySelector(`input[name="${name}"]`).value = value;
      root.querySelectorAll(`[data-choice="${name}"]`).forEach((x) => {
        x.classList.toggle('active', x.dataset.cum ? +x.dataset.value <= +value : x.dataset.value === value);
      });
      sync();
    });
    saveBtn.addEventListener('click', () => { const v = readForm(root); if (!saveBtn.disabled) onSave(v); });
    const del = root.querySelector('[data-delete]');
    if (del && onDelete) del.addEventListener('click', onDelete);
    sync();
    return { root, sync, showError: (msg) => { errBox.innerHTML = msg ? errorBox(msg) : ''; validationShown = false; } };
  }

  // ---------- MODAL ----------
  const modalShell = (title, body, wide) => `
    <div class="modal-overlay">
      <div class="modal-backdrop" data-action="close-modal"></div>
      <div class="modal${wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-header">
          <h2>${esc(title)}</h2>
          <button type="button" class="modal-close" data-action="close-modal" aria-label="Fechar">${icon('x')}</button>
        </div>
        <div class="modal-body">${body}</div>
      </div>
    </div>`;

  // Abre um modal. `props` ficam em state.modal (ex.: { id } para editar).
  function openModal(name, props) {
    state.modal = Object.assign({ name }, props);
    render();
  }
  const closeModal = () => { state.modal = null; render(); };

  // Aplica uma alteração e fecha o modal: o fim de quase todo "Salvar".
  function commit(mutate) {
    mutate();
    state.modal = null;
    saveState();
    render();
  }

  // ---------- RENDER ----------
  function applyTheme() {
    document.documentElement.classList.toggle('dark', state.isDark);
    // Espelho síncrono para o <head> aplicar o tema antes da 1ª pintura.
    try { localStorage.setItem('sc-dark', state.isDark ? '1' : '0'); } catch (e) { /* ignora */ }
  }

  function render() {
    const keys = Object.keys(SC.screens);
    if (!SC.screens[state.ui.screen]) state.ui.screen = keys[0];

    document.getElementById('nav-tabs').innerHTML = keys.map((k) => `
      <button type="button" class="nav-tab${state.ui.screen === k ? ' active' : ''}" data-action="set" data-key="screen" data-value="${k}">
        ${icon(SC.screens[k].icon)}${esc(SC.screens[k].label)}
      </button>`).join('');
    SC.renderSyncStatus();
    const d = SC.getDerived(state); // calculado uma vez por redesenho
    document.getElementById('screen').innerHTML = SC.screens[state.ui.screen].render(d);

    const root = document.getElementById('modal-root');
    const m = state.modal;
    const spec = m && SC.modals[m.name] ? SC.modals[m.name](m, d) : null;
    if (!spec) { state.modal = null; root.innerHTML = ''; return; }
    root.innerHTML = modalShell(spec.title, spec.body, spec.wide);
    if (spec.wire) spec.wire();
  }

  Object.assign(SC, {
    icon, chip, button, screenHeader, emptyState, tabs, logCard, cardMain, cardList,
    subjectFilterOptions, applyFilters, filterBar, dueBadge,
    inputField, selectControl, selectField, subjectField, choice, ratingRow, formActions, errorBox,
    bindForm, openModal, closeModal, commit, applyTheme, render,
  });
})();
