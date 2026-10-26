/* =====================================================================
   assets/js/06-tracks.js — TRILHAS e LEVELS: cada trilha é uma operação (soma,
   multiplicação, potência...) com uma escada de levels. Cada level tem:
     n     nome (PT/EN)
     goal  meta de tempo cognitivo, em ms (o "nível de calculadora humana" do level)
     tip   tática de cálculo mental do level (PT/EN)
     shape quantidade de dígitos dos operandos (só p/ testes: a forma é SEMPRE a
           mesma dentro do level — é isto que garante consistência)
     gen(m, tr) gerador: m ∈ [0,1] é a posição contínua dentro do level (0 ≈ fim do
           level anterior, 1 ≈ começo do próximo) e tr é o estado da trilha (ou null).
   Dentro de um level, m só varia coisas SUAVES (tamanho dos números dentro da mesma
   quantidade de dígitos, presença de vai-um, quais porcentagens...), nunca o nº de dígitos.
   Todos os geradores produzem respostas EXATAS (inteiras, ou decimais finitos de 1–2 casas).
   Depende de: 01-utils.js, 02-engine-constants.js, 04-operations.js,
   05-expression-terms.js; usa Engine/Store só em tempo de execução.
   Usado por: 07-storage.js, 08-speed-engine.js, 09-feedback.js, 11-progress.js, 13-ui.js.
   ===================================================================== */

/* ---------- helpers de geração ---------- */
const rr = (lo, hi)=>U.rint(lo, Math.max(lo, hi));
const mix = (lo, hi, m)=>Math.round(lo + (hi-lo)*U.clamp(m,0,1));
const digitCount = n=>String(Math.abs(Math.trunc(n))).length;
const pickLang = pair=>{
  const en = (typeof Store!=='undefined' && Store.data && Store.data.settings.appLang==='en');
  return Array.isArray(pair) ? (en && pair[1]!=null ? pair[1] : pair[0]) : pair;
};
const bucketOf = c=>c<=0 ? 'sem' : c===1 ? 'um' : 'varios';

// Soma de dois operandos, com o nº de vai-uns inclinado (peso por padrão) para o bucket
// onde a pessoa está mais lenta — sempre dentro dos buckets permitidos do level.
function addPair(pickA, pickB, tr, allowed){
  const target = tr ? Engine.weightedBucket(tr, 'carries', allowed) : null;
  let a, b, c, tries=0, fb=null, hit=false;
  do{
    a=pickA(); b=pickB(); c=countCarries(a,b); tries++;
    if(fb===null && allowed.includes(bucketOf(c))) fb=[a,b,c];
    hit = target ? bucketOf(c)===target : allowed.includes(bucketOf(c));
  } while(!hit && tries<24);
  if(!hit && fb){ [a,b,c]=fb; }
  if(Math.random()<0.5) [a,b]=[b,a];
  return {a, b, answer:a+b, features:{carries:c}};
}
function subPair(pickA, pickB, tr, allowed){
  const target = tr ? Engine.weightedBucket(tr, 'borrows', allowed) : null;
  let a, b, c, tries=0, fb=null, hit=false;
  do{
    a=pickA(); b=pickB(a); c=countBorrows(a,b); tries++;
    if(fb===null && allowed.includes(bucketOf(c))) fb=[a,b,c];
    hit = target ? bucketOf(c)===target : allowed.includes(bucketOf(c));
  } while(!hit && tries<24);
  if(!hit && fb){ [a,b,c]=fb; }
  return {a, b, answer:a-b, features:{borrows:c}};
}
// 2 dígitos ± 1 dígito: com/sem vai-um (ou empréstimo) conforme m — nunca muda o nº de dígitos.
function smallAddSub(isSub, m){
  const want = Math.random() < 0.15+0.7*m;
  let a, b, tries=0, has;
  do{
    a = isSub ? rr(12, mix(60,99,m)) : rr(11, 95); b = rr(2,9);
    has = (isSub ? countBorrows(a,b) : countCarries(a,b)) > 0; tries++;
  } while(has!==want && tries<30);
  if(!isSub && Math.random()<0.5) [a,b]=[b,a];
  const c = isSub ? countBorrows(a,b) : countCarries(a,b);
  return {a, b, answer: isSub ? a-b : a+b, features: isSub ? {borrows:c} : {carries:c}};
}

// ---- tabuada (multiplicação e divisão) com peso por dígito/linha e pares quentes ----
function multTable(tr, lo, hi, digitKey){
  const a = tr ? Engine.pickRow(tr, digitKey, lo, hi) : rr(lo,hi);
  const hot = tr ? Engine.pickHotPartner(tr, 'mult', a, lo, hi) : null;
  const b = (hot!=null && Math.random()<HOTPAIR_INJECT_CHANCE) ? hot : rr(lo,hi);
  const answer = a*b;
  const item = {a, b, answer, features:{}, pairKind:'mult', pair:[a,b], digitKey, digits:[a,b]};
  if(tr && Math.random()<REVERSE_PATH_RATE){
    const hideLeft = Math.random()<0.5, sym = OPS.multiplicacao.symbol;
    item.exprText = hideLeft ? `? ${sym} ${b} = ${answer}` : `${a} ${sym} ? = ${answer}`;
    item.answer = hideLeft ? a : b; item.isReversePath = true;
  }
  return item;
}
function divTable(tr, lo, hi){
  const divisor = tr ? Engine.pickRow(tr, 'div', lo, hi) : rr(lo,hi);
  const hot = tr ? Engine.pickHotPartner(tr, 'div', divisor, lo, hi) : null;
  const quotient = (hot!=null && Math.random()<HOTPAIR_INJECT_CHANCE) ? hot : rr(lo,hi);
  const dividend = divisor*quotient;
  const item = {a:dividend, b:divisor, answer:quotient, features:{exact:true}, pairKind:'div', pair:[divisor,quotient], digitKey:'div', digits:[divisor]};
  if(tr && Math.random()<REVERSE_PATH_RATE){
    item.exprText = `? ${OPS.divisao.symbol} ${divisor} = ${quotient}`;
    item.answer = dividend; item.isReversePath = true;
  }
  return item;
}
// divisão exata: divisor d e quociente dentro de [qLo,qHi]
function divExact(d, qLo, qHi){
  const lo = Math.max(2, qLo), q = rr(lo, Math.max(lo, qHi));
  return {a:d*q, b:d, answer:q, features:{exact:true}};
}

// ---- potência / raiz ----
function singleTerm(term){ return {terms:[term], ops:[], answer:term.value, exprText:term.text, features:{}}; }
function termPair(t1, t2, op){
  let terms = [t1, t2];
  if(op==='subtracao' && t1.value<t2.value) terms = [t2, t1];
  else if(op!=='subtracao' && Math.random()<0.5) terms = [t2, t1];
  const val = applyOp2(op, terms[0].value, terms[1].value);
  return {terms, ops:[op], answer:val, exprText:chainText(terms,[op]), features:{}};
}

// ---- porcentagem ----
const pctPick = (tr, opts)=>tr ? Engine.weightedBucket(tr,'pct',opts) : U.choice(opts);
// ajusta a base (em passos de `step`) até p% dela ser inteiro — garante resposta exata
function pctExact(p, base, step=10){
  let tries=0; while((p*base)%100!==0 && tries<12){ base+=step; tries++; }
  return base;
}
function pctOriginal(m, tr){
  const opts = m<0.5 ? [10,20,50,25] : [10,20,50,25,15,5,30];
  const p = pctPick(tr, opts), aumento = m>0.5 && Math.random()<0.35;
  const k = aumento ? 100+p : 100-p;
  let orig = 10*rr(2, mix(12,40,m)), tries=0;
  while((orig*k)%100!==0 && tries<12){ orig+=10; tries++; }
  return {op:'porcentagem_original', a:orig*k/100, b:p, answer:orig, features:{pct:p, aumento}};
}
function pctVariation(m, tr){
  const opts = m<0.4 ? [10,20,50,25] : [10,20,50,25,15,5,30];
  const p = pctPick(tr, opts), down = Math.random()<0.5;
  const old = pctExact(p, 10*rr(2, mix(10,20,m)), 10), delta = old*p/100;
  return {op: down?'porcentagem_reducao':'porcentagem_aumento', a:old, b: down?old-delta:old+delta, answer:p, features:{pct:p}};
}
function pctSuccessive(m, tr){
  const opts = m<0.4 ? [10,20,50,25] : [10,20,50,25,15,5,30];
  let base, meio, final, p1, p2, ok=false, tries=0;
  while(!ok && tries<20){
    base = 10*rr(2, mix(10,40,m)); p1 = pctPick(tr,opts); p2 = pctPick(tr,opts);
    ok = (base*p1)%100===0;
    if(ok){ meio = base - base*p1/100; ok = (meio*p2)%100===0; if(ok) final = meio - meio*p2/100; }
    ok = ok && final>0; tries++;
  }
  if(!ok){ base=100; p1=10; p2=10; final=81; }
  return {op:'porcentagem_sucessiva', a:base, b:p1, c:p2, answer:final, exprText:`${base} − ${p1}% − ${p2}%`, features:{pct:p1}};
}

// ---- decimais (tudo em domínio inteiro de centésimos: a resposta é sempre exata) ----
function decVal(scale, maxInt, allowTrailing){
  let c, tries=0;
  do{ c = rr(scale, maxInt*scale + scale-1); tries++; }
  while(tries<10 && (c%scale===0 || (!allowTrailing && scale===100 && c%10===0)));
  return c;
}
function decAddSub(m, aScale, bScale, maxIntA, maxIntB){
  const aC = decVal(aScale, maxIntA, false), bC = decVal(bScale, maxIntB, false);
  const S = Math.max(aScale, bScale);
  let A = aC*(S/aScale), B = bC*(S/bScale);
  const sub = Math.random()<0.5;
  if(sub && A===B) A += S/10;          // iguais dariam 0: afasta um pouco
  let x = A, y = B;
  if(sub && A<B){ x = B; y = A; }      // minuendo sempre maior: resposta positiva
  const answer = (sub ? x-y : x+y)/S;
  return {op: sub?'subtracao':'soma', a:x/S, b:y/S, answer, features:{decimalPlaces: S===100?2:1}};
}

// ---- frações ----
function fracCmp(caseKey, m, denMax, scaleMax){
  let n1, d1, n2, d2;
  if(caseKey==='same_den'){
    d1 = d2 = rr(3, mix(6,12,m));
    n1 = rr(1, d1-1); do{ n2 = rr(1, d1-1); } while(n2===n1);
  } else if(caseKey==='same_num'){
    n1 = n2 = rr(1, mix(3,6,m));
    d1 = rr(n1+1, n1+mix(5,10,m)); do{ d2 = rr(n1+1, n1+mix(5,10,m)); } while(d2===d1);
  } else if(caseKey==='equal'){
    const q = rr(2, 6), p = rr(1, q-1), kHi = Math.max(2, Math.min(scaleMax, Math.floor(20/q)));
    const ka = rr(1, kHi); let kb = rr(1, kHi); if(kb===ka) kb = ka<kHi ? ka+1 : ka-1;
    n1=p*ka; d1=q*ka; n2=p*kb; d2=q*kb;
  } else { // cross
    const samples = m>0.55 ? 8 : 1; let best=null;
    for(let i=0;i<samples;i++){
      const dd1=rr(2,denMax), nn1=rr(1,dd1-1), dd2=rr(2,denMax), nn2=rr(1,dd2-1);
      const diff=Math.abs(nn1*dd2-nn2*dd1);
      if(diff===0) continue;
      if(!best || diff<best.diff) best={nn1,dd1,nn2,dd2,diff};
    }
    if(!best){ const dd=Math.max(3,denMax), nn=rr(1,dd-2); best={nn1:nn,dd1:dd,nn2:nn+1,dd2:dd,diff:dd}; }
    n1=best.nn1; d1=best.dd1; n2=best.nn2; d2=best.dd2;
  }
  if(Math.random()<0.5){ [n1,d1,n2,d2]=[n2,d2,n1,d1]; }
  return {op:'fracao_comparacao', a:n1, b:d1, c:n2, d:d2, answer:Math.sign(n1*d2-n2*d1),
    exprText:`${n1}/${d1}|${n2}/${d2}`, features:{case:caseKey}};
}
const fracTerm = (num, den, paren)=>({kind:'fraction', value:num/den, text: paren?`(${num}/${den})`:`${num}/${den}`, num, den});
function fracAddSub(m){
  const q = rr(2, mix(4,10,m)), opKey = U.choice(['soma','subtracao']);
  let p1, p2, answer;
  if(opKey==='soma'){ answer = rr(1, mix(2,6,m)); const total = q*answer; p1 = rr(1,total-1); p2 = total-p1; }
  else { answer = rr(1, mix(2,6,m)); p2 = rr(1, q*3); p1 = p2 + q*answer; }
  const terms = [fracTerm(p1,q), fracTerm(p2,q)];
  return {op:'fracao', terms, ops:[opKey], answer, exprText:chainText(terms,[opKey]), features:{}};
}
function fracMulDiv(m){
  const opKey = U.choice(['multiplicacao','divisao']);
  const C = rr(2, mix(4,10,m)), r = rr(2, mix(4,10,m)), A = C*r, B = rr(2, mix(5,10,m));
  let terms;
  if(opKey==='multiplicacao') terms = [fracTerm(A,B), fracTerm(B,C)];
  else terms = [fracTerm(A,B,true), fracTerm(C,B,true)];
  return {op:'fracao', terms, ops:[opKey], answer:r, exprText:chainText(terms,[opKey]), features:{}};
}

// ---- expressões ----
function opSym(k){ return OPS[k].symbol; }
function exprSimple(m, outerPool, cMax){
  const innerOp = U.choice(['soma','subtracao']), outerOp = U.choice(outerPool);
  let a = rr(2, mix(15,40,m)), b = rr(2, mix(15,40,m));
  if(innerOp==='subtracao' && a<=b){ [a,b]=[b,a]; if(a===b) a+=rr(1,5); }
  const inner = applyOp2(innerOp,a,b);
  let c = rr(2, cMax);
  if(outerOp==='subtracao' && inner<=c) c = rr(1, Math.max(1, inner-1));
  const answer = applyOp2(outerOp, inner, c);
  return {op:'expressao', a, b, c, innerOp, outerOp, answer,
    exprText:`(${a} ${opSym(innerOp)} ${b}) ${opSym(outerOp)} ${c}`, features:{}};
}
function exprChainAddSub(m){
  const n = m>0.6 ? 4 : 3;
  const hi = mix(40,99,m);
  let v = rr(20, mix(50,99,m));
  const terms = [termInt(v)], ops = [];
  for(let i=1;i<n;i++){
    let op = Math.random()<0.5 ? 'soma' : 'subtracao';
    if(op==='subtracao' && v<=12) op = 'soma';
    const x = op==='soma' ? rr(10,hi) : rr(10, Math.min(hi, v-1));
    v = applyOp2(op, v, x); terms.push(termInt(x)); ops.push(op);
  }
  return {op:'expressao_encadeada', terms, ops, answer:v, exprText:chainText(terms,ops), features:{}};
}
function exprDouble(m){
  const midOp = U.choice(['soma','subtracao','multiplicacao']);
  const hi = midOp==='multiplicacao' ? mix(8,12,m) : mix(20,60,m);
  const lo = midOp==='multiplicacao' ? 2 : 5;
  const pair = ()=>{
    const op = U.choice(['soma','subtracao']);
    let x = rr(lo,hi), y = rr(lo,hi);
    if(op==='subtracao'){ if(x===y) x = Math.min(hi+1, x+1); if(x<y) [x,y]=[y,x]; }
    return {x, y, op, val:applyOp2(op,x,y)};
  };
  let L = pair(), R = pair();
  if(midOp==='subtracao' && L.val<R.val) [L,R]=[R,L];
  const answer = applyOp2(midOp, L.val, R.val);
  return {op:'expressao', a:L.x, b:L.y, c:R.x, d:R.y, leftOp:L.op, rightOp:R.op, midOp, answer,
    exprText:`(${L.x} ${opSym(L.op)} ${L.y}) ${opSym(midOp)} (${R.x} ${opSym(R.op)} ${R.y})`, features:{}};
}
// Potências e raízes só aparecem DENTRO de expressões, de forma tranquila: quadrados de bases
// até 13, cubos de bases até 5 (e raízes quadradas exatas até √169) — o foco é a ordem das operações, não o cálculo pesado.
const POW_MAX_BASE = 13;
// Inclui cubos controlados (base 2–5) e bases negativas, para treinar a regra do sinal:
// (−3)² = 9, mas (−3)³ = −27. O enunciado sempre mostra a base negativa entre parênteses.
function gentleTerm(m, maxBase){
  const k = Math.min(POW_MAX_BASE, maxBase), r = Math.random();
  if(r<0.35) return termPower(rr(2,k),2);
  if(r<0.60) return termRoot(rr(2,k));
  if(r<0.80) return termPower((Math.random()<0.5?-1:1)*rr(2,5),3);
  return termPower(-rr(2,Math.min(k,9)),2);
}
function exprPowerChain(m){
  const k = Math.round(mix(6,POW_MAX_BASE,m));
  const pool = [
    ()=>termInt(rr(2,30)),
    ()=>gentleTerm(m,k),
    ()=>gentleTerm(m,k)
  ];
  let terms;
  do{ terms = [pool[rr(0,2)](), pool[rr(0,2)](), pool[rr(0,2)]()]; }
  while(!terms.some(t=>t.kind!=='int'));
  // O resultado PODE ser negativo (na prova haverá): a resposta é digitada com a tecla ±.
  const ops = []; let v = terms[0].value;
  for(let i=1;i<3;i++){
    const op = Math.random()<0.5 ? 'soma' : 'subtracao';
    v = applyOp2(op, v, terms[i].value); ops.push(op);
  }
  return {op:'expressao_encadeada', terms, ops, answer:v, exprText:chainText(terms,ops), features:{}};
}
// Ordem das operações: a multiplicação vem antes da soma/subtração (A ± B × C ou B × C ± A),
// com potência/raiz pequena em algum termo. O resultado pode ser negativo.
function exprOrder(m){
  const small = ()=>{ // fator de multiplicação: inteiro 2–9, quadrado de 2–5 ou √ de 4–81
    const r = Math.random();
    return r<0.5 ? termInt(rr(2,9)) : r<0.75 ? termPower(rr(2,5),2) : termRoot(rr(2,9));
  };
  const big = ()=> Math.random()<0.55 ? termInt(rr(5, Math.round(mix(25,60,m)))) : gentleTerm(m, Math.round(mix(8,POW_MAX_BASE,m)));
  let A, B, C, prodFirst, op, tries = 0;
  do{
    A = big(); B = small(); C = small(); prodFirst = Math.random()<0.5; op = Math.random()<0.5 ? 'soma' : 'subtracao';
    tries++;
  } while([A,B,C].every(t=>t.kind==='int') && tries<20);
  const prod = B.value*C.value;
  const answer = prodFirst ? applyOp2(op, prod, A.value) : applyOp2(op, A.value, prod);
  const terms = prodFirst ? [B,C,A] : [A,B,C];
  const ops = prodFirst ? ['multiplicacao', op] : [op, 'multiplicacao'];
  return {op:'expressao_encadeada', terms, ops, answer, exprText:chainText(terms,ops), features:{}};
}

// ---- equações ----
function eqText(a,b,c,d){
  const left = fmtCoefTerm(a) + (b!==0 ? ` ${b>0?'+':'−'} ${Math.abs(b)}` : '');
  const right = c!==0 ? (fmtCoefTerm(c) + (d!==0 ? ` ${d>0?'+':'−'} ${Math.abs(d)}` : '')) : `${d}`;
  return `${left} = ${right}`;
}
function eqItem(a,b,c,d,x){
  return {op:'equacao', a,b,c,d, answer:x, exprText:eqText(a,b,c,d), features:{}, isEquation:true};
}

/* ---------- as trilhas ---------- */
const TRACKS = {
  soma:{ sym:'+', color:'#22C55E', op:'soma', label:['Soma','Addition'], levels:[
    {n:['Unidades','Single digits'], goal:1000, shape:[1,1],
     tip:['Complete a dezena: 8 + 5 → 8 + 2 = 10, mais 3 = 13.','Make ten: 8 + 5 → 8 + 2 = 10, plus 3 = 13.'],
     gen(m,tr){ const hi=mix(6,9,m), a=rr(2,hi), b=rr(2,hi); return {a,b,answer:a+b,features:{carries:countCarries(a,b)}}; }},
    {n:['2 dígitos + 1 dígito','2 digits + 1 digit'], goal:1400, shape:[2,1],
     tip:['Complete a dezena primeiro: 47 + 5 → 47 + 3 = 50, depois + 2 = 52.','Reach the next ten first: 47 + 5 → 47 + 3 = 50, then + 2 = 52.'],
     gen(m,tr){ return smallAddSub(false,m); }},
    {n:['2 dígitos + 2 dígitos','2 digits + 2 digits'], goal:1800, shape:[2,2],
     tip:['Some as dezenas e depois as unidades: 32 + 45 → 70 + 7 = 77.','Add tens, then units: 32 + 45 → 70 + 7 = 77.'],
     gen(m,tr){ const maxT=mix(3,8,m), aT=rr(1,maxT), bT=rr(1,Math.max(1,9-aT)), aU=rr(0,9), bU=rr(0,9-aU);
       let a=aT*10+aU, b=bT*10+bU; if(Math.random()<0.5)[a,b]=[b,a]; return {a,b,answer:a+b,features:{carries:0}}; }},
    {n:['2 dígitos + 2 dígitos (vai-um)','2 digits + 2 digits (carrying)'], goal:2400, shape:[2,2],
     tip:['Compense: 47 + 38 → 47 + 40 − 2 = 85.','Round and compensate: 47 + 38 → 47 + 40 − 2 = 85.'],
     gen(m,tr){ const hi=mix(40,99,m); return addPair(()=>rr(10,hi), ()=>rr(10,hi), tr, ['um','varios']); }},
    {n:['3 dígitos + 2 dígitos','3 digits + 2 digits'], goal:3000, shape:[3,2],
     tip:['Da esquerda para a direita: 482 + 67 → 482 + 60 = 542, + 7 = 549.','Left to right: 482 + 67 → 482 + 60 = 542, + 7 = 549.'],
     gen(m,tr){ const hi=mix(300,999,m); return addPair(()=>rr(100,hi), ()=>rr(11,99), tr, ['sem','um','varios']); }},
    {n:['3 dígitos + 3 dígitos','3 digits + 3 digits'], goal:3800, shape:[3,3],
     tip:['Quebre o segundo número: 482 + 359 → 482 + 300 = 782, + 50 = 832, + 9 = 841.','Split the second number: 482 + 359 → 482 + 300 = 782, + 50 = 832, + 9 = 841.'],
     gen(m,tr){ const hi=mix(400,999,m); return addPair(()=>rr(100,hi), ()=>rr(100,hi), tr, ['sem','um','varios']); }},
    {n:['4 dígitos + 3 dígitos','4 digits + 3 digits'], goal:4800, shape:[4,3],
     tip:['Some por casas sem recomeçar: 4821 + 356 → 4821 + 300 = 5121, + 56 = 5177.','Add place by place: 4821 + 356 → 4821 + 300 = 5121, + 56 = 5177.'],
     gen(m,tr){ const hi=mix(3000,9999,m); return addPair(()=>rr(1000,hi), ()=>rr(100,999), tr, ['sem','um','varios']); }},
    {n:['4 dígitos + 4 dígitos','4 digits + 4 digits'], goal:5800, shape:[4,4],
     tip:['Milhar, centena, dezena e unidade em sequência, mantendo o total parcial na cabeça.','Thousands, hundreds, tens, units in sequence, holding the running total.'],
     gen(m,tr){ const hi=mix(4000,9999,m); return addPair(()=>rr(1000,hi), ()=>rr(1000,hi), tr, ['sem','um','varios']); }}
  ]},

  subtracao:{ sym:'−', color:'#F59E0B', op:'subtracao', label:['Subtração','Subtraction'], levels:[
    {n:['Unidades','Single digits'], goal:1100, shape:[1,1],
     tip:['Pense no que falta: 9 − 4 → 4 + ? = 9.','Think what is missing: 9 − 4 → 4 + ? = 9.'],
     gen(m,tr){ const a=rr(3,mix(7,9,m)), b=rr(1,a-1); return {a,b,answer:a-b,features:{borrows:0}}; }},
    {n:['2 dígitos − 1 dígito','2 digits − 1 digit'], goal:1500, shape:[2,1],
     tip:['Passe pela dezena: 52 − 7 → 52 − 2 = 50, − 5 = 45.','Go through the ten: 52 − 7 → 52 − 2 = 50, − 5 = 45.'],
     gen(m,tr){ return smallAddSub(true,m); }},
    {n:['2 dígitos − 2 dígitos','2 digits − 2 digits'], goal:2000, shape:[2,2],
     tip:['Subtraia dezenas e unidades em separado: 68 − 25 → 68 − 20 = 48, − 5 = 43.','Subtract tens and units separately: 68 − 25 → 68 − 20 = 48, − 5 = 43.'],
     gen(m,tr){ const aT=rr(2,mix(4,9,m)), bT=rr(1,aT-1), aU=rr(0,9), bU=rr(0,aU);
       return {a:aT*10+aU, b:bT*10+bU, answer:(aT-bT)*10+(aU-bU), features:{borrows:0}}; }},
    {n:['2 dígitos − 2 dígitos (empréstimo)','2 digits − 2 digits (borrowing)'], goal:2600, shape:[2,2],
     tip:['Compense: 82 − 38 → 82 − 40 + 2 = 44.','Round and compensate: 82 − 38 → 82 − 40 + 2 = 44.'],
     gen(m,tr){ const hi=mix(50,99,m); return subPair(()=>rr(21,hi), a=>rr(11,a-1), tr, ['um']); }},
    {n:['3 dígitos − 2 dígitos','3 digits − 2 digits'], goal:3300, shape:[3,2],
     tip:['Tire o segundo em partes: 543 − 67 → 543 − 60 = 483, − 7 = 476.','Take the second number in parts: 543 − 67 → 543 − 60 = 483, − 7 = 476.'],
     gen(m,tr){ const hi=mix(300,999,m); return subPair(()=>rr(100,hi), a=>rr(11,99), tr, ['sem','um','varios']); }},
    {n:['3 dígitos − 3 dígitos','3 digits − 3 digits'], goal:4200, shape:[3,3],
     tip:['Compense na centena: 742 − 398 → 742 − 400 + 2 = 344.','Compensate at the hundred: 742 − 398 → 742 − 400 + 2 = 344.'],
     gen(m,tr){ const hi=mix(500,999,m); return subPair(()=>rr(200,hi), a=>rr(100,a-1), tr, ['sem','um','varios']); }},
    {n:['4 dígitos − 3 dígitos','4 digits − 3 digits'], goal:5200, shape:[4,3],
     tip:['Arredonde e ajuste: 5210 − 387 → 5210 − 400 + 13 = 4823.','Round and adjust: 5210 − 387 → 5210 − 400 + 13 = 4823.'],
     gen(m,tr){ const hi=mix(3000,9999,m); return subPair(()=>rr(1000,hi), a=>rr(100,999), tr, ['sem','um','varios']); }},
    {n:['4 dígitos − 4 dígitos','4 digits − 4 digits'], goal:6300, shape:[4,4],
     tip:['Vá ao múltiplo de 1000 ou 100 mais próximo e ajuste no fim.','Go to the nearest multiple of 1000 or 100, then adjust at the end.'],
     gen(m,tr){ const hi=mix(5000,9999,m); return subPair(()=>rr(2000,hi), a=>rr(1000,a-1), tr, ['sem','um','varios']); }}
  ]},

  multiplicacao:{ sym:'×', color:'#6366F1', op:'multiplicacao', label:['Multiplicação','Multiplication'], levels:[
    {n:['Tabuada do 2 ao 5','Times table 2–5'], goal:1000, shape:[1,1],
     tip:['Âncoras: 5 × n é metade de 10 × n; 2 × n é o dobro de n.','Anchors: 5 × n is half of 10 × n; 2 × n is double n.'],
     gen(m,tr){ return multTable(tr,2,5,'mult'); }},
    {n:['Tabuada do 2 ao 9','Times table 2–9'], goal:1500, shape:[1,1],
     tip:['9 × n = 10 × n − n. Para 7 × 8 lembre da sequência 5-6-7-8 → 56 = 7 × 8.','9 × n = 10 × n − n. For 7 × 8 remember the run 5-6-7-8 → 56 = 7 × 8.'],
     gen(m,tr){ return multTable(tr,2,mix(7,9,m),'mult'); }},
    {n:['11 a 19 × 1 dígito','11–19 × 1 digit'], goal:2200, shape:[2,1],
     tip:['Decomponha: 14 × 6 → 10 × 6 + 4 × 6 = 60 + 24 = 84.','Split: 14 × 6 → 10 × 6 + 4 × 6 = 60 + 24 = 84.'],
     gen(m,tr){ const hi=mix(13,19,m), a=tr?Engine.pickRow(tr,'mult11',11,hi):rr(11,hi), b=rr(2,9);
       return {a,b,answer:a*b,features:{},digitKey:'mult11',digits:[a]}; }},
    {n:['2 dígitos × 1 dígito','2 digits × 1 digit'], goal:2800, shape:[2,1],
     tip:['Decomponha o maior: 47 × 6 → 40 × 6 + 7 × 6 = 240 + 42 = 282.','Split the larger: 47 × 6 → 40 × 6 + 7 × 6 = 240 + 42 = 282.'],
     gen(m,tr){ const a=rr(21,mix(49,99,m)), b=rr(2,9); return {a,b,answer:a*b,features:{}}; }},
    {n:['11 a 19 × 11 a 19','11–19 × 11–19'], goal:3800, shape:[2,2],
     tip:['13 × 17 → 13 × 10 + 13 × 7 = 130 + 91 = 221.','13 × 17 → 13 × 10 + 13 × 7 = 130 + 91 = 221.'],
     gen(m,tr){ const hi=mix(14,19,m), a=rr(11,hi), b=rr(11,hi); return {a,b,answer:a*b,features:{}}; }},
    {n:['2 dígitos × 2 dígitos','2 digits × 2 digits'], goal:5000, shape:[2,2],
     tip:['Decomponha o segundo fator: 36 × 24 → 36 × 20 + 36 × 4 = 720 + 144 = 864.','Split the second factor: 36 × 24 → 36 × 20 + 36 × 4 = 720 + 144 = 864.'],
     gen(m,tr){ const a=rr(21,mix(49,99,m)), b=rr(11,mix(29,99,m)); return {a,b,answer:a*b,features:{}}; }},
    {n:['3 dígitos × 1 dígito','3 digits × 1 digit'], goal:5500, shape:[3,1],
     tip:['Centenas, dezenas, unidades: 327 × 4 → 1200 + 80 + 28 = 1308.','Hundreds, tens, units: 327 × 4 → 1200 + 80 + 28 = 1308.'],
     gen(m,tr){ const a=rr(101,mix(300,999,m)), b=rr(2,9); return {a,b,answer:a*b,features:{}}; }},
    {n:['3 dígitos × 2 dígitos','3 digits × 2 digits'], goal:9000, shape:[3,2],
     tip:['Quebre o de 2 dígitos: 327 × 24 → 327 × 20 + 327 × 4 = 6540 + 1308 = 7848.','Split the 2-digit factor: 327 × 24 → 327 × 20 + 327 × 4 = 6540 + 1308 = 7848.'],
     gen(m,tr){ const a=rr(101,mix(300,999,m)), b=rr(11,mix(30,99,m)); return {a,b,answer:a*b,features:{}}; }}
  ]},

  divisao:{ sym:'÷', color:'#EC4899', op:'divisao', label:['Divisão','Division'], levels:[
    {n:['Tabuada do 2 ao 5','Times table 2–5'], goal:1200, shape:null,
     tip:['Pense na tabuada ao contrário: 20 ÷ 4 → 4 × ? = 20.','Think of the times table backwards: 20 ÷ 4 → 4 × ? = 20.'],
     gen(m,tr){ return divTable(tr,2,5); }},
    {n:['Tabuada do 2 ao 9','Times table 2–9'], goal:1800, shape:null,
     tip:['Procure o número que multiplicado pelo divisor dá o dividendo: 56 ÷ 7 → 7 × 8.','Find the number that times the divisor gives the dividend: 56 ÷ 7 → 7 × 8.'],
     gen(m,tr){ return divTable(tr,2,mix(7,9,m)); }},
    {n:['2 dígitos ÷ 1 dígito','2 digits ÷ 1 digit'], goal:2800, shape:[2,1],
     tip:['Divida em partes: 84 ÷ 4 → 80 ÷ 4 + 4 ÷ 4 = 20 + 1 = 21.','Divide in parts: 84 ÷ 4 → 80 ÷ 4 + 4 ÷ 4 = 20 + 1 = 21.'],
     gen(m,tr){ const d=tr?Engine.pickRow(tr,'div',2,9):rr(2,9);
       const it=divExact(d, Math.ceil(12/d), Math.floor(mix(60,99,m)/d)); it.digitKey='div'; it.digits=[d]; return it; }},
    {n:['3 dígitos ÷ 1 dígito','3 digits ÷ 1 digit'], goal:3800, shape:[3,1],
     tip:['Divida por casas: 672 ÷ 4 → 600 ÷ 4 + 72 ÷ 4 = 150 + 18 = 168.','Divide by place: 672 ÷ 4 → 600 ÷ 4 + 72 ÷ 4 = 150 + 18 = 168.'],
     gen(m,tr){ const d=tr?Engine.pickRow(tr,'div',2,9):rr(2,9);
       const it=divExact(d, Math.ceil(100/d), Math.floor(mix(300,999,m)/d)); it.digitKey='div'; it.digits=[d]; return it; }},
    {n:['3 dígitos ÷ 2 dígitos','3 digits ÷ 2 digits'], goal:5000, shape:[3,2],
     tip:['Estime e ajuste: 345 ÷ 15 → 15 × 20 = 300; sobram 45 = 15 × 3 → 23.','Estimate and adjust: 345 ÷ 15 → 15 × 20 = 300; 45 left = 15 × 3 → 23.'],
     gen(m,tr){ const d=rr(11,mix(15,25,m)); return divExact(d, Math.max(4,Math.ceil(100/d)), Math.floor(mix(400,999,m)/d)); }},
    {n:['4 dígitos ÷ 1 dígito','4 digits ÷ 1 digit'], goal:6000, shape:[4,1],
     tip:['Divida em blocos redondos: 3528 ÷ 7 → 3500 ÷ 7 + 28 ÷ 7 = 500 + 4 = 504.','Divide in round chunks: 3528 ÷ 7 → 3500 ÷ 7 + 28 ÷ 7 = 500 + 4 = 504.'],
     gen(m,tr){ const d=tr?Engine.pickRow(tr,'div',2,9):rr(2,9);
       const it=divExact(d, Math.ceil(1000/d), Math.floor(mix(3000,9999,m)/d)); it.digitKey='div'; it.digits=[d]; return it; }}
  ]},

  porcentagem:{ sym:'%', color:'#F97316', op:'porcentagem', label:['Porcentagem','Percentages'], levels:[
    {n:['10% e 50%','10% and 50%'], goal:1800, shape:null,
     tip:['10% = mover a vírgula uma casa. 50% = metade.','10% = move the decimal point one place. 50% = half.'],
     gen(m,tr){ const p=pctPick(tr,[10,50]), base=pctExact(p,10*rr(2,mix(10,20,m)),10);
       return {op:'porcentagem',a:p,b:base,answer:p*base/100,features:{pct:p}}; }},
    {n:['10%, 20%, 25%, 50% e 75%','10%, 20%, 25%, 50% and 75%'], goal:2400, shape:null,
     tip:['25% = metade da metade. 20% = 10% × 2. 75% = 100% − 25%.','25% = half of half. 20% = 10% × 2. 75% = 100% − 25%.'],
     gen(m,tr){ const p=pctPick(tr,[10,20,25,50,75]), base=pctExact(p,10*rr(2,mix(15,30,m)),10);
       return {op:'porcentagem',a:p,b:base,answer:p*base/100,features:{pct:p}}; }},
    {n:['5%, 15%, 30%, 35%, 40%, 60%','5%, 15%, 30%, 35%, 40%, 60%'], goal:3000, shape:null,
     tip:['Monte por partes: 15% = 10% + 5% (5% é a metade de 10%).','Build it in parts: 15% = 10% + 5% (5% is half of 10%).'],
     gen(m,tr){ const p=pctPick(tr,[5,15,30,40,60,35]), base=pctExact(p,10*rr(4,mix(20,40,m)),10);
       return {op:'porcentagem',a:p,b:base,answer:p*base/100,features:{pct:p}}; }},
    {n:['Desconto e acréscimo','Discounts and markups'], goal:3600, shape:null,
     tip:['Desconto de p% = ficar com (100 − p)%. 80 − 15% → 80 − 12 = 68.','A p% discount = keeping (100 − p)%. 80 − 15% → 80 − 12 = 68.'],
     gen(m,tr){ const opts=m<0.4?[10,20,25,50]:[10,20,25,50,15,5,30], p=pctPick(tr,opts), down=Math.random()<0.5;
       const base=pctExact(p,10*rr(2,mix(15,50,m)),10), amt=base*p/100;
       return {op:down?'porcentagem_desconto':'porcentagem_acrescimo',a:base,b:p,answer:down?base-amt:base+amt,features:{pct:p}}; }},
    {n:['"É quantos %?"','"What % is it?"'], goal:4000, shape:null,
     tip:['Parte ÷ base × 100: 20 é quantos % de 80 → 20/80 = 1/4 = 25%.','Part ÷ base × 100: 20 is what % of 80 → 20/80 = 1/4 = 25%.'],
     gen(m,tr){ const opts=m<0.4?[10,20,25,50]:[10,20,25,50,5,15,75,30], p=pctPick(tr,opts), base=pctExact(p,10*rr(2,mix(10,30,m)),10);
       return {op:'porcentagem_inversa',a:p*base/100,b:base,answer:p,features:{pct:p}}; }},
    {n:['Valor original, variação e descontos sucessivos','Original value, change and successive discounts'], goal:5500, shape:null,
     tip:['Para desfazer um desconto, divida: x − 20% = 80 → x = 80 ÷ 0,8 = 100. Variação % sempre usa o valor INICIAL.','To undo a discount, divide: x − 20% = 80 → x = 80 ÷ 0.8 = 100. Percentage change always uses the INITIAL value.'],
     gen(m,tr){ const r=Math.random(); return r<0.34 ? pctOriginal(m,tr) : r<0.67 ? pctVariation(m,tr) : pctSuccessive(m,tr); }}
  ]},

  decimais:{ sym:',', color:'#14B8A6', op:'soma', label:['Contas com vírgula','Decimals'], levels:[
    {n:['Soma e subtração, 1 casa','Add/subtract, 1 decimal'], goal:2000, shape:null,
     tip:['Ignore a vírgula, calcule como inteiros e reposicione a vírgula.','Ignore the decimal point, calculate as whole numbers, then reposition it.'],
     gen(m,tr){ return decAddSub(m,10,10,mix(3,9,m),mix(3,9,m)); }},
    {n:['Soma e subtração, 2 casas','Add/subtract, 2 decimals'], goal:2800, shape:null,
     tip:['Alinhe as casas: 2,35 + 4,6 → 2,35 + 4,60.','Line up the places: 2.35 + 4.6 → 2.35 + 4.60.'],
     gen(m,tr){ return decAddSub(m,100,100,mix(3,9,m),mix(3,9,m)); }},
    {n:['Casas diferentes (1 e 2)','Mixed places (1 and 2)'], goal:3600, shape:null,
     tip:['Alinhe as casas: 12,5 + 3,75 → 12,50 + 3,75 = 16,25.','Line up the places: 12.5 + 3.75 → 12.50 + 3.75 = 16.25.'],
     gen(m,tr){ return Math.random()<0.5 ? decAddSub(m,10,100,mix(9,49,m),mix(3,9,m)) : decAddSub(m,100,10,mix(3,9,m),mix(9,49,m)); }},
    {n:['Decimal × inteiro','Decimal × integer'], goal:3000, shape:null,
     tip:['Multiplique como inteiros e reponha a vírgula: 3,4 × 6 → 34 × 6 = 204 → 20,4.','Multiply as integers and put the point back: 3.4 × 6 → 34 × 6 = 204 → 20.4.'],
     gen(m,tr){ const aC=decVal(10,mix(5,9,m),false), b=rr(2,9);
       return {op:'multiplicacao',a:aC/10,b,answer:(aC*b)/10,features:{decimalPlaces:1}}; }},
    {n:['Multiplicação e divisão por inteiro','Multiply and divide by an integer'], goal:4200, shape:null,
     tip:['Divida como inteiros e posicione a vírgula: 7,2 ÷ 4 → 72 ÷ 4 = 18 → 1,8.','Divide as integers and place the point: 7.2 ÷ 4 → 72 ÷ 4 = 18 → 1.8.'],
     gen(m,tr){ const dp=tr?Engine.weightedBucket(tr,'decimalPlaces',[1,2]):(Math.random()<0.5?1:2), sc=dp===2?100:10;
       if(Math.random()<0.5){ const aC=decVal(sc,mix(3,9,m),false), b=rr(2,9);
         return {op:'multiplicacao',a:aC/sc,b,answer:(aC*b)/sc,features:{decimalPlaces:dp}}; }
       const d=rr(2,9), qC=decVal(sc,mix(3,9,m),false);
       return {op:'divisao',a:(qC*d)/sc,b:d,answer:qC/sc,features:{decimalPlaces:dp,exact:true}}; }},
    {n:['Decimal × decimal','Decimal × decimal'], goal:5500, shape:null,
     tip:['Conte as casas: 0,6 × 0,7 → 6 × 7 = 42, com 2 casas → 0,42.','Count the places: 0.6 × 0.7 → 6 × 7 = 42, with 2 places → 0.42.'],
     gen(m,tr){ let aC, bC, t=0; do{ aC=rr(2,mix(29,99,m)); bC=rr(2,mix(9,59,m)); t++; }while(t<10 && (aC%10===0 || bC%10===0));
       return {op:'multiplicacao',a:aC/10,b:bC/10,answer:(aC*bC)/100,features:{decimalPlaces:2}}; }}
  ]},

  fracoes:{ sym:'⅔', color:'#EAB308', op:'fracao', label:['Frações','Fractions'], levels:[
    {n:['Comparar: mesmo denominador ou numerador','Compare: same denominator or numerator'], goal:1800, shape:null,
     tip:['Mesmo denominador: maior numerador vence. Mesmo numerador: menor denominador vence.','Same denominator: larger numerator wins. Same numerator: smaller denominator wins.'],
     gen(m,tr){ return fracCmp(tr?Engine.weightedBucket(tr,'case',['same_den','same_num']):U.choice(['same_den','same_num']), m, 9, 3); }},
    {n:['Comparar: multiplicação cruzada','Compare: cross-multiplication'], goal:3000, shape:null,
     tip:['Multiplicação cruzada: a/b ? c/d → compare a × d com c × b.','Cross-multiply: a/b ? c/d → compare a × d with c × b.'],
     gen(m,tr){ const o=['cross','cross','cross','equal']; return fracCmp(tr?Engine.weightedBucket(tr,'case',o):U.choice(o), m, mix(6,9,m), 3); }},
    {n:['Soma e subtração (mesmo denominador)','Add/subtract (same denominator)'], goal:3500, shape:null,
     tip:['Mesmo denominador: some/subtraia os numeradores e simplifique.','Same denominator: add/subtract the numerators and simplify.'],
     gen(m,tr){ return fracAddSub(m); }},
    {n:['Multiplicar e dividir frações','Multiply and divide fractions'], goal:4200, shape:null,
     tip:['Cancele antes de multiplicar. Dividir por fração = multiplicar pelo inverso.','Cancel before multiplying. Dividing by a fraction = multiplying by its inverse.'],
     gen(m,tr){ return fracMulDiv(m); }},
    {n:['Comparar quase-empates','Compare near-ties'], goal:5500, shape:null,
     tip:['Quase-empate: use a multiplicação cruzada e compare os dois produtos.','Near-tie: cross-multiply and compare the two products.'],
     gen(m,tr){ const o=['cross','cross','cross','cross','equal']; return fracCmp(tr?Engine.weightedBucket(tr,'case',o):U.choice(o), Math.max(m,0.6), mix(10,18,m), 4); }}
  ]},

  expressoes:{ sym:'( )', color:'#3B82F6', op:'expressao', label:['Expressões','Expressions'], levels:[
    {n:['Parênteses simples (+ e −)','Simple parentheses (+ and −)'], goal:3000, shape:null,
     tip:['Resolva o parêntese primeiro.','Solve the parentheses first.'],
     gen(m,tr){ return exprSimple(m,['soma','subtracao'],mix(9,25,m)); }},
    {n:['Parênteses com multiplicação','Parentheses with multiplication'], goal:3800, shape:null,
     tip:['Parêntese primeiro, depois multiplique.','Parentheses first, then multiply.'],
     gen(m,tr){ const it=exprSimple(m,['multiplicacao'],mix(5,9,m)); return it; }},
    {n:['Cadeias de soma e subtração','Add/subtract chains'], goal:4200, shape:null,
     tip:['Da esquerda para a direita, sem recomeçar: agrupe dezenas redondas quando der.','Left to right without restarting: group round tens when possible.'],
     gen(m,tr){ return exprChainAddSub(m); }},
    {n:['Dois parênteses','Two parentheses'], goal:6000, shape:null,
     tip:['Resolva cada parêntese e só então combine os dois resultados.','Solve each parenthesis, then combine the two results.'],
     gen(m,tr){ return exprDouble(m); }},
    {n:['Potências, cubos e raízes simples','Simple powers, cubes and roots'], goal:5500, shape:null,
     tip:['Potências e raízes primeiro; depois some/subtraia da esquerda para a direita. Cuidado com o sinal: (−3)² = 9, mas (−3)³ = −27.','Powers and roots first; then add/subtract left to right. Mind the sign: (−3)² = 9, but (−3)³ = −27.'],
     gen(m,tr){ return exprPowerChain(m); }},
    {n:['Ordem das operações','Order of operations'], goal:7000, shape:null,
     tip:['Primeiro potências e raízes, depois a multiplicação, por último soma e subtração: 9 + 3 × 4 = 9 + 12.','First powers and roots, then multiplication, last add/subtract: 9 + 3 × 4 = 9 + 12.'],
     gen(m,tr){ return exprOrder(m); }}
  ]},

  equacoes:{ sym:'x', color:'#84CC16', op:'equacao', label:['Equações','Equations'], levels:[
    {n:['x + b = c','x + b = c'], goal:2500, shape:null,
     tip:['Isole x: faça a operação inversa dos dois lados.','Isolate x: do the inverse operation on both sides.'],
     gen(m,tr){ const x=rr(2,mix(15,60,m)), B=rr(2,mix(9,40,m)), plus=Math.random()<0.5;
       if(plus) return eqItem(1,B,0,x+B,x);
       const xx=x+B; return eqItem(1,-B,0,xx-B,xx); }},
    {n:['ax = c','ax = c'], goal:3000, shape:null,
     tip:['Divida os dois lados por quem multiplica x.','Divide both sides by the coefficient of x.'],
     gen(m,tr){ const a=rr(2,mix(6,12,m)), x=rr(2,mix(9,15,m)); return eqItem(a,0,0,a*x,x); }},
    {n:['ax + b = c','ax + b = c'], goal:4000, shape:null,
     tip:['Primeiro afaste a constante (some/subtraia dos dois lados), depois divida.','First move the constant away (add/subtract on both sides), then divide.'],
     gen(m,tr){ const a=rr(2,mix(6,12,m)), x=rr(2,mix(9,20,m)); let B=rr(1,mix(10,40,m))*(Math.random()<0.5?1:-1);
       if(a*x+B<=0) B=-B;
       return eqItem(a,B,0,a*x+B,x); }},
    {n:['ax + b = cx + d','ax + b = cx + d'], goal:5500, shape:null,
     tip:['Junte os x de um lado e os números do outro.','Gather the x terms on one side and the numbers on the other.'],
     gen(m,tr){ const a=rr(3,mix(6,12,m)), c=rr(1,a-1), x=rr(2,mix(9,15,m)); let B=rr(1,mix(10,40,m))*(m>0.5&&Math.random()<0.4?-1:1);
       if((a-c)*x+B<=0) B=Math.abs(B);
       return eqItem(a,B,c,(a-c)*x+B,x); }},
    {n:['Com números negativos','With negative numbers'], goal:7500, shape:null,
     tip:['Cuidado com o sinal ao mudar um termo de lado.','Watch the sign when moving a term across the equals sign.'],
     gen(m,tr){ let x,a,c,B,d,t=0;
       do{ x=rr(-mix(6,20,m), mix(6,20,m)); a=rr(2,mix(3,12,m))*(Math.random()<0.5?-1:1);
           c=Math.random()<0.7 ? rr(0,mix(3,12,m))*(Math.random()<0.5?-1:1) : 0;
           B=rr(-mix(15,85,m), mix(15,85,m)); d=(a-c)*x+B; t++; }
       while((a===c || x===0 || Math.abs(d)>1999) && t<40);
       if(a===c || x===0){ a=3; c=1; x=4; B=5; d=(a-c)*x+B; }
       return eqItem(a,B,c,d,x); }}
  ]}
};
/* ---------- números negativos nos levels finais ----------
   Na prova aparecem contas com sinal. Nos últimos levels de subtração, multiplicação e divisão,
   parte das contas (NEG_RATE, sobe um pouco com m) vira uma variante com sinal, mantendo o nº de
   dígitos do level: b − a < 0, a − (−b), (−a) × b, (−a) ÷ (−b)... A resposta pode ser negativa
   (digita-se com ±). Essas contas ficam fora dos pesos de vai-um/empréstimo (features = {neg}). */
const NEG_RATE = [0.22, 0.38];
const NEG_LEVELS = {subtracao:3, multiplicacao:3, divisao:2};  // quantos levels finais recebem sinais
const NEG_TIP = {
  subtracao:['Sinais: subtrair um negativo é somar (7 − (−3) = 10); e se o 1º número é menor, o resultado é negativo: calcule o maior − menor e ponha o sinal.',
    'Signs: subtracting a negative means adding (7 − (−3) = 10); if the first number is smaller the result is negative: do bigger − smaller and add the sign.'],
  multiplicacao:['Sinais: iguais dão positivo, diferentes dão negativo. Calcule sem sinal e depois decida o sinal.','Signs: same signs give positive, different signs give negative. Multiply first, then decide the sign.'],
  divisao:['Sinais: iguais dão positivo, diferentes dão negativo. Divida sem sinal e depois decida o sinal.','Signs: same signs give positive, different signs give negative. Divide first, then decide the sign.']
};
function negify(it, key){
  if(!it || it.isReversePath || !Number.isInteger(it.a) || !Number.isInteger(it.b) || it.a<=0 || it.b<=0) return it;
  const a = it.a, b = it.b; let terms, ops, answer;
  const sgn = ()=>Math.random()<0.5 ? -1 : 1;
  const op = it.op || TRACKS[key].op;
  if(op==='subtracao'){
    if(a===b) return it;
    if(Math.random()<0.6){ terms=[termInt(Math.min(a,b)), termInt(Math.max(a,b))]; answer=Math.min(a,b)-Math.max(a,b); }   // menor − maior
    else { terms=[termInt(a), termInt(-b)]; answer=a+b; }                                                                    // a − (−b)
    ops=['subtracao'];
  } else if(op==='multiplicacao' || op==='divisao'){
    let sa = sgn(), sb = sgn(); if(sa>0 && sb>0) sa = -1;
    terms=[termInt(sa*a), termInt(sb*b)]; ops=[op]; answer = sa*sb*it.answer;
  } else return it;
  return Object.assign({}, it, {terms, ops, answer, exprText:chainText(terms,ops), features:{neg:true}});
}
Object.keys(NEG_LEVELS).forEach(key=>{
  const L = TRACKS[key].levels, n = L.length;
  for(let i=n-NEG_LEVELS[key]; i<n; i++){
    const lv = L[i], g = lv.gen;
    lv.gen = (m,tr)=>{ const it = g(m,tr); return Math.random()<NEG_RATE[0]+(NEG_RATE[1]-NEG_RATE[0])*m ? negify(it, key) : it; };
    lv.tip = [lv.tip[0]+' '+NEG_TIP[key][0], lv.tip[1]+' '+NEG_TIP[key][1]];
  }
});

const TRACK_ORDER = ['soma','subtracao','multiplicacao','divisao','porcentagem','decimais','fracoes','expressoes','equacoes'];
const DEFAULT_ACTIVE_TRACKS = ['soma','subtracao','multiplicacao','divisao'];

function trackLabel(key){ return pickLang(TRACKS[key].label); }
function trackLevels(key){ return TRACKS[key].levels.length; }
function levelDef(key, level){ const L=TRACKS[key].levels; return L[U.clamp(level,1,L.length)-1]; }
function levelName(key, level){ return pickLang(levelDef(key,level).n); }
function levelTip(key, level){ return pickLang(levelDef(key,level).tip); }
// Meta de tempo do level (ms). Na patente "Mestre" ela encolhe RANK_GOAL_DECAY por patente.
function levelGoalMs(key, level, rank=0){
  return Math.round(levelDef(key,level).goal * Math.pow(RANK_GOAL_DECAY, rank||0));
}
