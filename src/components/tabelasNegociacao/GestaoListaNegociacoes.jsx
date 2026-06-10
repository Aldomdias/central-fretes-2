import React from 'react';
import {
  filtrarTabelasGestao,
  formatarMoeda,
  formatarData,
  getEstadoSimulacaoNegociacao,
} from '../../utils/tabelasNegociacaoGestao';
import { gestaoStyles } from './GestaoStyles';

export default function GestaoListaNegociacoes({
  tabelas = [],
  filtros = {},
  sessao = null,
  onAbrir,
  onEnviarAprovacao,
  onAlternarSimulacao,
  selecionadaId = null,
}) {
  const lista = filtrarTabelasGestao(tabelas, filtros, sessao);

  return (
    <section className="sim-card">
      <div className="sim-resultado-topo compact-top">
        <div>
          <h2 style={{ margin: 0 }}>Lista de negociações</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b' }}>{lista.length} registro(s) no recorte atual</p>
        </div>
      </div>

      <div style={gestaoStyles.tabelaWrap}>
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Negociação</th>
              <th>Transportadora</th>
              <th>Tipo</th>
              <th>Status</th>
              <th>Negociador</th>
              <th>Criado por</th>
              <th>Canal</th>
              <th>Origem</th>
              <th>Saving / Impacto</th>
              <th>Datas</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((t) => {
              const estSim = getEstadoSimulacaoNegociacao(t);
              return (
              <tr key={t.id} style={t.id === selecionadaId ? { background: '#eff6ff' } : undefined}>
                <td><strong>{t.nome_negociacao}</strong></td>
                <td>{t.transportadora}</td>
                <td>{t.is_reajuste ? 'Reajuste' : t.tipo_negociacao_norm === 'TABELA_LOTACAO' ? 'Lotação' : 'Nova'}</td>
                <td><span style={gestaoStyles.badgeStatus(t.status_gestao_cor)}>{t.status_gestao_label}</span></td>
                <td>{t.negociador_display}</td>
                <td>{t.criado_por_display}</td>
                <td>{t.canal}</td>
                <td>{t.origem_label}</td>
                <td>
                  <div style={{ fontSize: 12 }}>
                    <div>Saving: {formatarMoeda(t.saving_estimado)}</div>
                    {t.is_reajuste ? <div>Impacto: {formatarMoeda(t.impacto_reajuste)}</div> : null}
                  </div>
                </td>
                <td style={{ fontSize: 11 }}>
                  <div>Criada: {formatarData(t.criado_em)}</div>
                  <div>Atualizada: {formatarData(t.atualizado_em || t.criado_em)}</div>
                  {t.sem_atualizacao_alerta ? <div style={{ color: '#dc2626' }}>Sem atualização há {t.dias_sem_atualizacao}d</div> : null}
                </td>
                <td>
                  <div style={gestaoStyles.linhaAcao}>
                    <button className="primary" type="button" onClick={() => onAbrir(t)}>Abrir</button>
                    {typeof onAlternarSimulacao === 'function' ? (
                      <button className="sim-tab" type="button" onClick={() => onAlternarSimulacao(t)}>
                        {estSim.rotuloAcao}
                      </button>
                    ) : null}
                    {['EM_NEGOCIACAO', 'EM_ANALISE', 'DEVOLVIDA_AJUSTE', 'APROVADA_NEGOCIADOR'].includes(t.status_gestao) ? (
                      <button className="sim-tab" type="button" onClick={() => onEnviarAprovacao(t)}>Enviar p/ aprovação</button>
                    ) : null}
                    <span style={{ fontSize: 11, color: estSim.statusCor, width: '100%' }}>{estSim.rotuloStatus}</span>
                  </div>
                </td>
              </tr>
            );
            })}
            {!lista.length ? <tr><td colSpan="11">Nenhuma negociação encontrada com os filtros atuais.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
