import { buildDashboardStats } from '../data/mockData';

export default function DashboardPage({ transportadoras, onAbrirSimulador, onAbrirTransportadoras, onAbrirImportacao, onResetarBase }) {
  const stats = buildDashboardStats(transportadoras);

  return (
    <div className="page-shell">
      <div className="page-top between start-mobile">
        <div className="page-header">
          <h1>Dashboard</h1>
          <p>Visão geral do sistema de simulação de fretes</p>
        </div>
        <button className="btn-secondary" onClick={onResetarBase}>↺ Restaurar base exemplo</button>
      </div>

      <div className="stats-grid">
        {stats.map((item) => (
          <div className="stat-card" key={item.id}>
            <div className="stat-icon">{item.icon}</div>
            <div className="stat-title">{item.titulo}</div>
            <div className="stat-value">{item.valor}</div>
            <div className="stat-desc">{item.descricao}</div>
          </div>
        ))}
      </div>

      <div className="feature-grid three-cols">
        <div className="panel-card">
          <div className="panel-title">🧾 Simular Frete em Massa</div>
          <p>
            Informe o destino, peso e valor da nota fiscal. O sistema retorna todas as
            transportadoras disponíveis ordenadas do menor para o maior frete.
          </p>
          <button className="btn-primary full" onClick={onAbrirSimulador}>Abrir Simulador</button>
        </div>

        <div className="panel-card">
          <div className="panel-title">🏢 Cadastro de Transportadoras</div>
          <p>
            Cadastre transportadoras e configure origens com generalidades, rotas,
            cotações e taxas especiais exatamente como no desenho do projeto.
          </p>
          <button className="btn-secondary full" onClick={onAbrirTransportadoras}>Gerenciar Transportadoras</button>
        </div>

        <div className="panel-card">
          <div className="panel-title">📥 Importação e Cobertura</div>
          <p>
            Importe arquivos de rotas, cotações, taxas e generalidades. Depois acompanhe
            por transportadora e origem o que ainda está faltando carregar.
          </p>
          <button className="btn-secondary full" onClick={onAbrirImportacao}>Abrir Importação</button>
        </div>
      </div>

      <div className="info-card">
        <div className="info-badge">📦</div>
        <div>
          <div className="info-title">Como funciona o cálculo</div>
          <div className="info-text">
            O simulador localiza as rotas pelo IBGE do destino, encontra a cotação pelo peso e calcula:
            <strong> Frete base + Ad Valorem + GRIS + Pedágio + TAS + CTRC + taxas especiais</strong>.
            Depois aplica ICMS quando configurado e respeita o mínimo da rota.
          </div>
        </div>
      </div>
    </div>
  );
}
