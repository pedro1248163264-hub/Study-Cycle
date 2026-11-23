/* =========================================================
   Study Cycle — gabarito com notação matemática (LaTeX/MathJax)

   O texto salvo continua sendo uma string comum. Aqui só decidimos
   como exibi-lo: se houver marcação ($...$, \(...\), \frac etc.),
   renderizamos com KaTeX; se não houver, escapamos e mostramos o
   texto normal. O KaTeX vem do jsdelivr sob demanda — mesmo jeito
   do OCR — e o Service Worker guarda os arquivos para uso offline.
   ========================================================= */
(function () {
  'use strict';
  const SC = window.SC;
  const esc = SC.esc;

  // Atenção: manter a mesma versão em sw.js (MATH_ASSETS), senão o cache
  // offline guarda arquivos diferentes dos que esta página carrega.
  const VERSION = '0.16.11';
  const BASE = 'https://cdn.jsdelivr.net/npm/katex@' + VERSION + '/dist';
  const CSS_URL = BASE + '/katex.min.css';
  const JS_URL = BASE + '/katex.min.js';

  let loading = null;
  let mathReady = false; // CSS + JS carregados: só então é seguro injetar o HTML do KaTeX
  let lastFail = 0;
  const RETRY_MS = 5000; // evita injetar link/script de novo a cada tecla digitada

  // Carrega uma vez só. CSS e JS precisam estar prontos antes de renderizar.
  // Se o CSS falhar, NÃO renderizamos: sem as regras do KaTeX o MathML de
  // acessibilidade fica visível e os spans soltos "escapam" do retângulo da resposta.
  function loadMath() {
    if (mathReady && window.katex) return Promise.resolve(window.katex);
    if (loading) return loading;
    if (Date.now() - lastFail < RETRY_MS) return Promise.reject(new Error('katex-load-failed'));
    let link, script;
    loading = new Promise((resolve, reject) => {
      let cssOk = false, jsOk = false, settled = false;
      const ready = () => {
        if (settled || !cssOk || !jsOk || !window.katex) return;
        settled = true;
        mathReady = true;
        resolve(window.katex);
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        lastFail = Date.now();
        [link, script].forEach((n) => { if (n && n.parentNode) n.parentNode.removeChild(n); });
        Promise.resolve().then(() => { if (!mathReady) loading = null; }); // permite tentar de novo quando a conexão/cache voltar
        reject(new Error('katex-load-failed'));
      };
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.crossOrigin = 'anonymous'; // mesmo modo da requisição pré-cacheada pelo Service Worker
      link.href = CSS_URL;
      link.onload = () => { cssOk = true; ready(); };
      link.onerror = fail; // sem CSS, mantém o texto simples (não injeta HTML solto)
      script = document.createElement('script');
      script.crossOrigin = 'anonymous';
      script.src = JS_URL;
      script.onload = () => { jsOk = true; ready(); };
      script.onerror = fail;
      document.head.appendChild(link);
      document.head.appendChild(script);
    });
    loading.catch(() => {}); // sem internet/CSS: o texto simples continua aparecendo
    return loading;
  }

  // $$...$$ e \[...\] são blocos; $...$ e \(...\) são inline.
  const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]*?)\\\)/g;
  // Comando LaTeX sem delimitador (ex.: "\frac{1}{2}") também conta como fórmula.
  const BARE_COMMAND = /\\[A-Za-z]{2,}/;

  function splitMath(text) {
    const out = [];
    let last = 0, m, found = false;
    MATH_RE.lastIndex = 0;
    while ((m = MATH_RE.exec(text)) !== null) {
      found = true;
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      const inner = m[1] != null ? m[1] : m[2] != null ? m[2] : m[3] != null ? m[3] : m[4];
      out.push({ math: inner, display: m[1] != null || m[2] != null });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    if (!found) {
      if (!BARE_COMMAND.test(text)) return null; // texto comum: deixa normalzinho
      return [{ math: text, display: false }];
    }
    return out;
  }

  function renderMath(tex, display) {
    try {
      return window.katex.renderToString(tex, {
        displayMode: !!display,
        throwOnError: false, // fórmula inválida aparece em vermelho, não quebra a tela
        trust: false,        // não executa \href, \url etc.
        strict: 'ignore',
      });
    } catch (e) {
      return '<code class="math-error">' + esc(tex) + '</code>';
    }
  }

  function renderParts(parts) {
    return parts.map((p) => (p.math != null ? renderMath(p.math, p.display) : esc(p.text))).join('');
  }

  // Depois que a biblioteca chega, troca o texto provisório pelo renderizado
  // sem redesenhar o modal (evita perder o que a pessoa estava digitando).
  function hydrate() {
    if (!mathReady || !window.katex) return;
    document.querySelectorAll('[data-math-raw]').forEach((el) => {
      el.innerHTML = formatAnswer(el.getAttribute('data-math-raw'));
      el.removeAttribute('data-math-raw');
      el.classList.remove('math-pending');
    });
  }

  // Devolve HTML seguro para uma resposta do gabarito.
  function formatAnswer(value) {
    const text = String(value == null ? '' : value);
    const parts = splitMath(text);
    if (!parts) return esc(text);
    if (!mathReady || !window.katex) {
      loadMath().then(hydrate, () => {}); // mantém o texto simples enquanto carrega — ou se falhar
      return '<span class="math-pending" data-math-raw="' + esc(text) + '">' + esc(text) + '</span>';
    }
    return renderParts(parts);
  }

  SC.formatAnswer = formatAnswer;
  // Só vale prévia quando há marcação matemática de verdade; texto comum
  // continua apenas dentro do campo (evita a "duplicação" abaixo do input).
  SC.hasMath = (value) => splitMath(String(value == null ? '' : value)) !== null;
})();
