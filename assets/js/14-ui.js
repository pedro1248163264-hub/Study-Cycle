/* =====================================================================
   assets/js/14-ui.js — camada de interface (UI): navegação, início (nível, meta,
   sequência), trilhas, treino (HUD, balões de XP, overlays), tela de recompensas
   da rodada, estatísticas e ajustes. Só apresentação: toda regra mora no Engine,
   no Progress e na Session.
   Depende de: praticamente todos os módulos anteriores.
   Usado por: 15-init.js (UI.init).
   ===================================================================== */

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const UI = {
  retake:null,           // {key, level} selecionado na escada para refazer a prova
  openTrack:null,        // trilha com o painel de detalhes aberto na aba Trilhas
  overlayAction:null,    // ação do botão principal do overlay visível (Enter também a dispara)
  keypadMode:null,
  pulseHistory:[],

  init(){
    applyI18N();
    this.buildAppSettings();
    this.buildKeypad();
    this.applyTheme();
    this.bindNav();
    this.bindTraining();
    this.renderHome();
    this.renderTracks();
    $('btnStart').onclick = ()=>Session.start();
    $('btnPause').onclick = ()=>Session.togglePause();
    $('btnResume').onclick = ()=>Session.togglePause();
    $('btnPauseExit').onclick = ()=>Session.exit();
    $('btnExitTraining').onclick = ()=>Session.exit();
    $('btnAnotherRound').onclick = ()=>Session.start(Session.opts && Session.opts.onlyTrack && !Session.opts.size ? {onlyTrack:Session.opts.onlyTrack} : {});
    $('btnFinish').onclick = ()=>{ this.showScreen('home'); this.setTab('home'); this.renderHome(); };
    $('btnGoHistory').onclick = ()=>{ this.showScreen('stats'); this.renderStats(); this.setTab('stats'); };
    // Ao esconder o app no meio de uma conta, pausa (o tempo não pode correr com a tela apagada).
    document.addEventListener('visibilitychange', ()=>{
      if(document.hidden && Session.active && !Session.paused && !Session.waiting && Session.current && !Session.answering) Session.togglePause();
    });
  },
  toast(msg){
    const el = $('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(()=>el.classList.remove('show'), 2200);
  },
  tabScreens:['home','tracks','stats','settings'],
  showScreen(name){
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    $('screen-'+name).classList.add('active');
    document.querySelector('.tabbar').style.display = this.tabScreens.includes(name) ? 'flex' : 'none';
    if(name==='training') $('screen-training').classList.toggle('focus', !!Store.data.settings.focusMode);
    if(name!=='training') this.hideOverlays();
    $('toast').classList.remove('show');
    const sc = $('screen-'+name); if(sc) sc.scrollTop = 0;
  },
  setTab(name){ document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active', x.dataset.tab===name)); },
  bindNav(){
    document.querySelectorAll('.tab').forEach(tab=>{
      tab.onclick = ()=>{
        const target = tab.dataset.tab;
        this.showScreen(target);
        if(target==='home') this.renderHome();
        if(target==='tracks') this.renderTracks();
        if(target==='stats') this.renderStats();
        if(target==='settings') this.buildAppSettings();
        this.setTab(target);
      };
    });
  },

  /* ===================== INÍCIO ===================== */
  fmtGoal(ms){ return U.fmtNum(Math.round(ms/100)/10)+'s'; },
  anyPlaced(){ return Engine.activeKeys().some(k=>Engine.track(k).placed); },
  renderHome(){
    const s = Store.data, info = Progress.levelInfo(s.player.xp);
    $('homeLevel').textContent = info.level;
    $('homeTitle').textContent = info.title;
    $('homeXpFill').style.width = Math.round(info.frac*100)+'%';
    $('homeXpText').textContent = info.into+' / '+info.need+' XP';
    // meta do dia
    const day = Progress.day(), goal = Progress.goal(), frac = U.clamp(day.items/goal, 0, 1);
    const C = 2*Math.PI*44;
    $('goalRingFg').style.strokeDasharray = C.toFixed(1);
    $('goalRingFg').style.strokeDashoffset = (C*(1-frac)).toFixed(1);
    $('goalRingFg').classList.toggle('done', day.goalHit);
    $('goalNum').textContent = Math.min(day.items, 9999);
    $('goalOf').textContent = '/ '+goal;
    $('goalSub').textContent = day.goalHit ? t('goal_done') : tf('goal_left', {n:Math.max(0, goal-day.items)});
    const streak = Progress.currentStreak();
    $('streakNum').textContent = streak;
    $('streakLabel').textContent = streak===1 ? t('day_streak_one') : t('day_streak');
    $('streakBox').classList.toggle('lit', streak>0);
    $('streakNote').textContent = Progress.streakAtRisk() ? t('streak_risk') : (s.streak.best>1 ? t('streak_best')+': '+s.streak.best : '');
    // semana
    const wk = $('weekStrip'); wk.innerHTML = '';
    Progress.weekStrip().forEach(d=>{
      const el = document.createElement('div');
      el.className = 'wk'+(d.hit?' hit':d.items>0?' some':'')+(d.today?' today':'');
      el.innerHTML = `<div class="dot">${d.hit?'✓':''}</div><div class="lb">${esc(d.label)}</div>`;
      wk.appendChild(el);
    });
    // CTA e cartões de contexto
    const placed = this.anyPlaced();
    $('placementCard').classList.toggle('hidden', placed);
    $('btnStart').textContent = placed ? t('start_round') : t('start_placement');
    const box = $('testBanners'); box.innerHTML = '';
    Engine.activeKeys().filter(k=>Engine.track(k).placed && Engine.track(k).testReady).forEach(k=>{
      const def = TRACKS[k];
      const b = document.createElement('button');
      b.className = 'test-banner';
      b.style.setProperty('--c', def.color);
      b.innerHTML = `<span class="sym">${esc(def.sym)}</span><span class="tx"><b>${esc(tf('test_ready_banner',{track:trackLabel(k)}))}</b><small>${esc(t('start_test'))}</small></span><span class="go">›</span>`;
      b.onclick = ()=>Session.start({onlyTrack:k, size:1});
      box.appendChild(b);
    });
    $('homeTotal').textContent = s.player.items;
    $('homeRounds').textContent = s.player.rounds;
    $('homeCombo').textContent = s.bestStreak||0;
  },

  /* ===================== TRILHAS ===================== */
  starsText(n, of){ return '★'.repeat(n)+'☆'.repeat(Math.max(0, of-n)); },
  renderTracks(){
    const root = $('trackList'); root.innerHTML = '';
    TRACK_ORDER.forEach(key=>{
      const def = TRACKS[key], v = Analytics.trackView(key), open = this.openTrack===key;
      const card = document.createElement('div');
      card.className = 'track-card'+(open?' open':'')+(v.active?'':' off');
      card.style.setProperty('--c', def.color);
      let status;
      if(!v.placed) status = t('track_placing');
      else if(v.done) status = v.rank>0 ? tf('track_master',{n:v.rank}) : t('track_done');
      else status = tf('track_level_short',{n:v.level})+'/'+v.n;
      const badge = v.testReady && v.placed && !v.done ? `<span class="badge">${esc(t('test_waiting'))}</span>` : '';
      card.innerHTML = `<div class="tc-head"><div class="tc-sym">${esc(def.sym)}</div>
        <div class="tc-main"><div class="tc-name">${esc(trackLabel(key))}${badge}</div>
        <div class="tc-sub">${esc(status)}${v.placed?' · ★ '+v.stars+'/'+v.starsMax:''}</div></div>
        <label class="switch"><input type="checkbox" ${v.active?'checked':''}><span class="track"><span class="thumb"></span></span></label></div>
        <div class="tc-bar"><i style="width:${v.placed?Math.round(v.bar*100):0}%"></i></div>`;
      const head = card.querySelector('.tc-head');
      const sw = card.querySelector('.switch');
      sw.onclick = e=>e.stopPropagation();
      card.querySelector('input').onchange = ev=>{
        const cur = Store.data.settings.activeTracks;
        if(!ev.target.checked){
          if(cur.length<=1){ ev.target.checked = true; this.toast(t('keep_one_track')); return; }
          Store.data.settings.activeTracks = cur.filter(k=>k!==key);
        } else Store.data.settings.activeTracks = TRACK_ORDER.filter(k=>cur.includes(k)||k===key);
        Store.save(); this.renderTracks(); this.renderHome();
      };
      head.onclick = ()=>{ this.openTrack = open ? null : key; this.renderTracks(); };
      if(open) card.appendChild(this.trackDetail(key, v));
      root.appendChild(card);
    });
  },
  trackDetail(key, v){
    const def = TRACKS[key], tr = v.tr, box = document.createElement('div');
    box.className = 'tc-detail';
    let html = '';
    if(v.placed){
      const lvlName = v.done ? levelName(key, v.n) : levelName(key, v.level);
      html += `<div class="tc-lvl">${esc(tf('track_level_short',{n:v.done?v.n:v.level}))} — ${esc(lvlName)}</div>`;
      html += `<div class="tc-stats"><span>${esc(t('goal_label'))} <b>${this.fmtGoal(v.goalMs)}</b></span>`+
        `<span>${esc(t('median_label'))} <b>${v.median==null?'—':this.fmtGoal(v.median)}</b></span>`+
        `<span>${esc(t('recent_acc'))} <b>${v.accuracy==null?'—':U.fmtPct(v.accuracy)}</b></span></div>`;
      if(!v.done) html += `<div class="tc-xp">${v.xp}/${v.need} XP${v.bar>=1&&!v.testReady?' · '+esc(t('bar_full_wait')):''}</div>`;
      let lad = '';
      for(let l=1;l<=v.n;l++){
        const st = tr.stars[l]||0, cur = !v.done && l===v.level;
        lad += `<div data-l="${l}" class="lad${cur?' cur':''}${st?' got':''}${(st&&st<3&&(v.done||l<v.level))?' tap':''}${(!st&&!cur&&l>v.level&&!v.done)?' lock':''}"><b>${l}</b><span>${st?'★'.repeat(st):'·'}</span></div>`;
      }
      html += `<div class="ladder">${lad}</div>`;
      const tipLevel = v.done ? v.n : v.level;
      html += `<div class="tc-tip"><b>${esc(t('level_tip_title'))}</b><br>${esc(levelTip(key, tipLevel))}</div>`;
    } else {
      html += `<p>${esc(t('placement_card_sub'))}</p>`;
    }
    box.innerHTML = html;
    box.querySelectorAll('.lad.tap').forEach(el=>{
      el.onclick = ()=>{ this.retake = (this.retake && this.retake.key===key && this.retake.level===+el.dataset.l) ? null : {key, level:+el.dataset.l}; this.renderTracks(); };
      if(this.retake && this.retake.key===key && this.retake.level===+el.dataset.l) el.classList.add('sel');
    });
    const row = document.createElement('div'); row.className = 'btn-row'; row.style.marginTop = '12px';
    const only = document.createElement('button'); only.className = 'btn btn-ghost small'; only.textContent = t('train_only');
    only.onclick = ()=>Session.start({onlyTrack:key});
    row.appendChild(only);
    if(v.placed && v.testReady && !v.done){
      const test = document.createElement('button'); test.className = 'btn btn-primary small'; test.textContent = t('start_test');
      test.onclick = ()=>Session.start({onlyTrack:key, size:1});
      row.appendChild(test);
    }
    box.appendChild(row);
    if(this.retake && this.retake.key===key){
      const rt = document.createElement('button'); rt.className = 'btn btn-ghost small'; rt.style.marginTop = '10px';
      rt.textContent = t('retake_test')+' · '+tf('track_level_short',{n:this.retake.level});
      rt.onclick = ()=>{ const r = this.retake; this.retake = null; Session.start({retake:r}); };
      box.appendChild(rt);
    }
    return box;
  },

  /* ===================== TREINO ===================== */
  resetTraining(total){
    this.pulseHistory = [];
    $('pulseStrip').innerHTML = '';
    $('hudBarFill').style.width = '0%';
    $('hudCombo').classList.remove('on'); $('hudCombo').textContent = '';
    $('hudXp').textContent = '+0 XP';
    this.hideOverlays();
    this.setPaused(false);
    $('screen-training').classList.toggle('focus', !!Store.data.settings.focusMode);
    this.clearAnswerFeedback();
    this.updateAnswerDisplay('');
  },
  setBlockChip(spec){
    const def = TRACKS[spec.track];
    $('chipSym').textContent = def.sym;
    $('chipName').textContent = trackLabel(spec.track);
    $('hudChip').style.setProperty('--c', def.color);
    $('hudChip').dataset.kind = spec.kind;
    $('chipLevel').textContent = spec.kind==='placement' ? '' : tf('track_level_short',{n:spec.level});
    $('chipTag').textContent = this.kindLabel(spec.kind, spec);
  },
  kindLabel(kind, o){
    if(kind==='test') return t('block_test');
    if(kind==='placement') return t('block_placement');
    if(o && o.reinforce) return t('block_reinforce');
    return t('block_practice');
  },
  setItemChip(item){
    $('chipLevel').textContent = item.kind==='placement' ? '' : tf('track_level_short',{n:item.level});
    $('chipTag').textContent = item.isWarmup ? t('block_warmup') : this.kindLabel(item.kind, {reinforce:item.isReinforce});
    $('hudChip').dataset.kind = item.isWarmup ? 'warmup' : item.kind;
  },
  updateHud(session){
    const st = session.stats, frac = session.plannedTotal ? U.clamp(st.itemsDone/session.plannedTotal, 0, 1) : 0;
    $('hudBarFill').style.width = Math.round(frac*100)+'%';
    const c = $('hudCombo');
    if(session.combo>=3){ c.textContent = '🔥 '+session.combo; c.classList.add('on'); } else c.classList.remove('on');
    $('hudXp').textContent = '+'+st.xp+' XP';
  },
  popXp(gained, comboBonus, correct){
    if(!correct || !gained) return;
    const el = document.createElement('div');
    el.className = 'xp-pop'+(comboBonus?' combo':'');
    el.textContent = '+'+gained+(comboBonus?' 🔥':'');
    $('xpPop').appendChild(el);
    setTimeout(()=>el.remove(), 950);
  },
  setPaused(on){
    $('overlayPause').classList.toggle('hidden', !on);
    $('btnPause').textContent = on ? '▶' : '⏸';
    if(on) this.overlayAction = ()=>Session.togglePause();
    else if($('overlayIntro').classList.contains('hidden') && $('overlayResult').classList.contains('hidden')) this.overlayAction = null;
  },
  hideOverlays(){
    ['overlayIntro','overlayResult','overlayPause'].forEach(id=>{ const el=$(id); if(el) el.classList.add('hidden'); });
    this.overlayAction = null;
  },
  showBlockIntro(info, onGo){
    const spec = info.spec, def = TRACKS[spec.track];
    const ov = $('overlayIntro');
    ov.style.setProperty('--c', def.color);
    $('ovSym').textContent = def.sym;
    $('ovKind').textContent = spec.kind==='test' ? t('block_test') : spec.kind==='placement' ? t('block_placement') : spec.reinforce ? t('block_reinforce') : trackLabel(spec.track);
    $('ovTitle').textContent = spec.kind==='placement' ? t('placement_card_title') : trackLabel(spec.track)+' · '+tf('track_level_short',{n:spec.level});
    let sub = '';
    if(spec.kind==='test') sub = tf('test_intro',{n:TEST_ITEMS, k:TEST_PASS_CORRECT});
    else if(spec.kind==='placement') sub = tf('placement_intro',{n:PLACEMENT_ITEMS});
    else if(spec.reinforce) sub = t('reinforce_intro');
    else sub = levelName(spec.track, spec.level);
    $('ovSub').textContent = sub;
    const tr = Engine.track(spec.track);
    $('ovGoal').textContent = spec.kind==='placement' ? '' :
      t('goal_label')+' '+this.fmtGoal(levelGoalMs(spec.track, spec.level, tr.done?tr.rank:0));
    const tip = $('ovTip');
    if(spec.kind!=='placement' && (info.firstVisit || spec.kind==='test')){
      tip.innerHTML = `<b>${esc(t('tip_title'))}</b><br>${esc(levelTip(spec.track, spec.level))}`;
      tip.classList.remove('hidden');
    } else tip.classList.add('hidden');
    const fl = $('ovFlash');
    if(info.flashNotice){ fl.textContent = tf('flash_notice',{n:WARMUP_ITEMS, s:U.fmtNum(MASTERY_FLASH_MS/1000)}); fl.classList.remove('hidden'); } else fl.classList.add('hidden');
    $('ovGo').textContent = t('go');
    const go = ()=>{ ov.classList.add('hidden'); this.overlayAction = null; if(onGo) onGo(); };
    $('ovGo').onclick = go;
    this.overlayAction = go;
    ov.classList.remove('hidden');
    $('equationText').replaceChildren();
    setTimeout(()=>{ try{ $('ovGo').focus(); }catch(e){} }, 30);
  },
  showTestResult(res, onContinue){
    const r = res.test, def = TRACKS[res.key], ov = $('overlayResult');
    ov.style.setProperty('--c', def.color);
    ov.classList.toggle('pass', !!r.pass);
    $('resSym').textContent = def.sym;
    $('resTitle').textContent = r.pass ? t('test_result_pass') : t('test_result_fail');
    $('resStars').innerHTML = r.pass ? [1,2,3].map(i=>`<span class="${i<=r.stars?'on':''}" style="animation-delay:${0.25+i*0.22}s">★</span>`).join('') : '';
    $('resLine').textContent = tf('test_result_line', {c:r.correct, total:res.total, h:r.hits, med:r.medianMs==null?'—':U.fmtSec(r.medianMs)});
    let note = '';
    if(r.pass && r.leveledUp) note = tf('ev_level_up',{track:trackLabel(res.key), n:res.level})+' → '+tf('track_level_short',{n:r.newLevel})+' · '+levelName(res.key, r.newLevel);
    else if(r.pass && r.finished) note = tf('ev_level_finish',{track:trackLabel(res.key)});
    else if(r.pass) note = tf('ev_stars_up',{track:trackLabel(res.key), n:res.level, s:r.stars});
    else note = tf('ev_test_failed',{track:trackLabel(res.key), c:r.correct, total:res.total});
    $('resNote').textContent = note;
    $('resXp').textContent = res.bonus ? '+'+res.bonus+' XP' : '';
    $('resGo').textContent = t('continue_btn');
    const go = ()=>{ ov.classList.add('hidden'); this.overlayAction = null; if(onContinue) onContinue(); };
    $('resGo').onclick = go; this.overlayAction = go;
    ov.classList.remove('hidden');
    if(r.pass) this.celebrate('test');
    setTimeout(()=>{ try{ $('resGo').focus(); }catch(e){} }, 30);
  },

  /* ----- teclado ----- */
  // 'click' só dispara quando o dedo sai do botão (e alguns navegadores esperam um possível
  // duplo toque): o teclado é a peça mais sensível do app, então registra no 'pointerdown'.
  pressKey(btn, handler){
    if(window.PointerEvent) btn.addEventListener('pointerdown', e=>{ e.preventDefault(); handler(); });
    else btn.addEventListener('click', handler);
  },
  setKeypadMode(mode){
    if(this.keypadMode===mode) return;
    this.keypadMode = mode;
    this.buildKeypad();
  },
  buildKeypad(){
    const grid = $('keypad'); if(!grid) return;
    grid.innerHTML = '';
    if(this.keypadMode==='comparison'){
      ['<','=','>'].forEach(k=>{
        const btn = document.createElement('button');
        btn.className = 'key func'; btn.dataset.compare = k; btn.textContent = k;
        this.pressKey(btn, ()=>Session.submitComparison(k));
        grid.appendChild(btn);
      });
      const okBtn = document.createElement('button');
      okBtn.className = 'key func wide3'; okBtn.dataset.ok = '1'; okBtn.textContent = '✓';
      this.pressKey(okBtn, ()=>Session.evaluate(false));
      grid.appendChild(okBtn);
      return;
    }
    ['1','2','3','4','5','6','7','8','9','±','0','←'].forEach(k=>{
      const btn = document.createElement('button');
      btn.className = 'key'+(k==='←'||k==='±' ? ' func':'');
      btn.textContent = k;
      this.pressKey(btn, ()=>{
        if(k==='←') Session.submitDigit('back');
        else if(k==='±') Session.submitDigit('sign');
        else Session.submitDigit(k);
      });
      grid.appendChild(btn);
    });
    const decBtn = document.createElement('button');
    decBtn.className = 'key func'; decBtn.textContent = U.decimalSep();
    this.pressKey(decBtn, ()=>Session.submitDigit('dec'));
    grid.appendChild(decBtn);
    const okBtn = document.createElement('button');
    okBtn.className = 'key func wide2'; okBtn.dataset.ok = '1'; okBtn.textContent = '✓';
    this.pressKey(okBtn, ()=>Session.evaluate(false));
    grid.appendChild(okBtn);
  },
  bindTraining(){
    document.addEventListener('keydown', e=>{
      if(!Session.active || !$('screen-training').classList.contains('active')) return;
      if(this.overlayAction){
        if(e.key==='Enter' || e.key===' '){ e.preventDefault(); const a = this.overlayAction; a(); }
        return;
      }
      if(/^[0-9]$/.test(e.key)) Session.submitDigit(e.key);
      else if(e.key==='Backspace') Session.submitDigit('back');
      else if(e.key==='-') Session.submitDigit('sign');
      else if(e.key==='.' || e.key===',') Session.submitDigit('dec');
      else if(e.key==='<') Session.submitComparison('<');
      else if(e.key==='>') Session.submitComparison('>');
      else if(e.key==='=') Session.submitComparison('=');
      else if(e.key==='Enter') Session.evaluate(false);
    });
  },

  /* ----- renderização da conta ----- */
  mathSpan(text, className=''){
    const node = document.createElement('span');
    if(className) node.className = className;
    node.textContent = text;
    return node;
  },
  mathOperator(op){
    const symbols = {soma:'+', subtracao:'−', multiplicacao:'×', divisao:'÷'};
    return this.mathSpan(symbols[op] || (OPS[op] && OPS[op].symbol) || op, 'math-operator');
  },
  mathFraction(numerator, denominator){
    const fraction = document.createElement('span');
    fraction.className = 'math-fraction';
    const top = document.createElement('span'), bottom = document.createElement('span');
    top.append(numerator); bottom.append(denominator);
    fraction.append(top, bottom);
    return fraction;
  },
  mathTerm(term){
    if(term.kind==='fraction') return this.mathFraction(this.mathSpan(String(term.num)), this.mathSpan(String(term.den)));
    if(term.kind==='radical'){
      const root = document.createElement('span');
      root.className = 'math-radical';
      root.append(this.mathSpan(term.index===3 ? '∛' : '√', 'radical-sign'), this.mathSpan(String(term.radicand), 'radicand'));
      return root;
    }
    if(term.kind==='power'){
      const power = document.createElement('span');
      power.className = 'math-power';
      const base = term.base<0 ? `(−${Math.abs(term.base)})` : String(term.base);
      const exponent = document.createElement('sup');
      exponent.textContent = String(term.exp);
      power.append(this.mathSpan(base), exponent);
      return power;
    }
    return this.mathSpan(term.value<0 ? `(−${Math.abs(term.value)})` : String(term.value));
  },
  linearEquationPart(coef, constant){
    const fragment = document.createDocumentFragment();
    if(coef!==0){
      if(coef===-1) fragment.append(this.mathSpan('−x'));
      else if(coef===1) fragment.append(this.mathSpan('x'));
      else fragment.append(this.mathSpan(`${coef}x`));
      if(constant!==0) fragment.append(this.mathSpan(constant>0 ? ' + ' : ' − '), this.mathSpan(String(Math.abs(constant))));
    } else fragment.append(this.mathSpan(String(constant)));
    return fragment;
  },
  renderMathQuestion(item, eqEl){
    eqEl.replaceChildren();
    if(item.isEquation){
      const prompt = this.mathSpan('x = ?', 'math-equation-prompt');
      const line = document.createElement('div');
      line.className = 'math-equation-line';
      line.append(this.linearEquationPart(item.a, item.b), this.mathSpan(' = ', 'math-operator'), this.linearEquationPart(item.c, item.d));
      eqEl.append(prompt, line);
      return;
    }
    if(item.op==='porcentagem_original'){
      const line = document.createElement('div');
      line.className = 'math-equation-line';
      line.append(this.mathSpan('x'), this.mathSpan(item.features&&item.features.aumento?' + ':' − ', 'math-operator'),
        this.mathSpan(`${U.fmtNum(item.b)}%`), this.mathSpan(' = ', 'math-operator'), this.mathSpan(U.fmtNum(item.a)));
      eqEl.append(line, this.mathSpan('x = ?', 'math-equation-prompt below'));
      return;
    }
    if(item.op==='fracao_comparacao'){
      const row = document.createElement('div');
      row.className = 'math-row math-compare';
      row.append(this.mathFraction(this.mathSpan(String(item.a)), this.mathSpan(String(item.b))), this.mathSpan('?', 'math-compare-gap'),
        this.mathFraction(this.mathSpan(String(item.c)), this.mathSpan(String(item.d))));
      eqEl.append(row);
      return;
    }
    const row = document.createElement('div');
    row.className = 'math-row';
    if(item.terms && item.ops){
      const isFractionDivision = item.ops.length===1 && item.ops[0]==='divisao' && item.terms.every(term=>term.kind==='fraction');
      if(isFractionDivision){
        const complex = document.createElement('span');
        complex.className = 'math-complex-fraction';
        const top = document.createElement('span'), bottom = document.createElement('span');
        top.append(this.mathTerm(item.terms[0])); bottom.append(this.mathTerm(item.terms[1]));
        complex.append(top, bottom);
        row.append(complex);
      } else {
        row.append(this.mathTerm(item.terms[0]));
        item.ops.forEach((op, i)=>row.append(this.mathOperator(op), this.mathTerm(item.terms[i+1])));
      }
    } else {
      let text;
      if(item.op==='porcentagem_inversa') text = `${item.a} ${t('pct_is_what_pct_of')} ${item.b}?`;
      else if(item.op==='porcentagem_acrescimo' || item.op==='porcentagem_desconto') text = `${U.fmtNum(item.a)} ${item.op==='porcentagem_acrescimo'?'+':'−'} ${U.fmtNum(item.b)}%`;
      else if(item.op==='porcentagem_aumento') text = `${U.fmtNum(item.a)} → ${U.fmtNum(item.b)} = +?%`;
      else if(item.op==='porcentagem_reducao') text = `${U.fmtNum(item.a)} → ${U.fmtNum(item.b)} = −?%`;
      else if(item.op==='porcentagem_sucessiva') text = `${U.fmtNum(item.a)} − ${U.fmtNum(item.b)}% − ${U.fmtNum(item.c)}%`;
      else text = item.exprText ? item.exprText
        : item.op==='porcentagem' ? `${item.a}% ${t('pct_of')} ${item.b}`
        : `${U.fmtNum(item.a)} ${item.symbol} ${U.fmtNum(item.b)}`;
      row.textContent = text;
    }
    eqEl.append(row);
  },
  renderQuestion(item, onReady){
    const eqEl = $('equationText');
    this.setItemChip(item);
    this.renderMathQuestion(item, eqEl);
    this.updateAnswerDisplay('');
    $('feedbackAnswer').textContent = '';
    $('feedbackHint').textContent = '';
    const s = Store.data.settings;
    if(s.tts && TTS.supported()){
      const spoken = spokenPhrase(item, s.voiceLang);
      if(s.hideDuringTts) eqEl.classList.add('hidden-eq');
      TTS.speak(spoken, ()=>{
        if(!s.hideDuringTts) eqEl.classList.remove('hidden-eq');
        if(onReady) onReady();
      });
    } else {
      eqEl.classList.remove('hidden-eq');
      if(onReady) onReady();
    }
  },
  updateAnswerDisplay(val){
    const el = $('answerDisplay');
    el.textContent = val.length ? val : ' ';
    el.classList.remove('correct','wrong');
  },
  flashAnswer(correct){ $('answerDisplay').classList.add(correct?'correct':'wrong'); },
  clearAnswerFeedback(){
    $('answerDisplay').classList.remove('correct','wrong');
    $('feedbackAnswer').textContent = '';
    $('feedbackHint').textContent = '';
  },
  showCorrectAnswer(item){
    const isCmp = item && item.op==='fracao_comparacao';
    const value = isCmp ? compareSymbolOf(item.answer) : U.fmtNum(item && item.answer);
    $('feedbackAnswer').textContent = t('answer_label')+': '+value;
  },
  showHint(text){ $('feedbackHint').textContent = text; },
  setMasteryBlur(active){ const el = $('equationText'); if(el) el.classList.toggle('mastery-blur', !!active); },
  pushPulse(cls){
    this.pulseHistory.push(cls); if(this.pulseHistory.length>16) this.pulseHistory.shift();
    const strip = $('pulseStrip');
    const heights = {target:34, slow:15, err:8};
    while(strip.children.length<this.pulseHistory.length){ const bar = document.createElement('div'); bar.className = 'pulse-bar'; strip.appendChild(bar); }
    while(strip.children.length>this.pulseHistory.length) strip.removeChild(strip.lastChild);
    for(let i=0;i<this.pulseHistory.length;i++){
      const c = this.pulseHistory[i], bar = strip.children[i];
      if(bar.className!=='pulse-bar '+c){ bar.className = 'pulse-bar '+c; bar.style.height = heights[c]+'px'; }
    }
  },

  /* ===================== RESUMO / RECOMPENSAS ===================== */
  countUp(el, to, ms, prefix='', suffix=''){
    const start = performance.now();
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduce || to<=0){ el.textContent = prefix+to+suffix; return; }
    const step = now=>{
      const k = Math.min(1, (now-start)/ms), e = 1-Math.pow(1-k, 3);
      el.textContent = prefix+Math.round(to*e)+suffix;
      if(k<1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },
  eventLine(e){
    const tl = e.key ? trackLabel(e.key) : '';
    switch(e.type){
      case 'playerLevel': return {ic:'🏆', cls:'big', tx:tf('ev_player_level',{n:e.level, title:e.title})};
      case 'levelUp': return {ic:'⬆️', cls:'big', tx:(e.finished ? tf('ev_level_finish',{track:tl}) : tf('ev_level_up',{track:tl, n:e.level}))+' '+'★'.repeat(e.stars||0)};
      case 'starsUp': return {ic:'⭐', cls:'', tx:tf('ev_stars_up',{track:tl, n:e.level, s:e.stars})};
      case 'rankUp': return {ic:'🎖️', cls:'big', tx:tf('ev_rank_up',{track:tl, n:e.rank})};
      case 'record': return {ic:'⚡', cls:'', tx:tf('ev_record',{track:tl, n:e.level, cur:U.fmtSec(e.ms), prev:U.fmtSec(e.prev)})};
      case 'placed': return {ic:'📍', cls:'', tx:tf('ev_placed',{track:tl, n:e.level})};
      case 'testReady': return {ic:'🎯', cls:'big', tx:tf('ev_test_ready',{track:tl})};
      case 'goal': return {ic:'🔥', cls:'big', tx:tf('ev_goal',{n:e.xp})};
      case 'testFailed': return {ic:'💪', cls:'', tx:tf('ev_test_failed',{track:tl, c:e.correct, total:TEST_ITEMS})};
      case 'reinforce': return {ic:'🧱', cls:'', tx:tf('ev_reinforce',{track:tl, n:e.level})};
    }
    return null;
  },
  renderSummary(sum){
    const rec = sum.record;
    $('sumKicker').textContent = sum.completed ? t('round_done') : t('round_partial');
    $('sumStars').innerHTML = sum.completed ? [1,2,3].map(i=>`<span class="${i<=sum.stars?'on':''}" style="animation-delay:${0.2+i*0.25}s">★</span>`).join('') : '';
    $('sumStars').classList.toggle('hidden', !sum.completed);
    this.countUp($('sumXp'), sum.xp, 900, '+', ' XP');
    $('sumXpSub').textContent = sum.roundBonus ? tf('sum_bonus',{n:sum.roundBonus}) : '';
    // jogador
    const pi = sum.player.info;
    $('sumPlayerLevel').textContent = t('level_word')+' '+pi.level;
    $('sumPlayerTitle').textContent = pi.title;
    $('sumPlayerUp').classList.toggle('hidden', pi.level<=sum.player.before);
    $('sumPlayerFill').style.width = '0%';
    setTimeout(()=>{ $('sumPlayerFill').style.width = Math.round(pi.frac*100)+'%'; }, 150);
    $('sumPlayerText').textContent = pi.into+' / '+pi.need+' XP';
    // meta do dia
    const g = sum.goal;
    $('sumGoalText').textContent = g.hit ? t('goal_done') : tf('goal_left',{n:Math.max(0, g.goal-g.items)});
    $('sumGoalCount').textContent = Math.min(g.items, 9999)+' / '+g.goal;
    $('sumGoalFill').style.width = '0%';
    $('sumGoalFill').classList.toggle('done', g.hit);
    setTimeout(()=>{ $('sumGoalFill').style.width = Math.round(U.clamp(g.items/g.goal,0,1)*100)+'%'; }, 150);
    $('sumStreak').textContent = '🔥 '+sum.streak;
    // métricas
    $('sumAcc').textContent = U.fmtPct(sum.accuracy);
    $('sumTarget').textContent = U.fmtPct(sum.targetRate);
    $('sumCombo').textContent = sum.bestCombo;
    $('sumTotal').textContent = sum.total;
    // trilhas: barra "de → para"
    const bars = $('sumTracks'); bars.innerHTML = '';
    const touched = (rec.tracks||[]).filter(k=>sum.snap && sum.snap[k] && sum.snap[k].placed && TRACKS[k]);
    touched.forEach(k=>{
      const before = sum.snap[k], tr = Engine.track(k), def = TRACKS[k];
      const leveled = tr.level>before.level || (tr.done && !before.done);
      const toFrac = leveled ? 1 : Engine.barFrac(tr);
      const lv = leveled ? tf('track_level_short',{n:before.level})+' → '+(tr.done&&!before.done ? '🏁' : tf('track_level_short',{n:tr.level})) : tf('track_level_short',{n:tr.level});
      const row = document.createElement('div');
      row.className = 'sum-track'; row.style.setProperty('--c', def.color);
      row.innerHTML = `<div class="tc-sym sm">${esc(def.sym)}</div><div class="st-main"><div class="st-top"><b>${esc(trackLabel(k))}</b><span>${esc(lv)}${tr.testReady&&!tr.done?' · 🎯':''}</span></div><div class="tc-bar"><i style="width:${Math.round(before.frac*100)}%"></i></div></div>`;
      bars.appendChild(row);
      const fill = row.querySelector('i');
      setTimeout(()=>{ fill.style.width = Math.round(toFrac*100)+'%'; }, 250);
    });
    $('sumTracksCard').classList.toggle('hidden', !touched.length);
    // conquistas
    const order = ['playerLevel','levelUp','rankUp','testReady','goal','starsUp','record','placed','testFailed','reinforce'];
    const evs = (sum.events||[]).filter(e=>order.includes(e.type)).sort((a,b)=>order.indexOf(a.type)-order.indexOf(b.type));
    const list = $('sumRewards'); list.innerHTML = '';
    const lines = evs.map(e=>this.eventLine(e)).filter(Boolean);
    if(!lines.length) list.innerHTML = `<p>${esc(t('nothing_new'))}</p>`;
    lines.forEach((l,i)=>{
      const li = document.createElement('div');
      li.className = 'reward '+l.cls; li.style.animationDelay = (0.3+i*0.12)+'s';
      li.innerHTML = `<span class="ic">${l.ic}</span><span>${esc(l.tx)}</span>`;
      list.appendChild(li);
    });
    // evolução e ponto de atenção
    const ev = $('sumEvolution'), bn = $('sumBottleneck');
    ev.textContent = sum.evolution ? tf('summary_evolution_line',{op:trackLabel(sum.evolution.key), prev:U.fmtSec(sum.evolution.prev), cur:U.fmtSec(sum.evolution.cur)}) : t('no_evolution');
    bn.textContent = sum.focus ? `${trackLabel(sum.focus.key)} — ${U.fmtPct(sum.focus.accuracy)} ${t('accuracy_cap').toLowerCase()} · ${U.fmtPct(sum.focus.targetRate)} ${t('target_rate').toLowerCase()}` : '—';
    $('btnAnotherRound').textContent = t('another_round');
    $('btnFinish').textContent = t('finish');
  },

  /* ===================== ESTATÍSTICAS ===================== */
  renderStats(){
    const hist = Store.data.history;
    const ov = Analytics.overall(30);
    $('statAcc').textContent = ov.accuracy==null ? '—' : U.fmtPct(ov.accuracy);
    $('statAccSub').textContent = hist.length ? (ov.recent ? t('last_30_days') : t('overall')) : t('no_data');
    $('statTarget').textContent = ov.targetRate==null ? '—' : U.fmtPct(ov.targetRate);
    $('statTargetSub').textContent = hist.length ? (ov.recent ? t('last_30_days') : t('overall')) : t('no_data');
    const last = hist.slice(-30);
    this.drawChart('chartAcc', last.map(h=>h.accuracy*100), true);
    this.drawChart('chartTarget', last.map(h=>(h.targetRate||0)*100), true);
    this.drawBars('chartDaily', Analytics.dailySeries(14));
    $('histItems').textContent = Store.data.player.items;
    $('histRounds').textContent = Store.data.player.rounds;
    $('histXp').textContent = Store.data.player.xp;
    $('histCombo').textContent = Store.data.bestStreak||0;
    $('histStreakBest').textContent = Store.data.streak.best||0;
    $('histStars').textContent = Object.keys(TRACKS).reduce((a,k)=>a+Engine.starsTotal(Engine.track(k)),0);
    const box = $('statTracks'); box.innerHTML = '';
    TRACK_ORDER.forEach(k=>{
      const v = Analytics.trackView(k); if(!v.placed) return;
      const def = TRACKS[k], row = document.createElement('div');
      row.className = 'stat-track'; row.style.setProperty('--c', def.color);
      const ratio = v.median && v.goalMs ? v.median/v.goalMs : null;
      row.innerHTML = `<div class="tc-sym sm">${esc(def.sym)}</div><div class="st-main"><div class="st-top"><b>${esc(trackLabel(k))}</b><span>${esc(v.done ? t('track_done') : tf('track_level_short',{n:v.level})+'/'+v.n)} · ★ ${v.stars}/${v.starsMax}</span></div>
        <div class="st-sub">${esc(t('goal_label'))} ${this.fmtGoal(v.goalMs)} · ${esc(t('median_label'))} ${v.median==null?'—':this.fmtGoal(v.median)}${ratio?' ('+Math.round(ratio*100)+'%)':''} · ${v.accuracy==null?'—':U.fmtPct(v.accuracy)}</div></div>`;
      box.appendChild(row);
    });
    $('statTracksCard').classList.toggle('hidden', !box.children.length);
  },
  drawChart(id, values, percent){
    const svg = $(id);
    const w = 300, h = 110, pad = 8;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = '';
    if(values.length<2){
      svg.innerHTML = `<text x="${w/2}" y="${h/2}" fill="var(--muted)" font-size="12" text-anchor="middle">${esc(t('not_enough_data'))}</text>`;
      return;
    }
    const max = percent ? 100 : Math.max(...values), min = percent ? 0 : Math.min(...values), range = (max-min)||1;
    const ns = 'http://www.w3.org/2000/svg';
    [0.5].forEach(f=>{ const l = document.createElementNS(ns,'line'); const y = h-pad-f*(h-2*pad);
      l.setAttribute('x1',pad); l.setAttribute('x2',w-pad); l.setAttribute('y1',y); l.setAttribute('y2',y); l.setAttribute('stroke','var(--border)'); l.setAttribute('stroke-dasharray','3 4'); svg.appendChild(l); });
    const pts = values.map((v,i)=>[pad+(i/(values.length-1))*(w-2*pad), h-pad-((v-min)/range)*(h-2*pad)]);
    const path = document.createElementNS(ns,'path');
    path.setAttribute('d', pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' '));
    path.setAttribute('fill','none'); path.setAttribute('stroke','var(--accent)'); path.setAttribute('stroke-width','2.5');
    path.setAttribute('stroke-linecap','round'); path.setAttribute('stroke-linejoin','round');
    svg.appendChild(path);
    pts.forEach(p=>{ const c = document.createElementNS(ns,'circle'); c.setAttribute('cx',p[0]); c.setAttribute('cy',p[1]); c.setAttribute('r',2.8); c.setAttribute('fill','var(--accent)'); svg.appendChild(c); });
  },
  drawBars(id, series){
    const svg = $(id), w = 300, h = 110, pad = 8, ns = 'http://www.w3.org/2000/svg';
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.innerHTML = '';
    const goal = Progress.goal(), max = Math.max(goal, ...series.map(s=>s.items), 1);
    const bw = (w-2*pad)/series.length;
    const gy = h-pad-(goal/max)*(h-2*pad-6);
    const gl = document.createElementNS(ns,'line');
    gl.setAttribute('x1',pad); gl.setAttribute('x2',w-pad); gl.setAttribute('y1',gy); gl.setAttribute('y2',gy);
    gl.setAttribute('stroke','var(--muted)'); gl.setAttribute('stroke-dasharray','3 4'); gl.setAttribute('opacity','0.6'); svg.appendChild(gl);
    series.forEach((s,i)=>{
      const bh = Math.max(s.items>0?3:1, (s.items/max)*(h-2*pad-6));
      const r = document.createElementNS(ns,'rect');
      r.setAttribute('x', pad+i*bw+bw*0.15); r.setAttribute('width', bw*0.7); r.setAttribute('y', h-pad-bh); r.setAttribute('height', bh); r.setAttribute('rx', 3);
      r.setAttribute('fill', s.hit ? 'var(--good)' : s.items>0 ? 'var(--accent)' : 'var(--border)');
      svg.appendChild(r);
    });
  },

  /* ===================== AJUSTES ===================== */
  makeSwitchRow(box, key, label, sub, onChange){
    const s = Store.data.settings;
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<div><div class="label">${label}</div>${sub?`<div class="sub">${sub}</div>`:''}</div>`;
    const lab = document.createElement('label'); lab.className = 'switch';
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!s[key];
    inp.onchange = ()=>{ s[key] = inp.checked; Store.save(); if(onChange) onChange(inp.checked); };
    const track = document.createElement('span'); track.className = 'track';
    const thumb = document.createElement('span'); thumb.className = 'thumb';
    track.appendChild(thumb); lab.appendChild(inp); lab.appendChild(track); row.appendChild(lab); box.appendChild(row);
  },
  buildAppSettings(){
    const root = $('appSettingsList'), s = Store.data.settings;
    root.innerHTML = '';
    let box;
    const section = title=>{
      const titleEl = document.createElement('div'); titleEl.className = 'settings-section-title'; titleEl.textContent = title;
      const card = document.createElement('div'); card.className = 'card'; card.style.padding = '0 18px';
      root.appendChild(titleEl); root.appendChild(card); box = card;
    };
    const addSwitch = (label, sub, key, onChange)=>this.makeSwitchRow(box, key, label, sub, onChange);
    const addRange = (label, sub, key, min, max, step, fmt)=>{
      const row = document.createElement('div'); row.className = 'row'; row.style.flexDirection = 'column'; row.style.alignItems = 'stretch';
      const top = document.createElement('div'); top.style.display = 'flex'; top.style.justifyContent = 'space-between'; top.style.marginBottom = '8px';
      top.innerHTML = `<div><div class="label">${label}</div>${sub?`<div class="sub">${sub}</div>`:''}</div><div class="sub" id="val_${key}" style="color:var(--accent); font-weight:700; font-family:var(--font-num);">${fmt(s[key])}</div>`;
      const inp = document.createElement('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = s[key];
      inp.oninput = ()=>{ s[key] = +inp.value; $('val_'+key).textContent = fmt(s[key]); Store.save(); };
      row.appendChild(top); row.appendChild(inp); box.appendChild(row);
    };
    const addSelect = (label, key, options, onChange)=>{
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<div class="label">${label}</div>`;
      const sel = document.createElement('select');
      options.forEach(o=>{ const opt = document.createElement('option'); opt.value = o.v; opt.textContent = o.l; if(String(s[key])===String(o.v)) opt.selected = true; sel.appendChild(opt); });
      sel.onchange = ()=>{ s[key] = sel.value; Store.save(); if(onChange) onChange(sel.value); };
      row.appendChild(sel); box.appendChild(row);
    };
    const addSeg = (label, sub, key, options, onChange, numeric)=>{
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<div><div class="label">${label}</div>${sub?`<div class="sub">${sub}</div>`:''}</div>`;
      const seg = document.createElement('div'); seg.className = 'seg';
      options.forEach(o=>{
        const b = document.createElement('button');
        b.textContent = o.l; b.className = String(s[key])===String(o.v) ? 'active' : '';
        b.onclick = ()=>{ s[key] = numeric ? +o.v : o.v; Store.save();
          seg.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); if(onChange) onChange(o.v); };
        seg.appendChild(b);
      });
      row.appendChild(seg); box.appendChild(row);
    };

    section(t('section_goals'));
    addSeg(t('daily_goal'), t('daily_goal_sub'), 'dailyGoal', DAILY_GOALS.map(n=>({v:n,l:String(n)})), ()=>this.renderHome(), true);
    addSeg(t('round_size'), '', 'roundSize', [{v:'short',l:t('round_short')},{v:'normal',l:t('round_normal')},{v:'long',l:t('round_long')}]);
    addSeg(t('challenge'), t('challenge_sub'), 'challenge', [{v:'gentle',l:t('challenge_gentle')},{v:'balanced',l:t('challenge_balanced')},{v:'intense',l:t('challenge_intense')}]);

    section(t('section_appearance'));
    addSeg(t('app_language'), '', 'appLang', [{v:'pt',l:'PT'},{v:'en',l:'EN'}], ()=>{
      applyI18N(); this.buildKeypad(); this.buildAppSettings(); this.renderHome(); this.renderTracks(); this.renderStats();
    });
    addSelect(t('theme'), 'theme', [{v:'dark',l:t('theme_dark')},{v:'light',l:t('theme_light')},{v:'auto',l:t('theme_auto')}], ()=>this.applyTheme());
    addSeg(t('font_size'), '', 'fontScale', [{v:'0.9',l:'P'},{v:'1',l:'M'},{v:'1.15',l:'G'}], v=>{ document.documentElement.style.setProperty('--font-scale', v); s.fontScale = +v; });

    section(t('section_audio'));
    addSwitch(t('vibration'), Haptics.supported()?t('vibration_sub'):t('vibration_unsupported'), 'vibration');
    addSwitch(t('sounds'), t('sounds_sub'), 'sounds');
    addSwitch(t('tts_label'), TTS.supported()?t('tts_sub'):t('tts_unsupported'), 'tts');
    if(TTS.supported()){
      const testRow = document.createElement('div'); testRow.className = 'row';
      testRow.innerHTML = `<div><div class="label">${t('test_voice')}</div><div class="sub">${t('test_voice_sub')}</div></div>`;
      const testBtn = document.createElement('button'); testBtn.className = 'pill-btn'; testBtn.textContent = t('listen');
      testBtn.onclick = ()=>{
        testBtn.textContent = '…'; testBtn.disabled = true;
        TTS.speak(spokenPhrase({op:'multiplicacao', a:7, b:8}, s.voiceLang), ()=>{ testBtn.textContent = t('listen'); testBtn.disabled = false; });
      };
      testRow.appendChild(testBtn); box.appendChild(testRow);
    }
    addSwitch(t('hide_during_tts'), t('hide_during_tts_sub'), 'hideDuringTts');
    addRange(t('voice_speed'), t('voice_speed_sub'), 'voiceRate', 0.5, 2.0, 0.1, v=>(+v).toFixed(1)+'x');
    addSelect(t('voice_lang'), 'voiceLang', [{v:'pt-BR',l:'Português (BR)'},{v:'en-US',l:'English (US)'}]);

    section(t('section_training'));
    addSwitch(t('confirm_before_accept'), t('confirm_before_accept_sub'), 'confirmBeforeAccept');
    addSwitch(t('stop_clock'), t('stop_clock_sub'), 'stopClockOnFirstKey');
    addSwitch(t('mastery_flash'), t('mastery_flash_sub'), 'masteryFlash', ()=>this.buildAppSettings());
    if(s.masteryFlash){
      const fr = document.createElement('div'); fr.className = 'row'; fr.style.flexDirection = 'column'; fr.style.alignItems = 'stretch';
      fr.innerHTML = `<div><div class="label">${t('flash_tracks')}</div><div class="sub">${t('flash_tracks_sub')}</div></div>`;
      const chips = document.createElement('div'); chips.className = 'flash-chips';
      FLASH_TRACKS.forEach(k=>{
        const b = document.createElement('button'); b.className = 'fchip'+(s.flashTracks.includes(k)?' active':'');
        b.style.setProperty('--c', TRACKS[k].color);
        b.innerHTML = `<span>${esc(TRACKS[k].sym)}</span>${esc(trackLabel(k))}`;
        b.onclick = ()=>{
          s.flashTracks = s.flashTracks.includes(k) ? s.flashTracks.filter(x=>x!==k) : FLASH_TRACKS.filter(x=>s.flashTracks.includes(x)||x===k);
          Store.save(); b.classList.toggle('active', s.flashTracks.includes(k));
        };
        chips.appendChild(b);
      });
      fr.appendChild(chips); box.appendChild(fr);
    }
    addSwitch(t('focus_mode'), t('focus_mode_sub'), 'focusMode');
    addRange(t('gap_time'), t('gap_time_sub'), 'gapMs', 100, 1200, 50, v=>v+' ms');
    addRange(t('correct_show'), t('correct_show_sub'), 'correctAnswerShowMs', 500, 2000, 50, v=>v+' ms');

    section(t('section_data'));
    const rowExp = document.createElement('div'); rowExp.className = 'row';
    rowExp.innerHTML = `<div><div class="label">${t('export_data')}</div><div class="sub">${t('export_data_sub')}</div></div>`;
    const btnGroup = document.createElement('div'); btnGroup.style.display = 'flex'; btnGroup.style.gap = '6px';
    const bCsv = document.createElement('button'); bCsv.className = 'pill-btn'; bCsv.textContent = 'CSV ↓'; bCsv.onclick = ()=>Export.csv();
    const bJson = document.createElement('button'); bJson.className = 'pill-btn'; bJson.textContent = 'JSON ↓'; bJson.onclick = ()=>Export.json();
    btnGroup.appendChild(bCsv); btnGroup.appendChild(bJson); rowExp.appendChild(btnGroup); box.appendChild(rowExp);
    const rowAi = document.createElement('div'); rowAi.className = 'row';
    rowAi.innerHTML = `<div><div class="label">${t('ai_report')}</div><div class="sub">${t('ai_report_sub')}</div></div>`;
    const aiGroup = document.createElement('div'); aiGroup.style.display = 'flex'; aiGroup.style.gap = '6px';
    const bCopy = document.createElement('button'); bCopy.className = 'pill-btn'; bCopy.textContent = t('copy');
    bCopy.onclick = async ()=>{ const ok = await Export.aiReportCopy(); this.toast(ok ? t('copied') : t('copy_failed')); };
    const bMd = document.createElement('button'); bMd.className = 'pill-btn'; bMd.textContent = 'MD ↓'; bMd.onclick = ()=>Export.aiReportDownload();
    aiGroup.appendChild(bCopy); aiGroup.appendChild(bMd); rowAi.appendChild(aiGroup); box.appendChild(rowAi);
    const rowReset = document.createElement('div'); rowReset.style.padding = '14px 0';
    const bReset = document.createElement('button'); bReset.className = 'btn btn-danger'; bReset.textContent = t('erase_all');
    bReset.onclick = ()=>{
      if(confirm(t('confirm_reset'))){
        Store.reset(); this.openTrack = null; applyI18N(); this.applyTheme(); this.buildAppSettings();
        this.toast(t('data_erased')); this.renderHome(); this.renderTracks(); this.renderStats();
      }
    };
    rowReset.appendChild(bReset); box.appendChild(rowReset);
    document.documentElement.style.setProperty('--font-scale', s.fontScale);
  },
  applyTheme(){
    const s = Store.data.settings;
    let theme = s.theme;
    if(theme==='auto') theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name=theme-color]').setAttribute('content', theme==='dark' ? '#0F172A' : '#F4F6FB');
  },

  /* ===================== CONFETE ===================== */
  celebrate(kind){
    try{
      if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const cv = $('confetti'); if(!cv) return;
      const W = cv.width = window.innerWidth, H = cv.height = window.innerHeight;
      const ctx = cv.getContext('2d'); if(!ctx) return;
      const colors = ['#4F46E5','#22C55E','#F59E0B','#EC4899','#06B6D4','#EAB308'];
      const n = kind==='goal' || kind==='player' ? 50 : 90;
      const ps = [];
      for(let i=0;i<n;i++) ps.push({x:W/2+(Math.random()-0.5)*W*0.4, y:H*0.35, vx:(Math.random()-0.5)*9, vy:-Math.random()*9-3,
        r:3+Math.random()*4, c:colors[i%colors.length], rot:Math.random()*6, vr:(Math.random()-0.5)*0.4});
      const t0 = performance.now();
      cv.classList.add('on');
      const step = now=>{
        const age = now-t0;
        ctx.clearRect(0,0,W,H);
        ps.forEach(p=>{ p.vy += 0.32; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
          ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.globalAlpha = Math.max(0, 1-age/1900);
          ctx.fillStyle = p.c; ctx.fillRect(-p.r,-p.r/2,p.r*2,p.r); ctx.restore(); });
        if(age<1900) requestAnimationFrame(step); else { ctx.clearRect(0,0,W,H); cv.classList.remove('on'); }
      };
      requestAnimationFrame(step);
    }catch(e){}
  }
};
