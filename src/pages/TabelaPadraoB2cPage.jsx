import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import BaseCtesStatus from '../components/BaseCtesStatus';
import { buscarBaseSimulacaoPorRotasDb, carregarBaseFiltradaPorCidadesOrigemDb, carregarMunicipiosIbgeDb, listarTransportadorasPorCidadesOrigemDb } from '../services/freteDatabaseService';
import { normalizarTransportadoras, processarCte } from '../services/auditoriaCteProcessamentoService';
import { categoriaCanalRealizado, montarMapasIbge, resolverIbgeLocal } from '../utils/realizadoLocalEngine';
import { filtrarCpComercialCte } from '../services/cteBasePolicy';
import { resolverPesoCteRealizado } from '../utils/pesoRealizadoSimulador';
import { carregarMunicipiosIbgeOficial } from '../utils/ibgeMunicipiosOficial';
import { exportarExcelFormatado } from '../utils/exportarExcelFormatado';
import { montarXlsxVerum } from '../utils/verumXlsx';
import { zipSync } from 'fflate';
import {
  CDS_B2C, FAIXAS_PADRAO_TEXTO, cdDaCidade, faixaDoPeso, montarTabelaPadrao, normTexto, parseFaixas, tabelaPorTransportadora,
} from '../utils/tabelaPadraoB2c';

const LIMITE_MAX_CT = 200000;
const CHAVES_CDS_BLACK = new Set(['ITAJAI', 'ITUPEVA', 'DUQUE DE CAXIAS', 'JABOATAO', 'SERRA', 'CONTAGEM']);
const CDS_BLACK = CDS_B2C.filter((cd) => CHAVES_CDS_BLACK.has(cd.chave));
const CHECKPOINT_DB = 'central-fretes-tabela-black';
const CHECKPOINT_VERSION = 1;

function abrirCheckpointDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CHECKPOINT_DB, CHECKPOINT_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('execucoes')) db.createObjectStore('execucoes', { keyPath: 'chave' });
      if (!db.objectStoreNames.contains('lotes')) {
        const store = db.createObjectStore('lotes', { keyPath: 'id' });
        store.createIndex('porExecucao', 'chave', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function carregarCheckpoint(chave, configuracao) {
  if (!('indexedDB' in window)) return null;
  const db = await abrirCheckpointDb();
  try {
    const meta = await idbReq(db.transaction('execucoes').objectStore('execucoes').get(chave));
    if (!meta || meta.configuracao !== configuracao) return null;
    const tx = db.transaction('lotes');
    const lotes = await idbReq(tx.objectStore('lotes').index('porExecucao').getAll(chave));
    lotes.sort((a, b) => a.indice - b.indice);
    return { meta, lotes };
  } finally { db.close(); }
}

async function salvarCheckpoint(chave, configuracao, indice, ctes, totais) {
  if (!('indexedDB' in window)) return;
  const db = await abrirCheckpointDb();
  try {
    const tx = db.transaction(['execucoes', 'lotes'], 'readwrite');
    tx.objectStore('lotes').put({ id: `${chave}:${indice}`, chave, indice, ctes });
    tx.objectStore('execucoes').put({ chave, configuracao, ultimoIndice: indice, atualizadoEm: Date.now(), ...totais });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  } finally { db.close(); }
}

// Última geração COMPLETA do CD salva neste navegador (mesmas faixas). É a base para refazer só uma transportadora.
async function ultimaExecucaoCompleta(cdChave, faixas) {
  if (!('indexedDB' in window)) return null;
  const faixasCfg = JSON.stringify(faixas.map((f) => [f.min, Number.isFinite(f.max) ? f.max : 'inf']));
  const db = await abrirCheckpointDb();
  try {
    const metas = await idbReq(db.transaction('execucoes').objectStore('execucoes').getAll());
    const candidatas = (metas || []).map((m) => {
      let cfg = null;
      try { cfg = JSON.parse(m.configuracao); } catch { return null; }
      if (!cfg || cfg.cdEscolhido !== cdChave || JSON.stringify(cfg.faixas) !== faixasCfg) return null;
      if (!(m.totalMunicipios > 0) || m.ultimoIndice + 1 < m.totalMunicipios) return null;
      return { meta: m, cfg };
    }).filter(Boolean).sort((a, b) => (b.meta.atualizadoEm || 0) - (a.meta.atualizadoEm || 0));
    const escolhida = candidatas[0];
    if (!escolhida) return null;
    const lotes = await idbReq(db.transaction('lotes').objectStore('lotes').index('porExecucao').getAll(escolhida.meta.chave));
    lotes.sort((a, b) => a.indice - b.indice);
    return { ...escolhida, lotes };
  } finally { db.close(); }
}

// Regrava os lotes de uma execução (depois de refazer uma transportadora), mantendo a mesma chave.
async function regravarExecucao(meta, lotes, extras = {}) {
  const db = await abrirCheckpointDb();
  try {
    const tx = db.transaction(['execucoes', 'lotes'], 'readwrite');
    const store = tx.objectStore('lotes');
    for (const lote of lotes) store.put(lote);
    tx.objectStore('execucoes').put({ ...meta, ...extras, atualizadoEm: Date.now() });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  } finally { db.close(); }
}

function chaveCheckpoint(configuracao) {
  let hash = 2166136261;
  for (let i = 0; i < configuracao.length; i++) { hash ^= configuracao.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `black-b2c-${(hash >>> 0).toString(16)}`;
}

function safeNum(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function fmt(v) { return safeNum(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function fmtN(v) { return safeNum(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function dig7(v) { return String(v || '').replace(/\D/g, '').slice(0, 7); }
function normBusca(texto) { return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
function cidadeBate(cidadeTabelaNorm, cidadeCteNorm) {
  if (!cidadeCteNorm) return true;
  if (!cidadeTabelaNorm) return false;
  return cidadeTabelaNorm === cidadeCteNorm
    || (cidadeTabelaNorm.length >= 5 && cidadeCteNorm.includes(cidadeTabelaNorm))
    || (cidadeCteNorm.length >= 5 && cidadeTabelaNorm.includes(cidadeCteNorm));
}
function cubagemDe(cte) {
  for (const campo of ['cubagem', 'cubagem_total', 'cubagemTotal', 'cubagem_m3']) {
    const v = safeNum(cte[campo]);
    if (v > 0) return v;
  }
  return 0;
}
function canalRealDe(cte) {
  return cte.canal_original && normTexto(cte.canal) === 'A DEFINIR'
    ? cte.canal_original
    : (cte.canal || cte.canal_original || '');
}

function montarMunicipioPorCidade(municipios = []) {
  const mapa = new Map();
  for (const item of (municipios || [])) {
    const ibge = dig7(item.ibge || item.codigo_ibge || item.codigo);
    const cidade = item.cidade || item.nome || item.municipio || '';
    const uf = item.uf || item.estado || '';
    if (!ibge || !cidade) continue;
    const kCidade = normBusca(cidade);
    const kCidadeUf = normBusca(`${cidade}/${uf}`);
    if (kCidade && !mapa.has(kCidade)) mapa.set(kCidade, ibge);
    if (kCidadeUf && !mapa.has(kCidadeUf)) mapa.set(kCidadeUf, ibge);
  }
  return mapa;
}
function ibgeDoCte(cte, tipo, municipioPorCidade, mapasIbge) {
  const direto = dig7(tipo === 'origem'
    ? (cte.ibge_corrigido_origem || cte.ibge_origem || cte.ibgeOrigem)
    : (cte.ibge_corrigido_destino || cte.ibge_destino || cte.ibgeDestino));
  if (direto) return direto;
  const cidade = tipo === 'origem' ? (cte.cidade_origem || cte.origem || '') : (cte.cidade_destino || cte.destino || '');
  const uf = tipo === 'origem' ? (cte.uf_origem || '') : (cte.uf_destino || '');
  const viaPlanilha = municipioPorCidade.get(normBusca(`${cidade}/${uf}`)) || municipioPorCidade.get(normBusca(cidade));
  if (viaPlanilha) return viaPlanilha;
  return resolverIbgeLocal(cidade, uf, mapasIbge) || '';
}

function montarRouteKeys(ctes, canalFiltro) {
  const keys = new Set();
  const canalKey = categoriaCanalRealizado(canalFiltro) || canalFiltro;
  for (const c of ctes) keys.add(`${canalKey}|${c.ibgeOrigem}-${c.ibgeDestino}`);
  return Array.from(keys);
}

function indexarBase(base) {
  const porOrigemIbge = new Map();
  const porDestinoIbge = new Map();
  const origensCidade = [];
  const vistos = new Set();
  for (const t of base) {
    for (const origem of (t.origens || [])) {
      const cidadeNorm = origem.__cidadeNorm || normTexto(origem.cidade);
      const ck = `${t.nome}|${cidadeNorm}`;
      if (cidadeNorm && !vistos.has(ck)) { vistos.add(ck); origensCidade.push({ cidadeNorm, nome: t.nome }); }
      for (const rota of (origem.rotas || [])) {
        const io = dig7(rota.ibgeOrigem);
        if (io) { if (!porOrigemIbge.has(io)) porOrigemIbge.set(io, new Set()); porOrigemIbge.get(io).add(t.nome); }
        const id = dig7(rota.ibgeDestino);
        if (id) { if (!porDestinoIbge.has(id)) porDestinoIbge.set(id, new Set()); porDestinoIbge.get(id).add(t.nome); }
      }
    }
  }
  return { porOrigemIbge, porDestinoIbge, origensCidade };
}
function nomesPorOrigem(idx, ibgeOrigem7, cidadeCteNorm, cache) {
  const key = `${ibgeOrigem7}|${cidadeCteNorm}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const set = new Set(idx.porOrigemIbge.get(ibgeOrigem7) || []);
  for (const o of idx.origensCidade) {
    if (!set.has(o.nome) && cidadeBate(o.cidadeNorm, cidadeCteNorm)) set.add(o.nome);
  }
  cache.set(key, set);
  return set;
}

const _unitariaCache = new WeakMap();
// Todas as entradas da base com o mesmo nome (principal + alternativas), num array estável por nome.
function baseUnitaria(transp, base) {
  let porNome = _unitariaCache.get(base);
  if (!porNome) {
    porNome = new Map();
    for (const t of base) { const a = porNome.get(t.nome); if (a) a.push(t); else porNome.set(t.nome, [t]); }
    _unitariaCache.set(base, porNome);
  }
  return porNome.get(transp.nome) || [transp];
}

// Municípios diferentes frequentemente apontam para a mesma cotação/regra tarifária.
// Esta assinatura remove apenas identificadores geográficos/técnicos e preserva tudo
// que pode alterar preço ou prazo, permitindo calcular uma vez e replicar com segurança.
function assinaturaTarifariaDestino(destinoIbge, ufDestino, candidatas, base, cd) {
  // Nome da rota/cotação e IDs servem para localizar a regra, mas não alteram o
  // resultado depois que as linhas tarifárias correspondentes já foram reunidas.
  const omitir = /(^id$|_id$|Id$|created|updated|ibgeDestino|ibge_destino|cidadeDestino|cidade_destino|cepInicial|cepFinal|cep_inicial|cep_final|^cotacao$|^nomeRota$|^rota$|^nome$|^chave)/i;
  const limpar = (valor) => {
    if (Array.isArray(valor)) return valor.map(limpar);
    if (!valor || typeof valor !== 'object') return valor;
    return Object.fromEntries(Object.keys(valor).sort().filter((k) => !omitir.test(k)).map((k) => [k, limpar(valor[k])]));
  };
  const partes = candidatas.map((candidata) => {
    const tabelas = [];
    for (const transp of baseUnitaria(candidata, base)) {
      for (const origem of (transp.origens || [])) {
        if (!cdDaCidade(origem.cidade, [cd])) continue;
        const rotas = (origem.rotas || []).filter((r) => dig7(r.ibgeDestino) === destinoIbge);
        if (!rotas.length) continue;
        const nomesRota = new Set(rotas.flatMap((r) => [r.cotacao, r.nomeRota, r.rota].filter(Boolean).map(normTexto)));
        const cotacoes = (origem.cotacoes || []).filter((c) => nomesRota.has(normTexto(c.rota || c.nomeRota || c.cotacao)));
        const taxas = (origem.taxasEspeciais || []).filter((t) => dig7(t.ibgeDestino) === destinoIbge);
        tabelas.push({ rotas: limpar(rotas), cotacoes: limpar(cotacoes), taxas: limpar(taxas) });
      }
    }
    return [candidata.nome, tabelas];
  });
  return JSON.stringify([ufDestino, partes]);
}

// Preço de TODAS as tabelas que cobrem a rota do CT-e (nenhuma excluída), mais barato primeiro.
function simularTodas(cte, base, candidatas, ibgeOrigem, ibgeDestino, cidadeOrigem) {
  const canalReal = canalRealDe(cte);
  const cteBase = {
    ...cte,
    canal: canalReal, canal_original: canalReal,
    ibge_origem: ibgeOrigem, ibge_corrigido_origem: ibgeOrigem,
    ibge_destino: ibgeDestino, ibge_corrigido_destino: ibgeDestino,
  };
  const origemCmp = normTexto(cidadeOrigem);
  const resultados = [];
  for (const transp of candidatas) {
    let r;
    // Passa só a tabela da própria transportadora (array estável, p/ o cache do motor) e sem o comparativo de pesos:
    // aqui só interessa o valor calculado, e varrer a malha inteira a cada CT-e levava segundos por CT-e.
    try { r = processarCte({ ...cteBase, transportadora: transp.nome, nome_transportadora: transp.nome }, baseUnitaria(transp, base), null, '', { semComparativoPesos: true }); } catch { continue; }
    if (r.status_calculo !== 'CALCULADO') continue;
    if (!cidadeBate(normTexto(r.detalhes_calculo?.origem_cidade), origemCmp)) continue;
    const total = safeNum(r.valor_calculado);
    if (total <= 0) continue;
    resultados.push({ transportadora: transp.nome, total, prazo: safeNum(r.detalhes_calculo?.rota_prazo) });
  }
  resultados.sort((a, b) => a.total - b.total);
  return resultados;
}

function montarEspelhoRotasPorTransportadora(base, cd) {
  const porTransportadora = {};
  const vistos = new Map();
  for (const transportadora of base) {
    if (!porTransportadora[transportadora.nome]) porTransportadora[transportadora.nome] = [];
    if (!vistos.has(transportadora.nome)) vistos.set(transportadora.nome, new Set());
    const vistosTransp = vistos.get(transportadora.nome);
    for (const origem of (transportadora.origens || [])) {
      if (!cdDaCidade(origem.cidade, [cd])) continue;
      for (const rota of (origem.rotas || [])) {
        const ibgeDestino = dig7(rota.ibgeDestino);
        if (!ibgeDestino) continue;
        const canalBruto = normTexto(rota.canal || origem.canal || '');
        const item = {
          ibgeOrigem: dig7(rota.ibgeOrigem),
          ibgeDestino,
          cepInicial: String(rota.cepInicial || '').replace(/\D/g, '').slice(0, 8),
          cepFinal: String(rota.cepFinal || '').replace(/\D/g, '').slice(0, 8),
          prazo: safeNum(rota.prazoEntregaDias),
          metodoEnvio: rota.metodoEnvio || 'Normal',
          codigoUnidade: rota.codigoUnidade || '0001 - B2C',
          _canalB2c: !canalBruto || canalBruto.includes('AMBOS') || categoriaCanalRealizado(canalBruto) === 'B2C',
        };
        const chave = [item.ibgeOrigem, item.ibgeDestino, item.cepInicial, item.cepFinal, item.prazo, item.metodoEnvio, item.codigoUnidade, canalBruto].join('|');
        if (vistosTransp.has(chave)) continue;
        vistosTransp.add(chave);
        porTransportadora[transportadora.nome].push(item);
      }
    }
  }
  for (const nome of Object.keys(porTransportadora)) {
    const todas = porTransportadora[nome];
    const b2c = todas.filter((r) => r._canalB2c);
    porTransportadora[nome] = (b2c.length ? b2c : todas).map(({ _canalB2c, ...rota }) => rota);
  }
  return porTransportadora;
}

async function carregarCtes({ competencia, dataInicio, dataFim, ufOrigem, limite, onProgress }) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const supabase = getSupabaseClient();
  const teto = Math.max(100, Math.min(Number(limite) || 8000, LIMITE_MAX_CT));
  const acumulado = [];
  let from = 0;
  const PAGE = 1000;
  while (acumulado.length < teto) {
    let q = supabase.from('realizado_local_ctes').select('*').order('data_emissao', { ascending: false }).range(from, from + PAGE - 1);
    if (dataInicio || dataFim) {
      if (dataInicio) q = q.gte('data_emissao', dataInicio);
      if (dataFim) q = q.lte('data_emissao', dataFim);
    } else if (competencia) {
      q = q.eq('competencia', competencia);
    }
    q = q.or('canal_original.ilike.%B2C%,canal.ilike.%B2C%');
    if (ufOrigem) q = q.eq('uf_origem', ufOrigem);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao carregar CT-es: ${error.message}`);
    const lote = data || [];
    acumulado.push(...lote);
    onProgress?.(acumulado.length);
    if (lote.length < PAGE) break;
    from += PAGE;
  }
  return filtrarCpComercialCte(acumulado).slice(0, teto);
}

// Passo comum à geração completa e ao refazer de uma transportadora: IBGE, CT-es do CD,
// perfil médio por faixa, CT-e-molde e a malha nacional de destinos com a prioridade de volume.
async function carregarContextoCd({ competencia, dataInicio, dataFim, limiteInput, cdEscolhido, faixas, volumePrioritario, onProgresso }) {
  onProgresso('Carregando planilha de IBGE...');
  let municipios = await carregarMunicipiosIbgeDb().catch(() => []);
  if (!municipios.some((m) => m.mesorregiao)) {
    onProgresso('Carregando mesorregiões do IBGE...');
    const oficial = await carregarMunicipiosIbgeOficial().catch(() => ({ municipios: [] }));
    const mesoPorIbge = new Map((oficial.municipios || []).map((m) => [dig7(m.ibge), m.mesorregiao || '']));
    municipios = municipios.map((m) => ({ ...m, mesorregiao: mesoPorIbge.get(dig7(m.ibge)) || '' }));
  }
  const mapasIbge = montarMapasIbge(municipios);
  const municipioPorCidade = montarMunicipioPorCidade(municipios);

  onProgresso('Carregando CT-es B2C...');
  const todos = await carregarCtes({
    competencia, dataInicio: dataInicio || undefined, dataFim: dataFim || undefined,
    ufOrigem: CDS_BLACK.find((c) => c.chave === cdEscolhido)?.uf,
    limite: Number(limiteInput) || 8000, onProgress: (n) => onProgresso(`Carregando CT-es B2C... ${n}`),
  });
  const cds = CDS_BLACK.filter((c) => c.chave === cdEscolhido);
  const doCd = [];
  let semIbge = 0;
  for (const cte of todos) {
    const cidadeOrigem = cte.cidade_origem || cte.origem || '';
    const cd = cdDaCidade(cidadeOrigem, cds);
    if (!cd) continue;
    const ibgeOrigem = ibgeDoCte(cte, 'origem', municipioPorCidade, mapasIbge);
    const ibgeDestino = ibgeDoCte(cte, 'destino', municipioPorCidade, mapasIbge);
    if (!ibgeOrigem || !ibgeDestino) { semIbge += 1; continue; }
    const peso = safeNum(resolverPesoCteRealizado(cte));
    if (peso <= 0) continue;
    doCd.push({ cte, cd: cd.label, cidadeOrigem, ibgeOrigem, ibgeDestino, peso });
  }
  if (!doCd.length) throw new Error('Nenhum CT-e B2C do CD selecionado no recorte carregado.');

  // 1) Perfil médio por faixa de peso, tirado do realizado do CD: nota fiscal, peso e cubagem.
  onProgresso('Montando o perfil médio por faixa de peso...');
  const acum = new Map();
  let nfSoma = 0; let nfN = 0;
  for (const x of doCd) {
    const nf = safeNum(x.cte.valor_nf || x.cte.nf_venda);
    if (nf > 0) { nfSoma += nf; nfN += 1; }
    const f = faixaDoPeso(x.peso, faixas);
    if (!f) continue;
    const a = acum.get(f.min) || { n: 0, peso: 0, nf: 0, nfN: 0, cub: 0, cubN: 0 };
    a.n += 1; a.peso += x.peso;
    if (nf > 0) { a.nf += nf; a.nfN += 1; }
    const cub = cubagemDe(x.cte);
    if (cub > 0) { a.cub += cub; a.cubN += 1; }
    acum.set(f.min, a);
  }
  const nfGeral = nfN ? nfSoma / nfN : 0;
  const perfilDaFaixa = (faixa) => {
    const a = acum.get(faixa.min);
    if (a && a.n) return { peso: a.peso / a.n, nf: a.nfN ? a.nf / a.nfN : nfGeral, cub: a.cubN ? a.cub / a.cubN : 0 };
    return { peso: Number.isFinite(faixa.max) ? (faixa.min + faixa.max) / 2 : faixa.min * 1.25, nf: nfGeral, cub: 0 };
  };

  // CT-e-molde do CD (o de NF mediana): fornece os demais campos; peso, NF e cubagem vêm do perfil da faixa.
  const porNf = [...doCd].sort((a, b) => safeNum(a.cte.valor_nf || a.cte.nf_venda) - safeNum(b.cte.valor_nf || b.cte.nf_venda));
  const molde = porNf[Math.floor(porNf.length / 2)];

  // 3) Malha nacional: todos os municípios do IBGE. O histórico serve para priorizar
  // os destinos que acumulam o percentual de volume escolhido, nunca para cortar a saída.
  const infoIbge = new Map();
  for (const m of municipios) { const k = dig7(m.ibge || m.codigo_ibge || m.codigo); if (k) infoIbge.set(k, m); }
  const volumePorDestino = new Map();
  for (const x of doCd) volumePorDestino.set(dig7(x.ibgeDestino), (volumePorDestino.get(dig7(x.ibgeDestino)) || 0) + 1);

  const volumeTotal = Array.from(volumePorDestino.values()).reduce((s, n) => s + n, 0);
  const limiteVolume = Math.max(0, Math.min(100, safeNum(volumePrioritario))) / 100;
  let acumuladoVolume = 0;
  const perfilVolume = new Map();
  for (const [ibge, volume] of [...volumePorDestino.entries()].sort((a, b) => b[1] - a[1])) {
    const percentual = volumeTotal ? volume / volumeTotal : 0;
    acumuladoVolume += percentual;
    perfilVolume.set(ibge, {
      volume, percentual, acumulado: acumuladoVolume,
      classe: acumuladoVolume - percentual < limiteVolume ? 'nucleo_80' : 'cauda_20',
    });
  }

  const destinos = [];
  for (const [d, info] of infoIbge.entries()) {
    if (!info) continue;
    const ufD = String(info.uf || '').toUpperCase();
    const pv = perfilVolume.get(d) || { volume: 0, percentual: 0, acumulado: 0, classe: 'sem_historico' };
    destinos.push({ d, info, ufD, key: d, label: `${info.cidade}/${ufD}`, ...pv });
  }
  destinos.sort((a, b) => {
    const ordem = { nucleo_80: 0, cauda_20: 1, sem_historico: 2 };
    return ordem[a.classe] - ordem[b.classe] || b.volume - a.volume || a.ufD.localeCompare(b.ufD) || a.label.localeCompare(b.label, 'pt-BR');
  });
  if (!destinos.length) throw new Error('Nenhum destino das tabelas foi encontrado na planilha de IBGE.');
  const mesorregiaoPorIbge = Object.fromEntries(destinos.map((x) => [x.d, x.info.mesorregiao || `${x.ufD} - sem mesorregião`]));
  return {
    municipios, cds, todos, doCd, semIbge, acum, perfilDaFaixa, molde, destinos, mesorregiaoPorIbge,
  };
}

// CT-e sintético de um destino x faixa: campos do molde, peso/NF/cubagem do perfil da faixa.
function montarCteRef(molde, info, d, ufD, pf) {
  const cteRef = {
    ...molde.cte, cidade_destino: info.cidade, destino: info.cidade, uf_destino: ufD,
    ibge_destino: d, ibge_corrigido_destino: d, ibgeDestino: d,
    peso: pf.peso, peso_declarado: pf.peso, valor_nf: pf.nf, nf_venda: pf.nf,
  };
  for (const campo of Object.keys(cteRef)) if (/cubag|cubado/i.test(campo)) cteRef[campo] = 0;
  if (pf.cub > 0) { cteRef.cubagem = pf.cub; cteRef.cubagem_total = pf.cub; }
  return cteRef;
}

// CT-es reais entram só como volume e custo realizado (sem recalcular frete).
function ctesDeVolume(doCd) {
  return doCd.map((x) => {
    const ufD = String(x.cte.uf_destino || '').toUpperCase();
    const cidadeDestino = x.cte.cidade_destino || x.cte.destino || '';
    return {
      cd: x.cd, uf: ufD, peso: x.peso, destinoKey: dig7(x.ibgeDestino), destinoLabel: `${cidadeDestino}/${ufD}`,
      valorPago: safeNum(x.cte.valor_cte || x.cte.frete_pago || x.cte.valor_frete),
      resultados: [], apenasVolume: true,
    };
  });
}

const th = { textAlign: 'left', padding: '6px 8px', fontSize: '0.72rem', color: '#64748b', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', fontSize: '0.8rem', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' };

export default function TabelaPadraoB2cPage() {
  const [competencia, setCompetencia] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [limiteInput, setLimiteInput] = useState('8000');
  const [cdEscolhido, setCdEscolhido] = useState('ITUPEVA');
  const [faixasTexto, setFaixasTexto] = useState(FAIXAS_PADRAO_TEXTO);
  const granularidade = 'cidade';
  const [baseFirst, setBaseFirst] = useState('ponderado');
  const [posicoes, setPosicoes] = useState([{ peso: '60', acr: '0' }, { peso: '20', acr: '1' }, { peso: '10', acr: '2' }, { peso: '10', acr: '3' }]);
  const [passoExtra, setPassoExtra] = useState('1');
  const [maxPos, setMaxPos] = useState('10');
  const [volumePrioritario, setVolumePrioritario] = useState('80');
  const [amostraMin, setAmostraMin] = useState('3');

  const [status, setStatus] = useState('idle');
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const interromperRef = useRef(false);
  const [simulados, setSimulados] = useState(null); // { ctes, semIbge, totalLidos }
  const [filtroCd, setFiltroCd] = useState('');
  const [filtroTransp, setFiltroTransp] = useState('');
  const [filtroDestino, setFiltroDestino] = useState('');
  const [visao, setVisao] = useState('ranking');
  const [gerandoArquivos, setGerandoArquivos] = useState(false);
  const [transpRefazer, setTranspRefazer] = useState('');
  const [transpsDoCd, setTranspsDoCd] = useState({ status: 'idle', nomes: [] });
  const [ultimaAcao, setUltimaAcao] = useState('');

  // Nomes das transportadoras com origem no CD, para escolher na lista (sem digitar).
  useEffect(() => {
    const cd = CDS_BLACK.find((c) => c.chave === cdEscolhido);
    if (!cd) return undefined;
    let ativo = true;
    setTranspsDoCd({ status: 'carregando', nomes: [] });
    setTranspRefazer('');
    listarTransportadorasPorCidadesOrigemDb(cd.cidades)
      .then((nomes) => { if (ativo) setTranspsDoCd({ status: 'ok', nomes }); })
      .catch(() => { if (ativo) setTranspsDoCd({ status: 'erro', nomes: [] }); });
    return () => { ativo = false; };
  }, [cdEscolhido]);

  const faixas = useMemo(() => parseFaixas(faixasTexto), [faixasTexto]);

  async function gerar() {
    setUltimaAcao('gerar');
    if (!faixas.length) { setErro('Faixas de peso inválidas. Use o formato "0-2, 2-5, 100+".'); return; }
    interromperRef.current = false;
    setStatus('carregando'); setErro(''); setSimulados(null);
    try {
      const ctx = await carregarContextoCd({
        competencia, dataInicio, dataFim, limiteInput, cdEscolhido, faixas, volumePrioritario, onProgresso: setProgresso,
      });
      const { cds, todos, doCd, semIbge, acum, perfilDaFaixa, molde, destinos, mesorregiaoPorIbge } = ctx;

      // 2) Malha completa das tabelas que saem do CD (todos os destinos atendidos).
      setProgresso('Carregando a malha completa das tabelas que saem do CD (pode demorar)...');
      const baseFrete = normalizarTransportadoras(
        await carregarBaseFiltradaPorCidadesOrigemDb(cds[0].cidades, (e) => setProgresso(`Carregando malha do CD... ${fmtN(e?.rotas || 0)} rotas · ${fmtN(e?.cotacoes || 0)} cotações`)),
      );
      if (!baseFrete.length) throw new Error('Nenhuma tabela de frete B2C encontrada para o CD.');
      const rotasAtuaisPorTransportadora = montarEspelhoRotasPorTransportadora(baseFrete, cds[0]);
      const idx = indexarBase(baseFrete);
      const mapBaseByNome = new Map(baseFrete.map((t) => [t.nome, t]));
      const origemCache = new Map();
      const setOrigemMolde = nomesPorOrigem(idx, dig7(molde.ibgeOrigem), normTexto(molde.cidadeOrigem), origemCache);

      setProgresso('Agrupando municípios por combinação tarifária...');
      const destinosPreparados = destinos.map((destino) => {
        const setDestino = idx.porDestinoIbge.get(destino.d);
        const candidatas = [];
        if (setDestino) for (const nome of setOrigemMolde) if (setDestino.has(nome)) { const t = mapBaseByNome.get(nome); if (t) candidatas.push(t); }
        return {
          ...destino,
          candidatas,
          assinatura: candidatas.length ? assinaturaTarifariaDestino(destino.d, destino.ufD, candidatas, baseFrete, cds[0]) : '',
        };
      });
      const gruposTarifarios = new Set(destinosPreparados.filter((x) => x.assinatura).map((x) => x.assinatura)).size;

      // 4) Uma simulação por combinação tarifária x faixa. Municípios equivalentes
      // reutilizam o resultado, mas permanecem como linhas IBGE individuais na saída.
      const ctes = [];
      const resultadosPorGrupo = new Map();
      const configuracaoCheckpoint = JSON.stringify({
        versao: 1, cdEscolhido, competencia, dataInicio, dataFim, limiteInput,
        faixas: faixas.map((f) => [f.min, Number.isFinite(f.max) ? f.max : 'inf']),
        volumePrioritario, baseFrete: baseFrete.length, municipios: destinosPreparados.length,
      });
      const chaveExecucao = chaveCheckpoint(configuracaoCheckpoint);
      let indiceInicial = 0;
      const checkpoint = await carregarCheckpoint(chaveExecucao, configuracaoCheckpoint).catch(() => null);
      if (checkpoint?.lotes?.length) {
        for (const lote of checkpoint.lotes) {
          ctes.push(...lote.ctes);
          for (const item of lote.ctes) {
            if (item._chaveGrupo && !resultadosPorGrupo.has(item._chaveGrupo)) resultadosPorGrupo.set(item._chaveGrupo, item.resultados);
          }
        }
        indiceInicial = Math.min(destinosPreparados.length, checkpoint.meta.ultimoIndice + 1);
        setProgresso(`Retomando progresso salvo no município ${fmtN(indiceInicial + 1)} de ${fmtN(destinosPreparados.length)}...`);
        await new Promise((r) => setTimeout(r, 0));
      }
      const t0 = Date.now();
      let ultimoYield = t0;
      let ultimaAtualizacao = t0;
      const semTabela = destinosPreparados.filter((x) => !x.candidatas.length).length;
      for (let k = indiceInicial; k < destinosPreparados.length; k++) {
        if (interromperRef.current) {
          setStatus('idle');
          setProgresso(`Interrompido com segurança em ${fmtN(k)}/${fmtN(destinosPreparados.length)}. Clique em “Continuar geração” para retomar.`);
          return;
        }
        const { d, info, ufD, key, label, classe, volume, percentual, acumulado, candidatas, assinatura } = destinosPreparados[k];
        const ctesDoMunicipio = [];
        for (const faixa of faixas) {
          const pf = perfilDaFaixa(faixa);
          const cteRef = montarCteRef(molde, info, d, ufD, pf);
          const chaveGrupo = assinatura ? chaveCheckpoint(`${assinatura}|${faixa.min}`) : '';
          let resultados = chaveGrupo ? resultadosPorGrupo.get(chaveGrupo) : null;
          if (!resultados) {
            resultados = candidatas.length ? simularTodas(cteRef, baseFrete, candidatas, molde.ibgeOrigem, d, molde.cidadeOrigem) : [];
            if (chaveGrupo) resultadosPorGrupo.set(chaveGrupo, resultados);
          }
          const itemSimulado = {
            cd: molde.cd, uf: ufD, peso: pf.peso, destinoKey: key, destinoLabel: label, valorPago: 0, resultados, sintetico: true,
            classeVolume: classe, volumeDestino: volume, percentualVolume: percentual, percentualAcumulado: acumulado,
            _chaveGrupo: chaveGrupo,
          };
          ctes.push(itemSimulado);
          ctesDoMunicipio.push(itemSimulado);
          // O motor de frete é síncrono. Em uma malha nacional, devolver o controle
          // periodicamente evita bloquear rolagem, pintura e eventos do navegador.
          const agora = Date.now();
          if (agora - ultimaAtualizacao >= 250) {
            setProgresso(`Simulando municípios... ${fmtN(k + 1)}/${fmtN(destinosPreparados.length)} · ${fmtN(resultadosPorGrupo.size)}/${fmtN(gruposTarifarios * faixas.length)} combinações tarifárias · faixa ${faixa.label} · ${((agora - t0) / 1000).toFixed(0)}s`);
            ultimaAtualizacao = agora;
          }
          if (agora - ultimoYield >= 40) {
            await new Promise((r) => setTimeout(r, 0));
            ultimoYield = Date.now();
          }
        }
        if (k % 20 === 0 || k === destinosPreparados.length - 1) {
          setProgresso(`Simulando municípios... ${fmtN(k + 1)}/${fmtN(destinosPreparados.length)} · ${fmtN(resultadosPorGrupo.size)}/${fmtN(gruposTarifarios * faixas.length)} combinações tarifárias · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        }
        await salvarCheckpoint(chaveExecucao, configuracaoCheckpoint, k, ctesDoMunicipio, {
          totalMunicipios: destinosPreparados.length, combinacoesConcluidas: resultadosPorGrupo.size,
        }).catch((e) => console.warn('[TabelaPadraoB2C] checkpoint não salvo', e));
      }

      // 5) CT-es reais entram só como volume e custo realizado (sem recalcular frete).
      ctes.push(...ctesDeVolume(doCd));
      const destinosSemVolume = destinos.filter((x) => x.classe === 'sem_historico').length;
      const destinosNucleo = destinos.filter((x) => x.classe === 'nucleo_80').length;
      const faixasSemAmostra = faixas.filter((f) => !acum.get(f.min)?.n).length;
      setSimulados({
        ctes, semIbge, totalLidos: todos.length, estimadas: faixasSemAmostra, destinosSemVolume, destinosNucleo,
        destinos: destinos.length, semTabela, ibgeOrigem: molde.ibgeOrigem, rotasAtuaisPorTransportadora,
        mesorregiaoPorIbge,
      });
      setStatus('concluido'); setProgresso('');
    } catch (e) {
      console.error('[TabelaPadraoB2C]', e);
      setErro(`${e.message || e}`);
      setStatus('erro'); setProgresso('');
    }
  }

  // Refaz só uma transportadora em cima da última geração completa do CD salva neste navegador:
  // tira os valores antigos dela de cada município x faixa, simula de novo só a tabela dela
  // (rotas novas entram, rotas retiradas saem, prazo/preço atualizam) e reordena o ranking.
  // As demais transportadoras não são recalculadas: mantêm o valor simulado da geração salva.
  async function refazerTransportadora() {
    const alvo = transpRefazer.trim();
    setUltimaAcao('refazer');
    if (!alvo) { setErro('Informe a transportadora que será refeita.'); return; }
    if (!faixas.length) { setErro('Faixas de peso inválidas. Use o formato "0-2, 2-5, 100+".'); return; }
    interromperRef.current = false;
    setStatus('carregando'); setErro(''); setSimulados(null);
    try {
      const cdInfo = CDS_BLACK.find((c) => c.chave === cdEscolhido);
      setProgresso('Procurando a última geração completa salva deste CD...');
      const exec = await ultimaExecucaoCompleta(cdEscolhido, faixas);
      if (!exec) {
        throw new Error(`Não há geração completa de ${cdInfo?.label || cdEscolhido} salva neste navegador com essas faixas de peso. `
          + 'O refazer parte da última geração completa: gere a tabela inteira uma vez neste navegador e depois refaça só a transportadora.');
      }
      const { cfg } = exec;
      // Usa o mesmo recorte de CT-es da geração salva, para o perfil por faixa ficar igual ao das demais.
      setCompetencia(cfg.competencia || ''); setDataInicio(cfg.dataInicio || ''); setDataFim(cfg.dataFim || '');
      setLimiteInput(cfg.limiteInput || '8000'); setVolumePrioritario(cfg.volumePrioritario || '80');
      const ctx = await carregarContextoCd({
        competencia: cfg.competencia, dataInicio: cfg.dataInicio, dataFim: cfg.dataFim, limiteInput: cfg.limiteInput,
        cdEscolhido, faixas, volumePrioritario: cfg.volumePrioritario, onProgresso: setProgresso,
      });
      const { cds, todos, doCd, semIbge, acum, perfilDaFaixa, molde, destinos, mesorregiaoPorIbge } = ctx;

      setProgresso(`Carregando só a tabela de ${alvo} saindo de ${cds[0].label}...`);
      const nomeAlvoNorm = normTexto(alvo);
      const baseAlvo = normalizarTransportadoras(await carregarBaseFiltradaPorCidadesOrigemDb(
        cds[0].cidades,
        (e) => setProgresso(`Carregando tabela de ${alvo}... ${fmtN(e?.rotas || 0)} rotas · ${fmtN(e?.cotacoes || 0)} cotações`),
        { soTransportadoras: [alvo] },
      )).filter((t) => normTexto(t.nome) === nomeAlvoNorm);
      if (!baseAlvo.length) {
        const nomes = new Set();
        for (const lote of exec.lotes) for (const item of lote.ctes) for (const r of item.resultados || []) nomes.add(r.transportadora);
        throw new Error(`"${alvo}" não tem tabela ativa saindo de ${cds[0].label}. Transportadoras da última geração: ${[...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')).join(', ')}.`);
      }
      const transp = baseAlvo[0];
      const idx = indexarBase(baseAlvo);
      const saiDoCd = nomesPorOrigem(idx, dig7(molde.ibgeOrigem), normTexto(molde.cidadeOrigem), new Map()).has(transp.nome);
      const destinoPorIbge = new Map(destinos.map((x) => [x.d, x]));
      const cacheSim = new Map();
      const assinaturaCache = new Map();
      const cont = { antes: 0, depois: 0, entrou: 0, saiu: 0 };
      const t0 = Date.now();
      let ultimoYield = t0;
      const totalLotes = exec.lotes.length;

      for (let k = 0; k < totalLotes; k++) {
        if (interromperRef.current) {
          setStatus('idle');
          setProgresso('Refazer interrompido. Nada foi gravado: a geração salva continua como estava.');
          return;
        }
        for (const item of exec.lotes[k].ctes) {
          const antigos = item.resultados || [];
          const outros = antigos.filter((r) => normTexto(r.transportadora) !== nomeAlvoNorm);
          const tinha = outros.length !== antigos.length;
          const d = item.destinoKey;
          const destino = destinoPorIbge.get(d);
          const faixa = faixaDoPeso(item.peso, faixas);
          let novos = [];
          if (saiDoCd && destino && faixa && idx.porDestinoIbge.get(d)?.has(transp.nome)) {
            let assinatura = assinaturaCache.get(d);
            if (assinatura == null) {
              assinatura = assinaturaTarifariaDestino(d, destino.ufD, [transp], baseAlvo, cds[0]);
              assinaturaCache.set(d, assinatura);
            }
            const chave = `${assinatura}|${faixa.min}`;
            novos = cacheSim.get(chave);
            if (!novos) {
              const cteRef = montarCteRef(molde, destino.info, d, destino.ufD, perfilDaFaixa(faixa));
              novos = simularTodas(cteRef, baseAlvo, [transp], molde.ibgeOrigem, d, molde.cidadeOrigem);
              cacheSim.set(chave, novos);
            }
          }
          if (tinha) cont.antes += 1;
          if (novos.length) cont.depois += 1;
          if (!tinha && novos.length) cont.entrou += 1;
          if (tinha && !novos.length) cont.saiu += 1;
          item.resultados = [...outros, ...novos].sort((a, b) => a.total - b.total);
          item._chaveGrupo = '';
        }
        const agora = Date.now();
        if (agora - ultimoYield >= 40) {
          setProgresso(`Refazendo ${transp.nome}... município ${fmtN(k + 1)}/${fmtN(totalLotes)} · ${fmtN(cacheSim.size)} combinações simuladas · ${((agora - t0) / 1000).toFixed(0)}s`);
          await new Promise((r) => setTimeout(r, 0));
          ultimoYield = Date.now();
        }
      }

      setProgresso('Gravando a geração atualizada neste navegador...');
      await regravarExecucao(exec.meta, exec.lotes, {
        refeitas: [...(exec.meta.refeitas || []), { transportadora: transp.nome, em: Date.now() }],
      });

      const ctes = exec.lotes.flatMap((l) => l.ctes);
      const comValor = new Set();
      const todosDestinos = new Set();
      for (const item of ctes) { todosDestinos.add(item.destinoKey); if (item.resultados.length) comValor.add(item.destinoKey); }
      ctes.push(...ctesDeVolume(doCd));
      setSimulados({
        ctes, semIbge, totalLidos: todos.length,
        estimadas: faixas.filter((f) => !acum.get(f.min)?.n).length,
        destinosSemVolume: destinos.filter((x) => x.classe === 'sem_historico').length,
        destinosNucleo: destinos.filter((x) => x.classe === 'nucleo_80').length,
        destinos: todosDestinos.size, semTabela: todosDestinos.size - comValor.size, ibgeOrigem: molde.ibgeOrigem,
        rotasAtuaisPorTransportadora: montarEspelhoRotasPorTransportadora(baseAlvo, cds[0]),
        mesorregiaoPorIbge,
        refeita: {
          transportadora: transp.nome, ...cont,
          periodo: cfg.dataInicio || cfg.dataFim ? `${cfg.dataInicio || '…'} a ${cfg.dataFim || '…'}` : (cfg.competencia || `últimos ${cfg.limiteInput} CT-es`),
          segundos: Math.round((Date.now() - t0) / 1000),
        },
      });
      setStatus('concluido'); setProgresso('');
    } catch (e) {
      console.error('[TabelaPadraoB2C] refazer', e);
      setErro(`${e.message || e}`);
      setStatus('erro'); setProgresso('');
    }
  }

  // Muda parâmetros de preço sem re-simular: a agregação é pura.
  const tabela = useMemo(() => {
    if (!simulados) return null;
    return montarTabelaPadrao(simulados.ctes, {
      faixas, base: baseFirst,
      pesos: posicoes.map((p) => safeNum(p.peso)), difs: posicoes.map((p) => safeNum(p.acr)),
      passoExtra: safeNum(passoExtra), maxPos: Math.max(1, Math.floor(safeNum(maxPos)) || 1),
      coberturaMin: 0,
      amostraMin: Math.max(1, safeNum(amostraMin)),
    });
  }, [simulados, faixas, baseFirst, posicoes, passoExtra, maxPos, amostraMin]);

  // Só materializa (transportadora x rota x faixa) quando a visão por transportadora está aberta: com malha completa são milhões de linhas.
  const porTransp = useMemo(() => (tabela && visao === 'transportadora' ? tabelaPorTransportadora(tabela.linhas) : []), [tabela, visao]);

  // Cobertura por transportadora: destinos que atende x linhas (destino x faixa) com valor.
  const coberturaTransp = useMemo(() => {
    const m = new Map();
    for (const l of tabela?.linhas || []) {
      const dest = `${l.cd}|${l.destinoKey}`;
      for (const p of l.completo) {
        const c = m.get(p.transportadora) || { transportadora: p.transportadora, destinos: new Set(), linhas: 0, estimadas: 0 };
        c.destinos.add(dest); c.linhas += 1; if (l.estimado) c.estimadas += 1;
        m.set(p.transportadora, c);
      }
    }
    return Array.from(m.values()).map((c) => ({
      transportadora: c.transportadora, destinos: c.destinos.size, linhas: c.linhas, estimadas: c.estimadas,
      faltando: Math.max(0, c.destinos.size * faixas.length - c.linhas),
    })).sort((a, b) => a.transportadora.localeCompare(b.transportadora, 'pt-BR'));
  }, [tabela, faixas]);

  const linhasFiltradas = useMemo(() => {
    if (!tabela) return [];
    const d = normBusca(filtroDestino);
    return tabela.linhas.filter((l) => (!filtroCd || l.cd === filtroCd)
      && (!d || normBusca(l.destinoLabel).includes(d))
      && (!filtroTransp || l.podio.some((p) => p.transportadora === filtroTransp)));
  }, [tabela, filtroCd, filtroDestino, filtroTransp]);

  const transpsNoPodio = useMemo(() => coberturaTransp.map((c) => c.transportadora), [coberturaTransp]);

  const totais = useMemo(() => {
    const t = { realizado: 0, padrao: 0, ctes: 0 };
    for (const l of tabela?.linhas || []) { t.realizado += l.custoRealizado; t.padrao += l.custoPadrao; t.ctes += l.ctes; }
    return t;
  }, [tabela]);

  const vitorias = useMemo(() => {
    const m = new Map();
    for (const l of tabela?.linhas || []) {
      const v = l.podio[0]?.transportadora;
      if (v) m.set(v, (m.get(v) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [tabela]);

  function nomeSeguro(v) {
    return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  }

  function arquivosVerumDaTransportadora(nome) {
    const linhas = tabelaPorTransportadora(tabela.linhas, nome);
    const porDestino = new Map();
    for (const p of linhas) {
      const lista = porDestino.get(p.destinoKey) || [];
      lista.push(p);
      porDestino.set(p.destinoKey, lista);
    }
    for (const lista of porDestino.values()) lista.sort((a, b) => a.faixaMin - b.faixaMin);

    // Uma região tarifária pode atender muitos IBGEs. Ela é definida pelo vetor
    // completo de preços por faixa; as linhas de cobertura continuam sendo o
    // espelho exato das rotas atuais da transportadora.
    const espelho = simulados.rotasAtuaisPorTransportadora?.[nome] || [];
    const grupos = new Map();
    const rotas = [];
    const rotasVistas = new Set();
    for (const rotaAtual of espelho) {
      const precos = porDestino.get(rotaAtual.ibgeDestino);
      if (!precos?.length) continue;
      const mesorregiao = simulados.mesorregiaoPorIbge?.[rotaAtual.ibgeDestino] || `${precos[0]?.uf || ''} SEM MESORREGIAO`;
      const mesoNome = String(mesorregiao).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().toUpperCase().slice(0, 28);
      const assinaturaPreco = precos.map((p) => [p.faixaMin, Number.isFinite(p.faixaMax) ? p.faixaMax : 'inf', Number(p.precoTabela).toFixed(2)]);
      const chaveGrupo = JSON.stringify([rotaAtual.codigoUnidade, mesorregiao, assinaturaPreco]);
      let grupo = grupos.get(chaveGrupo);
      if (!grupo) {
        const numero = String(grupos.size + 1).padStart(4, '0');
        grupo = { nome: `BLACK ${cdEscolhido} ${mesoNome} ${numero}`, unidade: rotaAtual.codigoUnidade, precos };
        grupos.set(chaveGrupo, grupo);
      }
      const chaveRota = [grupo.nome, rotaAtual.ibgeOrigem, rotaAtual.ibgeDestino, rotaAtual.cepInicial, rotaAtual.cepFinal, rotaAtual.prazo, rotaAtual.metodoEnvio, rotaAtual.codigoUnidade].join('|');
      if (rotasVistas.has(chaveRota)) continue;
      rotasVistas.add(chaveRota);
      rotas.push({
        'Código da unidade': rotaAtual.codigoUnidade,
        Cotação: grupo.nome,
        'Código IBGE Origem': rotaAtual.ibgeOrigem || simulados.ibgeOrigem,
        'Código IBGE Destino': rotaAtual.ibgeDestino,
        'CEP inicial': rotaAtual.cepInicial,
        'CEP final': rotaAtual.cepFinal,
        'Método de envio': rotaAtual.metodoEnvio,
        'Prazo de entrega': rotaAtual.prazo > 0 ? rotaAtual.prazo : '',
        'Início da vigência': '', 'Término da vigência': '',
      });
    }
    if (!rotas.length) throw new Error(`${nome}: nenhuma rota atual B2C pôde ser associada aos preços calculados.`);

    const fretes = [];
    for (const grupo of grupos.values()) {
      for (const p of grupo.precos) fretes.push({
        'Nome da transportadora': nome,
        'Código da unidade': grupo.unidade,
        'Regra de cálculo': 'Sem regra',
        'Rota do frete': grupo.nome,
        'Peso mínimo': p.faixaMin > 0 ? Number((p.faixaMin + 0.01).toFixed(2)) : 0,
        'Peso limite': Number.isFinite(p.faixaMax) ? p.faixaMax : 999999999,
        'Excesso de peso': Number.isFinite(p.faixaMax) ? 0 : Number((p.precoTabela / 100).toFixed(4)),
        'Taxa aplicada': p.precoTabela,
        'Frete percentual': 0,
        'Frete mínimo': 0,
        'Início da vigência': '',
        'Fim da vigência': '',
      });
    }
    const base = `tabela-black-b2c-${nomeSeguro(cdEscolhido)}-${nomeSeguro(nome)}`;
    return [
      { nome: `${base}-fretes-verum.xlsx`, bytes: montarXlsxVerum('cotacoes', fretes) },
      { nome: `${base}-rotas-verum.xlsx`, bytes: montarXlsxVerum('rotas', rotas) },
    ];
  }

  function baixarBlob(bytes, nome, tipo) {
    const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
    const a = document.createElement('a');
    a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function baixarArquivos(nomes) {
    setGerandoArquivos(true);
    try {
      const arquivos = {};
      for (const n of nomes) {
        for (const f of arquivosVerumDaTransportadora(n)) arquivos[f.nome] = f.bytes;
        await new Promise((res) => setTimeout(res, 0));
      }
      baixarBlob(zipSync(arquivos), `tabelas-black-b2c-verum-${nomeSeguro(cdEscolhido)}-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip');
    } catch (e) {
      setErro(`Falha ao gerar arquivos: ${e.message || e}`);
    } finally {
      setGerandoArquivos(false);
    }
  }

  async function exportar() {
    if (!tabela) return;
    const nPos = tabela.linhas.reduce((m, l) => Math.max(m, l.podio.length), 1);
    const resumo = [
      ['Faixas', faixasTexto], ['Granularidade', granularidade === 'uf' ? 'UF de destino' : 'Cidade de destino'],
      ['Preço base', baseFirst === 'ponderado' ? 'Média ponderada (tabela)' : baseFirst === 'simulado' ? 'Simulado do vencedor' : 'Média realizada'],
      ['Pesos por posição (%)', posicoes.map((p) => p.peso).join(' / ')], ['Acréscimo por posição (R$)', posicoes.map((p) => p.acr).join(' / ')],
        ['Passo após a última posição (R$)', passoExtra], ['Máx. posições', maxPos], ['Núcleo prioritário do volume %', volumePrioritario], ['Amostra mínima (CT-es)', amostraMin],
      ['CD', cdEscolhido], ['CT-es simulados', simulados.ctes.length],
    ];
    await exportarExcelFormatado({
      nomeArquivo: `tabela-padrao-b2c-${new Date().toISOString().slice(0, 10)}`,
      aba: 'Ranking',
      resumo,
      colunas: [
        { titulo: 'CD origem' }, { titulo: 'UF destino', tipo: 'centro' }, { titulo: 'Destino' }, { titulo: 'Faixa de peso' }, { titulo: 'CT-es', tipo: 'inteiro' },
        { titulo: 'Realizado médio', tipo: 'moeda' }, { titulo: 'Preço padrão (ponderado)', tipo: 'moeda' }, { titulo: 'Custo realizado', tipo: 'moeda' }, { titulo: 'Custo com padrão', tipo: 'moeda' },
        ...Array.from({ length: nPos }, (_, i) => [{ titulo: `${i + 1}º` }, { titulo: `Preço ${i + 1}º`, tipo: 'moeda' }]).flat(),
      ],
      linhas: tabela.linhas.map((l) => [
        l.cd, l.uf, l.destinoLabel, l.faixa.label, l.ctes, l.realizado, l.precoBase, l.custoRealizado, l.custoPadrao,
        ...Array.from({ length: nPos }, (_, i) => [l.podio[i]?.transportadora || '', l.podio[i]?.precoTabela ?? '']).flat(),
      ]),
    });
    await exportarExcelFormatado({
      nomeArquivo: `tabela-padrao-b2c-por-transportadora-${new Date().toISOString().slice(0, 10)}`,
      aba: 'Por transportadora',
      resumo,
      colunas: [
        { titulo: 'Transportadora' }, { titulo: 'CD origem' }, { titulo: 'UF destino', tipo: 'centro' }, { titulo: 'Destino' },
        { titulo: 'Faixa de peso' }, { titulo: 'Peso inicial (kg)', tipo: 'numero' }, { titulo: 'Peso final (kg)', tipo: 'numero' },
        { titulo: 'Posição', tipo: 'inteiro' }, { titulo: 'Preço tabela padrão', tipo: 'moeda' }, { titulo: 'Simulado (tabela real)', tipo: 'moeda' },
        { titulo: 'Realizado médio', tipo: 'moeda' }, { titulo: 'CT-es na amostra', tipo: 'inteiro' }, { titulo: 'Prazo', tipo: 'numero' },
      ],
      linhas: tabelaPorTransportadora(tabela.linhas).map((p) => [
        p.transportadora, p.cd, p.uf, p.destino, p.faixa, p.faixaMin, Number.isFinite(p.faixaMax) ? p.faixaMax : '',
        p.posicao, p.precoTabela, p.simulado, p.realizado, p.ctes, p.prazo ?? '',
      ]),
    });
  }

  const MAX_LINHAS = 600;
  const colsPodio = tabela ? tabela.linhas.reduce((m, l) => Math.max(m, l.podio.length), 1) : 0;

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Análise</div>
        <h1>Tabela Padrão B2C</h1>
        <p>Gera a tabela Black B2C all-in para toda a malha nacional. Ranqueia as transportadoras por CD, município IBGE e faixa de peso, calcula o preço ponderado e entrega os arquivos prontos no formato Verum.</p>
        <BaseCtesStatus />
      </div>

      {erro && <div className="sim-alert error">{erro}</div>}

      <section className="sim-card">
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
          <label>Competência (mês)<input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} /></label>
          <label>Período — início<input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} /></label>
          <label>Período — fim<input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></label>
          <label>Limite de CT-es <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.72rem' }}>(só sem mês/período)</span>
            <input type="number" value={limiteInput} onChange={(e) => setLimiteInput(e.target.value)} min={100} max={200000} step={1000} />
          </label>
        </div>

        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
          <label>CD de origem (um por vez)
            <select value={cdEscolhido} onChange={(e) => setCdEscolhido(e.target.value)} style={{ width: '100%' }}>
              {CDS_BLACK.map((cd) => <option key={cd.chave} value={cd.chave}>{cd.label}/{cd.uf} ({cd.codigos.join(', ')})</option>)}
            </select>
          </label>
        </div>

        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
          <label>Faixas de peso (kg)
            <input value={faixasTexto} onChange={(e) => setFaixasTexto(e.target.value)} style={{ borderColor: faixas.length ? undefined : '#9b1111' }} />
          </label>
          <label>Malha de destinos
            <input value="Todos os municípios do IBGE" readOnly />
          </label>
          <label>Formação do preço-base all-in
            <select value={baseFirst} onChange={(e) => setBaseFirst(e.target.value)} style={{ width: '100%' }}>
              <option value="ponderado">Média ponderada pelos pesos (tabela)</option>
              <option value="simulado">Simulado do vencedor (tabela)</option>
              <option value="realizado">Média realizada (paga)</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="primary" type="button" onClick={gerar} disabled={status === 'carregando'}>
              {status === 'carregando' ? 'Simulando...' : progresso.startsWith('Interrompido') ? 'Continuar geração' : 'Gerar tabela padrão'}
            </button>
            {status === 'carregando' && (
              <button type="button" className="sim-tab" onClick={() => { interromperRef.current = true; setProgresso('Finalizando o município atual e salvando o progresso...'); }}>
                Interromper e salvar
              </button>
            )}
          </div>
        </div>

        <div style={{ margin: '4px 0 14px', border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 2 }}>Refazer só uma transportadora</div>
          <div style={{ fontSize: '0.72rem', color: '#92400e', marginBottom: 8 }}>
            Para quando uma transportadora mudou a tabela (rotas novas, prazo, preço) e as demais continuam iguais. Parte da última geração completa
            deste CD salva neste navegador (mesmo período e faixas), simula de novo só a transportadora informada e regrava o resultado.
            As outras mantêm o valor simulado da geração salva — mas a posição e o preço padrão delas podem mudar nas rotas onde essa entrou ou mudou.
          </div>
          <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
            <label>Transportadora com tabela saindo deste CD
              {transpsDoCd.status === 'erro' ? (
                <input value={transpRefazer} onChange={(e) => setTranspRefazer(e.target.value)} placeholder="Não carregou a lista: digite o nome do cadastro" />
              ) : (
                <select value={transpRefazer} onChange={(e) => setTranspRefazer(e.target.value)} style={{ width: '100%' }} disabled={transpsDoCd.status === 'carregando'}>
                  <option value="">{transpsDoCd.status === 'carregando' ? 'Carregando transportadoras...' : `Escolha (${transpsDoCd.nomes.length})`}</option>
                  {transpsDoCd.nomes.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </label>
            <div>
              <button type="button" className="primary" onClick={refazerTransportadora} disabled={status === 'carregando' || !transpRefazer.trim()}>
                {status === 'carregando' && ultimaAcao === 'refazer' ? 'Refazendo...' : 'Refazer só esta transportadora'}
              </button>
            </div>
          </div>
          {ultimaAcao === 'refazer' && progresso && (
            <div style={{ marginTop: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 12px', fontSize: '0.82rem', color: '#1d4ed8' }}>{progresso}</div>
          )}
          {ultimaAcao === 'refazer' && erro && (
            <div className="sim-alert error" style={{ marginTop: 10 }}>{erro}</div>
          )}
          {simulados?.refeita && tabela && (
            <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.82rem', color: '#065f46' }}>
              <span><b>{simulados.refeita.transportadora}</b> refeita: {fmtN(simulados.refeita.depois)} linhas com valor ({fmtN(simulados.refeita.entrou)} novas, {fmtN(simulados.refeita.saiu)} saíram).</span>
              <button type="button" className="primary" disabled={gerandoArquivos} onClick={() => baixarArquivos([simulados.refeita.transportadora])}>
                {gerandoArquivos ? 'Gerando...' : `Baixar arquivos Verum de ${simulados.refeita.transportadora}`}
              </button>
            </div>
          )}
        </div>

        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
          <label>Núcleo prioritário do volume (%)<input type="number" min={0} max={100} value={volumePrioritario} onChange={(e) => setVolumePrioritario(e.target.value)} /></label>
          <label>Amostra mínima (CT-es/linha)<input type="number" min={1} value={amostraMin} onChange={(e) => setAmostraMin(e.target.value)} /></label>
        </div>
        <div style={{ marginTop: 14, border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 2 }}>Painel de posições</div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: 8 }}>
            Peso: quanto cada colocado pesa na média ponderada do preço padrão (0 = fora da média). Acréscimo: quanto a tabela daquela posição soma ao preço padrão.
          </div>
          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={th}>Posição</th><th style={th}>Peso (%)</th><th style={th}>Acréscimo (R$)</th><th style={th}></th></tr>
            </thead>
            <tbody>
              {posicoes.map((p, i) => (
                <tr key={i}>
                  <td style={td}>{i + 1}º</td>
                  <td style={td}><input type="number" min={0} max={100} value={p.peso} style={{ width: 80 }}
                    onChange={(e) => setPosicoes((prev) => prev.map((x, j) => (j === i ? { ...x, peso: e.target.value } : x)))} /></td>
                  <td style={td}><input type="number" step="0.5" value={p.acr} style={{ width: 80 }}
                    onChange={(e) => setPosicoes((prev) => prev.map((x, j) => (j === i ? { ...x, acr: e.target.value } : x)))} /></td>
                  <td style={td}>
                    {i === posicoes.length - 1 && posicoes.length > 1 && (
                      <button type="button" className="sim-tab" style={{ padding: '1px 8px' }} onClick={() => setPosicoes((prev) => prev.slice(0, -1))}>remover</button>
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={td} colSpan={4}>
                  <button type="button" className="sim-tab" style={{ padding: '2px 10px' }}
                    onClick={() => setPosicoes((prev) => [...prev, { peso: '0', acr: String(safeNum(prev[prev.length - 1]?.acr) + safeNum(passoExtra)) }])}>
                    + adicionar posição
                  </button>
                  <span style={{ marginLeft: 12, fontSize: '0.78rem', color: posicoes.reduce((acc, p) => acc + safeNum(p.peso), 0) === 100 ? '#047857' : '#b45309' }}>
                    soma dos pesos: {posicoes.reduce((acc, p) => acc + safeNum(p.peso), 0)}%{posicoes.reduce((acc, p) => acc + safeNum(p.peso), 0) === 100 ? '' : ' (a média é normalizada pela soma)'}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <div className="sim-form-grid sim-grid-4" style={{ marginTop: 10, alignItems: 'flex-end' }}>
            <label>Posições além da lista: somar a cada colocação (R$)
              <input type="number" step="0.5" value={passoExtra} onChange={(e) => setPassoExtra(e.target.value)} />
            </label>
            <label>Máximo de transportadoras por linha
              <input type="number" min={1} max={30} value={maxPos} onChange={(e) => setMaxPos(e.target.value)} />
            </label>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 6 }}>
            Ex.: lista até o 4º e passo R$ 1: o 5º recebe o acréscimo do 4º + 1, o 6º + 2, e assim por diante. Todas as transportadoras da rota ganham preço pela posição, até o máximo acima.
          </div>
        </div>
        <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 6 }}>
          Preço e acréscimos recalculam na hora. Mudanças de CD, período, faixas ou núcleo prioritário exigem gerar novamente.
        </div>

        {progresso && (
          <div style={{ marginTop: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: '#1d4ed8' }}>{progresso}</div>
        )}
        <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#64748b' }}>
          O progresso é salvo automaticamente neste navegador ao fim de cada município. Para retomar, mantenha os mesmos filtros e clique em “Continuar geração”.
        </div>
      </section>

      {tabela && (
        <>
          {simulados.refeita && (
            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: '10px 16px', margin: '1rem 0 0', fontSize: '0.84rem', color: '#065f46' }}>
              <b>{simulados.refeita.transportadora}</b> refeita em {fmtN(simulados.refeita.segundos)}s sobre a geração salva de {cdEscolhido} ({simulados.refeita.periodo}).
              {' '}Linhas (município × faixa) com valor: {fmtN(simulados.refeita.antes)} antes → {fmtN(simulados.refeita.depois)} agora
              {' '}({fmtN(simulados.refeita.entrou)} novas, {fmtN(simulados.refeita.saiu)} que saíram). O resultado já ficou gravado neste navegador.
              {' '}Só os arquivos Verum dela podem ser baixados aqui; para baixar os das outras (cujo preço pode ter mudado nas rotas em comum),
              {' '}clique em “Gerar tabela padrão” com os mesmos filtros — ele reaproveita a geração salva sem simular de novo.
              <div style={{ marginTop: 8 }}>
                <button type="button" className="primary" disabled={gerandoArquivos} onClick={() => baixarArquivos([simulados.refeita.transportadora])}>
                  {gerandoArquivos ? 'Gerando...' : `Baixar arquivos Verum de ${simulados.refeita.transportadora}`}
                </button>
              </div>
            </div>
          )}
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 16px', margin: '1rem 0', fontSize: '0.84rem', color: '#1d4ed8' }}>
            {fmtN(simulados.destinos)} municípios IBGE processados · {fmtN(simulados.destinosNucleo)} no núcleo prioritário de {volumePrioritario}% do volume · {fmtN(tabela.linhas.length)} linhas (CD × destino × faixa).
            {simulados.semIbge > 0 && ` ${fmtN(simulados.semIbge)} sem IBGE foram ignorados.`}
            {simulados.semTabela > 0 && ` ${fmtN(simulados.semTabela)} município(s) não tiveram nenhuma tabela B2C calculável e ficaram sinalizados sem vencedor.`}
            {tabela.foraDasFaixas > 0 && ` ${fmtN(tabela.foraDasFaixas)} fora das faixas.`}
            {' '}Do 2º colocado em diante o preço é o padrão + acréscimo da posição; capacidade e SLA de cada transportadora são avaliação da operação.
          </div>

          <section className="sim-card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontSize: '0.85rem' }}>
              <div><div style={{ color: '#64748b', fontSize: '0.72rem' }}>Custo realizado (volume da amostra)</div><b style={{ fontSize: '1.2rem' }}>{fmt(totais.realizado)}</b></div>
              <div><div style={{ color: '#64748b', fontSize: '0.72rem' }}>Custo com a tabela padrão</div><b style={{ fontSize: '1.2rem' }}>{fmt(totais.padrao)}</b></div>
              <div><div style={{ color: '#64748b', fontSize: '0.72rem' }}>Diferença</div>
                <b style={{ fontSize: '1.2rem', color: totais.padrao <= totais.realizado ? '#047857' : '#9b1111' }}>
                  {fmt(totais.padrao - totais.realizado)} ({totais.realizado ? (((totais.padrao - totais.realizado) / totais.realizado) * 100).toFixed(1).replace('.', ',') : '0,0'}%)
                </b></div>
            </div>
          </section>

          <section className="sim-card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>Arquivos Verum por transportadora (frete all-in + rotas)</div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                  Cada pacote contém os dois arquivos oficiais do Verum: fretes all-in por faixa e rotas nacionais atendidas, com o valor da posição da transportadora no ranking.
                  {simulados.estimadas > 0 && ` ${fmtN(simulados.estimadas)} faixa(s) de peso sem CT-e no período usaram o peso médio da faixa e a NF média geral.`}
                  {simulados.destinosSemVolume > 0 && ` ${fmtN(simulados.destinosSemVolume)} municípios sem CT-e no histórico entraram pela malha nacional do IBGE.`}
                </div>
              </div>
              <button className="primary" type="button" disabled={gerandoArquivos || !coberturaTransp.length || !!simulados.refeita}
                onClick={() => baixarArquivos(coberturaTransp.map((c) => c.transportadora))}>
                {gerandoArquivos ? 'Gerando...' : `Baixar todos (${coberturaTransp.length}) em ZIP`}
              </button>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 280 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Transportadora</th><th style={{ ...th, textAlign: 'right' }}>Destinos</th>
                    <th style={{ ...th, textAlign: 'right' }}>Linhas com valor</th><th style={{ ...th, textAlign: 'right' }}>Estimadas</th>
                    <th style={{ ...th, textAlign: 'right' }}>Faixas sem valor</th><th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {coberturaTransp.map((c) => (
                    <tr key={c.transportadora}>
                      <td style={td}>{c.transportadora}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtN(c.destinos)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtN(c.linhas)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtN(c.estimadas)}</td>
                      <td style={{ ...td, textAlign: 'right', color: c.faltando ? '#9b1111' : '#047857', fontWeight: 700 }}>{c.faltando ? fmtN(c.faltando) : 'nenhuma'}</td>
                      <td style={td}><button type="button" className="sim-tab" style={{ padding: '1px 10px' }} disabled={gerandoArquivos || (simulados.refeita && c.transportadora !== simulados.refeita.transportadora)} onClick={() => baixarArquivos([c.transportadora])}>baixar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {vitorias.length > 0 && (
            <section className="sim-card" style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 6 }}>Linhas vencidas por transportadora (1º lugar)</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {vitorias.map(([nome, n]) => (
                  <span key={nome} style={{ background: '#f1f5f9', borderRadius: 999, padding: '3px 12px', fontSize: '0.8rem' }}>
                    <b>{nome}</b> · {fmtN(n)} ({((n / tabela.linhas.length) * 100).toFixed(0)}%)
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="sim-card">
            <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end', marginBottom: 10 }}>
              <label>CD
                <select value={filtroCd} onChange={(e) => setFiltroCd(e.target.value)} style={{ width: '100%' }}>
                  <option value="">Todos</option>
                  {Array.from(new Set(tabela.linhas.map((l) => l.cd))).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>Destino contém<input value={filtroDestino} onChange={(e) => setFiltroDestino(e.target.value)} placeholder="ex.: São Paulo" /></label>
              <label>Transportadora no pódio
                <select value={filtroTransp} onChange={(e) => setFiltroTransp(e.target.value)} style={{ width: '100%' }}>
                  <option value="">Todas</option>
                  {transpsNoPodio.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="sim-tab" type="button" onClick={() => setVisao(visao === 'ranking' ? 'transportadora' : 'ranking')}>
                  Ver por {visao === 'ranking' ? 'transportadora' : 'ranking'}
                </button>
                <button className="primary" type="button" onClick={exportar}>Exportar Excel</button>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              {visao === 'ranking' ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>CD</th><th style={th}>Destino</th><th style={th}>Faixa</th>
                      <th style={{ ...th, textAlign: 'right' }}>CT-es</th>
                      <th style={{ ...th, textAlign: 'right' }}>Realizado</th>
                      <th style={{ ...th, textAlign: 'right' }}>Preço padrão</th>
                      {Array.from({ length: colsPodio }, (_, i) => (
                        <React.Fragment key={i}><th style={th}>{i + 1}º</th><th style={{ ...th, textAlign: 'right' }}>Preço</th></React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linhasFiltradas.slice(0, MAX_LINHAS).map((l) => (
                      <tr key={l.key}>
                        <td style={td}>{l.cd}</td>
                        <td style={td}>{l.destinoLabel}</td>
                        <td style={td}>{l.faixa.label}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{fmtN(l.ctes)}</td>
                        <td style={{ ...td, textAlign: 'right' }} title={l.estimado ? 'Faixa sem CT-e no histórico: preço estimado pelo peso médio' : ''}>{l.realizado == null ? 'estimado' : fmt(l.realizado)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: l.realizado == null ? '#64748b' : l.precoBase <= l.realizado ? '#047857' : '#9b1111' }}>{fmt(l.precoBase)}</td>
                        {Array.from({ length: colsPodio }, (_, i) => i).map((i) => {
                          const p = l.podio[i];
                          return (
                            <React.Fragment key={i}>
                              <td style={{ ...td, fontWeight: i === 0 ? 700 : 400 }} title={p ? `Simulado ${fmt(p.simulado)} · cobertura ${(p.cobertura * 100).toFixed(0)}% · peso ${(p.peso * 100).toFixed(0)}%` : ''}>{p ? p.transportadora : '—'}</td>
                              <td style={{ ...td, textAlign: 'right', fontWeight: i === 0 ? 700 : 400 }}>{p ? fmt(p.precoTabela) : '—'}</td>
                            </React.Fragment>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Transportadora</th><th style={th}>CD</th><th style={th}>Destino</th><th style={th}>Faixa</th>
                      <th style={{ ...th, textAlign: 'right' }}>Posição</th><th style={{ ...th, textAlign: 'right' }}>Preço padrão</th>
                      <th style={{ ...th, textAlign: 'right' }}>Simulado (tabela)</th><th style={{ ...th, textAlign: 'right' }}>CT-es</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porTransp
                      .filter((p) => (!filtroCd || p.cd === filtroCd) && (!filtroTransp || p.transportadora === filtroTransp)
                        && (!filtroDestino || normBusca(p.destino).includes(normBusca(filtroDestino))))
                      .slice(0, MAX_LINHAS).map((p, i) => (
                        <tr key={`${p.transportadora}-${p.cd}-${p.destino}-${p.faixaMin}-${i}`}>
                          <td style={td}>{p.transportadora}</td><td style={td}>{p.cd}</td><td style={td}>{p.destino}</td><td style={td}>{p.faixa}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{p.posicao}º</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt(p.precoTabela)}</td>
                          <td style={{ ...td, textAlign: 'right', color: '#64748b' }}>{fmt(p.simulado)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{fmtN(p.ctes)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
            {linhasFiltradas.length > MAX_LINHAS && (
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 8 }}>
                Mostrando {MAX_LINHAS} de {fmtN(linhasFiltradas.length)} linhas — filtre ou exporte para o Excel para ver tudo.
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
