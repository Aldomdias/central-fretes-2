/**
 * PerdaRealizadoPage.jsx
 * Identifica o valor "perdido" por utilizar a transportadora mais cara
 * em vez da opção mais barata disponível nas tabelas cadastradas.
 *
 * Fluxo:
 *  1. Usuário define filtros (período, canal, transportadora, UF destino)
 *  2. Clica em "Processar"
 *  3. Worker analisa em background (sem travar a UI)
 *  4. Resultados: cards, top 10 origens, comparativo de prazo, tabela detalhada
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import { carregarBaseCompletaDb } from '../services/freteDatabaseService';
import { carregarMunicipiosIbgeComFallback } from '../services/ibgeService';
import { carregarVinculosTransportadoras } from '../services/vinculosTransportadorasService';
import { buscarRealizadoLocalParaSimulacao } from '../services/realizadoLocalDb';

// ── Constantes ────────────────────────────────────────────────────────────────

const REGIOES = [
  { label: 'Sul', ufs: ['RS', 'SC', 'PR'] },
  { label: 'Sudeste', ufs: ['SP', 'RJ', 'MG', 'ES'] },
  { label: 'Centro-Oeste', ufs: ['MT', 'MS', 'GO', 'DF'] },
  { label: 'Nordeste', ufs: ['BA', 'SE', 'AL', 'PE', 'PB', 'RN', 'CE', 'PI', 'MA'] },
  { label: 'Norte', ufs: ['AM', 'PA', 'RO', 'AC', 'RR', 'AP', 'TO'] },
];

const TODAS_UFS = REGIOES.flatMap((r) => r.ufs);

const CANAIS = ['', 'ATACADO', 'B2C', 'REVERSA', 'INTERCOMPANY'];

function fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function pct(v) {
  return `${Number(v || 0).toFixed(1)}%`;
}
function fmtData(s) {
  if (!s) return '-';
  const d = String(s).slice(0, 10);
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
}

// ── Componentes auxiliares ────────────────────────────────────────────────────

function Card({ label, valor, sub, cor, destaque }) {
  return (
    <div className="summary-card" style={{ borderLeft: `4px solid ${cor || '#9153F0'}`, background: destaque ? '#fff5f5' : undefined }}>
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

// ── Página ────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function PerdaRealizadoPage() {
  const workerRef = useRef(null);

  // ── Estado de filtros ──────────────────────────────────────────────────────
  const [filtros, setFiltros] = useState({
    inicio: new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString().slice(0, 10),
    fim: new Date().toISOString().slice(0, 10),
    canal: '',
    transportadoraRealizada: '',
    ufsDestino: [], // array de UFs selecionadas
  });

  // ── Estado de processamento ───────────────────────────────────────────────
  const [status, setStatus] = useState('idle'); // idle | carregando | processando | pronto | erro
  const [progresso, setProgresso] = useState({ etapa: '', pct: 0 });
  const [erro, setErro] = useState('');

  // ── Resultado ─────────────────────────────────────────────────────────────
  const [resultado, setResultado] = useState(null);

  // ── Tabela detalhada ──────────────────────────────────────────────────────
  const [pagina, setPagina] = useState(0);
  const [abaResultado, setAbaResultado] = useState('origens'); // origens | transportadoras | detalhes | sem-malha
  const [filtroDetalhe, setFiltroDetalhe] = useState({ soPerda: true, ufOrigem: '', transportadora: '' });
  const [ordenacao, setOrdenacao] = useState({ campo: 'perda', dir: 'desc' });

  // ── Toggle UF destino ─────────────────────────────────────────────────────
  const toggleUf = (uf) => {
    setFiltros((prev) => ({
      ...prev,
      ufsDestino: prev.ufsDestino.includes(uf)
        ? prev.ufsDestino.filter((u) => u !== uf)
        : [...prev.ufsDestino, uf],
    }));
  };

  const toggleRegiao = (ufs) => {
    setFiltros((prev) => {
      const todas = ufs.every((u) => prev.ufsDestino.includes(u));
      return {
        ...prev,
        ufsDestino: todas
          ? prev.ufsDestino.filter((u) => !ufs.includes(u))
          : [...new Set([...prev.ufsDestino, ...ufs])],
      };
    });
  };

  // ── Cleanup worker ────────────────────────────────────────────────────────
  useEffect(() => {
    return () => workerRef.current?.terminate();
  }, []);

  // ── Processar ─────────────────────────────────────────────────────────────
  const processar = async () => {
    workerRef.current?.terminate();
    setStatus('carregando');
    setProgresso({ etapa: 'Carregando tabelas e realizados...', pct: 0 });
    setErro('');
    setResultado(null);

    try {
      // 1. Carrega dados base
      setProgresso({ etapa: 'Carregando tabelas de frete...', pct: 5 });
      const [transportadoras, { municipios }, vinculos] = await Promise.all([
        carregarBaseCompletaDb(),
        carregarMunicipiosIbgeComFallback({ permitirOficial: true }),
        carregarVinculosTransportadoras(),
      ]);

      // 2. Monta filtros para o realizado
      setProgresso({ etapa: 'Carregando CT-es realizados...', pct: 20 });
      const filtrosDb = {
        inicio: filtros.inicio || undefined,
        fim: filtros.fim || undefined,
        canal: filtros.canal || undefined,
        transportadoraRealizada: filtros.transportadoraRealizada || undefined,
      };

      let realizados = await buscarRealizadoLocalParaSimulacao(filtrosDb);

      // Filtro por UFs destino (feito no JS pois o IndexedDB não suporta multi-UF)
      if (filtros.ufsDestino.length > 0) {
        const ufSet = new Set(filtros.ufsDestino.map((u) => u.toUpperCase()));
        realizados = realizados.filter((c) => ufSet.has(String(c.ufDestino || '').toUpperCase()));
      }

      if (!realizados.length) {
        setErro('Nenhum CT-e encontrado com os filtros selecionados.');
        setStatus('erro');
        return;
      }

      // 3. Envia para o worker
      setStatus('processando');
      setProgresso({ etapa: 'Iniciando análise...', pct: 3 });

      const worker = new Worker(
        new URL('../workers/perdaRealizadoWorker.js', import.meta.url),
        { type: 'module' }
      );
      workerRef.current = worker;

      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          setProgresso({ etapa: msg.etapa, pct: msg.pct });
        } else if (msg.type === 'done') {
          setResultado(msg.result);
          setStatus('pronto');
          setPagina(0);
          setAbaResultado('origens');
          worker.terminate();
        } else if (msg.type === 'error') {
          setErro(msg.message);
          setStatus('erro');
          worker.terminate();
        }
      };

      worker.onerror = (e) => {
        setErro(e.message || 'Erro interno no worker.');
        setStatus('erro');
      };

      worker.postMessage({
        type: 'analisar-perda',
        realizados,
        transportadoras,
        municipios,
        vinculos,
      });
    } catch (e) {
      setErro(e.message || 'Erro ao carregar dados.');
      setStatus('erro');
    }
  };

  // ── Tabela detalhada filtrada e ordenada ──────────────────────────────────
  const detalhesVisiveis = useMemo(() => {
    if (!resultado?.detalhes) return [];
    let lista = resultado.detalhes;
    if (filtroDetalhe.soPerda) lista = lista.filter((d) => d.temPerda);
    if (filtroDetalhe.ufOrigem) lista = lista.filter((d) => d.ufOrigem === filtroDetalhe.ufOrigem);
    if (filtroDetalhe.transportadora) {
      const t = filtroDetalhe.transportadora.toUpperCase();
      lista = lista.filter((d) => d.transportadoraRealizada?.toUpperCase().includes(t));
    }
    const { campo, dir } = ordenacao;
    lista = [...lista].sort((a, b) => {
      const va = a[campo] ?? 0;
      const vb = b[campo] ?? 0;
      return dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
    return lista;
  }, [resultado, filtroDetalhe, ordenacao]);

  const totalPaginas = Math.ceil(detalhesVisiveis.length / PAGE_SIZE);
  const detalhesPagina = detalhesVisiveis.slice(pagina * PAGE_SIZE, (pagina + 1) * PAGE_SIZE);

  const maxTop10 = resultado?.top10Origens?.[0]?.perdaTotal || 1;

  const ufOrigensDisponiveis = useMemo(() => {
    if (!resultado?.detalhes) return [];
    return [...new Set(resultado.detalhes.map((d) => d.ufOrigem).filter(Boolean))].sort();
  }, [resultado]);

  const ordenarPor = (campo) => {
    setOrdenacao((prev) => ({
      campo,
      dir: prev.campo === campo && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
    setPagina(0);
  };

  const th = (campo, label) => (
    <th
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      onClick={() => ordenarPor(campo)}
    >
      {label} {ordenacao.campo === campo ? (ordenacao.dir === 'desc' ? '▼' : '▲') : ''}
    </th>
  );

  const processando = status === 'carregando' || status === 'processando';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page-shell">
      <div className="page-header">
        <span className="amd-mini-brand">Realizado · Análise</span>
        <h1>Perda por Transportadora Mais Cara</h1>
        <p>
          Compara o frete pago com a opção mais barata disponível nas tabelas cadastradas.
          Identifica origem, transportadora e valor "deixado na mesa" por não usar a alternativa mais competitiva.
        </p>
      </div>

      {/* ── FILTROS ──────────────────────────────────────────────────────── */}
      <div className="panel-card" style={{ marginBottom: '1rem' }}>
        <div className="panel-title" style={{ marginBottom: '0.75rem' }}>Filtros</div>

        <div className="form-grid three" style={{ marginBottom: '0.75rem' }}>
          <label className="field">
            Data início
            <input type="date" value={filtros.inicio}
              onChange={(e) => setFiltros((p) => ({ ...p, inicio: e.target.value }))} />
          </label>
          <label className="field">
            Data fim
            <input type="date" value={filtros.fim}
              onChange={(e) => setFiltros((p) => ({ ...p, fim: e.target.value }))} />
          </label>
          <label className="field">
            Canal
            <select value={filtros.canal}
              onChange={(e) => setFiltros((p) => ({ ...p, canal: e.target.value }))}>
              <option value="">Todos os canais</option>
              {CANAIS.filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">
            Transportadora realizada
            <input placeholder="Filtrar pelo nome da transportadora que carregou"
              value={filtros.transportadoraRealizada}
              onChange={(e) => setFiltros((p) => ({ ...p, transportadoraRealizada: e.target.value }))} />
          </label>
        </div>

        {/* Estados destino */}
        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#555', marginBottom: '0.4rem' }}>
            Estados de destino&nbsp;
            <span style={{ fontWeight: 400, color: '#888' }}>
              ({filtros.ufsDestino.length === 0 ? 'todos' : `${filtros.ufsDestino.length} selecionados`})
            </span>
            {filtros.ufsDestino.length > 0 && (
              <button className="btn-secondary" style={{ marginLeft: 8, padding: '1px 8px', fontSize: '0.75rem' }}
                onClick={() => setFiltros((p) => ({ ...p, ufsDestino: [] }))}>
                Limpar
              </button>
            )}
            <button className="btn-secondary" style={{ marginLeft: 4, padding: '1px 8px', fontSize: '0.75rem' }}
              onClick={() => setFiltros((p) => ({ ...p, ufsDestino: [...TODAS_UFS] }))}>
              Todos
            </button>
          </div>

          {/* Botões de região */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            {REGIOES.map((reg) => {
              const todas = reg.ufs.every((u) => filtros.ufsDestino.includes(u));
              return (
                <button key={reg.label}
                  className={todas ? 'btn-primary' : 'btn-secondary'}
                  style={{ fontSize: '0.78rem', padding: '3px 10px' }}
                  onClick={() => toggleRegiao(reg.ufs)}>
                  {reg.label} ({reg.ufs.join(', ')})
                </button>
              );
            })}
          </div>

          {/* UFs individuais */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {TODAS_UFS.map((uf) => {
              const sel = filtros.ufsDestino.includes(uf);
              return (
                <button key={uf}
                  onClick={() => toggleUf(uf)}
                  style={{
                    padding: '3px 9px', fontSize: '0.78rem', borderRadius: 4, cursor: 'pointer',
                    border: '1px solid',
                    borderColor: sel ? '#9153F0' : '#ccc',
                    background: sel ? '#9153F0' : '#fff',
                    color: sel ? '#fff' : '#555',
                    fontWeight: sel ? 700 : 400,
                  }}>
                  {uf}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-primary"
            onClick={processar}
            disabled={processando}
            style={{ minWidth: 140 }}>
            {processando ? '⟳ Processando...' : '▶ Processar'}
          </button>
          {processando && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: 3 }}>
                {progresso.etapa}
              </div>
              <div style={{ background: '#eee', borderRadius: 99, height: 8, overflow: 'hidden' }}>
                <div style={{
                  background: '#9153F0', height: '100%', borderRadius: 99,
                  width: `${progresso.pct}%`, transition: 'width .3s',
                }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Erro */}
      {erro && (
        <div className="hint-box compact" style={{ background: '#fff5f5', border: '1px solid #f5c6cb', marginBottom: '1rem' }}>
          ⚠️ {erro}
        </div>
      )}

      {/* ── RESULTADOS ───────────────────────────────────────────────────── */}
      {resultado && (
        <>
          {/* Cards */}
          <div className="summary-strip" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <Card label="CT-es analisados" valor={resultado.totalCtes.toLocaleString('pt-BR')} cor="#9153F0" />
            <Card label="CT-es com perda" valor={resultado.ctesComPerda.toLocaleString('pt-BR')}
              sub={pct(resultado.totalCtes > 0 ? (resultado.ctesComPerda / resultado.totalCtes) * 100 : 0)}
              cor="#e67e22" />
            <Card label="Perda total" valor={fmt(resultado.perdaTotal)} cor="#9b1111" destaque={resultado.perdaTotal > 0} />
            <Card label="Perda média por CT-e" valor={fmt(resultado.perdaMedia)} cor="#e67e22" />
            <Card label="Fora da malha" valor={resultado.semMalha.toLocaleString('pt-BR')}
              sub="sem tabela cadastrada" cor="#888" />
          </div>

          {/* Abas de resultado */}
          <div style={{ display: 'flex', gap: 4, marginBottom: '0.5rem', borderBottom: '2px solid #eee', paddingBottom: '0.25rem' }}>
            {[
              { id: 'origens', label: `Top 10 Origens (${resultado.top10Origens.length})` },
              { id: 'transportadoras', label: `Por Transportadora (${resultado.porTransportadora.length})` },
              { id: 'detalhes', label: `Detalhes (${detalhesVisiveis.length.toLocaleString('pt-BR')})` },
              { id: 'sem-malha', label: `Sem malha (${resultado.semMalha})` },
            ].map((aba) => (
              <button key={aba.id}
                onClick={() => { setAbaResultado(aba.id); setPagina(0); }}
                style={{
                  padding: '4px 14px', border: 'none', borderRadius: '4px 4px 0 0', cursor: 'pointer',
                  background: abaResultado === aba.id ? '#9153F0' : '#f0f0f0',
                  color: abaResultado === aba.id ? '#fff' : '#555',
                  fontWeight: abaResultado === aba.id ? 700 : 400,
                  fontSize: '0.85rem',
                }}>
                {aba.label}
              </button>
            ))}
          </div>

          {/* Aba: Top 10 Origens */}
          {abaResultado === 'origens' && (
            <div className="panel-card">
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>
                Top 10 origens por valor de perda
              </div>
              {resultado.top10Origens.length === 0 ? (
                <p style={{ color: '#888', fontSize: '0.9rem' }}>Nenhuma origem com perda encontrada.</p>
              ) : (
                <div className="sim-analise-tabela-wrap">
                  <table className="sim-analise-tabela">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Origem</th>
                        <th>CT-es com perda</th>
                        <th>Perda total</th>
                        <th>% sobre frete pago</th>
                        <th style={{ minWidth: 120 }}>Visual</th>
                      </tr>
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

          {/* Aba: Por Transportadora */}
          {abaResultado === 'transportadoras' && (
            <div className="panel-card">
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>
                Perda por transportadora realizada
              </div>
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Transportadora realizada</th>
                      <th>CT-es com perda</th>
                      <th>Perda total</th>
                      <th style={{ minWidth: 120 }}>Visual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.porTransportadora.map((t, i) => (
                      <tr key={t.transportadora}>
                        <td style={{ fontWeight: 700, color: '#9153F0' }}>#{i + 1}</td>
                        <td><strong>{t.transportadora}</strong></td>
                        <td>{t.ctes.toLocaleString('pt-BR')}</td>
                        <td className="negativo" style={{ fontWeight: 700 }}>{fmt(t.perdaTotal)}</td>
                        <td>
                          <Barra valor={t.perdaTotal}
                            maximo={resultado.porTransportadora[0]?.perdaTotal || 1}
                            cor="#e67e22" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Aba: Detalhes */}
          {abaResultado === 'detalhes' && (
            <div className="panel-card">
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>
                Detalhamento por CT-e
              </div>

              {/* Filtros de detalhe */}
              <div className="form-grid three" style={{ marginBottom: '0.75rem' }}>
                <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={filtroDetalhe.soPerda}
                    onChange={(e) => { setFiltroDetalhe((p) => ({ ...p, soPerda: e.target.checked })); setPagina(0); }} />
                  Mostrar apenas CT-es com perda
                </label>
                <label className="field">
                  UF Origem
                  <select value={filtroDetalhe.ufOrigem}
                    onChange={(e) => { setFiltroDetalhe((p) => ({ ...p, ufOrigem: e.target.value })); setPagina(0); }}>
                    <option value="">Todas</option>
                    {ufOrigensDisponiveis.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </label>
                <label className="field">
                  Transportadora
                  <input placeholder="Filtrar transportadora"
                    value={filtroDetalhe.transportadora}
                    onChange={(e) => { setFiltroDetalhe((p) => ({ ...p, transportadora: e.target.value })); setPagina(0); }} />
                </label>
              </div>

              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead>
                    <tr>
                      <th>CT-e</th>
                      <th>Emissão</th>
                      <th>Canal</th>
                      <th>Origem</th>
                      <th>Destino</th>
                      <th>Peso</th>
                      {th('transportadoraRealizada', 'Transp. realizada')}
                      {th('transportadoraGanhadora', 'Mais barata disponível')}
                      {th('valorPago', 'Pago')}
                      {th('valorGanhadora', 'Mais barato')}
                      {th('perda', 'Perda')}
                      {th('perdaPercentual', '% Perda')}
                      <th>Prazo realiz.</th>
                      <th>Prazo ganh.</th>
                      <th>Dif. prazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalhesPagina.map((d) => (
                      <tr key={d.chaveCte}
                        style={{ background: d.temPerda ? undefined : '#f8fff8' }}>
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
                          {d.difPrazo == null ? '—'
                            : d.difPrazo > 0 ? `+${d.difPrazo}d (mais lenta)`
                            : d.difPrazo < 0 ? `${d.difPrazo}d (mais rápida)`
                            : 'Igual'}
                        </td>
                      </tr>
                    ))}
                    {detalhesPagina.length === 0 && (
                      <tr><td colSpan={15}>Nenhum CT-e encontrado com esses filtros.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Paginação */}
              {totalPaginas > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: '0.75rem' }}>
                  <button className="btn-secondary" onClick={() => setPagina(0)} disabled={pagina === 0}>«</button>
                  <button className="btn-secondary" onClick={() => setPagina((p) => p - 1)} disabled={pagina === 0}>‹</button>
                  <span style={{ fontSize: '0.85rem', color: '#555' }}>
                    Página {pagina + 1} de {totalPaginas}
                    &nbsp;·&nbsp;{detalhesVisiveis.length.toLocaleString('pt-BR')} registros
                  </span>
                  <button className="btn-secondary" onClick={() => setPagina((p) => p + 1)} disabled={pagina >= totalPaginas - 1}>›</button>
                  <button className="btn-secondary" onClick={() => setPagina(totalPaginas - 1)} disabled={pagina >= totalPaginas - 1}>»</button>
                </div>
              )}
            </div>
          )}

          {/* Aba: Sem malha */}
          {abaResultado === 'sem-malha' && (
            <div className="panel-card">
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>
                CT-es fora da malha de tabelas ({resultado.semMalha})
              </div>
              <p style={{ fontSize: '0.85rem', color: '#888', marginBottom: '0.5rem' }}>
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
