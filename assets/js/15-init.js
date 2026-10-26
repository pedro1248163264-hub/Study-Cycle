/* =====================================================================
   assets/js/15-init.js — inicialização do app: carrega o Store, prepara o
   TTS, chama UI.init() quando o DOM está pronto e registra o service
   worker (PWA).
   Depende de: 07-storage.js, 09-feedback.js, 14-ui.js.
   Este é o único módulo com efeitos colaterais de inicialização — os
   testes automatizados (tests/run-tests.js) carregam todos os módulos
   *exceto* este, para controlar a inicialização manualmente.
   ===================================================================== */

Store.load();
TTS.init();
document.addEventListener('DOMContentLoaded', ()=>{
  UI.init();
  // Registrado sempre: ao mudar para "Automático" nos ajustes o tema passa a seguir o sistema.
  if(window.matchMedia){
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ()=>UI.applyTheme());
  }
});
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
