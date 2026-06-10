import React from 'react';
import { enriquecerTabelaGestao } from '../../utils/tabelasNegociacaoGestao';
import { gestaoStyles } from './GestaoStyles';

export default function NegociacaoDetalheCabecalho({ tabela, sessao, onVoltar, onCopiarLink, carregando = false }) {
  if (!tabela) return null;
  const g = enriquecerTabelaGestao(tabela, sessao);

  return (
    <section className="sim-card" style={{ marginBottom: 18, border: '2px solid #bfdbfe', background: 'linear-gradient(180deg, #f8fbff 0%, #fff 100%)' }}>
      <div className="sim-resultado-topo compact-top">
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <button className="sim-tab" type="button" onClick={onVoltar}>
              ← Voltar à central de gestão
            </button>
            {onCopiarLink ? (
              <button className="sim-tab" type="button" onClick={onCopiarLink}>
                Copiar link
              </button>
            ) : null}
          </div>
          <div className="simulador-subtitulo">Negociação em andamento</div>
          <h1 style={{ margin: '4px 0 0' }}>{tabela.transportadora}</h1>
          <p style={{ margin: '8px 0 0', color: '#475569' }}>
            {g.status_gestao_label} · {tabela.origem || tabela.uf_origem || 'Todas origens'} · {tabela.canal} · {tabela.tipo_tabela}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <span style={gestaoStyles.badgeStatus(g.status_gestao_cor)}>{g.status_gestao_label}</span>
            <span style={{ fontSize: 12, color: '#64748b' }}>Negociador: <strong>{g.negociador_display}</strong></span>
            <span style={{ fontSize: 12, color: '#64748b' }}>Criado por: <strong>{g.criado_por_display}</strong></span>
            {g.saving_estimado ? <span style={{ fontSize: 12, color: '#15803d' }}>Saving: <strong>{g.saving_estimado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></span> : null}
          </div>
        </div>
        {carregando ? <div style={{ color: '#64748b', fontSize: 13 }}>Carregando itens...</div> : null}
      </div>
    </section>
  );
}
