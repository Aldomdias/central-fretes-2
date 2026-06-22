import React, { useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarBaseCompletaDb, carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';
import { normalizarTransportadoras, processarCte } from '../services/auditoriaCteProcessamentoService';
import { montarMapasIbge, resolverIbgeLocal } from '../utils/realizadoLocalEngine';
import { filtrarCpComercialCte } from '../services/cteBasePolicy';
import { carregarVinculosTransportadoras, criarMapaVinculosTransportadoras, aplicarVinculoTransportadora } from '../services/vinculosTransportadorasService';

const LIMITE_MAX_CT = 200000;
const TOLERANCIA = 0.5; // R$ — diferença abaixo disto é ruído

function safeNum(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function fmt(v) { return safeNum(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function fmtN(v) { return safeNum(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function pct(v) { return `${safeNum(v).toFixed(1).replace('.', ',')}%`; }
function fmtDias(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const txt = Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
  return `${txt} d`;
}
function chaveCurta(chave) {
  const s = String(chave || '');
  return s.length > 12 ? `…${s.slice(-10)}` : (s || '—');
}
function fmtData(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString('pt-BR');
}
function norm(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function dig7(v) { return String(v || '').replace(/\D/g, '').slice(0, 7); }
function normalizeBuscaIbge(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
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
function canalRealDe(cte) {
  return cte.canal_original && norm(cte.canal) === 'ADEFINIR'
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
    const kCidade = normalizeBuscaIbge(cidade);
    const kCidadeUf = normalizeBuscaIbge(`${cidade}/${uf}`);
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
  const viaPlanilha = municipioPorCidade.get(normalizeBuscaIbge(`${cidade}/${uf}`)) || municipioPorCidade.get(normalizeBuscaIbge(cidade));
  if (viaPlanilha) return viaPlanilha;
  return resolverIbgeLocal(cidade, uf, mapasIbge) || '';
}

function indexarBase(base) {
  const porOrigemIbge = new Map();
  const porDestinoIbge = new Map();
  const origensCidade = [];
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

// Igual ao motor da Oportunidade Transportadora, mas SEM a transportadora que está saindo.
function simularSubstitutas(cte, base, candidatas, ibgeOrigemReal, ibgeDestino, cidadeOrigemReal, nomeExcluir) {
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
  for (const transp of candidatas) {
    if (norm(transp.nome) === norm(nomeExcluir)) continue;
    const teste = { ...cteBase, transportadora: transp.nome, nome_transportadora: transp.nome };
    let r;
    try { r = processarCte(teste, base); } catch { continue; }
    if (r.status_calculo !== 'CALCULADO') continue;
    if (!cidadeBate(normCmp(r.detalhes_calculo?.origem_cidade), origemRealCmp)) continue;
    const total = safeNum(r.valor_calculado);
    if (total <= 0) continue;
    resultados.push({ transportadora: transp.nome, total, prazo: safeNum(r.detalhes_calculo?.rota_prazo) });
  }
  resultados.sort((a, b) => a.total - b.total);
  return resultados;
}

// Roda o motor para UMA transportadora específica (a atual) — usado para pegar
// o prazo de tabela e o valor que a própria transportadora deveria cobrar.
function calcComTransportadora(cte, base, nome, ibgeOrigemReal, ibgeDestino, cidadeOrigemReal) {
  const canalReal = canalRealDe(cte);
  const cteBase = {
    ...cte,
    canal: canalReal,
    canal_original: canalReal,
    ibge_origem: ibgeOrigemReal || '',
    ibge_corrigido_origem: ibgeOrigemReal || '',
    ibge_destino: ibgeDestino || '',
    ibge_corrigido_destino: ibgeDestino || '',
    transportadora: nome,
    nome_transportadora: nome,
  };
  let r;
  try { r = processarCte(cteBase, base); } catch { return null; }
  if (r.status_calculo !== 'CALCULADO') return null;
  if (!cidadeBate(normCmp(r.detalhes_calculo?.origem_cidade), normCmp(cidadeOrigemReal))) return null;
  const total = safeNum(r.valor_calculado);
  return { total, prazo: r.detalhes_calculo?.rota_prazo != null ? safeNum(r.detalhes_calculo.rota_prazo) : null };
}

const LIMITES_PADRAO = '6000';

async function carregarCtes({ competencia, dataInicio, dataFim, canal, limite, onProgress }) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const supabase = getSupabaseClient();
  const teto = Math.max(100, Math.min(Number(limite) || 6000, LIMITE_MAX_CT));
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

function Card({ label, valor, sub, cor, destaque }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${destaque ? cor : '#e2e8f0'}`, borderLeft: `4px solid ${cor}`, borderRadius: 10, padding: '12px 18px', minWidth: 170 }}>
      <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '1.45rem', fontWeight: 800, color: destaque ? cor : '#1e293b' }}>{valor}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Agrega os CT-es simulados em rotas, aplicando o conjunto de substitutas excluídas.
// Pura: roda na hora quando muda a exclusão ou o reajuste, sem reprocessar o motor.
function agregarRotas(ctesSimulados, exclusoesSet, pctReajuste) {
  const porRota = new Map();
  for (const c of ctesSimulados) {
    if (!porRota.has(c.rotaKey)) {
      porRota.set(c.rotaKey, {
        rotaKey: c.rotaKey, cidadeOrigem: c.cidadeOrigem, ufOrigem: c.ufOrigem, cidadeDestino: c.cidadeDestino, ufDestino: c.ufDestino,
        ctes: 0, valorPagoTotal: 0, melhorTotal: 0, semSubstituto: 0, candidatosUsados: new Map(),
        prazoAtualSoma: 0, prazoAtualN: 0, prazoSubSoma: 0, prazoSubN: 0, viagens: [], substitutosRota: new Map(),
      });
    }
    const rota = porRota.get(c.rotaKey);
    rota.ctes += 1;
    rota.valorPagoTotal += c.valorPago;
    if (c.prazoAtual != null) { rota.prazoAtualSoma += c.prazoAtual; rota.prazoAtualN += 1; }

    const disponiveis = exclusoesSet.size
      ? c.resultados.filter((r) => !exclusoesSet.has(norm(r.transportadora)))
      : c.resultados;
    for (const res of disponiveis) {
      const cur = rota.substitutosRota.get(res.transportadora)
        || { transportadora: res.transportadora, ctesCobertos: 0, somaTotal: 0, prazoSoma: 0, prazoN: 0 };
      cur.ctesCobertos += 1; cur.somaTotal += res.total;
      if (res.prazo != null) { cur.prazoSoma += res.prazo; cur.prazoN += 1; }
      rota.substitutosRota.set(res.transportadora, cur);
    }
    const melhor = disponiveis[0] || null;
    if (melhor) {
      rota.melhorTotal += melhor.total;
      rota.candidatosUsados.set(melhor.transportadora, (rota.candidatosUsados.get(melhor.transportadora) || 0) + 1);
      if (melhor.prazo != null) { rota.prazoSubSoma += melhor.prazo; rota.prazoSubN += 1; }
    } else {
      rota.melhorTotal += c.valorPago;
      rota.semSubstituto += 1;
    }
    rota.viagens.push({
      chave: c.chave, data: c.data, nf: c.nf, peso: c.peso, valorPago: c.valorPago,
      valorTabelaAtual: c.valorTabelaAtual, prazoAtual: c.prazoAtual,
      substituta: melhor ? melhor.transportadora : null,
      valorSub: melhor ? melhor.total : null,
      prazoSub: melhor ? melhor.prazo : null,
    });
  }

  const linhas = Array.from(porRota.values()).map((r) => {
    const substitutos = [...r.substitutosRota.values()].map((s) => ({
      transportadora: s.transportadora, ctesCobertos: s.ctesCobertos,
      custoMedio: s.ctesCobertos ? s.somaTotal / s.ctesCobertos : 0,
      prazoMedio: s.prazoN ? s.prazoSoma / s.prazoN : null,
    })).sort((a, b) => (b.ctesCobertos - a.ctesCobertos) || (a.custoMedio - b.custoMedio));
    return {
      ...r,
      diferenca: r.melhorTotal - r.valorPagoTotal,
      substitutoPrincipal: [...r.candidatosUsados.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      prazoAtualMedio: r.prazoAtualN ? r.prazoAtualSoma / r.prazoAtualN : null,
      prazoSubMedio: r.prazoSubN ? r.prazoSubSoma / r.prazoSubN : null,
      substitutos, qtdSubstitutos: substitutos.length,
    };
  });
  linhas.sort((a, b) => b.valorPagoTotal - a.valorPagoTotal);

  const custoAtual = linhas.reduce((s, l) => s + l.valorPagoTotal, 0);
  const custoComSubstitutos = linhas.reduce((s, l) => s + l.melhorTotal, 0);
  const rotasSemSubstituto = linhas.filter((l) => l.semSubstituto > 0).length;
  const pctR = safeNum(pctReajuste);
  const custoComReajuste = custoAtual * (1 + pctR / 100);
  const aumentoPctSubstitutos = custoAtual > 0 ? ((custoComSubstitutos - custoAtual) / custoAtual) * 100 : 0;
  const economiaVsReajuste = custoComReajuste - custoComSubstitutos;
  const prazoAtualSomaTot = linhas.reduce((s, l) => s + l.prazoAtualSoma, 0);
  const prazoAtualNTot = linhas.reduce((s, l) => s + l.prazoAtualN, 0);
  const prazoSubSomaTot = linhas.reduce((s, l) => s + l.prazoSubSoma, 0);
  const prazoSubNTot = linhas.reduce((s, l) => s + l.prazoSubN, 0);

  return {
    linhas, totalRotas: linhas.length, rotasSemSubstituto,
    custoAtual, custoComSubstitutos, custoComReajuste, aumentoPctSubstitutos, economiaVsReajuste, pctReajuste: pctR,
    prazoAtualMedioGeral: prazoAtualNTot ? prazoAtualSomaTot / prazoAtualNTot : null,
    prazoSubMedioGeral: prazoSubNTot ? prazoSubSomaTot / prazoSubNTot : null,
  };
}

function FiltroExcluir({ opcoes, exclusoes, onToggle, onLimpar }) {
  if (!opcoes.length) return null;
  return (
    <details className="sst-filtro">
      <summary className="sim-tab" style={{ cursor: 'pointer', listStyle: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        Excluir substitutas{exclusoes.size ? ` · ${exclusoes.size}` : ''} ▾
      </summary>
      <div className="sst-filtro-pop">
        <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 6 }}>
          Marque quem você NÃO quer como substituta. A simulação recalcula com a próxima melhor opção.
        </div>
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {opcoes.map((nome) => (
            <label key={nome} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 2px', fontSize: '0.8rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={exclusoes.has(norm(nome))} onChange={() => onToggle(nome)} />
              {nome}
            </label>
          ))}
        </div>
        {exclusoes.size > 0 && (
          <button type="button" className="sim-tab" onClick={onLimpar} style={{ marginTop: 8, fontSize: '0.75rem', padding: '2px 10px' }}>Limpar exclusões</button>
        )}
      </div>
    </details>
  );
}

function DetalheRota({ linha }) {
  const MAX_VIAGENS = 200;
  const viagens = linha.viagens || [];
  const mostradas = viagens.slice(0, MAX_VIAGENS);
  const thStyle = { textAlign: 'left', padding: '4px 8px', fontSize: '0.72rem', color: '#64748b', borderBottom: '1px solid #e2e8f0' };
  const tdStyle = { padding: '4px 8px', fontSize: '0.78rem', borderBottom: '1px solid #f1f5f9' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#334155', marginBottom: 6 }}>
          Transportadoras que cobrem esta rota ({linha.qtdSubstitutos})
        </div>
        {linha.qtdSubstitutos === 0
          ? <div style={{ fontSize: '0.8rem', color: '#9b1111' }}>Nenhuma transportadora cadastrada cobre esta rota.</div>
          : (
            <table style={{ width: '100%', maxWidth: 680, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Transportadora</th>
                  <th style={thStyle}>Cobertura</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Custo médio/CT-e</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Prazo</th>
                </tr>
              </thead>
              <tbody>
                {linha.substitutos.map((s) => {
                  const principal = s.transportadora === linha.substitutoPrincipal;
                  const full = s.ctesCobertos >= linha.ctes;
                  return (
                    <tr key={s.transportadora}>
                      <td style={{ ...tdStyle, fontWeight: principal ? 700 : 400 }}>
                        {s.transportadora}
                        {principal && <span style={{ marginLeft: 6, color: '#04C7A4', fontSize: '0.68rem', fontWeight: 700 }}>★ principal</span>}
                      </td>
                      <td style={{ ...tdStyle, color: full ? '#047857' : '#b45309' }}>{fmtN(s.ctesCobertos)}/{fmtN(linha.ctes)} CT-es</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(s.custoMedio)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtDias(s.prazoMedio)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </div>

      <div>
        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#334155', marginBottom: 6 }}>
          Viagens ({fmtN(viagens.length)}{viagens.length > MAX_VIAGENS ? ` — mostrando as ${MAX_VIAGENS} primeiras` : ''})
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Emissão</th>
                <th style={thStyle}>CT-e</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>NF</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Peso</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Pago</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Tabela atual</th>
                <th style={thStyle}>Substituta</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Valor subst.</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Prazo at./sub.</th>
              </tr>
            </thead>
            <tbody>
              {mostradas.map((v, i) => (
                <tr key={v.chave || i}>
                  <td style={tdStyle}>{fmtData(v.data)}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.72rem' }}>{chaveCurta(v.chave)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(v.nf)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtN(v.peso)} kg</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(v.valorPago)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: '#94a3b8' }}>{v.valorTabelaAtual != null ? fmt(v.valorTabelaAtual) : '—'}</td>
                  <td style={tdStyle}>{v.substituta || <span style={{ color: '#9b1111' }}>nenhum</span>}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: v.valorSub != null && v.valorSub < v.valorPago ? '#047857' : '#1e293b', fontWeight: 600 }}>{v.valorSub != null ? fmt(v.valorSub) : '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtDias(v.prazoAtual)} / {fmtDias(v.prazoSub)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function SimularSaidaTransportadoraPage() {
  const [competencia, setCompetencia] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [canal, setCanal] = useState('');
  const [limiteInput, setLimiteInput] = useState(LIMITES_PADRAO);

  const [statusCarga, setStatusCarga] = useState('idle');
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const [base, setBase] = useState(null); // { ctes, baseFrete, idx, mapBaseByNome, municipioPorCidade, mapasIbge }

  const [transportadora, setTransportadora] = useState('');
  const [reajustePct, setReajustePct] = useState('20');
  const [statusSim, setStatusSim] = useState('idle');
  const [simulacao, setSimulacao] = useState(null); // { transportadora, ctesSimulados, semIbge }
  const [exclusoes, setExclusoes] = useState(() => new Set()); // norm(nome) das substitutas excluídas
  const [rotasAbertas, setRotasAbertas] = useState(() => new Set());

  function toggleRota(rotaKey) {
    setRotasAbertas((prev) => {
      const next = new Set(prev);
      if (next.has(rotaKey)) next.delete(rotaKey); else next.add(rotaKey);
      return next;
    });
  }

  function toggleExcluir(nome) {
    setExclusoes((prev) => {
      const next = new Set(prev);
      const k = norm(nome);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  const resultado = useMemo(() => {
    if (!simulacao) return null;
    return {
      ...agregarRotas(simulacao.ctesSimulados, exclusoes, reajustePct),
      totalCtes: simulacao.ctesSimulados.length,
      semIbge: simulacao.semIbge,
    };
  }, [simulacao, exclusoes, reajustePct]);

  const opcoesExcluir = useMemo(() => {
    if (!simulacao) return [];
    const set = new Set();
    for (const c of simulacao.ctesSimulados) for (const r of c.resultados) set.add(r.transportadora);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [simulacao]);

  async function carregar() {
    setStatusCarga('carregando'); setErro(''); setBase(null); setSimulacao(null); setExclusoes(new Set()); setTransportadora('');
    try {
      setProgresso('Carregando tabelas de frete...');
      const baseFrete = normalizarTransportadoras(await carregarBaseCompletaDb());
      if (!baseFrete.length) throw new Error('Nenhuma tabela de frete cadastrada.');
      const idx = indexarBase(baseFrete);
      const mapBaseByNome = new Map(baseFrete.map((t) => [t.nome, t]));

      setProgresso('Carregando planilha de IBGE...');
      const municipios = await carregarMunicipiosIbgeDb().catch(() => []);
      const mapasIbge = montarMapasIbge(municipios);
      const municipioPorCidade = montarMunicipioPorCidade(municipios);

      // vínculos: unificam o nome da transportadora executada (ex.: 3 "Brasil Web" viram 1)
      const vinculos = await carregarVinculosTransportadoras().catch(() => []);
      const mapaVinculos = criarMapaVinculosTransportadoras(vinculos);

      setProgresso('Carregando CT-es...');
      const ctes = await carregarCtes({
        competencia,
        dataInicio: dataInicio || undefined,
        dataFim: dataFim || undefined,
        canal: canal || undefined,
        limite: Number(limiteInput) || 6000,
        onProgress: ({ carregados }) => setProgresso(`Carregando CT-es... ${carregados}`),
      });
      if (!ctes.length) throw new Error('Nenhum CT-e encontrado para este recorte.');

      setBase({ ctes, baseFrete, idx, mapBaseByNome, municipioPorCidade, mapasIbge, mapaVinculos });
      setStatusCarga('concluido'); setProgresso('');
    } catch (e) {
      console.error('[SimularSaidaTransportadora]', e);
      setErro(`${e.message || e}`);
      setStatusCarga('erro'); setProgresso('');
    }
  }

  const transportadoras = useMemo(() => {
    if (!base) return [];
    const set = new Set();
    for (const c of base.ctes) {
      const bruto = (c.transportadora || c.nome_transportadora || '').trim();
      if (!bruto) continue;
      // nome unificado pelos vínculos (ex.: "BRASIL WEB GP" -> "BRASIL WEB")
      set.add(aplicarVinculoTransportadora(bruto, base.mapaVinculos) || bruto);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [base]);

  async function simularSaida() {
    if (!base || !transportadora) return;
    setStatusSim('carregando'); setErro(''); setSimulacao(null); setExclusoes(new Set()); setRotasAbertas(new Set());
    try {
      const { ctes, baseFrete, idx, mapBaseByNome, municipioPorCidade, mapasIbge, mapaVinculos } = base;
      // compara pelo nome unificado: pega todos os CT-es das variações vinculadas à transportadora escolhida
      const ctesDaTransp = ctes.filter((c) => norm(aplicarVinculoTransportadora(c.transportadora || c.nome_transportadora, mapaVinculos)) === norm(transportadora));
      if (!ctesDaTransp.length) throw new Error('Nenhum CT-e desta transportadora no recorte carregado.');

      const origemCache = new Map();
      const ctesSimulados = [];
      let semIbge = 0;

      setProgresso(`Simulando substitutas para ${fmtN(ctesDaTransp.length)} CT-es de ${transportadora}...`);
      const t0 = Date.now();
      for (let i = 0; i < ctesDaTransp.length; i++) {
        const cte = ctesDaTransp[i];
        const cidadeOrigem = cte.cidade_origem || cte.origem || '';
        const ufOrigem = String(cte.uf_origem || '').toUpperCase();
        const cidadeDestino = cte.cidade_destino || cte.destino || '';
        const ufDestino = String(cte.uf_destino || '').toUpperCase();
        const valorPago = safeNum(cte.valor_cte || cte.frete_pago || cte.valor_frete);

        const ibgeDestino = ibgeDoCte(cte, 'destino', municipioPorCidade, mapasIbge);
        const ibgeOrigemReal = ibgeDoCte(cte, 'origem', municipioPorCidade, mapasIbge);
        const rotaKey = `${norm(cidadeOrigem)}|${ufOrigem}=>${norm(cidadeDestino)}|${ufDestino}`;

        // prazo/tabela da própria transportadora atual (referência para auditar)
        const atual = (ibgeDestino && ibgeOrigemReal)
          ? calcComTransportadora(cte, baseFrete, transportadora, ibgeOrigemReal, ibgeDestino, cidadeOrigem)
          : null;

        let resultados = [];
        if (!ibgeDestino || !ibgeOrigemReal) {
          semIbge += 1;
        } else {
          const setOrigem = nomesPorOrigem(idx, dig7(ibgeOrigemReal), normCmp(cidadeOrigem), origemCache);
          const setDestino = idx.porDestinoIbge.get(dig7(ibgeDestino));
          const candidatas = [];
          if (setDestino) for (const nome of setOrigem) if (setDestino.has(nome)) { const t = mapBaseByNome.get(nome); if (t) candidatas.push(t); }
          resultados = simularSubstitutas(cte, baseFrete, candidatas, ibgeOrigemReal, ibgeDestino, cidadeOrigem, transportadora);
        }

        ctesSimulados.push({
          rotaKey, cidadeOrigem, ufOrigem, cidadeDestino, ufDestino,
          valorPago,
          nf: safeNum(cte.valor_nf || cte.nf_venda),
          peso: safeNum(cte.peso_declarado || cte.peso),
          chave: cte.chave_cte || '',
          data: cte.data_emissao || '',
          prazoAtual: atual?.prazo ?? null,
          valorTabelaAtual: atual ? atual.total : null,
          resultados,
        });

        if (i % 50 === 0 || i === ctesDaTransp.length - 1) {
          const feitos = i + 1;
          const decorrido = (Date.now() - t0) / 1000;
          setProgresso(`Simulando... ${fmtN(feitos)}/${fmtN(ctesDaTransp.length)} · ${decorrido.toFixed(0)}s`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      setSimulacao({ transportadora, ctesSimulados, semIbge });
      setStatusSim('concluido'); setProgresso('');
    } catch (e) {
      console.error('[SimularSaidaTransportadora]', e);
      setErro(`${e.message || e}`);
      setStatusSim('erro'); setProgresso('');
    }
  }

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Análise</div>
        <h1>Simular Saída de Transportadora</h1>
        <p>Se esta transportadora saísse hoje, quanto custaria rodar as rotas dela com as melhores substitutas disponíveis — e como isso se compara a aceitar um reajuste.</p>
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
            <button className="primary" type="button" onClick={carregar} disabled={statusCarga === 'carregando'}>
              {statusCarga === 'carregando' ? 'Carregando...' : 'Carregar CT-es'}
            </button>
            {base && <button className="sim-tab" type="button" onClick={() => { setBase(null); setSimulacao(null); setExclusoes(new Set()); setStatusCarga('idle'); }}>Limpar</button>}
          </div>
        </div>

        {progresso && (
          <div style={{ marginTop: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #93c5fd', borderTop: '2px solid #1d4ed8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            {progresso}
          </div>
        )}
      </section>

      {base && (
        <section className="sim-card" style={{ marginTop: '1rem' }}>
          <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
            <label>Transportadora a avaliar
              <select value={transportadora} onChange={(e) => setTransportadora(e.target.value)} style={{ width: '100%' }}>
                <option value="">Selecione...</option>
                {transportadoras.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>Reajuste proposto
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="number" value={reajustePct} onChange={(e) => setReajustePct(e.target.value)} style={{ width: 80 }} step={0.5} />
                <span>%</span>
              </div>
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <button className="primary" type="button" onClick={simularSaida} disabled={!transportadora || statusSim === 'carregando'}>
                {statusSim === 'carregando' ? 'Simulando...' : 'Simular saída'}
              </button>
            </div>
          </div>
        </section>
      )}

      {resultado && (
        <>
          <div className="summary-strip" style={{ flexWrap: 'wrap', gap: '0.75rem', margin: '1rem 0' }}>
            <Card label="Rotas atendidas" valor={fmtN(resultado.totalRotas)} sub={`${fmtN(resultado.totalCtes)} CT-es`} cor="#1e293b" />
            <Card label="Sem substituto" valor={fmtN(resultado.rotasSemSubstituto)} sub="rotas sem tabela alternativa" cor="#9b1111" destaque={resultado.rotasSemSubstituto > 0} />
            <Card label="Custo atual" valor={fmt(resultado.custoAtual)} sub="frete pago a esta transportadora" cor="#1e293b" />
            <Card label={`Custo c/ reajuste (+${pct(resultado.pctReajuste)})`} valor={fmt(resultado.custoComReajuste)} cor="#9b1111" />
            <Card label="Custo c/ substitutas" valor={fmt(resultado.custoComSubstitutos)} sub={pct(resultado.aumentoPctSubstitutos) + ' vs. custo atual'} cor="#04C7A4" />
            <Card label="Economia vs. aceitar reajuste" valor={fmt(resultado.economiaVsReajuste)} cor={resultado.economiaVsReajuste >= 0 ? '#04C7A4' : '#9b1111'} destaque />
            {(() => {
              const pa = resultado.prazoAtualMedioGeral, ps = resultado.prazoSubMedioGeral;
              const delta = (pa != null && ps != null) ? ps - pa : null;
              const corPrazo = delta == null ? '#1e293b' : (delta <= 0 ? '#04C7A4' : '#9b1111');
              const sub = delta == null ? 'prazo de tabela'
                : delta === 0 ? 'mesmo prazo'
                : (delta < 0 ? `${fmtDias(-delta)} mais rápido` : `${fmtDias(delta)} mais lento`);
              return <Card label="Prazo médio (atual → subst.)" valor={`${fmtDias(pa)} → ${fmtDias(ps)}`} sub={sub} cor={corPrazo} />;
            })()}
          </div>

          {resultado.semIbge > 0 && (
            <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 16px', marginBottom: '1rem', fontSize: '0.84rem', color: '#854d0e' }}>
              {fmtN(resultado.semIbge)} CT-e(s) sem IBGE de origem/destino resolvido — entraram no custo atual sem buscar substituto.
            </div>
          )}

          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 16px', marginBottom: '1rem', fontSize: '0.84rem', color: '#1d4ed8' }}>
            Os valores de substituta são preço de tabela. Capacidade real e SLA de quem assumiria o volume é avaliação da operação, não deste cálculo.
          </div>

          <div className="panel-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: '0.5rem', flexWrap: 'wrap' }}>
              <div className="panel-title" style={{ margin: 0 }}>
                Rotas de {simulacao?.transportadora || transportadora} — substituta por rota
              </div>
              <FiltroExcluir opcoes={opcoesExcluir} exclusoes={exclusoes} onToggle={toggleExcluir} onLimpar={() => setExclusoes(new Set())} />
            </div>
            {exclusoes.size > 0 && (
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '8px 12px', marginBottom: '0.6rem', fontSize: '0.8rem', color: '#9a3412', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <strong>Excluindo como substitutas:</strong>
                {opcoesExcluir.filter((n) => exclusoes.has(norm(n))).map((n) => (
                  <button key={n} type="button" onClick={() => toggleExcluir(n)} title="Clique para reincluir"
                    style={{ background: '#ffedd5', border: '1px solid #fdba74', borderRadius: 12, padding: '1px 8px', fontSize: '0.74rem', color: '#9a3412', cursor: 'pointer' }}>
                    {n} ✕
                  </button>
                ))}
                <span style={{ color: '#c2410c' }}>— a simulação assume a próxima melhor opção.</span>
              </div>
            )}
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead>
                  <tr>
                    <th>Origem</th>
                    <th>Destino</th>
                    <th>CT-es</th>
                    <th>Custo atual</th>
                    <th>Custo c/ substituta</th>
                    <th>Diferença</th>
                    <th>Prazo (atual → subst.)</th>
                    <th>Substitutas</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.linhas.map((l) => {
                    const aberta = rotasAbertas.has(l.rotaKey);
                    const deltaPrazo = (l.prazoAtualMedio != null && l.prazoSubMedio != null) ? l.prazoSubMedio - l.prazoAtualMedio : null;
                    const corPrazo = deltaPrazo == null ? '#64748b' : (deltaPrazo <= 0 ? '#04C7A4' : '#9b1111');
                    return (
                      <React.Fragment key={l.rotaKey}>
                        <tr style={aberta ? { background: '#f8fafc' } : undefined}>
                          <td>{l.cidadeOrigem}/{l.ufOrigem}</td>
                          <td>{l.cidadeDestino}/{l.ufDestino}</td>
                          <td>{fmtN(l.ctes)}</td>
                          <td>{fmt(l.valorPagoTotal)}</td>
                          <td style={{ color: l.diferenca <= TOLERANCIA ? '#04C7A4' : '#9b1111', fontWeight: 600 }}>{fmt(l.melhorTotal)}</td>
                          <td style={{ color: l.diferenca <= TOLERANCIA ? '#04C7A4' : '#9b1111' }}>
                            {l.diferenca > TOLERANCIA ? `+${fmt(l.diferenca)}` : (l.diferenca < -TOLERANCIA ? `−${fmt(-l.diferenca)}` : '—')}
                          </td>
                          <td style={{ fontSize: '0.82rem' }}>
                            {fmtDias(l.prazoAtualMedio)} → <span style={{ color: corPrazo, fontWeight: 600 }}>{fmtDias(l.prazoSubMedio)}</span>
                          </td>
                          <td style={{ fontSize: '0.8rem' }}>
                            {l.qtdSubstitutos === 0
                              ? <span style={{ color: '#9b1111', fontWeight: 600 }}>nenhum encontrado</span>
                              : (
                                <span>
                                  <span style={{ fontWeight: 600 }}>{l.substitutoPrincipal || '—'}</span>
                                  {l.qtdSubstitutos === 1
                                    ? <span style={{ marginLeft: 6, color: '#b45309', background: '#fef3c7', borderRadius: 6, padding: '1px 6px', fontSize: '0.72rem', fontWeight: 600 }}>única opção</span>
                                    : <button type="button" onClick={() => toggleRota(l.rotaKey)} style={{ marginLeft: 6, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '1px 6px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}>+{l.qtdSubstitutos - 1} outras</button>}
                                  {l.semSubstituto > 0 && <span style={{ marginLeft: 6, color: '#9b1111', fontSize: '0.72rem' }}>({l.semSubstituto} CT-e sem cobertura)</span>}
                                </span>
                              )}
                          </td>
                          <td>
                            <button type="button" className="sim-tab" onClick={() => toggleRota(l.rotaKey)} style={{ padding: '2px 10px', fontSize: '0.78rem' }}>
                              {aberta ? 'Fechar' : 'Detalhes'}
                            </button>
                          </td>
                        </tr>
                        {aberta && (
                          <tr>
                            <td colSpan={9} style={{ background: '#f8fafc', padding: '12px 16px' }}>
                              <DetalheRota linha={l} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {!resultado.linhas.length && <tr><td colSpan={9}>Sem rotas para exibir.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .sst-filtro { position: relative; }
        .sst-filtro > summary { white-space: nowrap; }
        .sst-filtro > summary::-webkit-details-marker { display: none; }
        .sst-filtro[open] > summary { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
        .sst-filtro-pop {
          position: absolute; right: 0; top: calc(100% + 6px); z-index: 30;
          background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
          box-shadow: 0 8px 24px rgba(15,23,42,0.12); padding: 12px; width: 320px; max-width: 80vw;
        }
      `}</style>
    </div>
  );
}
