/* =====================================================================
   assets/js/04-operations.js — operações usadas para RENDERIZAR e FALAR
   cada conta (símbolo e rótulo). A progressão não depende mais daqui: ela
   vive nas trilhas (06-tracks.js).
   Depende de: nada.
   Usado por: 05, 06, 08, 09, 10 e 13.
   ===================================================================== */

/* ---------- 3. OPERAÇÕES (símbolos/labels) ---------- */
const OPS = {
  soma: {key:'soma', label:'Soma', label_en:'Addition', symbol:'+'},
  subtracao: {key:'subtracao', label:'Subtração', label_en:'Subtraction', symbol:'−'},
  multiplicacao: {key:'multiplicacao', label:'Multiplicação', label_en:'Multiplication', symbol:'×'},
  divisao: {key:'divisao', label:'Divisão', label_en:'Division', symbol:'÷'},
  porcentagem: {key:'porcentagem', label:'Porcentagem', label_en:'Percentage', symbol:'%'},
  porcentagem_inversa: {key:'porcentagem_inversa', label:'Porcentagem inversa', label_en:'Reverse percentage', symbol:'?%'},
  porcentagem_acrescimo: {key:'porcentagem_acrescimo', label:'Acréscimo de %', label_en:'Percentage markup', symbol:'+%'},
  porcentagem_desconto: {key:'porcentagem_desconto', label:'Desconto de %', label_en:'Percentage discount', symbol:'−%'},
  porcentagem_original: {key:'porcentagem_original', label:'Valor original após %', label_en:'Original value before %', symbol:'x=%'},
  porcentagem_aumento: {key:'porcentagem_aumento', label:'Aumento entre valores', label_en:'Increase between values', symbol:'→+%'},
  porcentagem_reducao: {key:'porcentagem_reducao', label:'Redução entre valores', label_en:'Decrease between values', symbol:'→−%'},
  porcentagem_sucessiva: {key:'porcentagem_sucessiva', label:'Descontos sucessivos', label_en:'Successive discounts', symbol:'−−%'},
  expressao: {key:'expressao', label:'Expressão', label_en:'Expression', symbol:'()'},
  expressao_encadeada: {key:'expressao_encadeada', label:'Encadeada', label_en:'Chained', symbol:'⋯'},
  fracao: {key:'fracao', label:'Fração', label_en:'Fraction', symbol:'/'},
  fracao_comparacao: {key:'fracao_comparacao', label:'Fração — comparação', label_en:'Fraction — comparison', symbol:'⇔'},
  potencia: {key:'potencia', label:'Potência', label_en:'Power', symbol:'^'},
  radical: {key:'radical', label:'Radical', label_en:'Root', symbol:'√'},
  equacao: {key:'equacao', label:'Equação', label_en:'Equation', symbol:'x'}
};

// Aplica uma operação básica (pelas chaves de OPS) a dois operandos — usado pelos
// geradores de expressões.
function applyOp2(opKey, x, y){
  if(opKey==='soma') return x+y;
  if(opKey==='subtracao') return x-y;
  if(opKey==='multiplicacao') return x*y;
  if(opKey==='divisao') return y!==0 ? x/y : NaN;
  return NaN;
}

// Comparação de frações: o símbolo respondido (<, > ou =) viaja como inteiro no campo
// `answer` (mesma exigência de resposta numérica das demais contas). Fonte única do
// mapeamento — usada pela correção (10-session.js), pelo teclado e pelo feedback de erro
// (13-ui.js). O inverso só é seguro para itens de comparação (op checada antes).
const COMPARE_SYMBOLS = {'<':-1, '=':0, '>':1};
function compareSymbolOf(code){ return code<0 ? '<' : code>0 ? '>' : '='; }
