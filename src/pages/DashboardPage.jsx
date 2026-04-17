import { buildDashboardStats } from '../data/mockData';

function formatSyncDate(value) {
  if (!value) return 'Ainda não sincronizado';
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return value;
  }
}

export default function DashboardPage({
  transportadoras,
  onAbrirSimulador,
  onAbrirTransportadoras,
  onAbrirImportacao,
  onResetarBase,
  syncStatus,
  onSincronizarAgora,
}) {
  const stats = buildDashboardStats(transportadoras);
  const usandoBanco = syncStatus?.modo === 'supabase';

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
            Agora a base já pode ser persistida no Supabase.
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

      <div className="info-card amd-next-phase-card dashboard-db-card">
        <div className="info-badge">🗄️</div>
        <div className="dashboard-db-content">
          <div className="info-title">Persistência da base</div>
          <div className="info-text">
            {usandoBanco
              ? 'Supabase configurado. Toda alteração na base será sincronizada com o banco.'
              : 'Supabase ainda não configurado. Enquanto isso, o sistema continua salvando só no navegador.'}
          </div>
          <div className="dashboard-db-meta">
            <span><strong>Modo:</strong> {usandoBanco ? 'Supabase' : 'Local navegador'}</span>
            <span><strong>Última sincronização:</strong> {formatSyncDate(syncStatus?.ultimaSincronizacao)}</span>
            {syncStatus?.erro ? <span className="db-sync-error"><strong>Erro:</strong> {syncStatus.erro}</span> : null}
          </div>
          <div className="amd-quick-actions top-space">
            <button
              className="btn-primary"
              onClick={onSincronizarAgora}
              disabled={!usandoBanco || syncStatus?.sincronizando || syncStatus?.carregando}
            >
              {syncStatus?.sincronizando ? 'Sincronizando...' : 'Sincronizar agora'}
            </button>
            {!usandoBanco ? (
              <button className="btn-secondary" onClick={onAbrirImportacao}>Configurar e continuar importando</button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
