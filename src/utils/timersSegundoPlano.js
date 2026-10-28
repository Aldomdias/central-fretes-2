// Mantem robos, simulacoes e auditorias andando com a aba em segundo plano.
// Em aba oculta o Chrome limita setTimeout a 1x/s (e 1x/min apos ~5 min), o que deixava tudo
// muito lento ao trocar de aba ou bloquear a tela. Timers de Web Worker nao sao estrangulados:
// enquanto a aba estiver oculta, setTimeout/setInterval passam a ser cronometrados por um worker
// (o callback continua rodando na thread principal). Com a aba visivel nada muda.
let worker = null;
let tentou = false;
let seq = 0;
const pendentes = new Map(); // id -> { cb, repetir, ms }

function obterWorker() {
  if (worker || tentou) return worker;
  tentou = true;
  try {
    const codigo = 'const t=new Map();onmessage=function(e){var d=e.data;if(d.op==="s"){t.set(d.id,setTimeout(function(){t.delete(d.id);postMessage(d.id)},d.ms))}else{clearTimeout(t.get(d.id));t.delete(d.id)}}';
    const url = URL.createObjectURL(new Blob([codigo], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = (e) => {
      const item = pendentes.get(e.data);
      if (!item) return;
      if (item.repetir) worker.postMessage({ op: 's', id: e.data, ms: item.ms });
      else pendentes.delete(e.data);
      try { item.cb(); } catch (erro) { setTimeout(() => { throw erro; }, 0); }
    };
    worker.onerror = () => { worker = null; };
  } catch {
    worker = null;
  }
  return worker;
}

export function instalarTimersSegundoPlano() {
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || window.__timersSegundoPlano) return;
  window.__timersSegundoPlano = true;
  const nativoSet = window.setTimeout.bind(window);
  const nativoClear = window.clearTimeout.bind(window);
  const nativoSetInt = window.setInterval.bind(window);
  const nativoClearInt = window.clearInterval.bind(window);

  const agendar = (cb, ms, args, repetir) => {
    const w = obterWorker();
    const delay = Math.max(0, Number(ms) || 0);
    const id = -(++seq);
    pendentes.set(id, { cb: () => cb(...args), repetir, ms: delay });
    w.postMessage({ op: 's', id, ms: delay });
    return id;
  };
  const cancelar = (id, nativo) => {
    if (typeof id === 'number' && id < 0) {
      if (pendentes.delete(id)) worker?.postMessage({ op: 'c', id });
      return;
    }
    nativo(id);
  };
  const usarWorker = (cb) => typeof cb === 'function' && typeof document !== 'undefined' && document.hidden && obterWorker();

  window.setTimeout = (cb, ms, ...args) => (usarWorker(cb) ? agendar(cb, ms, args, false) : nativoSet(cb, ms, ...args));
  window.setInterval = (cb, ms, ...args) => (usarWorker(cb) ? agendar(cb, ms, args, true) : nativoSetInt(cb, ms, ...args));
  window.clearTimeout = (id) => cancelar(id, nativoClear);
  window.clearInterval = (id) => cancelar(id, nativoClearInt);
}
