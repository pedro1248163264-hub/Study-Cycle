/* =========================================================
   Study Cycle — sincronização na nuvem (Supabase)

   Sem tela de login, mas não é aberto: todos os aparelhos usam uma
   linha fixa em `app_state`, trancada no banco — a única entrada são
   duas funções RPC (get_app_state / set_app_state) que conferem uma
   senha (guardada com hash no Postgres). A "anon key" abaixo pode ficar
   no front-end: é só um identificador, não dá acesso sozinha.

   Regra: "última alteração vence" — o lado (local ou nuvem) com a
   alteração mais recente sobrescreve o outro.
   ========================================================= */
(function () {
  'use strict';
  const SC = window.SC;
  const { state, esc, saveState, applyData, pickSyncable } = SC;

  const SUPABASE_URL = 'https://rhipgkcoacrarablillj.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJoaXBna2NvYWNyYXJhYmxpbGxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NzM4MjIsImV4cCI6MjEwMzQ0OTgyMn0.WfPALUnfcrwvibkb39cWh1_Vj-UdMm7lgFgiWj0u-5w';
  const CODE_KEY = 'studyCycleSyncCode'; // por aparelho, nunca sincronizado

  function callRpc(fnName, params) {
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + fnName, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    }).then((res) => {
      if (res.ok) return res.status === 204 ? null : res.json();
      return res.json().catch(() => null).then((body) => {
        const msg = (body && (body.message || body.hint)) || ('HTTP ' + res.status);
        const err = new Error(msg);
        err.isInvalidCode = /invalid code/i.test(msg);
        throw err;
      });
    });
  }

  const getCode = () => { try { return localStorage.getItem(CODE_KEY); } catch (e) { return null; } };
  const setCode = (c) => { try { localStorage.setItem(CODE_KEY, c); } catch (e) { /* ignora */ } };
  const clearCode = () => { try { localStorage.removeItem(CODE_KEY); } catch (e) { /* ignora */ } };

  const codeExists = () => callRpc('sync_code_exists', {});
  const claimCode = (code) => callRpc('claim_sync_code', { p_code: code });

  // Botão de sincronizar: garante que há uma senha neste aparelho antes de ir à rede.
  function syncNow() {
    if (state.sync.status === 'syncing') return;
    const code = getCode();
    if (!code) { SC.openModal('sync'); return; }
    performSync(code);
  }

  function performSync(code) {
    state.sync.status = 'syncing';
    renderSyncStatus();

    callRpc('get_app_state', { p_code: code }).then((rows) => {
      const remote = rows && rows.length ? { data: rows[0].data, at: new Date(rows[0].updated_at).getTime() } : null;
      const localAt = state.lastModifiedAt || 0;

      if (remote && remote.at > localAt) {
        // Nuvem mais nova: baixa e aplica.
        applyData(remote.data);
        state.lastModifiedAt = remote.at;
        state.lastSyncedAt = Date.now();
        saveState({ skipTouch: true, skipStatus: true });
        state.sync.status = 'synced';
        state.sync.direction = 'pulled';
        SC.applyTheme();
        SC.render();
      } else {
        // Local mais novo (ou nada na nuvem): envia.
        const now = Date.now();
        return callRpc('set_app_state', {
          p_code: code,
          p_data: pickSyncable(),
          p_updated_at: new Date(now).toISOString(),
        }).then(() => {
          state.lastModifiedAt = now;
          state.lastSyncedAt = now;
          saveState({ skipTouch: true, skipStatus: true });
          state.sync.status = 'synced';
          state.sync.direction = 'pushed';
          renderSyncStatus();
        });
      }
    }).then(() => uploadPending().then((n) => {
      // Gravou list.pdf.path: é alteração local nova, então sincroniza de novo (1 vez).
      if (n) { saveState(); performSync(code); }
    })).catch((err) => {
      state.sync.status = 'error';
      if (err && err.isInvalidCode) {
        clearCode(); // senha errada: esquece e pede de novo
        state.sync.error = 'Senha incorreta. Digite novamente.';
        SC.openModal('sync');
        return;
      }
      state.sync.error = (err && err.message) || 'Erro de conexão';
      renderSyncStatus();
    });
  }

  // ---------- PDFs DAS LISTAS (Supabase Storage) ----------
  // Bucket privado. Antes de cada envio/download/exclusão o app pede uma
  // liberação de 10 min para AQUELE arquivo (função pdf_grant, que confere
  // a senha de sincronização). Setup: supabase/pdf-storage.sql.
  const BUCKET = 'list-pdfs';
  const storageUrl = (path, authed) => SUPABASE_URL + '/storage/v1/object/' + (authed ? 'authenticated/' : '') + BUCKET + '/' + path;
  const storageHeaders = () => ({ apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY });

  function grant(path, op) {
    const code = getCode();
    if (!code) {
      const e = new Error('Sem senha de sincronização neste aparelho. Toque em sincronizar (⟳) e digite a senha.');
      e.noCode = true;
      return Promise.reject(e);
    }
    return callRpc('pdf_grant', { p_code: code, p_path: path, p_op: op }).catch((err) => {
      if (err.isInvalidCode) { clearCode(); err.message = 'Senha incorreta. Toque em sincronizar (⟳) e digite de novo.'; }
      else if (/pdf_grant/i.test(err.message)) err.message = 'A nuvem de PDFs ainda não foi configurada (rode supabase/pdf-storage.sql no Supabase).';
      throw err;
    });
  }

  function storageFail(res) {
    return res.text().then((t) => {
      let msg = null;
      try { const j = JSON.parse(t); msg = j.message || j.error; } catch (e) { /* corpo não é JSON */ }
      throw new Error(msg || ('HTTP ' + res.status));
    });
  }

  // Envia o PDF e devolve o caminho no bucket (guardado em list.pdf.path).
  function uploadPdf(file) {
    const path = SC.uid() + SC.uid() + SC.uid() + '.pdf'; // aleatório, nunca reaproveitado
    return grant(path, 'write').then(() => {
      const fd = new FormData();
      fd.append('cacheControl', '3600');
      fd.append('', file, file.name || 'lista.pdf');
      return fetch(storageUrl(path, false), { method: 'POST', headers: storageHeaders(), body: fd });
    }).then((res) => (res.ok ? path : storageFail(res)));
  }

  function downloadPdf(path) {
    return grant(path, 'read')
      .then(() => fetch(storageUrl(path, true), { headers: storageHeaders(), cache: 'no-store' }))
      .then((res) => (res.ok ? res.blob() : storageFail(res)));
  }

  // Melhor esforço: se falhar (offline), só sobra um arquivo órfão na nuvem.
  function removePdf(path) {
    if (!path) return Promise.resolve(false);
    return grant(path, 'delete')
      .then(() => fetch(storageUrl(path, false), { method: 'DELETE', headers: storageHeaders() }))
      .then((res) => res.ok)
      .catch(() => false);
  }

  // Limpeza de PDFs guardados neste aparelho por versões anteriores (v15/v16):
  // se ainda não estão na nuvem, sobe; depois APAGA a cópia local. Devolve quantas subiram.
  function uploadPending() {
    const todo = state.exerciseLists.filter((l) => l.pdf);
    let done = 0;
    return todo.reduce((chain, l) => chain.then((ok) => {
      if (!ok) return false;
      return SC.files.get(l.id).then((rec) => {
        if (!rec) return true;                                   // nada guardado aqui
        if (l.pdf.path) return SC.files.remove(l.id).then(() => true); // já está na nuvem: descarta a cópia
        const file = new File([rec.data], rec.name || l.pdf.name || 'lista.pdf', { type: 'application/pdf' });
        return uploadPdf(file).then((path) => {
          SC.col.patch('exerciseLists', l.id, { pdf: Object.assign({}, l.pdf, { path }) });
          done++;
          return SC.files.remove(l.id).then(() => true);
        });
      }).catch(() => false); // sem internet/senha: tenta no próximo sync
    }), Promise.resolve(true)).then(() => done);
  }

  // Atualiza só o botão + linha de status do cabeçalho (barato após cada edição).
  function renderSyncStatus() {
    const btn = document.getElementById('sync-btn');
    const dot = document.getElementById('sync-dot');
    const statusEl = document.getElementById('sync-status');
    if (!btn || !statusEl) return;

    const s = state.sync;
    const hasPending = (state.lastModifiedAt || 0) > (state.lastSyncedAt || 0);
    btn.classList.toggle('is-syncing', s.status === 'syncing');
    dot.hidden = !hasPending || s.status === 'syncing';
    statusEl.classList.toggle('is-error', s.status === 'error');

    const R = ICONS.refreshCw;
    if (s.status === 'syncing') {
      statusEl.innerHTML = `${R}Sincronizando…`;
    } else if (s.status === 'error') {
      statusEl.innerHTML = `${ICONS.cloudOff}Erro ao sincronizar: ${esc(s.error)}`;
    } else if (state.lastSyncedAt) {
      const time = new Date(state.lastSyncedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const dir = s.direction === 'pulled' ? ' (dados recebidos)' : s.direction === 'pushed' ? ' (dados enviados)' : '';
      statusEl.innerHTML = hasPending
        ? `${R}Última sincronização às ${time}${dir} · há alterações não sincronizadas`
        : `${R}Sincronizado às ${time}${dir}`;
    } else {
      statusEl.innerHTML = `${R}Ainda não sincronizado neste aparelho`;
    }
  }

  Object.assign(SC, {
    syncNow, performSync, renderSyncStatus,
    sync: { codeExists, claimCode, setCode, hasCode: () => !!getCode() },
    cloud: { upload: uploadPdf, download: downloadPdf, remove: removePdf, uploadPending },
  });
})();
