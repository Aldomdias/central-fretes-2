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

const resultadosMobile = [
  ['Frete mes', 'R$ 15,24 mi', '+12,8% vs. realizado'],
  ['Saving', 'R$ 2,45 mi', '16,4% sobre o frete'],
  ['CT-es', '128.450', 'com Tracking'],
  ['Aprovacoes', '12', 'pendentes'],
];

const aprovacoesMobile = [
  ['BRASIL WEB', 'ITAJAI/SC', 'B2C', 'R$ 125.400', 'R$ 18.750', '2.430'],
  ['AGT TRANSPORTES', 'CURITIBA/PR', 'ATACADO', 'R$ 98.300', 'R$ 14.210', '1.850'],
  ['OMEGA CARGO', 'SAO PAULO/SP', 'B2C', 'R$ 76.120', 'R$ 10.430', '1.210'],
];

const rotasMobile = [
  ['SP -> SC', 'Curitiba / Itajai', 'R$ 48.750', 'R$ 7.860'],
  ['SP -> RS', 'Sao Paulo / Caxias do Sul', 'R$ 32.210', 'R$ 5.120'],
  ['PR -> SC', 'Maringa / Joinville', 'R$ 21.430', 'R$ 3.410'],
  ['MG -> SP', 'Uberlandia / Sao Paulo', 'R$ 18.920', 'R$ 2.980'],
];

const alertasMobile = [
  ['Tabela atualizada', 'A tabela BRASIL WEB foi atualizada.', 'ok'],
  ['Laudo pronto', 'Laudo da simulacao B2C esta pronto.', 'info'],
  ['Aprovacao pendente', 'Voce tem 12 aprovacoes pendentes.', 'warn'],
  ['Simulacao concluida', 'Simulacao Atacado concluida.', 'done'],
];

function PhoneShell({ active = 'Inicio', children }) {
  const tabs = ['Inicio', 'Aprovar', 'Simular', 'Alertas'];
  return (
    <div className="concept-phone md-phone">
      <div className="md-phone-top">
        <span>9:41</span>
        <i />
        <em />
      </div>
      <div className="md-phone-body">{children}</div>
      <div className="md-bottom-nav">
        {tabs.map((tab) => (
          <span key={tab} className={tab === active ? 'active' : ''}>{tab}</span>
        ))}
      </div>
    </div>
  );
}

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

        <div className="concept-phone-wrap md-phone-wrap">
          <div className="md-phone-gallery">
            <PhoneShell active="Inicio">
              <div className="md-app-header">
                <img src={amdLogo} alt="MDLog" />
                <button type="button" aria-label="Notificacoes">3</button>
              </div>
              <div className="md-greeting">
                <strong>Bom dia, Aldo!</strong>
                <span>Quinta-feira, 31/05/2026</span>
              </div>
              <div className="md-kpi-grid">
                {resultadosMobile.map(([label, valor, detalhe]) => (
                  <article key={label}>
                    <span>{label}</span>
                    <strong>{valor}</strong>
                    <small>{detalhe}</small>
                  </article>
                ))}
              </div>
              <div className="md-progress-card">
                <strong>Simulacoes em andamento</strong>
                <span>2 em processamento</span>
                <div><i style={{ width: '77%' }} /></div>
                <small>Simulacao B2C 77%</small>
                <div><i style={{ width: '42%' }} /></div>
                <small>Simulacao Atacado 42%</small>
              </div>
            </PhoneShell>

            <PhoneShell active="Aprovar">
              <div className="md-title-row">
                <h3>Aprovacoes</h3>
                <button type="button" aria-label="Filtros">⌘</button>
              </div>
              <div className="md-tabs"><span className="active">Pendentes 12</span><span>Aprovadas 28</span><span>Devolvidas 4</span></div>
              <div className="md-approval-list">
                {aprovacoesMobile.map(([nome, cidade, canal, impacto, saving, ctes]) => (
                  <article key={nome}>
                    <div className="md-approval-head">
                      <div className="md-avatar">{nome.slice(0, 2)}</div>
                      <div><strong>{nome}</strong><span>{cidade}</span></div>
                      <em>{canal}</em>
                    </div>
                    <div className="md-approval-metrics">
                      <span>Impacto <b>{impacto}</b></span>
                      <span>Saving est. <b>{saving}</b></span>
                      <span>CT-es <b>{ctes}</b></span>
                    </div>
                    <div className="md-actions"><button type="button">Devolver</button><button type="button">Aprovar</button></div>
                  </article>
                ))}
              </div>
            </PhoneShell>

            <PhoneShell active="Simular">
              <div className="md-title-row">
                <button type="button" aria-label="Voltar">‹</button>
                <h3>Simulacao</h3>
                <button type="button" aria-label="Compartilhar">⇧</button>
              </div>
              <div className="md-sim-head">
                <strong>Simulacao B2C</strong>
                <span>30/05/2026 16:42 · BRASIL WEB - ITAJAI/SC</span>
                <em>Concluida</em>
              </div>
              <div className="md-kpi-grid">
                <article><span>Aderencia (NF)</span><strong>98,7%</strong><small>126.742 com NF</small></article>
                <article><span>Saving</span><strong>R$ 2,31 mi</strong><small>16,4% sobre o frete</small></article>
                <article><span>Faturamento proj.</span><strong>R$ 15,24 mi</strong><small>+12,8% vs. realizado</small></article>
                <article><span>Rotas ganhas</span><strong>156</strong><small>origens x destinos</small></article>
              </div>
              <div className="md-route-list">
                <div className="md-section-title">Impacto por rota <a>Ver todas</a></div>
                {rotasMobile.map(([rota, detalhe, impacto, saving]) => (
                  <div key={rota}><strong>{rota}<span>{detalhe}</span></strong><em>{impacto}<b>{saving}</b></em></div>
                ))}
              </div>
              <button type="button" className="md-primary-action">Salvar resultado</button>
            </PhoneShell>

            <PhoneShell active="Alertas">
              <div className="md-app-header">
                <h3>Alertas</h3>
                <button type="button" aria-label="Notificacoes">3</button>
              </div>
              <div className="md-processing">
                <strong>Processamento</strong>
                <div className="md-loading-card">
                  <img src={amdLogo} alt="MDLog" />
                  <span>Processando simulacao...</span>
                  <div><i style={{ width: '77%' }} /></div>
                  <em>77%</em>
                </div>
              </div>
              <div className="md-alert-list">
                <div className="md-section-title">Recentes <a>Ver todas</a></div>
                {alertasMobile.map(([titulo, detalhe, tipo]) => (
                  <article key={titulo} className={`md-alert-${tipo}`}>
                    <i />
                    <div><strong>{titulo}</strong><span>{detalhe}</span><small>31/05/2026 09:50</small></div>
                  </article>
                ))}
              </div>
            </PhoneShell>
          </div>
        </div>
      </section>
    </div>
  );
}
