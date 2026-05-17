import React, { useState, useEffect, useMemo } from 'react';
import {
  carregarDadosAuditoria,
  calcularMetricasAuditoria,
  agruparPorTransportadora,
  calcularOndeAtacar,
  sugerirNovaMeta,
  exportarAuditoriaExcel,
  carregarMetaAuditoria,
  salvarMetaAuditoria,
  TOGGLE_TABELAS_KEY,
} from '../services/auditoriaService';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtN(v, d = 0) {
  return Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}
function fmtP(v, d = 1) {
  return Number(v || 0).toFixed(d) + '%';
}

function semaforo(atual, meta) {
  if (atual >= meta) return { cor: '#16a34a', bg: '#dcfce7', label: '✓ Meta atingida' };
  if (atual >= meta * 0.9) return { cor: '#d97706', bg: '#fef3c7', label: '⚠ Próximo da meta' };
  return { cor: '#dc2626', bg: '#fee2e2', label: '✗ Abaixo da meta' };
}

function BadgeSeveridade({ severidade }) {
  const map = {
    critico: { bg: '#fee2e2', color: '#dc2626', label: 'Crítico' },
    alto:    { bg: '#fef3c7', color: '#b45309', label: 'Alto' },
    medio:   { bg: '#e0f2fe', color: '#0369a1', label: 'Médio' },
    baixo:   { bg: '#f0fdf4', color: '#16a34a', label: 'Baixo' },
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
        padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
        background: ativo ? '#eff6ff' : '#f8fafc',
        border: `2px solid ${ativo ? '#3b82f6' : '#e2e8f0'}`,
        display: 'flex', alignItems: 'center', gap: 14,
        userSelect: 'none',
      }}
      onClick={onChange}
    >
      <div style={{
        width: 44, height: 24, borderRadius: 12,
        background: ativo ? '#3b82f6' : '#cbd5e1',
        position: 'relative', flexShrink: 0, transition: 'background 0.2s',
      }}>
        <div style={{
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 3,
          left: ativo ? 23 : 3, transition: 'left 0.2s',
        }} />
      </div>
      <div>
        <div style={{ fontWeight: 700, color: ativo ? '#1d4ed8' : '#374151', fontSize: 14 }}>{label}</div>
        {sublabel && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{sublabel}</div>}
      </div>
    </div>
  );
}

function BarraMeta({ atual, meta, cor }) {
  return (
    <div style={{ marginTop: 8, background: '#e2e8f0', borderRadius: 4, height: 8, position: 'relative' }}>
      {/* linha da meta */}
      <div style={{
        position: 'absolute', top: -4, left: `${Math.min(meta, 100)}%`,
        width: 2, height: 16, background: '#64748b', borderRadius: 1,
      }} />
      <div style={{
        width: `${Math.min(atual, 100)}%`, background: cor,
        borderRadius: 4, height: 8, transition: 'width 0.5s',
      }} />
    </div>
  );
}

// ─── componente principal ─────────────────────────────────────────────────────

export default function AuditoriaCtePage() {
  const [competencia, setCompetencia] = useState('');
  const [registros, setRegistros] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');

  const [usarTabelas, setUsarTabelas] = useState(() => {
    try { return JSON.parse(localStorage.getItem(TOGGLE_TABELAS_KEY) || 'false'); }
    catch { return false; }
  });

  const [meta, setMeta] = useState(carregarMetaAuditoria);
  const [editandoMeta, setEditandoMeta] = useState(false);
  const [metaTemp, setMetaTemp] = useState(meta);

  // ─── computed ─────────────────────────────────────────────────────────────

  const metricas = useMemo(() => calcularMetricasAuditoria(registros), [registros]);
  const porTransportadora = useMemo(() => agruparPorTransportadora(registros), [registros]);
  const ondeAtacar = useMemo(() => calcularOndeAtacar(porTransportadora, meta), [porTransportadora, meta]);
  const sugestaoMeta = useMemo(() => sugerirNovaMeta(metricas), [metricas]);

  const semaforoCalculo = semaforo(metricas.taxaCalculo, meta.taxaCalculoMeta);
  const semaforoAssert = semaforo(metricas.taxaAssertividade, meta.taxaAssertividadeMeta);

  // ─── ações ────────────────────────────────────────────────────────────────

  async function carregar() {
    setCarregando(true);
    setErro('');
    setSucesso('');
    try {
      const dados = await carregarDadosAuditoria(competencia ? { competencia } : {});
      setRegistros(dados);
      setSucesso(`${dados.length.toLocaleString('pt-BR')} CTe(s) carregados.`);
    } catch (e) {
      setErro(e.message || 'Erro ao carregar dados da base local.');
    } finally {
      setCarregando(false);
    }
  }

  function toggleUsarTabelas() {
    const novo = !usarTabelas;
    setUsarTabelas(novo);
    localStorage.setItem(TOGGLE_TABELAS_KEY, JSON.stringify(novo));
  }

  function abrirEdicaoMeta() {
    setMetaTemp({ ...meta });
    setEditandoMeta(true);
  }

  function aplicarSugestao() {
    setMetaTemp({ ...sugestaoMeta });
  }

  function salvarMeta() {
    salvarMetaAuditoria(metaTemp);
    setMeta(metaTemp);
    setEditandoMeta(false);
  }

  function cancelarMeta() {
    setMetaTemp({ ...meta });
    setEditandoMeta(false);
  }

  const temDados = registros.length > 0;

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Auditoria</div>
        <h1>Auditoria de CTes</h1>
        <p>
          Cobertura de cálculo e assertividade das tabelas cadastradas.
          Base filtrada: tomadores <strong>CPX, ITR, GP Pneus</strong> — eBazar excluído automaticamente.
        </p>
      </div>

      {erro    && <div className="sim-alert error">{erro}</div>}
      {sucesso && <div className="sim-alert success">{sucesso}</div>}

      {/* ─── Filtros + Toggle ─────────────────────────────────────────────── */}
      <section className="sim-card">
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
          <label>
            Competência (mês)
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" type="button" onClick={carregar} disabled={carregando}>
              {carregando ? 'Carregando...' : 'Carregar dados'}
            </button>
            <button className="sim-tab" type="button" onClick={() => setCompetencia('')}>
              Limpar
            </button>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <ToggleSwitch
            ativo={usarTabelas}
            onChange={toggleUsarTabelas}
            label="Resimular com tabelas cadastradas"
            sublabel={
              usarTabelas
                ? `Ativo — ${fmtN(metricas.totalSemCalculo)} CTe(s) sem cálculo elegíveis para resimulação`
                : 'Desligado — tabelas ainda em cadastro. Ligue para ver o potencial de cobertura.'
            }
          />
        </div>
      </section>

      {/* ─── KPIs ─────────────────────────────────────────────────────────── */}
      {temDados && (
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
            <small style={{ color: '#16a34a', fontWeight: 700 }}>
              {fmtP(metricas.taxaAssertividade)} dos calculados
            </small>
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
      )}

      {/* ─── Status da Meta ───────────────────────────────────────────────── */}
      {temDados && (
        <section className="sim-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ margin: 0 }}>📊 Status da Meta da Área</h2>
            {!editandoMeta && (
              <button className="sim-tab" type="button" onClick={abrirEdicaoMeta}>
                Editar meta
              </button>
            )}
          </div>

          {/* modo leitura */}
          {!editandoMeta && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Taxa de cálculo */}
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
                  <span style={{ color: '#94a3b8', fontSize: 13, marginBottom: 4 }}>
                    meta: {fmtP(meta.taxaCalculoMeta)}
                  </span>
                </div>
                <BarraMeta atual={metricas.taxaCalculo} meta={meta.taxaCalculoMeta} cor={semaforoCalculo.cor} />
                <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
                  {fmtN(metricas.totalCalculados)} de {fmtN(metricas.total)} CTes calculados
                </div>
              </div>

              {/* Assertividade */}
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
                  <span style={{ color: '#94a3b8', fontSize: 13, marginBottom: 4 }}>
                    meta: {fmtP(meta.taxaAssertividadeMeta)}
                  </span>
                </div>
                <BarraMeta atual={metricas.taxaAssertividade} meta={meta.taxaAssertividadeMeta} cor={semaforoAssert.cor} />
                <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
                  {fmtN(metricas.totalAssertivos)} assertivos · {fmtN(metricas.totalDivergentes)} divergentes
                </div>
              </div>
            </div>
          )}

          {/* modo edição */}
          {editandoMeta && (
            <div>
              <div className="sim-alert info" style={{ marginBottom: 14 }}>
                <strong>Meta atual cadastrada:</strong> 95% dos CTes calculados com 100% de assertividade.<br />
                <strong>Problema identificado:</strong> 100% de assertividade é muito difícil de sustentar e pode ser uma meta injusta.<br />
                <strong>Proposta:</strong> Revisar para 98% de acurácia ou 95% sem erro crítico.
              </div>

              <div className="sim-form-grid sim-grid-3" style={{ marginBottom: 14 }}>
                <label>
                  Meta taxa de cálculo (%)
                  <input
                    type="number" min="0" max="100" step="1"
                    value={metaTemp.taxaCalculoMeta}
                    onChange={(e) => setMetaTemp((p) => ({ ...p, taxaCalculoMeta: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Meta assertividade (%)
                  <input
                    type="number" min="0" max="100" step="0.5"
                    value={metaTemp.taxaAssertividadeMeta}
                    onChange={(e) => setMetaTemp((p) => ({ ...p, taxaAssertividadeMeta: Number(e.target.value) }))}
                  />
                </label>
                <label>
                  Descrição da meta
                  <input
                    value={metaTemp.descricao}
                    placeholder="Ex: 95% calculados com 98% de acurácia"
                    onChange={(e) => setMetaTemp((p) => ({ ...p, descricao: e.target.value }))}
                  />
                </label>
              </div>

              {metricas.total > 0 && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', marginBottom: 14 }}>
                  <span style={{ fontSize: 13, color: '#15803d' }}>
                    💡 <strong>Sugestão baseada nos dados atuais:</strong> cálculo {fmtP(sugestaoMeta.taxaCalculoMeta, 0)}, assertividade {fmtP(sugestaoMeta.taxaAssertividadeMeta, 0)}
                  </span>
                  <button className="sim-tab" type="button" onClick={aplicarSugestao} style={{ marginLeft: 12, padding: '3px 10px', fontSize: 12 }}>
                    Usar sugestão
                  </button>
                </div>
              )}

              <div className="sim-actions">
                <button className="primary" type="button" onClick={salvarMeta}>Salvar meta</button>
                <button className="sim-tab" type="button" onClick={cancelarMeta}>Cancelar</button>
              </div>
            </div>
          )}

          {meta.descricao && !editandoMeta && (
            <div style={{ marginTop: 12, color: '#64748b', fontSize: 13 }}>
              📌 {meta.descricao}
            </div>
          )}
        </section>
      )}

      {/* ─── Onde Atacar ──────────────────────────────────────────────────── */}
      {temDados && ondeAtacar.length > 0 && (
        <section className="sim-card">
          <h2>🎯 Onde Atacar</h2>
          <p style={{ color: '#64748b', marginBottom: 16 }}>
            Transportadoras priorizadas por impacto financeiro e volume de problemas.
            Ordenadas por: valor de divergência × frequência.
          </p>
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
                  {usarTabelas && <th>Elegíveis resimular</th>}
                </tr>
              </thead>
              <tbody>
                {ondeAtacar.map((it, i) => (
                  <tr key={it.transportadora}>
                    <td style={{ color: '#94a3b8', fontSize: 12 }}>{i + 1}</td>
                    <td><strong>{it.transportadora}</strong><div style={{ fontSize: 11, color: '#94a3b8' }}>{fmtN(it.total)} CTes</div></td>
                    <td><BadgeSeveridade severidade={it.severidade} /></td>
                    <td>
                      {it.semCalculo > 0
                        ? <span style={{ color: '#dc2626', fontWeight: 700 }}>{fmtN(it.semCalculo)}</span>
                        : <span style={{ color: '#94a3b8' }}>—</span>}
                    </td>
                    <td>
                      {it.divergentes > 0
                        ? <span style={{ color: '#f59e0b', fontWeight: 700 }}>{fmtN(it.divergentes)}</span>
                        : <span style={{ color: '#94a3b8' }}>—</span>}
                    </td>
                    <td>
                      <span style={{
                        fontWeight: 700,
                        color: it.calculados === 0 ? '#94a3b8' : it.taxaAssertividade >= meta.taxaAssertividadeMeta ? '#16a34a' : it.taxaAssertividade >= 80 ? '#d97706' : '#dc2626',
                      }}>
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
                        padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: it.acaoSugerida.includes('Cadastrar') ? '#fee2e2' : it.acaoSugerida.includes('Revisar') ? '#fef3c7' : '#f0fdf4',
                        color: it.acaoSugerida.includes('Cadastrar') ? '#dc2626' : it.acaoSugerida.includes('Revisar') ? '#b45309' : '#16a34a',
                      }}>
                        {it.acaoSugerida}
                      </span>
                    </td>
                    {usarTabelas && (
                      <td>
                        <span style={{ padding: '2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#eff6ff', color: '#1d4ed8' }}>
                          {fmtN(it.semCalculo)} CTes
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ─── Por Transportadora — tabela completa ─────────────────────────── */}
      {temDados && (
        <section className="sim-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ margin: 0 }}>Por transportadora</h2>
            <button
              className="sim-tab"
              type="button"
              onClick={() => exportarAuditoriaExcel(porTransportadora, metricas, competencia)}
            >
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
                    <td style={{ color: it.semCalculo > 0 ? '#dc2626' : '#94a3b8', fontWeight: it.semCalculo > 0 ? 700 : 400 }}>
                      {fmtN(it.semCalculo)}
                    </td>
                    <td style={{ color: '#16a34a' }}>{fmtN(it.assertivos)}</td>
                    <td style={{ color: it.divergentes > 0 ? '#f59e0b' : '#94a3b8', fontWeight: it.divergentes > 0 ? 700 : 400 }}>
                      {fmtN(it.divergentes)}
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, color: it.taxaCalculo >= meta.taxaCalculoMeta ? '#16a34a' : '#dc2626' }}>
                        {fmtP(it.taxaCalculo)}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        fontWeight: 700,
                        color: it.calculados === 0 ? '#94a3b8' : it.taxaAssertividade >= meta.taxaAssertividadeMeta ? '#16a34a' : it.taxaAssertividade >= 80 ? '#d97706' : '#dc2626',
                      }}>
                        {it.calculados > 0 ? fmtP(it.taxaAssertividade) : '—'}
                      </span>
                    </td>
                    <td>{fmt(it.valorCte)}</td>
                    <td style={{ color: it.valorDivergencia > 0 ? '#dc2626' : '#94a3b8', fontWeight: it.valorDivergencia > 0 ? 700 : 400 }}>
                      {it.valorDivergencia > 0 ? fmt(it.valorDivergencia) : '—'}
                    </td>
                    <td style={{ color: it.valorExcessivo > 0 ? '#dc2626' : '#94a3b8' }}>
                      {it.valorExcessivo > 0 ? fmt(it.valorExcessivo) : '—'}
                    </td>
                    <td style={{ color: it.valorInsuficiente > 0 ? '#f59e0b' : '#94a3b8' }}>
                      {it.valorInsuficiente > 0 ? fmt(it.valorInsuficiente) : '—'}
                    </td>
                  </tr>
                ))}
                {!porTransportadora.length && (
                  <tr>
                    <td colSpan="12" style={{ textAlign: 'center', color: '#94a3b8' }}>
                      Nenhum dado encontrado. Carregue a base primeiro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {porTransportadora.length > 100 && (
            <div className="empty-note">
              Mostrando 100 de {porTransportadora.length} transportadoras. Exporte o Excel para visualizar todas.
            </div>
          )}
        </section>
      )}

      {/* ─── Estado vazio ─────────────────────────────────────────────────── */}
      {!temDados && !carregando && (
        <section className="sim-card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <h3>Carregue os dados para iniciar a auditoria</h3>
          <p style={{ color: '#64748b', maxWidth: 520, margin: '0 auto' }}>
            Selecione uma competência (mês) ou deixe em branco para carregar toda a base.
            O filtro de tomador (CPX, ITR, GP Pneus) e a exclusão do eBazar são aplicados automaticamente.
          </p>
          <button className="primary" type="button" onClick={carregar} disabled={carregando} style={{ marginTop: 20 }}>
            {carregando ? 'Carregando...' : 'Carregar dados agora'}
          </button>
        </section>
      )}
    </div>
  );
}
