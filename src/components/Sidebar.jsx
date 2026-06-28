import { usuarioTemAcesso } from '../utils/authLocal';
import amdLogo from '../assets/amd-log.png';

const MENU_GRUPOS = [
  {
    titulo: 'Inicio',
    itens: [
      { chave: 'dashboard', label: 'Dashboard' },
      { chave: 'conceito-app', label: 'Conceito visual' },
    ],
  },
  {
    titulo: 'Simulacao',
    itens: [
      { chave: 'simulador', label: 'Simulador' },
      { chave: 'tabelas-negociacao', label: 'Negociacoes' },
      { chave: 'reajustes', label: 'Reajustes' },
      { chave: 'perda-realizado', label: 'Perda por transportadora' },
      { chave: 'oportunidade-origem', label: 'Oportunidade por origem' },
      { chave: 'oportunidade-transportadora', label: 'Oportunidade transportadora' },
      { chave: 'simular-saida-transportadora', label: 'Saida de transportadora' },
    ],
  },
  {
    titulo: 'Operacao',
    itens: [
      { chave: 'tracking', label: 'Tracking' },
      { chave: 'torre-controle', label: 'Torre de controle' },
      { chave: 'painel-operacao', label: 'Painel operacao' },
      { chave: 'lotacao', label: 'Lotacao tabelas' },
      { chave: 'lotacao-operacao', label: 'Lotacao operacao' },
    ],
  },
  {
    titulo: 'Auditoria',
    itens: [
      { chave: 'cte', label: 'CT-e' },
      { chave: 'auditoria-cte', label: 'Auditoria CT-e' },
      { chave: 'lotacao-auditoria', label: 'Auditoria lotacao' },
      { chave: 'painel-auditoria', label: 'Painel auditoria' },
      { chave: 'faturas', label: 'Auditoria fretes' },
      { chave: 'gestao-auditoria-fretes', label: 'Gestao auditoria' },
      { chave: 'financeiro-auditoria', label: 'Central financeira' },
      { chave: 'tratativas', label: 'Tratativas' },
      { chave: 'gestao-base-cte', label: 'Base CT-e' },
      { chave: 'avaliacao-prazos', label: 'Prazos' },
    ],
  },
  {
    titulo: 'Base e cadastros',
    itens: [
      { chave: 'importacao', label: 'Importacao' },
      { chave: 'formatacao', label: 'Formatacao de tabelas' },
      { chave: 'importar-template', label: 'Importar template' },
      { chave: 'consulta-ibge', label: 'Consulta IBGE' },
      { chave: 'transportadoras', label: 'Transportadoras' },
      { chave: 'usuarios', label: 'Usuarios' },
      { chave: 'ferramentas', label: 'Ferramentas' },
    ],
  },
  {
    titulo: 'Conta',
    itens: [
      { chave: 'minha-senha', label: 'Alterar senha' },
    ],
  },
];

const ICONS = {
  dashboard: 'M4 5a1 1 0 011-1h5v7H4V5zm10-1h5a1 1 0 011 1v4h-6V4zM4 15h6v5H5a1 1 0 01-1-1v-4zm10-2h6v6a1 1 0 01-1 1h-5v-7z',
  'conceito-app': 'M8 2h8a2 2 0 012 2v16a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2zm2 3h4m-1 14h-2',
  simulador: 'M6 4h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2zm3 4h6m-6 4h2m3 0h1m-6 4h1m4 0h2',
  'tabelas-negociacao': 'M7 3h7l5 5v13H7a2 2 0 01-2-2V5a2 2 0 012-2zm7 0v5h5M8 12h8M8 16h8',
  cte: 'M7 3h7l5 5v13H7a2 2 0 01-2-2V5a2 2 0 012-2zm2 10h6m-6 4h6',
  tracking: 'M12 3l8 4-8 4-8-4 8-4zm8 8l-8 4-8-4m16 4l-8 4-8-4',
  'torre-controle': 'M5 20V9h4v11H5zm5 0V4h4v16h-4zm5 0v-7h4v7h-4z',
  reajustes: 'M4 17l6-6 4 4 6-8m0 0h-5m5 0v5',
  importacao: 'M12 3v12m0 0l-4-4m4 4l4-4M5 19h14',
  formatacao: 'M4 6h16M4 11h16M4 16h10',
  ferramentas: 'M12 8a4 4 0 100 8 4 4 0 000-8zm0-5v3m0 12v3M4.2 4.2l2.1 2.1m11.4 11.4l2.1 2.1M3 12h3m12 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  usuarios: 'M16 11a4 4 0 10-8 0 4 4 0 008 0zm-12 9a8 8 0 0116 0',
  'minha-senha': 'M7 11V8a5 5 0 0110 0v3m-11 0h12v10H6V11zm6 4v3',
};

function Icon({ chave }) {
  const path = ICONS[chave] || 'M4 6h16M4 12h16M4 18h16';
  return (
    <svg className="nav-icon-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
    </svg>
  );
}

function BotaoMenu({ item, paginaAtual, onMudarPagina, onFecharMobile }) {
  const ativo = paginaAtual === item.chave;
  return (
    <button
      type="button"
      title={item.label}
      aria-label={item.label}
      onClick={() => {
        onMudarPagina(item.chave);
        onFecharMobile?.();
      }}
      className={`nav-item ${ativo ? 'active' : ''}`}
    >
      <Icon chave={item.chave} />
      <span className="nav-label">{item.label}</span>
    </button>
  );
}

export default function Sidebar({
  paginaAtual,
  onMudarPagina,
  usuario,
  onLogout,
  recolhida = false,
  menuMobileAberto = false,
  onFecharMobile,
}) {
  const inicial = (usuario?.nome || 'A')[0].toUpperCase();
  const grupos = MENU_GRUPOS
    .map((grupo) => ({
      ...grupo,
      itens: grupo.itens.filter((item) => item.chave === 'conceito-app' || usuarioTemAcesso(usuario, item.chave)),
    }))
    .filter((grupo) => grupo.itens.length);

  return (
    <>
      <button
        type="button"
        className={`sidebar-backdrop ${menuMobileAberto ? 'show' : ''}`}
        onClick={onFecharMobile}
        aria-label="Fechar menu"
      />

      <aside className={`sidebar-app ${recolhida ? 'is-collapsed' : ''} ${menuMobileAberto ? 'is-mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">A</div>
          <img src={amdLogo} alt="AMD LOG" className="brand-logo" />
          <div className="brand-copy">
            <strong>Central de Fretes</strong>
            <span>Operacao, simulacao e auditoria</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Menu principal">
          {grupos.map((grupo) => (
            <section className="menu-section" key={grupo.titulo}>
              <div className="menu-section-title">{grupo.titulo}</div>
              <div className="menu-section-items">
                {grupo.itens.map((item) => (
                  <BotaoMenu
                    key={item.chave}
                    item={item}
                    paginaAtual={paginaAtual}
                    onMudarPagina={onMudarPagina}
                    onFecharMobile={onFecharMobile}
                  />
                ))}
              </div>
            </section>
          ))}
        </nav>

        <div className="sidebar-footer-note">
          <div className="sidebar-user-row">
            <div className="sidebar-avatar">{inicial}</div>
            <div className="sidebar-user-meta">
              <div className="sidebar-user-name">{usuario?.nome || 'Usuario'}</div>
              <button type="button" className="logout-button" onClick={onLogout}>
                Sair do sistema
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
