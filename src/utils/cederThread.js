// Cede a thread principal sem depender de timers/animation frames.
// Em aba oculta o Chrome pausa requestAnimationFrame e limita setTimeout a
// 1x/s (1x/min após ~5 min), o que congelava auditoria/simulação ao trocar de
// aba. Mensagens de MessageChannel não sofrem esse estrangulamento.
let canal = null;
const pendentes = [];

function garantirCanal() {
  if (canal || typeof MessageChannel === 'undefined') return;
  canal = new MessageChannel();
  canal.port1.onmessage = () => {
    const resolve = pendentes.shift();
    if (resolve) resolve();
  };
}

export function cederThread() {
  garantirCanal();
  if (!canal) return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    pendentes.push(resolve);
    canal.port2.postMessage(0);
  });
}

// Espera curta que não congela em segundo plano: se a aba está oculta, não
// espera (o intervalo existia só para a UI respirar).
export function esperarLeve(ms) {
  if (typeof document !== 'undefined' && document.hidden) return cederThread();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
