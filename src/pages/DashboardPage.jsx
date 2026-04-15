import { buildDashboardStats } from '../data/mockData';

export default function DashboardPage({
  transportadoras,
  onAbrirSimulador,
  onAbrirTransportadoras,
  onAbrirImportacao,
  onResetarBase,
}) {
  const stats = buildDashboardStats(transportadoras);

  return (
    <div className="page-shell amd-dashboard-shell">
      <section className="amd-hero-card">
        <div className="amd-hero-topline">AMD Log • Plataforma de Fretes</div>

        <div className="page-top between start-mobile">
          <div className="page-header slim">
            <h1>Simulador de fretes</h1>
            <p>
              Plataforma para importação, cadastro, simulação e geração do arquivo Verum,
              com foco operacional e visual mais limpo para o dia a dia.
            </p>
          </div>

          <button className="btn-secondary" onClick={onResetarBase}>
            ↺ Restaurar base exemplo
          </button>
        </div>

        <div className="hero-actions-row">
          <button className="btn-primary" onClick={onAbrirSimulador}>Abrir simulador</button>
          <button className="btn-secondary" onClick={onAbrirImportacao}>Abrir importação</button>
          <button className="btn-secondary" onClick={onAbrirTransportadoras}>Abrir transportadoras</button>
        </div>
      </section>

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
            apenas quando abrir os detalhes.
          </p>
          <button className="btn-primary full" onClick={onAbrirSimulador}>Ir para simulação</button>
        </div>

        <div className="panel-card amd-panel-card">
          <div className="panel-title">🏢 Cadastro e base</div>
          <p>
            Gerencie transportadoras, origens, generalidades, rotas e cotações.
            A próxima fase conecta isso à base persistente.
          </p>
          <button className="btn-secondary full" onClick={onAbrirTransportadoras}>Abrir cadastros</button>
        </div>

        <div className="panel-card amd-panel-card">
          <div className="panel-title">📦 Importação e Verum</div>
          <p>
            Importe arquivos, acompanhe inconsistências e gere os arquivos no layout correto da Verum.
          </p>
          <button className="btn-secondary full" onClick={onAbrirImportacao}>Abrir importação</button>
        </div>
      </div>

      <div className="info-card amd-info-card">
        <div className="info-badge">🚚</div>
        <div>
          <div className="info-title">Próxima fase recomendada</div>
          <div className="info-text">
            Persistir a base, armazenar histórico de importações e preparar a simulação sobre o realizado.
          </div>
        </div>
      </div>
    </div>
  );
}
