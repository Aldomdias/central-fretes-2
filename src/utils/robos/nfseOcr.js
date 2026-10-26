// OCR (tesseract.js) para PDFs de NFS-e sem texto: a pagina e desenhada num canvas e lida no
// proprio navegador. Os arquivos do motor ficam em /ocr (public), sem depender de CDN.

let promessaWorker = null;

async function obterWorker() {
  if (!promessaWorker) {
    promessaWorker = (async () => {
      const { createWorker } = await import('tesseract.js');
      const base = `${window.location.origin}/ocr`;
      return createWorker('por', 1, {
        workerPath: `${base}/worker.min.js`,
        corePath: `${base}/core`,
        langPath: `${base}/lang`,
        gzip: true,
        workerBlobURL: false,
        logger: () => {},
      });
    })().catch((e) => { promessaWorker = null; throw e; });
  }
  return promessaWorker;
}

// Desenha a pagina do PDF (escala 3 = boa leitura) e devolve as linhas de texto reconhecidas.
export async function ocrDaPagina(pdf, n) {
  const pagina = await pdf.getPage(n);
  const viewport = pagina.getViewport({ scale: 3 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pagina.render({ canvasContext: ctx, viewport }).promise;
  const worker = await obterWorker();
  const { data } = await worker.recognize(canvas);
  return String(data.text || '').split('\n').filter((l) => l.trim() !== '');
}

export async function encerrarOcr() {
  if (!promessaWorker) return;
  const w = await promessaWorker.catch(() => null);
  promessaWorker = null;
  if (w) await w.terminate();
}
