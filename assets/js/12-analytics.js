/* =====================================================================
   assets/js/12-analytics.js — resumo de cada rodada e estatísticas agregadas
   do histórico (telas de resumo e de estatísticas).
   Depende de: 01-utils.js, 06-tracks.js, 07-storage.js, 08-speed-engine.js, 10-progress.js.
   Usado por: 11-session.js e 14-ui.js.
   ===================================================================== */

const Analytics = {
  // Estatística de um conjunto de contas (lapsos de digitação não contam como erro).
  stats(recs){
    const valid = recs.filter(r=>!r.lapse);
    const correct = valid.filter(r=>r.correct);
    const times = correct.map(r=>r.ms);
    return {n:valid.length, correct:correct.length, accuracy:valid.length ? correct.length/valid.length : 0,
      targetRate:valid.length ? valid.filter(r=>r.zone==='fast').length/valid.length : 0,
      median:times.length ? U.median(times) : null, p90:times.length ? U.percentile(times,90) : null,
      avg:times.length ? U.mean(times) : null};
  },
  // Monta o resumo da rodada: {record (vai para o histórico), ...dados de exibição}.
  buildRoundSummary(records, ctx){
    // Aquecimento é fácil de propósito: não entra nas métricas da rodada (a não ser que seja tudo que existe).
    const core = records.filter(r=>!r.warm);
    const base = core.length ? core : records;
    const s = this.stats(base);
    const byTrack = {};
    [...new Set(base.map(r=>r.key))].forEach(k=>{
      const ts = this.stats(base.filter(r=>r.key===k));
      byTrack[k] = {n:ts.n, correct:ts.correct, accuracy:ts.accuracy, median:ts.median, targetRate:ts.targetRate};
    });
    // Lapsos de digitação ficam fora da conta; se sobrar pouca amostra, não dá 2–3★ (sobra 1★ por concluir).
    const enough = s.n >= Math.ceil(base.length*0.5);
    const stars = ctx.completed ? (enough ? Progress.roundStars(s.accuracy, s.targetRate) : 1) : 0;
    const motor = records.filter(r=>r.motorMs>0).map(r=>r.motorMs);
    const record = {id:U.uid(), date:Date.now(), completed:!!ctx.completed, total:records.length,
      accuracy:s.accuracy, avgTime:s.avg||0, median:s.median||0, p90:s.p90||0, motorAvg:motor.length?U.mean(motor):0,
      targetRate:s.targetRate, xp:ctx.xp, stars, bestCombo:ctx.bestCombo, tracks:ctx.tracks, byTrack};
    const player = Progress.levelInfo(Store.data.player.xp);
    // maior evolução: trilha cuja mediana desta rodada ficou mais abaixo da média histórica dela
    let evolution = null;
    Object.keys(byTrack).forEach(k=>{
      const cur = byTrack[k].median; if(!cur || byTrack[k].n<4) return;
      const prev = this.historicalMedian(k);
      if(prev && prev>cur){ const d = (prev-cur)/prev; if(!evolution || d>evolution.frac) evolution = {key:k, prev, cur, frac:d}; }
    });
    // ponto de atenção: trilha com menor taxa "dentro da meta" (mín. 4 contas)
    let focus = null;
    Object.keys(byTrack).forEach(k=>{
      const b = byTrack[k]; if(b.n<4) return;
      const score = b.accuracy*0.6 + b.targetRate*0.4;
      if(!focus || score<focus.score) focus = {key:k, score, median:b.median, accuracy:b.accuracy, targetRate:b.targetRate};
    });
    const day = Progress.day();
    return {record, completed:!!ctx.completed, total:records.length, correct:s.correct, accuracy:s.accuracy, targetRate:s.targetRate,
      median:s.median, stars, xp:ctx.xp, roundBonus:ctx.roundBonus, bestCombo:ctx.bestCombo, events:ctx.events||[], tests:ctx.tests||[],
      placements:ctx.placements||[], byTrack, evolution, focus,
      player:{before:ctx.playerLevelBefore, now:player.level, info:player},
      goal:{items:day.items, goal:Progress.goal(), hit:day.goalHit, justHit:!!ctx.goalJustHit},
      streak:Progress.currentStreak()};
  },
  historicalMedian(key){
    const v = Store.data.history.filter(h=>h.byTrack && h.byTrack[key] && h.byTrack[key].median && h.byTrack[key].n>=4).slice(-10).map(h=>h.byTrack[key].median);
    return v.length ? U.mean(v) : null;
  },
  // Agregados dos últimos N dias (ou de tudo se não houver nada no período).
  overall(days){
    const hist = Store.data.history;
    const from = Date.now() - (days||30)*ONE_DAY;
    const recent = hist.filter(h=>h.date>=from);
    const src = recent.length ? recent : hist;
    const w = src.reduce((a,h)=>a+(h.total||0), 0) || 1;
    // médias ponderadas pelo nº de contas de cada rodada
    const wavg = f => src.length ? src.reduce((a,h)=>a+(f(h)||0)*(h.total||0), 0)/w : null;
    return {rounds:src.length, recent:recent.length>0, accuracy:wavg(h=>h.accuracy), targetRate:wavg(h=>h.targetRate), avgTime:wavg(h=>h.avgTime)};
  },
  // Últimos N dias (do mais antigo ao mais novo) de contas por dia, para o gráfico de barras.
  dailySeries(n){
    const today = Progress.dayKey(), out = [];
    for(let i=n-1;i>=0;i--){
      const k = Progress.addDays(today, -i), e = Store.data.daily[k];
      out.push({key:k, items:e?e.items:0, xp:e?e.xp:0, hit:!!(e&&e.goalHit)});
    }
    return out;
  },
  // Visão de uma trilha para a UI (level, barra, estrelas, meta x mediana recente).
  trackView(key){
    const tr = Engine.track(key), n = Engine.levelCount(key);
    return {key, tr, n, level:tr.level, placed:tr.placed, done:tr.done, rank:tr.rank,
      bar:Engine.barFrac(tr), xp:Math.round(tr.xp), need:Engine.xpNeed(tr), testReady:tr.testReady,
      stars:Engine.starsTotal(tr), starsMax:Engine.starsMax(key),
      goalMs:Engine.goalMs(tr), median:Engine.recentMedian(tr), accuracy:Engine.recentAccuracy(tr),
      active:Engine.activeKeys().includes(key)};
  }
};
