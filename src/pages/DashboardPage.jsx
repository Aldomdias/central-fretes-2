import { buildDashboardStats } from '../data/mockData';

export default function DashboardPage({ transportadoras, onAbrirSimulador, onAbrirTransportadoras, onAbrirImportacao, onResetarBase }) {
  const stats = buildDashboardStats(transportadoras);

  return (
    <div className="page-shell amd-dashboard-shell">
      <div className="amd-hero-card">
        <div>
          <div className="amd-badge">AMD Log • Plataforma de Fretes</div>
          <div className="page-top between start-mobile top-space">
            <div className="page-header">
              <h1>Simulador de fretes</h1>
              <p>
                Plataforma para importação, cadastro, simulação e geração do arquivo Verum,
                com identidade visual AMD Log e foco operacional.
              </p>
            </div>
            <button className="btn-secondary" onClick={onResetarBase}>↺ Restaurar base exemplo</button>
          </div>
        </div>

        <div className="hero-actions-row">
          <button className="btn-primary" onClick={onAbrirSimulador}>Abrir simulador</button>
          <button className="btn-secondary" onClick={onAbrirImportacao}>Abrir importação</button>
          <button className="btn-secondary" onClick={onAbrirTransportadoras}>Abrir transportadoras</button>
        </div>
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
        <div className="panel-card amd-panel-card">
          <div className="panel-title">🧾 Simulação operacional</div>
          <p>
            Compare tabelas, avalie competitividade e visualize o cálculo completo do frete
            com composição detalhada somente quando abrir os detalhes.
          </p>
          <button className="btn-primary full" onClick={onAbrirSimulador}>Ir para simulação</button>
        </div>

        <div className="panel-card amd-panel-card">
          <div className="panel-title">🏢 Cadastro e base</div>
          <p>
            Gerencie transportadoras, origens, generalidades, rotas e cotações.
            A próxima fase conecta isso à base persistente para histórico e controle.
          </p>
          <button className="btn-secondary full" onClick={onAbrirTransportadoras}>Abrir cadastros</button>
        </div>

        <div className="panel-card amd-panel-card">
          <div className="panel-title">📦 Importação e Verum</div>
          <p>
            Importe arquivos, acompanhe inconsistências e gere os arquivos de rotas e fretes
            no layout correto da Verum.
          </p>
          <button className="btn-secondary full" onClick={onAbrirImportacao}>Abrir importação</button>
        </div>
      </div>

      <div className="info-card amd-info-card">
        <div className="info-badge">🚚</div>
        <div>
          <div className="info-title">Próxima fase recomendada</div>
          <div className="info-text">
            Persistir a base no Supabase, armazenar histórico de importações e preparar a simulação
            sobre o realizado de 3 meses sem depender de arquivos grandes no navegador.
          </div>
        </div>
      </div>
    </div>
  );
}
