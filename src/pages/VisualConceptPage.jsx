import amdLogo from '../assets/amd-log.png';

const kpis = [
  { label: 'Frete em analise', valor: 'R$ 4,8 mi', detalhe: 'Jan/2026' },
  { label: 'Saving projetado', valor: 'R$ 318 mil', detalhe: '+6,6%' },
  { label: 'Aprovacoes', valor: '14', detalhe: '5 urgentes' },
  { label: 'CT-es processados', valor: '32.480', detalhe: 'B2C e atacado' },
];

const tarefas = [
  ['Simulacao RPA B2C', 'Processando por origem e destino', '78%'],
  ['Aprovacao de reajuste', 'Transportadora BOMFIM', 'Pendente'],
  ['Auditoria CT-e', 'Divergencias com prioridade alta', '9'],
];

const appCards = [
  ['Aprovacoes', '14', 'Reajustes e laudos'],
  ['Saving', 'R$ 318k', 'Projetado no mes'],
  ['Alertas', '7', 'Rotas fora da regra'],
  ['Tracking', '96%', 'Base completa'],
];

export default function VisualConceptPage() {
  return (
    <div className="visual-concept-page">
      <section className="concept-hero">
        <div>
          <div className="concept-kicker">Prototipo local</div>
          <h1>Central de Fretes mais limpa, rapida de ler e pronta para mobile.</h1>
          <p>
            Este conceito reduz texto fixo, agrupa menus por area e transforma informacoes longas em
            resumos, detalhes expansivos e acoes objetivas.
          </p>
        </div>
        <div className="concept-brand-card">
          <img src={amdLogo} alt="AMD LOG" />
          <span>Loading de marca para processos longos</span>
          <div className="brand-loader">
            <div />
          </div>
        </div>
      </section>

      <section className="concept-grid">
        <div className="concept-panel concept-web">
          <div className="concept-panel-header">
            <div>
              <span>Web clean</span>
              <h2>Visao operacional</h2>
            </div>
            <button type="button">Exportar</button>
          </div>

          <div className="concept-kpi-row">
            {kpis.map((item) => (
              <article key={item.label}>
                <span>{item.label}</span>
                <strong>{item.valor}</strong>
                <small>{item.detalhe}</small>
              </article>
            ))}
          </div>

          <div className="concept-workspace">
            <div className="concept-filter-bar">
              <button type="button" className="active">Simulador</button>
              <button type="button">Negociacao</button>
              <button type="button">Auditoria</button>
              <button type="button">Tracking</button>
            </div>

            <div className="concept-task-list">
              {tarefas.map(([titulo, detalhe, status]) => (
                <div className="concept-task" key={titulo}>
                  <div>
                    <strong>{titulo}</strong>
                    <span>{detalhe}</span>
                  </div>
                  <em>{status}</em>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="concept-phone-wrap">
          <div className="concept-phone">
            <div className="phone-status" />
            <div className="phone-header">
              <img src={amdLogo} alt="AMD LOG" />
              <button type="button" aria-label="Notificacoes">3</button>
            </div>
            <div className="phone-title">
              <span>Hoje</span>
              <h2>Painel mobile</h2>
            </div>
            <div className="phone-card-main">
              <span>Economia projetada</span>
              <strong>R$ 318 mil</strong>
              <small>Base B2C em processamento faseado</small>
            </div>
            <div className="phone-grid">
              {appCards.map(([label, valor, detalhe]) => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>{valor}</strong>
                  <small>{detalhe}</small>
                </article>
              ))}
            </div>
            <div className="phone-list">
              <div>
                <strong>Aprovar laudo</strong>
                <span>BOMFIM - maior valor validado</span>
              </div>
              <button type="button">Abrir</button>
            </div>
            <div className="phone-bottom-nav">
              <span className="active">Inicio</span>
              <span>Simular</span>
              <span>Aprovar</span>
              <span>Alertas</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
