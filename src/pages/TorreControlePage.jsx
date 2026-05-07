import { useEffect, useMemo, useState } from 'react';
import {
  diagnosticarTrackingLocal,
  exportarTrackingLocal,
} from '../utils/trackingLocal';

const CORES = {
  roxo: '#9153F0',
  roxoEscuro: '#4E008F',
  roxo2: '#6514DE',
  verde: '#04C7A4',
  vermelho: '#9b1111',
  amarelo: '#f0a800',
  cinza: '#7a8497',
};

function normalizarTexto(value = '') {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function numero(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function formatarNumero(value, casas = 0) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function formatarMoeda(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function formatarPercentual(value, casas = 2) {
  return `${formatarNumero((Number(value) || 0) * 100, casas)}%`;
}

function hojeIsoLocal() {
  const hoje = new Date();
  const yyyy = hoje.getFullYear();
  const mm = String(hoje.getMonth() + 1).padStart(2, '0');
  const dd = String(hoje.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dataCurta(value = '') {
  if (!value) return '-';
  const [ano, mes, dia] = String(value).slice(0, 10).split('-');
  if (!ano || !mes || !dia) return value;
  return `${dia}/${mes}`;
}

function chaveDia(row) {
  return row.entrega || row.prevTransportadora || row.previsaoCliente || row.data || 'Sem data';
}

function prazoDaLinha(row = {}) {
  return row.prevTransportadora || row.previsaoCliente || '';
}

function entregaDaLinha(row = {}) {
  return row.entrega || '';
}

function isEntregue(row = {}) {
  if (entregaDaLinha(row)) return true;
  const status = normalizarTexto(`${row.status || ''} ${row.situacao || ''} ${row.entregaCte || ''}`);
  if (!status) return false;
  if (status.includes('SEM ENTREGA') || status.includes('NAO ENTREGUE') || status.includes('NÃO ENTREGUE')) return false;
  return status.includes('ENTREGUE') || status.includes('ENTREGA REALIZADA') || status.includes('FINALIZADO') || status.includes('CONCLUIDO') || status.includes('CONCLUÍDO');
}

function classificarLinha(row = {}, hoje = hojeIsoLocal()) {
  const prazo = prazoDaLinha(row);
  const entrega = entregaDaLinha(row);
  const entregue = isEntregue(row);
  const temPrazo = Boolean(prazo);
  const antecipado = entregue && temPrazo && entrega && entrega < prazo;
  const noPrazo = entregue && temPrazo && entrega && entrega <= prazo;
  const foraPrazo = entregue && temPrazo && entrega && entrega > prazo;
  const emTransito = !entregue;
  const expiraHoje = emTransito && temPrazo && prazo === hoje;
  const transitoAtrasado = emTransito && temPrazo && prazo < hoje;
  const transitoNoPrazo = emTransito && temPrazo && prazo > hoje;

  let statusControle = 'Sem prazo';
  if (entregue && noPrazo) statusControle = antecipado ? 'Entregue antecipado' : 'Entregue no prazo';
  else if (entregue && foraPrazo) statusControle = 'Entregue fora do prazo';
  else if (entregue) statusControle = 'Entregue sem prazo';
  else if (expiraHoje) statusControle = 'Expira hoje';
  else if (transitoAtrasado) statusControle = 'Sem entrega atrasada';
  else if (transitoNoPrazo) statusControle = 'Sem entrega no prazo';

  return {
    ...row,
    prazoControle: prazo,
    entregaControle: entrega,
    entregue,
    temPrazo,
    antecipado,
    entregueNoPrazo: noPrazo,
    entregueForaPrazo: foraPrazo,
    emTransito,
    expiraHoje,
    transitoAtrasado,
    transitoNoPrazo,
    statusControle,
    diaControle: chaveDia(row),
    transportadoraControle: row.transportadora || 'Sem transportadora',
    ufDestinoControle: row.ufDestino || 'Sem UF',
    origemControle: row.cidadeOrigem || 'Sem origem',
    valorNFControle: numero(row.valorNF),
    unidadesControle: numero(row.totalUnidades) || numero(row.quantidadeItens) || numero(row.qtdVolumes),
  };
}

function criarResumo(rows = []) {
  const base = {
    total: rows.length,
    entregues: 0,
    entregueNoPrazo: 0,
    entregueForaPrazo: 0,
    entregueSemPrazo: 0,
    emTransito: 0,
    transitoNoPrazo: 0,
    transitoAtrasado: 0,
    expiraHoje: 0,
    antecipado: 0,
    unidades: 0,
    faturamento: 0,
    semPrazo: 0,
  };

  rows.forEach((row) => {
    base.unidades += row.unidadesControle;
    base.faturamento += row.valorNFControle;
    if (row.entregue) base.entregues += 1;
    if (row.entregueNoPrazo) base.entregueNoPrazo += 1;
    if (row.entregueForaPrazo) base.entregueForaPrazo += 1;
    if (row.entregue && !row.temPrazo) base.entregueSemPrazo += 1;
    if (row.emTransito) base.emTransito += 1;
    if (row.transitoNoPrazo) base.transitoNoPrazo += 1;
    if (row.transitoAtrasado) base.transitoAtrasado += 1;
    if (row.expiraHoje) base.expiraHoje += 1;
    if (row.antecipado) base.antecipado += 1;
    if (!row.temPrazo) base.semPrazo += 1;
  });

  const entreguesComPrazo = base.entregueNoPrazo + base.entregueForaPrazo;
  const transitoComPrazo = base.transitoNoPrazo + base.transitoAtrasado + base.expiraHoje;
  base.otdEntregue = entreguesComPrazo ? base.entregueNoPrazo / entreguesComPrazo : 0;
  base.otdTransito = transitoComPrazo ? (base.transitoNoPrazo + base.expiraHoje) / transitoComPrazo : 0;
  base.atrasosGeral = base.entregueForaPrazo + base.transitoAtrasado;
  return base;
}

function agrupar(rows = [], chaveFn, valorFn = () => 1) {
  const mapa = new Map();
  rows.forEach((row) => {
    const chave = chaveFn(row) || 'Sem informação';
    if (!mapa.has(chave)) mapa.set(chave, { nome: chave, total: 0, valor: 0, linhas: [] });
    const item = mapa.get(chave);
    item.total += 1;
    item.valor += valorFn(row);
    item.linhas.push(row);
  });
  return Array.from(mapa.values());
}

function rankingTransportadoras(rows = []) {
  return agrupar(rows, (row) => row.transportadoraControle).map((item) => {
    const resumo = criarResumo(item.linhas);
    return {
      ...item,
      otd: resumo.entregueNoPrazo + resumo.entregueForaPrazo ? resumo.otdEntregue : resumo.otdTransito,
      entregues: resumo.entregues,
      atrasos: resumo.atrasosGeral,
      foraPrazo: resumo.entregueForaPrazo + resumo.transitoAtrasado,
      faturamento: resumo.faturamento,
      unidades: resumo.unidades,
    };
  });
}

function seriePorDia(rows = []) {
  const ordenado = agrupar(rows, (row) => row.diaControle)
    .filter((item) => item.nome && item.nome !== 'Sem data')
    .map((item) => {
      const resumo = criarResumo(item.linhas);
      return {
        dia: item.nome,
        label: dataCurta(item.nome),
        total: resumo.total,
        entregues: resumo.entregues,
        entregueNoPrazo: resumo.entregueNoPrazo,
        entregueForaPrazo: resumo.entregueForaPrazo,
        transitoNoPrazo: resumo.transitoNoPrazo,
        transitoAtrasado: resumo.transitoAtrasado,
        expiraHoje: resumo.expiraHoje,
        faturamento: resumo.faturamento,
        otd: resumo.entregueNoPrazo + resumo.entregueForaPrazo ? resumo.otdEntregue : resumo.otdTransito,
      };
    })
    .sort((a, b) => String(a.dia).localeCompare(String(b.dia)));
  return ordenado.slice(-35);
}

function opcoesDistintas(rows = [], campo) {
  return Array.from(new Set(rows.map((row) => row[campo]).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
}

function KpiCard({ titulo, valor, detalhe, alerta }) {
  return (
    <div className={alerta ? 'torre-kpi-card alerta' : 'torre-kpi-card'}>
      <span>{titulo}</span>
      <strong>{valor}</strong>
      {detalhe ? <small>{detalhe}</small> : null}
    </div>
  );
}

function Gauge({ titulo, percentual, alvo = 0.95 }) {
  const pct = Math.max(0, Math.min(1, percentual || 0));
  const raio = 78;
  const comprimento = Math.PI * raio;
  const preenchido = comprimento * pct;
  const alvoX = 100 - Math.cos(Math.PI * alvo) * raio;
  const alvoY = 100 - Math.sin(Math.PI * alvo) * raio;
  return (
    <div className="torre-chart-card gauge-card">
      <div className="torre-card-title">{titulo}</div>
      <svg viewBox="0 0 220 135" className="torre-gauge">
        <path d="M 32 102 A 78 78 0 0 1 188 102" pathLength={comprimento} className="gauge-bg" />
        <path
          d="M 32 102 A 78 78 0 0 1 188 102"
          pathLength={comprimento}
          className="gauge-fill"
          style={{ strokeDasharray: `${preenchido} ${comprimento}` }}
        />
        <line x1={alvoX} y1={alvoY - 8} x2={alvoX} y2={alvoY + 14} className="gauge-target" />
        <text x="110" y="88" textAnchor="middle" className="gauge-value">{formatarPercentual(pct)}</text>
        <text x="34" y="120" className="gauge-axis">0%</text>
        <text x="170" y="120" className="gauge-axis">100%</text>
        <text x={Math.min(190, alvoX + 8)} y={Math.max(24, alvoY + 6)} className="gauge-axis">meta {formatarPercentual(alvo, 0)}</text>
      </svg>
    </div>
  );
}

function BarraHorizontal({ item, max, valorLabel, detalheLabel, variant = 'primary' }) {
  const pct = max ? Math.max(2, (item.valor / max) * 100) : 0;
  return (
    <div className="torre-bar-row">
      <div className="torre-bar-label" title={item.nome}>{item.nome}</div>
      <div className="torre-bar-track">
        <div className={`torre-bar-fill ${variant}`} style={{ width: `${pct}%` }} />
        <span>{valorLabel || formatarNumero(item.valor)}</span>
      </div>
      {detalheLabel ? <small>{detalheLabel}</small> : null}
    </div>
  );
}

function BarChart({ titulo, dados = [], valorKey = 'valor', maxItems = 10, formatValor, detalhe, variant }) {
  const itens = dados.slice(0, maxItems).map((item) => ({ ...item, valor: numero(item[valorKey]) }));
  const max = Math.max(1, ...itens.map((item) => item.valor));
  return (
    <div className="torre-chart-card">
      <div className="torre-card-title">{titulo}</div>
      <div className="torre-bar-list">
        {itens.map((item) => (
          <BarraHorizontal
            key={item.nome}
            item={item}
            max={max}
            valorLabel={formatValor ? formatValor(item.valor, item) : formatarNumero(item.valor)}
            detalheLabel={detalhe ? detalhe(item) : ''}
            variant={variant}
          />
        ))}
        {!itens.length ? <div className="empty-note">Sem dados para exibir.</div> : null}
      </div>
    </div>
  );
}

function LineChart({ titulo, dados = [], valorKey = 'otd', percentual = true }) {
  const width = 760;
  const height = 250;
  const pad = 34;
  const valores = dados.map((item) => numero(item[valorKey]));
  const maxValor = percentual ? Math.max(1, ...valores) : Math.max(1, ...valores) * 1.12;
  const minValor = percentual ? 0 : 0;
  const pontos = dados.map((item, index) => {
    const x = dados.length <= 1 ? width / 2 : pad + (index * (width - pad * 2)) / (dados.length - 1);
    const y = height - pad - ((numero(item[valorKey]) - minValor) / (maxValor - minValor || 1)) * (height - pad * 2);
    return { ...item, x, y };
  });
  const path = pontos.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const area = pontos.length ? `${path} L ${pontos[pontos.length - 1].x} ${height - pad} L ${pontos[0].x} ${height - pad} Z` : '';

  return (
    <div className="torre-chart-card wide">
      <div className="torre-card-title">{titulo}</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="torre-line-chart">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="chart-axis" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="chart-axis" />
        {[0.25, 0.5, 0.75, 1].map((grid) => {
          const y = height - pad - grid * (height - pad * 2);
          return <line key={grid} x1={pad} y1={y} x2={width - pad} y2={y} className="chart-grid" />;
        })}
        {area ? <path d={area} className="chart-area" /> : null}
        {path ? <path d={path} className="chart-line" /> : null}
        {pontos.map((p, idx) => (
          <g key={`${p.dia}-${idx}`}>
            <circle cx={p.x} cy={p.y} r="4" className="chart-dot" />
            {(idx === pontos.length - 1 || idx % 5 === 0) && (
              <>
                <text x={p.x} y={p.y - 10} textAnchor="middle" className="chart-label">
                  {percentual ? formatarPercentual(p[valorKey], 1) : formatarNumero(p[valorKey])}
                </text>
                <text x={p.x} y={height - 10} textAnchor="middle" className="chart-label muted">
                  {p.label}
                </text>
              </>
            )}
          </g>
        ))}
      </svg>
      {!dados.length ? <div className="empty-note">Sem histórico no período selecionado.</div> : null}
    </div>
  );
}

function StackedDailyChart({ titulo, dados = [] }) {
  const max = Math.max(1, ...dados.map((item) => item.total));
  return (
    <div className="torre-chart-card wide">
      <div className="torre-card-title">{titulo}</div>
      <div className="torre-legend">
        <span><i className="leg roxo" />Entregue/no prazo</span>
        <span><i className="leg vermelho" />Fora/atrasada</span>
        <span><i className="leg verde" />Em trânsito no prazo</span>
        <span><i className="leg amarelo" />Expira hoje</span>
      </div>
      <div className="torre-daily-stack">
        {dados.map((item) => {
          const altura = Math.max(6, (item.total / max) * 170);
          const total = Math.max(1, item.total);
          const pctOk = ((item.entregueNoPrazo + item.transitoNoPrazo) / total) * 100;
          const pctRuim = ((item.entregueForaPrazo + item.transitoAtrasado) / total) * 100;
          const pctHoje = (item.expiraHoje / total) * 100;
          return (
            <div className="torre-stack-col" key={item.dia} title={`${item.label}: ${formatarNumero(item.total)} notas`}>
              <small>{formatarNumero(item.total)}</small>
              <div className="torre-stack-bar" style={{ height: `${altura}px` }}>
                <span className="stack-ok" style={{ height: `${pctOk}%` }} />
                <span className="stack-bad" style={{ height: `${pctRuim}%` }} />
                <span className="stack-today" style={{ height: `${pctHoje}%` }} />
              </div>
              <em>{item.label}</em>
            </div>
          );
        })}
        {!dados.length ? <div className="empty-note">Sem dados no período selecionado.</div> : null}
      </div>
    </div>
  );
}

function TabelaResumo({ titulo, linhas = [] }) {
  return (
    <section className="table-card torre-table-card">
      <div className="panel-title">{titulo}</div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Transportadora</th>
              <th>Notas</th>
              <th>OTD</th>
              <th>Atrasos</th>
              <th>Faturamento</th>
              <th>Unidades</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((item) => (
              <tr key={item.nome}>
                <td>{item.nome}</td>
                <td>{formatarNumero(item.total)}</td>
                <td className={item.otd >= 0.95 ? 'positivo' : 'negativo'}>{formatarPercentual(item.otd)}</td>
                <td className={item.atrasos > 0 ? 'negativo' : ''}>{formatarNumero(item.atrasos)}</td>
                <td>{formatarMoeda(item.faturamento)}</td>
                <td>{formatarNumero(item.unidades)}</td>
              </tr>
            ))}
            {!linhas.length ? <tr><td colSpan="6">Sem dados para exibir.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function TorreControlePage() {
  const [aba, setAba] = useState('geral');
  const [rows, setRows] = useState([]);
  const [diagnostico, setDiagnostico] = useState({ total: 0, ultimaAtualizacao: '' });
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [filtros, setFiltros] = useState({ inicio: '', fim: '', canal: '', transportadora: '', ufDestino: '', origem: '' });

  async function carregar(filtrosAtuais = filtros) {
    setCarregando(true);
    setErro('');
    try {
      const [diag, exportado] = await Promise.all([
        diagnosticarTrackingLocal(),
        exportarTrackingLocal({
          inicio: filtrosAtuais.inicio,
          fim: filtrosAtuais.fim,
          canal: filtrosAtuais.canal,
          transportadora: filtrosAtuais.transportadora,
          ufDestino: filtrosAtuais.ufDestino,
          origem: filtrosAtuais.origem,
        }, { limit: 500000 }),
      ]);
      setDiagnostico(diag);
      const hoje = hojeIsoLocal();
      setRows((exportado.rows || []).map((row) => classificarLinha(row, hoje)));
    } catch (error) {
      setErro(error.message || 'Erro ao carregar a Torre de Controle.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumo = useMemo(() => criarResumo(rows), [rows]);
  const serie = useMemo(() => seriePorDia(rows), [rows]);
  const transportadoras = useMemo(() => rankingTransportadoras(rows), [rows]);
  const rankingOtd = useMemo(() => [...transportadoras].filter((item) => item.total > 0).sort((a, b) => b.otd - a.otd || b.total - a.total), [transportadoras]);
  const ofensores = useMemo(() => [...transportadoras].sort((a, b) => b.foraPrazo - a.foraPrazo || b.total - a.total), [transportadoras]);
  const volumeTransportadora = useMemo(() => [...transportadoras].sort((a, b) => b.total - a.total), [transportadoras]);
  const porEstado = useMemo(() => agrupar(rows, (row) => row.ufDestinoControle).map((item) => ({ ...item, percentual: resumo.total ? item.total / resumo.total : 0 })).sort((a, b) => b.total - a.total), [rows, resumo.total]);
  const porOrigemExpiraHoje = useMemo(() => agrupar(rows.filter((row) => row.expiraHoje), (row) => row.origemControle).sort((a, b) => b.total - a.total), [rows]);
  const faturamentoDia = useMemo(() => serie.map((item) => ({ ...item, valor: item.faturamento })), [serie]);
  const atrasosPorRegiao = useMemo(() => agrupar(rows.filter((row) => row.entregueForaPrazo || row.transitoAtrasado), (row) => row.ufDestinoControle).sort((a, b) => b.total - a.total), [rows]);

  const opcoes = useMemo(() => ({
    canais: opcoesDistintas(rows, 'canal'),
    transportadoras: opcoesDistintas(rows, 'transportadoraControle'),
    ufs: opcoesDistintas(rows, 'ufDestinoControle'),
    origens: opcoesDistintas(rows, 'origemControle'),
  }), [rows]);

  function atualizarFiltro(campo, valor) {
    setFiltros((prev) => ({ ...prev, [campo]: valor }));
  }

  function limparFiltros() {
    const limpos = { inicio: '', fim: '', canal: '', transportadora: '', ufDestino: '', origem: '' };
    setFiltros(limpos);
    carregar(limpos);
  }

  return (
    <div className="page-shell torre-page">
      <div className="page-header">
        <div className="amd-mini-brand">AMD Log • Torre de Controle</div>
        <h1>Torre de Controle</h1>
        <p>
          Módulo baseado na mesma base local de Tracking. A visão acompanha quantidade de notas entregues,
          notas em atraso, OTD, entregas em trânsito, performance por transportadora, origem, destino e faturamento.
        </p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}

      <section className="panel-card torre-filter-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Filtros da análise</div>
            <p className="compact">Use o período e os filtros para reproduzir as visões do BI dentro do sistema.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={limparFiltros} disabled={carregando}>Limpar</button>
            <button className="btn-primary" type="button" onClick={() => carregar()} disabled={carregando}>{carregando ? 'Atualizando...' : 'Atualizar torre'}</button>
          </div>
        </div>
        <div className="form-grid three torre-filters-grid">
          <label className="field">Início<input type="date" value={filtros.inicio} onChange={(e) => atualizarFiltro('inicio', e.target.value)} /></label>
          <label className="field">Fim<input type="date" value={filtros.fim} onChange={(e) => atualizarFiltro('fim', e.target.value)} /></label>
          <label className="field">Canal
            <select value={filtros.canal} onChange={(e) => atualizarFiltro('canal', e.target.value)}>
              <option value="">Todos</option>
              {opcoes.canais.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">Transportadora
            <input list="torre-transportadoras" value={filtros.transportadora} onChange={(e) => atualizarFiltro('transportadora', e.target.value)} placeholder="Todas" />
            <datalist id="torre-transportadoras">{opcoes.transportadoras.map((item) => <option key={item} value={item} />)}</datalist>
          </label>
          <label className="field">UF destino
            <select value={filtros.ufDestino} onChange={(e) => atualizarFiltro('ufDestino', e.target.value)}>
              <option value="">Todas</option>
              {opcoes.ufs.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">Origem
            <input list="torre-origens" value={filtros.origem} onChange={(e) => atualizarFiltro('origem', e.target.value)} placeholder="Todas" />
            <datalist id="torre-origens">{opcoes.origens.map((item) => <option key={item} value={item} />)}</datalist>
          </label>
        </div>
        <div className="hint-box compact">
          Base local de Tracking: {formatarNumero(diagnostico.total)} linha(s). Última atualização: {diagnostico.ultimaAtualizacao ? new Date(diagnostico.ultimaAtualizacao).toLocaleString('pt-BR') : '-'}.
        </div>
      </section>

      <div className="toggle-row torre-tabs">
        {[
          ['geral', 'OTD entregue'],
          ['transito', 'OTD trânsito'],
          ['historico', 'Histórico de atrasos'],
          ['acompanhamento', 'Acompanhamento'],
        ].map(([chave, label]) => (
          <button key={chave} className={aba === chave ? 'toggle-btn active' : 'toggle-btn'} type="button" onClick={() => setAba(chave)}>{label}</button>
        ))}
      </div>

      {aba === 'geral' && (
        <>
          <div className="torre-kpi-grid">
            <KpiCard titulo="Entregue no prazo" valor={formatarNumero(resumo.entregueNoPrazo)} />
            <KpiCard titulo="Entregue fora do prazo" valor={formatarNumero(resumo.entregueForaPrazo)} alerta />
            <KpiCard titulo="Total de notas entregues" valor={formatarNumero(resumo.entregues)} detalhe={`${formatarNumero(resumo.entregueSemPrazo)} sem prazo`} />
            <KpiCard titulo="Total de unidades" valor={formatarNumero(resumo.unidades)} />
            <KpiCard titulo="Faturamento" valor={formatarMoeda(resumo.faturamento)} />
          </div>
          <div className="torre-main-grid">
            <Gauge titulo="% OTD entregue" percentual={resumo.otdEntregue} />
            <LineChart titulo="% evolução de performance" dados={serie} valorKey="otd" />
          </div>
          <div className="torre-three-grid">
            <BarChart titulo="OTD e volume por transportadora" dados={rankingOtd.map((item) => ({ ...item, valor: item.total }))} formatValor={(v, item) => `${formatarNumero(v)} · ${formatarPercentual(item.otd)}`} detalhe={(item) => `Atrasos: ${formatarNumero(item.atrasos)}`} />
            <BarChart titulo="OTD por estado destino" dados={porEstado.map((item) => ({ ...item, valor: item.total }))} formatValor={(v) => formatarNumero(v)} />
            <BarChart titulo="Percentual por estado" dados={porEstado.map((item) => ({ ...item, valor: item.percentual }))} formatValor={(v) => formatarPercentual(v)} />
          </div>
          <TabelaResumo titulo="Resumo por transportadora" linhas={rankingOtd.slice(0, 20)} />
        </>
      )}

      {aba === 'transito' && (
        <>
          <div className="torre-kpi-grid">
            <KpiCard titulo="Pedidos no prazo" valor={formatarNumero(resumo.transitoNoPrazo)} />
            <KpiCard titulo="Pedidos fora do prazo" valor={formatarNumero(resumo.transitoAtrasado)} alerta />
            <KpiCard titulo="Expira hoje" valor={formatarNumero(resumo.expiraHoje)} detalhe="Sem entrega e prazo igual a hoje" />
            <KpiCard titulo="Total pedidos em trânsito" valor={formatarNumero(resumo.emTransito)} />
            <KpiCard titulo="Entregue antecipado" valor={formatarNumero(resumo.antecipado)} />
          </div>
          <div className="torre-main-grid">
            <Gauge titulo="% OTD trânsito" percentual={resumo.otdTransito} />
            <StackedDailyChart titulo="Acompanhamento de entregas" dados={serie} />
          </div>
          <div className="torre-three-grid">
            <BarChart titulo="OTD por transportadora" dados={rankingOtd.map((item) => ({ ...item, valor: item.otd }))} formatValor={(v, item) => `${formatarPercentual(v)} · ${formatarNumero(item.total)}`} />
            <BarChart titulo="Transportadora ofensora" dados={ofensores.map((item) => ({ ...item, valor: item.foraPrazo }))} variant="danger" />
            <BarChart titulo="OTD por região/UF" dados={porEstado.map((item) => ({ ...item, valor: item.percentual }))} formatValor={(v) => formatarPercentual(v)} />
          </div>
        </>
      )}

      {aba === 'historico' && (
        <>
          <div className="torre-kpi-grid historico">
            <KpiCard titulo="Total de atrasos geral" valor={formatarNumero(resumo.atrasosGeral)} alerta />
            <KpiCard titulo="Total de atrasos em aberto" valor={formatarNumero(resumo.transitoAtrasado)} alerta />
            <KpiCard titulo="Qtd nota faturada" valor={formatarNumero(resumo.total)} />
            <KpiCard titulo="Qtd unidades faturada" valor={formatarNumero(resumo.unidades)} />
          </div>
          <div className="torre-two-grid">
            <BarChart titulo="Atrasos por transportadora" dados={ofensores.map((item) => ({ ...item, valor: item.foraPrazo }))} variant="danger" />
            <BarChart titulo="Atrasos por região" dados={atrasosPorRegiao.map((item) => ({ ...item, valor: item.total }))} variant="danger" />
          </div>
          <LineChart titulo="Quantidade de NF's entregue por dia" dados={serie} valorKey="entregues" percentual={false} />
          <LineChart titulo="Atrasados por dia" dados={serie.map((item) => ({ ...item, atrasos: item.entregueForaPrazo + item.transitoAtrasado }))} valorKey="atrasos" percentual={false} />
        </>
      )}

      {aba === 'acompanhamento' && (
        <>
          <div className="torre-kpi-grid">
            <KpiCard titulo="No prazo" valor={formatarNumero(resumo.transitoNoPrazo)} />
            <KpiCard titulo="Fora do prazo" valor={formatarNumero(resumo.transitoAtrasado)} alerta />
            <KpiCard titulo="Expira hoje" valor={formatarNumero(resumo.expiraHoje)} />
            <KpiCard titulo="Total de pedidos" valor={formatarNumero(resumo.total)} />
            <KpiCard titulo="Entregue antecipado" valor={formatarNumero(resumo.antecipado)} />
          </div>
          <div className="torre-two-grid">
            <StackedDailyChart titulo="Acompanhamento" dados={serie} />
            <StackedDailyChart titulo="Performance de entregas" dados={serie.filter((item) => item.entregues || item.entregueForaPrazo)} />
          </div>
          <div className="torre-three-grid">
            <BarChart titulo="Expira hoje por origem" dados={porOrigemExpiraHoje.map((item) => ({ ...item, valor: item.total }))} />
            <BarChart titulo="Volume por transportadora" dados={volumeTransportadora.map((item) => ({ ...item, valor: item.total }))} />
            <BarChart titulo="Faturamento por dia" dados={faturamentoDia.map((item) => ({ nome: item.label, valor: item.valor }))} formatValor={(v) => formatarMoeda(v)} />
          </div>
        </>
      )}
    </div>
  );
}
