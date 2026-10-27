/* =========================================================
   Study Cycle — imagens e OCR

   Tesseract.js roda 100% no navegador e só é baixado quando você toca
   em "Extrair texto" pela primeira vez (precisa de internet nessa 1ª
   vez; depois fica em cache e funciona offline).
   ========================================================= */
(function () {
  'use strict';
  const SC = window.SC;

  // Redimensiona/comprime no navegador antes de guardar em base64, para
  // não inflar o IndexedDB nem o que é enviado na sincronização.
  function resizeImageFile(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > h && w > maxDim) { h = Math.round(h * (maxDim / w)); w = maxDim; }
          else if (h >= w && h > maxDim) { w = Math.round(w * (maxDim / h)); h = maxDim; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let tesseractLoading = null;
  let workerPromise = null;
  let progressCb = null;

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tesseractLoading) {
      tesseractLoading = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = TESSERACT_URL;
        el.onload = () => resolve(window.Tesseract);
        el.onerror = () => { tesseractLoading = null; reject(new Error('load-failed')); };
        document.head.appendChild(el);
      });
    }
    return tesseractLoading;
  }

  function getWorker() {
    if (!workerPromise) {
      workerPromise = loadTesseract().then((T) => T.createWorker('por', 1, {
        logger: (m) => { if (progressCb) progressCb(m); },
      }));
      workerPromise.catch(() => { workerPromise = null; });
    }
    return workerPromise;
  }

  // Aceita File (foto original, melhor qualidade) ou data URL. Devolve um
  // canvas ampliado se pequeno / reduzido se enorme (OCR lê melhor ~1000-2000px).
  function toOcrCanvas(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      let objUrl = null;
      img.onload = () => {
        const longSide = Math.max(img.width, img.height);
        const scale = longSide > 2000 ? 2000 / longSide : (longSide < 1000 ? 2 : 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.filter = 'grayscale(1) contrast(1.15)';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (objUrl) URL.revokeObjectURL(objUrl);
        resolve(canvas);
      };
      img.onerror = reject;
      if (typeof source === 'string') img.src = source;
      else { objUrl = URL.createObjectURL(source); img.src = objUrl; }
    });
  }

  // O OCR devolve uma linha por linha visual. Junta as que são continuação
  // do mesmo parágrafo, mas mantém quebra antes de alternativas, itens de
  // lista e depois de pontuação final.
  function cleanOcrText(raw) {
    const lines = String(raw || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/g, ''));
    const out = [];
    const optionStart = /^\s*(\(?[A-Ea-e][\)\.\-:]|\(?\d{1,2}[\)\.]\s|[•\-–*]\s)/;
    lines.forEach((line) => {
      if (!line.trim()) { if (out.length && out[out.length - 1] !== '') out.push(''); return; }
      const prev = out.length ? out[out.length - 1] : '';
      if (prev === '' || optionStart.test(line) || /[.?!:;]$/.test(prev.trim())) { out.push(line.trim()); return; }
      if (/[a-zà-ú]-$/.test(prev) && /^[a-zà-ú]/.test(line.trim())) { out[out.length - 1] = prev.slice(0, -1) + line.trim(); return; }
      out[out.length - 1] = prev + ' ' + line.trim();
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function runOcr(source, onStatus) {
    progressCb = (m) => {
      if (m.status === 'recognizing text') onStatus(`Lendo o texto… ${Math.round((m.progress || 0) * 100)}%`);
      else if (/loading|initializ/.test(m.status || '')) onStatus('Preparando o leitor (baixa só na 1ª vez)…');
    };
    onStatus('Preparando o leitor (baixa só na 1ª vez)…');
    return Promise.all([getWorker(), toOcrCanvas(source)])
      .then(([worker, canvas]) => worker.recognize(canvas))
      .then((res) => cleanOcrText(res && res.data ? res.data.text : ''));
  }

  Object.assign(SC, { resizeImageFile, runOcr });
})();
