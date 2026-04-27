import { buildDashboardStats } from '../data/mockData';

function formatarDataHora(valor) {
  if (!valor) return 'Ainda não sincronizado';
  try {
    return new Date(valor).toLocaleString('pt-BR');
  } catch {
    return String(valor);
  }
}

function getStatus(syncStatus, hasData) {
  if (syncStatus?.carregando) {
    return {
      titulo: 'Carregando base',
      detalhe: hasData
        ? 'Exibindo o último cache enquanto busca os dados mais recentes.'
        : 'Buscando snapshot da base.',
      classe: 'dark',
    };
  }
  if (syncStatus?.carregandoSegundoPlano) {
    return {
      titulo: 'Base pesada em segundo plano',
      detalhe: 'A tela já está liberada. O sistema está tentando montar o snapshot sem travar a importação.',
      classe: 'dark',
    };
  }
  if (syncStatus?.fonte === 'sem-snapshot') {
    return {
      titulo: 'Snapshot ainda vazio',
      detalhe: 'Você já pode importar. A próxima gravação deve criar o snapshot automaticamente.',
      classe: 'warn',
    };
  }
  if (syncStatus?.sincronizando) {
    return { titulo: 'Salvando automaticamente', detalhe: 'Gravando alterações no Supabase.', classe: 'dark' };
  }
  if (syncStatus?.erro) {
    return { titulo: 'Erro na sincronização', detalhe: syncStatus.erro, classe: 'warn' };
  }
  if (syncStatus?.modo === 'local') {
    return { titulo: 'Modo local', detalhe: 'Base local do navegador em uso.', classe: 'warn' };
  }
  return { titulo: 'Base atualizada', detalhe: 'As alterações são salvas automaticamente após cada ação.', classe: 'ok' };
}

export default function DashboardPage({
  transportadoras,
  onAbrirSimulador,
  onAbrirTransportadoras,
  onAbrirImportacao,
  onAbrirFormatacaoTabelas,
  syncStatus,
}) {
  const stats = buildDashboardStats(transportadoras);
  const hasData = transportadoras.length > 0;
  const status = getStatus(syncStatus, hasData);
  const carregandoInicial = syncStatus?.carregando && !hasData;

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
            <button className="btn-secondary" onClick={onAbrirFormatacaoTabelas}>Formatação de tabelas</button>
          </div>
        </div>
      </div>

      <div className="info-card amd-next-phase-card">
        <div className="info-badge">🔄</div>
        <div style={{ flex: 1 }}>
          <div className="info-title">Status da base</div>
          <div className="info-text" style={{ marginBottom: 8 }}>
            <strong>{status.titulo}</strong> — {status.detalhe}
          </div>
          <div className="info-text">
            <strong>Modo:</strong> {syncStatus?.modo === 'local' ? 'Local' : 'Supabase'} ·{' '}
            <strong>Fonte:</strong> {syncStatus?.fonte || '—'} ·{' '}
            <strong>Última atualização:</strong> {formatarDataHora(syncStatus?.ultimaSincronizacao)}
          </div>
        </div>
        <div className="actions-right">
          <span className="status-pill dark">Salvamento automático</span>
        </div>
      </div>

      {carregandoInicial ? (
        <div className="loading-state-card">
          <div className="loading-spinner" />
          <div>
            <div className="loading-title">Carregando base...</div>
            <div className="loading-text">
              Aguarde um instante enquanto os dados são buscados no banco.
            </div>
          </div>
        </div>
      ) : (
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
      )}

      <div className="feature-grid three-cols four-cols-dashboard">
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
            A base agora salva automaticamente após cada alteração.
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

        <div className="panel-card">
          <div className="panel-title">🧩 Formatação de tabelas</div>
          <p>
            Monte rotas e cotações em um ambiente isolado, gere os arquivos padrão e
            só decida no final se quer incluir no sistema principal.
          </p>
          <button className="btn-secondary full" onClick={onAbrirFormatacaoTabelas}>Abrir módulo</button>
        </div>
      </div>
    </div>
  );
}
