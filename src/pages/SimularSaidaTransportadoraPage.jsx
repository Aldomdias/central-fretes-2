import React, { useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarBaseCompletaDb, carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';
import { normalizarTransportadoras, processarCte } from '../services/auditoriaCteProcessamentoService';
import { montarMapasIbge, resolverIbgeLocal } from '../utils/realizadoLocalEngine';
import { filtrarCpComercialCte } from '../services/cteBasePolicy';

const LIMITE_MAX_CT = 200000;
const TOLERANCIA = 0.5; // R$ — diferença abaixo disto é ruído

function safeNum(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function fmt(v) { return safeNum(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function fmtN(v) { return safeNum(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function pct(v) { return `${safeNum(v).toFixed(1).replace('.', ',')}%`; }
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
  const [resultado, setResultado] = useState(null);

  async function carregar() {
    setStatusCarga('carregando'); setErro(''); setBase(null); setResultado(null); setTransportadora('');
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

      setBase({ ctes, baseFrete, idx, mapBaseByNome, municipioPorCidade, mapasIbge });
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
      const nome = (c.transportadora || c.nome_transportadora || '').trim();
      if (nome) set.add(nome);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [base]);

  async function simularSaida() {
    if (!base || !transportadora) return;
    setStatusSim('carregando'); setErro(''); setResultado(null);
    try {
      const { ctes, baseFrete, idx, mapBaseByNome, municipioPorCidade, mapasIbge } = base;
      const ctesDaTransp = ctes.filter((c) => norm(c.transportadora || c.nome_transportadora) === norm(transportadora));
      if (!ctesDaTransp.length) throw new Error('Nenhum CT-e desta transportadora no recorte carregado.');

      const origemCache = new Map();
      const porRota = new Map();
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
        if (!porRota.has(rotaKey)) {
          porRota.set(rotaKey, { rotaKey, cidadeOrigem, ufOrigem, cidadeDestino, ufDestino, ctes: 0, valorPagoTotal: 0, melhorTotal: 0, semSubstituto: 0, candidatosUsados: new Map() });
        }
        const rota = porRota.get(rotaKey);
        rota.ctes += 1;
        rota.valorPagoTotal += valorPago;

        if (!ibgeDestino || !ibgeOrigemReal) {
          semIbge += 1;
          rota.melhorTotal += valorPago;
          rota.semSubstituto += 1;
        } else {
          const setOrigem = nomesPorOrigem(idx, dig7(ibgeOrigemReal), normCmp(cidadeOrigem), origemCache);
          const setDestino = idx.porDestinoIbge.get(dig7(ibgeDestino));
          const candidatas = [];
          if (setDestino) for (const nome of setOrigem) if (setDestino.has(nome)) { const t = mapBaseByNome.get(nome); if (t) candidatas.push(t); }
          const resultados = simularSubstitutas(cte, baseFrete, candidatas, ibgeOrigemReal, ibgeDestino, cidadeOrigem, transportadora);
          const melhor = resultados[0];
          if (melhor) {
            rota.melhorTotal += melhor.total;
            rota.candidatosUsados.set(melhor.transportadora, (rota.candidatosUsados.get(melhor.transportadora) || 0) + 1);
          } else {
            rota.melhorTotal += valorPago;
            rota.semSubstituto += 1;
          }
        }

        if (i % 50 === 0 || i === ctesDaTransp.length - 1) {
          const feitos = i + 1;
          const decorrido = (Date.now() - t0) / 1000;
          setProgresso(`Simulando... ${fmtN(feitos)}/${fmtN(ctesDaTransp.length)} · ${decorrido.toFixed(0)}s`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      const linhas = Array.from(porRota.values()).map((r) => ({
        ...r,
        diferenca: r.melhorTotal - r.valorPagoTotal,
        substitutoPrincipal: [...r.candidatosUsados.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      }));
      linhas.sort((a, b) => b.valorPagoTotal - a.valorPagoTotal);

      const custoAtual = linhas.reduce((s, l) => s + l.valorPagoTotal, 0);
      const custoComSubstitutos = linhas.reduce((s, l) => s + l.melhorTotal, 0);
      const rotasSemSubstituto = linhas.filter((l) => l.semSubstituto > 0).length;
      const pctReajuste = safeNum(reajustePct);
      const custoComReajuste = custoAtual * (1 + pctReajuste / 100);
      const aumentoPctSubstitutos = custoAtual > 0 ? ((custoComSubstitutos - custoAtual) / custoAtual) * 100 : 0;
      const economiaVsReajuste = custoComReajuste - custoComSubstitutos;

      setResultado({
        linhas,
        totalCtes: ctesDaTransp.length,
        totalRotas: linhas.length,
        rotasSemSubstituto,
        semIbge,
        custoAtual,
        custoComSubstitutos,
        custoComReajuste,
        aumentoPctSubstitutos,
        economiaVsReajuste,
        pctReajuste,
      });
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
            {base && <button className="sim-tab" type="button" onClick={() => { setBase(null); setResultado(null); setStatusCarga('idle'); }}>Limpar</button>}
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
            <div className="panel-title" style={{ marginBottom: '0.5rem' }}>
              Rotas de {transportadora} — substituta por rota
            </div>
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
                    <th>Substituta principal</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.linhas.map((l) => (
                    <tr key={l.rotaKey}>
                      <td>{l.cidadeOrigem}/{l.ufOrigem}</td>
                      <td>{l.cidadeDestino}/{l.ufDestino}</td>
                      <td>{fmtN(l.ctes)}</td>
                      <td>{fmt(l.valorPagoTotal)}</td>
                      <td style={{ color: l.diferenca <= TOLERANCIA ? '#04C7A4' : '#9b1111', fontWeight: 600 }}>{fmt(l.melhorTotal)}</td>
                      <td style={{ color: l.diferenca <= TOLERANCIA ? '#04C7A4' : '#9b1111' }}>
                        {l.diferenca > TOLERANCIA ? `+${fmt(l.diferenca)}` : (l.diferenca < -TOLERANCIA ? `−${fmt(-l.diferenca)}` : '—')}
                      </td>
                      <td style={{ fontSize: '0.8rem' }}>
                        {l.semSubstituto > 0
                          ? <span style={{ color: '#9b1111', fontWeight: 600 }}>nenhum encontrado{l.semSubstituto < l.ctes ? ` (${l.semSubstituto}/${l.ctes})` : ''}</span>
                          : (l.substitutoPrincipal || '—')}
                      </td>
                    </tr>
                  ))}
                  {!resultado.linhas.length && <tr><td colSpan={7}>Sem rotas para exibir.</td></tr>}
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
