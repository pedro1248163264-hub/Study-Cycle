/* =====================================================================
   assets/js/11-session.js — controlador da RODADA (Session): percorre os blocos
   planejados pelo Engine, apresenta cada conta, mede o tempo, registra o resultado
   no Engine/Progress (XP, combo, meta diária) e fecha a rodada com o resumo.
   Depende de: 01, 02, 03 (i18n), 07 (Store), 08 (Engine), 09 (TTS/Sound/Haptics),
   10 (Progress), 12 (Analytics).
   Usado por: 14-ui.js.
   ===================================================================== */

/* ---------- CONTROLADOR DE RODADA ----------
   Onde mora cada estado (ciclos de vida diferentes):
     1. Store.data  — persistido (ajustes, trilhas, jogador, dias, histórico).
     2. Engine.block — o bloco em andamento (descartado se a pessoa sair no meio).
     3. Session     — runtime de UMA rodada (plano, contas respondidas, combo, timers).
     4. UI          — só apresentação (faixa de pulso, popups).
   Nada além do 1º é serializado. */
function st0(snap, key, tr){ snap[key] = {placed:tr.placed, level:tr.level, frac:Engine.barFrac(tr), done:tr.done, rank:tr.rank, stars:Engine.starsTotal(tr)}; }
const Session = {
  active:false, paused:false, waiting:false,
  plan:[], blockIdx:-1, plannedTotal:0, opts:{},
  current:null, qShownAt:0, firstKeyAt:0, typed:'',
  answering:false, inputLocked:true,
  itemTimeoutHandle:null, nextHandle:null, masteryBlurHandle:null, pendingFn:null,
  records:[], combo:0, stats:null,

  /* ----- início ----- */
  // opts: {onlyTrack:'multiplicacao'} treina só uma trilha; {size:N} sobrescreve o tamanho.
  start(opts={}){
    this._clearTimers();
    Engine.abortBlock();
    this.opts = opts;
    this.plan = Engine.planRound(opts);
    if(!this.plan.length){ UI.toast(t('no_track')); return false; }
    this.plannedTotal = this.plan.reduce((a,b)=>a+b.count, 0);
    this.records = []; this.combo = 0; this.flashWarned = false;
    this.active = true; this.paused = false; this.waiting = false; this.answering = false;
    this.current = null; this.pendingFn = null;
    const p = Store.data.player;
    this.stats = {startedAt:Date.now(), xp:0, bestCombo:0, events:[], tests:[], placements:[], itemsDone:0,
      playerLevelBefore:Progress.levelInfo(p.xp).level, goalWasHit:Progress.day().goalHit, goalJustHit:false,
      tracks:new Set(), snap:{}};
    // foto das trilhas no início: a tela de resumo anima a barra "de → para"
    Engine.activeKeys().forEach(k=>{ const tr = Engine.track(k); st0(this.stats.snap, k, tr); });
    UI.resetTraining(this.plannedTotal);
    UI.showScreen('training');
    this.beginBlockAt(0);
    return true;
  },
  _clearTimers(){
    clearTimeout(this.itemTimeoutHandle); clearTimeout(this.nextHandle); clearTimeout(this.masteryBlurHandle);
    this.itemTimeoutHandle = this.nextHandle = this.masteryBlurHandle = null;
    try{ if(typeof speechSynthesis!=='undefined' && speechSynthesis.cancel) speechSynthesis.cancel(); }catch(e){}
  },
  // Agenda a próxima ação respeitando a pausa (se pausou no intervalo entre contas, retoma depois).
  _schedule(fn, ms){
    clearTimeout(this.nextHandle);
    this.nextHandle = setTimeout(()=>{
      if(!this.active) return;
      if(this.paused){ this.pendingFn = fn; return; }
      fn();
    }, ms);
  },

  /* ----- blocos ----- */
  tipSeenKey(spec){ return spec.track+':'+spec.level; },
  beginBlockAt(i){
    if(!this.active) return;
    const spec = this.plan[i];
    this.blockIdx = i;
    if(!spec){ this.finish(true); return; }
    Engine.beginBlock(spec);
    this.stats.tracks.add(spec.track);
    UI.setBlockChip(spec);
    const seen = Store.data.seenTips;
    const firstVisit = !seen[this.tipSeenKey(spec)] && spec.kind==='practice' && !spec.reinforce;
    // Aviso do aquecimento relâmpago: uma vez por rodada, antes das primeiras contas que somem.
    const flashNotice = spec.kind==='practice' && spec.warmup>0 && !spec.reinforce && Engine.flashApplies(spec.track) && !this.flashWarned;
    if(flashNotice) this.flashWarned = true;
    const needsIntro = spec.kind==='test' || spec.kind==='climb' || spec.reinforce || firstVisit || flashNotice || (spec.kind==='placement' && i===0);
    if(firstVisit){ seen[this.tipSeenKey(spec)] = true; Store.save(); }
    if(needsIntro){
      this.waiting = true;
      UI.showBlockIntro({spec, firstVisit, flashNotice, index:i, total:this.plan.length}, ()=>{
        this.waiting = false;
        if(this.active) this.nextQuestion();
      });
    } else {
      this.nextQuestion();
    }
  },
  nextQuestion(){
    if(!this.active || this.paused) return;
    this.answering = false;
    const item = Engine.nextItem();
    if(!item){ this.advanceBlock(); return; }
    this.current = item;
    this.presentItem(item);
  },
  presentItem(item){
    UI.setKeypadMode(item.op==='fracao_comparacao' ? 'comparison' : 'numeric');
    this.typed = ''; this.firstKeyAt = 0; this.qShownAt = U.now();
    clearTimeout(this.itemTimeoutHandle);
    // O prazo de abandono só corre depois que a voz terminou de ler (senão a conta seguinte
    // cortaria a leitura) e o input só é liberado nesse mesmo instante.
    this.inputLocked = true;
    UI.renderQuestion(item, ()=>{
      if(!this.active || this.paused || this.current!==item) return;
      this.inputLocked = false;
      this.qShownAt = U.now();
      this.itemTimeoutHandle = setTimeout(()=>this.handleTimeout(), item.timeoutMs);
      clearTimeout(this.masteryBlurHandle);
      UI.setMasteryBlur(false);
      if(item.isMasteredFlash){
        this.masteryBlurHandle = setTimeout(()=>{
          if(!this.active || this.paused || this.current!==item) return;
          UI.setMasteryBlur(true);
        }, MASTERY_FLASH_MS);
      }
    });
  },
  advanceBlock(){ this.beginBlockAt(this.blockIdx+1); },

  /* ----- pausa ----- */
  togglePause(){
    if(!this.active || this.waiting) return;
    if(!this.paused){
      this.paused = true;
      clearTimeout(this.itemTimeoutHandle); clearTimeout(this.masteryBlurHandle);
      try{ if(typeof speechSynthesis!=='undefined' && speechSynthesis.cancel) speechSynthesis.cancel(); }catch(e){}
      UI.setPaused(true);
    } else {
      this.paused = false;
      UI.setPaused(false);
      if(this.pendingFn){ const fn = this.pendingFn; this.pendingFn = null; fn(); }
      else if(this.current && !this.answering) this.presentItem(this.current);   // recomeça a conta do zero
    }
  },

  /* ----- entrada de resposta ----- */
  handleTimeout(){
    if(!this.active || this.paused || !this.current || this.answering) return;
    this.typed = '';
    this.evaluate(true);
  },
  submitDigit(d){
    if(!this.active || this.paused || !this.current || this.answering || this.inputLocked) return;
    if(d==='back'){ this.typed = this.typed.slice(0,-1); UI.updateAnswerDisplay(this.typed); return; }
    if(this.firstKeyAt===0){
      this.firstKeyAt = U.now();
      clearTimeout(this.itemTimeoutHandle);   // já está digitando: não abandona no meio da resposta
    }
    if(d==='sign'){ this.typed = this.typed.startsWith('-') ? this.typed.slice(1) : ('-'+this.typed); UI.updateAnswerDisplay(this.typed); return; }
    if(d==='dec'){
      if(this.typed.includes(',') || this.typed.includes('.')) return;
      this.typed += U.decimalSep();
      UI.updateAnswerDisplay(this.typed);
      return;
    }
    this.typed += d;
    UI.updateAnswerDisplay(this.typed);
    const digitsOnly = this.typed.replace('-','');
    const expectedLen = String(Math.abs(this.current.answer)).length;
    // Com "confirmar" ligado nunca envia sozinho; desligado envia quando a contagem de dígitos
    // bate — exceto resposta que pode ser negativa ou decimal (o auto-envio dispararia cedo).
    const isDecimalItem = !!(this.current.features && this.current.features.decimalPlaces);
    if(Store.data.settings.confirmBeforeAccept) return;
    if(this.current.answer>=0 && Number.isInteger(this.current.answer) && !isDecimalItem && digitsOnly.length>=expectedLen) this.evaluate(false);
  },
  submitComparison(sym){
    if(!this.active || this.paused || !this.current || this.answering || this.inputLocked) return;
    if(this.current.op!=='fracao_comparacao') return;
    if(this.firstKeyAt===0){ this.firstKeyAt = U.now(); clearTimeout(this.itemTimeoutHandle); }
    this.typed = sym;
    UI.updateAnswerDisplay(this.typed);
    if(Store.data.settings.confirmBeforeAccept) return;
    this.evaluate(false);
  },

  /* ----- avaliação ----- */
  evaluate(timedOut){
    if(!this.active || this.paused || !this.current || this.answering) return;
    if(this.inputLocked && !timedOut) return;
    if(!timedOut && !this.typed.length){ UI.toast(t('answer_required')); return; }
    this.answering = true;
    clearTimeout(this.itemTimeoutHandle); clearTimeout(this.masteryBlurHandle);
    const eqEl = document.getElementById('equationText');
    if(eqEl) eqEl.classList.remove('hidden-eq');
    UI.setMasteryBlur(false);
    const item = this.current, now = U.now();
    const totalMs = timedOut ? item.timeoutMs : (now - this.qShownAt);
    // "Parar cronômetro ao digitar": tempo cognitivo = até a primeira tecla; o resto é motor.
    const split = Store.data.settings.stopClockOnFirstKey && !!this.firstKeyAt;
    const cognitiveMs = timedOut ? item.timeoutMs : (split ? (this.firstKeyAt - this.qShownAt) : totalMs);
    const motorMs = timedOut ? 0 : (split ? (now - this.firstKeyAt) : 0);
    const typedNorm = this.typed.replace(',', '.');
    const code = COMPARE_SYMBOLS[this.typed];
    const correct = !timedOut && this.typed.length>0 && (code!==undefined ? code===item.answer : (+typedNorm === item.answer));

    const res = Engine.registerResult(item, cognitiveMs, correct, !!timedOut, this.typed);
    const st = this.stats;
    st.itemsDone++;
    // combo: só conta acerto "de verdade"; erro zera (sem punição além disso)
    let comboBonus = 0;
    if(correct){
      this.combo++;
      if(this.combo>st.bestCombo) st.bestCombo = this.combo;
      if(item.kind!=='placement' && !item.isWarmup) comboBonus = Math.min(COMBO_MAX_BONUS, Math.floor(this.combo/COMBO_STEP));
    } else this.combo = 0;
    const gained = res.xp + comboBonus;
    this._award(gained);
    const day = Progress.recordItem(correct);
    if(day.goalJustHit){
      st.goalJustHit = true;
      this._award(DAILY_GOAL_XP);
      st.events.push({type:'goal', xp:DAILY_GOAL_XP});
      UI.toast(tf('ev_goal', {n:DAILY_GOAL_XP}));
      Sound.levelUp(); Haptics.celebrate(); UI.celebrate('goal');
    }
    res.events.forEach(e=>{ st.events.push(e); this._logEvent(e); });
    this._logItem(item, cognitiveMs, correct, res);
    this.records.push({key:item.key, level:item.level, kind:item.kind, warm:item.isWarmup, ms:cognitiveMs, totalMs, motorMs, correct,
      zone:res.zone, lapse:res.lapse, goalMs:item.goalMs, xp:gained, etype:res.etype});

    UI.flashAnswer(correct);
    UI.pushPulse(!correct ? 'err' : res.zone==='slow' ? 'slow' : 'target');
    UI.popXp(gained, comboBonus, correct);
    UI.updateHud(this);
    if(correct){ Sound.correct(); Haptics.correct(); if(comboBonus && this.combo%COMBO_STEP===0) Sound.combo(); }
    else {
      Sound.wrong(); Haptics.wrong(); UI.showCorrectAnswer(item);
      if(res.hint) UI.showHint(res.hint);
    }
    const gap = Store.data.settings.gapMs;
    const hold = correct ? 0 : Store.data.settings.correctAnswerShowMs;
    this._schedule(()=>{
      UI.clearAnswerFeedback();
      this._schedule(()=>{
        if(res.blockDone) this.onBlockDone(res.blockResult);
        else this.nextQuestion();
      }, gap);
    }, hold);
  },
  // Registro compacto por conta (relatório de IA): [t, trilha#, level, m, ms, meta, acerto, zona, tipo, lapso]
  _logItem(item, ms, correct, res){
    const d = Store.data, kd = item.isWarmup ? 'w' : item.isReinforce ? 'r' : ({practice:'p', test:'t', placement:'n', climb:'c'})[item.kind] || 'p';
    d.log.push([Date.now(), TRACK_ORDER.indexOf(item.key), item.level, Math.round(item.m*100)/100, Math.round(ms), item.goalMs, correct?1:0,
      res.zone ? res.zone[0] : '-', kd, res.lapse?1:0]);
    if(d.log.length>LOG_MAX) d.log.splice(0, d.log.length-LOG_MAX);
  },
  _logEvent(e){
    const d = Store.data;
    d.events.push(Object.assign({t:Date.now()}, e));
    if(d.events.length>EVENTS_MAX) d.events.splice(0, d.events.length-EVENTS_MAX);
  },
  _award(n){
    if(!n) return;
    this.stats.xp += n;
    const r = Progress.addXp(n);
    if(r.leveledUp){
      this.stats.events.push({type:'playerLevel', level:r.to, title:r.title});
      UI.toast(tf('ev_player_level', {n:r.to, title:r.title}));
      Sound.levelUp(); UI.celebrate('player');
    }
  },

  /* ----- fim de bloco ----- */
  onBlockDone(res){
    if(!this.active) return;
    if(res.kind==='test'){
      const r = res.test;
      let bonus = 0;
      if(r.pass && (r.leveledUp || r.finished || r.improved)){
        bonus = TEST_PASS_XP[r.stars] || 0;
        this._award(bonus);
      }
      this.stats.tests.push({key:res.key, level:res.level, pass:r.pass, stars:r.stars, bonus});
      this._logEvent({type:'test', key:res.key, level:res.level, pass:r.pass, stars:r.stars, correct:r.correct, hits:r.hits, medianMs:r.medianMs==null?null:Math.round(r.medianMs), goalMs:r.goalMs, retake:r.retake});
      UI.updateHud(this);
      this.waiting = true;
      if(r.pass){ Sound.levelUp(); Haptics.celebrate(); }
      UI.showTestResult(Object.assign({}, res, {bonus}), ()=>{
        this.waiting = false;
        if(this.active) this.advanceBlock();
      });
      return;
    }
    if(res.kind==='climb'){
      const r = res.test, cl = Engine.track(res.key).climb;
      if(!r){   // ainda faltam contas: segue a rodada e a decisão sai quando completar
        const n = cl ? cl.need : CLIMB_ITEMS, k = cl ? cl.results.length : n;
        UI.toast(tf('climb_progress',{track:trackLabel(res.key), k, n}));
        this.advanceBlock(); return;
      }
      let bonus = 0;
      if(r.pass){ bonus = TEST_PASS_XP[r.stars] || 0; this._award(bonus); }
      this.stats.tests.push({key:res.key, level:res.level, pass:r.pass, stars:r.stars, bonus});
      this._logEvent({type:'climb', key:res.key, level:res.level, pass:r.pass, stars:r.stars, correct:r.correct, total:r.total, hits:r.hits, medianMs:r.medianMs==null?null:Math.round(r.medianMs), goalMs:Math.round(r.goalMs)});
      UI.updateHud(this);
      this.waiting = true;
      if(r.pass){ Sound.levelUp(); Haptics.celebrate(); }
      UI.showTestResult(Object.assign({}, res, {bonus, climb:true}), ()=>{
        this.waiting = false;
        if(this.active) this.advanceBlock();
      });
      return;
    }
    if(res.kind==='placement'){
      this.stats.placements.push({key:res.key, level:res.placed});
      UI.toast(tf('ev_placed', {track:trackLabel(res.key), n:res.placed}));
    }
    this.advanceBlock();
  },

  /* ----- fim da rodada ----- */
  // completed=false quando a pessoa saiu antes (o progresso feito até ali já está salvo).
  finish(completed){
    if(!this.active) return;
    this.active = false; this.answering = false; this.paused = false; this.waiting = false;
    this._clearTimers();
    Engine.abortBlock();
    const st = this.stats;
    const p = Store.data.player;
    const n = this.records.length;
    let roundBonus = 0;
    if(completed && n>0){
      roundBonus = ROUND_COMPLETE_XP;
      this._award(roundBonus);
    }
    if(n>0) p.rounds++;
    const summary = Analytics.buildRoundSummary(this.records, {completed:!!completed && n>0, xp:st.xp, roundBonus, bestCombo:st.bestCombo,
      events:st.events, tests:st.tests, placements:st.placements, tracks:[...st.tracks], playerLevelBefore:st.playerLevelBefore, goalJustHit:st.goalJustHit});
    if(n>0){
      Store.data.history.push(summary.record);
      if(Store.data.history.length>HISTORY_MAX) Store.data.history.splice(0, Store.data.history.length-HISTORY_MAX);
      Store.data.bestStreak = Math.max(Store.data.bestStreak||0, st.bestCombo);
      Store.data.onboarded = true;
    }
    summary.snap = st.snap;
    Store.save();
    UI.setPaused(false);
    UI.showScreen('summary');
    UI.renderSummary(summary);
    if(summary.stars===3) UI.celebrate('stars');
  },
  // Sair no meio: com ao menos uma conta feita, fecha como rodada parcial (nada se perde).
  exit(skipConfirm){
    if(!this.active) return;
    if(!skipConfirm && !confirm(t('confirm_exit_training'))) return;
    if(this.records.length){ this.finish(false); return; }
    this.active = false; this.paused = false; this.waiting = false; this.answering = false;
    this._clearTimers();
    Engine.abortBlock();
    UI.setPaused(false);
    UI.showScreen('home'); UI.setTab('home'); UI.renderHome();
  }
};
