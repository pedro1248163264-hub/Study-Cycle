/* =====================================================================
   assets/js/05-expression-terms.js — 'termos' usados dentro das contas:
   inteiro, potência, radical (quadrada e cúbica), sobrescrito/subscrito, além
   dos contadores de vai-um/empréstimo.
   Depende de: 01-utils.js (U), 04-operations.js (OPS).
   Usado por: 06-tracks.js (geradores), 09-feedback.js e 13-ui.js.
   ===================================================================== */

/* "Termo" = unidade de operando dentro de uma conta maior. Cada gerador de termo devolve
   {kind, value, text, ...campos extras p/ renderização e TTS}. */
const SUP_MAP = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','-':'⁻'};
function toSup(n){ return String(n).split('').map(c=>SUP_MAP[c]||c).join(''); }
function fmtCoefTerm(coef){
  if(coef===0) return '0';
  const sign = coef<0 ? '−' : '';
  const abs = Math.abs(coef);
  return `${sign}${abs===1?'':abs}x`;
}
function termInt(v){ return {kind:'int', value:v, text:String(v)}; }
function termPower(base, exp){
  return {kind:'power', value:Math.pow(base,exp), text:`${base<0?'(−'+(-base)+')':base}${toSup(exp)}`, base, exp};
}
// Raiz quadrada exata de k² (índice 2) ou raiz cúbica exata de k³ (índice 3).
function termRoot(k, index=2){
  const radicand = Math.pow(k, index);
  return {kind:'radical', index, value:k, text:`${index===3?'∛':'√'}${radicand}`, radicand};
}
function chainText(terms, ops){
  let s = terms[0].text;
  for(let i=0;i<ops.length;i++) s += ` ${OPS[ops[i]].symbol} ${terms[i+1].text}`;
  return s;
}

function countCarries(a,b){
  let da=String(a).split('').reverse(), db=String(b).split('').reverse();
  let carry=0, count=0;
  for(let i=0;i<Math.max(da.length,db.length);i++){
    let sum = (+da[i]||0)+(+db[i]||0)+carry;
    if(sum>=10){ carry=1; count++; } else carry=0;
  }
  return count;
}
function countBorrows(a,b){
  let da=String(a).split('').reverse(), db=String(b).split('').reverse();
  let borrow=0, count=0;
  for(let i=0;i<da.length;i++){
    let x=(+da[i]||0)-borrow, y=(+db[i]||0);
    if(x<y){ count++; borrow=1; } else borrow=0;
  }
  return count;
}
