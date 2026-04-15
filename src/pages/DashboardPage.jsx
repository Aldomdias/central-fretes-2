import { buildDashboardStats } from '../data/mockData';
import logoMdlog from '../assets/mdlog-logo.png';

export default function DashboardPage({ transportadoras, onAbrirSimulador, onAbrirTransportadoras, onAbrirImportacao, onResetarBase }) {
  const stats = buildDashboardStats(transportadoras);

  return (
    <div className="page-shell">
      <section className="mdlog-hero">
        <div className="mdlog-hero-content">
          <span className="mdlog-chip">MDLog • Freight Platform</span>
          <h1>Simulador de fretes com identidade MDLog</h1>
          <p>
            Layout renovado nas cores da marca para dar mais presença visual ao sistema,
            sem alterar o fluxo que já está funcionando em importação, Verum e cadastros.
          </p>
          <div className="mdlog-hero-actions">
            <button className="btn-primary" onClick={onAbrirSimulador}>Abrir simulador</button>
            <button className="btn-secondary" onClick={onAbrirImportacao}>Abrir importação</button>
            <button className="btn-secondary" onClick={onResetarBase}>↺ Restaurar base exemplo</button>
          </div>
        </div>

        <div className="mdlog-hero-side">
          <img src={logoMdlog} alt="MDLog" className="mdlog-hero-logo" />
          <div className="mdlog-hero-badges">
            <div className="mdlog-mini-card">
              <strong>{transportadoras.length}</strong>
              <span>transportadoras ativas na base local</span>
            </div>
            <div className="mdlog-mini-card danger">
              <strong>Verum pronto</strong>
              <span>exportação alinhada ao layout operacional</span>
            </div>
          </div>
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
        <div className="panel-card accent-blue">
          <div className="panel-title">🧾 Simular Frete em Massa</div>
          <p>
            Informe destino, peso e valor da nota fiscal. O sistema retorna as transportadoras
            ordenadas do menor para o maior frete com a composição completa do cálculo.
          </p>
          <button className="btn-primary full" onClick={onAbrirSimulador}>Abrir Simulador</button>
        </div>

        <div className="panel-card accent-red">
          <div className="panel-title">🏢 Cadastros e Verum</div>
          <p>
            Gerencie transportadoras, origens, inconsistências e geração do arquivo Verum no
            mesmo fluxo operacional que você já validou.
          </p>
          <button className="btn-secondary full" onClick={onAbrirTransportadoras}>Gerenciar Transportadoras</button>
        </div>

        <div className="panel-card accent-outline">
          <div className="panel-title">📥 Importação e Cobertura</div>
          <p>
            Importe arquivos, acompanhe pendências de cobertura e prepare o sistema para a nova
            fase com persistência e histórico de base.
          </p>
          <button className="btn-secondary full" onClick={onAbrirImportacao}>Abrir Importação</button>
        </div>
      </div>

      <div className="feature-grid two-cols-equal">
        <div className="info-card mdlog-info-card">
          <div className="info-badge">⚙️</div>
          <div>
            <div className="info-title">Próxima fase da base</div>
            <div className="info-text">
              Persistir transportadoras, rotas e fretes no banco para parar de depender de
              arquivo pesado no navegador e preparar simulações sobre realizado.
            </div>
          </div>
        </div>

        <div className="info-card mdlog-info-card red-side">
          <div className="info-badge">📊</div>
          <div>
            <div className="info-title">Motor de cálculo e realizado</div>
            <div className="info-text">
              A próxima camada será aplicar tabela atual em uma base histórica de 3 meses para
              medir aderência, custo e saving com visão operacional.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
