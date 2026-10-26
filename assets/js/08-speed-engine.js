/* =====================================================================
   assets/js/08-speed-engine.js — motor adaptativo (Engine): planejamento da
   rodada em blocos, geração de conta, adaptação contínua (m), XP, nivelamento,
   prova de nível, reforço suave e recordes.
   Depende de: 01-utils.js, 02-engine-constants.js, 03-i18n.js, 04, 05,
   06-tracks.js, 07-storage.js.
   Usado por: 10-progress.js, 11-session.js, 13-export.js e 14-ui.js.
   ===================================================================== */

/* ---------- 6. MOTOR ----------
   Modelo mental:
   • Cada TRILHA (soma, multiplicação...) tem um level de trabalho L e uma posição contínua m
     dentro dele. As contas de um bloco saem sempre do level L (forma fixa de operandos).
   • m sobe/desce um pouquinho a cada conta, mirando a taxa de acerto desejada (ρ*).
   • O XP de cada conta enche a barra do level; barra cheia → prova de nível; passou → L+1.
   • Nunca existe "descer de level": se a pessoa patina, m cai e, no limite, um bloco de
     reforço roda no level anterior — sem perder nada. */
const Engine = {
  block:null,           // bloco em andamento ({kind,key,level,count,...})
  newTrack(key){
    return {key, level:1, xp:0, m:M_START, rank:0, placed:false, testReady:false, done:false,
      stars:{}, climb:null, strength:0.6, window:[], items:0, lastPracticeAt:0, reinforce:0, recentPairs:[],
      patternWeights:{}, digitWeights:{}, patternErrorStreak:{}, hotPairs:{}, bestMedian:{}};
  },
  track(key){
    const ts = Store.data.tracks || (Store.data.tracks={});
    if(!ts[key]) ts[key] = this.newTrack(key);
    return ts[key];
  },
  activeKeys(){
    const keys = (Store.data.settings.activeTracks||[]).filter(k=>TRACKS[k]);
    return keys.length ? keys : [...DEFAULT_ACTIVE_TRACKS];
  },
  rho(){ return CHALLENGE_LEVELS[Store.data.settings.challenge] || CHALLENGE_LEVELS.balanced; },
  goalMs(tr, level){ return levelGoalMs(tr.key, level||tr.level, tr.done ? tr.rank : 0); },
  zone(ms, goal){ const r=ms/goal; return r<=ZONE_FAST ? 'fast' : r<=ZONE_OK ? 'ok' : 'slow'; },
  xpNeed(tr){ return tr.done ? RANK_XP : TRACK_XP_BASE + TRACK_XP_STEP*(tr.level-1); },
  levelCount(key){ return TRACKS[key].levels.length; },
  // 0..1: quão cheia está a barra do level (ou da patente, na trilha concluída)
  barFrac(tr){ return U.clamp(tr.xp / this.xpNeed(tr), 0, 1); },
  startLevel(key){ return Math.max(1, Math.round(this.levelCount(key)*PLACEMENT_START_FRAC)); },

  /* ----- subida de level pedida pela pessoa ----- */
  canClimb(tr){ return !!tr.placed && !tr.done && !tr.climb; },
  // Nível-alvo: o seguinte; no último level, "subir" = concluir a trilha provando o próprio último level.
  climbTarget(tr){ return Math.min(tr.level+1, this.levelCount(tr.key)); },
  startClimb(key){
    const tr = this.track(key);
    if(!this.canClimb(tr)) return false;
    tr.climb = {level:this.climbTarget(tr), need:CLIMB_ITEMS, results:[], askedAt:Date.now()};
    Store.save();
    return true;
  },
  cancelClimb(key){ const tr = this.track(key); tr.climb = null; Store.save(); },
  climbLeft(tr){ return tr.climb ? Math.max(0, tr.climb.need - tr.climb.results.length) : 0; },
  climbPassNeed(need){ return Math.ceil(need*CLIMB_PASS_FRAC); },

  /* ----- estatística curta de uma trilha (para a UI) ----- */
  recent(tr, n=20){ return (tr.window||[]).filter(w=>!w.lapse && w.kind==='practice' && !w.old).slice(-n); },
  recentAccuracy(tr){ const w=this.recent(tr); return w.length ? U.mean(w.map(x=>x.correct?1:0)) : null; },
  recentMedian(tr){ const c=this.recent(tr).filter(x=>x.correct).map(x=>x.ms); return c.length ? U.median(c) : null; },
  starsTotal(tr){ return Object.values(tr.stars||{}).reduce((a,b)=>a+b,0); },
  starsMax(key){ return this.levelCount(key)*3; },
  levelsPassed(tr){ return tr.done ? this.levelCount(tr.key) : Math.max(0, tr.level-1); },

  /* ----- pesos por padrão / dígito / par (herdados do motor anterior) ----- */
  patternAttrs:{ soma:['carries'], subtracao:['borrows'], porcentagem:['pct'], decimais:['decimalPlaces'], fracoes:['case'] },
  directBucketAttrs:['pct','decimalPlaces','case'],
  bucketFromCount(attr, count){ return count<=0 ? 'sem' : count===1 ? 'um' : 'varios'; },
  // Sorteio ponderado: cada opção sempre tem alguma chance (PATTERN_WEIGHT_MIN) — nunca 100% previsível.
  weightedBucket(tr, attr, options){
    const weights = (tr && tr.patternWeights) || {};
    const arr = options.map(o=>({o, w: weights[attr+':'+String(o)]!=null ? weights[attr+':'+String(o)] : 1}));
    const total = arr.reduce((s,x)=>s+x.w,0);
    let r = Math.random()*total;
    for(const x of arr){ if(r<x.w) return x.o; r-=x.w; }
    return arr[arr.length-1].o;
  },
  nudgePatternWeight(tr, item, correct, good){
    const attrs = this.patternAttrs[item.key];
    if(!attrs || !item.features) return null;
    tr.patternWeights = tr.patternWeights || {};
    tr.patternErrorStreak = tr.patternErrorStreak || {};
    let hint = null;
    attrs.forEach(attr=>{
      const raw = item.features[attr];
      if(raw===undefined) return;
      const bucket = this.directBucketAttrs.includes(attr) ? String(raw) : this.bucketFromCount(attr, raw);
      const wKey = attr+':'+bucket;
      const cur = tr.patternWeights[wKey]!=null ? tr.patternWeights[wKey] : 1;
      tr.patternWeights[wKey] = U.clamp(good ? cur-PATTERN_WEIGHT_NUDGE : cur+PATTERN_WEIGHT_NUDGE, PATTERN_WEIGHT_MIN, PATTERN_WEIGHT_MAX);
      // Andaime: conta erros SEGUIDOS no mesmo padrão; ao bater PATTERN_HINT_STREAK monta a dica.
      if(correct){ tr.patternErrorStreak[wKey] = 0; }
      else {
        tr.patternErrorStreak[wKey] = (tr.patternErrorStreak[wKey]||0) + 1;
        if(tr.patternErrorStreak[wKey] >= PATTERN_HINT_STREAK){
          const built = this.buildPatternHint(attr, item);
          if(built){ hint = built; tr.patternErrorStreak[wKey] = 0; }
        }
      }
    });
    return hint;
  },
  // Compensação por 10 (vai-um e empréstimo): 52−18 → "Tente 52 − 20 + 2"; 47+38 → "Tente 47 + 40 − 2".
  buildPatternHint(attr, item){
    if(attr==='borrows' || attr==='carries'){
      const a=item.a, b=item.b;
      if(!Number.isInteger(a) || !Number.isInteger(b)) return null;
      const bRound=Math.ceil(b/10)*10, diff=bRound-b;
      if(diff<=0 || diff>=10) return null;
      return tf(attr==='borrows' ? 'hint_borrow' : 'hint_carry', {a, bRound, diff});
    }
    if(attr==='pct') return this.pctHintFor(item);
    if(attr==='decimalPlaces') return t('hint_decimal');
    return null;
  },
  pctHint(pct, base){
    const ten = base/10;
    if(pct===10) return tf('hint_pct_ten', {base, ten});
    if(pct===50) return tf('hint_pct_half', {base});
    if(pct===25) return tf('hint_pct_quarter', {base});
    if(pct===75) return tf('hint_pct_three_quarter', {base});
    if(pct===5) return tf('hint_pct_five', {base, ten, half:ten/2});
    if(pct%10===0) return tf('hint_pct_tens', {pct, base, ten, mult:pct/10});
    return tf('hint_pct_generic', {pct, base, ten});
  },
  pctHintFor(item){
    const f = item.features || {};
    switch(item.op){
      case 'porcentagem_inversa': return this.pctHint(f.pct, item.b);
      case 'porcentagem_acrescimo': case 'porcentagem_desconto': return this.pctHint(f.pct, item.a);
      case 'porcentagem_original': return tf('hint_pct_original', {final:item.a, fator: f.aumento ? 100+f.pct : 100-f.pct});
      case 'porcentagem_aumento': return tf('hint_pct_variacao', {inicial:item.a, delta:item.b-item.a});
      case 'porcentagem_reducao': return tf('hint_pct_variacao', {inicial:item.a, delta:item.a-item.b});
      case 'porcentagem_sucessiva': {
        const meio = item.a - item.a*f.pct/100;
        return tf('hint_pct_sucessivo', {base:item.a, p1:f.pct, meio, p2:item.c});
      }
      default: return this.pctHint(item.a, item.b);
    }
  },
  // Peso por dígito/linha da tabuada: onde a pessoa erra/demora mais com um dígito, a próxima
  // geração fica enviesada para ele (mede "lidar com o 7", não decorar 7×8).
  pickRow(tr, key, min, max){
    const weights = (tr && tr.digitWeights) || {};
    const arr=[];
    for(let d=min; d<=max; d++) arr.push({d, w: weights[key+':d'+d]!=null ? weights[key+':d'+d] : 1});
    const total=arr.reduce((s,x)=>s+x.w,0);
    let r=Math.random()*total;
    for(const x of arr){ if(r<x.w) return x.d; r-=x.w; }
    return arr[arr.length-1].d;
  },
  nudgeDigits(tr, key, digits, good){
    if(!key || !digits || !digits.length) return;
    tr.digitWeights = tr.digitWeights || {};
    digits.forEach(d=>{
      if(d==null) return;
      const wKey = key+':d'+d, cur = tr.digitWeights[wKey]!=null ? tr.digitWeights[wKey] : 1;
      tr.digitWeights[wKey] = U.clamp(good ? cur-PATTERN_WEIGHT_NUDGE : cur+PATTERN_WEIGHT_NUDGE, PATTERN_WEIGHT_MIN, PATTERN_WEIGHT_MAX);
    });
  },
  // Pontos cegos dentro do dígito: pares específicos lentos voltam com mais frequência até limpar.
  registerPairRt(tr, item, ms, correct, fast){
    if(!item.pairKind || item.isReversePath || !item.pair) return;
    const lo = Math.min(...item.pair), hi = Math.max(...item.pair);
    const pairKey = item.pairKind+':'+lo+'_'+hi;
    tr.hotPairs = tr.hotPairs || {};
    if(!correct) return;
    const entry = tr.hotPairs[pairKey];
    const prev = entry ? entry.rtEwma : ms;
    const rtEwma = prev + HOTPAIR_EWMA_ALPHA*(ms-prev);
    const n = (entry ? entry.n : 0) + 1;
    const streakGood = fast ? (entry ? entry.streakGood : 0)+1 : 0;
    if(entry){
      entry.rtEwma = rtEwma; entry.n = n; entry.streakGood = streakGood;
      if(streakGood >= HOTPAIR_CLEAR_STREAK) delete tr.hotPairs[pairKey];
    } else if(n >= HOTPAIR_MIN_SAMPLES && rtEwma > item.goalMs*HOTPAIR_RT_RATIO){
      tr.hotPairs[pairKey] = {rtEwma, n, streakGood};
    } else if(!entry){
      // ainda sem amostras suficientes: guarda contagem leve em memória de curto prazo
      tr._pairN = tr._pairN || {}; tr._pairN[pairKey] = n;
    }
  },
  pickHotPartner(tr, kind, d, lo, hi){
    const hp = (tr && tr.hotPairs) || {};
    let best=null, bestScore=-Infinity;
    Object.keys(hp).forEach(pairKey=>{
      if(!pairKey.startsWith(kind+':')) return;
      const [x,y] = pairKey.slice(kind.length+1).split('_').map(Number);
      const partner = x===d ? y : y===d ? x : null;
      if(partner==null || partner<lo || partner>hi) return;
      if(hp[pairKey].rtEwma>bestScore){ bestScore=hp[pairKey].rtEwma; best=partner; }
    });
    return best;
  },
  // Filtro de typos: o INVERSO da resposta (45 vs 54) ou 1 dígito trocado na mesma posição
  // (57 vs 56) é lapso motor, não erro de cálculo — fica no histórico mas não pune nada.
  isTypoLapse(typedRaw, answer){
    if(typedRaw==null) return false;
    const typedNorm = String(typedRaw).replace(',', '.');
    if(!typedNorm.length) return false;
    const typedNum = +typedNorm;
    if(!Number.isFinite(typedNum)) return false;
    const digitsOf = v => String(Math.abs(v)).replace('.', '').replace(/^0+(?=\d)/, '');
    const a = digitsOf(answer), b = digitsOf(typedNum);
    if(a.length < 2 || a.length !== b.length) return false;
    if(b === a.split('').reverse().join('')) return true;
    let diff = 0;
    for(let i=0; i<a.length; i++) if(a[i]!==b[i]) diff++;
    return diff===1;
  },

  /* ----- planejamento da rodada ----- */
  roundSize(){ return ROUND_SIZES[Store.data.settings.roundSize] || ROUND_SIZES.normal; },
  // Escolha ponderada da próxima trilha (entre BLOCOS): favorece trilhas mais fracas e há mais
  // tempo sem treino; nunca repete a anterior (se houver outra) e desestimula repetir na rodada.
  pickTrack(keys, prev, used){
    let pool = keys.filter(k=>k!==prev);
    if(!pool.length) pool = keys;
    const now = Date.now();
    const weights = pool.map(k=>{
      const tr = this.track(k);
      const recency = tr.lastPracticeAt ? U.clamp((now-tr.lastPracticeAt)/(3*ONE_DAY),0,1) : 1;
      return Math.max(0.1, 0.6 + (1-tr.strength)*1.2 + recency + (tr.reinforce?0.8:0) + (tr.climb?1.2:0) - 0.7*(used[k]||0));
    });
    const total = weights.reduce((a,b)=>a+b,0);
    let r = Math.random()*total;
    for(let i=0;i<pool.length;i++){ if(r<weights[i]) return pool[i]; r-=weights[i]; }
    return pool[pool.length-1];
  },
  // Rodada = lista de blocos: nivelamentos → treino (com blocos de "subida" pedidos pela pessoa no meio).
  planRound(opts={}){
    const size = opts.size || this.roundSize();
    // Refazer a prova de um level já conquistado (para melhorar as estrelas): rodada de um bloco só.
    if(opts.retake && TRACKS[opts.retake.key]){
      const rk = opts.retake.key, tr = this.track(rk);
      if(tr.placed && opts.retake.level>=1 && (tr.done || opts.retake.level<tr.level))
        return [{kind:'test', track:rk, level:opts.retake.level, count:TEST_ITEMS, warmup:0}];
    }
    const keys = opts.onlyTrack && TRACKS[opts.onlyTrack] ? [opts.onlyTrack] : this.activeKeys();
    const blocks = []; let total = 0;
    keys.filter(k=>!this.track(k).placed).slice(0,MAX_PLACEMENTS_PER_ROUND).forEach(k=>{
      blocks.push({kind:'placement', track:k, level:this.startLevel(k), count:PLACEMENT_ITEMS, warmup:0});
      total += PLACEMENT_ITEMS;
    });
    const placed = keys.filter(k=>this.track(k).placed);
    // Subidas pedidas: cada trilha com pedido em andamento ganha um bloco único com as contas que faltam.
    const climbs = placed.filter(k=>this.track(k).climb && this.climbLeft(this.track(k))>0).slice(0,CLIMB_MAX_PER_ROUND);
    const climbLen = k => opts.onlyTrack ? this.climbLeft(this.track(k)) : Math.min(this.climbLeft(this.track(k)), CLIMB_BLOCK_MAX);
    climbs.forEach(k=>total += climbLen(k));
    let prev = null; const used = {};
    while(total<size && placed.length){
      const key = this.pickTrack(placed, prev, used), tr = this.track(key);
      const remaining = size-total;
      let len = remaining<=BLOCK_MAX+2 ? Math.max(remaining, 5) : rr(BLOCK_MIN, BLOCK_MAX);
      const reinforce = !!tr.reinforce && tr.level>1 && !tr.climb;
      const level = reinforce ? tr.level-1 : tr.level;
      const warmup = (!used[key] && !reinforce && level>1) ? WARMUP_ITEMS : 0;
      blocks.push({kind:'practice', track:key, level, count:len+warmup, warmup, reinforce});
      total += len; prev = key; used[key] = (used[key]||0)+1;
    }
    // As subidas entram DEPOIS do primeiro bloco de treino (já aquecido), sem repetir a trilha do vizinho.
    const at = Math.min(blocks.filter(b=>b.kind==='placement').length+1, blocks.length);
    climbs.forEach((k,i)=>{
      const tr = this.track(k);
      blocks.splice(Math.min(at+i*2, blocks.length), 0, {kind:'climb', track:k, level:tr.climb.level, count:climbLen(k), warmup:0});
    });
    return blocks;
  },

  /* ----- blocos e contas ----- */
  beginBlock(spec){
    this.block = {kind:spec.kind, key:spec.track, level:spec.level, count:spec.count, warmup:spec.warmup||0,
      reinforce:!!spec.reinforce, idx:0, done:0, extra:0, results:[], visited:[], bestSuccess:0,
      lvl: spec.kind==='placement' ? spec.level : null, startedAt:Date.now()};
    return this.block;
  },
  // Próxima conta do bloco (ou null quando já foram servidas todas).
  nextItem(){
    const b = this.block;
    if(!b || b.idx>=b.count) return null;
    const tr = this.track(b.key);
    let level=b.level, m=tr.m, kind='practice', isWarmup=false, isReinforce=false;
    if(b.kind==='placement'){ level=b.lvl; m=PLACEMENT_M; kind='placement'; }
    else if(b.kind==='test'){ m=Math.max(tr.m, TEST_MIN_M); kind='test'; }
    else if(b.kind==='climb'){ m=CLIMB_M; kind='climb'; }
    else if(b.reinforce){ m=0.6; isReinforce=true; }
    else if(b.idx<b.warmup){ level=Math.max(1,b.level-1); m=WARMUP_M; isWarmup=true; }
    b.idx++;
    return this.generateItem(b.key, level, m, {kind, isWarmup, isReinforce});
  },
  generateItem(key, level, m, ctx={}){
    const tr = this.track(key), def = levelDef(key, level);
    let gen, tries=0, pairKey;
    tr.recentPairs = tr.recentPairs || [];
    do{ gen = def.gen(m, tr); pairKey = gen.exprText || (gen.a+'_'+gen.b); tries++; }
    while(tr.recentPairs.includes(pairKey) && tries<6);
    tr.recentPairs.push(pairKey); if(tr.recentPairs.length>24) tr.recentPairs.shift();
    const op = gen.op || TRACKS[key].op, opDef = OPS[op];
    const goal = levelGoalMs(key, level, tr.done && level===tr.level ? tr.rank : 0);
    const kind = ctx.kind || 'practice';
    return {key, level, kind, isWarmup:!!ctx.isWarmup, isReinforce:!!ctx.isReinforce, m, op,
      a:gen.a, b:gen.b, c:gen.c, d:gen.d, answer:gen.answer, features:gen.features||{}, exprText:gen.exprText,
      terms:gen.terms, ops:gen.ops, innerOp:gen.innerOp, outerOp:gen.outerOp, leftOp:gen.leftOp, rightOp:gen.rightOp,
      midOp:gen.midOp, isEquation:!!gen.isEquation, isReversePath:!!gen.isReversePath,
      pairKind:gen.pairKind, pair:gen.pair, digitKey:gen.digitKey, digits:gen.digits,
      symbol:opDef.symbol, label:opDef.label, kcLabel:trackLabel(key),
      goalMs:goal, targetMs:goal, timeoutMs:U.clamp(goal*TIMEOUT_MULT, TIMEOUT_MIN_MS, TIMEOUT_MAX_MS),
      isMasteredFlash: this.flashApplies(key) && !!ctx.isWarmup};
  },
  // Aquecimento relâmpago (conta que borra após MASTERY_FLASH_MS): só nas 4 operações básicas.
  flashApplies(key){ const st = Store.data.settings; return !!st.masteryFlash && FLASH_TRACKS.includes(key) && (st.flashTracks||[]).includes(key); },
  xpFor(item, zone){
    const base = XP_BY_ZONE[zone];
    let mult;
    if(item.kind==='placement') mult = PLACEMENT_XP_MULT;
    else if(item.kind==='test' || item.kind==='climb') mult = 1;
    else if(item.isWarmup) mult = WARMUP_XP_MULT;
    else if(item.isReinforce) mult = REINFORCE_XP_MULT;
    else mult = XP_M_BASE + XP_M_SPAN*item.m;
    return Math.max(1, Math.round(base*mult));
  },

  /* ----- resultado de uma conta ----- */
  // Devolve {etype, zone, targetHit, xp, lapse, hint, events[], blockDone, blockResult}.
  registerResult(item, ms, correct, timedOut, typedRaw){
    const tr = this.track(item.key), b = this.block, now = Date.now();
    const out = {zone:null, xp:0, lapse:false, hint:null, events:[], blockDone:false, blockResult:null};
    out.lapse = !correct && !timedOut && (ms<IMPULSE_FLOOR || this.isTypoLapse(typedRaw, item.answer));
    out.zone = correct ? this.zone(ms, item.goalMs) : null;
    out.targetHit = out.zone==='fast';
    out.etype = timedOut ? 'abandono' : !correct ? 'erro' : out.zone==='fast' ? 'meta' : out.zone==='ok' ? 'bom' : 'lento_correto';
    const good = correct && out.zone!=='slow';
    tr.window.push({ms, correct:!!correct, zone:out.zone, lapse:out.lapse, level:item.level, kind:item.kind, at:now});
    if(tr.window.length>WINDOW_SIZE) tr.window.shift();
    tr.lastPracticeAt = now; tr.items++;
    if(correct) out.xp = this.xpFor(item, out.zone);

    if(!out.lapse){
      if(item.kind==='practice' && !item.isWarmup){
        this._practiceUpdate(tr, item, ms, correct, good, out);
      } else if(item.kind==='practice' && item.isWarmup){
        // aquecimento: só XP (global) — não mexe em m, barra nem pesos
      }
    }
    if(b && b.key===item.key){
      if(item.kind==='test' || item.kind==='placement' || item.kind==='climb'){
        if(out.lapse && b.extra<2){ b.extra++; b.count++; }       // lapso não conta: repõe a conta
        else {
          b.results.push({correct:!!correct, zone:out.zone, ms, level:item.level});
          if(item.kind==='climb' && tr.climb && !out.lapse) tr.climb.results.push({c:correct?1:0, ms:Math.round(ms), f:out.zone==='fast'?1:0});
        }
        if(item.kind==='placement' && !out.lapse) this._placementStep(b, item, good);
      }
      b.done++;
      if(b.done>=b.count) this._finishBlock(b, tr, out);
    }
    Store.save();
    return out;
  },
  _practiceUpdate(tr, item, ms, correct, good, out){
    const reinforce = item.isReinforce;
    if(!reinforce){
      tr.m = U.clamp(tr.m + M_ETA*((good?1:0) - this.rho()), 0, 1);
    }
    const s = correct ? (out.zone==='fast' ? 1 : out.zone==='ok' ? 0.8 : 0.45) : 0;
    tr.strength += STRENGTH_ALPHA*(s - tr.strength);
    // barra do level (ou da patente "Mestre")
    if(correct && out.xp>0 && !tr.testReady){
      tr.xp += out.xp;
      if(tr.done){
        if(tr.xp>=RANK_XP){
          if(tr.rank<RANK_MAX){ tr.rank++; tr.xp -= RANK_XP; out.events.push({type:'rankUp', key:tr.key, rank:tr.rank}); }
          else tr.xp = RANK_XP;
        }
      } else if(tr.xp>=this.xpNeed(tr)) tr.xp = this.xpNeed(tr);
    }
    // Barra cheia + m na metade de cima do level → prova liberada.
    if(!tr.done && !tr.testReady && tr.xp>=this.xpNeed(tr) && tr.m>=TEST_READY_M){
      tr.testReady = true;
      out.events.push({type:'testReady', key:tr.key, level:tr.level});
    }
    if(!tr.done && tr.testReady && !tr.climb && !reinforce) this._maybeAutoLevelUp(tr, out);
    this.nudgeDigits(tr, item.digitKey, item.digits, good);
    out.hint = this.nudgePatternWeight(tr, item, correct, good);
    this.registerPairRt(tr, item, ms, correct, out.zone==='fast');
    // Reforço suave: patinando mesmo com m no mínimo → o próximo bloco roda um level abaixo.
    if(!reinforce && tr.level>1 && !tr.reinforce){
      const rec = this.recent(tr, REINFORCE_MIN_ITEMS).filter(w=>w.level===tr.level);
      if(rec.length>=REINFORCE_MIN_ITEMS && U.mean(rec.map(w=>w.correct?1:0))<REINFORCE_ACC && tr.m<=REINFORCE_M){
        tr.reinforce = 1; tr.m = REINFORCE_M_RESET;
        tr.window.forEach(w=>{ if(w.level===tr.level) w.old = true; });
        out.events.push({type:'reinforce', key:tr.key, level:tr.level-1});
      }
    }
  },
  // O app sobe sozinho só com evidência forte e recente no level atual (ver AUTO_UP_*).
  _maybeAutoLevelUp(tr, out){
    if(tr.m<AUTO_UP_M) return;
    const rec = tr.window.filter(w=>w.kind==='practice' && w.level===tr.level && !w.lapse && !w.old).slice(-AUTO_UP_ITEMS);
    if(rec.length<AUTO_UP_ITEMS) return;
    const acc = rec.filter(w=>w.correct).length/rec.length, fast = rec.filter(w=>w.zone==='fast').length/rec.length;
    if(acc<AUTO_UP_ACC || fast<AUTO_UP_FAST) return;
    const from = tr.level, n = this.levelCount(tr.key), r = {};
    tr.stars[from] = Math.max(tr.stars[from]||0, 1);
    tr.testReady = false; tr.xp = 0;
    if(from<n){ tr.level++; tr.m = M_AFTER_LEVELUP; r.newLevel = tr.level; }
    else { tr.done = true; tr.rank = 0; r.finished = true; }
    tr.strength = Math.max(tr.strength, 0.7);
    tr.window.forEach(w=>{ w.old = true; });
    out.events.push({type:'levelUp', key:tr.key, level:from, newLevel:r.newLevel||null, stars:1, finished:!!r.finished, auto:true});
  },
  _placementStep(b, item, good){
    b.visited.push(item.level);
    if(good) b.bestSuccess = Math.max(b.bestSuccess, item.level);
    const n = this.levelCount(b.key);
    b.lvl = U.clamp(item.level + (good ? 1 : -1), 1, n);
  },
  _finishBlock(b, tr, out){
    out.blockDone = true;
    const rs = b.results.filter(r=>r);
    const correctMs = rs.filter(r=>r.correct).map(r=>r.ms);
    const res = {kind:b.kind, key:b.key, level:b.level, total:rs.length, correct:rs.filter(r=>r.correct).length,
      hits:rs.filter(r=>r.zone==='fast').length, medianMs:correctMs.length ? U.median(correctMs) : null};
    if(b.kind==='test') res.test = this._finishTest(b, tr, res, out);
    else if(b.kind==='climb') res.test = tr.climb ? this._finishClimb(b, tr, res, out) : null;
    else if(b.kind==='placement') res.placed = this._finishPlacement(b, tr, rs, out);
    else {
      if(b.reinforce) tr.reinforce = 0;
      // recorde pessoal do level (mediana do bloco, sem aquecimento)
      const own = (tr.window||[]).slice(-b.count).filter(w=>w.kind==='practice' && w.level===b.level && w.correct && !w.lapse).map(w=>w.ms);
      if(!b.reinforce && own.length>=4){
        const med = U.median(own), prevBest = tr.bestMedian[b.level];
        if(prevBest==null){ tr.bestMedian[b.level] = med; }
        else if(med < prevBest*0.97){ tr.bestMedian[b.level] = med; out.events.push({type:'record', key:b.key, level:b.level, ms:med, prev:prevBest}); }
      }
    }
    this.block = null;
    out.blockResult = res;
  },
  _finishTest(b, tr, res, out){
    const goal = this.goalMs(tr, b.level);
    const c = res.correct, h = res.hits, med = res.medianMs;
    const pass = c>=TEST_PASS_CORRECT && med!=null && med<=goal*TEST_PASS_MEDIAN_RATIO;
    const stars = !pass ? 0 : (c>=TEST_ITEMS && h>=TEST_STAR3_HITS) ? 3 : h>=TEST_STAR2_HITS ? 2 : 1;
    const isCurrent = b.level===tr.level && !tr.done;
    const prevStars = tr.stars[b.level]||0;
    const r = {pass, stars, correct:c, hits:h, medianMs:med, goalMs:goal, retake:!isCurrent, improved:false, leveledUp:false, finished:false};
    if(pass){
      if(stars>prevStars){ tr.stars[b.level] = stars; r.improved = isCurrent ? true : stars>prevStars; }
      if(isCurrent){
        tr.testReady = false; tr.xp = 0;
        const n = this.levelCount(tr.key);
        if(tr.level<n){ tr.level++; tr.m = M_AFTER_LEVELUP; r.leveledUp = true; r.newLevel = tr.level; }
        else { tr.done = true; tr.rank = 0; r.finished = true; }
        tr.strength = Math.max(tr.strength, 0.7);
        out.events.push({type:'levelUp', key:tr.key, level:b.level, newLevel:r.newLevel||null, stars, finished:r.finished});
      } else {
        out.events.push({type:'starsUp', key:tr.key, level:b.level, stars});
      }
    } else if(isCurrent){
      tr.testReady = false;
      tr.xp = Math.round(this.xpNeed(tr)*TEST_FAIL_XP_KEEP);
      tr.m = Math.max(REINFORCE_M, tr.m - 0.1);
      out.events.push({type:'testFailed', key:tr.key, level:b.level, correct:c});
    }
    return r;
  },
  // Decide a subida depois das CLIMB_ITEMS contas (que podem ter vindo de várias rodadas).
  // Devolve null enquanto faltarem contas. Mesmo formato do resultado da prova, para a UI reaproveitar.
  _finishClimb(b, tr, res, out){
    const cl = tr.climb, rs = cl.results, N = cl.need;
    if(rs.length<N) return null;
    const goal = this.goalMs(tr, cl.level);
    const c = rs.filter(x=>x.c).length, h = rs.filter(x=>x.c && x.f).length;
    const ms = rs.filter(x=>x.c).map(x=>x.ms), med = ms.length ? U.median(ms) : null;
    const pass = c>=this.climbPassNeed(N) && med!=null && med<=goal*TEST_PASS_MEDIAN_RATIO;
    const stars = !pass ? 0 : (c>=Math.ceil(N*0.9) && h>=Math.ceil(N*0.6)) ? 3 : h>=Math.ceil(N*0.4) ? 2 : 1;
    const from = tr.level, n = this.levelCount(tr.key);
    const r = {pass, stars, correct:c, hits:h, medianMs:med, goalMs:goal, total:N, retake:false, improved:false, leveledUp:false, finished:false};
    tr.climb = null;
    if(pass){
      tr.stars[from] = Math.max(tr.stars[from]||0, stars); r.improved = true;
      tr.testReady = false; tr.xp = 0;
      if(from<n){ tr.level++; tr.m = M_AFTER_LEVELUP; r.leveledUp = true; r.newLevel = tr.level; }
      else { tr.done = true; tr.rank = 0; r.finished = true; }
      tr.strength = Math.max(tr.strength, 0.7);
      out.events.push({type:'levelUp', key:tr.key, level:from, newLevel:r.newLevel||null, stars, finished:r.finished});
    } else {
      out.events.push({type:'climbFailed', key:tr.key, level:cl.level, correct:c, total:N});
    }
    res.level = from; res.total = N; res.correct = c; res.hits = h; res.medianMs = med;
    return r;
  },
  _finishPlacement(b, tr, rs, out){
    const n = this.levelCount(b.key);
    const tail = b.visited.slice(-PLACEMENT_TAIL);
    const est = tail.length ? Math.floor(U.mean(tail)) : 1;
    const placed = U.clamp(Math.min(est, Math.max(1,b.bestSuccess)), 1, n);
    tr.level = placed; tr.placed = true; tr.xp = 0; tr.m = M_START; tr.testReady = false; tr.done = false; tr.rank = 0;
    for(let l=1; l<placed; l++) tr.stars[l] = Math.max(tr.stars[l]||0, 1);
    const good = rs.filter(r=>r.correct && r.zone!=='slow').length;
    tr.strength = U.clamp(rs.length ? good/rs.length : 0.6, 0.3, 0.9);
    out.events.push({type:'placed', key:b.key, level:placed});
    return placed;
  },
  // Ao abandonar no meio de um bloco, descarta o estado dele (nada fica pela metade).
  abortBlock(){ this.block = null; }
};
