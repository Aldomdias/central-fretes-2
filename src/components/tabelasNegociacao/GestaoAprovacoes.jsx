import React, { useState } from 'react';
import {
  filtrarTabelasGestao,
  formatarMoeda,
  formatarData,
  usuarioEhGestor,
  podePublicarOficial,
} from '../../utils/tabelasNegociacaoGestao';
import { gestaoStyles } from './GestaoStyles';

export default function GestaoAprovacoes({
  tabelas = [],
  sessao = null,
  onAprovar,
  onRecusar,
  onDevolver,
  onComplemento,
  onPublicar,
  salvando = false,
}) {
  const [observacao, setObservacao] = useState({});
  const pendentes = filtrarTabelasGestao(tabelas, { aguardandoAprovacao: true }, sessao);
  const aprovadas = filtrarTabelasGestao(tabelas, { statusGestao: 'APROVADA_GESTOR' }, sessao);
  const ehGestor = usuarioEhGestor(sessao);

  function obs(id) {
    return observacao[id] || '';
  }

  function setObs(id, valor) {
    setObservacao((p) => ({ ...p, [id]: valor }));
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section className="sim-card">
        <h2 style={{ marginTop: 0 }}>Aguardando aprovação do gestor</h2>
        {!ehGestor ? (
          <div className="sim-alert info">Somente perfil Gestão pode aprovar, recusar ou devolver negociações.</div>
        ) : null}

        {pendentes.map((t) => (
          <div key={t.id} className="sim-parametros-box" style={{ marginBottom: 14 }}>
            <div className="sim-parametros-header">
              <div>
                <strong>{t.transportadora}</strong> · {t.nome_negociacao}
                <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 12 }}>
                  Negociador: {t.negociador_display} · Tipo: {t.is_reajuste ? 'Reajuste' : 'Negociação'} · Canal: {t.canal}
                </p>
                <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 12 }}>
                  Origens: {t.origem_label} · Enviada em: {formatarData(t.enviado_aprovacao_em)}
                </p>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12 }}>
                <div>Saving: {formatarMoeda(t.saving_estimado)}</div>
                {t.is_reajuste ? <div>Impacto: {formatarMoeda(t.impacto_reajuste)}</div> : null}
              </div>
            </div>
            <textarea
              value={obs(t.id)}
              onChange={(e) => setObs(t.id, e.target.value)}
              placeholder="Observação da análise do gestor..."
              style={{ width: '100%', minHeight: 70, marginTop: 10 }}
            />
            {ehGestor ? (
              <div className="sim-actions" style={{ marginTop: 10 }}>
                <button className="primary" type="button" disabled={salvando} onClick={() => onAprovar(t, obs(t.id))}>Aprovar</button>
                <button className="sim-tab" type="button" disabled={salvando} onClick={() => onRecusar(t, obs(t.id))}>Recusar</button>
                <button className="sim-tab" type="button" disabled={salvando} onClick={() => onDevolver(t, obs(t.id))}>Devolver para ajuste</button>
                <button className="sim-tab" type="button" disabled={salvando} onClick={() => onComplemento(t, obs(t.id))}>Solicitar complemento</button>
              </div>
            ) : null}
          </div>
        ))}
        {!pendentes.length ? <div className="sim-alert success">Nenhuma negociação aguardando aprovação do gestor.</div> : null}
      </section>

      <section className="sim-card">
        <h2 style={{ marginTop: 0 }}>Aprovadas — prontas para publicação</h2>
        <p style={{ color: '#64748b' }}>Somente negociações aprovadas pelo gestor podem ir para a base oficial.</p>
        {aprovadas.map((t) => (
          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #e2e8f0', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong>{t.transportadora}</strong> · {t.origem_label}
              <div style={{ fontSize: 12, color: '#64748b' }}>Aprovada em {formatarData(t.aprovado_em)} por {t.aprovador_display}</div>
            </div>
            {ehGestor && podePublicarOficial(t) ? (
              <button className="primary" type="button" disabled={salvando} onClick={() => onPublicar(t)}>Publicar na base oficial</button>
            ) : (
              <span style={gestaoStyles.badgeStatus('#16a34a')}>Aprovada</span>
            )}
          </div>
        ))}
        {!aprovadas.length ? <div style={{ color: '#64748b' }}>Nenhuma negociação aprovada aguardando publicação.</div> : null}
      </section>
    </div>
  );
}
