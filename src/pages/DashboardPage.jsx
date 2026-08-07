import { buildDashboardStats } from '../data/mockData';

function formatarDataHora(valor) {
  if (!valor) return 'Ainda nao sincronizado';
  try {
    return new Date(valor).toLocaleString('pt-BR');
  } catch {
    return String(valor);
  }
}

function formatarNumero(valor) {
  return Number(valor || 0).toLocaleString('pt-BR');
}

function percentual(parte, total) {
  if (!total) return 0;
  return (Number(parte || 0) / Number(total || 0)) * 100;
}

function formatarPercentual(valor) {
  return `${Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
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
    return { titulo: 'Salvando automaticamente', detalhe: 'Gravando alteracoes no Supabase.', classe: 'dark' };
  }
  if (syncStatus?.erro) {
    return { titulo: 'Erro na sincronizacao', detalhe: syncStatus.erro, classe: 'warn' };
  }
  if (syncStatus?.fonte === 'supabase-resumo') {
    return {
      titulo: 'Base online ativa',
      detalhe: 'Resumo carregado. Simulador e importacao consultam as tabelas do Supabase.',
      classe: 'ok',
    };
  }
  if (syncStatus?.modo === 'local') {
    return { titulo: 'Modo local', detalhe: 'Base local do navegador em uso.', classe: 'warn' };
  }
  return { titulo: 'Base pronta', detalhe: 'Alteracoes salvas automaticamente apos cada acao.', classe: 'ok' };
}

export default function DashboardPage({
  transportadoras,
  onAbrirSimulador,
  onAbrirTransportadoras,
  onAbrirImportacao,
  onAbrirFormatacaoTabelas,
  onMudarPagina,
  onAtualizarBase,
  onConferirBase,
  syncStatus,
}) {
  const statsBase = buildDashboardStats(transportadoras);
  const resumo = syncStatus?.resumoBase || {};
  const conferencia = syncStatus?.conferenciaBase || null;
  const totais = {
    transportadoras: resumo.transportadoras ?? statsBase.find((item) => item.id === 1)?.valor ?? 0,
    origens: resumo.origens ?? statsBase.find((item) => item.id === 2)?.valor ?? 0,
    rotas: resumo.rotas ?? statsBase.find((item) => item.id === 3)?.valor ?? 0,
    cotacoes: resumo.cotacoes ?? statsBase.find((item) => item.id === 4)?.valor ?? 0,
  };
  const hasData = transportadoras.length > 0 || Boolean(syncStatus?.resumoBase);
  const status = getStatus(syncStatus, hasData);
  const carregandoInicial = syncStatus?.carregando && !hasData;
  const origensValidadas = transportadoras.reduce(
    (acc, transportadora) => acc + (transportadora.origens || []).filter((origem) => origem.validado).length,
    0
  );
  const coberturaValidada = percentual(origensValidadas, totais.origens);
  const rotasPorOrigem = totais.origens ? totais.rotas / totais.origens : 0;
  const cotacoesPorRota = totais.rotas ? totais.cotacoes / totais.rotas : 0;
  const modoOnline = syncStatus?.modo !== 'local';
  const abrirPagina = (pagina) => {
    if (typeof onMudarPagina === 'function') onMudarPagina(pagina);
  };

  return (
    <div className="page-shell amd-dashboard-shell dashboard-pro">
      <section className="dashboard-hero">
        <div>
          <div className="amd-mini-brand">AMD Log - Plataforma de Fretes</div>
          <h1>Dashboard operacional</h1>
          <p>
            Visao rapida da saude da base, cobertura de tabelas e acessos principais para simulacao,
            importacao e manutencao das transportadoras.
          </p>
        </div>
        <div className="amd-quick-actions dashboard-actions">
          <button className="btn-primary" onClick={onAbrirSimulador}>Abrir simulador</button>
          <button className="btn-secondary" onClick={onAbrirImportacao}>Importar arquivos</button>
          <button className="btn-secondary" onClick={onAbrirTransportadoras}>Transportadoras</button>
          <button className="btn-secondary" onClick={onAbrirFormatacaoTabelas}>Formatar tabelas</button>
        </div>
      </section>

      <section className="dashboard-kpi-grid">
        <div className="dashboard-kpi primary-kpi">
          <span>Base de transportadoras</span>
          <strong>{formatarNumero(totais.transportadoras)}</strong>
          <small>{formatarNumero(totais.origens)} origens cadastradas</small>
        </div>
        <div className="dashboard-kpi">
          <span>Rotas ativas</span>
          <strong>{formatarNumero(totais.rotas)}</strong>
          <small>{rotasPorOrigem.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} rotas por origem</small>
        </div>
        <div className="dashboard-kpi">
          <span>Cotacoes/faixas</span>
          <strong>{formatarNumero(totais.cotacoes)}</strong>
          <small>{cotacoesPorRota.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} cotacoes por rota</small>
        </div>
        <div className="dashboard-kpi">
          <span>Cobertura validada</span>
          <strong>{conferencia?.semValidacao ? 'Sem validacao' : formatarPercentual(coberturaValidada)}</strong>
          <small>{`${formatarNumero(origensValidadas)} de ${formatarNumero(totais.origens)} origens validadas`}</small>
        </div>
      </section>

      <section className="dashboard-main-grid">
        <div className="dashboard-status-card">
          <div className="dashboard-card-head">
            <div>
              <span className={`status-dot ${status.classe}`} />
              <strong>{status.titulo}</strong>
            </div>
            <span className={`status-pill ${status.classe}`}>{modoOnline ? 'Supabase' : 'Local'}</span>
          </div>
          <p>{status.detalhe}</p>
          <div className="dashboard-status-meta">
            <div><span>Fonte</span><strong>{syncStatus?.fonte || '-'}</strong></div>
            <div><span>Ultima atualizacao</span><strong>{formatarDataHora(syncStatus?.ultimaSincronizacao)}</strong></div>
            <div><span>Salvamento</span><strong>{syncStatus?.sincronizando ? 'Em andamento' : 'Automatico'}</strong></div>
          </div>
          <div className="dashboard-status-actions">
            <button
              className="btn-secondary"
              onClick={onAtualizarBase}
              disabled={syncStatus?.carregando || syncStatus?.sincronizando}
            >
              {syncStatus?.carregando ? 'Atualizando...' : 'Atualizar resumo'}
            </button>
            <button className="btn-secondary" onClick={onConferirBase} disabled={syncStatus?.carregando || syncStatus?.sincronizando}>
              Conferir base
            </button>
          </div>
        </div>

        <div className="dashboard-quality-card">
          <div className="dashboard-card-head">
            <div>
              <span className="status-dot ok" />
              <strong>Qualidade da base</strong>
            </div>
            <span>{conferencia ? 'Conferida' : 'Pendente'}</span>
          </div>
          {carregandoInicial ? (
            <div className="dashboard-loading-line">
              <div className="loading-spinner" />
              <span>Carregando resumo da base...</span>
            </div>
          ) : (
            <>
              <div className="quality-meter">
                <div style={{ width: `${Math.min(100, coberturaValidada || (hasData ? 72 : 0))}%` }} />
              </div>
              <div className="quality-list">
                <div><span>Transportadoras</span><strong>{formatarNumero(conferencia?.transportadoras ?? totais.transportadoras)}</strong></div>
                <div><span>Origens</span><strong>{formatarNumero(conferencia?.origens ?? totais.origens)}</strong></div>
                <div><span>Rotas</span><strong>{formatarNumero(conferencia?.rotas ?? totais.rotas)}</strong></div>
                <div><span>Cotacoes</span><strong>{formatarNumero(conferencia?.cotacoes ?? totais.cotacoes)}</strong></div>
              </div>
              <p>
                {conferencia
                  ? (conferencia.semValidacao
                    ? 'A conferencia retornou cobertura, mas sem validacao individual por transportadora.'
                    : `${formatarNumero(transportadorasValidadas)} transportadoras validadas na conferencia.`)
                  : 'Conferir a base ajuda a identificar lacunas antes de simular ou importar novas tabelas.'}
              </p>
            </>
          )}
        </div>
      </section>

      <section className="dashboard-workbench">
        <div className="dashboard-section-title">
          <strong>Frentes críticas</strong>
          <span>Rotinas que precisam aparecer no painel do dia a dia</span>
        </div>
        <div className="dashboard-module-grid dashboard-critical-grid">
          <button className="dashboard-module-card accent" onClick={() => abrirPagina('tabelas-negociacao')}>
            <span>Negociacoes</span>
            <strong>Pipeline comercial, aprovacoes e publicacao</strong>
            <small>Use para acompanhar novas tabelas, reajustes e laudos de negociacao</small>
          </button>
          <button className="dashboard-module-card" onClick={() => abrirPagina('lotacao-auditoria')}>
            <span>Auditoria lotacao</span>
            <strong>Conferir viagens, distancias e frete fechado</strong>
            <small>Tratativa dos casos devolvidos pela auditoria de lotacao</small>
          </button>
          <button className="dashboard-module-card" onClick={() => abrirPagina('faturas')}>
            <span>Auditoria fretes</span>
            <strong>Faturas, divergencias e validacao financeira</strong>
            <small>Central de auditoria para fretes cobrados e pendencias</small>
          </button>
          <button className="dashboard-module-card" onClick={() => abrirPagina('reajustes')}>
            <span>Reajustes</span>
            <strong>Impacto de tabela atual, carteira e mercado</strong>
            <small>Visao executiva para defender ou contestar reajustes</small>
          </button>
        </div>
      </section>

      <section className="dashboard-workbench">
        <div className="dashboard-section-title">
          <strong>Operacao e base</strong>
          <span>Atalhos com contexto para preparar a simulacao</span>
        </div>
        <div className="dashboard-module-grid">
          <button className="dashboard-module-card accent" onClick={onAbrirSimulador}>
            <span>Simulacao operacional</span>
            <strong>Comparar tabelas e medir impacto</strong>
            <small>{formatarNumero(totais.cotacoes)} cotacoes disponiveis para calculo</small>
          </button>
          <button className="dashboard-module-card" onClick={onAbrirTransportadoras}>
            <span>Cadastro e base</span>
            <strong>Manter rotas, origens e taxas</strong>
            <small>{formatarNumero(totais.transportadoras)} transportadoras na base</small>
          </button>
          <button className="dashboard-module-card" onClick={onAbrirImportacao}>
            <span>Importacao e Verum</span>
            <strong>Subir arquivos e tratar inconsistencias</strong>
            <small>Use a base online como referencia de validacao</small>
          </button>
          <button className="dashboard-module-card" onClick={onAbrirFormatacaoTabelas}>
            <span>Formatacao de tabelas</span>
            <strong>Preparar rotas antes de publicar</strong>
            <small>Ambiente separado para montar e revisar</small>
          </button>
        </div>
      </section>
    </div>
  );
}
