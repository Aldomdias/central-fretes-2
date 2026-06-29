import React, { useEffect, useMemo, useState } from 'react';
import {
  carregarDadosAuditoria,
  calcularMetricasAuditoria,
  agruparPorTransportadora,
  calcularOndeAtacar,
  sugerirNovaMeta,
  avaliarMetaAuditoria,
  exportarAuditoriaExcel,
  exportarCtesDetalhadoExcel,
  carregarMetaAuditoria,
  salvarMetaAuditoria,
  salvarMesCarregadoAuditoria,
  TOGGLE_TABELAS_KEY,
  DIVERGENCIA_THRESHOLD,
} from '../services/auditoriaService';
import {
  carregarResultadosAuditoriaMes,
  carregarResumoAuditoriaMensal,
  processarESalvarAuditoriaMes,
  resimularRegistros,
} from '../services/auditoriaCteProcessamentoService';

const CRITERIOS_FILTRO = [
  { key: 'sem_calculo', label: 'Sem cálculo (nenhum dos dois)' },
  { key: 'div_cobrado', label: 'Calculado, mas com erro (diverge do cobrado)' },
  { key: 'div_verum', label: 'Recálculo diverge da Verum' },
];

function fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtN(v, d = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtP(v, d = 1) {
  return `${Number(v || 0).toFixed(d).replace('.', ',')}%`;
}

const EXCLUIDAS_AUDITORIA_KEY = 'auditoria_cte_transportadoras_excluidas';
const FILTROS_FOCO_KEY = 'auditoria_cte_filtros_foco_v1';

// Carrega os filtros de foco salvos no navegador (volta vazio se não houver).
function carregarFiltrosFocoSalvos() {
  try {
    const salvo = JSON.parse(localStorage.getItem(FILTROS_FOCO_KEY) || '{}');
    const arr = (v) => (Array.isArray(v) ? v : []);
    return {
      transps: arr(salvo.transps),
      tomadores: arr(salvo.tomadores),
      ufs: arr(salvo.ufs),
      cidades: arr(salvo.cidades),
      canais: arr(salvo.canais),
      criterios: arr(salvo.criterios),
    };
  } catch {
    return { transps: [], tomadores: [], ufs: [], cidades: [], canais: [], criterios: [] };
  }
}
const LIMITE_MATCH_VERUM = 1; // diferença (R$) tolerada para considerar recálculo == Verum

// Mesma normalização usada em agruparPorTransportadora, para casar a exclusão.
function nomeTransportadoraAuditoria(r) {
  return String(r?.transportadora || 'Não informado').trim() || 'Não informado';
}

// Texto do tomador do CT-e (cobre os apelidos de coluna da base/resultado salvo).
function nomeTomadorAuditoria(r) {
  const bruto = r?.tomador_servico ?? r?.tomadorServico ?? r?.tomador ?? r?.nome_tomador ?? '';
  return String(bruto || 'Não informado').trim() || 'Não informado';
}

// Normalização para casamento aproximado (sem acento, só A-Z0-9, maiúsculas).
function normTomador(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function semaforo(atual, meta) {
  if (atual >= meta) return { cor: '#16a34a', bg: '#dcfce7', label: '✓ Meta atingida' };
  if (atual >= meta * 0.9) return { cor: '#d97706', bg: '#fef3c7', label: '⚠ Próximo da meta' };
  return { cor: '#dc2626', bg: '#fee2e2', label: '✗ Abaixo da meta' };
}

function metaStatusStyle(status) {
  const map = {
    ok: { bg: '#dcfce7', color: '#166534', border: '#86efac' },
    cobertura: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
    assertividade: { bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
    critico: { bg: '#fee2e2', color: '#991b1b', border: '#fecaca' },
    sem_dados: { bg: '#f8fafc', color: '#475569', border: '#e2e8f0' },
  };
  return map[status] || map.sem_dados;
}

function BadgeSeveridade({ severidade }) {
  const map = {
    critico: { bg: '#fee2e2', color: '#dc2626', label: 'Crítico' },
    alto: { bg: '#fef3c7', color: '#b45309', label: 'Alto' },
    medio: { bg: '#e0f2fe', color: '#0369a1', label: 'Médio' },
    baixo: { bg: '#f0fdf4', color: '#16a34a', label: 'Baixo' },
  };
  const s = map[severidade] || map.baixo;
  return (
    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function ToggleSwitch({ ativo, onChange, label, sublabel }) {
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 10,
        cursor: 'pointer',
        background: ativo ? '#eff6ff' : '#f8fafc',
        border: `2px solid ${ativo ? '#3b82f6' : '#e2e8f0'}`,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        userSelect: 'none',
      }}
      onClick={onChange}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onChange();
      }}
    >
      <div style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: ativo ? '#3b82f6' : '#cbd5e1',
        position: 'relative',
        flexShrink: 0,
        transition: 'background 0.2s',
      }}>
        <div style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          position: 'absolute',
          top: 3,
          left: ativo ? 23 : 3,
          transition: 'left 0.2s',
        }} />
      </div>
      <div>
        <div style={{ fontWeight: 700, color: ativo ? '#1d4ed8' : '#374151', fontSize: 14 }}>{label}</div>
        {sublabel ? <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{sublabel}</div> : null}
      </div>
    </div>
  );
}

// Barra de progresso das operações (carregar/recalcular/resimular/salvar).
// Determinada quando há total conhecido; indeterminada (animada) quando não há.
function BarraProgresso({ progresso }) {
  if (!progresso) return null;

  const etapaLabel = {
    carregando_tabelas: 'Carregando tabelas cadastradas',
    processando_ctes: 'Recalculando CT-es',
    resimulando: 'Resimulando recorte',
    salvando_resultados: 'Salvando resultados',
    carregando_resultado_salvo: 'Carregando resultado salvo',
    concluido: 'Concluído',
  };
  const carregados = Number(progresso.carregados || 0);
  const total = Number(progresso.total || 0);
  const determinada = total > 0;
  const pct = determinada ? Math.min(100, Math.round((carregados / total) * 100)) : 0;
  const etapa = etapaLabel[progresso.etapa]
    || String(progresso.etapa || 'Processando').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1d4ed8' }}>{etapa}…</span>
        <span style={{ fontSize: 12, color: '#475569' }}>
          {determinada
            ? `${carregados.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} · ${pct}%`
            : `${carregados.toLocaleString('pt-BR')} carregados`}
        </span>
      </div>
      <div style={{ position: 'relative', height: 10, borderRadius: 999, background: '#dbeafe', overflow: 'hidden' }}>
        {determinada ? (
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: '#2563eb', transition: 'width 0.3s' }} />
        ) : (
          <div className="auditoria-progress-indeterminate" style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: '35%', borderRadius: 999, background: '#2563eb' }} />
        )}
      </div>
      <style>{`@keyframes auditoriaProgressSlide{0%{left:-35%}100%{left:100%}}.auditoria-progress-indeterminate{animation:auditoriaProgressSlide 1.1s ease-in-out infinite}`}</style>
    </div>
  );
}

function BarraMeta({ atual, meta, cor }) {
  return (
    <div style={{ marginTop: 8, background: '#e2e8f0', borderRadius: 4, height: 8, position: 'relative' }}>
      <div style={{ position: 'absolute', top: -4, left: `${Math.min(meta, 100)}%`, width: 2, height: 16, background: '#64748b', borderRadius: 1 }} />
      <div style={{ width: `${Math.min(atual, 100)}%`, background: cor, borderRadius: 4, height: 8, transition: 'width 0.5s' }} />
    </div>
  );
}

// Lista de seleção múltipla com busca. Usada nos filtros de foco para marcar
// várias transportadoras / cidades de origem ao mesmo tempo.
function MultiCheckList({ titulo, opcoes, selecionados, onToggle, onLimpar, busca, onBusca, placeholder, maxAltura = 170 }) {
  const selSet = new Set(selecionados);
  const buscaNorm = (busca || '').trim().toLowerCase();
  const filtradas = buscaNorm
    ? opcoes.filter((o) => o.label.toLowerCase().includes(buscaNorm))
    : opcoes;

  return (
    <div style={{ flex: '1 1 240px', minWidth: 220 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>
          {titulo}{selecionados.length ? ` (${selecionados.length})` : ''}
        </span>
        {selecionados.length ? (
          <button type="button" onClick={onLimpar} style={{ border: 'none', background: 'none', color: '#2563eb', fontSize: 11, cursor: 'pointer', padding: 0 }}>
            limpar
          </button>
        ) : null}
      </div>
      {onBusca ? (
        <input
          type="text"
          placeholder={placeholder}
          value={busca}
          onChange={(e) => onBusca(e.target.value)}
          style={{ width: '100%', padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 6, fontSize: 12 }}
        />
      ) : null}
      <div style={{ maxHeight: maxAltura, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, padding: 6, background: '#fff' }}>
        {filtradas.slice(0, 300).map((o) => {
          const marcada = selSet.has(o.value);
          return (
            <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', cursor: 'pointer', borderRadius: 4, background: marcada ? '#eff6ff' : 'transparent' }}>
              <input type="checkbox" checked={marcada} onChange={() => onToggle(o.value)} />
              <span style={{ fontSize: 12, fontWeight: marcada ? 700 : 500, color: marcada ? '#1d4ed8' : '#334155' }}>{o.label}</span>
              {o.sub ? <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>{o.sub}</span> : null}
            </label>
          );
        })}
        {!filtradas.length ? <div style={{ fontSize: 12, color: '#94a3b8', padding: 4 }}>Nada encontrado.</div> : null}
        {filtradas.length > 300 ? <div style={{ fontSize: 11, color: '#94a3b8', padding: 4 }}>Mostrando 300 de {filtradas.length}. Refine a busca.</div> : null}
      </div>
    </div>
  );
}

function DiagnosticoFontes({ diagnostico = [] }) {
  if (!diagnostico.length) return null;

  return (
    <section className="sim-card">
      <h2>Diagnóstico da consulta</h2>
      <p style={{ color: '#64748b', marginTop: -4 }}>
        A tela tenta primeiro a base do módulo CT-e e, se não encontrar dados, usa fallback por competência e bases legadas/enxutas.
      </p>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Fonte</th>
              <th>Filtro</th>
              <th>Total</th>
              <th>Calculados</th>
              <th>Sem cálculo</th>
              <th>Erro</th>
            </tr>
          </thead>
          <tbody>
            {diagnostico.map((item, index) => (
              <tr key={`${item.fonte}-${item.filtro}-${index}`}>
                <td>
                  <strong>{item.label || item.tabela}</strong>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.tabela}</div>
                </td>
                <td>{item.filtro}</td>
                <td>{fmtN(item.total)}</td>
                <td>{fmtN(item.calculados)}</td>
                <td style={{ color: item.semCalculo > 0 ? '#dc2626' : '#94a3b8', fontWeight: item.semCalculo > 0 ? 700 : 400 }}>
                  {fmtN(item.semCalculo)}
                </td>
                <td style={{ color: item.erro ? '#dc2626' : '#94a3b8' }}>{item.erro || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResumoMensalAuditoria({ resumoMensal = [] }) {
  if (!resumoMensal.length) return null;

  return (
    <section className="sim-card">
      <h2>Resumo mensal salvo</h2>
      <p style={{ color: '#64748b', marginTop: -4 }}>
        Comparativo mês a mês carregado da tabela <code>auditoria_cte_resumo_mensal</code>.
      </p>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Competência</th>
              <th>Total CTes</th>
              <th>Calculados</th>
              <th>Sem cálculo</th>
              <th>Assertivos</th>
              <th>Divergentes</th>
              <th>% Cálculo</th>
              <th>% Assertividade</th>
              <th>Valor CT-e</th>
              <th>Valor calculado</th>
              <th>Divergência</th>
            </tr>
          </thead>
          <tbody>
            {resumoMensal.map((item) => (
              <tr key={item.competencia}>
                <td><strong>{item.competencia}</strong></td>
                <td>{fmtN(item.total_ctes)}</td>
                <td>{fmtN(item.calculados)}</td>
                <td>{fmtN(item.sem_calculo)}</td>
                <td>{fmtN(item.assertivos)}</td>
                <td>{fmtN(item.divergentes)}</td>
                <td>{fmtP(item.taxa_calculo)}</td>
                <td>{fmtP(item.taxa_assertividade)}</td>
                <td>{fmt(item.valor_total_cte)}</td>
                <td>{fmt(item.valor_total_calculado)}</td>
                <td>{fmt(item.valor_total_divergencia)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function AuditoriaCtePage() {
  const [competencia, setCompetencia] = useState('');
  // Período de teste opcional: limita a carga do "Carregar resultado salvo" a
  // alguns dias, para iterar rápido sem puxar o mês inteiro.
  const [dataInicioTeste, setDataInicioTeste] = useState('');
  const [dataFimTeste, setDataFimTeste] = useState('');
  const [registros, setRegistros] = useState([]);
  const [fonteAuditoria, setFonteAuditoria] = useState(null);
  const [diagnostico, setDiagnostico] = useState([]);
  const [avisos, setAvisos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [progressoProcessamento, setProgressoProcessamento] = useState(null);
  const [resumoMensal, setResumoMensal] = useState([]);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');

  const [usarTabelas, setUsarTabelas] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(TOGGLE_TABELAS_KEY) || 'false');
    } catch {
      return false;
    }
  });

  const [meta, setMeta] = useState(carregarMetaAuditoria);
  const [editandoMeta, setEditandoMeta] = useState(false);
  const [metaTemp, setMetaTemp] = useState(meta);

  // Transportadoras fora da análise (ex.: lotação que só calcula após vínculo
  // na Auditoria Lotação). A escolha fica salva e as métricas as ignoram.
  const [excluidas, setExcluidas] = useState(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(EXCLUIDAS_AUDITORIA_KEY) || '[]');
      return Array.isArray(salvo) ? salvo : [];
    } catch {
      return [];
    }
  });
  const [filtroBuscaExcluir, setFiltroBuscaExcluir] = useState('');

  // Seções secundárias recolhidas por padrão para despoluir a tela.
  const [mostrarAvancado, setMostrarAvancado] = useState(false);

  // Filtro pré-carga de canal: aplicado na query para trazer só os CTes do canal selecionado.
  const [canaisPreCarga, setCanaisPreCarga] = useState([]);

  // Filtros de foco: para identificar onde agir (ajuste de tabela) e, depois,
  // recalcular só o subconjunto. Combina transportadora + origem + critério de erro.
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const filtrosSalvos = useMemo(carregarFiltrosFocoSalvos, []);
  const [filtroTransps, setFiltroTransps] = useState(filtrosSalvos.transps);
  const [filtroTomadores, setFiltroTomadores] = useState(filtrosSalvos.tomadores);
  const [filtroUfs, setFiltroUfs] = useState(filtrosSalvos.ufs);
  const [filtroCidades, setFiltroCidades] = useState(filtrosSalvos.cidades);
  const [filtroCanais, setFiltroCanais] = useState(filtrosSalvos.canais);
  const [filtroCriterios, setFiltroCriterios] = useState(filtrosSalvos.criterios); // vazio = todos
  const [buscaTranspFiltro, setBuscaTranspFiltro] = useState('');
  const [buscaTomadorFiltro, setBuscaTomadorFiltro] = useState('');
  const [buscaCidadeFiltro, setBuscaCidadeFiltro] = useState('');

  // Preview de resimulação (apenas em memória — não grava no banco).
  const [resimulando, setResimulando] = useState(false);
  const [resimuladoInfo, setResimuladoInfo] = useState('');

  // Detalhe por CT-e: índice da linha expandida (detalhe do cálculo).
  const [cteExpandido, setCteExpandido] = useState(null);

  // Persiste os filtros de foco no navegador a cada mudança (igual às exclusões).
  useEffect(() => {
    try {
      localStorage.setItem(FILTROS_FOCO_KEY, JSON.stringify({
        transps: filtroTransps,
        tomadores: filtroTomadores,
        ufs: filtroUfs,
        cidades: filtroCidades,
        canais: filtroCanais,
        criterios: filtroCriterios,
      }));
    } catch { /* ignora falha de storage */ }
  }, [filtroTransps, filtroTomadores, filtroUfs, filtroCidades, filtroCanais, filtroCriterios]);

  function toggleEmLista(setter) {
    return (valor) => setter((atuais) => (
      atuais.includes(valor) ? atuais.filter((v) => v !== valor) : [...atuais, valor]
    ));
  }

  function limparFiltrosFoco() {
    setFiltroTransps([]);
    setFiltroTomadores([]);
    setFiltroUfs([]);
    setFiltroCidades([]);
    setFiltroCanais([]);
    setFiltroCriterios([]);
  }

  const filtrosAtivos = Boolean(
    filtroTransps.length || filtroTomadores.length || filtroUfs.length
    || filtroCidades.length || filtroCanais.length || filtroCriterios.length,
  );

  // Pode carregar/recalcular com competência OU período (datas) preenchido.
  const podeCarregar = Boolean(competencia || dataInicioTeste || dataFimTeste);
  const temPeriodoTeste = Boolean(dataInicioTeste || dataFimTeste);

  const excluidasSet = useMemo(() => new Set(excluidas), [excluidas]);

  function toggleExcluida(nome) {
    setExcluidas((atuais) => {
      const proximas = atuais.includes(nome)
        ? atuais.filter((n) => n !== nome)
        : [...atuais, nome];
      try {
        localStorage.setItem(EXCLUIDAS_AUDITORIA_KEY, JSON.stringify(proximas));
      } catch { /* ignora falha de storage */ }
      return proximas;
    });
  }

  function limparExcluidas() {
    setExcluidas([]);
    try {
      localStorage.setItem(EXCLUIDAS_AUDITORIA_KEY, '[]');
    } catch { /* ignora */ }
  }

  // Conjunto efetivamente analisado: tudo, menos as transportadoras excluídas.
  const registrosAnalise = useMemo(
    () => (excluidasSet.size ? registros.filter((r) => !excluidasSet.has(nomeTransportadoraAuditoria(r))) : registros),
    [registros, excluidasSet],
  );

  // Agrupamento completo (base inteira) para a lista de seleção do filtro.
  const porTransportadoraCompleto = useMemo(() => agruparPorTransportadora(registros), [registros]);
  const transportadorasExcluidas = useMemo(
    () => porTransportadoraCompleto.filter((it) => excluidasSet.has(it.transportadora)),
    [porTransportadoraCompleto, excluidasSet],
  );
  const ctesExcluidos = useMemo(
    () => transportadorasExcluidas.reduce((acc, it) => acc + it.total, 0),
    [transportadorasExcluidas],
  );

  // UFs de origem disponíveis para o filtro de foco.
  const ufsDisponiveis = useMemo(() => {
    const set = new Set();
    for (const r of registrosAnalise) {
      const uf = String(r.uf_origem || r.ufOrigem || '').trim().toUpperCase();
      if (uf) set.add(uf);
    }
    return Array.from(set).sort();
  }, [registrosAnalise]);

  // Cidades de origem disponíveis (com contagem) para o filtro de foco.
  const cidadesDisponiveis = useMemo(() => {
    const mapa = new Map();
    for (const r of registrosAnalise) {
      const cidade = String(r.cidade_origem || r.origem || '').trim().toUpperCase();
      if (cidade) mapa.set(cidade, (mapa.get(cidade) || 0) + 1);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, qtd]) => ({ value, label: value, sub: `${fmtN(qtd)}` }));
  }, [registrosAnalise]);

  // Canais disponíveis (com contagem) para o filtro de foco.
  const canaisDisponiveis = useMemo(() => {
    const mapa = new Map();
    for (const r of registrosAnalise) {
      const canal = String(r.canal || r.canal_original || '').trim().toUpperCase() || 'NÃO INFORMADO';
      mapa.set(canal, (mapa.get(canal) || 0) + 1);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, qtd]) => ({ value, label: value, sub: `${fmtN(qtd)}` }));
  }, [registrosAnalise]);

  // Tomadores disponíveis (com contagem) para o filtro de foco.
  const tomadoresDisponiveis = useMemo(() => {
    const mapa = new Map();
    for (const r of registrosAnalise) {
      const nome = nomeTomadorAuditoria(r);
      mapa.set(nome, (mapa.get(nome) || 0) + 1);
    }
    return Array.from(mapa.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, qtd]) => ({ value, label: value, sub: `${fmtN(qtd)}` }));
  }, [registrosAnalise]);

  // Atalhos de tomadores frequentes (casamento por "contém", aproximado).
  const TOMADORES_ATALHO = ['CPX', 'ITR', 'GP PNEUS', 'SPEEDMAX', 'PNEUSTORE'];

  // Transportadoras disponíveis (com contagem) para o filtro de foco.
  const transportadorasOpcoes = useMemo(
    () => porTransportadoraCompleto
      .filter((it) => !excluidasSet.has(it.transportadora))
      .map((it) => ({ value: it.transportadora, label: it.transportadora, sub: `${fmtN(it.total)}` })),
    [porTransportadoraCompleto, excluidasSet],
  );

  // Aplica os filtros de foco (transportadoras + UFs + cidades + critérios de erro),
  // todos multi-seleção. Dentro de cada dimensão é OR; entre dimensões é AND.
  const registrosFiltro = useMemo(() => {
    if (!filtrosAtivos) return registrosAnalise;
    const TOL = DIVERGENCIA_THRESHOLD;
    const transpSet = new Set(filtroTransps);
    const ufSet = new Set(filtroUfs);
    const cidSet = new Set(filtroCidades);
    const canalSet = new Set(filtroCanais);
    const critSet = new Set(filtroCriterios);
    // Tomadores selecionados em forma normalizada para casar por "contém".
    const tomadoresNorm = filtroTomadores.map(normTomador).filter(Boolean);
    return registrosAnalise.filter((r) => {
      if (transpSet.size && !transpSet.has(nomeTransportadoraAuditoria(r))) return false;
      if (tomadoresNorm.length) {
        const tomadorReg = normTomador(nomeTomadorAuditoria(r));
        const casa = tomadoresNorm.some((sel) => tomadorReg.includes(sel) || sel.includes(tomadorReg));
        if (!casa) return false;
      }
      if (ufSet.size && !ufSet.has(String(r.uf_origem || r.ufOrigem || '').trim().toUpperCase())) return false;
      if (cidSet.size && !cidSet.has(String(r.cidade_origem || r.origem || '').trim().toUpperCase())) return false;
      if (canalSet.size) {
        const canal = String(r.canal || r.canal_original || '').trim().toUpperCase() || 'NÃO INFORMADO';
        if (!canalSet.has(canal)) return false;
      }
      if (critSet.size) {
        const vc = Number(r.valor_cte || 0);
        const rec = Number(r.valor_calculado || 0);
        const ver = Number(r.valor_calculado_verum || 0);
        const semCalc = rec <= 0 && ver <= 0;
        const divCobrado = rec > 0 && Math.abs(vc - rec) > TOL;
        const divVerum = rec > 0 && ver > 0 && Math.abs(rec - ver) > TOL;
        const passa = (critSet.has('sem_calculo') && semCalc)
          || (critSet.has('div_cobrado') && divCobrado)
          || (critSet.has('div_verum') && divVerum);
        if (!passa) return false;
      }
      return true;
    });
  }, [registrosAnalise, filtrosAtivos, filtroTransps, filtroTomadores, filtroUfs, filtroCidades, filtroCanais, filtroCriterios]);

  // Assertividade de um conjunto: % de CT-es (com algum cálculo) em que o
  // recálculo OU a Verum batem o valor cobrado. Mesmo critério da meta.
  function assertividadeDe(lista = []) {
    const TOL = DIVERGENCIA_THRESHOLD;
    let base = 0;
    let ok = 0;
    for (const r of lista) {
      const vc = Number(r.valor_cte || 0);
      const rec = Number(r.valor_calculado || 0);
      const ver = Number(r.valor_calculado_verum || 0);
      if (rec <= 0 && ver <= 0) continue;
      base += 1;
      if ((rec > 0 && Math.abs(vc - rec) <= TOL) || (ver > 0 && Math.abs(vc - ver) <= TOL)) ok += 1;
    }
    return { base, ok, taxa: base > 0 ? (ok / base) * 100 : 0 };
  }

  // Resimula apenas o recorte filtrado (preview em memória, sem gravar). Atualiza
  // os mesmos registros dentro da base carregada para as métricas refletirem.
  async function resimularFiltrados() {
    const alvo = registrosFiltro;
    if (!alvo.length) {
      setErro('Nenhum CT-e no foco atual para resimular. Ajuste os filtros.');
      return;
    }

    setResimulando(true);
    setErro('');
    setResimuladoInfo('');
    setProgressoProcessamento(null);

    const antes = assertividadeDe(alvo);

    try {
      const novos = await resimularRegistros({ registros: alvo, onProgress: setProgressoProcessamento });
      const mapa = new Map();
      alvo.forEach((orig, i) => mapa.set(orig, novos[i]));
      setRegistros((prev) => prev.map((r) => mapa.get(r) || r));

      const depois = assertividadeDe(novos);
      const ganho = depois.taxa - antes.taxa;
      const resolvidos = depois.ok - antes.ok;
      const seta = ganho > 0.05 ? '▲' : ganho < -0.05 ? '▼' : '→';
      setResimuladoInfo(
        `${fmtN(novos.length)} CT-e(s) resimulados (preview, não gravado). `
        + `Assertividade do recorte: ${fmtP(antes.taxa)} ${seta} ${fmtP(depois.taxa)} `
        + `(${resolvidos >= 0 ? '+' : ''}${fmtN(resolvidos)} corrigidos). `
        + 'Ajuste as tabelas e resimule de novo — os que passarem saem do foco. '
        + 'Para persistir, use “Recalcular com a ferramenta” ou “Salvar mês carregado”.',
      );
    } catch (e) {
      setErro(e.message || 'Erro ao resimular o recorte filtrado.');
    } finally {
      setResimulando(false);
      setProgressoProcessamento(null);
    }
  }

  // AMD (nosso motor) é sempre a base das métricas; a Verum fica como referência.
  const registrosBase = registrosFiltro;

  // Comparação Recálculo x Verum (sempre sobre o conjunto analisado), para validar
  // se o recálculo está batendo com a Verum.
  const comparacaoVerum = useMemo(() => {
    let ambos = 0;
    let batem = 0;
    let divergem = 0;
    let somaDifAbs = 0;
    for (const r of registrosFiltro) {
      const rec = Number(r.valor_calculado || 0);
      const ver = Number(r.valor_calculado_verum || 0);
      if (rec > 0 && ver > 0) {
        ambos += 1;
        const dif = Math.abs(rec - ver);
        somaDifAbs += dif;
        if (dif <= LIMITE_MATCH_VERUM) batem += 1;
        else divergem += 1;
      }
    }
    return {
      ambos,
      batem,
      divergem,
      taxaMatch: ambos > 0 ? (batem / ambos) * 100 : 0,
      difMedia: ambos > 0 ? somaDifAbs / ambos : 0,
    };
  }, [registrosFiltro]);

  // Assertividade do sistema: para cada CT-e, vê se a Verum e/ou o Recálculo
  // batem com o valor cobrado (realizado). Conta como assertivo se QUALQUER um
  // dos dois bate — é o critério para a meta e para decidir a substituição.
  const assertividadeSistema = useMemo(() => {
    const TOL = DIVERGENCIA_THRESHOLD;
    let comAlgumCalculo = 0;
    let comRecalculo = 0;
    let comVerum = 0;
    let recBate = 0;
    let verBate = 0;
    let combinado = 0;
    let soRecalculo = 0;
    let soVerum = 0;
    let ambosBatem = 0;
    let nenhumBate = 0;
    for (const r of registrosFiltro) {
      const vc = Number(r.valor_cte || 0);
      const rec = Number(r.valor_calculado || 0);
      const ver = Number(r.valor_calculado_verum || 0);
      const okRec = rec > 0 && Math.abs(vc - rec) <= TOL;
      const okVer = ver > 0 && Math.abs(vc - ver) <= TOL;
      if (rec > 0) comRecalculo += 1;
      if (ver > 0) comVerum += 1;
      if (rec > 0 || ver > 0) comAlgumCalculo += 1;
      if (okRec) recBate += 1;
      if (okVer) verBate += 1;
      if (okRec || okVer) combinado += 1;
      if (okRec && !okVer) soRecalculo += 1;
      if (okVer && !okRec) soVerum += 1;
      if (okRec && okVer) ambosBatem += 1;
      if (!okRec && !okVer && (rec > 0 || ver > 0)) nenhumBate += 1;
    }
    return {
      comAlgumCalculo,
      comRecalculo,
      comVerum,
      taxaCombinada: comAlgumCalculo > 0 ? (combinado / comAlgumCalculo) * 100 : 0,
      taxaRecalculo: comRecalculo > 0 ? (recBate / comRecalculo) * 100 : 0,
      taxaVerum: comVerum > 0 ? (verBate / comVerum) * 100 : 0,
      combinado,
      soRecalculo,
      soVerum,
      ambosBatem,
      nenhumBate,
    };
  }, [registrosFiltro]);

  // Diagnóstico do recálculo: onde o motor está parando (transportadora → origem →
  // rota → faixa). Usa o status_calculo/motivo já gravado em cada registro.
  const diagnosticoRecalculo = useMemo(() => {
    const STATUS_LABEL = {
      CALCULADO: 'Calculado',
      SEM_TABELA: 'Transportadora não encontrada no cadastro',
      SEM_ORIGEM: 'Origem/canal não encontrados',
      SEM_ROTA: 'Rota de destino não encontrada',
      SEM_FAIXA: 'Faixa/cotação não encontrada',
      ERRO_CALCULO: 'Erro no cálculo',
      SEM_STATUS: 'Sem status (carregado sem recálculo)',
    };
    const mapa = new Map();
    for (const r of registrosFiltro) {
      const st = r.status_calculo || (Number(r.valor_calculado || 0) > 0 ? 'CALCULADO' : 'SEM_STATUS');
      const atual = mapa.get(st) || { status: st, label: STATUS_LABEL[st] || st, total: 0, motivo: '', transportadoras: new Map() };
      atual.total += 1;
      if (!atual.motivo && r.motivo_sem_calculo) atual.motivo = r.motivo_sem_calculo;
      const t = nomeTransportadoraAuditoria(r);
      atual.transportadoras.set(t, (atual.transportadoras.get(t) || 0) + 1);
      mapa.set(st, atual);
    }
    const linhas = Array.from(mapa.values())
      .map((l) => ({
        ...l,
        topTransp: Array.from(l.transportadoras.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3),
      }))
      .sort((a, b) => b.total - a.total);
    return linhas;
  }, [registrosFiltro]);

  const metricas = useMemo(() => calcularMetricasAuditoria(registrosBase), [registrosBase]);
  const porTransportadora = useMemo(() => agruparPorTransportadora(registrosBase), [registrosBase]);
  const ondeAtacar = useMemo(() => calcularOndeAtacar(porTransportadora, meta), [porTransportadora, meta]);
  const sugestaoMeta = useMemo(() => sugerirNovaMeta(metricas), [metricas]);
  const avaliacaoMeta = useMemo(() => avaliarMetaAuditoria(metricas, meta), [metricas, meta]);

  const semaforoCalculo = semaforo(metricas.taxaCalculo, meta.taxaCalculoMeta);
  const semaforoAssert = semaforo(metricas.taxaAssertividade, meta.taxaAssertividadeMeta);
  const estiloAvaliacaoMeta = metaStatusStyle(avaliacaoMeta.status);
  const temDados = registros.length > 0;

  async function carregar() {
    if (!podeCarregar) {
      setErro('Informe a competência (mês) ou um período (datas) antes de carregar.');
      return;
    }

    setCarregando(true);
    setErro('');
    setSucesso('');
    setAvisos([]);
    setDiagnostico([]);
    setFonteAuditoria(null);
    setProgressoProcessamento(null);

    try {
      const resposta = await carregarDadosAuditoria({
        competencia,
        dataInicio: dataInicioTeste || undefined,
        dataFim: dataFimTeste || undefined,
        canais: canaisPreCarga.length ? canaisPreCarga : undefined,
        onProgress: setProgressoProcessamento,
      });
      const dados = resposta?.registros || [];
      setRegistros(dados);
      setFonteAuditoria(resposta?.fonte || null);
      setDiagnostico(resposta?.diagnostico || []);
      setAvisos(resposta?.avisos || []);

      if (!dados.length) {
        setSucesso('Nenhum CTe encontrado para este recorte nas bases verificadas.');
      } else {
        const fonte = resposta?.fonte?.label || resposta?.fonte?.tabela || 'Supabase';
        setSucesso(`${dados.length.toLocaleString('pt-BR')} CTe(s) carregados da fonte ${fonte}.`);
      }
    } catch (e) {
      setRegistros([]);
      setErro(e.message || 'Erro ao carregar dados do Supabase.');
    } finally {
      setCarregando(false);
      setProgressoProcessamento(null);
    }
  }

  async function carregarResultadoSalvo() {
    if (!podeCarregar) {
      setErro('Informe a competência ou um período antes de carregar o resultado salvo.');
      return;
    }

    setCarregando(true);
    setErro('');
    setSucesso('');
    setAvisos([]);
    setDiagnostico([]);
    setFonteAuditoria(null);
    setProgressoProcessamento(null);

    try {
      const dados = await carregarResultadosAuditoriaMes({
        competencia,
        dataInicio: dataInicioTeste || undefined,
        dataFim: dataFimTeste || undefined,
        canais: canaisPreCarga.length ? canaisPreCarga : undefined,
        onProgress: setProgressoProcessamento,
      });

      setRegistros(dados || []);
      setFonteAuditoria({
        id: 'auditoria_cte_resultados',
        tabela: 'auditoria_cte_resultados',
        label: 'Auditoria salva / auditoria_cte_resultados',
      });

      const recorteTeste = dataInicioTeste || dataFimTeste
        ? ` (período de teste ${dataInicioTeste || '...'} a ${dataFimTeste || '...'})`
        : '';
      if (!dados.length) {
        setSucesso(`Nenhum resultado salvo para esta competência${recorteTeste}. Use Salvar mês carregado.`);
      } else {
        setSucesso(`${dados.length.toLocaleString('pt-BR')} resultado(s) salvo(s) carregado(s)${recorteTeste}.`);
      }
    } catch (error) {
      setRegistros([]);
      setErro(error.message || 'Erro ao carregar resultado salvo.');
    } finally {
      setCarregando(false);
      setProgressoProcessamento(null);
    }
  }

  async function salvarMesCarregado() {
    if (!competencia) {
      setErro('Informe a competência antes de salvar o mês.');
      return;
    }

    const confirmar = window.confirm(
      `Salvar a auditoria de ${competencia}? O resultado salvo e o resumo mensal desse mês serão substituídos.`
    );

    if (!confirmar) return;

    setProcessando(true);
    setErro('');
    setSucesso('');
    setAvisos([]);
    setProgressoProcessamento(null);

    try {
      const resposta = await salvarMesCarregadoAuditoria({
        competencia,
        onProgress: setProgressoProcessamento,
      });

      const dados = resposta?.registros || [];
      setRegistros(dados);
      setFonteAuditoria(resposta?.fonte || {
        id: 'auditoria_cte_resultados',
        tabela: 'auditoria_cte_resultados',
        label: 'Auditoria salva / auditoria_cte_resultados',
      });

      const resumo = await carregarResumoAuditoriaMensal();
      setResumoMensal(resumo || []);

      setSucesso(`${dados.length.toLocaleString('pt-BR')} CT-e(s) salvos na auditoria e resumo mensal atualizado para ${competencia}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao salvar mês carregado.');
    } finally {
      setProcessando(false);
      setProgressoProcessamento(null);
    }
  }

  async function recalcularComFerramenta() {
    if (!podeCarregar) {
      setErro('Informe a competência ou um período antes de recalcular.');
      return;
    }

    const alvo = temPeriodoTeste
      ? `o período ${dataInicioTeste || '...'} a ${dataFimTeste || '...'}`
      : competencia;
    const confirmar = window.confirm(
      temPeriodoTeste
        ? `Recalcular ${alvo} com as tabelas cadastradas? Como é um período, o resultado fica só na tela (preview, NÃO grava) para não apagar o mês salvo.`
        : `Recalcular ${alvo} com as tabelas cadastradas? O recálculo será gravado em auditoria_cte_resultados (o cálculo da Verum é preservado). O resultado salvo desse mês será substituído.`
    );

    if (!confirmar) return;

    setProcessando(true);
    setErro('');
    setSucesso('');
    setAvisos([]);
    setProgressoProcessamento(null);

    try {
      const resposta = await processarESalvarAuditoriaMes({
        competencia,
        dataInicio: dataInicioTeste || undefined,
        dataFim: dataFimTeste || undefined,
        canais: canaisPreCarga.length ? canaisPreCarga : undefined,
        onProgress: setProgressoProcessamento,
      });

      const dados = resposta?.registros || [];
      setRegistros(dados);
      setFonteAuditoria(resposta?.fonte || {
        id: 'auditoria_cte_resultados',
        tabela: 'auditoria_cte_resultados',
        label: 'Auditoria recalculada / auditoria_cte_resultados',
      });

      if (resposta?.gravado) {
        const resumo = await carregarResumoAuditoriaMensal();
        setResumoMensal(resumo || []);
        setSucesso(`${dados.length.toLocaleString('pt-BR')} CT-e(s) recalculados e gravados para ${competencia}. Verum preservada para comparação.`);
      } else {
        setSucesso(`${dados.length.toLocaleString('pt-BR')} CT-e(s) recalculados em ${alvo} (preview, não gravado). Verum preservada para comparação.`);
      }
    } catch (error) {
      setErro(error.message || 'Erro ao recalcular com a ferramenta.');
    } finally {
      setProcessando(false);
      setProgressoProcessamento(null);
    }
  }

  async function carregarResumoMensal() {
    setCarregando(true);
    setErro('');
    setSucesso('');

    try {
      const resumo = await carregarResumoAuditoriaMensal();
      setResumoMensal(resumo || []);
      setSucesso(`${(resumo || []).length.toLocaleString('pt-BR')} mês(es) encontrados no resumo mensal.`);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar resumo mensal.');
    } finally {
      setCarregando(false);
    }
  }

  function limpar() {
    setCompetencia('');
    setDataInicioTeste('');
    setDataFimTeste('');
    setRegistros([]);
    setFonteAuditoria(null);
    setDiagnostico([]);
    setAvisos([]);
    setResumoMensal([]);
    setProgressoProcessamento(null);
    setResimuladoInfo('');
    setErro('');
    setSucesso('');
  }

  function toggleUsarTabelas() {
    const novo = !usarTabelas;
    setUsarTabelas(novo);
    localStorage.setItem(TOGGLE_TABELAS_KEY, JSON.stringify(novo));
  }

  function salvarMeta() {
    salvarMetaAuditoria(metaTemp);
    setMeta(metaTemp);
    setEditandoMeta(false);
  }

  function usarSugestaoMeta() {
    setMetaTemp({ ...sugestaoMeta });
  }

  function exportarExcel() {
    exportarAuditoriaExcel(porTransportadora, metricas, competencia, diagnostico);
  }

  function exportarCtesDetalhe() {
    exportarCtesDetalhadoExcel(registrosFiltro, competencia);
  }

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Auditoria</div>
        <h1>Auditoria de CTes</h1>
        <p>
          Cobertura de cálculo, assertividade e priorização de divergências. Fonte principal: <code>realizado_local_ctes</code>.
          O botão <strong>Salvar mês carregado</strong> grava o resultado em <code>auditoria_cte_resultados</code> e o resumo em <code>auditoria_cte_resumo_mensal</code>.
        </p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {sucesso ? <div className="sim-alert success">{sucesso}</div> : null}
      {avisos.length > 0 ? (
        <div className="sim-alert info">
          <strong>Avisos da consulta:</strong> {avisos.join(' | ')}
        </div>
      ) : null}

      <section className="sim-card">
        <div className="sim-alert info" style={{ marginBottom: 14 }}>
          <strong>Fluxo recomendado.</strong> Carregue os CT-es do mês para conferir. Depois clique em <strong>Salvar mês carregado</strong>. Nos próximos acessos, use <strong>Carregar resultado salvo</strong> ou <strong>Carregar resumo mensal</strong>.
        </div>

        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
          <label>
            Competência (mês) <span style={{ color: '#94a3b8', fontWeight: 400 }}>— ou use o período →</span>
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
            />
          </label>
          <label>
            Período — início (opcional)
            <input
              type="date"
              value={dataInicioTeste}
              onChange={(e) => setDataInicioTeste(e.target.value)}
              title="Carrega a partir desta data de emissão (dispensa a competência)"
            />
          </label>
          <label>
            Período — fim (opcional)
            <input
              type="date"
              value={dataFimTeste}
              onChange={(e) => setDataFimTeste(e.target.value)}
              title="Carrega até esta data de emissão (dispensa a competência)"
            />
          </label>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 12, color: '#475569', fontWeight: 600, marginBottom: 6 }}>
              Canal (pré-filtro — vazio = todos)
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {['B2C', 'ATACADO', 'INTERCOMPANY', 'REVERSA', 'A DEFINIR'].map((c) => {
                const marcado = canaisPreCarga.includes(c);
                return (
                  <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: marcado ? 700 : 500, color: marcado ? '#1d4ed8' : '#334155', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, background: marcado ? '#eff6ff' : '#f1f5f9', border: `1px solid ${marcado ? '#93c5fd' : '#e2e8f0'}` }}>
                    <input type="checkbox" checked={marcado} onChange={() => setCanaisPreCarga((prev) => marcado ? prev.filter((v) => v !== c) : [...prev, c])} style={{ margin: 0 }} />
                    {c}
                  </label>
                );
              })}
              {canaisPreCarga.length > 0 && (
                <button type="button" className="sim-tab" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setCanaisPreCarga([])}>Limpar canal</button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="primary" type="button" onClick={carregar} disabled={carregando || processando || !podeCarregar}>
              {carregando ? 'Carregando...' : 'Carregar CT-es do mês'}
            </button>
            <button className="primary" type="button" onClick={salvarMesCarregado} disabled={carregando || processando || !competencia}>
              {processando ? 'Salvando...' : 'Salvar mês carregado'}
            </button>
            <button className="primary" type="button" onClick={recalcularComFerramenta} disabled={carregando || processando || !podeCarregar} title="Recalcula cada CT-e com as tabelas de frete cadastradas e preserva a Verum para comparação">
              {processando ? 'Processando...' : 'Recalcular com a ferramenta'}
            </button>
            <button className="sim-tab" type="button" onClick={carregarResultadoSalvo} disabled={carregando || processando || !podeCarregar}>
              Carregar resultado salvo
            </button>
            <button className="sim-tab" type="button" onClick={carregarResumoMensal} disabled={carregando || processando}>
              Carregar resumo mensal
            </button>
            <button className="sim-tab" type="button" onClick={() => setMostrarFiltros((v) => !v)} style={filtrosAtivos ? { borderColor: '#2563eb', color: '#2563eb', fontWeight: 700 } : undefined}>
              Filtros{filtrosAtivos ? ' (ativos)' : ''}
            </button>
            <button className="sim-tab" type="button" onClick={limpar} disabled={carregando || processando}>
              Limpar
            </button>
          </div>
        </div>

        {mostrarFiltros ? (
          <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>
                Filtro de foco — marque várias e resimule só o recorte
              </div>
              {filtrosAtivos ? (
                <button className="sim-tab" type="button" onClick={limparFiltrosFoco}>Limpar todos os filtros</button>
              ) : null}
            </div>

            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <MultiCheckList
                titulo="Transportadora"
                opcoes={transportadorasOpcoes}
                selecionados={filtroTransps}
                onToggle={toggleEmLista(setFiltroTransps)}
                onLimpar={() => setFiltroTransps([])}
                busca={buscaTranspFiltro}
                onBusca={setBuscaTranspFiltro}
                placeholder="Buscar transportadora..."
              />
              <div style={{ flex: '1 1 240px', minWidth: 220 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                  {TOMADORES_ATALHO.map((t) => {
                    const marcado = filtroTomadores.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleEmLista(setFiltroTomadores)(t)}
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 9px',
                          borderRadius: 999,
                          cursor: 'pointer',
                          background: marcado ? '#eff6ff' : '#f1f5f9',
                          border: `1px solid ${marcado ? '#93c5fd' : '#e2e8f0'}`,
                          color: marcado ? '#1d4ed8' : '#475569',
                        }}
                      >
                        {marcado ? '✓ ' : ''}{t}
                      </button>
                    );
                  })}
                </div>
                <MultiCheckList
                  titulo="Tomador (contém)"
                  opcoes={tomadoresDisponiveis}
                  selecionados={filtroTomadores}
                  onToggle={toggleEmLista(setFiltroTomadores)}
                  onLimpar={() => setFiltroTomadores([])}
                  busca={buscaTomadorFiltro}
                  onBusca={setBuscaTomadorFiltro}
                  placeholder="Buscar tomador..."
                />
              </div>
              <MultiCheckList
                titulo="Cidade origem"
                opcoes={cidadesDisponiveis}
                selecionados={filtroCidades}
                onToggle={toggleEmLista(setFiltroCidades)}
                onLimpar={() => setFiltroCidades([])}
                busca={buscaCidadeFiltro}
                onBusca={setBuscaCidadeFiltro}
                placeholder="Buscar cidade..."
              />
              <MultiCheckList
                titulo="UF origem (região)"
                opcoes={ufsDisponiveis.map((uf) => ({ value: uf, label: uf }))}
                selecionados={filtroUfs}
                onToggle={toggleEmLista(setFiltroUfs)}
                onLimpar={() => setFiltroUfs([])}
                maxAltura={170}
              />
              <MultiCheckList
                titulo="Canal"
                opcoes={canaisDisponiveis}
                selecionados={filtroCanais}
                onToggle={toggleEmLista(setFiltroCanais)}
                onLimpar={() => setFiltroCanais([])}
                maxAltura={170}
              />
              <div style={{ flex: '1 1 240px', minWidth: 220 }}>
                <div style={{ fontSize: 12, color: '#475569', fontWeight: 700, marginBottom: 6 }}>Critério de erro</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {CRITERIOS_FILTRO.map((c) => {
                    const marcado = filtroCriterios.includes(c.key);
                    return (
                      <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: marcado ? '#1d4ed8' : '#334155', fontWeight: marcado ? 700 : 500, cursor: 'pointer' }}>
                        <input type="checkbox" checked={marcado} onChange={() => toggleEmLista(setFiltroCriterios)(c.key)} />
                        {c.label}
                      </label>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Nenhum marcado = todos os CT-es.</div>
              </div>
            </div>

            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                className="primary"
                type="button"
                onClick={resimularFiltrados}
                disabled={resimulando || carregando || processando || !registrosFiltro.length}
                title="Roda o motor de cálculo só nos CT-es do foco atual e atualiza as métricas na tela (não grava no banco)"
              >
                {resimulando ? 'Resimulando...' : `Resimular filtrados (${fmtN(registrosFiltro.length)})`}
              </button>
              <span style={{ fontSize: 13, color: filtrosAtivos ? '#2563eb' : '#94a3b8', fontWeight: 600 }}>
                {filtrosAtivos
                  ? `${fmtN(registrosFiltro.length)} CT-e(s) no foco — métricas, tabelas e assertividade refletem só este recorte.`
                  : 'Sem filtro — mostrando a base completa. Marque opções para focar e resimular só elas.'}
              </span>
            </div>
            {resimuladoInfo ? (
              <div className="sim-alert success" style={{ marginTop: 10 }}>{resimuladoInfo}</div>
            ) : null}
          </div>
        ) : null}

        <BarraProgresso progresso={progressoProcessamento} />

        {fonteAuditoria ? (
          <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', fontSize: 13 }}>
            Fonte carregada: <strong>{fonteAuditoria.label || fonteAuditoria.tabela}</strong>
          </div>
        ) : null}

        <div style={{ marginTop: 16 }}>
          <ToggleSwitch
            ativo={usarTabelas}
            onChange={toggleUsarTabelas}
            label="Resimular com tabelas cadastradas"
            sublabel={
              usarTabelas
                ? `Ativo — ${fmtN(metricas.totalSemCalculo)} CTe(s) sem cálculo elegíveis para análise de cobertura`
                : 'Desligado — mantenha desligado enquanto a auditoria estiver usando o cálculo já gravado no CTS.'
            }
          />
        </div>

        {temDados ? (
          <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 13, color: '#334155' }}>
              <strong>Placar Verum × AMD.</strong>{' '}
              <span style={{ color: '#64748b' }}>
                Verum = simulação original (referência, intocável) · AMD = nosso motor (número de trabalho que você ajusta).
              </span>
            </div>
            <div style={{ marginTop: 8, fontSize: 13, color: '#475569' }}>
              <strong>AMD × Verum:</strong>{' '}
              {comparacaoVerum.ambos > 0 ? (
                <>
                  <span style={{ color: comparacaoVerum.taxaMatch >= 99 ? '#16a34a' : comparacaoVerum.taxaMatch >= 90 ? '#d97706' : '#dc2626', fontWeight: 700 }}>
                    {fmtP(comparacaoVerum.taxaMatch)} batem
                  </span>{' '}
                  ({fmtN(comparacaoVerum.batem)} de {fmtN(comparacaoVerum.ambos)} com os dois cálculos) ·{' '}
                  {fmtN(comparacaoVerum.divergem)} divergem · dif. média {fmt(comparacaoVerum.difMedia)}
                </>
              ) : (
                <span style={{ color: '#94a3b8' }}>sem CTes com os dois cálculos para comparar (recalcule para gerar o AMD)</span>
              )}
            </div>

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #cbd5e1' }}>
              <div style={{ fontSize: 13, color: '#334155', fontWeight: 700, marginBottom: 8 }}>
                Assertividade vs valor cobrado{' '}
                <span style={{ fontWeight: 400, color: '#64748b' }}>(quantos CT-es cada cálculo acerta o realizado)</span>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px', padding: '10px 12px', borderRadius: 8, background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
                  <div style={{ fontSize: 12, color: '#047857', fontWeight: 700 }}>Combinada (Verum OU AMD)</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#047857' }}>{fmtP(assertividadeSistema.taxaCombinada)}</div>
                  <div style={{ fontSize: 11, color: '#475569' }}>{fmtN(assertividadeSistema.combinado)} de {fmtN(assertividadeSistema.comAlgumCalculo)} CT-es · base para a meta</div>
                </div>
                <div style={{ flex: '1 1 160px', padding: '10px 12px', borderRadius: 8, background: '#fff', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 12, color: '#1e293b', fontWeight: 700 }}>AMD (nosso motor)</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: assertividadeSistema.taxaRecalculo >= 99 ? '#16a34a' : assertividadeSistema.taxaRecalculo >= 90 ? '#d97706' : '#dc2626' }}>{fmtP(assertividadeSistema.taxaRecalculo)}</div>
                  <div style={{ fontSize: 11, color: '#475569' }}>{fmtN(assertividadeSistema.comRecalculo)} CT-es com recálculo</div>
                </div>
                <div style={{ flex: '1 1 160px', padding: '10px 12px', borderRadius: 8, background: '#fff', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 12, color: '#1e293b', fontWeight: 700 }}>Verum (original)</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: assertividadeSistema.taxaVerum >= 99 ? '#16a34a' : assertividadeSistema.taxaVerum >= 90 ? '#d97706' : '#dc2626' }}>{fmtP(assertividadeSistema.taxaVerum)}</div>
                  <div style={{ fontSize: 11, color: '#475569' }}>{fmtN(assertividadeSistema.comVerum)} CT-es com Verum</div>
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
                Só recálculo acertou: <strong>{fmtN(assertividadeSistema.soRecalculo)}</strong> ·{' '}
                Só Verum acertou: <strong>{fmtN(assertividadeSistema.soVerum)}</strong> ·{' '}
                Ambos: <strong>{fmtN(assertividadeSistema.ambosBatem)}</strong> ·{' '}
                Nenhum bateu: <strong style={{ color: assertividadeSistema.nenhumBate > 0 ? '#dc2626' : '#64748b' }}>{fmtN(assertividadeSistema.nenhumBate)}</strong>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {temDados ? (
        <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <div className="summary-card">
            <span>Total CTes</span>
            <strong>{fmtN(metricas.total)}</strong>
            <small>base filtrada</small>
          </div>
          <div className="summary-card" style={{ borderLeft: '3px solid #3b82f6' }}>
            <span>Com cálculo</span>
            <strong>{fmtN(metricas.totalCalculados)}</strong>
            <small style={{ color: '#3b82f6', fontWeight: 700 }}>{fmtP(metricas.taxaCalculo)} do total</small>
          </div>
          <div className="summary-card" style={{ borderLeft: '3px solid #94a3b8' }}>
            <span>Sem cálculo</span>
            <strong>{fmtN(metricas.totalSemCalculo)}</strong>
            <small style={{ color: metricas.totalSemCalculo > 0 ? '#dc2626' : '#94a3b8', fontWeight: 700 }}>
              {fmtP(100 - metricas.taxaCalculo)} do total
            </small>
          </div>
          <div className="summary-card" style={{ borderLeft: '3px solid #16a34a' }}>
            <span>Assertivos</span>
            <strong>{fmtN(metricas.totalAssertivos)}</strong>
            <small style={{ color: '#16a34a', fontWeight: 700 }}>{fmtP(metricas.taxaAssertividade)} dos calculados</small>
          </div>
          <div className="summary-card" style={{ borderLeft: '3px solid #f59e0b' }}>
            <span>Com divergência</span>
            <strong>{fmtN(metricas.totalDivergentes)}</strong>
            <small style={{ color: metricas.totalDivergentes > 0 ? '#f59e0b' : '#94a3b8', fontWeight: 700 }}>
              {fmtP(metricas.taxaDivergencia)} dos calculados
            </small>
          </div>
          <div className="summary-card" style={{ borderLeft: '3px solid #dc2626' }}>
            <span>Valor divergência</span>
            <strong style={{ fontSize: 15 }}>{fmt(metricas.valorTotalDivergencia)}</strong>
            <small style={{ color: '#dc2626' }}>excessivo: {fmt(metricas.valorExcessivo)}</small>
          </div>
        </div>
      ) : null}

      {temDados ? (
        <section className="sim-card">
          <h2 style={{ marginTop: 0 }}>🔎 Diagnóstico do recálculo — onde o motor para</h2>
          <p style={{ color: '#64748b', marginTop: -4 }}>
            Quebra dos CT-es do foco por etapa de casamento (transportadora → origem → rota → faixa).
            Use para saber o que cadastrar/corrigir. {filtrosAtivos ? 'Reflete só o recorte filtrado.' : 'Base completa.'}
          </p>
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>Situação</th>
                  <th>CT-es</th>
                  <th>% do foco</th>
                  <th>Motivo</th>
                  <th>Maiores transportadoras afetadas</th>
                </tr>
              </thead>
              <tbody>
                {diagnosticoRecalculo.map((l) => {
                  const pct = registrosFiltro.length > 0 ? (l.total / registrosFiltro.length) * 100 : 0;
                  const ok = l.status === 'CALCULADO';
                  return (
                    <tr key={l.status}>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: ok ? '#dcfce7' : '#fee2e2', color: ok ? '#166534' : '#991b1b' }}>
                          {l.label}
                        </span>
                      </td>
                      <td><strong>{fmtN(l.total)}</strong></td>
                      <td>{fmtP(pct)}</td>
                      <td style={{ fontSize: 12, color: '#64748b' }}>{l.motivo || '—'}</td>
                      <td style={{ fontSize: 12, color: '#475569' }}>
                        {l.topTransp.map(([nome, qtd]) => `${nome} (${fmtN(qtd)})`).join(' · ') || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {temDados ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="sim-tab" type="button" onClick={() => setMostrarAvancado((v) => !v)} style={mostrarAvancado ? { borderColor: '#2563eb', color: '#2563eb', fontWeight: 700 } : undefined}>
            {mostrarAvancado ? 'Ocultar' : 'Mostrar'} seções de gestão (Meta, Por transportadora, Excluídas, Resumo mensal)
          </button>
        </div>
      ) : null}

      {temDados && mostrarAvancado ? (
        <section className="sim-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>📊 Status da Meta da Área</h2>
            {!editandoMeta ? (
              <button className="sim-tab" type="button" onClick={() => { setMetaTemp({ ...meta }); setEditandoMeta(true); }}>
                Editar meta
              </button>
            ) : null}
          </div>

          <div style={{ padding: 14, borderRadius: 10, background: estiloAvaliacaoMeta.bg, border: `1px solid ${estiloAvaliacaoMeta.border}`, color: estiloAvaliacaoMeta.color, marginBottom: 16 }}>
            <strong>{avaliacaoMeta.titulo}</strong>
            <div style={{ fontSize: 13, marginTop: 4 }}>{avaliacaoMeta.mensagem}</div>
          </div>

          {!editandoMeta ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
              <div style={{ padding: 16, borderRadius: 12, background: semaforoCalculo.bg }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Taxa de cálculo</span>
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: semaforoCalculo.cor, color: '#fff', fontSize: 12, fontWeight: 700 }}>
                    {semaforoCalculo.label}
                  </span>
                </div>
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                  <span style={{ fontSize: 36, fontWeight: 900, color: semaforoCalculo.cor, lineHeight: 1 }}>
                    {fmtP(metricas.taxaCalculo)}
                  </span>
                  <span style={{ color: '#64748b', fontSize: 13, marginBottom: 4 }}>meta: {fmtP(meta.taxaCalculoMeta)}</span>
                </div>
                <BarraMeta atual={metricas.taxaCalculo} meta={meta.taxaCalculoMeta} cor={semaforoCalculo.cor} />
                <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
                  {fmtN(metricas.totalCalculados)} de {fmtN(metricas.total)} CTes calculados
                </div>
              </div>

              <div style={{ padding: 16, borderRadius: 12, background: semaforoAssert.bg }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Assertividade dos calculados</span>
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: semaforoAssert.cor, color: '#fff', fontSize: 12, fontWeight: 700 }}>
                    {semaforoAssert.label}
                  </span>
                </div>
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                  <span style={{ fontSize: 36, fontWeight: 900, color: semaforoAssert.cor, lineHeight: 1 }}>
                    {metricas.totalCalculados > 0 ? fmtP(metricas.taxaAssertividade) : '—'}
                  </span>
                  <span style={{ color: '#64748b', fontSize: 13, marginBottom: 4 }}>meta: {fmtP(meta.taxaAssertividadeMeta)}</span>
                </div>
                <BarraMeta atual={metricas.taxaAssertividade} meta={meta.taxaAssertividadeMeta} cor={semaforoAssert.cor} />
                <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
                  {fmtN(metricas.totalAssertivos)} assertivos · {fmtN(metricas.totalDivergentes)} divergentes · sem cálculo fora da assertividade
                </div>
              </div>
            </div>
          ) : null}

          {editandoMeta ? (
            <div>
              <div className="sim-alert info" style={{ marginBottom: 14 }}>
                <strong>Meta configurada agora:</strong> {fmtP(meta.taxaCalculoMeta, 0)} dos CTes com cálculo e {fmtP(meta.taxaAssertividadeMeta, 0)} de assertividade.<br />
                <strong>Recomendação:</strong> evitar meta de 100% de assertividade como régua principal. Ela pode virar meta injusta por arredondamento, imposto, generalidade e diferença de tabela.
              </div>
              <div className="sim-form-grid sim-grid-3" style={{ marginBottom: 14 }}>
                <label>
                  Meta taxa de cálculo (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={metaTemp.taxaCalculoMeta}
                    onChange={(e) => setMetaTemp((p) => ({ ...p, taxaCalculoMeta: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Meta assertividade (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={metaTemp.taxaAssertividadeMeta}
                    onChange={(e) => setMetaTemp((p) => ({ ...p, taxaAssertividadeMeta: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Descrição da meta
                  <input
                    value={metaTemp.descricao}
                    placeholder="Ex: 95% calculados com 98% de assertividade"
                    onChange={(e) => setMetaTemp((p) => ({ ...p, descricao: e.target.value }))}
                  />
                </label>
              </div>
              {metricas.total > 0 ? (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', marginBottom: 14 }}>
                  <span style={{ fontSize: 13, color: '#15803d' }}>
                    💡 <strong>Sugestão baseada nos dados carregados:</strong> cálculo {fmtP(sugestaoMeta.taxaCalculoMeta, 0)}, assertividade {fmtP(sugestaoMeta.taxaAssertividadeMeta, 0)}
                  </span>
                  <button className="sim-tab" type="button" onClick={usarSugestaoMeta} style={{ marginLeft: 12, padding: '3px 10px', fontSize: 12 }}>
                    Usar sugestão
                  </button>
                </div>
              ) : null}
              <div className="sim-actions">
                <button className="primary" type="button" onClick={salvarMeta}>Salvar meta</button>
                <button className="sim-tab" type="button" onClick={() => { setMetaTemp({ ...meta }); setEditandoMeta(false); }}>Cancelar</button>
              </div>
            </div>
          ) : null}

          {meta.descricao && !editandoMeta ? (
            <div style={{ marginTop: 12, color: '#64748b', fontSize: 13 }}>📌 {meta.descricao}</div>
          ) : null}
        </section>
      ) : null}

      {temDados && ondeAtacar.length > 0 ? (
        <section className="sim-card">
          <h2>🎯 Onde Atacar</h2>
          <p style={{ color: '#64748b', marginBottom: 16 }}>Priorizado por impacto financeiro × volume. Ação sugerida automática por situação detectada.</p>
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Transportadora</th>
                  <th>Severidade</th>
                  <th>Sem cálculo</th>
                  <th>Divergentes</th>
                  <th>Assertividade</th>
                  <th>Valor divergência</th>
                  <th>Cobrança excessiva</th>
                  <th>Ação sugerida</th>
                  {usarTabelas ? <th>Elegíveis resimular</th> : null}
                </tr>
              </thead>
              <tbody>
                {ondeAtacar.map((it, i) => (
                  <tr key={it.transportadora}>
                    <td style={{ color: '#94a3b8', fontSize: 12 }}>{i + 1}</td>
                    <td><strong>{it.transportadora}</strong><div style={{ fontSize: 11, color: '#94a3b8' }}>{fmtN(it.total)} CTes</div></td>
                    <td><BadgeSeveridade severidade={it.severidade} /></td>
                    <td>{it.semCalculo > 0 ? <span style={{ color: '#dc2626', fontWeight: 700 }}>{fmtN(it.semCalculo)}</span> : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                    <td>{it.divergentes > 0 ? <span style={{ color: '#f59e0b', fontWeight: 700 }}>{fmtN(it.divergentes)}</span> : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                    <td>
                      <span style={{ fontWeight: 700, color: it.calculados === 0 ? '#94a3b8' : it.taxaAssertividade >= meta.taxaAssertividadeMeta ? '#16a34a' : it.taxaAssertividade >= 80 ? '#d97706' : '#dc2626' }}>
                        {it.calculados > 0 ? fmtP(it.taxaAssertividade) : '—'}
                      </span>
                    </td>
                    <td style={{ color: it.valorDivergencia > 0 ? '#dc2626' : '#94a3b8', fontWeight: it.valorDivergencia > 0 ? 700 : 400 }}>
                      {it.valorDivergencia > 0 ? fmt(it.valorDivergencia) : '—'}
                    </td>
                    <td style={{ color: it.valorExcessivo > 0 ? '#dc2626' : '#94a3b8' }}>
                      {it.valorExcessivo > 0 ? fmt(it.valorExcessivo) : '—'}
                    </td>
                    <td>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        background: it.acaoSugerida.includes('Cadastrar') ? '#fee2e2' : it.acaoSugerida.includes('Revisar') || it.acaoSugerida.includes('Ampliar') ? '#fef3c7' : '#f0fdf4',
                        color: it.acaoSugerida.includes('Cadastrar') ? '#dc2626' : it.acaoSugerida.includes('Revisar') || it.acaoSugerida.includes('Ampliar') ? '#b45309' : '#16a34a',
                      }}>
                        {it.acaoSugerida}
                      </span>
                    </td>
                    {usarTabelas ? (
                      <td><span style={{ padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#eff6ff', color: '#1d4ed8' }}>{fmtN(it.semCalculo)} CTes</span></td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {temDados && mostrarAvancado ? (
        <section className="sim-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Transportadoras fora da análise</h2>
            <span style={{ fontSize: 13, color: excluidas.length ? '#dc2626' : '#94a3b8', fontWeight: 600 }}>
              {excluidas.length
                ? `${fmtN(excluidas.length)} fora · ${fmtN(ctesExcluidos)} CTes ignorados`
                : 'Nenhuma excluída — métricas usam a base completa'}
            </span>
          </div>
          <p style={{ marginTop: 0, color: '#64748b', fontSize: 13 }}>
            Marque transportadoras que não devem entrar nas métricas (ex.: lotação que só calcula após vínculo na Auditoria Lotação). A escolha fica salva neste navegador.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Buscar transportadora..."
              value={filtroBuscaExcluir}
              onChange={(e) => setFiltroBuscaExcluir(e.target.value)}
              style={{ maxWidth: 320, padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6 }}
            />
            {excluidas.length ? (
              <button className="sim-tab" type="button" onClick={limparExcluidas}>
                Limpar exclusões ({fmtN(excluidas.length)})
              </button>
            ) : null}
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
            {porTransportadoraCompleto
              .filter((it) => !filtroBuscaExcluir.trim() || it.transportadora.toLowerCase().includes(filtroBuscaExcluir.trim().toLowerCase()))
              .slice(0, 200)
              .map((it) => {
                const marcada = excluidasSet.has(it.transportadora);
                return (
                  <label
                    key={it.transportadora}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', cursor: 'pointer', background: marcada ? '#fef2f2' : 'transparent', borderRadius: 6 }}
                  >
                    <input type="checkbox" checked={marcada} onChange={() => toggleExcluida(it.transportadora)} />
                    <span style={{ fontWeight: marcada ? 700 : 500, color: marcada ? '#dc2626' : '#334155' }}>{it.transportadora}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      {fmtN(it.total)} CTes · {fmtN(it.semCalculo)} sem cálculo
                    </span>
                  </label>
                );
              })}
            {!porTransportadoraCompleto.length ? <div className="empty-note">Carregue a base primeiro.</div> : null}
          </div>
          {porTransportadoraCompleto.length > 200 ? (
            <div className="empty-note">Mostrando 200 de {porTransportadoraCompleto.length}. Use a busca para encontrar as demais.</div>
          ) : null}
        </section>
      ) : null}

      {temDados && mostrarAvancado ? (
        <section className="sim-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Por transportadora{excluidas.length ? ` (${fmtN(excluidas.length)} fora da análise)` : ''}</h2>
            <button className="sim-tab" type="button" onClick={exportarExcel}>
              Exportar Excel
            </button>
          </div>
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>Transportadora</th>
                  <th>Total</th>
                  <th>Calculados</th>
                  <th>Sem cálculo</th>
                  <th>Assertivos</th>
                  <th>Divergentes</th>
                  <th>% Cálculo</th>
                  <th>% Assertividade</th>
                  <th>Valor CTe</th>
                  <th>Divergência</th>
                  <th>Excessivo</th>
                  <th>Insuficiente</th>
                </tr>
              </thead>
              <tbody>
                {porTransportadora.slice(0, 100).map((it) => (
                  <tr key={it.transportadora}>
                    <td><strong>{it.transportadora}</strong></td>
                    <td>{fmtN(it.total)}</td>
                    <td>{fmtN(it.calculados)}</td>
                    <td style={{ color: it.semCalculo > 0 ? '#dc2626' : '#94a3b8', fontWeight: it.semCalculo > 0 ? 700 : 400 }}>{fmtN(it.semCalculo)}</td>
                    <td style={{ color: '#16a34a' }}>{fmtN(it.assertivos)}</td>
                    <td style={{ color: it.divergentes > 0 ? '#f59e0b' : '#94a3b8', fontWeight: it.divergentes > 0 ? 700 : 400 }}>{fmtN(it.divergentes)}</td>
                    <td><span style={{ fontWeight: 700, color: it.taxaCalculo >= meta.taxaCalculoMeta ? '#16a34a' : '#dc2626' }}>{fmtP(it.taxaCalculo)}</span></td>
                    <td><span style={{ fontWeight: 700, color: it.calculados === 0 ? '#94a3b8' : it.taxaAssertividade >= meta.taxaAssertividadeMeta ? '#16a34a' : it.taxaAssertividade >= 80 ? '#d97706' : '#dc2626' }}>{it.calculados > 0 ? fmtP(it.taxaAssertividade) : '—'}</span></td>
                    <td>{fmt(it.valorCte)}</td>
                    <td style={{ color: it.valorDivergencia > 0 ? '#dc2626' : '#94a3b8', fontWeight: it.valorDivergencia > 0 ? 700 : 400 }}>{it.valorDivergencia > 0 ? fmt(it.valorDivergencia) : '—'}</td>
                    <td style={{ color: it.valorExcessivo > 0 ? '#dc2626' : '#94a3b8' }}>{it.valorExcessivo > 0 ? fmt(it.valorExcessivo) : '—'}</td>
                    <td style={{ color: it.valorInsuficiente > 0 ? '#f59e0b' : '#94a3b8' }}>{it.valorInsuficiente > 0 ? fmt(it.valorInsuficiente) : '—'}</td>
                  </tr>
                ))}
                {!porTransportadora.length ? <tr><td colSpan="12" style={{ textAlign: 'center', color: '#94a3b8' }}>Nenhum dado. Carregue a base primeiro.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {porTransportadora.length > 100 ? (
            <div className="empty-note">Mostrando 100 de {porTransportadora.length} transportadoras. Exporte o Excel para ver todas.</div>
          ) : null}
        </section>
      ) : null}

      {temDados ? (
        <section className="sim-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>📄 Detalhe por CT-e</h2>
            <button className="sim-tab" type="button" onClick={exportarCtesDetalhe}>
              Exportar Excel ({fmtN(registrosFiltro.length)})
            </button>
          </div>
          <p style={{ marginTop: 0, color: '#64748b', fontSize: 13 }}>
            Uma linha por CT-e do recorte. <strong>Frete Pago</strong> = cobrado · <strong>Verum</strong> = simulação original (referência) · <strong>AMD</strong> = nosso motor.
            Clique numa linha para ver o detalhe do cálculo. {filtrosAtivos ? 'Reflete o recorte filtrado.' : 'Base completa.'}
          </p>
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>Nº CT-e</th>
                  <th>Transportadora</th>
                  <th>Origem → Destino</th>
                  <th>Peso</th>
                  <th>Frete Pago</th>
                  <th>Cálculo Verum</th>
                  <th>Dif. Verum</th>
                  <th>Cálculo AMD</th>
                  <th>Dif. AMD</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {registrosFiltro.slice(0, 200).map((r, idx) => {
                  const verum = Number(r.valor_calculado_verum || 0);
                  const amd = Number(r.valor_calculado || 0);
                  const pago = Number(r.valor_cte || 0);
                  const difVerum = r.diferenca_verum !== undefined && r.diferenca_verum !== null
                    ? Number(r.diferenca_verum) : (verum > 0 ? pago - verum : 0);
                  const difAmd = r.diferenca !== undefined && r.diferenca !== null
                    ? Number(r.diferenca) : (amd > 0 ? pago - amd : 0);
                  const det = (() => {
                    const d = r.detalhes_calculo;
                    if (!d) return null;
                    if (typeof d === 'object') return d;
                    try { return JSON.parse(d); } catch { return null; }
                  })();
                  const expandida = cteExpandido === idx;
                  const corDif = (v, base) => (base <= 0 ? '#94a3b8' : Math.abs(v) <= DIVERGENCIA_THRESHOLD ? '#16a34a' : '#dc2626');
                  return (
                    <React.Fragment key={r.chave_cte || r.numero_cte || idx}>
                      <tr onClick={() => setCteExpandido(expandida ? null : idx)} style={{ cursor: 'pointer', background: expandida ? '#eff6ff' : undefined }}>
                        <td style={{ whiteSpace: 'nowrap' }}>{r.numero_cte || '—'}</td>
                        <td><strong>{r.transportadora || '—'}</strong></td>
                        <td style={{ fontSize: 12 }}>{(r.cidade_origem || '—')}/{r.uf_origem || '—'} → {(r.cidade_destino || '—')}/{r.uf_destino || '—'}</td>
                        <td>{fmtN(Number(r.peso || 0), 0)}</td>
                        <td>{fmt(pago)}</td>
                        <td style={{ color: verum > 0 ? '#334155' : '#94a3b8' }}>{verum > 0 ? fmt(verum) : '—'}</td>
                        <td style={{ color: corDif(difVerum, verum), fontWeight: 600 }}>{verum > 0 ? fmt(difVerum) : '—'}</td>
                        <td style={{ color: amd > 0 ? '#334155' : '#94a3b8' }}>{amd > 0 ? fmt(amd) : '—'}</td>
                        <td style={{ color: corDif(difAmd, amd), fontWeight: 600 }}>{amd > 0 ? fmt(difAmd) : '—'}</td>
                        <td style={{ fontSize: 11 }}>
                          <span style={{ padding: '2px 6px', borderRadius: 6, fontWeight: 700, background: amd > 0 ? '#dcfce7' : '#fee2e2', color: amd > 0 ? '#166534' : '#991b1b' }}>
                            {r.status_calculo || (amd > 0 ? 'CALCULADO' : 'SEM_STATUS')}
                          </span>
                        </td>
                      </tr>
                      {expandida ? (
                        <tr>
                          <td colSpan="10" style={{ background: '#f8fafc', fontSize: 12, color: '#475569' }}>
                            {r.motivo_sem_calculo ? <div style={{ color: '#b45309', marginBottom: 6 }}><strong>Motivo:</strong> {r.motivo_sem_calculo}</div> : null}
                            {det ? (
                              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                                <span><strong>Tipo:</strong> {r.tipo_calculo || det.tipo_calculo || '—'}</span>
                                <span><strong>Origem tabela:</strong> {det.origem_cidade || '—'}</span>
                                <span><strong>Rota:</strong> {det.rota_nome || '—'}</span>
                                <span><strong>Valor base:</strong> {fmt(det.valor_base)}</span>
                                <span><strong>Subtotal:</strong> {fmt(det.subtotal)}</span>
                                <span><strong>ICMS:</strong> {fmt(det.icms)}</span>
                                <span><strong>Taxas:</strong> {fmt(det.taxas)}</span>
                              </div>
                            ) : <span>Sem detalhe de cálculo para este CT-e.</span>}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
                {!registrosFiltro.length ? <tr><td colSpan="10" style={{ textAlign: 'center', color: '#94a3b8' }}>Nenhum CT-e no recorte atual.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {registrosFiltro.length > 200 ? (
            <div className="empty-note">Mostrando 200 de {fmtN(registrosFiltro.length)} CT-es. Exporte o Excel para ver todos.</div>
          ) : null}
        </section>
      ) : null}

      {mostrarAvancado ? <ResumoMensalAuditoria resumoMensal={resumoMensal} /> : null}
      <DiagnosticoFontes diagnostico={diagnostico} />

      {!temDados && !carregando && !processando && !resumoMensal.length ? (
        <section className="sim-card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <h3>Selecione a competência e carregue os dados</h3>
          <p style={{ color: '#64748b', maxWidth: 620, margin: '0 auto' }}>
            Use <strong>Carregar CT-es do mês</strong> para conferir a base CTS. Depois use <strong>Salvar mês carregado</strong> para gravar o histórico da auditoria.
          </p>
        </section>
      ) : null}
    </div>
  );
}
