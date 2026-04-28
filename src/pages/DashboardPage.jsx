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
      titulo: 'Conectando ao Supabase',
      detalhe: hasData
        ? 'Atualizando o resumo da base sem carregar a base pesada.'
        : 'Buscando resumo da base no banco.',
      classe: 'dark',
    };
  }
  if (syncStatus?.sincronizando) {
    return { titulo: 'Salvando automaticamente', detalhe: 'Gravando alterações no Supabase.', classe: 'dark' };
  }
  if (syncStatus?.erro) {
    return { titulo: 'Erro na sincronização', detalhe: syncStatus.erro, classe: 'warn' };
  }
  if (syncStatus?.fonte === 'supabase-resumo') {
    return {
      titulo: 'Conectado ao Supabase',
      detalhe: 'Resumo da base carregado. A importação e a simulação usam as tabelas do banco.',
      classe: 'ok',
    };
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
  onAtualizarBase,
  onConferirBase,
  syncStatus,
}) {
  const statsBase = buildDashboardStats(transportadoras);
  const resumo = syncStatus?.resumoBase;
  const stats = resumo ? statsBase.map((item) => {
    if (item.id === 1) return { ...item, valor: resumo.transportadoras ?? item.valor };
    if (item.id === 2) return { ...item, valor: resumo.origens ?? item.valor };
    if (item.id === 3) return { ...item, valor: resumo.rotas ?? item.valor };
    if (item.id === 4) return { ...item, valor: resumo.cotacoes ?? item.valor };
    return item;
  }) : statsBase;
  const hasData = transportadoras.length > 0 || Boolean(resumo);
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
        <div className="actions-right gap-row">
          <button
            className="btn-secondary"
            onClick={onAtualizarBase}
            disabled={syncStatus?.carregando || syncStatus?.sincronizando}
            title="Atualizar resumo da base pelo Supabase"
          >
            {syncStatus?.carregando ? 'Atualizando...' : 'Atualizar base'}
          </button>
          <span className="status-pill dark">Salvamento automático</span>
        </div>
      </div>

      <div className="info-card amd-next-phase-card">
        <div className="info-badge">✅</div>
        <div style={{ flex: 1 }}>
          <div className="info-title">Conferência da base</div>
          <div className="info-text">
            {syncStatus?.conferenciaBase ? (
              <>
                <strong>{syncStatus.conferenciaBase.transportadoras}</strong> transportadoras ·{' '}
                <strong>{syncStatus.conferenciaBase.origens}</strong> origens ·{' '}
                <strong>{syncStatus.conferenciaBase.rotas}</strong> rotas ·{' '}
                <strong>{syncStatus.conferenciaBase.cotacoes}</strong> cotações
                {syncStatus.conferenciaBase.semValidacao ? (
                  <> · <strong>cobertura sem validação</strong></>
                ) : (
                  <> · <strong>{syncStatus.conferenciaBase.validadas}</strong> transportadoras validadas</>
                )}
              </>
            ) : (
              <>Clique em <strong>Conferir base</strong> para validar os totais direto no Supabase.</>
            )}
          </div>
          <div className="info-text">
            O simulador consulta o Supabase na hora da simulação. A tela de Transportadoras usa a view de cobertura para não depender de abrir transportadora por transportadora.
          </div>
        </div>
        <div className="actions-right gap-row">
          <button className="btn-secondary" onClick={onConferirBase} disabled={syncStatus?.carregando || syncStatus?.sincronizando}>
            Conferir base
          </button>
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
