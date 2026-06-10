import React from 'react';
import { calcularDashboardGestao, formatarMoeda } from '../../utils/tabelasNegociacaoGestao';

export default function GestaoDashboard({ tabelas = [] }) {
  const kpi = calcularDashboardGestao(tabelas);

  const cards = [
    { label: 'Em andamento', value: kpi.emAndamento, hint: 'negociações ativas' },
    { label: 'Aguardando gestor', value: kpi.aguardandoAprovacao, hint: 'aprovação pendente' },
    { label: 'Aprovadas', value: kpi.aprovadas, hint: 'pelo gestor' },
    { label: 'Recusadas', value: kpi.recusadas, hint: 'negociações' },
    { label: 'Publicadas', value: kpi.publicadas, hint: 'base oficial' },
    { label: 'Saving acumulado', value: formatarMoeda(kpi.savingAcumulado), hint: 'aprovado/publicado' },
    { label: 'Saving potencial', value: formatarMoeda(kpi.savingPotencial), hint: 'em negociação' },
    { label: 'Impacto reajustes', value: formatarMoeda(kpi.impactoReajustes), hint: 'financeiro' },
    { label: 'Transportadoras', value: kpi.transportadoras, hint: 'em negociação' },
    { label: 'Origens/rotas', value: kpi.origensRotas, hint: 'envolvidas' },
    { label: 'Sem atualização', value: kpi.semAtualizacao, hint: `>${14} dias` },
    { label: 'Novas / Reajustes', value: `${kpi.novas} / ${kpi.reajustes}`, hint: 'por tipo' },
  ];

  return (
    <div>
      <div className="summary-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {cards.map((c) => (
          <div key={c.label} className="summary-card">
            <span>{c.label}</span>
            <strong>{c.value}</strong>
            <small>{c.hint}</small>
          </div>
        ))}
      </div>

      <div className="feature-grid import-grid" style={{ marginTop: 18 }}>
        <div className="sim-parametros-box">
          <div className="sim-parametros-header"><strong>Saving por negociador</strong></div>
          <div className="sim-cobertura-lista" style={{ marginTop: 10 }}>
            {kpi.savingPorNegociador.slice(0, 8).map((item) => (
              <div key={item.nome}><strong>{item.nome}</strong> · {formatarMoeda(item.saving)} · {item.qtd} neg.</div>
            ))}
            {!kpi.savingPorNegociador.length ? <div>Sem dados de saving por negociador.</div> : null}
          </div>
        </div>
        <div className="sim-parametros-box">
          <div className="sim-parametros-header"><strong>Saving por transportadora</strong></div>
          <div className="sim-cobertura-lista" style={{ marginTop: 10 }}>
            {kpi.savingPorTransportadora.slice(0, 8).map((item) => (
              <div key={item.nome}><strong>{item.nome}</strong> · {formatarMoeda(item.saving)}</div>
            ))}
            {!kpi.savingPorTransportadora.length ? <div>Sem dados de saving por transportadora.</div> : null}
          </div>
        </div>
        <div className="sim-parametros-box">
          <div className="sim-parametros-header"><strong>Reajustes em gestão</strong></div>
          <div className="sim-cobertura-lista" style={{ marginTop: 10 }}>
            <div><strong>Aguardando aprovação:</strong> {kpi.reajustesAguardando}</div>
            <div><strong>Aprovados:</strong> {kpi.reajustesAprovados}</div>
            <div><strong>Recusados:</strong> {kpi.reajustesRecusados}</div>
            <div><strong>Impacto total:</strong> {formatarMoeda(kpi.impactoReajustes)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
