import React, { useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarBaseCompletaDb, carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';
import { normalizarTransportadoras, processarCte } from '../services/auditoriaCteProcessamentoService';
import { montarMapasIbge, resolverIbgeLocal } from '../utils/realizadoLocalEngine';
import { filtrarCpComercialCte } from '../services/cteBasePolicy';

const ORIGENS_ALTERNATIVAS = [
  { label: 'Itajaí / SC', cidade: 'Itajaí', uf: 'SC', ibge: '4208203' },
];

const PAGE_SIZE = 200;
const TOLERANCIA = 0.05;

const FILTROS_PADRAO = {
  emissaoInicio: '',
  emissaoFim: '',
  canais: [],
  ufsOrigem: [],
  ufsDestino: [],
  transportadorasRealizadas: [],
  tabelasItajaiExcluidas: [],
  soComOportunidade: true,
};

function safeNum(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function fmt(v) { return safeNum(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function fmtN(v) { return safeNum(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function pct(v) { return `${safeNum(v).toFixed(1).replace('.', ',')}%`; }
function fmtData(v) { return v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-'; }
function normCidade(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function passaLista(valor, lista) {
  if (!lista || !lista.length) return true;
  return lista.includes(String(valor || '').trim());
}

async function carregarCtes({ competencia, dataInicio, dataFim, canal, limite = 5000, onProgress }) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const supabase = getSupabaseClient();
  const acumulado = [];
  let from = 0;
  const PAGE = 1000;

  while (acumulado.length < limite) {
    let q = supabase.from('realizado_local_ctes').select('*').order('data_emissao', { ascending: false }).range(from, from + PAGE - 1);
    if (dataInicio || dataFim) {
      if (dataInicio) q = q.gte('data_emissao', dataInicio);
      if (dataFim) q = q.lte('data_emissao', dataFim);
    } else if (competencia) {
      q = q.eq('competencia', competencia);
    }
    // canal real fica em canal_original (canal costuma vir "A DEFINIR")
    if (canal) q = q.or(`canal_original.ilike.%${canal}%,canal.ilike.%${canal}%`);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao carregar CT-es: ${error.message}`);
    const lote = data || [];
    acumulado.push(...lote);
    onProgress?.({ carregados: acumulado.length });
    if (lote.length < PAGE) break;
    from += PAGE;
  }
  return filtrarCpComercialCte(acumulado).slice(0, limite);
}

// Simula o CTe saindo do CD alternativo com TODAS as transportadoras e devolve
// a lista completa de resultados válidos (origem = Itajaí), ordenada por preço.
function simularDeOrigem(cte, transportadoras, origemAlt, ibgeDestino) {
  const canalReal = cte.canal_original && normCidade(cte.canal) === 'ADEFINIR'
    ? cte.canal_original
    : (cte.canal || cte.canal_original || '');

  const cteAlt = {
    ...cte,
    canal: canalReal,
    canal_original: canalReal,
    cidade_origem: origemAlt.cidade,
    uf_origem: origemAlt.uf,
    ibge_origem: origemAlt.ibge || '',
    ibge_corrigido_origem: origemAlt.ibge || '',
    ibge_destino: ibgeDestino || '',
    ibge_corrigido_destino: ibgeDestino || '',
  };

  const resultados = [];
  const statusCounts = { CALCULADO: 0, SEM_TABELA: 0, SEM_ORIGEM: 0, SEM_ROTA: 0, SEM_FAIXA: 0, ORIGEM_ERRADA: 0, OUTRO: 0 };
  const cidadeAltNorm = normCidade(origemAlt.cidade);

  for (const transp of transportadoras) {
    const cteTestando = { ...cteAlt, transportadora: transp.nome, nome_transportadora: transp.nome };
    let resultado;
    try {
      resultado = processarCte(cteTestando, transportadoras);
    } catch {
      statusCounts.OUTRO += 1;
      continue;
    }
    const st = resultado.status_calculo || 'OUTRO';
    statusCounts[st in statusCounts ? st : 'OUTRO'] += 1;
    if (st !== 'CALCULADO') continue;

    // Garante que o motor usou MESMO a origem Itajaí (não o fallback candidatas[0]).
    const origemUsada = normCidade(resultado.detalhes_calculo?.origem_cidade);
    if (origemUsada && cidadeAltNorm && !origemUsada.includes(cidadeAltNorm) && !cidadeAltNorm.includes(origemUsada)) {
      statusCounts.CALCULADO -= 1;
      statusCounts.ORIGEM_ERRADA += 1;
      continue;
    }

    const total = safeNum(resultado.valor_calculado);
    if (total <= 0) continue;

    resultados.push({
      transportadora: transp.nome,
      total,
      prazo: safeNum(resultado.detalhes_calculo?.rota_prazo),
      detalhes: resultado.detalhes_calculo,
    });
  }

  resultados.sort((a, b) => a.total - b.total);
  return { resultados, statusCounts };
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

function Barra({ valor, maximo, cor = '#9153F0' }) {
  const p = maximo > 0 ? Math.min((valor / maximo) * 100, 100) : 0;
  return <div style={{ background: '#f1f5f9', borderRadius: 99, height: 8, minWidth: 80 }}><div style={{ background: cor, height: '100%', borderRadius: 99, width: `${p}%` }} /></div>;
}

// Filtro multi-seleção (botão + painel de checkboxes)
function MultiFiltro({ label, opcoes, selecionados, onChange }) {
  const [aberto, setAberto] = useState(false);
  const total = opcoes.length;
  const sel = selecionados.length;
  const toggle = (op) => {
    onChange(selecionados.includes(op) ? selecionados.filter((x) => x !== op) : [...selecionados, op]);
  };
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setAberto((v) => !v)}
        style={{ width: '100%', textAlign: 'left', padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: sel ? '#f5f3ff' : '#fff', fontSize: '0.82rem', cursor: 'pointer', color: '#334155' }}>
        {label}: <strong>{sel ? `${sel} de ${total}` : 'Todos'}</strong> {aberto ? '▲' : '▼'}
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

export default function OportunidadeOrigemPage() {
  const [competencia, setCompetencia] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [canal, setCanal] = useState('B2C');
  const [origemAltKey, setOrigemAltKey] = useState(0);
  const [limiteInput, setLimiteInput] = useState('2000');

  const [status, setStatus] = useState('idle');
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const [bruto, setBruto] = useState(null); // { casos, totalCtes, diagTotal, origemAlt }

  const [filtros, setFiltros] = useState(FILTROS_PADRAO);
  const [pagina, setPagina] = useState(0);
  const [aba, setAba] = useState('ranking');
  const [ordem, setOrdem] = useState({ campo: 'economia', dir: 'desc' });
  const [expandido, setExpandido] = useState(null);

  const origemAlt = ORIGENS_ALTERNATIVAS[origemAltKey];
  const setF = (k, v) => { setFiltros((p) => ({ ...p, [k]: v })); setPagina(0); };

  async function processar() {
    setStatus('carregando'); setErro(''); setBruto(null); setPagina(0); setExpandido(null);
    setFiltros((p) => ({ ...FILTROS_PADRAO, soComOportunidade: p.soComOportunidade }));

    try {
      setProgresso('Carregando tabelas de frete...');
      const base = normalizarTransportadoras(await carregarBaseCompletaDb());
      if (!base.length) throw new Error('Nenhuma tabela de frete cadastrada.');

      setProgresso('Carregando municípios IBGE...');
      const municipios = await carregarMunicipiosIbgeDb().catch(() => []);
      const mapasIbge = montarMapasIbge(municipios);
      const ibgeOrigemAlt = resolverIbgeLocal(origemAlt.cidade, origemAlt.uf, mapasIbge) || origemAlt.ibge || '';
      const origemAltResolvida = { ...origemAlt, ibge: ibgeOrigemAlt };

      setProgresso('Carregando CT-es...');
      const ctes = await carregarCtes({
        competencia,
        dataInicio: dataInicio || undefined,
        dataFim: dataFim || undefined,
        canal: canal || undefined,
        limite: Number(limiteInput) || 2000,
        onProgress: ({ carregados }) => setProgresso(`Carregando CT-es... ${carregados}`),
      });
      if (!ctes.length) throw new Error('Nenhum CT-e encontrado para este recorte.');

      const cidadeAltNorm = normCidade(origemAlt.cidade);
      const ctesAlvo = ctes.filter((c) => {
        const cidade = normCidade(c.cidade_origem || c.origem || '');
        return !cidade.includes(cidadeAltNorm) && !cidadeAltNorm.includes(cidade.slice(0, 5));
      });

      setProgresso(`Simulando ${fmtN(ctesAlvo.length)} CT-es saindo de ${origemAlt.label}...`);

      const casos = [];
      const diagTotal = { CALCULADO: 0, SEM_TABELA: 0, SEM_ORIGEM: 0, SEM_ROTA: 0, SEM_FAIXA: 0, ORIGEM_ERRADA: 0, OUTRO: 0, SEM_IBGE_DESTINO: 0 };

      for (let i = 0; i < ctesAlvo.length; i++) {
        const cte = ctesAlvo[i];
        const valorPago = safeNum(cte.valor_cte || cte.frete_pago || cte.valor_frete);
        const ibgeDestino = resolverIbgeLocal(cte.cidade_destino || cte.destino, cte.uf_destino, mapasIbge);

        const baseCaso = {
          chaveCte: cte.chave_cte || cte.chave || '',
          numeroCte: cte.numero_cte || cte.numero || cte.nro_cte || '',
          emissao: cte.data_emissao || '',
          canal: cte.canal_original || cte.canal || '',
          cidadeOrigem: cte.cidade_origem || cte.origem || '',
          ufOrigem: String(cte.uf_origem || '').toUpperCase(),
          cidadeDestino: cte.cidade_destino || cte.destino || '',
          ufDestino: String(cte.uf_destino || '').toUpperCase(),
          transportadoraReal: cte.transportadora || cte.nome_transportadora || '',
          peso: safeNum(cte.peso_declarado || cte.peso),
          valorNf: safeNum(cte.valor_nf || cte.nf_venda),
          valorPago,
          resultadosAlt: [],
        };

        if (!ibgeDestino) {
          diagTotal.SEM_IBGE_DESTINO += 1;
          casos.push(baseCaso);
        } else {
          const { resultados, statusCounts } = simularDeOrigem(cte, base, origemAltResolvida, ibgeDestino);
          for (const [k, v] of Object.entries(statusCounts)) diagTotal[k] = (diagTotal[k] || 0) + v;
          baseCaso.resultadosAlt = resultados;
          casos.push(baseCaso);
        }

        if (i % 100 === 0 || i === ctesAlvo.length - 1) {
          const p = Math.round(((i + 1) / ctesAlvo.length) * 100);
          setProgresso(`Simulando... ${i + 1}/${ctesAlvo.length} (${p}%)`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      setBruto({ casos, totalCtes: ctesAlvo.length, diagTotal, origemAlt });
      setStatus('concluido'); setProgresso('');
    } catch (e) {
      console.error('[OportunidadeOrigem]', e);
      setErro(`${e.message || e}`);
      setStatus('erro'); setProgresso('');
    }
  }

  // Opções de filtro derivadas dos casos brutos
  const opcoes = useMemo(() => {
    if (!bruto) return { canais: [], ufsOrigem: [], ufsDestino: [], transpReal: [], tabelas: [] };
    const canais = new Set(), ufO = new Set(), ufD = new Set(), tr = new Set(), tab = new Set();
    for (const c of bruto.casos) {
      if (c.canal) canais.add(c.canal.trim());
      if (c.ufOrigem) ufO.add(c.ufOrigem);
      if (c.ufDestino) ufD.add(c.ufDestino);
      if (c.transportadoraReal) tr.add(c.transportadoraReal.trim());
      for (const r of c.resultadosAlt) tab.add(r.transportadora.trim());
    }
    const ord = (s) => Array.from(s).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return { canais: ord(canais), ufsOrigem: ord(ufO), ufsDestino: ord(ufD), transpReal: ord(tr), tabelas: ord(tab) };
  }, [bruto]);

  // Aplica filtros + escolhe a mais barata de Itajaí (respeitando tabelas excluídas)
  const resultado = useMemo(() => {
    if (!bruto) return null;
    const excl = new Set(filtros.tabelasItajaiExcluidas);

    const casos = bruto.casos
      .filter((c) => {
        const em = String(c.emissao || '').slice(0, 10);
        if (filtros.emissaoInicio && (!em || em < filtros.emissaoInicio)) return false;
        if (filtros.emissaoFim && (!em || em > filtros.emissaoFim)) return false;
        if (!passaLista(c.canal.trim(), filtros.canais)) return false;
        if (!passaLista(c.ufOrigem, filtros.ufsOrigem)) return false;
        if (!passaLista(c.ufDestino, filtros.ufsDestino)) return false;
        if (!passaLista(c.transportadoraReal.trim(), filtros.transportadorasRealizadas)) return false;
        return true;
      })
      .map((c) => {
        const validos = c.resultadosAlt.filter((r) => !excl.has(r.transportadora.trim()));
        const melhor = validos[0] || null; // já vem ordenado por preço
        const temOp = Boolean(melhor && melhor.total > 0 && melhor.total < c.valorPago - TOLERANCIA);
        const economia = temOp ? Math.round((c.valorPago - melhor.total) * 100) / 100 : 0;
        return {
          ...c,
          valorAlt: melhor?.total ?? null,
          transpAlt: melhor?.transportadora ?? null,
          prazoAlt: melhor?.prazo ?? null,
          detalhesAlt: melhor?.detalhes ?? null,
          temOp,
          economia,
          economiaPercentual: temOp && c.valorPago > 0 ? (economia / c.valorPago) * 100 : 0,
        };
      })
      .filter((c) => (filtros.soComOportunidade ? c.temOp : true));

    const comOp = casos.filter((c) => c.temOp);
    const totalEconomia = Math.round(comOp.reduce((s, c) => s + c.economia, 0) * 100) / 100;

    const mapaDestino = new Map();
    for (const c of comOp) {
      const k = `${c.cidadeDestino}/${c.ufDestino}`;
      const v = mapaDestino.get(k) || { chave: k, ctes: 0, economia: 0, prazoSoma: 0, prazoN: 0 };
      v.ctes += 1; v.economia += c.economia;
      if (c.prazoAlt > 0) { v.prazoSoma += c.prazoAlt; v.prazoN += 1; }
      mapaDestino.set(k, v);
    }
    const rankingDestino = Array.from(mapaDestino.values())
      .map((v) => ({ ...v, economia: Math.round(v.economia * 100) / 100, prazoMedio: v.prazoN > 0 ? v.prazoSoma / v.prazoN : 0 }))
      .sort((a, b) => b.economia - a.economia).slice(0, 20);

    const mapaTransp = new Map();
    for (const c of comOp) {
      const k = c.transpAlt || 'Desconhecida';
      const v = mapaTransp.get(k) || { chave: k, ctes: 0, economia: 0 };
      v.ctes += 1; v.economia += c.economia;
      mapaTransp.set(k, v);
    }
    const rankingTransp = Array.from(mapaTransp.values())
      .map((v) => ({ ...v, economia: Math.round(v.economia * 100) / 100 }))
      .sort((a, b) => b.economia - a.economia);

    return { casos, totalCtes: bruto.totalCtes, totalAnalisados: casos.length, totalOp: comOp.length, totalEconomia, rankingDestino, rankingTransp, diagTotal: bruto.diagTotal, origemAlt: bruto.origemAlt };
  }, [bruto, filtros, origemAlt]);

  const casosVisiveis = useMemo(() => {
    if (!resultado) return [];
    const { campo, dir } = ordem;
    return [...resultado.casos].sort((a, b) => {
      const va = a[campo] ?? 0; const vb = b[campo] ?? 0;
      if (typeof va === 'string' || typeof vb === 'string') {
        return dir === 'desc' ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
      }
      return dir === 'desc' ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
    });
  }, [resultado, ordem]);

  const totalPags = Math.ceil(casosVisiveis.length / PAGE_SIZE);
  const pagAtual = casosVisiveis.slice(pagina * PAGE_SIZE, (pagina + 1) * PAGE_SIZE);
  const maxDestino = resultado?.rankingDestino?.[0]?.economia || 1;
  const maxTransp = resultado?.rankingTransp?.[0]?.economia || 1;
  const filtrosAtivos = filtros.canais.length || filtros.ufsOrigem.length || filtros.ufsDestino.length
    || filtros.transportadorasRealizadas.length || filtros.tabelasItajaiExcluidas.length
    || filtros.emissaoInicio || filtros.emissaoFim;

  const Th = ({ campo, label }) => (
    <th style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      onClick={() => { setOrdem((p) => ({ campo, dir: p.campo === campo && p.dir === 'desc' ? 'asc' : 'desc' })); setPagina(0); }}>
      {label} {ordem.campo === campo ? (ordem.dir === 'desc' ? '▼' : '▲') : ''}
    </th>
  );

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Análise</div>
        <h1>Oportunidade de Origem</h1>
        <p>Simula quanto custaria despachar cada CT-e a partir de um CD alternativo — mostra a economia potencial por falta de estoque no local mais próximo do destino.</p>
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
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end', marginBottom: 16 }}>
          <label>CD alternativo (simular saída de)
            <select value={origemAltKey} onChange={(e) => setOrigemAltKey(Number(e.target.value))} style={{ width: '100%' }}>
              {ORIGENS_ALTERNATIVAS.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
            </select>
          </label>
          <label>Limite de CT-es
            <input type="number" value={limiteInput} onChange={(e) => setLimiteInput(e.target.value)} min={100} max={20000} step={500} />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="primary" type="button" onClick={processar} disabled={status === 'carregando'}>
              {status === 'carregando' ? 'Processando...' : 'Analisar oportunidade'}
            </button>
            {bruto && <button className="sim-tab" type="button" onClick={() => { setBruto(null); setStatus('idle'); }}>Limpar</button>}
          </div>
        </div>

        {progresso && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #93c5fd', borderTop: '2px solid #1d4ed8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            {progresso}
          </div>
        )}
      </section>

      {resultado && (
        <>
          {/* Filtros de limpeza (estilo Perda) */}
          <section className="sim-card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <strong style={{ fontSize: '0.9rem', color: '#334155' }}>Filtros / limpeza</strong>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={filtros.soComOportunidade} onChange={(e) => setF('soComOportunidade', e.target.checked)} />
                  Apenas com oportunidade
                </label>
                {filtrosAtivos ? <button type="button" className="sim-tab" onClick={() => { setFiltros((p) => ({ ...FILTROS_PADRAO, soComOportunidade: p.soComOportunidade })); setPagina(0); }}>Limpar filtros</button> : null}
              </div>
            </div>
            <div className="sim-form-grid sim-grid-4" style={{ gap: 10, marginBottom: 10 }}>
              <label style={{ fontSize: '0.78rem' }}>Emissão início<input type="date" value={filtros.emissaoInicio} onChange={(e) => setF('emissaoInicio', e.target.value)} /></label>
              <label style={{ fontSize: '0.78rem' }}>Emissão fim<input type="date" value={filtros.emissaoFim} onChange={(e) => setF('emissaoFim', e.target.value)} /></label>
              <MultiFiltro label="Canal" opcoes={opcoes.canais} selecionados={filtros.canais} onChange={(v) => setF('canais', v)} />
              <MultiFiltro label="UF destino" opcoes={opcoes.ufsDestino} selecionados={filtros.ufsDestino} onChange={(v) => setF('ufsDestino', v)} />
            </div>
            <div className="sim-form-grid sim-grid-4" style={{ gap: 10 }}>
              <MultiFiltro label="UF origem" opcoes={opcoes.ufsOrigem} selecionados={filtros.ufsOrigem} onChange={(v) => setF('ufsOrigem', v)} />
              <MultiFiltro label="Transp. realizada (tirar realizados)" opcoes={opcoes.transpReal} selecionados={filtros.transportadorasRealizadas} onChange={(v) => setF('transportadorasRealizadas', v)} />
              <MultiFiltro label="Tabelas de Itajaí a EXCLUIR" opcoes={opcoes.tabelas} selecionados={filtros.tabelasItajaiExcluidas} onChange={(v) => setF('tabelasItajaiExcluidas', v)} />
              <div style={{ fontSize: '0.74rem', color: '#94a3b8', alignSelf: 'center' }}>
                Excluir uma tabela de Itajaí recalcula a 2ª mais barata automaticamente.
              </div>
            </div>
          </section>

          <div className="summary-strip" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <Card label="CT-es analisados" valor={fmtN(resultado.totalAnalisados)} sub={`de ${fmtN(resultado.totalCtes)} fora de ${origemAlt.label}`} cor="#9153F0" />
            <Card label="Com oportunidade" valor={fmtN(resultado.totalOp)} sub={pct(resultado.totalAnalisados > 0 ? (resultado.totalOp / resultado.totalAnalisados) * 100 : 0)} cor="#e67e22" />
            <Card label="Economia potencial" valor={fmt(resultado.totalEconomia)} sub="se tivesse estoque no CD alt." cor="#9b1111" destaque={resultado.totalEconomia > 0} />
            <Card label="Economia média / CTe" valor={fmt(resultado.totalOp > 0 ? resultado.totalEconomia / resultado.totalOp : 0)} sub="casos com oportunidade" cor="#04C7A4" />
          </div>

          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 16px', marginBottom: '1rem', fontSize: '0.84rem', color: '#166534' }}>
            <strong>Diagnóstico simulação:</strong> {fmtN(resultado.diagTotal?.CALCULADO || 0)} tentativas calculadas · {fmtN(resultado.diagTotal?.SEM_ORIGEM || 0)} transp. sem Itajaí no canal · {fmtN(resultado.diagTotal?.SEM_ROTA || 0)} Itajaí sem rota p/ destino · {fmtN(resultado.diagTotal?.SEM_FAIXA || 0)} sem faixa de peso · {fmtN(resultado.diagTotal?.SEM_IBGE_DESTINO || 0)} CT-es sem IBGE destino.
          </div>

          <div style={{ display: 'flex', gap: 4, marginBottom: '0.5rem', borderBottom: '2px solid #eee', paddingBottom: '0.25rem', flexWrap: 'wrap' }}>
            {[
              { id: 'ranking', label: `Por destino (${resultado.rankingDestino.length})` },
              { id: 'transportadora', label: `Por transportadora alt. (${resultado.rankingTransp.length})` },
              { id: 'detalhes', label: `CT-es (${casosVisiveis.length.toLocaleString('pt-BR')})` },
            ].map((a) => (
              <button key={a.id} onClick={() => { setAba(a.id); setPagina(0); }}
                style={{ padding: '4px 14px', border: 'none', borderRadius: '4px 4px 0 0', cursor: 'pointer', background: aba === a.id ? '#9153F0' : '#f0f0f0', color: aba === a.id ? '#fff' : '#555', fontWeight: aba === a.id ? 700 : 400, fontSize: '0.85rem' }}>
                {a.label}
              </button>
            ))}
          </div>

          {aba === 'ranking' && (
            <div className="panel-card">
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>Top 20 destinos — onde mais economizaria saindo de {origemAlt.label}</div>
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead><tr><th>#</th><th>Destino</th><th>CT-es</th><th>Economia total</th><th>Economia / CTe</th><th>Prazo Itajaí médio</th><th style={{ minWidth: 120 }}>Visual</th></tr></thead>
                  <tbody>
                    {resultado.rankingDestino.map((r, i) => (
                      <tr key={r.chave}>
                        <td style={{ fontWeight: 700, color: '#9153F0' }}>#{i + 1}</td>
                        <td><strong>{r.chave}</strong></td>
                        <td>{fmtN(r.ctes)}</td>
                        <td className="negativo" style={{ fontWeight: 700 }}>{fmt(r.economia)}</td>
                        <td>{fmt(r.ctes > 0 ? r.economia / r.ctes : 0)}</td>
                        <td>{r.prazoMedio > 0 ? `${r.prazoMedio.toFixed(1)} dias` : '—'}</td>
                        <td><Barra valor={r.economia} maximo={maxDestino} cor="#9b1111" /></td>
                      </tr>
                    ))}
                    {!resultado.rankingDestino.length && <tr><td colSpan={7}>Nenhuma oportunidade encontrada com os filtros atuais.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {aba === 'transportadora' && (
            <div className="panel-card">
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>Transportadoras que ganhariam volume saindo de {origemAlt.label}</div>
              <p style={{ fontSize: '0.84rem', color: '#64748b', marginBottom: 12 }}>Quem seria a mais barata nos fretes simulados. Use o filtro "Tabelas de Itajaí a EXCLUIR" para tirar uma transportadora e ver quem assume.</p>
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead><tr><th>#</th><th>Transportadora</th><th>CT-es</th><th>Economia gerada</th><th style={{ minWidth: 120 }}>Visual</th></tr></thead>
                  <tbody>
                    {resultado.rankingTransp.map((r, i) => (
                      <tr key={r.chave}>
                        <td style={{ fontWeight: 700, color: '#9153F0' }}>#{i + 1}</td>
                        <td><strong>{r.chave}</strong></td>
                        <td>{fmtN(r.ctes)}</td>
                        <td className="negativo" style={{ fontWeight: 700 }}>{fmt(r.economia)}</td>
                        <td><Barra valor={r.economia} maximo={maxTransp} cor="#04C7A4" /></td>
                      </tr>
                    ))}
                    {!resultado.rankingTransp.length && <tr><td colSpan={5}>—</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {aba === 'detalhes' && (
            <div className="panel-card">
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>CT-e a CT-e <span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#94a3b8' }}>— clique na linha para ver o detalhe do cálculo</span></div>
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead>
                    <tr>
                      <th>CT-e</th><th>Emissão</th><th>Canal</th>
                      <th>Origem real → Destino</th>
                      <th>Transp. real</th>
                      <Th campo="valorPago" label="Pago (real)" />
                      <th>Transp. de {origemAlt.cidade}</th>
                      <Th campo="valorAlt" label={`Custo de ${origemAlt.cidade}`} />
                      <Th campo="economia" label="Economia" />
                      <th>Prazo Itajaí</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagAtual.map((c) => {
                      const id = c.chaveCte || c.numeroCte;
                      const aberto = expandido === id;
                      const d = c.detalhesAlt;
                      return (
                        <React.Fragment key={id}>
                          <tr onClick={() => setExpandido(aberto ? null : id)} style={{ cursor: 'pointer', background: c.temOp ? undefined : '#f8fff8' }}>
                            <td style={{ fontSize: '0.78rem', color: '#666' }}>{aberto ? '▼ ' : '▶ '}{c.numeroCte || c.chaveCte?.slice(-8) || '-'}</td>
                            <td>{fmtData(c.emissao)}</td>
                            <td>{c.canal || '-'}</td>
                            <td><span style={{ color: '#e67e22' }}>{c.cidadeOrigem}/{c.ufOrigem}</span> → {c.cidadeDestino}/{c.ufDestino}</td>
                            <td>{c.transportadoraReal}</td>
                            <td>{fmt(c.valorPago)}</td>
                            <td style={{ color: '#04C7A4', fontWeight: 600 }}>{c.transpAlt || '—'}</td>
                            <td>{c.valorAlt != null ? fmt(c.valorAlt) : '—'}</td>
                            <td className={c.temOp ? 'negativo' : ''} style={{ fontWeight: c.temOp ? 700 : 400 }}>{c.temOp ? fmt(c.economia) : '—'}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{c.prazoAlt > 0 ? `${c.prazoAlt} dias` : '—'}</td>
                          </tr>
                          {aberto && (
                            <tr>
                              <td colSpan={10} style={{ background: '#faf5ff', padding: '12px 16px' }}>
                                {d ? (
                                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: '0.82rem' }}>
                                    <div><div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Origem cálculo</div><strong>{d.origem_cidade || '—'}</strong></div>
                                    <div><div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Rota</div><strong>{d.rota_nome || '—'}</strong></div>
                                    <div><div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Peso considerado</div><strong>{safeNum(d.peso_considerado).toLocaleString('pt-BR')} kg</strong></div>
                                    <div><div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Valor base</div><strong>{fmt(d.valor_base)}</strong></div>
                                    <div><div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Subtotal</div><strong>{fmt(d.subtotal)}</strong></div>
                                    <div><div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>ICMS</div><strong>{fmt(d.icms)}</strong></div>
                                    <div><div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Taxas</div><strong>{fmt(d.taxas)}</strong></div>
                                    <div><div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Prazo entrega</div><strong>{d.rota_prazo != null ? `${d.rota_prazo} dias` : '—'}</strong></div>
                                    <div><div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Total Itajaí</div><strong style={{ color: '#04C7A4' }}>{fmt(c.valorAlt)}</strong></div>
                                  </div>
                                ) : <span style={{ color: '#94a3b8' }}>Sem cálculo de Itajaí para este CT-e (sem rota/tabela ou IBGE de destino não resolvido).</span>}
                                {c.resultadosAlt.length > 1 && (
                                  <div style={{ marginTop: 10, fontSize: '0.78rem', color: '#64748b' }}>
                                    <span style={{ fontWeight: 600 }}>Outras opções de Itajaí: </span>
                                    {c.resultadosAlt.slice(0, 6).map((r, idx) => (
                                      <span key={r.transportadora} style={{ marginRight: 12 }}>{idx + 1}. {r.transportadora} {fmt(r.total)}</span>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {!pagAtual.length && <tr><td colSpan={10}>Nenhum CT-e com os filtros atuais.</td></tr>}
                  </tbody>
                </table>
              </div>
              {totalPags > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: '0.75rem' }}>
                  <button className="btn-secondary" onClick={() => setPagina(0)} disabled={pagina === 0}>«</button>
                  <button className="btn-secondary" onClick={() => setPagina((p) => p - 1)} disabled={pagina === 0}>‹</button>
                  <span style={{ fontSize: '0.85rem', color: '#555' }}>Página {pagina + 1} de {totalPags} · {casosVisiveis.length.toLocaleString('pt-BR')} registros</span>
                  <button className="btn-secondary" onClick={() => setPagina((p) => p + 1)} disabled={pagina >= totalPags - 1}>›</button>
                  <button className="btn-secondary" onClick={() => setPagina(totalPags - 1)} disabled={pagina >= totalPags - 1}>»</button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
