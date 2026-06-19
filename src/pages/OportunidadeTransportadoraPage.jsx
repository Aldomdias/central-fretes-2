import React, { useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarBaseCompletaDb, carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';
import { normalizarTransportadoras, processarCte } from '../services/auditoriaCteProcessamentoService';
import { montarMapasIbge, resolverIbgeLocal } from '../utils/realizadoLocalEngine';
import { filtrarCpComercialCte } from '../services/cteBasePolicy';
import { REGIAO_POR_UF } from '../config/icmsBrasil';

const PAGE_SIZE = 200;
const TOLERANCIA = 0.5; // R$ — redução abaixo disto é ruído

const REGIAO_NOME = { N: 'NORTE', NE: 'NORDESTE', CO: 'CENTRO-OESTE', SE: 'SUDESTE', S: 'SUL' };
const ORDEM_REGIAO = ['NORTE', 'NORDESTE', 'CENTRO-OESTE', 'SUDESTE', 'SUL', 'OUTROS'];

const METRICAS = [
  { id: 'rs', label: 'R$ total' },
  { id: 'freteNf', label: 'Frete % s/ NF' },
  { id: 'rskg', label: 'R$ por kg' },
  { id: 'rscte', label: 'R$ por CT-e' },
];
const MODOS_CANDIDATA = [
  { id: 'qualquer', label: 'Qualquer tabela na origem', dica: 'Toda transportadora com tabela válida saindo desta origem.' },
  { id: 'area', label: 'Já operou a origem', dica: 'Só quem já rodou CT-e saindo desta mesma origem.' },
  { id: 'rota', label: 'Já operou a rota exata', dica: 'Só quem já rodou CT-e nesta rota origem → destino.' },
];
const MODOS_CENARIO = [
  { id: 'substituta', label: 'Uma transportadora substituta', dica: 'Uma única transportadora assume todo o volume da origem (troca de carteira).' },
  { id: 'cteacte', label: 'Menor preço CT-e a CT-e', dica: 'Para cada CT-e, a mais barata (pode misturar várias). Piso teórico.' },
];

const FILTROS_PADRAO = {
  regioes: [],
  ufsOrigem: [],
  transportadorasRealizadas: [],
  soComReducao: true,
};

function safeNum(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function fmt(v) { return safeNum(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function fmtN(v) { return safeNum(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function pct(v) { return `${safeNum(v).toFixed(1).replace('.', ',')}%`; }
function norm(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function canalRealDe(cte) {
  return cte.canal_original && norm(cte.canal) === 'ADEFINIR'
    ? cte.canal_original
    : (cte.canal || cte.canal_original || '');
}
function regiaoDeUf(uf) {
  return REGIAO_NOME[REGIAO_POR_UF[String(uf || '').toUpperCase()]] || 'OUTROS';
}
function passaLista(valor, lista) {
  if (!lista || !lista.length) return true;
  return lista.includes(String(valor || '').trim());
}
function fmtMetrica(metrica, valor) {
  if (valor == null || !Number.isFinite(valor)) return '—';
  if (metrica === 'freteNf') return pct(valor);
  if (metrica === 'rskg') return `${fmt(valor)}/kg`;
  return fmt(valor); // rs, rscte
}
function dig7(v) { return String(v || '').replace(/\D/g, '').slice(0, 7); }
// Mesma normalização de cidade do Simulador (acentos fora, minúsculo).
function normalizeBuscaIbge(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
// Mapa cidade -> IBGE a partir da planilha de IBGE (ibge_municipios), chaveado
// por "cidade" e "cidade/uf" — igual o Simulador monta o municipioPorCidade.
function montarMunicipioPorCidade(municipios = []) {
  const mapa = new Map();
  for (const item of (municipios || [])) {
    const ibge = dig7(item.ibge || item.codigo_ibge || item.codigo);
    const cidade = item.cidade || item.nome || item.municipio || '';
    const uf = item.uf || item.estado || '';
    if (!ibge || !cidade) continue;
    const kCidade = normalizeBuscaIbge(cidade);
    const kCidadeUf = normalizeBuscaIbge(`${cidade}/${uf}`);
    if (kCidade && !mapa.has(kCidade)) mapa.set(kCidade, ibge);
    if (kCidadeUf && !mapa.has(kCidadeUf)) mapa.set(kCidadeUf, ibge);
  }
  return mapa;
}
// IBGE do CT-e seguindo a linha do Simulador: coluna gravada primeiro; senão,
// busca na planilha de IBGE por cidade/uf; por último, fallback do motor local.
function ibgeDoCte(cte, tipo, municipioPorCidade, mapasIbge) {
  const direto = dig7(tipo === 'origem'
    ? (cte.ibge_corrigido_origem || cte.ibge_origem || cte.ibgeOrigem)
    : (cte.ibge_corrigido_destino || cte.ibge_destino || cte.ibgeDestino));
  if (direto) return direto;
  const cidade = tipo === 'origem' ? (cte.cidade_origem || cte.origem || '') : (cte.cidade_destino || cte.destino || '');
  const uf = tipo === 'origem' ? (cte.uf_origem || '') : (cte.uf_destino || '');
  const viaPlanilha = municipioPorCidade.get(normalizeBuscaIbge(`${cidade}/${uf}`)) || municipioPorCidade.get(normalizeBuscaIbge(cidade));
  if (viaPlanilha) return viaPlanilha;
  return resolverIbgeLocal(cidade, uf, mapasIbge) || '';
}
// normalizeCompare do motor (minúsculo, sem acento, espaços) — p/ casar cidade igual a ele.
function normCmp(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().toLowerCase();
}
function cidadeBate(cidadeTabelaNorm, cidadeCteNorm) {
  if (!cidadeCteNorm) return true;
  if (!cidadeTabelaNorm) return false;
  return cidadeTabelaNorm === cidadeCteNorm
    || (cidadeTabelaNorm.length >= 5 && cidadeCteNorm.includes(cidadeTabelaNorm))
    || (cidadeCteNorm.length >= 5 && cidadeTabelaNorm.includes(cidadeCteNorm));
}

// Pré-indexa o cadastro p/ achar rápido só as transportadoras que podem atender
// uma origem/destino — evita rodar o motor contra TODAS (o gargalo em volume alto).
function indexarBase(base) {
  const porOrigemIbge = new Map();   // ibge7 origem -> Set(nome)
  const porDestinoIbge = new Map();  // ibge7 destino -> Set(nome)
  const origensCidade = [];          // [{ cidadeNorm, nome }] distintos (fallback por cidade)
  const vistos = new Set();
  for (const t of base) {
    const nome = t.nome;
    for (const origem of (t.origens || [])) {
      const cidadeNorm = origem.__cidadeNorm || normCmp(origem.cidade);
      const ck = `${nome}|${cidadeNorm}`;
      if (cidadeNorm && !vistos.has(ck)) { vistos.add(ck); origensCidade.push({ cidadeNorm, nome }); }
      for (const rota of (origem.rotas || [])) {
        const io = dig7(rota.ibgeOrigem);
        if (io) { if (!porOrigemIbge.has(io)) porOrigemIbge.set(io, new Set()); porOrigemIbge.get(io).add(nome); }
        const id = dig7(rota.ibgeDestino);
        if (id) { if (!porDestinoIbge.has(id)) porDestinoIbge.set(id, new Set()); porDestinoIbge.get(id).add(nome); }
      }
    }
  }
  return { porOrigemIbge, porDestinoIbge, origensCidade };
}
// Nomes que atendem a origem (por IBGE da rota OU cidade compatível). Memoizado por origem.
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

// Carrega CT-es do realizado respeitando recorte (igual à Oportunidade de Origem).
const LIMITE_MAX_CT = 200000; // trava de segurança para evitar simulações longas demais no browser
async function carregarCtes({ competencia, dataInicio, dataFim, canal, limite = 4000, onProgress }) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const supabase = getSupabaseClient();
  const teto = Math.max(100, Math.min(Number(limite) || 4000, LIMITE_MAX_CT));
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
    if (canal) q = q.or(`canal_original.ilike.%${canal}%,canal.ilike.%${canal}%`);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao carregar CT-es: ${error.message}`);
    const lote = data || [];
    acumulado.push(...lote);
    onProgress?.({ carregados: acumulado.length });
    if (lote.length < PAGE) break;
    from += PAGE;
  }
  return filtrarCpComercialCte(acumulado).slice(0, teto);
}

// Recalcula o MESMO CT-e (mesma origem real, mesmo destino) com TODAS as
// transportadoras. Mantém só as cotações em que o motor usou de fato a origem
// real (descarta fallback p/ outra origem do cadastro).
function simularTodas(cte, base, candidatas, ibgeOrigemReal, ibgeDestino, cidadeOrigemReal) {
  const canalReal = canalRealDe(cte);
  const cteBase = {
    ...cte,
    canal: canalReal,
    canal_original: canalReal,
    ibge_origem: ibgeOrigemReal || '',
    ibge_corrigido_origem: ibgeOrigemReal || '',
    ibge_destino: ibgeDestino || '',
    ibge_corrigido_destino: ibgeDestino || '',
  };
  const origemRealCmp = normCmp(cidadeOrigemReal);
  const resultados = [];
  const statusCounts = { CALCULADO: 0, SEM_TABELA: 0, SEM_ORIGEM: 0, SEM_ROTA: 0, SEM_FAIXA: 0, ORIGEM_ERRADA: 0, OUTRO: 0 };
  for (const transp of candidatas) {
    const teste = { ...cteBase, transportadora: transp.nome, nome_transportadora: transp.nome };
    let r;
    try { r = processarCte(teste, base); } catch { statusCounts.OUTRO += 1; continue; }
    const st = r.status_calculo || 'OUTRO';
    statusCounts[st in statusCounts ? st : 'OUTRO'] += 1;
    if (st !== 'CALCULADO') continue;
    // só aceita cotação em que o motor usou de fato a origem real (mesma regra de cidade do motor)
    if (!cidadeBate(normCmp(r.detalhes_calculo?.origem_cidade), origemRealCmp)) {
      statusCounts.CALCULADO -= 1;
      statusCounts.ORIGEM_ERRADA += 1;
      continue;
    }
    const total = safeNum(r.valor_calculado);
    if (total <= 0) continue;
    resultados.push({ transportadora: transp.nome, total, prazo: safeNum(r.detalhes_calculo?.rota_prazo) });
  }
  resultados.sort((a, b) => a.total - b.total);
  return { resultados, statusCounts };
}

// Calcula o cenário de um grupo (transportadora × origem) já com as candidatas filtradas.
function calcularGrupo(casos, scenarioMode) {
  let pagoTotal = 0, pesoTotal = 0, nfTotal = 0, prazoRealSoma = 0, prazoRealN = 0;
  for (const c of casos) {
    pagoTotal += c.valorPago; pesoTotal += c.peso; nfTotal += c.valorNf;
    if (c.prazoReal > 0) { prazoRealSoma += c.prazoReal; prazoRealN += 1; }
  }

  // Ranking de candidatas no grupo (mesma origem): total e cobertura.
  const carriersUnion = new Set();
  for (const c of casos) for (const q of c.candidatos) carriersUnion.add(q.transportadora);
  const ranking = [];
  for (const nome of carriersUnion) {
    let total = 0, cobertos = 0, prazoSoma = 0, prazoN = 0;
    for (const c of casos) {
      const q = c.candMap.get(nome);
      if (q && q.total > 0) { total += q.total; cobertos += 1; if (q.prazo > 0) { prazoSoma += q.prazo; prazoN += 1; } }
      else { total += c.valorPago; if (c.prazoReal > 0) { prazoSoma += c.prazoReal; prazoN += 1; } }
    }
    ranking.push({ transportadora: nome, total, cobertos, prazoMedio: prazoN > 0 ? prazoSoma / prazoN : null });
  }
  ranking.sort((a, b) => a.total - b.total);

  let melhorTotal = pagoTotal, substituta = null, cobertura = 0, prazoMelhorSoma = 0, prazoMelhorN = 0;

  if (scenarioMode === 'cteacte') {
    melhorTotal = 0;
    const mix = new Map();
    for (const c of casos) {
      const best = c.candidatos[0]; // ordenado asc
      if (best && best.total > 0 && best.total < c.valorPago - 0.001) {
        melhorTotal += best.total;
        mix.set(best.transportadora, (mix.get(best.transportadora) || 0) + 1);
        cobertura += 1;
        if (best.prazo > 0) { prazoMelhorSoma += best.prazo; prazoMelhorN += 1; }
      } else {
        melhorTotal += c.valorPago;
        if (c.prazoReal > 0) { prazoMelhorSoma += c.prazoReal; prazoMelhorN += 1; }
      }
    }
    substituta = [...mix.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  } else {
    // substituta: a melhor única transportadora (não cobertos ficam no pago)
    const melhor = ranking[0] || null;
    if (melhor && melhor.total < pagoTotal - 0.001) {
      melhorTotal = melhor.total;
      substituta = melhor.transportadora;
      cobertura = melhor.cobertos;
      // prazo médio do cenário substituto
      for (const c of casos) {
        const q = c.candMap.get(melhor.transportadora);
        const p = (q && q.prazo > 0) ? q.prazo : c.prazoReal;
        if (p > 0) { prazoMelhorSoma += p; prazoMelhorN += 1; }
      }
    } else {
      melhorTotal = pagoTotal;
      prazoMelhorSoma = prazoRealSoma; prazoMelhorN = prazoRealN;
    }
  }

  const reducaoRs = Math.round((pagoTotal - melhorTotal) * 100) / 100;
  return {
    ctes: casos.length,
    pagoTotal, melhorTotal, pesoTotal, nfTotal,
    reducaoRs,
    reducaoPct: pagoTotal > 0 ? (reducaoRs / pagoTotal) * 100 : 0,
    substituta, cobertura,
    prazoRealMedio: prazoRealN > 0 ? prazoRealSoma / prazoRealN : null,
    prazoMelhorMedio: prazoMelhorN > 0 ? prazoMelhorSoma / prazoMelhorN : null,
    ranking: ranking.slice(0, 8),
  };
}

function valorMetrica(metrica, totalRs, pesoTotal, nfTotal, ctes) {
  if (metrica === 'rs') return totalRs;
  if (metrica === 'freteNf') return nfTotal > 0 ? (totalRs / nfTotal) * 100 : null;
  if (metrica === 'rskg') return pesoTotal > 0 ? totalRs / pesoTotal : null;
  if (metrica === 'rscte') return ctes > 0 ? totalRs / ctes : null;
  return totalRs;
}

function Card({ label, valor, sub, cor, destaque }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${destaque ? cor : '#e2e8f0'}`, borderLeft: `4px solid ${cor}`, borderRadius: 10, padding: '12px 18px', minWidth: 160 }}>
      <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '1.45rem', fontWeight: 800, color: destaque ? cor : '#1e293b' }}>{valor}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Segmentado({ opcoes, valor, onChange }) {
  return (
    <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, background: '#f1f5f9', borderRadius: 8, padding: 3 }}>
      {opcoes.map((o) => (
        <button key={o.id} type="button" title={o.dica || ''} onClick={() => onChange(o.id)}
          style={{ border: 'none', cursor: 'pointer', borderRadius: 6, padding: '5px 12px', fontSize: '0.8rem', fontWeight: valor === o.id ? 700 : 500, background: valor === o.id ? '#9153F0' : 'transparent', color: valor === o.id ? '#fff' : '#475569' }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MultiFiltro({ label, opcoes, selecionados, onChange }) {
  const [aberto, setAberto] = useState(false);
  const sel = selecionados.length;
  const toggle = (op) => onChange(selecionados.includes(op) ? selecionados.filter((x) => x !== op) : [...selecionados, op]);
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setAberto((v) => !v)}
        style={{ width: '100%', textAlign: 'left', padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: sel ? '#f5f3ff' : '#fff', fontSize: '0.82rem', cursor: 'pointer', color: '#334155' }}>
        {label}: <strong>{sel ? `${sel} de ${opcoes.length}` : 'Todos'}</strong> {aberto ? '▲' : '▼'}
      </button>
      {aberto && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 240, overflowY: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 6 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6, borderBottom: '1px solid #eee', paddingBottom: 6 }}>
            <button type="button" onClick={() => onChange([...opcoes])} style={{ fontSize: '0.72rem', cursor: 'pointer', border: 'none', background: 'none', color: '#9153F0' }}>Todos</button>
            <button type="button" onClick={() => onChange([])} style={{ fontSize: '0.72rem', cursor: 'pointer', border: 'none', background: 'none', color: '#9153F0' }}>Limpar</button>
          </div>
          {opcoes.map((op) => (
            <label key={op} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', fontSize: '0.8rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={selecionados.includes(op)} onChange={() => toggle(op)} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op || '(vazio)'}</span>
            </label>
          ))}
          {!opcoes.length && <div style={{ fontSize: '0.78rem', color: '#94a3b8', padding: 4 }}>Sem opções</div>}
        </div>
      )}
    </div>
  );
}

export default function OportunidadeTransportadoraPage() {
  const [competencia, setCompetencia] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [canal, setCanal] = useState('');
  const [limiteInput, setLimiteInput] = useState('4000');

  const [status, setStatus] = useState('idle');
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const [bruto, setBruto] = useState(null); // { casos, carriersByOrigin, carriersByRoute, totalCtes, diagTotal }

  const [candidateMode, setCandidateMode] = useState('qualquer');
  const [scenarioMode, setScenarioMode] = useState('substituta');
  const [metrica, setMetrica] = useState('rs');
  const [filtros, setFiltros] = useState(FILTROS_PADRAO);
  const [expandido, setExpandido] = useState(null);

  const setF = (k, v) => setFiltros((p) => ({ ...p, [k]: v }));

  async function processar() {
    setStatus('carregando'); setErro(''); setBruto(null); setExpandido(null);
    setFiltros((p) => ({ ...FILTROS_PADRAO, soComReducao: p.soComReducao }));
    try {
      setProgresso('Carregando tabelas de frete...');
      const base = normalizarTransportadoras(await carregarBaseCompletaDb());
      if (!base.length) throw new Error('Nenhuma tabela de frete cadastrada.');
      const idx = indexarBase(base);
      const mapBaseByNome = new Map(base.map((t) => [t.nome, t]));
      const origemCache = new Map();

      setProgresso('Carregando planilha de IBGE...');
      const municipios = await carregarMunicipiosIbgeDb().catch(() => []);
      const mapasIbge = montarMapasIbge(municipios);
      const municipioPorCidade = montarMunicipioPorCidade(municipios);

      setProgresso('Carregando CT-es...');
      const ctes = await carregarCtes({
        competencia,
        dataInicio: dataInicio || undefined,
        dataFim: dataFim || undefined,
        canal: canal || undefined,
        limite: Number(limiteInput) || 4000,
        onProgress: ({ carregados }) => setProgresso(`Carregando CT-es... ${carregados}`),
      });
      if (!ctes.length) throw new Error('Nenhum CT-e encontrado para este recorte.');

      const casos = [];
      const carriersByOrigin = new Map();
      const carriersByRoute = new Map();
      const diagTotal = { CALCULADO: 0, SEM_TABELA: 0, SEM_ORIGEM: 0, SEM_ROTA: 0, SEM_FAIXA: 0, ORIGEM_ERRADA: 0, OUTRO: 0, SEM_IBGE: 0 };

      setProgresso(`Simulando ${fmtN(ctes.length)} CT-es contra as transportadoras de cada origem...`);
      const t0 = Date.now();
      for (let i = 0; i < ctes.length; i++) {
        const cte = ctes[i];
        const cidadeOrigem = cte.cidade_origem || cte.origem || '';
        const ufOrigem = String(cte.uf_origem || '').toUpperCase();
        const cidadeDestino = cte.cidade_destino || cte.destino || '';
        const ufDestino = String(cte.uf_destino || '').toUpperCase();
        const transportadoraReal = (cte.transportadora || cte.nome_transportadora || '').trim();
        const valorPago = safeNum(cte.valor_cte || cte.frete_pago || cte.valor_frete);

        const ibgeDestino = ibgeDoCte(cte, 'destino', municipioPorCidade, mapasIbge);
        const ibgeOrigemReal = ibgeDoCte(cte, 'origem', municipioPorCidade, mapasIbge);

        const originKey = `${norm(cidadeOrigem)}|${ufOrigem}`;
        const routeKey = `${originKey}=>${norm(cidadeDestino)}|${ufDestino}`;
        if (transportadoraReal) {
          if (!carriersByOrigin.has(originKey)) carriersByOrigin.set(originKey, new Set());
          carriersByOrigin.get(originKey).add(norm(transportadoraReal));
          if (!carriersByRoute.has(routeKey)) carriersByRoute.set(routeKey, new Set());
          carriersByRoute.get(routeKey).add(norm(transportadoraReal));
        }

        let custos = [];
        if (!ibgeDestino || !ibgeOrigemReal) {
          diagTotal.SEM_IBGE += 1;
        } else {
          // só roda o motor nas transportadoras que atendem origem E têm rota pro destino
          const setOrigem = nomesPorOrigem(idx, dig7(ibgeOrigemReal), normCmp(cidadeOrigem), origemCache);
          const setDestino = idx.porDestinoIbge.get(dig7(ibgeDestino));
          const candidatas = [];
          if (setDestino) for (const nome of setOrigem) if (setDestino.has(nome)) { const t = mapBaseByNome.get(nome); if (t) candidatas.push(t); }
          const { resultados, statusCounts } = simularTodas(cte, base, candidatas, ibgeOrigemReal, ibgeDestino, cidadeOrigem);
          for (const [k, v] of Object.entries(statusCounts)) diagTotal[k] = (diagTotal[k] || 0) + v;
          custos = resultados;
        }

        casos.push({
          transportadoraReal, cidadeOrigem, ufOrigem, cidadeDestino, ufDestino,
          regiao: regiaoDeUf(ufOrigem),
          originKey, routeKey,
          peso: safeNum(cte.peso_declarado || cte.peso),
          valorNf: safeNum(cte.valor_nf || cte.nf_venda),
          valorPago,
          prazoReal: safeNum(custos.find((c) => norm(c.transportadora) === norm(transportadoraReal))?.prazo),
          custos,
        });

        if (i % 100 === 0 || i === ctes.length - 1) {
          const feitos = i + 1;
          const pctFeito = Math.round((feitos / ctes.length) * 100);
          const decorrido = (Date.now() - t0) / 1000;
          const restante = feitos > 0 ? (decorrido / feitos) * (ctes.length - feitos) : 0;
          const tempo = (s) => (s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.round(s)}s`);
          setProgresso(`Simulando... ${fmtN(feitos)}/${fmtN(ctes.length)} (${pctFeito}%) · ${tempo(decorrido)} decorridos${restante > 0 ? ` · ~${tempo(restante)} restantes` : ''}`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      setBruto({ casos, carriersByOrigin, carriersByRoute, totalCtes: ctes.length, diagTotal });
      setStatus('concluido'); setProgresso('');
    } catch (e) {
      console.error('[OportunidadeTransportadora]', e);
      setErro(`${e.message || e}`);
      setStatus('erro'); setProgresso('');
    }
  }

  const opcoes = useMemo(() => {
    if (!bruto) return { regioes: [], ufsOrigem: [], transpReal: [] };
    const reg = new Set(), uf = new Set(), tr = new Set();
    for (const c of bruto.casos) {
      if (c.regiao) reg.add(c.regiao);
      if (c.ufOrigem) uf.add(c.ufOrigem);
      if (c.transportadoraReal) tr.add(c.transportadoraReal);
    }
    return {
      regioes: ORDEM_REGIAO.filter((r) => reg.has(r)),
      ufsOrigem: Array.from(uf).sort(),
      transpReal: Array.from(tr).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    };
  }, [bruto]);

  const resultado = useMemo(() => {
    if (!bruto) return null;

    // 1) filtra casos e monta candidatas por modo
    const grupos = new Map();
    for (const c of bruto.casos) {
      if (!passaLista(c.regiao, filtros.regioes)) continue;
      if (!passaLista(c.ufOrigem, filtros.ufsOrigem)) continue;
      if (!passaLista(c.transportadoraReal, filtros.transportadorasRealizadas)) continue;

      let candidatos = c.custos;
      if (candidateMode === 'area') {
        const set = bruto.carriersByOrigin.get(c.originKey);
        candidatos = set ? candidatos.filter((q) => set.has(norm(q.transportadora))) : [];
      } else if (candidateMode === 'rota') {
        const set = bruto.carriersByRoute.get(c.routeKey);
        candidatos = set ? candidatos.filter((q) => set.has(norm(q.transportadora))) : [];
      }
      const candMap = new Map();
      for (const q of candidatos) candMap.set(q.transportadora, q);
      const caso = { ...c, candidatos, candMap };

      const key = `${c.transportadoraReal}|${c.originKey}`;
      if (!grupos.has(key)) grupos.set(key, { key, transportadoraReal: c.transportadoraReal, cidadeOrigem: c.cidadeOrigem, ufOrigem: c.ufOrigem, regiao: c.regiao, casos: [] });
      grupos.get(key).casos.push(caso);
    }

    // 2) calcula cada grupo
    let linhas = Array.from(grupos.values()).map((g) => {
      const calc = calcularGrupo(g.casos, scenarioMode);
      return {
        ...g,
        ...calc,
        custoAtual: valorMetrica(metrica, calc.pagoTotal, calc.pesoTotal, calc.nfTotal, calc.ctes),
        custoMelhor: valorMetrica(metrica, calc.melhorTotal, calc.pesoTotal, calc.nfTotal, calc.ctes),
      };
    });
    if (filtros.soComReducao) linhas = linhas.filter((l) => l.reducaoRs > TOLERANCIA);
    linhas.sort((a, b) => b.reducaoRs - a.reducaoRs);

    // 3) agrupa por região (com subtotais)
    const porRegiao = new Map();
    for (const l of linhas) {
      if (!porRegiao.has(l.regiao)) porRegiao.set(l.regiao, { regiao: l.regiao, linhas: [], pagoTotal: 0, melhorTotal: 0, reducaoRs: 0 });
      const r = porRegiao.get(l.regiao);
      r.linhas.push(l); r.pagoTotal += l.pagoTotal; r.melhorTotal += l.melhorTotal; r.reducaoRs += l.reducaoRs;
    }
    const regioes = ORDEM_REGIAO.filter((r) => porRegiao.has(r)).map((r) => porRegiao.get(r));

    const pagoTotal = linhas.reduce((s, l) => s + l.pagoTotal, 0);
    const melhorTotal = linhas.reduce((s, l) => s + l.melhorTotal, 0);
    const reducaoTotal = Math.round((pagoTotal - melhorTotal) * 100) / 100;

    return {
      regioes, totalLinhas: linhas.length, totalCtes: bruto.totalCtes,
      pagoTotal, melhorTotal, reducaoTotal,
      reducaoPct: pagoTotal > 0 ? (reducaoTotal / pagoTotal) * 100 : 0,
      diagTotal: bruto.diagTotal,
    };
  }, [bruto, filtros, candidateMode, scenarioMode, metrica]);

  const filtrosAtivos = filtros.regioes.length || filtros.ufsOrigem.length || filtros.transportadorasRealizadas.length;
  const metricaLabel = METRICAS.find((m) => m.id === metrica)?.label || '';

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Análise</div>
        <h1>Oportunidade por Transportadora</h1>
        <p>Custo realizado vs. melhor cenário simulado, por transportadora e origem — mesma origem, trocando quem opera. Alvo de redução para a negociação puxada pela baixa do diesel.</p>
      </div>

      {erro && <div className="sim-alert error">{erro}</div>}

      <section className="sim-card">
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
          <label>Competência (mês)<input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} /></label>
          <label>Período — início<input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} /></label>
          <label>Período — fim<input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></label>
          <label>Canal
            <select value={canal} onChange={(e) => setCanal(e.target.value)} style={{ width: '100%' }}>
              <option value="">Todos</option>
              <option value="B2C">B2C</option>
              <option value="ATACADO">ATACADO</option>
              <option value="INTERCOMPANY">INTERCOMPANY</option>
              <option value="REVERSA">REVERSA</option>
            </select>
          </label>
        </div>
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
          <label>Limite de CT-es <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.72rem' }}>(só sem mês/período)</span>
            <input type="number" value={limiteInput} onChange={(e) => setLimiteInput(e.target.value)} min={100} max={200000} step={1000} />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="primary" type="button" onClick={processar} disabled={status === 'carregando'}>
              {status === 'carregando' ? 'Processando...' : 'Analisar oportunidade'}
            </button>
            {bruto && <button className="sim-tab" type="button" onClick={() => { setBruto(null); setStatus('idle'); }}>Limpar</button>}
          </div>
        </div>

        {progresso && (
          <div style={{ marginTop: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #93c5fd', borderTop: '2px solid #1d4ed8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            {progresso}
          </div>
        )}
      </section>

      {resultado && (
        <>
          {/* Painel de controle do cenário */}
          <section className="sim-card" style={{ marginBottom: '1rem' }}>
            <strong style={{ fontSize: '0.9rem', color: '#334155', display: 'block', marginBottom: 10 }}>Painel de cenário</strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: '#64748b', width: 120 }}>Quem pode substituir</span>
                <Segmentado opcoes={MODOS_CANDIDATA} valor={candidateMode} onChange={setCandidateMode} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: '#64748b', width: 120 }}>Melhor cenário</span>
                <Segmentado opcoes={MODOS_CENARIO} valor={scenarioMode} onChange={setScenarioMode} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: '#64748b', width: 120 }}>Métrica exibida</span>
                <Segmentado opcoes={METRICAS} valor={metrica} onChange={setMetrica} />
              </div>
            </div>
          </section>

          {/* Filtros */}
          <section className="sim-card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <strong style={{ fontSize: '0.9rem', color: '#334155' }}>Filtros</strong>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={filtros.soComReducao} onChange={(e) => setF('soComReducao', e.target.checked)} />
                  Apenas com redução
                </label>
                {filtrosAtivos ? <button type="button" className="sim-tab" onClick={() => setFiltros((p) => ({ ...FILTROS_PADRAO, soComReducao: p.soComReducao }))}>Limpar filtros</button> : null}
              </div>
            </div>
            <div className="sim-form-grid sim-grid-4" style={{ gap: 10 }}>
              <MultiFiltro label="Região" opcoes={opcoes.regioes} selecionados={filtros.regioes} onChange={(v) => setF('regioes', v)} />
              <MultiFiltro label="UF origem" opcoes={opcoes.ufsOrigem} selecionados={filtros.ufsOrigem} onChange={(v) => setF('ufsOrigem', v)} />
              <MultiFiltro label="Transportadora realizada" opcoes={opcoes.transpReal} selecionados={filtros.transportadorasRealizadas} onChange={(v) => setF('transportadorasRealizadas', v)} />
            </div>
          </section>

          <div className="summary-strip" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <Card label="Linhas (transp. × origem)" valor={fmtN(resultado.totalLinhas)} sub={`de ${fmtN(resultado.totalCtes)} CT-es`} cor="#9153F0" />
            <Card label="Custo atual (total)" valor={fmt(resultado.pagoTotal)} sub="frete pago no recorte" cor="#1e293b" />
            <Card label="Melhor cenário (total)" valor={fmt(resultado.melhorTotal)} sub={MODOS_CENARIO.find((m) => m.id === scenarioMode)?.label} cor="#04C7A4" />
            <Card label="Redução potencial" valor={fmt(resultado.reducaoTotal)} sub={pct(resultado.reducaoPct)} cor="#9b1111" destaque={resultado.reducaoTotal > 0} />
          </div>

          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 16px', marginBottom: '1rem', fontSize: '0.84rem', color: '#166534' }}>
            <strong>Diagnóstico simulação:</strong> {fmtN(resultado.diagTotal?.CALCULADO || 0)} cotações válidas (mesma origem) · {fmtN(resultado.diagTotal?.ORIGEM_ERRADA || 0)} descartadas (origem diferente) · {fmtN(resultado.diagTotal?.SEM_ROTA || 0)} sem rota · {fmtN(resultado.diagTotal?.SEM_FAIXA || 0)} sem faixa de peso · {fmtN(resultado.diagTotal?.SEM_IBGE || 0)} CT-es sem IBGE.
          </div>

          <div className="panel-card">
            <div className="panel-title" style={{ marginBottom: '0.5rem' }}>
              Transportadora × Origem — métrica: {metricaLabel}
              <span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#94a3b8' }}> · clique na linha para ver as candidatas</span>
            </div>
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead>
                  <tr>
                    <th>Transportadora</th>
                    <th>Origem</th>
                    <th>UF</th>
                    <th>CT-es</th>
                    <th>{metricaLabel} atual</th>
                    <th>Melhor cenário</th>
                    <th>Redução R$</th>
                    <th>Redução %</th>
                    <th>Substituta</th>
                    <th>Prazo (real→melhor)</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.regioes.map((reg) => (
                    <React.Fragment key={reg.regiao}>
                      <tr style={{ background: '#f1f5f9' }}>
                        <td colSpan={6} style={{ fontWeight: 800, color: '#4E008F', letterSpacing: '0.03em' }}>{reg.regiao}</td>
                        <td className="negativo" style={{ fontWeight: 700 }}>{fmt(reg.reducaoRs)}</td>
                        <td>{pct(reg.pagoTotal > 0 ? (reg.reducaoRs / reg.pagoTotal) * 100 : 0)}</td>
                        <td colSpan={2} style={{ fontSize: '0.76rem', color: '#64748b' }}>{reg.linhas.length} linhas</td>
                      </tr>
                      {reg.linhas.map((l) => {
                        const id = l.key;
                        const aberto = expandido === id;
                        return (
                          <React.Fragment key={id}>
                            <tr onClick={() => setExpandido(aberto ? null : id)} style={{ cursor: 'pointer' }}>
                              <td style={{ fontWeight: 600 }}>{aberto ? '▼ ' : '▶ '}{l.transportadoraReal || '—'}</td>
                              <td>{l.cidadeOrigem || '—'}</td>
                              <td>{l.ufOrigem}</td>
                              <td>{fmtN(l.ctes)}</td>
                              <td>{fmtMetrica(metrica, l.custoAtual)}</td>
                              <td style={{ color: '#04C7A4', fontWeight: 600 }}>{fmtMetrica(metrica, l.custoMelhor)}</td>
                              <td className={l.reducaoRs > TOLERANCIA ? 'negativo' : ''} style={{ fontWeight: l.reducaoRs > TOLERANCIA ? 700 : 400 }}>{l.reducaoRs > TOLERANCIA ? fmt(l.reducaoRs) : '—'}</td>
                              <td style={{ fontWeight: 600, color: l.reducaoPct > 0 ? '#9b1111' : '#94a3b8' }}>{l.reducaoPct > 0 ? pct(l.reducaoPct) : '—'}</td>
                              <td style={{ fontSize: '0.8rem' }}>
                                {l.substituta ? (
                                  <span>{norm(l.substituta) === norm(l.transportadoraReal) ? `${l.substituta} (própria tabela)` : l.substituta}
                                    {l.ctes > 1 && <span style={{ color: '#94a3b8' }}> · {fmtN(l.cobertura)}/{fmtN(l.ctes)}</span>}
                                  </span>
                                ) : '—'}
                              </td>
                              <td style={{ whiteSpace: 'nowrap', color: '#64748b' }}>
                                {l.prazoRealMedio != null ? `${l.prazoRealMedio.toFixed(1)}d` : '?'} → {l.prazoMelhorMedio != null ? `${l.prazoMelhorMedio.toFixed(1)}d` : '?'}
                              </td>
                            </tr>
                            {aberto && (
                              <tr>
                                <td colSpan={10} style={{ background: '#faf5ff', padding: '12px 16px' }}>
                                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 8 }}>
                                    Candidatas para <strong>{l.cidadeOrigem}/{l.ufOrigem}</strong> (custo total nos {fmtN(l.ctes)} CT-es do grupo, cobertura e prazo médio):
                                  </div>
                                  <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                                    <thead>
                                      <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                                        <th style={{ padding: '2px 8px' }}>#</th><th style={{ padding: '2px 8px' }}>Transportadora</th>
                                        <th style={{ padding: '2px 8px' }}>Custo total</th><th style={{ padding: '2px 8px' }}>vs. pago</th>
                                        <th style={{ padding: '2px 8px' }}>Cobertura</th><th style={{ padding: '2px 8px' }}>Prazo médio</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr style={{ background: '#fff' }}>
                                        <td style={{ padding: '2px 8px' }}>—</td>
                                        <td style={{ padding: '2px 8px', fontWeight: 700 }}>{l.transportadoraReal} (pago real)</td>
                                        <td style={{ padding: '2px 8px' }}>{fmt(l.pagoTotal)}</td>
                                        <td style={{ padding: '2px 8px' }}>—</td>
                                        <td style={{ padding: '2px 8px' }}>{fmtN(l.ctes)}/{fmtN(l.ctes)}</td>
                                        <td style={{ padding: '2px 8px' }}>{l.prazoRealMedio != null ? `${l.prazoRealMedio.toFixed(1)}d` : '—'}</td>
                                      </tr>
                                      {l.ranking.map((r, i) => {
                                        const dif = l.pagoTotal - r.total;
                                        return (
                                          <tr key={r.transportadora} style={{ background: i === 0 ? '#ecfdf5' : 'transparent' }}>
                                            <td style={{ padding: '2px 8px' }}>{i + 1}</td>
                                            <td style={{ padding: '2px 8px', fontWeight: i === 0 ? 700 : 400 }}>{r.transportadora}</td>
                                            <td style={{ padding: '2px 8px' }}>{fmt(r.total)}</td>
                                            <td style={{ padding: '2px 8px', color: dif > 0 ? '#04C7A4' : '#9b1111' }}>{dif > 0 ? `−${fmt(dif)}` : `+${fmt(-dif)}`}</td>
                                            <td style={{ padding: '2px 8px' }}>{fmtN(r.cobertos)}/{fmtN(l.ctes)}</td>
                                            <td style={{ padding: '2px 8px' }}>{r.prazoMedio != null ? `${r.prazoMedio.toFixed(1)}d` : '—'}</td>
                                          </tr>
                                        );
                                      })}
                                      {!l.ranking.length && <tr><td colSpan={6} style={{ padding: '4px 8px', color: '#94a3b8' }}>Nenhuma candidata com tabela na mesma origem para este modo.</td></tr>}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  ))}
                  {!resultado.regioes.length && <tr><td colSpan={10}>Nenhuma linha com os filtros atuais.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
