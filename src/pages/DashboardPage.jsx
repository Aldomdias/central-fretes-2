import { buildDashboardStats } from '../data/mockData';

export default function DashboardPage({
  transportadoras,
  onAbrirSimulador,
  onAbrirTransportadoras,
  onAbrirImportacao,
  syncStatus,
  onSincronizarAgora,
  onCarregarDoBanco,
}) {
  const stats = buildDashboardStats(transportadoras);

  return (
    <div className="page-shell amd-dashboard-shell">
      <div className="page-top between start-mobile">
        <div className="page-header amd-dashboard-header">
          <div className="amd-mini-brand">AMD Log • Plataforma de Fretes</div>
          <h1>Simulador de fretes</h1>
          <p>
            Plataforma para importação, cadastro, simulação e geração do arquivo Verum,
            com foco operacional e visual mais limpo para o dia a dia.
          </p>
          <div className="amd-quick-actions">
            <button className="btn-primary" onClick={onAbrirSimulador}>Abrir simulador</button>
            <button className="btn-secondary" onClick={onAbrirImportacao}>Abrir importação</button>
            <button className="btn-secondary" onClick={onAbrirTransportadoras}>Abrir transportadoras</button>
          </div>
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
        <div className="panel-card">
          <div className="panel-title">📄 Simulação operacional</div>
          <p>
            Compare tabelas, avalie competitividade e visualize o cálculo completo do frete
            apenas quando abrir os detalhes.
          </p>
          <button className="btn-primary full" onClick={onAbrirSimulador}>Ir para simulação</button>
        </div>

        <div className="panel-card">
          <div className="panel-title">🏢 Cadastro e base</div>
          <p>
            Gerencie transportadoras, origens, generalidades, rotas e cotações.
            Agora a base principal é gravada em tabelas reais no Supabase.
          </p>
          <button className="btn-secondary full" onClick={onAbrirTransportadoras}>Abrir cadastros</button>
        </div>

        <div className="panel-card">
          <div className="panel-title">📦 Importação e Verum</div>
          <p>
            Importe arquivos, acompanhe inconsistências e gere os arquivos no layout
            correto da Verum.
          </p>
          <button className="btn-secondary full" onClick={onAbrirImportacao}>Abrir importação</button>
        </div>
      </div>

      <div className="feature-grid two-cols">
        <div className="panel-card">
          <div className="panel-title">🗄️ Banco de dados</div>
          <p><strong>Modo:</strong> {syncStatus?.modo === 'supabase' ? 'Supabase' : 'Local'}</p>
          <p><strong>Última sincronização:</strong> {syncStatus?.ultimaSincronizacao || 'Ainda não sincronizado'}</p>
          <p><strong>Status:</strong> {syncStatus?.carregando ? 'Carregando' : syncStatus?.sincronizando ? 'Sincronizando' : 'Pronto'}</p>
          {syncStatus?.erro ? <div className="hint-box top-space">{syncStatus.erro}</div> : null}
          <div className="toolbar-wrap top-space">
            <button className="btn-primary" onClick={onSincronizarAgora}>Sincronizar agora</button>
            <button className="btn-secondary" onClick={onCarregarDoBanco}>Carregar do banco</button>
          </div>
        </div>

        <div className="info-card amd-next-phase-card">
          <div className="info-badge">🚚</div>
          <div>
            <div className="info-title">Base real no Supabase</div>
            <div className="info-text">
              Transportadoras, origens, rotas, cotações, taxas especiais e generalidades
              agora podem ser salvas como tabelas reais no banco.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
