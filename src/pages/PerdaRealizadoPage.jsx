/**
 * PerdaRealizadoPage.jsx — v3
 * - Carregamento em etapas sequenciais com feedback a cada passo
 * - Filtros de UF/cidade de origem e destino
 * - Correção: buscarRealizadoLocalParaSimulacao retorna { rows, totalCompativel }
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import { carregarBaseCompletaDb } from '../services/freteDatabaseService';
import { carregarMunicipiosIbgeComFallback } from '../services/ibgeService';
import { carregarVinculosTransportadoras } from '../services/vinculosTransportadorasService';
import { buscarRealizadoLocalParaSimulacao } from '../services/realizadoLocalDb';

// ── Constantes ─────────────────────────────────────────────────────────────
const REGIOES = [
  { label: 'Sul',          ufs: ['RS', 'SC', 'PR'] },
  { label: 'Sudeste',      ufs: ['SP', 'RJ', 'MG', 'ES'] },
  { label: 'Centro-Oeste', ufs: ['MT', 'MS', 'GO', 'DF'] },
  { label: 'Nordeste',     ufs: ['BA', 'SE', 'AL', 'PE', 'PB', 'RN', 'CE', 'PI', 'MA'] },
  { label: 'Norte',        ufs: ['AM', 'PA', 'RO', 'AC', 'RR', 'AP', 'TO'] },
];
const TODAS_UFS = REGIOES.flatMap((r) => r.ufs);
const CANAIS    = ['ATACADO', 'B2C', 'REVERSA', 'INTERCOMPANY'];
const LIMITE_DB = 50000;

// Etapas de carregamento para exibição
const ETAPAS_CARGA = [
  { id: 'tabelas',   label: 'Carregando tabelas de frete (transportadoras, rotas, cotações)...' },
  { id: 'municipios',label: 'Carregando municípios IBGE...' },
  { id: 'vinculos',  label: 'Carregando vínculos de transportadoras...' },
  { id: 'realizado', label: 'Carregando CT-es realizados do período...' },
  { id: 'worker',    label: 'Iniciando análise...' },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}
function pct(v)    { return `${Number(v || 0).toFixed(1)}%`; }
function fmtData(s) {
  if (!s) return '-';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
function normUf(s) { return String(s || '').trim().toUpperCase(); }

// ── Componentes auxiliares ─────────────────────────────────────────────────
function Card({ label, valor, sub, cor, destaque }) {
  return (
    <div className="summary-card"
      style={{ borderLeft: `4px solid ${cor || '#9153F0'}`, background: destaque ? '#fff5f5' : undefined }}>
      <span>{label}</span>
      <strong style={{ color: destaque ? '#9b1111' : undefined }}>{valor}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function Barra({ valor, maximo, cor }) {
  const w = maximo > 0 ? Math.min(100, (valor / maximo) * 100) : 0;
  return (
    <div style={{ background: '#eee', borderRadius: 4, height: 8, minWidth: 80, overflow: 'hidden' }}>
      <div style={{ background: cor || '#9153F0', width: `${w}%`, height: '100%', borderRadius: 4 }} />
    </div>
  );
}

function PainelUfs({ titulo, cor, ufs, onChange }) {
  const toggleUf = (uf) =>
    onChange(ufs.includes(uf) ? ufs.filter((u) => u !== uf) : [...ufs, uf]);
  const toggleRegiao = (regUfs) => {
    const todas = regUfs.every((u) => ufs.includes(u));
    onChange(todas ? ufs.filter((u) => !regUfs.includes(u)) : [...new Set([...ufs, ...regUfs])]);
  };
  const corAtiva = cor || '#9153F0';

  return (
    <div>
      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#444', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: 6 }}>
        {titulo}
        <span style={{ fontWeight: 400, color: '#888' }}>
          ({ufs.length === 0 ? 'todos' : `${ufs.length} selecionados`})
        </span>
        {ufs.length > 0 && (
          <button className="btn-secondary" style={{ padding: '1px 8px', fontSize: '0.75rem' }}
            onClick={() => onChange([])}>Limpar</button>
        )}
        <button className="btn-secondary" style={{ padding: '1px 8px', fontSize: '0.75rem' }}
          onClick={() => onChange([...TODAS_UFS])}>Todos</button>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: '0.35rem' }}>
        {REGIOES.map((reg) => {
          const ativas = reg.ufs.every((u) => ufs.includes(u));
          return (
            <button key={reg.label}
              style={{
                fontSize: '0.75rem', padding: '2px 10px', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${ativas ? corAtiva : '#ccc'}`,
                background: ativas ? corAtiva : '#f5f5f5',
                color: ativas ? '#fff' : '#555', fontWeight: ativas ? 700 : 400,
              }}
              onClick={() => toggleRegiao(reg.ufs)}>
              {reg.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {TODAS_UFS.map((uf) => {
          const sel = ufs.includes(uf);
          return (
            <button key={uf} onClick={() => toggleUf(uf)}
              style={{
                padding: '2px 8px', fontSize: '0.75rem', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${sel ? corAtiva : '#ccc'}`,
                background: sel ? corAtiva : '#fff',
                color: sel ? '#fff' : '#555', fontWeight: sel ? 700 : 400,
              }}>
              {uf}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Painel de progresso com etapas visuais
function PainelProgresso({ etapaAtual, mensagem, pctWorker }) {
  return (
    <div style={{ marginTop: '0.75rem' }}>
      {/* Etapas visuais */}
      <div style={{ display: 'flex', gap: 0, marginBottom: '0.6rem' }}>
        {ETAPAS_CARGA.map((e, i) => {
          const idx     = ETAPAS_CARGA.findIndex((x) => x.id === etapaAtual);
          const feito   = i < idx;
          const atual   = e.id === etapaAtual;
          return (
            <div key={e.id} style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
              {/* Linha conectora */}
              {i > 0 && (
                <div style={{
                  position: 'absolute', left: 0, top: 11, width: '50%', height: 2,
                  background: feito || atual ? '#9153F0' : '#ddd',
                }} />
              )}
              {i < ETAPAS_CARGA.length - 1 && (
                <div style={{
                  position: 'absolute', right: 0, top: 11, width: '50%', height: 2,
                  background: feito ? '#9153F0' : '#ddd',
                }} />
              )}
              {/* Bolinha */}
              <div style={{
                width: 22, height: 22, borderRadius: '50%', margin: '0 auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.7rem', fontWeight: 700, position: 'relative', zIndex: 1,
                background: feito ? '#9153F0' : atual ? '#fff' : '#eee',
                border: `2px solid ${feito || atual ? '#9153F0' : '#ddd'}`,
                color: feito ? '#fff' : atual ? '#9153F0' : '#aaa',
              }}>
                {feito ? '✓' : i + 1}
              </div>
              <div style={{
                fontSize: '0.65rem', marginTop: 3,
                color: atual ? '#9153F0' : feito ? '#555' : '#aaa',
                fontWeight: atual ? 700 : 400,
                lineHeight: 1.2,
              }}>
                {e.id === 'tabelas'    ? 'Tabelas'    :
                 e.id === 'municipios' ? 'Municípios' :
                 e.id === 'vinculos'   ? 'Vínculos'   :
                 e.id === 'realizado'  ? 'CT-es'      : 'Análise'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mensagem atual */}
      <div style={{ fontSize: '0.82rem', color: '#555', marginBottom: 5, minHeight: 18 }}>
        {mensagem}
      </div>

      {/* Barra de progresso */}
      <div style={{ background: '#eee', borderRadius: 99, height: 8, overflow: 'hidden' }}>
        <div style={{
          background: 'linear-gradient(90deg, #9153F0, #6366f1)',
          height: '100%', borderRadius: 99,
          width: `${pctWorker}%`, transition: 'width .4s ease',
        }} />
      </div>
      {pctWorker > 0 && (
        <div style={{ fontSize: '0.72rem', color: '#888', textAlign: 'right', marginTop: 2 }}>
          {pctWorker}%
        </div>
      )}
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 50;

export default function PerdaRealizadoPage() {
  const workerRef = useRef(null);

  const [filtros, setFiltros] = useState({
    inicio:                  new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 10),
    fim:                     new Date().toISOString().slice(0, 10),
    canal:                   '',
    transportadoraRealizada: '',
    cidadeOrigem:            '',
    ufsOrigem:               [],
    ufsDestino:              [],
  });
  const set = (campo, valor) => setFiltros((p) => ({ ...p, [campo]: valor }));

  const [status,      setStatus]      = useState('idle');
  const [etapaId,     setEtapaId]     = useState('');
  const [mensagem,    setMensagem]     = useState('');
  const [pctWorker,   setPctWorker]   = useState(0);
  const [erro,        setErro]        = useState('');
  const [aviso,       setAviso]       = useState('');
  const [ctesCont,    setCtesCont]    = useState(null); // quantos CT-es foram carregados
  const [resultado,   setResultado]   = useState(null);

  const [pagina,     setPagina]    = useState(0);
  const [aba,        setAba]       = useState('origens');
  const [filtroTab,  setFiltroTab] = useState({ soPerda: true, ufOrigem: '', transportadora: '' });
  const [ordenacao,  setOrdenacao] = useState({ campo: 'perda', dir: 'desc' });

  useEffect(() => () => workerRef.current?.terminate(), []);

  const step = (id, msg, pct = 0) => {
    setEtapaId(id);
    setMensagem(msg);
    setPctWorker(pct);
  };

  const processar = async () => {
    workerRef.current?.terminate();
    setStatus('carregando');
    setErro('');
    setAviso('');
    setResultado(null);
    setCtesCont(null);

    try {
      // ── Etapa 1: tabelas de frete ─────────────────────────────────────
      step('tabelas', 'Carregando tabelas de frete do Supabase... (pode demorar alguns segundos)', 5);
      let transportadoras;
      try {
        transportadoras = await carregarBaseCompletaDb();
      } catch (e) {
        throw new Error(`Falha ao carregar tabelas de frete: ${e.message}`);
      }
      if (!transportadoras?.length) throw new Error('Nenhuma tabela de frete encontrada. Verifique se as tabelas estão cadastradas.');

      // ── Etapa 2: municípios IBGE ──────────────────────────────────────
      step('municipios', 'Carregando municípios IBGE...', 25);
      let municipios;
      try {
        ({ municipios } = await carregarMunicipiosIbgeComFallback({ permitirOficial: true }));
      } catch (e) {
        throw new Error(`Falha ao carregar municípios: ${e.message}`);
      }

      // ── Etapa 3: vínculos ─────────────────────────────────────────────
      step('vinculos', 'Carregando vínculos de transportadoras...', 40);
      let vinculos = [];
      try {
        vinculos = await carregarVinculosTransportadoras();
      } catch {
        // não bloqueia, continua sem vínculos
      }

      // ── Etapa 4: CT-es realizados ─────────────────────────────────────
      step('realizado', 'Buscando CT-es realizados com os filtros...', 55);
      const filtrosDb = {
        inicio:                  filtros.inicio    || undefined,
        fim:                     filtros.fim       || undefined,
        canal:                   filtros.canal     || undefined,
        transportadoraRealizada: filtros.transportadoraRealizada || undefined,
        origem:                  filtros.cidadeOrigem || undefined,
        ...(filtros.ufsOrigem.length === 1 ? { ufOrigem: filtros.ufsOrigem[0] } : {}),
      };

      let rows, totalCompativel;
      try {
        ({ rows, totalCompativel } = await buscarRealizadoLocalParaSimulacao(filtrosDb, { limit: LIMITE_DB }));
      } catch (e) {
        throw new Error(`Falha ao buscar CT-es realizados: ${e.message}`);
      }

      // Filtros JS adicionais (multi-UF)
      let realizados = rows || [];
      if (filtros.ufsOrigem.length > 1) {
        const s = new Set(filtros.ufsOrigem.map(normUf));
        realizados = realizados.filter((c) => s.has(normUf(c.ufOrigem)));
      }
      if (filtros.ufsDestino.length > 0) {
        const s = new Set(filtros.ufsDestino.map(normUf));
        realizados = realizados.filter((c) => s.has(normUf(c.ufDestino)));
      }

      if (totalCompativel > LIMITE_DB) {
        setAviso(`⚠️ A base tem ${totalCompativel.toLocaleString('pt-BR')} CT-es no período. Foram carregados os primeiros ${LIMITE_DB.toLocaleString('pt-BR')}. Para analisar tudo, refine os filtros (período menor, origem específica).`);
      }

      if (!realizados.length) {
        setErro('Nenhum CT-e encontrado com os filtros selecionados. Verifique se o Realizado foi importado.');
        setStatus('erro');
        return;
      }

      setCtesCont(realizados.length);

      // ── Etapa 5: worker ───────────────────────────────────────────────
      setStatus('processando');
      step('worker', `Analisando ${realizados.length.toLocaleString('pt-BR')} CT-es — aguarde...`, 2);

      const worker = new Worker(
        new URL('../workers/perdaRealizadoWorker.js', import.meta.url),
        { type: 'module' }
      );
      workerRef.current = worker;

      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          setMensagem(msg.etapa);
          setPctWorker(msg.pct ?? 0);
        } else if (msg.type === 'done') {
          setResultado(msg.result);
          setStatus('pronto');
          setPagina(0);
          setAba('origens');
          worker.terminate();
        } else if (msg.type === 'error') {
          setErro(`Erro na análise: ${msg.message}`);
          setStatus('erro');
          worker.terminate();
        }
      };
      worker.onerror = (e) => {
        setErro(`Erro interno: ${e.message || 'Verifique o console do browser (F12) para detalhes.'}`);
        setStatus('erro');
      };

      worker.postMessage({ type: 'analisar-perda', realizados, transportadoras, municipios, vinculos });
    } catch (e) {
      setErro(e.message || 'Erro inesperado ao carregar dados.');
      setStatus('erro');
    }
  };

  // ── Tabela detalhada ──────────────────────────────────────────────────
  const detalhesVisiveis = useMemo(() => {
    if (!resultado?.detalhes) return [];
    let lista = resultado.detalhes;
    if (filtroTab.soPerda)        lista = lista.filter((d) => d.temPerda);
    if (filtroTab.ufOrigem)       lista = lista.filter((d) => d.ufOrigem === filtroTab.ufOrigem);
    if (filtroTab.transportadora) {
      const t = filtroTab.transportadora.toUpperCase();
      lista = lista.filter((d) => d.transportadoraRealizada?.toUpperCase().includes(t));
    }
    const { campo, dir } = ordenacao;
    return [...lista].sort((a, b) => {
      const va = a[campo] ?? 0, vb = b[campo] ?? 0;
      return dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
  }, [resultado, filtroTab, ordenacao]);

  const totalPaginas   = Math.ceil(detalhesVisiveis.length / PAGE_SIZE);
  const detalhesPagina = detalhesVisiveis.slice(pagina * PAGE_SIZE, (pagina + 1) * PAGE_SIZE);
  const maxTop10       = resultado?.top10Origens?.[0]?.perdaTotal || 1;

  const ufOrigensDisponiveis = useMemo(() =>
    [...new Set((resultado?.detalhes || []).map((d) => d.ufOrigem).filter(Boolean))].sort()
  , [resultado]);

  const ordenarPor = (campo) => {
    setOrdenacao((prev) => ({ campo, dir: prev.campo === campo && prev.dir === 'desc' ? 'asc' : 'desc' }));
    setPagina(0);
  };
  const Th = ({ campo, label }) => (
    <th style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      onClick={() => ordenarPor(campo)}>
      {label} {ordenacao.campo === campo ? (ordenacao.dir === 'desc' ? '▼' : '▲') : ''}
    </th>
  );

  const processando = status === 'carregando' || status === 'processando';

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="page-shell">
      <div className="page-header">
        <span className="amd-mini-brand">Realizado · Análise</span>
        <h1>Perda por Transportadora Mais Cara</h1>
        <p>
          Compara o frete pago com a opção mais barata disponível nas tabelas cadastradas.
          Filtre por origem, destino, canal e período.
        </p>
      </div>

      {/* ── FILTROS ─────────────────────────────────────────────────── */}
      <div className="panel-card" style={{ marginBottom: '1rem' }}>
        <div className="panel-title" style={{ marginBottom: '0.75rem' }}>Filtros</div>

        <div className="form-grid three" style={{ marginBottom: '1rem' }}>
          <label className="field">
            Data início
            <input type="date" value={filtros.inicio} onChange={(e) => set('inicio', e.target.value)} />
          </label>
          <label className="field">
            Data fim
            <input type="date" value={filtros.fim} onChange={(e) => set('fim', e.target.value)} />
          </label>
          <label className="field">
            Canal
            <select value={filtros.canal} onChange={(e) => set('canal', e.target.value)}>
              <option value="">Todos os canais</option>
              {CANAIS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">
            Transportadora realizada
            <input placeholder="Nome da transportadora que carregou"
              value={filtros.transportadoraRealizada}
              onChange={(e) => set('transportadoraRealizada', e.target.value)} />
          </label>
          <label className="field">
            Cidade de origem
            <input placeholder="Ex: São Paulo, Campinas..."
              value={filtros.cidadeOrigem}
              onChange={(e) => set('cidadeOrigem', e.target.value)} />
          </label>
        </div>

        {/* UFs origem */}
        <div style={{ marginBottom: '0.75rem', padding: '0.75rem', background: '#f8f6ff', borderRadius: 8, border: '1px solid #e0d8ff' }}>
          <PainelUfs titulo="Estados de origem" cor="#9153F0"
            ufs={filtros.ufsOrigem} onChange={(v) => set('ufsOrigem', v)} />
        </div>

        {/* UFs destino */}
        <div style={{ padding: '0.75rem', background: '#f0f7ff', borderRadius: 8, border: '1px solid #c8deff' }}>
          <PainelUfs titulo="Estados de destino" cor="#2563eb"
            ufs={filtros.ufsDestino} onChange={(v) => set('ufsDestino', v)} />
        </div>

        {/* Botão e progresso */}
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: processando ? '0.5rem' : 0 }}>
            <button className="btn-primary" onClick={processar} disabled={processando}
              style={{ minWidth: 160 }}>
              {processando ? '⟳ Processando...' : '▶ Processar'}
            </button>
            {ctesCont != null && !processando && (
              <span style={{ fontSize: '0.82rem', color: '#666' }}>
                Último processamento: <strong>{ctesCont.toLocaleString('pt-BR')}</strong> CT-es analisados
              </span>
            )}
          </div>

          {processando && (
            <PainelProgresso
              etapaAtual={etapaId}
              mensagem={mensagem}
              pctWorker={pctWorker}
            />
          )}
        </div>
      </div>

      {/* Avisos */}
      {aviso && (
        <div className="hint-box compact" style={{ background: '#fffbf0', border: '1px solid #f0d080', marginBottom: '0.75rem' }}>
          {aviso}
        </div>
      )}
      {erro && (
        <div className="hint-box compact" style={{ background: '#fff5f5', border: '1px solid #f5c6cb', marginBottom: '0.75rem' }}>
          ⚠️ {erro}
        </div>
      )}

      {/* ── RESULTADOS ──────────────────────────────────────────────── */}
      {resultado && (
        <>
          <div className="summary-strip" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <Card label="CT-es analisados"  valor={resultado.totalCtes.toLocaleString('pt-BR')} cor="#9153F0" />
            <Card label="CT-es com perda"   valor={resultado.ctesComPerda.toLocaleString('pt-BR')}
              sub={pct(resultado.totalCtes > 0 ? (resultado.ctesComPerda / resultado.totalCtes) * 100 : 0)}
              cor="#e67e22" />
            <Card label="Perda total"       valor={fmt(resultado.perdaTotal)} cor="#9b1111" destaque={resultado.perdaTotal > 0} />
            <Card label="Perda média/CT-e"  valor={fmt(resultado.perdaMedia)} cor="#e67e22" />
            <Card label="Fora da malha"     valor={resultado.semMalha.toLocaleString('pt-BR')}
              sub="sem tabela cadastrada" cor="#888" />
          </div>

          {/* Abas */}
          <div style={{ display: 'flex', gap: 4, marginBottom: '0.5rem', borderBottom: '2px solid #eee', paddingBottom: '0.25rem' }}>
            {[
              { id: 'origens',         label: `Top 10 Origens (${resultado.top10Origens.length})` },
              { id: 'transportadoras', label: `Por Transportadora (${resultado.porTransportadora.length})` },
              { id: 'detalhes',        label: `Detalhes (${detalhesVisiveis.length.toLocaleString('pt-BR')})` },
              { id: 'sem-malha',       label: `Sem malha (${resultado.semMalha})` },
            ].map((a) => (
              <button key={a.id} onClick={() => { setAba(a.id); setPagina(0); }}
                style={{
                  padding: '4px 14px', border: 'none', borderRadius: '4px 4px 0 0', cursor: 'pointer',
                  background: aba === a.id ? '#9153F0' : '#f0f0f0',
                  color: aba === a.id ? '#fff' : '#555',
                  fontWeight: aba === a.id ? 700 : 400, fontSize: '0.85rem',
                }}>
                {a.label}
              </button>
            ))}
          </div>

          {/* Top 10 Origens */}
          {aba === 'origens' && (
            <div className="panel-card">
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>Top 10 origens por valor de perda</div>
              {resultado.top10Origens.length === 0
                ? <p style={{ color: '#888' }}>Nenhuma origem com perda encontrada.</p>
                : (
                  <div className="sim-analise-tabela-wrap">
                    <table className="sim-analise-tabela">
                      <thead>
                        <tr><th>#</th><th>Origem</th><th>CT-es com perda</th><th>Perda total</th><th>% sobre pago</th><th style={{ minWidth: 120 }}>Visual</th></tr>
                      </thead>
                      <tbody>
                        {resultado.top10Origens.map((o, i) => (
                          <tr key={o.origem}>
                            <td style={{ fontWeight: 700, color: '#9153F0' }}>#{i + 1}</td>
                            <td><strong>{o.origem}</strong></td>
                            <td>{o.ctes.toLocaleString('pt-BR')}</td>
                            <td className="negativo" style={{ fontWeight: 700 }}>{fmt(o.perdaTotal)}</td>
                            <td>{pct(o.perdaPercentual)}</td>
                            <td><Barra valor={o.perdaTotal} maximo={maxTop10} cor="#9b1111" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          )}

          {/* Por Transportadora */}
          {aba === 'transportadoras' && (
            <div className="panel-card">
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>Perda por transportadora realizada</div>
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead>
                    <tr><th>#</th><th>Transportadora realizada</th><th>CT-es com perda</th><th>Perda total</th><th style={{ minWidth: 120 }}>Visual</th></tr>
                  </thead>
                  <tbody>
                    {resultado.porTransportadora.map((t, i) => (
                      <tr key={t.transportadora}>
                        <td style={{ fontWeight: 700, color: '#9153F0' }}>#{i + 1}</td>
                        <td><strong>{t.transportadora}</strong></td>
                        <td>{t.ctes.toLocaleString('pt-BR')}</td>
                        <td className="negativo" style={{ fontWeight: 700 }}>{fmt(t.perdaTotal)}</td>
                        <td><Barra valor={t.perdaTotal} maximo={resultado.porTransportadora[0]?.perdaTotal || 1} cor="#e67e22" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Detalhes */}
          {aba === 'detalhes' && (
            <div className="panel-card">
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>Detalhamento por CT-e</div>
              <div className="form-grid three" style={{ marginBottom: '0.75rem' }}>
                <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={filtroTab.soPerda}
                    onChange={(e) => { setFiltroTab((p) => ({ ...p, soPerda: e.target.checked })); setPagina(0); }} />
                  Apenas CT-es com perda
                </label>
                <label className="field">
                  UF Origem
                  <select value={filtroTab.ufOrigem}
                    onChange={(e) => { setFiltroTab((p) => ({ ...p, ufOrigem: e.target.value })); setPagina(0); }}>
                    <option value="">Todas</option>
                    {ufOrigensDisponiveis.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </label>
                <label className="field">
                  Transportadora
                  <input placeholder="Filtrar transportadora" value={filtroTab.transportadora}
                    onChange={(e) => { setFiltroTab((p) => ({ ...p, transportadora: e.target.value })); setPagina(0); }} />
                </label>
              </div>
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead>
                    <tr>
                      <th>CT-e</th><th>Emissão</th><th>Canal</th>
                      <th>Origem</th><th>Destino</th><th>Peso</th>
                      <Th campo="transportadoraRealizada" label="Transp. realizada" />
                      <Th campo="transportadoraGanhadora" label="Mais barata" />
                      <Th campo="valorPago"               label="Pago" />
                      <Th campo="valorGanhadora"          label="Mais barato" />
                      <Th campo="perda"                   label="Perda" />
                      <Th campo="perdaPercentual"         label="% Perda" />
                      <th>Prazo realiz.</th><th>Prazo ganh.</th><th>Dif. prazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalhesPagina.map((d) => (
                      <tr key={d.chaveCte} style={{ background: d.temPerda ? undefined : '#f8fff8' }}>
                        <td style={{ fontSize: '0.78rem', color: '#666' }}>{d.numeroCte || d.chaveCte?.slice(-8) || '-'}</td>
                        <td>{fmtData(d.emissao)}</td>
                        <td>{d.canal || '-'}</td>
                        <td>{d.cidadeOrigem}/{d.ufOrigem}</td>
                        <td>{d.cidadeDestino}/{d.ufDestino}</td>
                        <td>{Number(d.peso || 0).toLocaleString('pt-BR')} kg</td>
                        <td>{d.transportadoraRealizada}</td>
                        <td style={{ color: '#04C7A4', fontWeight: 600 }}>{d.transportadoraGanhadora}</td>
                        <td>{fmt(d.valorPago)}</td>
                        <td>{fmt(d.valorGanhadora)}</td>
                        <td className={d.temPerda ? 'negativo' : ''} style={{ fontWeight: d.temPerda ? 700 : 400 }}>
                          {d.temPerda ? fmt(d.perda) : '—'}
                        </td>
                        <td style={{ color: d.temPerda ? '#9b1111' : '#888' }}>
                          {d.temPerda ? pct(d.perdaPercentual) : '—'}
                        </td>
                        <td>{d.prazoRealizada != null ? `${d.prazoRealizada}d` : '—'}</td>
                        <td>{d.prazoGanhadora != null ? `${d.prazoGanhadora}d` : '—'}</td>
                        <td style={{
                          color: d.difPrazo == null ? '#888' : d.difPrazo > 0 ? '#e67e22' : d.difPrazo < 0 ? '#04C7A4' : '#555',
                          fontWeight: d.difPrazo != null && d.difPrazo !== 0 ? 700 : 400,
                        }}>
                          {d.difPrazo == null ? '—' : d.difPrazo > 0 ? `+${d.difPrazo}d (mais lenta)` : d.difPrazo < 0 ? `${d.difPrazo}d (mais rápida)` : 'Igual'}
                        </td>
                      </tr>
                    ))}
                    {!detalhesPagina.length && (
                      <tr><td colSpan={15}>Nenhum CT-e encontrado com esses filtros.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {totalPaginas > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: '0.75rem' }}>
                  <button className="btn-secondary" onClick={() => setPagina(0)} disabled={pagina === 0}>«</button>
                  <button className="btn-secondary" onClick={() => setPagina((p) => p - 1)} disabled={pagina === 0}>‹</button>
                  <span style={{ fontSize: '0.85rem', color: '#555' }}>
                    Página {pagina + 1} de {totalPaginas} · {detalhesVisiveis.length.toLocaleString('pt-BR')} registros
                  </span>
                  <button className="btn-secondary" onClick={() => setPagina((p) => p + 1)} disabled={pagina >= totalPaginas - 1}>›</button>
                  <button className="btn-secondary" onClick={() => setPagina(totalPaginas - 1)} disabled={pagina >= totalPaginas - 1}>»</button>
                </div>
              )}
            </div>
          )}

          {/* Sem malha */}
          {aba === 'sem-malha' && (
            <div className="panel-card">
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>
                CT-es fora da malha ({resultado.semMalha.toLocaleString('pt-BR')})
              </div>
              <p style={{ fontSize: '0.85rem', color: '#888' }}>
                Esses CT-es não puderam ser comparados pois a rota não existe nas tabelas cadastradas ou o CT-e não tem chave IBGE.
                Cadastrar tabelas para essas rotas pode revelar economias adicionais.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
