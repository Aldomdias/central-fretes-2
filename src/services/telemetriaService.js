// Telemetria de consumo: cada navegador logado mede o proprio consumo (rede, CPU, RAM,
// tempo online/ativo) e grava no Supabase em blocos, para a gestao ver no modulo
// "Consumo do Sistema" quem/qual tela/qual processo esta puxando mais.
//
// Custo pensado para ser desprezivel: contadores em memoria, 1 update de sessao por
// minuto e 1 insert por tela a cada 5 min. Nunca quebra a tela se falhar.
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const INTERVALO_SINAL_MS = 60 * 1000;
const INTERVALO_ENVIO_MS = 5 * 60 * 1000;
const INTERVALO_AMOSTRA_RAM_MS = 15 * 1000;
const OCIOSO_APOS_MS = 2 * 60 * 1000;
const CHAVE_PENDENTE = 'central_fretes_telemetria_pendente';
const CHAVE_SESSAO_ABA = 'central_fretes_telemetria_sessao';

let iniciado = false;
let usuario = null;
let sessaoId = null;
let pagina = { chave: '', label: '' };
let ultimaInteracao = Date.now();
let ultimoTick = Date.now();
let segundosAtivo = 0;
let segundosOcioso = 0;
let segundosOculto = 0;
let picoHeapMb = 0;
let timers = [];
let fetchOriginal = null;
let sessaoCriada = false;
let sessaoIniciadaEm = null; // relogio do navegador (o do servidor pode estar adiantado)
const blocos = new Map(); // pagina -> bloco acumulado
const processosAtivos = new Set();

function agoraIso() { return new Date().toISOString(); }

function gerarUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
  });
}

export function heapAtualMb() {
  const mem = typeof performance !== 'undefined' ? performance.memory : null;
  if (!mem?.usedJSHeapSize) return null;
  return Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10;
}

function limiteHeapMb() {
  const mem = typeof performance !== 'undefined' ? performance.memory : null;
  return mem?.jsHeapSizeLimit ? Math.round(mem.jsHeapSizeLimit / 1048576) : null;
}

function novoBloco(chave, label) {
  return {
    pagina: chave, pagina_label: label, inicio_em: agoraIso(), segundos_ativo: 0,
    requisicoes: 0, leituras: 0, escritas: 0, bytes_recebidos: 0, bytes_enviados: 0,
    ms_rede: 0, ms_cpu_travada: 0, tarefas_longas: 0, heap_soma: 0, heap_n: 0, heap_mb_max: 0,
    erros: 0, timeouts: 0, tabelas: {},
  };
}

function blocoAtual() {
  const chave = pagina.chave || '';
  if (!blocos.has(chave)) blocos.set(chave, novoBloco(chave, pagina.label || chave));
  return blocos.get(chave);
}

// /rest/v1/realizado_local_ctes?select=... -> "realizado_local_ctes"; /rest/v1/rpc/fn -> "rpc:fn"
export function classificarUrl(url) {
  let caminho = '';
  try { caminho = new URL(url, window.location.href).pathname; } catch { caminho = String(url || ''); }
  let m = caminho.match(/\/rest\/v1\/rpc\/([^/?]+)/);
  if (m) return `rpc:${m[1]}`;
  m = caminho.match(/\/rest\/v1\/([^/?]+)/);
  if (m) return m[1];
  m = caminho.match(/\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/?]+)/);
  if (m) return `storage:${m[1]}`;
  m = caminho.match(/\/functions\/v1\/([^/?]+)/);
  if (m) return `funcao:${m[1]}`;
  if (/\/auth\/v1\//.test(caminho)) return 'auth';
  if (/\/realtime\/v1\//.test(caminho)) return 'realtime';
  m = caminho.match(/^\/api\/([^/?]+)/);
  if (m) return `api:${m[1]}`;
  return null;
}

function tamanhoCorpo(body) {
  if (!body) return 0;
  if (typeof body === 'string') return body.length;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof URLSearchParams) return body.toString().length;
  return 0;
}

function registrarRequisicao({ recurso, metodo, ms, recebidos, enviados, erro, timeout }) {
  const escrita = metodo !== 'GET' && metodo !== 'HEAD' && !recurso.startsWith('rpc:');
  const alvos = [blocoAtual(), ...processosAtivos];
  alvos.forEach((alvo) => {
    alvo.requisicoes += 1;
    if (escrita) alvo.escritas = (alvo.escritas || 0) + 1; else alvo.leituras = (alvo.leituras || 0) + 1;
    alvo.bytes_recebidos += recebidos;
    alvo.bytes_enviados += enviados;
    alvo.ms_rede += ms;
    if (erro) alvo.erros = (alvo.erros || 0) + 1;
    if (timeout) alvo.timeouts = (alvo.timeouts || 0) + 1;
  });
  const t = blocoAtual().tabelas;
  const item = t[recurso] || (t[recurso] = { n: 0, b: 0, s: 0, ms: 0, w: 0, e: 0, t: 0 });
  item.n += 1; item.b += recebidos; item.s += enviados; item.ms += ms;
  if (escrita) item.w += 1;
  if (erro) item.e += 1;
  if (timeout) item.t += 1;
  tocarRajada({ requisicoes: 1, recebidos, enviados, ms, recurso });
}

// Conta o tamanho da resposta lendo uma copia em pedacos (sem guardar o conteudo).
async function contarBytesResposta(resposta) {
  const cabecalho = Number(resposta.headers.get('content-length'));
  if (Number.isFinite(cabecalho) && cabecalho > 0) return cabecalho;
  if (!resposta.body || typeof resposta.clone !== 'function') return 0;
  try {
    const leitor = resposta.clone().body.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value?.byteLength || 0;
    }
    return total;
  } catch {
    return 0;
  }
}

function instalarMedidorFetch() {
  if (fetchOriginal || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  fetchOriginal = window.fetch.bind(window);
  window.fetch = function fetchComTelemetria(input, init) {
    const url = typeof input === 'string' ? input : (input?.url || String(input));
    const recurso = classificarUrl(url);
    // Nao mede a propria telemetria nem requisicoes fora do sistema.
    if (!usuario || !recurso || recurso.startsWith('telemetria_') || recurso.startsWith('rpc:telemetria_') || recurso === 'realtime') {
      return fetchOriginal(input, init);
    }
    const metodo = String(init?.method || input?.method || 'GET').toUpperCase();
    const enviados = tamanhoCorpo(init?.body);
    const inicio = performance.now();
    return fetchOriginal(input, init).then((resposta) => {
      const ms = Math.round(performance.now() - inicio);
      const erro = resposta.status >= 400;
      // Timeout do banco (57014) volta como 500 depois de ~8s; 504/408 vem do gateway.
      const timeout = resposta.status === 408 || resposta.status === 504
        || (resposta.status === 500 && ms >= 7500);
      contarBytesResposta(resposta).then((recebidos) => {
        registrarRequisicao({ recurso, metodo, ms, recebidos, enviados, erro, timeout });
      });
      return resposta;
    }, (falha) => {
      const ms = Math.round(performance.now() - inicio);
      const msg = String(falha?.message || falha || '');
      registrarRequisicao({ recurso, metodo, ms, recebidos: 0, enviados, erro: true, timeout: /timeout|abort/i.test(msg) });
      throw falha;
    });
  };
}

function instalarObservadorCpu() {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    const obs = new PerformanceObserver((lista) => {
      lista.getEntries().forEach((entrada) => {
        const ms = Math.round(entrada.duration || 0);
        [blocoAtual(), ...processosAtivos].forEach((alvo) => {
          alvo.ms_cpu_travada += ms;
          alvo.tarefas_longas = (alvo.tarefas_longas || 0) + 1;
        });
        tocarRajada({ cpu: ms });
      });
    });
    obs.observe({ type: 'longtask', buffered: false });
  } catch { /* navegador sem suporte a longtask (Firefox/Safari): segue sem CPU */ }
}

// ---------- Rajadas automaticas ----------
// Qualquer acao de tela que puxe muito (sem pausa de 8s) vira um "processo" TELA,
// mesmo sem ninguem ter instrumentado aquela funcao. Se um processo nomeado estava
// aberto no mesmo periodo, a rajada e descartada (ele ja mede).
const RAJADA_PAUSA_MS = 8000;
let rajada = null;

function tocarRajada({ requisicoes = 0, recebidos = 0, enviados = 0, ms = 0, cpu = 0, recurso = null }) {
  const agora = Date.now();
  if (rajada && agora - rajada.ultima > RAJADA_PAUSA_MS) finalizarRajada();
  if (!rajada) {
    rajada = {
      pagina: pagina.label || pagina.chave, inicio: agora, ultima: agora, iniciado_em: agoraIso(),
      requisicoes: 0, bytes_recebidos: 0, bytes_enviados: 0, ms_rede: 0, ms_cpu_travada: 0,
      heap_mb_inicio: heapAtualMb(), heap_mb_pico: heapAtualMb() || 0, coberta: false, tabelas: {},
    };
  }
  rajada.ultima = agora;
  rajada.requisicoes += requisicoes;
  rajada.bytes_recebidos += recebidos;
  rajada.bytes_enviados += enviados;
  rajada.ms_rede += ms;
  rajada.ms_cpu_travada += cpu;
  if (processosAtivos.size) rajada.coberta = true;
  if (recurso) rajada.tabelas[recurso] = (rajada.tabelas[recurso] || 0) + recebidos;
}

function rajadaRelevante(r) {
  const duracao = r.ultima - r.inicio;
  return r.ms_cpu_travada >= 5000 || r.bytes_recebidos >= 30 * 1048576
    || (duracao >= 20000 && (r.ms_cpu_travada >= 2000 || r.bytes_recebidos >= 10 * 1048576 || r.requisicoes >= 150));
}

function finalizarRajada() {
  const r = rajada;
  rajada = null;
  if (!r || r.coberta || !usuario || semTabela || !rajadaRelevante(r)) return;
  const topTabelas = Object.entries(r.tabelas).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([tabela, bytes]) => ({ tabela, bytes }));
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const heapFim = heapAtualMb();
  supabase.from('telemetria_processos').insert({
    sessao_id: sessaoId,
    usuario_id: String(usuario.id),
    usuario_nome: usuario.nome || usuario.email || 'Usuário',
    pagina: r.pagina,
    tipo: 'TELA',
    titulo: `Ação pesada em ${r.pagina || 'tela'}${topTabelas[0] ? ` (${topTabelas[0].tabela})` : ''}`.slice(0, 300),
    status: 'CONCLUIDO',
    iniciado_em: r.iniciado_em,
    finalizado_em: new Date(r.ultima).toISOString(),
    duracao_ms: Math.max(0, r.ultima - r.inicio),
    itens: 0,
    requisicoes: r.requisicoes,
    bytes_recebidos: r.bytes_recebidos,
    bytes_enviados: r.bytes_enviados,
    ms_rede: r.ms_rede,
    ms_cpu_travada: r.ms_cpu_travada,
    heap_mb_inicio: r.heap_mb_inicio,
    heap_mb_fim: heapFim,
    heap_mb_pico: Math.max(r.heap_mb_pico || 0, heapFim || 0) || null,
    metadados: { automatico: true, tabelas: topTabelas },
  }).then(() => {}, () => {});
}

function verificarRajada() {
  if (rajada && Date.now() - rajada.ultima > RAJADA_PAUSA_MS) finalizarRajada();
}

function amostrarRam() {
  const heap = heapAtualMb();
  if (heap == null) return;
  if (heap > picoHeapMb) picoHeapMb = heap;
  const b = blocoAtual();
  b.heap_soma += heap; b.heap_n += 1;
  if (heap > b.heap_mb_max) b.heap_mb_max = heap;
  processosAtivos.forEach((p) => { if (heap > (p.heap_mb_pico || 0)) p.heap_mb_pico = heap; });
  if (rajada && heap > (rajada.heap_mb_pico || 0)) rajada.heap_mb_pico = heap;
}

function marcarInteracao() { ultimaInteracao = Date.now(); }

function contarTempo() {
  const agora = Date.now();
  const seg = Math.max(0, Math.round((agora - ultimoTick) / 1000));
  ultimoTick = agora;
  if (!seg || seg > 600) return; // aba suspensa/computador dormindo: nao conta como online
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    segundosOculto += seg;
  } else if (agora - ultimaInteracao <= OCIOSO_APOS_MS) {
    segundosAtivo += seg;
    blocoAtual().segundos_ativo += seg;
  } else {
    segundosOcioso += seg;
  }
}

function navegadorResumo() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const m = ua.match(/(Edg|OPR|Chrome|Firefox|Safari)\/(\d+)/);
  const nome = m ? ({ Edg: 'Edge', OPR: 'Opera' }[m[1]] || m[1]) : 'Outro';
  const so = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'Mac' : 'Outro';
  return `${nome} ${m?.[2] || ''} · ${so}`.trim();
}

async function enviarSinal(encerrar = false) {
  if (!usuario || !sessaoId) return;
  contarTempo();
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const base = {
    ultimo_sinal_em: agoraIso(),
    segundos_ativo: segundosAtivo,
    segundos_ocioso: segundosOcioso,
    segundos_oculto: segundosOculto,
    pagina_atual: pagina.label || pagina.chave,
    pico_heap_mb: picoHeapMb || null,
    ...(encerrar ? { encerrado_em: agoraIso() } : {}),
  };
  try {
    if (!sessaoCriada) {
      const { error } = await supabase.from('telemetria_sessoes').upsert({
        id: sessaoId,
        usuario_id: String(usuario.id),
        usuario_nome: usuario.nome || usuario.email || 'Usuário',
        usuario_email: usuario.email || '',
        perfil: usuario.perfil || '',
        iniciado_em: sessaoIniciadaEm || agoraIso(),
        limite_heap_mb: limiteHeapMb(),
        memoria_aparelho_gb: typeof navigator !== 'undefined' ? (navigator.deviceMemory || null) : null,
        nucleos_cpu: typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || null) : null,
        navegador: navegadorResumo(),
        versao_app: typeof __APP_VERSION__ !== 'undefined' ? String(__APP_VERSION__) : null, // eslint-disable-line no-undef
        ...base,
      });
      if (!error) sessaoCriada = true;
      else if (/relation|does not exist|schema cache/i.test(error.message)) pararPorFaltaDeTabela();
    } else {
      await supabase.from('telemetria_sessoes').update(base).eq('id', sessaoId);
    }
  } catch { /* telemetria nunca derruba a tela */ }
}

function montarLinhasUso() {
  const linhas = [];
  blocos.forEach((b) => {
    const temAlgo = b.requisicoes || b.ms_cpu_travada || b.segundos_ativo >= 30;
    if (!temAlgo) return;
    linhas.push({
      sessao_id: sessaoId,
      usuario_id: String(usuario.id),
      usuario_nome: usuario.nome || usuario.email || 'Usuário',
      pagina: b.pagina,
      pagina_label: b.pagina_label,
      inicio_em: b.inicio_em,
      fim_em: agoraIso(),
      segundos_ativo: b.segundos_ativo,
      requisicoes: b.requisicoes,
      leituras: b.leituras,
      escritas: b.escritas,
      bytes_recebidos: b.bytes_recebidos,
      bytes_enviados: b.bytes_enviados,
      ms_rede: b.ms_rede,
      ms_cpu_travada: b.ms_cpu_travada,
      tarefas_longas: b.tarefas_longas,
      heap_mb_max: b.heap_mb_max || null,
      heap_mb_medio: b.heap_n ? Math.round((b.heap_soma / b.heap_n) * 10) / 10 : null,
      erros: b.erros,
      timeouts: b.timeouts,
      tabelas: b.tabelas,
    });
  });
  blocos.clear();
  return linhas;
}

async function enviarUso() {
  if (!usuario || !sessaoId) return;
  contarTempo();
  const linhas = montarLinhasUso();
  let pendentes = [];
  try { pendentes = JSON.parse(localStorage.getItem(CHAVE_PENDENTE) || '[]'); } catch { pendentes = []; }
  const todas = [...(Array.isArray(pendentes) ? pendentes : []), ...linhas].slice(-200);
  if (!todas.length) return;
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const { error } = await supabase.from('telemetria_uso').insert(todas);
    if (error) throw error;
    try { localStorage.removeItem(CHAVE_PENDENTE); } catch { /* sem localStorage */ }
  } catch (e) {
    if (/relation|does not exist|schema cache/i.test(String(e?.message))) { pararPorFaltaDeTabela(); return; }
    try { localStorage.setItem(CHAVE_PENDENTE, JSON.stringify(todas)); } catch { /* sem localStorage */ }
  }
}

// Fechou a aba: guarda o que nao foi enviado para mandar na proxima abertura.
function guardarPendenteAoSair() {
  if (!usuario) return;
  contarTempo();
  const linhas = montarLinhasUso();
  try {
    const antes = JSON.parse(localStorage.getItem(CHAVE_PENDENTE) || '[]');
    localStorage.setItem(CHAVE_PENDENTE, JSON.stringify([...(Array.isArray(antes) ? antes : []), ...linhas].slice(-200)));
  } catch { /* sem localStorage */ }
  void enviarSinal(true);
}

let semTabela = false;
function pararPorFaltaDeTabela() {
  if (semTabela) return;
  semTabela = true;
  console.info('[Telemetria] Tabelas de telemetria ainda nao existem no banco (migration pendente). Coleta pausada.');
  timers.forEach((t) => window.clearInterval(t));
  timers = [];
}

export function iniciarTelemetria(sessao) {
  if (!isSupabaseConfigured() || typeof window === 'undefined' || !sessao?.id) return;
  if (iniciado && usuario?.id === sessao.id) return;
  if (iniciado) encerrarTelemetria();
  iniciado = true;
  semTabela = false;
  usuario = { id: sessao.id, nome: sessao.nome, email: sessao.email, perfil: sessao.perfil };
  // Mesma aba recarregada (F5) continua a mesma sessao.
  try {
    const salvo = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO_ABA) || 'null');
    sessaoId = salvo?.usuarioId === sessao.id && salvo?.id ? salvo.id : gerarUuid();
    sessionStorage.setItem(CHAVE_SESSAO_ABA, JSON.stringify({ id: sessaoId, usuarioId: sessao.id }));
  } catch { sessaoId = gerarUuid(); }
  sessaoCriada = false;
  sessaoIniciadaEm = agoraIso();
  segundosAtivo = 0; segundosOcioso = 0; segundosOculto = 0; picoHeapMb = 0;
  ultimoTick = Date.now(); ultimaInteracao = Date.now();

  instalarMedidorFetch();
  instalarObservadorCpu();
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, marcarInteracao, { passive: true }));
  window.addEventListener('mousemove', marcarInteracao, { passive: true });
  window.addEventListener('pagehide', guardarPendenteAoSair);
  document.addEventListener('visibilitychange', contarTempo);

  timers.push(window.setInterval(amostrarRam, INTERVALO_AMOSTRA_RAM_MS));
  timers.push(window.setInterval(verificarRajada, 4000));
  timers.push(window.setInterval(() => void enviarSinal(), INTERVALO_SINAL_MS));
  timers.push(window.setInterval(() => void enviarUso(), INTERVALO_ENVIO_MS));
  amostrarRam();
  void enviarSinal();
  // Envia o que ficou guardado da ultima vez (aba fechada antes do envio).
  window.setTimeout(() => void enviarUso(), 20000);
}

export function definirPaginaTelemetria(chave, label) {
  if (!iniciado) { pagina = { chave: chave || '', label: label || chave || '' }; return; }
  contarTempo();
  finalizarRajada();
  pagina = { chave: chave || '', label: label || chave || '' };
}

export function encerrarTelemetria() {
  if (!iniciado) return;
  finalizarRajada();
  void enviarUso();
  void enviarSinal(true);
  timers.forEach((t) => window.clearInterval(t));
  timers = [];
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'].forEach((ev) => window.removeEventListener(ev, marcarInteracao));
  window.removeEventListener('pagehide', guardarPendenteAoSair);
  document.removeEventListener('visibilitychange', contarTempo);
  try { sessionStorage.removeItem(CHAVE_SESSAO_ABA); } catch { /* sem sessionStorage */ }
  iniciado = false;
  usuario = null;
  sessaoId = null;
}

// ---------- Processos pesados ----------
// Uso: const p = iniciarProcessoTelemetria('AUDITORIA_CTE', 'Auditoria mes 10', { itens: 5000 });
//      ... p.itens(n) ... await p.finalizar('CONCLUIDO')
// Tudo que acontecer de rede/CPU/RAM enquanto ele estiver aberto entra na conta dele.
export function iniciarProcessoTelemetria(tipo, titulo, { itens = 0, metadados = {} } = {}) {
  const heap = heapAtualMb();
  const proc = {
    tipo: String(tipo || 'OUTRO'), titulo: titulo || '', itens: Number(itens) || 0, metadados,
    pagina: pagina.label || pagina.chave, iniciado_em: agoraIso(), t0: performance.now(),
    requisicoes: 0, bytes_recebidos: 0, bytes_enviados: 0, ms_rede: 0, ms_cpu_travada: 0,
    heap_mb_inicio: heap, heap_mb_pico: heap || 0, finalizado: false,
  };
  const ativo = Boolean(usuario);
  if (ativo) processosAtivos.add(proc);
  return {
    itens(n) { if (Number.isFinite(Number(n))) proc.itens = Number(n); },
    metadados(extra) { proc.metadados = { ...proc.metadados, ...(extra || {}) }; },
    async finalizar(status = 'CONCLUIDO', erro = null) {
      if (proc.finalizado) return;
      proc.finalizado = true;
      processosAtivos.delete(proc);
      if (!ativo || !usuario) return;
      const heapFim = heapAtualMb();
      const supabase = getSupabaseClient();
      if (!supabase || semTabela) return;
      try {
        await supabase.from('telemetria_processos').insert({
          sessao_id: sessaoId,
          usuario_id: String(usuario.id),
          usuario_nome: usuario.nome || usuario.email || 'Usuário',
          pagina: proc.pagina,
          tipo: proc.tipo,
          titulo: String(proc.titulo || '').slice(0, 300),
          status,
          iniciado_em: proc.iniciado_em,
          finalizado_em: agoraIso(),
          duracao_ms: Math.round(performance.now() - proc.t0),
          itens: proc.itens,
          requisicoes: proc.requisicoes,
          bytes_recebidos: proc.bytes_recebidos,
          bytes_enviados: proc.bytes_enviados,
          ms_rede: proc.ms_rede,
          ms_cpu_travada: proc.ms_cpu_travada,
          heap_mb_inicio: proc.heap_mb_inicio,
          heap_mb_fim: heapFim,
          heap_mb_pico: Math.max(proc.heap_mb_pico || 0, heapFim || 0) || null,
          erro: erro ? String(erro).slice(0, 500) : null,
          metadados: proc.metadados || {},
        });
      } catch { /* telemetria nunca derruba a tela */ }
    },
  };
}

export async function medirProcesso(tipo, titulo, executor, opcoes = {}) {
  const p = iniciarProcessoTelemetria(tipo, titulo, opcoes);
  try {
    const resultado = await executor(p);
    await p.finalizar('CONCLUIDO');
    return resultado;
  } catch (e) {
    await p.finalizar('ERRO', e?.message || String(e));
    throw e;
  }
}

// ---------- Leitura (tela de gestao) ----------
export async function carregarPainelTelemetria({ desde, ate = null, usuarioId = null }) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.rpc('telemetria_painel', {
    p_desde: desde,
    p_ate: ate || new Date().toISOString(),
    p_usuario: usuarioId || null,
  });
  if (error) throw new Error(error.message);
  return data || {};
}

export async function carregarArmazenamentoTelemetria() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.rpc('telemetria_armazenamento');
  if (error) throw new Error(error.message);
  return data || {};
}

export async function limparTelemetriaAntiga(dias = 90) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.rpc('telemetria_limpar_antigos', { p_dias: dias });
  if (error) throw new Error(error.message);
  return data || 0;
}

// Resumo instantaneo desta aba (para depurar sem esperar o envio).
export function resumoLocalTelemetria() {
  return { sessaoId, pagina, segundosAtivo, segundosOcioso, segundosOculto, picoHeapMb, blocos: [...blocos.values()], processos: processosAtivos.size };
}
