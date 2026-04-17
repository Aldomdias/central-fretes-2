import { buildDashboardStats } from '../data/mockData';

function SyncCard({ syncStatus, onSincronizarAgora }) {
  const modo = syncStatus?.modo === 'supabase' ? 'Supabase' : 'Local';
  const ultima = syncStatus?.ultimaSincronizacao
    ? new Date(syncStatus.ultimaSincronizacao).toLocaleString('pt-BR')
    : 'Ainda não sincronizado';

  return (
    <div className="panel-card">
      <div className="panel-title">☁️ Banco de dados</div>
      <p>Conexão e gravação da base no Supabase.</p>
      <div className="list-stack compact-list">
        <div><strong>Modo:</strong> {modo}</div>
        <div><strong>Última sincronização:</strong> {ultima}</div>
        {syncStatus?.erro ? <div style={{ color: '#b42318' }}><strong>Erro:</strong> {syncStatus.erro}</div> : null}
      </div>
      <button className="btn-primary full" onClick={onSincronizarAgora} disabled={syncStatus?.sincronizando}>
        {syncStatus?.sincronizando ? 'Sincronizando...' : 'Sincronizar agora'}
      </button>
    </div>
  );
}

export default function DashboardPage({ transportadoras, syncStatus, onSincronizarAgora, onAbrirSimulador, onAbrirTransportadoras, onAbrirImportacao, onResetarBase }) {
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
            Agora com sincronização manual no banco.
          </p>
          <button className="btn-secondary full" onClick={onAbrirTransportadoras}>Abrir cadastros</button>
        </div>

        <SyncCard syncStatus={syncStatus} onSincronizarAgora={onSincronizarAgora} />
      </div>

      <div className="info-card amd-next-phase-card">
        <div className="info-badge">🚚</div>
        <div>
          <div className="info-title">Snapshot da base</div>
          <div className="info-text">
            O botão sincroniza o cadastro atual das transportadoras no Supabase e facilita os testes com base persistida.
          </div>
        </div>
      </div>
    </div>
  );
}
