/* =====================================================================
   tests/run-tests.js — suíte automatizada do motor (sem DOM, só Node.js).

   O QUE COBRE
     1. Geradores: toda trilha × level × posição m produz conta EXATA, de resposta
        inteira (ou decimal com ≤ 2 casas), nunca negativa (exceto equação/comparação)
        e com a FORMA de dígitos fixa do level (acaba com "4 dígitos e depois 2").
     2. spokenPhrase() não quebra para nenhum item, em pt-BR e en-US.
     3. Engine: nivelamento, passo de m pequeno e na direção certa, XP, barra, prova de
        nível (aprova/reprova), reforço suave, patente Mestre, filtro de lapso, blocos.
     4. Progress: curva de nível, meta diária, sequência de dias, estrelas da rodada.
     5. Storage: saneamento de dados corrompidos e migração do formato v2.
     6. Session: rodada completa com a UI "muda" (stubs) — XP, histórico, meta, saída parcial.

   NÃO COBRE: layout/teclado/TTS reais (ver teste de navegador descrito no README).

   COMO RODAR:  node tests/run-tests.js   (ou: node run-tests.js)
   ===================================================================== */

const fs = require('fs');
const path = require('path');

global.window = global;
global.localStorage = {
  _data:{},
  getItem(k){ return Object.prototype.hasOwnProperty.call(this._data,k) ? this._data[k] : null; },
  setItem(k,v){ this._data[k]=String(v); },
  removeItem(k){ delete this._data[k]; }
};
global.navigator = { vibrate(){ return true; } };
const fakeEl = ()=>({ classList:{add(){},remove(){},toggle(){},contains(){return false;}}, appendChild(){}, style:{setProperty(){}}, setAttribute(){}, replaceChildren(){}, append(){} });
global.document = {
  addEventListener(){}, removeEventListener(){}, querySelectorAll(){ return []; }, querySelector(){ return null; },
  getElementById(){ return null; }, createElement(){ return fakeEl(); }, createElementNS(){ return fakeEl(); }
};
global.performance = global.performance || { now:()=>Date.now() };

// Mesmos módulos, mesma ordem do index.html — exceto 15-init.js (efeitos colaterais de inicialização).
const jsDir = path.join(__dirname, '..', 'assets', 'js');
const MODULES = ['01-utils.js','02-engine-constants.js','03-i18n.js','04-operations.js','05-expression-terms.js','06-tracks.js',
  '07-storage.js','08-speed-engine.js','09-feedback.js','10-progress.js','11-session.js','12-analytics.js','13-export.js','14-ui.js'];
const engineSrc = MODULES.map(name => fs.readFileSync(path.join(jsDir, name), 'utf8')).join('\n');

let failures = 0, passed = 0;
function ok(cond, msg){ if(cond) passed++; else { failures++; console.error('❌ FALHOU:', msg); } }
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const harness = `
${engineSrc}
return (async function(ok, sleep){

function freshStore(patch){
  Store.data = Store.normalize(patch||{});
  Store.save = ()=>{};
  return Store.data;
}
function placeAll(level, m){
  Engine.activeKeys().forEach(k=>{ const tr = Engine.track(k); tr.placed = true; tr.level = Math.min(level, TRACKS[k].levels.length); tr.m = m==null?0.3:m; });
}
// executa um bloco inteiro com um "usuário" (função item → {correct, ms})
function runBlock(spec, user){
  Engine.beginBlock(spec);
  const outs = []; let item, guard=0;
  while((item = Engine.nextItem()) && guard++<200){
    const r = user(item);
    const out = Engine.registerResult(item, r.ms, r.correct, !!r.timedOut, r.typed);
    outs.push({item, out});
  }
  return outs;
}

/* ---------- 1. GERADORES ---------- */
function evalItem(it){
  const f = it.features||{};
  if(f.neg){ let v=it.terms[0].value; for(let i=0;i<it.ops.length;i++) v=applyOp2(it.ops[i],v,it.terms[i+1].value); return v; }
  switch(it.op){
    case 'soma': return it.a+it.b;
    case 'subtracao': return it.a-it.b;
    case 'multiplicacao': return it.a*it.b;
    case 'divisao': return it.a/it.b;
    case 'porcentagem': return it.a*it.b/100;
    case 'porcentagem_inversa': return it.a/it.b*100;
    case 'porcentagem_acrescimo': return it.a + it.a*it.b/100;
    case 'porcentagem_desconto': return it.a - it.a*it.b/100;
    case 'porcentagem_original': return f.aumento ? it.a/(1+it.b/100) : it.a/(1-it.b/100);
    case 'porcentagem_aumento': return (it.b-it.a)/it.a*100;
    case 'porcentagem_reducao': return (it.a-it.b)/it.a*100;
    case 'porcentagem_sucessiva': return it.a*(1-it.b/100)*(1-it.c/100);
    case 'fracao_comparacao': return Math.sign(it.a*it.d-it.c*it.b);
    case 'equacao': return null;
    default:
      if(it.terms){ // precedência: × e ÷ antes de + e −
        const vals=[it.terms[0].value], ops=[];
        for(let i=0;i<it.ops.length;i++){
          if(it.ops[i]==='multiplicacao'||it.ops[i]==='divisao') vals[vals.length-1]=applyOp2(it.ops[i],vals[vals.length-1],it.terms[i+1].value);
          else { ops.push(it.ops[i]); vals.push(it.terms[i+1].value); }
        }
        let v=vals[0]; for(let i=0;i<ops.length;i++) v=applyOp2(ops[i],v,vals[i+1]); return v;
      }
      if(it.op==='expressao'){
        if(it.midOp){ const l=applyOp2(it.leftOp,it.a,it.b), r=applyOp2(it.rightOp,it.c,it.d); return applyOp2(it.midOp,l,r); }
        return applyOp2(it.outerOp, applyOp2(it.innerOp,it.a,it.b), it.c);
      }
  }
  return undefined;
}
freshStore();
let genProblems = 0, genTotal = 0, negAnswers = 0; const negItems = {}, negAns = {}; const genSamples = [];
for(const key of TRACK_ORDER){
  const n = TRACKS[key].levels.length;
  for(let L=1; L<=n; L++){
    const def = levelDef(key, L);
    for(const m of [0, 0.5, 1]){
      for(let i=0;i<120;i++){
        const it = Engine.generateItem(key, L, m, {kind:'practice'});
        genTotal++;
        const tag = key+'/L'+L+'/m'+m;
        const bad = msg=>{ genProblems++; if(genSamples.length<8) genSamples.push(tag+': '+msg+' '+JSON.stringify(it).slice(0,160)); };
        if(!Number.isFinite(it.answer)){ bad('resposta não finita'); continue; }
        if((String(it.answer).split('.')[1]||'').length>2) bad('mais de 2 casas');
        if(it.isReversePath) continue;
        const ev = evalItem(it);
        if(ev===undefined) bad('op sem verificador '+it.op);
        else if(ev!==null && Math.abs(ev-it.answer)>1e-9) bad('resposta diverge '+ev+' vs '+it.answer);
        if(it.op==='equacao'){
          if(it.a*it.answer+it.b !== it.c*it.answer+it.d) bad('equação não fecha');
          if(!Number.isInteger(it.answer)) bad('x não inteiro');
        }
        if(it.op!=='fracao_comparacao' && it.op!=='equacao' && !Number.isInteger(it.answer) && !(it.features&&it.features.decimalPlaces)) bad('resposta não inteira');
        if(it.answer<0 && it.op!=='equacao' && it.op!=='fracao_comparacao' && key!=='expressoes' && !(it.features&&it.features.neg)) bad('resposta negativa');
        if(it.features&&it.features.neg){ negItems[key]=(negItems[key]||0)+1; if(it.answer<0) negAns[key]=(negAns[key]||0)+1; if(L<TRACKS[key].levels.length-(NEG_LEVELS[key]||0)) bad('sinais fora dos levels finais'); }
        if(it.answer<0 && key==='expressoes') negAnswers++;
        if(['soma','subtracao','multiplicacao','divisao'].includes(it.op) && def.shape){
          const sh = [digitCount(it.a),digitCount(it.b)].sort((x,y)=>y-x);
          if(sh[0]!==def.shape[0] || sh[1]!==def.shape[1]) bad('forma '+sh+' != '+def.shape);
        }
      }
    }
  }
}
ok(genProblems===0, 'geradores: '+genProblems+' problemas em '+genTotal+' itens → '+genSamples.join(' | '));
ok(['subtracao','multiplicacao','divisao'].every(k=>negItems[k]>0 && negAns[k]>0), 'subtração/multiplicação/divisão têm contas com sinal e respostas negativas nos levels finais '+JSON.stringify(negItems));
ok(negAnswers>0, 'expressões podem ter resposta negativa ('+negAnswers+' vistas)');
// metas de tempo crescem ao longo de cada trilha (exceto o salto proposital de multiplicação/raiz) e existe dica nos dois idiomas
for(const key of TRACK_ORDER){
  TRACKS[key].levels.forEach((l,i)=>{
    ok(l.goal>=500 && l.goal<=10000, key+' L'+(i+1)+' meta plausível');
    ok(Array.isArray(l.tip) && l.tip[0] && l.tip[1], key+' L'+(i+1)+' tem dica PT/EN');
    ok(Array.isArray(l.n) && l.n[0] && l.n[1], key+' L'+(i+1)+' tem nome PT/EN');
  });
}

// potência/raiz existem só dentro de expressões e são tranquilas (base ≤ 13)
ok(!TRACKS.potencia && !TRACKS.raiz, 'não há trilhas próprias de potência/raiz');
{
  let seen = 0, tooBig = 0, noPrec = 0, cubes = 0, negs = 0;
  for(const key of Object.keys(TRACKS)) for(let L=1; L<=TRACKS[key].levels.length; L++) for(let i=0;i<150;i++){
    const it = Engine.generateItem(key, L, Math.random(), {});
    (it.terms||[]).forEach(t=>{
      if(t.kind==='power'){ seen++; if(Math.abs(t.base)>13 || (t.exp!==2 && !(t.exp===3 && Math.abs(t.base)<=5))) tooBig++; if(t.exp===3) cubes++; if(t.base<0) negs++; }
      if(t.kind==='radical'){ seen++; if(t.value>13 || t.index!==2) tooBig++; }
    });
    if(it.ops && it.ops.includes('multiplicacao') && it.ops.length===2 && key==='expressoes'){ noPrec += 0; }
  }
  ok(seen>0 && tooBig===0, 'potências/raízes em expressões: quadrados ≤ 13, cubos ≤ 5 ('+seen+' vistas, '+tooBig+' fora do limite)');
  ok(cubes>0 && negs>0, 'há cubos e bases negativas nas expressões');
  ok(!Object.keys(TRACKS).some(k=>k!=='expressoes' && Array.from({length:TRACKS[k].levels.length},(_,i)=>i).some(i=>{ for(let j=0;j<60;j++){ const it=Engine.generateItem(k,i+1,Math.random(),{}); if((it.terms||[]).some(t=>t.kind==='power'||t.kind==='radical')) return true; } return false; })), 'potência/raiz não aparecem fora das expressões');
}
/* ---------- 2. FALA ---------- */
{
  let threw = 0;
  for(const key of TRACK_ORDER){
    for(let L=1; L<=TRACKS[key].levels.length; L++){
      for(let i=0;i<20;i++){
        const it = Engine.generateItem(key, L, Math.random(), {});
        for(const lang of ['pt-BR','en-US']){
          try{ const s = spokenPhrase(it, lang); if(typeof s!=='string' || !s.length) threw++; }catch(e){ threw++; }
        }
      }
    }
  }
  ok(threw===0, 'spokenPhrase falhou em '+threw+' casos');
}

/* ---------- 3. MOTOR ---------- */
// 3a. nivelamento: usuário forte termina alto, usuário fraco termina baixo
{
  freshStore();
  const key = 'multiplicacao', n = TRACKS[key].levels.length;
  const strong = runBlock({kind:'placement', track:key, level:Engine.startLevel(key), count:PLACEMENT_ITEMS}, it=>({correct:true, ms:it.goalMs*0.6}));
  const lvStrong = Engine.track(key).level;
  ok(Engine.track(key).placed, 'nivelamento marca a trilha como nivelada');
  ok(strong.some(o=>o.out.events.some(e=>e.type==='placed')), 'nivelamento emite evento placed');
  freshStore();
  runBlock({kind:'placement', track:key, level:Engine.startLevel(key), count:PLACEMENT_ITEMS}, it=>({correct:false, ms:it.goalMs*3, typed:'7777777'}));
  const lvWeak = Engine.track(key).level;
  ok(lvStrong>lvWeak, 'nivelamento: forte ('+lvStrong+') > fraco ('+lvWeak+')');
  ok(lvStrong<=n && lvWeak>=1, 'nivelamento dentro dos limites');
  ok(lvStrong>=Engine.startLevel(key), 'usuário que acerta tudo rápido não começa abaixo do ponto médio');
  ok(lvWeak<=Math.max(2, Engine.startLevel(key)-1), 'usuário que erra tudo começa baixo (level '+lvWeak+')');
}
// 3b. passo de m: pequeno, sobe no sucesso, desce no fracasso, nunca sai de [0,1]
{
  freshStore(); placeAll(3, 0.5);
  const tr = Engine.track('soma'); let maxStep = 0;
  const run = (correct, ms)=>runBlock({kind:'practice', track:'soma', level:3, count:BLOCK_MAX}, it=>{ return {correct, ms:it.goalMs*ms}; });
  let before = tr.m;
  run(true, 0.5); ok(tr.m>before, 'm sobe quando acerta rápido');
  before = tr.m;
  run(false, 2.5); ok(tr.m<before, 'm desce quando erra');
  for(let r=0;r<40;r++){
    runBlock({kind:'practice', track:'soma', level:3, count:BLOCK_MAX}, it=>{ const m0 = tr.m; const c = Math.random()<0.6; setImmediate; return {correct:c, ms:it.goalMs*(c?0.8:2)}; });
  }
  // passo máximo teórico = M_ETA * max(1-rho, rho) < 0.06
  ok(M_ETA*Math.max(1-Engine.rho(), Engine.rho()) < 0.06, 'passo máximo de m por conta é pequeno');
  ok(tr.m>=0 && tr.m<=1, 'm permanece em [0,1]');
}
// 3c. convergência: m se estabiliza onde a taxa de sucesso ≈ ρ*
{
  freshStore(); placeAll(4, 0.1);
  const tr = Engine.track('multiplicacao'); tr.placed = true; tr.level = 4; tr.m = 0.1;
  let succ = 0, tot = 0;
  for(let r=0;r<120;r++){
    runBlock({kind:'practice', track:'multiplicacao', level:4, count:BLOCK_MAX}, it=>{
      const p = 1/(1+Math.exp(6*(it.m-0.55)));   // usuário cujo ponto de equilíbrio está perto de m≈0.55+
      const c = Math.random()<p; if(r>=60){ tot++; if(c) succ++; }
      tr.testReady = false; tr.xp = 0;           // isola o teste de qualquer prova
      return {correct:c, ms:it.goalMs*(c?0.8:2)};
    });
  }
  ok(Math.abs(succ/tot-Engine.rho())<0.08, 'taxa de sucesso estável ('+(succ/tot).toFixed(2)+') perto de ρ*='+Engine.rho());
}
// 3d. nunca desce de level por erros; XP nunca negativo
{
  freshStore(); placeAll(4, 0.3);
  const tr = Engine.track('soma');
  let minXp = Infinity;
  for(let r=0;r<30;r++){
    runBlock({kind:'practice', track:'soma', level:tr.level, count:BLOCK_MAX}, it=>({correct:false, ms:it.goalMs*3, typed:'999999'}));
    minXp = Math.min(minXp, tr.xp);
  }
  ok(tr.level>=3, 'errar muito nunca derruba o level (level='+tr.level+')');
  ok(minXp>=0, 'XP da barra nunca fica negativo');
}
// 3e. XP por zona e multiplicadores
{
  freshStore(); placeAll(3, 0.5);
  const it = Engine.generateItem('soma', 3, 0.5, {kind:'practice'});
  ok(Engine.zone(it.goalMs*0.9, it.goalMs)==='fast' && Engine.zone(it.goalMs*1.5, it.goalMs)==='ok' && Engine.zone(it.goalMs*2, it.goalMs)==='slow', 'zonas fast/ok/slow');
  ok(Engine.xpFor(it,'fast')>Engine.xpFor(it,'ok') && Engine.xpFor(it,'ok')>Engine.xpFor(it,'slow'), 'XP decresce com a zona');
  const warm = Object.assign({}, it, {isWarmup:true});
  ok(Engine.xpFor(warm,'fast')<Engine.xpFor(it,'fast'), 'aquecimento rende menos XP');
}
// 3f. barra cheia + m alto libera a prova; barra cheia com m baixo espera
{
  freshStore(); placeAll(3, 0.2);
  const tr = Engine.track('soma'); tr.xp = Engine.xpNeed(tr)-1; tr.m = 0.1;
  runBlock({kind:'practice', track:'soma', level:3, count:BLOCK_MAX}, it=>({correct:true, ms:it.goalMs*0.5}));
  // m sobe aos poucos; a prova só libera quando m>=TEST_READY_M
  let guard = 0;
  while(!tr.testReady && guard++<80){ runBlock({kind:'practice', track:'soma', level:3, count:BLOCK_MAX}, it=>({correct:true, ms:it.goalMs*0.5})); }
  ok(tr.testReady, 'prova liberada com barra cheia e m alto');
  ok(tr.m>=TEST_READY_M, 'prova só libera com m>=TEST_READY_M (m='+tr.m.toFixed(2)+')');
  const plan = Engine.planRound();
  ok(!plan.some(b=>b.kind==='test' || b.kind==='climb'), 'barra cheia só RECOMENDA: nenhuma prova/subida é imposta na rodada');
}
// 3f2. subida pedida pela pessoa: só a trilha pedida recebe contas do level seguinte
{
  freshStore(); placeAll(3, 0.5);
  const tr = Engine.track('multiplicacao'), soma = Engine.track('soma');
  ok(Engine.canClimb(tr) && Engine.startClimb('multiplicacao') && tr.climb && tr.climb.level===4, 'pedido registra subida para o level seguinte');
  ok(!Engine.startClimb('multiplicacao'), 'não duplica pedido');
  const plan = Engine.planRound();
  const cb = plan.filter(b=>b.kind==='climb');
  ok(cb.length===1 && cb[0].track==='multiplicacao' && cb[0].level===4, 'rodada geral tem bloco de subida só da trilha pedida');
  ok(cb[0].count<=CLIMB_BLOCK_MAX, 'rodada geral limita as contas de subida por bloco');
  ok(plan.filter(b=>b.track!=='multiplicacao').every(b=>b.level<=3), 'demais trilhas seguem no level normal');
  const only = Engine.planRound({onlyTrack:'multiplicacao'});
  ok(only.some(b=>b.kind==='climb' && b.count===CLIMB_ITEMS), 'treinar só a trilha traz todas as contas de subida');
  // aprovação (em duas rodadas)
  const mBefore = tr.m, sBefore = soma.level;
  let outs = runBlock({kind:'climb', track:'multiplicacao', level:4, count:5}, it=>({correct:true, ms:it.goalMs*0.7}));
  ok(outs.every(o=>o.item.level===4 && o.item.kind==='climb'), 'contas da subida vêm do level seguinte');
  ok(!outs[outs.length-1].out.blockResult.test && tr.climb && tr.climb.results.length===5, 'sem decisão antes de completar as contas');
  outs = runBlock({kind:'climb', track:'multiplicacao', level:4, count:CLIMB_ITEMS-5}, it=>({correct:true, ms:it.goalMs*0.7}));
  const r = outs[outs.length-1].out.blockResult.test;
  ok(r && r.pass && r.leveledUp && tr.level===4 && !tr.climb && tr.stars[3]>=1, 'acertos suficientes sobem de level e limpam o pedido');
  ok(tr.m<=0.2 && tr.xp===0 && !tr.testReady, 'm e barra recomeçam no level novo');
  ok(soma.level===sBefore, 'outras trilhas não mudam');
  // reprovação: nada se perde
  Engine.startClimb('multiplicacao'); const lv = tr.level, st = tr.stars[lv], xp0 = tr.xp;
  outs = runBlock({kind:'climb', track:'multiplicacao', level:lv+1, count:CLIMB_ITEMS}, it=>({correct:false, ms:it.goalMs*2, typed:'99999'}));
  const o = outs[outs.length-1].out;
  ok(o.blockResult.test && !o.blockResult.test.pass && tr.level===lv && !tr.climb, 'erros não sobem e o pedido some');
  ok(o.events.some(e=>e.type==='climbFailed') && tr.xp===xp0 && tr.stars[lv]===st, 'reprovar não tira XP, estrelas nem level');
  ok(Engine.canClimb(tr), 'dá para pedir de novo');
  // lapsos de digitação não contam; limiar de acertos
  Engine.startClimb('multiplicacao'); let i = 0;
  outs = runBlock({kind:'climb', track:'multiplicacao', level:lv+1, count:CLIMB_ITEMS}, it=>({correct:(i++%4!==0), ms:it.goalMs*0.9, typed:'99999'}));
  const r2 = outs[outs.length-1].out.blockResult.test;
  ok(r2 && r2.pass===(r2.correct>=Engine.climbPassNeed(CLIMB_ITEMS)), 'decisão segue o limiar de acertos ('+r2.correct+'/'+CLIMB_ITEMS+')');
  // acerta mas lento → não sobe
  const lv2 = tr.level; Engine.startClimb('multiplicacao');
  outs = runBlock({kind:'climb', track:'multiplicacao', level:lv2+1, count:CLIMB_ITEMS}, it=>({correct:true, ms:it.goalMs*4}));
  ok(!outs[outs.length-1].out.blockResult.test.pass && tr.level===lv2, 'acertar tudo muito devagar não sobe');
  // persistência e cancelamento
  Engine.startClimb('multiplicacao'); runBlock({kind:'climb', track:'multiplicacao', level:tr.level+1, count:3}, it=>({correct:true, ms:it.goalMs}));
  const copy = Store.normalize(JSON.parse(JSON.stringify(Store.data)));
  ok(copy.tracks.multiplicacao.climb && copy.tracks.multiplicacao.climb.results.length===3, 'subida em andamento sobrevive ao salvar/carregar');
  Engine.cancelClimb('multiplicacao'); ok(!tr.climb, 'cancelar remove o pedido');
  // último level: subir = concluir a trilha
  const dv = Engine.track('divisao'), n = TRACKS.divisao.levels.length; dv.level = n;
  Engine.startClimb('divisao'); ok(dv.climb.level===n, 'no último level a subida mira o próprio level');
  runBlock({kind:'climb', track:'divisao', level:n, count:CLIMB_ITEMS}, it=>({correct:true, ms:it.goalMs*0.5}));
  ok(dv.done, 'passar na subida do último level conclui a trilha');
}
// 3f3. subida automática: só com evidência forte
{
  freshStore(); placeAll(3, 0.95);
  const tr = Engine.track('soma'); tr.xp = Engine.xpNeed(tr)-1;
  for(let i=0;i<8 && tr.level===3;i++) runBlock({kind:'practice', track:'soma', level:3, count:BLOCK_MAX}, it=>({correct:true, ms:it.goalMs*0.5}));
  ok(tr.level===4 && !tr.testReady && tr.stars[3]>=1, 'app sobe sozinho com m alto, 20 contas ≥95% e rápidas');
  freshStore(); placeAll(3, 0.95);
  const t2 = Engine.track('soma'); t2.xp = Engine.xpNeed(t2)-1; let i = 0;
  for(let r=0;r<8;r++) runBlock({kind:'practice', track:'soma', level:3, count:BLOCK_MAX}, it=>({correct:true, ms:it.goalMs*1.4}));
  ok(t2.level===3 && t2.testReady, 'correto porém sem rapidez: só recomenda, não sobe sozinho');
  freshStore(); placeAll(3, 0.7);
  const t3 = Engine.track('soma'); t3.testReady = true;
  t3.window = Array.from({length:AUTO_UP_ITEMS}, ()=>({ms:500, correct:true, zone:'fast', lapse:false, level:3, kind:'practice'}));
  Engine._maybeAutoLevelUp(t3, {events:[]});
  ok(t3.level===3, 'm abaixo de '+AUTO_UP_M+': não sobe sozinho');
  t3.m = 0.95; Engine._maybeAutoLevelUp(t3, {events:[]});
  ok(t3.level===4, 'm no topo + janela perfeita: sobe');
}
// 3g. prova: aprovação sobe o level e dá estrelas; reprovação mantém o level
{
  freshStore(); placeAll(3, 0.7);
  const tr = Engine.track('soma'); tr.xp = Engine.xpNeed(tr); tr.testReady = true;
  const outs = runBlock({kind:'test', track:'soma', level:3, count:TEST_ITEMS}, it=>({correct:true, ms:it.goalMs*0.7}));
  const last = outs[outs.length-1].out;
  ok(last.blockDone && last.blockResult.test.pass, 'prova perfeita é aprovada');
  ok(last.blockResult.test.stars===3, 'prova perfeita e rápida vale 3 estrelas');
  ok(tr.level===4 && !tr.testReady && tr.xp===0, 'aprovação sobe de level e zera a barra');
  ok(tr.stars[3]===3, 'estrelas gravadas no level');
  ok(tr.m<=0.2, 'm recomeça confortável no level novo');
  ok(last.events.some(e=>e.type==='levelUp'), 'evento levelUp');
  // reprova (acertos suficientes mas lento)
  tr.xp = Engine.xpNeed(tr); tr.testReady = true; const lvBefore = tr.level;
  const o2 = runBlock({kind:'test', track:'soma', level:tr.level, count:TEST_ITEMS}, it=>({correct:true, ms:it.goalMs*3}));
  ok(!o2[o2.length-1].out.blockResult.test.pass, 'prova correta porém lenta reprova');
  ok(tr.level===lvBefore, 'reprovar nunca derruba o level');
  ok(!tr.testReady && tr.xp===Math.round(Engine.xpNeed(tr)*TEST_FAIL_XP_KEEP), 'reprovar devolve a barra a '+TEST_FAIL_XP_KEEP*100+'%');
  // reprova por erros
  tr.testReady = true; tr.xp = Engine.xpNeed(tr); let i = 0;
  const o3 = runBlock({kind:'test', track:'soma', level:tr.level, count:TEST_ITEMS}, it=>({correct:(i++%2===0), ms:it.goalMs, typed:'99999'}));
  ok(!o3[o3.length-1].out.blockResult.test.pass, 'metade de erros reprova');
}
// 3g2. refazer prova de level conquistado: melhora estrelas sem mexer no level atual
{
  freshStore(); placeAll(4, 0.5);
  const tr = Engine.track('soma'); tr.stars[2] = 1;
  const plan = Engine.planRound({retake:{key:'soma', level:2}});
  ok(plan.length===1 && plan[0].kind==='test' && plan[0].level===2, 'retake gera um bloco de prova do level escolhido');
  ok(Engine.planRound({retake:{key:'soma', level:4}}).length!==1 || Engine.planRound({retake:{key:'soma', level:4}})[0].kind!=='test' || false, 'retake do level atual não é aceito');
  const outs = runBlock(plan[0], it=>({correct:true, ms:it.goalMs*0.6}));
  const r = outs[outs.length-1].out.blockResult.test;
  ok(r.pass && r.retake && tr.stars[2]===r.stars && tr.stars[2]>1 && tr.level===4, 'retake aprovado melhora as estrelas e mantém o level');
}
// 3h. lapso (digitação trocada / impulso) não pune m nem XP, e a conta da prova é reposta
{
  ok(Engine.isTypoLapse('45','54') && Engine.isTypoLapse('57','56') && !Engine.isTypoLapse('12','56') && !Engine.isTypoLapse('5','7'), 'isTypoLapse');
  freshStore(); placeAll(3, 0.5);
  const tr = Engine.track('soma'); const m0 = tr.m;
  Engine.beginBlock({kind:'practice', track:'soma', level:3, count:6});
  const it = Engine.nextItem();
  const out = Engine.registerResult(it, 100, false, false, '1');
  ok(out.lapse && tr.m===m0, 'erro rápido demais é lapso e não mexe em m');
  freshStore(); placeAll(3,0.5);
  Engine.beginBlock({kind:'test', track:'soma', level:3, count:TEST_ITEMS});
  const t1 = Engine.nextItem(); Engine.registerResult(t1, 100, false, false, '1');
  ok(Engine.block.count===TEST_ITEMS+1, 'lapso na prova repõe a conta');
}
// 3i. blocos: um level, uma trilha; aquecimento só no 1º bloco da trilha na rodada
{
  freshStore(); placeAll(4, 0.5);
  for(let r=0;r<30;r++){
    const plan = Engine.planRound();
    const seen = {};
    plan.forEach(b=>{
      if(b.kind==='practice'){
        if(seen[b.track]) ok(b.warmup===0, 'aquecimento só no primeiro bloco da trilha na rodada');
        seen[b.track] = true;
      }
    });
    const tot = plan.reduce((a,b)=>a+(b.kind==='practice'?b.count-b.warmup:b.count),0);
    ok(tot>=Engine.roundSize()-1, 'rodada tem o tamanho pedido ('+tot+')');
    // nenhum bloco repete a trilha do anterior (há mais de uma ativa)
    for(let i=1;i<plan.length;i++) if(plan[i].kind==='practice' && plan[i-1].kind==='practice') ok(plan[i].track!==plan[i-1].track, 'trilhas consecutivas diferem');
  }
  // contas de um bloco de treino têm sempre a mesma forma de dígitos
  const tr = Engine.track('multiplicacao'); tr.level = 5; tr.m = 0.5;
  let shapes = new Set();
  runBlock({kind:'practice', track:'multiplicacao', level:5, count:40}, it=>{ if(!it.isWarmup) shapes.add(Math.max(digitCount(it.a),digitCount(it.b))+'x'+Math.min(digitCount(it.a),digitCount(it.b))); return {correct:true, ms:it.goalMs}; });
  ok(shapes.size===1, 'bloco de multiplicação mantém uma forma só: '+[...shapes]);
}
// 3i2. aquecimento relâmpago: só nas 4 operações básicas
{
  freshStore(); placeAll(4, 0.5);
  const w = k=>Engine.generateItem(k, 3, 0.5, {kind:'practice', isWarmup:true}).isMasteredFlash;
  ok(w('soma') && w('subtracao') && w('multiplicacao') && w('divisao'), 'aquecimento relâmpago vale nas 4 operações');
  ok(!w('porcentagem') && !w('decimais') && !w('fracoes') && !w('expressoes') && !w('equacoes'), 'aquecimento relâmpago não vale nas demais trilhas');
  Store.data.settings.masteryFlash = false; ok(!w('soma'), 'desligado nos ajustes não borra');
}
// 3i3. escolha das contas que podem sumir
{
  freshStore(); placeAll(4, 0.5);
  Store.data.settings.flashTracks = ['soma'];
  const w = k=>Engine.generateItem(k, 3, 0.5, {kind:'practice', isWarmup:true}).isMasteredFlash;
  ok(w('soma') && !w('subtracao') && !w('multiplicacao') && !w('divisao'), 'só a trilha escolhida borra no aquecimento');
  Store.data.settings.flashTracks = [];
  ok(!w('soma'), 'nenhuma trilha escolhida = nada borra');
  const n = Store.normalize({settings:{flashTracks:['soma','porcentagem','x']}}); ok(n.settings.flashTracks.length===1 && n.settings.flashTracks[0]==='soma', 'flashTracks inválidas são saneadas');
  ok(Store.normalize({}).settings.flashTracks.length===4, 'padrão: as 4 operações');
}
// 3j. reforço suave: patinar com m no mínimo faz o próximo bloco rodar um level abaixo (sem perder level)
{
  freshStore(); placeAll(4, 0.1);
  const tr = Engine.track('soma'); tr.m = 0.05; let triggered = false;
  for(let r=0;r<20 && !triggered;r++){
    const outs = runBlock({kind:'practice', track:'soma', level:4, count:BLOCK_MAX}, it=>({correct:false, ms:it.goalMs*3, typed:'9999999'}));
    triggered = outs.some(o=>o.out.events.some(e=>e.type==='reinforce'));
    if(triggered) break;
    tr.m = Math.min(tr.m, 0.05);
  }
  ok(triggered && tr.reinforce===1, 'reforço é acionado após muitos erros com m no piso');
  ok(tr.level===4, 'reforço não tira level');
  ok(tr.m>=REINFORCE_M, 'm volta a um ponto confortável');
  const plan = Engine.planRound({onlyTrack:'soma'});
  ok(plan.some(b=>b.reinforce && b.level===3), 'próximo bloco é de reforço um level abaixo');
  runBlock(plan.find(b=>b.reinforce), it=>({correct:true, ms:it.goalMs*0.8}));
  ok(tr.reinforce===0, 'reforço termina depois de um bloco');
}
// 3k. última trilha concluída entra em "Mestre": patentes e meta que encolhe
{
  freshStore(); placeAll(1); const key='divisao'; const n = TRACKS[key].levels.length;
  const tr = Engine.track(key); tr.level = n; tr.m = 0.8; tr.xp = Engine.xpNeed(tr); tr.testReady = true;
  const outs = runBlock({kind:'test', track:key, level:n, count:TEST_ITEMS}, it=>({correct:true, ms:it.goalMs*0.5}));
  ok(tr.done && outs[outs.length-1].out.blockResult.test.finished, 'passar no último level conclui a trilha');
  const g0 = Engine.goalMs(tr);
  let rankUps = 0, guard = 0;
  while(tr.rank<RANK_MAX && guard++<400){
    const o = runBlock({kind:'practice', track:key, level:n, count:BLOCK_MAX}, it=>({correct:true, ms:it.goalMs*0.5}));
    rankUps += o.filter(x=>x.out.events.some(e=>e.type==='rankUp')).length;
  }
  ok(tr.rank===RANK_MAX && rankUps===RANK_MAX, 'sobe todas as patentes Mestre');
  ok(Engine.goalMs(tr)<g0, 'meta de tempo encolhe a cada patente');
}
// 3l. simulação: usuários virtuais — nenhum NaN, acerto perto de ρ*, level cresce com a habilidade
{
  const gauss=()=>{ let u=0,v=0; while(!u)u=Math.random(); while(!v)v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
  const sim = ab=>{
    freshStore(); let items=0, correct=0, bad=false;
    for(let r=0;r<40;r++){
      Engine.activeKeys().forEach(k=>{ const t=Engine.track(k); if(t.placed && t.testReady && Engine.canClimb(t)) Engine.startClimb(k); });   // a pessoa aceita o "Recomendado"
      for(const spec of Engine.planRound()){
        Engine.beginBlock(spec); let item;
        while((item=Engine.nextItem())){
          const g = (item.level+item.m)-ab, pc = 1/(1+Math.exp(2.5*(g-1)));
          const c = Math.random()<pc, ms = Math.max(400, Math.round(0.9*Math.exp(0.55*g)*Math.exp(0.25*gauss())*item.goalMs));
          const tr = Engine.track(item.key);
          Engine.registerResult(item, ms, c, false, c?String(item.answer):String(item.answer+7));
          items++; if(c) correct++;
          if(!Number.isFinite(tr.m)||!Number.isFinite(tr.xp)||!Number.isFinite(tr.strength)) bad = true;
        }
      }
    }
    const avgLevel = Engine.activeKeys().reduce((a,k)=>a+Engine.track(k).level/TRACKS[k].levels.length,0)/Engine.activeKeys().length;
    return {acc:correct/items, avgLevel, bad};
  };
  const lo = sim(1.5), hi = sim(6.5);
  ok(!lo.bad && !hi.bad, 'simulação sem NaN');
  ok(hi.avgLevel>lo.avgLevel+0.2, 'usuário mais hábil chega a levels mais altos ('+lo.avgLevel.toFixed(2)+' → '+hi.avgLevel.toFixed(2)+')');
  ok(lo.acc>0.6 && lo.acc<0.95 && hi.acc>0.6 && hi.acc<0.95, 'acerto médio fica numa faixa saudável (iniciante '+lo.acc.toFixed(2)+', avançado '+hi.acc.toFixed(2)+')');
}

/* ---------- 4. PROGRESS ---------- */
{
  freshStore();
  for(let n=1;n<60;n++) ok(Progress.levelFloorXp(n+1)>Progress.levelFloorXp(n), 'piso de XP cresce (nível '+n+')');
  ok(Progress.levelInfo(0).level===1 && Progress.levelInfo(Progress.levelFloorXp(5)).level===5 && Progress.levelInfo(Progress.levelFloorXp(5)-1).level===4, 'levelInfo respeita os pisos');
  const li = Progress.levelInfo(250); ok(li.frac>=0 && li.frac<1 && li.into+Progress.levelFloorXp(li.level)===250, 'levelInfo.frac/into coerentes');
  const r = Progress.addXp(100000); ok(r.leveledUp && r.to>r.from, 'addXp reporta subida de nível');
  ok(Progress.addDays('2026-03-01',-1)==='2026-02-28' && Progress.addDays('2026-12-31',1)==='2027-01-01', 'addDays (mês/ano)');
  // meta diária e sequência
  freshStore(); Store.data.settings.dailyGoal = 20;
  const today = Progress.dayKey(); let justHit = 0;
  for(let i=0;i<25;i++){ if(Progress.recordItem(true).goalJustHit) justHit++; }
  ok(justHit===1, 'meta diária dispara uma única vez');
  ok(Store.data.streak.current===1 && Store.data.streak.lastGoalDay===today, 'primeiro dia vira sequência 1');
  freshStore(); Store.data.settings.dailyGoal = 20;
  Store.data.streak = {current:3, best:3, lastGoalDay:Progress.addDays(today,-1)};
  for(let i=0;i<20;i++) Progress.recordItem(true);
  ok(Store.data.streak.current===4 && Store.data.streak.best===4, 'dia seguinte estende a sequência');
  freshStore(); Store.data.settings.dailyGoal = 20;
  Store.data.streak = {current:5, best:5, lastGoalDay:Progress.addDays(today,-3)};
  ok(Progress.currentStreak()===0, 'sequência antiga não é exibida');
  for(let i=0;i<20;i++) Progress.recordItem(true);
  ok(Store.data.streak.current===1 && Store.data.streak.best===5, 'buraco de dias reinicia a sequência mas preserva o recorde');
  freshStore(); Store.data.streak = {current:2, best:2, lastGoalDay:Progress.addDays(today,-1)};
  ok(Progress.streakAtRisk() && Progress.currentStreak()===2, 'sequência em risco quando ontem bateu e hoje ainda não');
  ok(Progress.weekStrip().length===7 && Progress.weekStrip()[6].today, 'faixa da semana tem 7 dias terminando hoje');
  ok(Progress.roundStars(0.95,0.7)===3 && Progress.roundStars(0.85,0.1)===2 && Progress.roundStars(0.4,0)===1, 'estrelas da rodada (mínimo 1)');
  // poda do histórico diário
  freshStore(); for(let i=0;i<DAILY_KEEP_DAYS+30;i++){ Store.data.daily[Progress.addDays(today,-i-5)] = {items:1,correct:1,xp:1,goalHit:false}; }
  Progress.prune(); ok(Object.keys(Store.data.daily).length<=DAILY_KEEP_DAYS, 'poda dias antigos');
}

/* ---------- 5. STORAGE ---------- */
{
  const junk = Store.normalize({settings:{appLang:'xx', theme:5, dailyGoal:7, roundSize:'gigante', challenge:null, activeTracks:['nada'], gapMs:'abc', fontScale:3},
    tracks:{soma:{level:99, xp:-5, m:7, rank:42, stars:{'1':9,'x':1}, window:'oops'}, inexistente:{level:1}}, player:{xp:'a'}, daily:{'ontem':{}, '2026-01-01':{items:'5'}}, streak:{current:-4}});
  ok(junk.settings.appLang==='pt' && junk.settings.theme==='dark' && junk.settings.dailyGoal===DEFAULT_DAILY_GOAL && junk.settings.roundSize==='normal' && junk.settings.challenge==='balanced', 'ajustes inválidos viram padrão');
  ok(junk.settings.activeTracks.length>0 && junk.settings.gapMs>=100 && junk.settings.fontScale===1, 'listas/limites saneados');
  const s = junk.tracks.soma;
  ok(s && s.level===TRACKS.soma.levels.length && s.xp===0 && s.m===1 && s.rank===RANK_MAX && Array.isArray(s.window) && s.stars['1']===3 && !junk.tracks.inexistente, 'trilha corrompida é saneada');
  ok(junk.player.xp===0 && !junk.daily.ontem && junk.daily['2026-01-01'].items===5 && junk.streak.current===0, 'jogador/dias/sequência saneados');
  // migração v2 → v3
  localStorage._data = {};
  localStorage.setItem('calcrapido_db_v2', JSON.stringify({settings:{appLang:'en', theme:'light', tts:true, voiceRate:1.4, mode:'hiit', selectedSkills:['x']}, history:[{date:1,total:10,accuracy:0.9,avgTime:1000}], bestStreak:12, speedProfiles:{a:1}}));
  Store.load();
  ok(Store.data.settings.appLang==='en' && Store.data.settings.theme==='light' && Store.data.settings.tts===true && Store.data.settings.voiceRate===1.4, 'migração preserva ajustes');
  ok(Store.data.history.length===1 && Store.data.bestStreak===12 && !Store.data.onboarded && Object.keys(Store.data.tracks).length===0, 'migração preserva histórico e recomeça o nivelamento');
  ok(!('mode' in Store.data.settings) && localStorage.getItem('calcrapido_db_v3')!==null, 'migração grava no formato v3');
  Store.data.settings.appLang = 'pt';
  // ida e volta
  freshStore(); Engine.track('soma').level = 4; Engine.track('soma').placed = true;
  Store._persist(); Store.load();
  ok(Store.data.tracks.soma.level===4 && Store.data.tracks.soma.placed, 'salvar e recarregar mantém a trilha');
  // textos: PT e EN têm as mesmas chaves
  const pk = Object.keys(I18N.pt), ek = Object.keys(I18N.en);
  ok(pk.every(k=>ek.includes(k)) && ek.every(k=>pk.includes(k)), 'i18n: PT e EN têm as mesmas chaves');
}

/* ---------- 6. SESSION (UI muda) ---------- */
{
  freshStore(); Store.data.settings.gapMs = 0; Store.data.settings.correctAnswerShowMs = 0; Store.data.settings.confirmBeforeAccept = false;
  placeAll(3, 0.5);
  const noop = ()=>{}; let summary = null, intros = 0, results = 0;
  Object.assign(UI, {resetTraining:noop, showScreen:noop, setBlockChip:noop, setItemChip:noop, updateHud:noop, popXp:noop, setPaused:noop, celebrate:noop,
    toast:noop, flashAnswer:noop, pushPulse:noop, clearAnswerFeedback:noop, showCorrectAnswer:noop, showHint:noop, setMasteryBlur:noop,
    updateAnswerDisplay:noop, setKeypadMode:noop, setTab:noop, renderHome:noop, hideOverlays:noop,
    renderQuestion:(item,ready)=>ready(), renderSummary:s=>{ summary = s; },
    showBlockIntro:(info,go)=>{ intros++; setTimeout(go,0); }, showTestResult:(res,go)=>{ results++; setTimeout(go,0); }});
  const xp0 = Store.data.player.xp;
  ok(Session.start({size:16}), 'Session.start inicia');
  let guard = 0;
  while(Session.active && guard++<4000){
    if(Session.current && !Session.answering && !Session.inputLocked && !Session.waiting){
      const ans = String(Session.current.answer).replace('.',',');
      for(const ch of ans) Session.submitDigit(ch==='-'?'sign':ch===','?'dec':ch);
      Session.evaluate(false);
    }
    await sleep(1);
  }
  ok(!Session.active && summary && summary.completed, 'rodada termina sozinha com resumo completo');
  ok(summary && summary.total>=16 && summary.accuracy>0.95 && summary.stars>=1, 'resumo coerente (total '+(summary&&summary.total)+')');
  ok(Store.data.player.xp>xp0 && summary.xp>0, 'XP do jogador aumentou');
  ok(Store.data.history.length===1 && Store.data.history[0].completed===true, 'rodada entrou no histórico');
  ok(Store.data.player.rounds===1 && Store.data.player.items>=16 && Progress.day().items>=16, 'contadores do jogador e do dia');
  ok(intros>=1, 'primeira visita a um level mostra a dica (intro)');
  ok(Store.data.seenTips['soma:3']===true || Object.keys(Store.data.seenTips).length>0, 'dicas vistas são lembradas');
  // saída parcial salva
  summary = null; Store.data.history.length = 0;
  Session.start({size:24}); guard = 0;
  while(Session.active && Session.records.length<5 && guard++<2000){
    if(Session.current && !Session.answering && !Session.inputLocked && !Session.waiting){
      for(const ch of String(Session.current.answer).replace('.',',')) Session.submitDigit(ch==='-'?'sign':ch===','?'dec':ch);
      Session.evaluate(false);
    }
    await sleep(1);
  }
  Session.exit(true);
  ok(!Session.active && summary && !summary.completed && summary.stars===0 && Store.data.history.length===1, 'sair no meio fecha como rodada parcial (sem estrelas)');
  ok(Engine.block===null, 'sair descarta o bloco em andamento');
  // errar não é punido: rodada toda errada ainda conclui e rende ≥ 0 XP
  Store.data.history.length = 0; summary = null;
  Session.start({size:16}); guard = 0;
  while(Session.active && guard++<4000){
    if(Session.current && !Session.answering && !Session.inputLocked && !Session.waiting){ Session.submitDigit('9'); Session.submitDigit('9'); Session.submitDigit('9'); Session.submitDigit('9'); Session.submitDigit('9'); Session.evaluate(false); }
    await sleep(1);
  }
  ok(summary && summary.completed && summary.stars===1 && summary.xp>=ROUND_COMPLETE_XP, 'rodada toda errada ainda dá 1 estrela e o bônus de conclusão '+JSON.stringify(summary&&{c:summary.completed,s:summary.stars,x:summary.xp,t:summary.total,a:Session.active,g:guard}));
  ok(Engine.activeKeys().every(k=>Engine.track(k).level>=3), 'nenhum level caiu');
  // registro por conta e relatório para IA
  ok(Store.data.log.length>=16 && Store.data.log.every(e=>e.length===10), 'cada conta respondida entra no registro compacto');
  Session._logEvent({type:'placed', key:'soma', level:2}); ok(Store.data.events.length>0 && Store.data.events[Store.data.events.length-1].t>0, 'marcos são registrados');
  const rep = Export.aiReport();
  ok(rep.includes('Instruções para a IA') && rep.includes('Registro bruto') && rep.includes('quando,trilha,level') && rep.includes('Evolução por semana') && rep.includes('Estado atual por trilha'), 'relatório para IA tem todas as seções');
  ok(!rep.includes('NaN') && !rep.includes('undefined') && !rep.includes('Infinity'), 'relatório sem NaN/undefined');
  Store.data.log.length = 0; Store.data.events.length = 0; ok(Export.aiReport().includes('sem dados'), 'relatório funciona sem dados');
  // exportação CSV não quebra
  ok(typeof Export.csvText()==='string' && Export.csvText().includes('trilha'), 'CSV gerado');
}

})(ok, sleep);
`;

(async()=>{
  try{
    await new Function('ok','sleep','require','Buffer','setImmediate', harness)(ok, sleep, require, Buffer, setImmediate);
  }catch(e){ failures++; console.error('❌ EXCEÇÃO NA SUÍTE:', e && e.stack || e); }
  console.log(failures===0 ? `✅ ${passed} verificações passaram.` : `\n${failures} falha(s), ${passed} verificações passaram.`);
  process.exit(failures===0 ? 0 : 1);
})();
