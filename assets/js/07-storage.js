/* =====================================================================
   assets/js/07-storage.js — persistência local (localStorage): defaults,
   migração (inclusive do formato antigo "v2") e o objeto Store usado por
   todo o app para ler/gravar estado.
   Depende de: 01-utils.js, 02-engine-constants.js, 06-tracks.js.
   Usado por: todos os módulos que leem configurações, trilhas, XP ou
   histórico (Engine, Progress, Session, Analytics, Export, UI).
   ===================================================================== */

/* ---------- 5. STORAGE LOCAL (localStorage, tudo offline) ---------- */
const DB_KEY = 'calcrapido_db_v3';
const OLD_DB_KEY = 'calcrapido_db_v2';   // formato anterior (famílias de cálculo) — só migramos histórico e ajustes
const SETTINGS_VERSION = 6;
// Ajustes do formato antigo que continuam valendo no novo.
const CARRIED_SETTINGS = ['appLang','theme','fontScale','tts','hideDuringTts','voiceRate','voiceLang',
  'vibration','sounds','gapMs','correctAnswerShowMs','confirmBeforeAccept','stopClockOnFirstKey','focusMode','masteryFlash'];

const Store = {
  data: null,
  defaults(){
    return {
      settings:{
        appLang:'pt', theme:'dark', fontScale:1,
        tts:false, hideDuringTts:false, voiceRate:1.0, voiceLang:'pt-BR',
        vibration:true, sounds:true,
        gapMs:400, correctAnswerShowMs:900,
        confirmBeforeAccept:true, stopClockOnFirstKey:true,
        focusMode:false, masteryFlash:true,
        flashTracks:[...FLASH_TRACKS],  // trilhas onde o aquecimento relâmpago pode esconder a conta
        dailyGoal:DEFAULT_DAILY_GOAL,   // contas por dia
        roundSize:'normal',             // short | normal | long
        challenge:'balanced',           // gentle | balanced | intense  (taxa de acerto desejada)
        activeTracks:[...DEFAULT_ACTIVE_TRACKS]
      },
      settingsVersion:SETTINGS_VERSION,
      tracks:{},                        // estado de cada trilha (ver Engine.newTrack)
      player:{xp:0, rounds:0, items:0, createdAt:Date.now()},
      daily:{},                         // 'AAAA-MM-DD' → {items, correct, xp, goalHit}
      streak:{current:0, best:0, lastGoalDay:''},
      seenTips:{},                      // 'trilha:level' → true (dica do level já mostrada)
      onboarded:false,
      history:[],
      log:[],                           // uma linha por conta: [t,trilha,level,m,ms,meta,acerto,zona,tipo,lapso]
      events:[],                        // marcos: nivelamento, prova, level, patente, reforço
      bestStreak:0                      // melhor sequência de acertos (dentro de uma rodada)
    };
  },
  // Mescla um objeto salvo sobre os defaults e saneia cada campo (nunca confia no que veio).
  normalize(raw){
    const d = this.defaults(), base = this.defaults().settings;
    const out = d;
    const src = (raw && typeof raw==='object') ? raw : {};
    out.settings = Object.assign({}, d.settings, src.settings||{});
    const s = out.settings;
    if(!['pt','en'].includes(s.appLang)) s.appLang = 'pt';
    if(!['dark','light','auto'].includes(s.theme)) s.theme = 'dark';
    if(!['pt-BR','en-US'].includes(s.voiceLang)) s.voiceLang = 'pt-BR';
    s.fontScale = [0.9,1,1.15].includes(+s.fontScale) ? +s.fontScale : 1;
    if(!DAILY_GOALS.includes(+s.dailyGoal)) s.dailyGoal = DEFAULT_DAILY_GOAL; else s.dailyGoal = +s.dailyGoal;
    if(!ROUND_SIZES[s.roundSize]) s.roundSize = 'normal';
    if(!CHALLENGE_LEVELS[s.challenge]) s.challenge = 'balanced';
    s.activeTracks = Array.isArray(s.activeTracks) ? s.activeTracks.filter(k=>TRACKS[k]) : [];
    if(!s.activeTracks.length) s.activeTracks = [...DEFAULT_ACTIVE_TRACKS];
    ['tts','hideDuringTts','vibration','sounds','confirmBeforeAccept','stopClockOnFirstKey','focusMode','masteryFlash']
      .forEach(k=>{ s[k] = !!s[k]; });
    s.flashTracks = Array.isArray(s.flashTracks) ? s.flashTracks.filter(k=>FLASH_TRACKS.includes(k)) : [...FLASH_TRACKS];
    s.gapMs = U.clamp(Math.round(+s.gapMs)||base.gapMs, 100, 1200);
    s.correctAnswerShowMs = U.clamp(Math.round(+s.correctAnswerShowMs)||base.correctAnswerShowMs, 500, 2000);
    s.voiceRate = U.clamp(+s.voiceRate||1, 0.5, 2);

    out.tracks = {};
    const rawTracks = (src.tracks && typeof src.tracks==='object') ? src.tracks : {};
    Object.keys(rawTracks).forEach(key=>{
      if(!TRACKS[key]) return;
      const t = rawTracks[key] || {}, n = TRACKS[key].levels.length;
      const tr = Engine.newTrack(key);
      tr.level = U.clamp(Math.round(+t.level)||1, 1, n);
      tr.xp = Math.max(0, +t.xp||0);
      tr.m = U.clamp(Number.isFinite(+t.m) ? +t.m : M_START, 0, 1);
      tr.rank = U.clamp(Math.round(+t.rank)||0, 0, RANK_MAX);
      tr.placed = !!t.placed; tr.testReady = !!t.testReady; tr.done = !!t.done;
      tr.reinforce = t.reinforce ? 1 : 0;
      tr.stars = {};
      if(t.stars && typeof t.stars==='object') Object.keys(t.stars).forEach(l=>{ const v=+t.stars[l]; if(+l>=1 && +l<=n && v>=1) tr.stars[l] = Math.min(3, Math.round(v)); });
      tr.strength = U.clamp(Number.isFinite(+t.strength) ? +t.strength : 0.6, 0, 1);
      tr.window = Array.isArray(t.window) ? t.window.filter(w=>w && Number.isFinite(w.ms)).slice(-WINDOW_SIZE) : [];
      tr.items = Math.max(0, Math.round(+t.items)||0);
      tr.lastPracticeAt = Number.isFinite(+t.lastPracticeAt) ? +t.lastPracticeAt : 0;
      tr.recentPairs = Array.isArray(t.recentPairs) ? t.recentPairs.filter(x=>typeof x==='string').slice(-24) : [];
      ['patternWeights','digitWeights','patternErrorStreak','hotPairs','bestMedian'].forEach(f=>{
        tr[f] = (t[f] && typeof t[f]==='object') ? t[f] : {};
      });
      if(tr.done && tr.level!==n) tr.level = n;
      out.tracks[key] = tr;
    });

    const p = (src.player && typeof src.player==='object') ? src.player : {};
    out.player = {xp:Math.max(0,Math.round(+p.xp)||0), rounds:Math.max(0,Math.round(+p.rounds)||0),
      items:Math.max(0,Math.round(+p.items)||0), createdAt:Number.isFinite(+p.createdAt)?+p.createdAt:Date.now()};
    out.daily = (src.daily && typeof src.daily==='object') ? src.daily : {};
    Object.keys(out.daily).forEach(k=>{
      const e = out.daily[k];
      if(!/^\d{4}-\d{2}-\d{2}$/.test(k) || !e || typeof e!=='object'){ delete out.daily[k]; return; }
      out.daily[k] = {items:Math.max(0,+e.items||0), correct:Math.max(0,+e.correct||0), xp:Math.max(0,+e.xp||0), goalHit:!!e.goalHit};
    });
    const st = (src.streak && typeof src.streak==='object') ? src.streak : {};
    out.streak = {current:Math.max(0,Math.round(+st.current)||0), best:Math.max(0,Math.round(+st.best)||0),
      lastGoalDay:/^\d{4}-\d{2}-\d{2}$/.test(st.lastGoalDay||'') ? st.lastGoalDay : ''};
    out.seenTips = (src.seenTips && typeof src.seenTips==='object') ? src.seenTips : {};
    out.onboarded = !!src.onboarded;
    out.history = Array.isArray(src.history) ? src.history.filter(h=>h && typeof h==='object') : [];
    out.log = Array.isArray(src.log) ? src.log.filter(e=>Array.isArray(e) && e.length>=10).slice(-LOG_MAX) : [];
    out.events = Array.isArray(src.events) ? src.events.filter(e=>e && typeof e==='object' && e.type).slice(-EVENTS_MAX) : [];
    out.bestStreak = Math.max(0, Math.round(+src.bestStreak)||0);
    out.settingsVersion = SETTINGS_VERSION;
    return out;
  },
  load(){
    try{
      const raw = localStorage.getItem(DB_KEY);
      if(raw){
        this.data = this.normalize(JSON.parse(raw));
      } else {
        // Primeira abertura com o formato novo: aproveita ajustes e histórico do formato antigo
        // (as famílias antigas não têm equivalente 1:1 nas trilhas — recomeça pelo nivelamento).
        const oldRaw = localStorage.getItem(OLD_DB_KEY);
        if(oldRaw){
          const old = JSON.parse(oldRaw) || {};
          const carried = {};
          CARRIED_SETTINGS.forEach(k=>{ if(old.settings && old.settings[k]!==undefined) carried[k] = old.settings[k]; });
          this.data = this.normalize({settings:carried, history:old.history, bestStreak:old.bestStreak});
          this.data.onboarded = false;
          this._persist();
        } else {
          this.data = this.normalize({});
        }
      }
    }catch(e){ this.data = this.normalize({}); }
    return this.data;
  },
  // Persistência não-bloqueante: gravar no localStorage é síncrono e acontece a cada resposta.
  // save() adia e consolida: chamadas seguidas geram UMA escrita, fora do caminho do toque.
  // Um flush final acontece em visibilitychange/pagehide para não perder dados.
  save(){
    if(this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(()=>{ this._saveTimer=null; this._persist(); }, 200);
    this._bindFlush();
  },
  _persist(){
    try{ localStorage.setItem(DB_KEY, JSON.stringify(this.data)); }
    catch(e){ console.warn('Falha ao salvar localmente', e); }
  },
  _bindFlush(){
    if(this._flushBound) return;
    this._flushBound = true;
    const flush = ()=>{
      if(this._saveTimer){ clearTimeout(this._saveTimer); this._saveTimer=null; this._persist(); }
    };
    if(typeof document!=='undefined' && document.addEventListener){
      document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') flush(); });
    }
    if(typeof window!=='undefined' && typeof window.addEventListener==='function'){
      window.addEventListener('pagehide', flush);
    }
  },
  reset(){ this.data = this.normalize({}); this._persist(); }
};
