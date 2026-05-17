import React, { useMemo, useState } from 'react';
import {
  carregarDadosAuditoria,
  calcularMetricasAuditoria,
  agruparPorTransportadora,
  calcularOndeAtacar,
  sugerirNovaMeta,
  avaliarMetaAuditoria,
  exportarAuditoriaExcel,
  carregarMetaAuditoria,
  salvarMetaAuditoria,
  TOGGLE_TABELAS_KEY,
} from '../services/auditoriaService';
import {
  carregarResultadosAuditoriaMes,
  carregarResumoAuditoriaMensal,
  processarESalvarAuditoriaMes,
} from '../services/auditoriaCteProcessamentoService';

function fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtN(v, d = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtP(v, d = 1) {
  return `${Number(v || 0).toFixed(d).replace('.', ',')}%`;
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

function BarraMeta({ atual, meta, cor }) {
  return (
    <div style={{ marginTop: 8, background: '#e2e8f0', borderRadius: 4, height: 8, position: 'relative' }}>
      <div style={{ position: 'absolute', top: -4, left: `${Math.min(meta, 100)}%`, width: 2, height: 16, background: '#64748b', borderRadius: 1 }} />
      <div style={{ width: `${Math.min(atual, 100)}%`, background: cor, borderRadius: 4, height: 8, transition: 'width 0.5s' }} />
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

  const metricas = useMemo(() => calcularMetricasAuditoria(registros), [registros]);
  const porTransportadora = useMemo(() => agruparPorTransportadora(registros), [registros]);
  const ondeAtacar = useMemo(() => calcularOndeAtacar(porTransportadora, meta), [porTransportadora, meta]);
  const sugestaoMeta = useMemo(() => sugerirNovaMeta(metricas), [metricas]);
  const avaliacaoMeta = useMemo(() => avaliarMetaAuditoria(metricas, meta), [metricas, meta]);

  const semaforoCalculo = semaforo(metricas.taxaCalculo, meta.taxaCalculoMeta);
  const semaforoAssert = semaforo(metricas.taxaAssertividade, meta.taxaAssertividadeMeta);
  const estiloAvaliacaoMeta = metaStatusStyle(avaliacaoMeta.status);
  const temDados = registros.length > 0;

  async function carregar() {
    if (!competencia) {
      setErro('Informe a competência (mês) antes de carregar. A base é grande e requer um filtro de período para não dar timeout.');
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
      const resposta = await carregarDadosAuditoria({ competencia });
      const dados = resposta?.registros || [];
      setRegistros(dados);
      setFonteAuditoria(resposta?.fonte || null);
      setDiagnostico(resposta?.diagnostico || []);
      setAvisos(resposta?.avisos || []);

      if (!dados.length) {
        setSucesso('Nenhum CTe encontrado para esta competência nas bases verificadas. Veja o diagnóstico abaixo para identificar se o problema é data, competência ou tabela vazia.');
      } else {
        const fonte = resposta?.fonte?.label || resposta?.fonte?.tabela || 'Supabase';
        setSucesso(`${dados.length.toLocaleString('pt-BR')} CTe(s) carregados da fonte ${fonte}.`);
      }
    } catch (e) {
      setRegistros([]);
      setErro(e.message || 'Erro ao carregar dados do Supabase.');
    } finally {
      setCarregando(false);
    }
  }

  async function carregarResultadoSalvo() {
    if (!competencia) {
      setErro('Informe a competência antes de carregar o resultado salvo.');
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
        onProgress: setProgressoProcessamento,
      });

      setRegistros(dados || []);
      setFonteAuditoria({
        id: 'auditoria_cte_resultados',
        tabela: 'auditoria_cte_resultados',
        label: 'Auditoria processada / auditoria_cte_resultados',
      });

      if (!dados.length) {
        setSucesso('Nenhum resultado processado salvo para esta competência. Clique em Processar e salvar auditoria do mês.');
      } else {
        setSucesso(`${dados.length.toLocaleString('pt-BR')} resultado(s) processado(s) carregados da auditoria salva.`);
      }
    } catch (error) {
      setRegistros([]);
      setErro(error.message || 'Erro ao carregar resultado salvo.');
    } finally {
      setCarregando(false);
    }
  }

  async function processarSalvarMes() {
    if (!competencia) {
      setErro('Informe a competência antes de processar a auditoria.');
      return;
    }

    const confirmar = window.confirm(
      `Processar a auditoria de ${competencia}? Se já existir resultado salvo para este mês, ele será substituído.`
    );

    if (!confirmar) return;

    setProcessando(true);
    setErro('');
    setSucesso('');
    setAvisos([]);
    setDiagnostico([]);
    setProgressoProcessamento(null);

    try {
      const resposta = await processarESalvarAuditoriaMes({
        competencia,
        onProgress: setProgressoProcessamento,
      });

      const dados = resposta?.registros || [];
      setRegistros(dados);
      setFonteAuditoria(resposta?.fonte || {
        id: 'auditoria_cte_resultados',
        tabela: 'auditoria_cte_resultados',
        label: 'Auditoria processada / auditoria_cte_resultados',
      });

      const resumo = await carregarResumoAuditoriaMensal();
      setResumoMensal(resumo || []);

      setSucesso(`${dados.length.toLocaleString('pt-BR')} CT-e(s) processados e salvos para ${competencia}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao processar auditoria do mês.');
    } finally {
      setProcessando(false);
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
    setRegistros([]);
    setFonteAuditoria(null);
    setDiagnostico([]);
    setAvisos([]);
    setResumoMensal([]);
    setProgressoProcessamento(null);
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

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Auditoria</div>
        <h1>Auditoria de CTes</h1>
        <p>
          Cobertura de cálculo, assertividade e priorização de divergências. Fonte principal: <code>realizado_local_ctes</code>.
          O processamento mensal grava o resultado em <code>auditoria_cte_resultados</code> e o resumo em <code>auditoria_cte_resumo_mensal</code>.
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
          <strong>Fluxo recomendado.</strong> Primeiro carregue os CT-es para conferir a base. Depois processe e salve a auditoria do mês. Nos próximos acessos, use o resultado salvo.
        </div>

        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
          <label>
            Competência (mês) <span style={{ color: '#dc2626' }}>*</span>
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="primary" type="button" onClick={carregar} disabled={carregando || processando || !competencia}>
              {carregando ? 'Carregando...' : 'Carregar CT-es do mês'}
            </button>
            <button className="sim-tab" type="button" onClick={carregarResultadoSalvo} disabled={carregando || processando || !competencia}>
              Carregar resultado salvo
            </button>
            <button className="primary" type="button" onClick={processarSalvarMes} disabled={carregando || processando || !competencia}>
              {processando ? 'Processando...' : 'Processar e salvar auditoria do mês'}
            </button>
            <button className="sim-tab" type="button" onClick={carregarResumoMensal} disabled={carregando || processando}>
              Carregar resumo mensal
            </button>
            <button className="sim-tab" type="button" onClick={limpar} disabled={carregando || processando}>
              Limpar
            </button>
          </div>
        </div>

        {progressoProcessamento ? (
          <div className="sim-alert info" style={{ marginTop: 12 }}>
            <strong>Processamento:</strong> {progressoProcessamento.etapa}
            {' · '}
            {Number(progressoProcessamento.carregados || 0).toLocaleString('pt-BR')}
            {progressoProcessamento.total
              ? ` de ${Number(progressoProcessamento.total).toLocaleString('pt-BR')}`
              : ''}
          </div>
        ) : null}

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
                : 'Desligado — o processamento mensal já usa as tabelas cadastradas para calcular a auditoria.'
            }
          />
        </div>
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
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Assertividade</span>
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
                  {fmtN(metricas.totalAssertivos)} assertivos · {fmtN(metricas.totalDivergentes)} divergentes
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

      {temDados ? (
        <section className="sim-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Por transportadora</h2>
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

      <ResumoMensalAuditoria resumoMensal={resumoMensal} />
      <DiagnosticoFontes diagnostico={diagnostico} />

      {!temDados && !carregando && !processando && !resumoMensal.length ? (
        <section className="sim-card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <h3>Selecione a competência e carregue os dados</h3>
          <p style={{ color: '#64748b', maxWidth: 620, margin: '0 auto' }}>
            Use <strong>Carregar CT-es do mês</strong> para conferir a base bruta ou <strong>Carregar resultado salvo</strong> para abrir uma auditoria já processada.
            Para criar o resultado da auditoria, clique em <strong>Processar e salvar auditoria do mês</strong>.
          </p>
        </section>
      ) : null}
    </div>
  );
}
