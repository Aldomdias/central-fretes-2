import React, { useMemo, useState } from 'react';
import { agruparPorTransportadora, formatarMoeda } from '../../utils/tabelasNegociacaoGestao';
import { gestaoStyles } from './GestaoStyles';

function normalizarFiltro(v) {
  return String(v ?? '').trim().toUpperCase();
}

export default function GestaoPorTransportadora({
  tabelas = [],
  sessao = null,
  onAbrirOrigem,
  onAdicionarOrigem,
  onGerarLaudoTransportadora,
  carregandoLaudoTransportadora = false,
  filtroTransportadora = '',
  onFiltroTransportadoraChange,
}) {
  const grupos = agruparPorTransportadora(tabelas, sessao);
  const [abertos, setAbertos] = useState({});

  const nomesTransportadoras = useMemo(() => {
    return [...new Set(grupos.map((g) => g.transportadora).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [grupos]);

  const gruposFiltrados = useMemo(() => {
    const termo = normalizarFiltro(filtroTransportadora);
    if (!termo) return grupos;
    return grupos.filter((g) => normalizarFiltro(g.transportadora).includes(termo));
  }, [grupos, filtroTransportadora]);

  function toggle(nome) {
    setAbertos((p) => ({ ...p, [nome]: !p[nome] }));
  }

  function alterarFiltro(valor) {
    if (typeof onFiltroTransportadoraChange === 'function') onFiltroTransportadoraChange(valor);
  }

  return (
    <section className="sim-card">
      <h2 style={{ marginTop: 0 }}>Visão por transportadora</h2>
      <p style={{ color: '#64748b' }}>Origens agrupadas com canal, status, rotas e saving estimado.</p>

      <div className="sim-form-grid sim-grid-3" style={{ marginTop: 14, marginBottom: 16 }}>
        <label>Filtrar transportadora
          <input
            value={filtroTransportadora}
            onChange={(e) => alterarFiltro(e.target.value)}
            placeholder="Ex: BRASIL WEB"
          />
        </label>
        <label>Selecionar transportadora
          <select value={filtroTransportadora} onChange={(e) => alterarFiltro(e.target.value)}>
            <option value="">Todas</option>
            {nomesTransportadoras.map((nome) => (
              <option key={nome} value={nome}>{nome}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="sim-tab" type="button" onClick={() => alterarFiltro('')} disabled={!filtroTransportadora}>
            Limpar filtro
          </button>
        </label>
      </div>

      {gruposFiltrados.map((grupo) => (
        <div key={grupo.transportadora} style={{ marginBottom: 12 }}>
          <div
            style={gestaoStyles.accordionHeader}
            onClick={() => toggle(grupo.transportadora)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && toggle(grupo.transportadora)}
          >
            <div>
              <strong>{grupo.transportadora}</strong>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                {grupo.qtdNegociacoes} negociação(ões) · Negociador: {grupo.negociador}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12 }}>
              <div>Saving: <strong>{formatarMoeda(grupo.savingTotal)}</strong></div>
              {grupo.impactoTotal ? <div>Impacto reajuste: {formatarMoeda(grupo.impactoTotal)}</div> : null}
              {onGerarLaudoTransportadora ? (
                <button
                  className="primary"
                  type="button"
                  style={{ marginTop: 8, marginRight: 8 }}
                  disabled={carregandoLaudoTransportadora}
                  onClick={function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    onGerarLaudoTransportadora(grupo.transportadora);
                  }}
                >
                  {carregandoLaudoTransportadora ? 'Gerando laudo...' : 'Laudo devolutiva'}
                </button>
              ) : null}
              {onAdicionarOrigem ? (
                <button
                  className="sim-tab"
                  type="button"
                  style={{ marginTop: 8 }}
                  onClick={function(event) {
                    event.preventDefault();
                    event.stopPropagation();
                    onAdicionarOrigem(grupo.transportadora);
                  }}
                >
                  + Adicionar origem
                </button>
              ) : null}
            </div>
          </div>

          {abertos[grupo.transportadora] ? grupo.origens.map((origem) => (
            <div key={`${grupo.transportadora}-${origem.label}`} style={gestaoStyles.origemCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <strong>Origem: {origem.label}</strong>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    {origem.rotas || 0} rotas · {origem.canal}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={gestaoStyles.badgeStatus(origem.statusCor)}>{origem.status}</span>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Saving: {formatarMoeda(origem.saving)}</div>
                  {origem.impacto ? <div style={{ fontSize: 12 }}>Impacto: {formatarMoeda(origem.impacto)}</div> : null}
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                {origem.aprovada ? '✓ Aprovada' : '— Pendente'} · {origem.publicada ? '✓ Publicada na base oficial' : 'Não publicada'}
              </div>
              {onAbrirOrigem ? (
                <button className="sim-tab" type="button" style={{ marginTop: 8 }} onClick={() => onAbrirOrigem(origem.negociacaoId)}>
                  Abrir negociação
                </button>
              ) : null}
            </div>
          )) : null}
        </div>
      ))}

      {!gruposFiltrados.length ? (
        <div className="sim-alert info">
          {filtroTransportadora ? 'Nenhuma transportadora encontrada para este filtro.' : 'Nenhuma transportadora encontrada.'}
        </div>
      ) : null}
    </section>
  );
}
