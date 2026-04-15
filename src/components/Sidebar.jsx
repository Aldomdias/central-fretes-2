import logoAmd from '../assets/amd-log.png';

const menuPrincipal = [
  { chave: 'dashboard', label: 'Dashboard', icon: '▦' },
  { chave: 'simulador', label: 'Simulador', icon: '▣' },
  { chave: 'importacao', label: 'Importação', icon: '⇪' },
];

const menuCadastros = [
  { chave: 'transportadoras', label: 'Transportadoras', icon: '🏢' },
];

export default function Sidebar({ paginaAtual, onMudarPagina }) {
  return (
    <aside className="sidebar-app amd-sidebar">
      <div className="brand-box amd-brand-box">
        <div className="amd-brand-mark">
          <img src={logoAmd} alt="AMD Log" className="brand-logo-amd" />
        </div>

        <div className="brand-copy amd-brand-copy">
          <div className="brand-title">AMD Log</div>
          <div className="brand-subtitle">Plataforma de Fretes</div>
        </div>
      </div>

      <div className="menu-section">
        <div className="menu-section-title">PRINCIPAL</div>
        {menuPrincipal.map((item) => (
          <button
            key={item.chave}
            className={paginaAtual === item.chave ? 'nav-item active' : 'nav-item'}
            onClick={() => onMudarPagina(item.chave)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="menu-section">
        <div className="menu-section-title">CADASTROS</div>
        {menuCadastros.map((item) => (
          <button
            key={item.chave}
            className={paginaAtual === item.chave ? 'nav-item active' : 'nav-item'}
            onClick={() => onMudarPagina(item.chave)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-footer-note">
        Visual AMD Log aplicado com foco em leitura e sem invadir o conteúdo.
      </div>
    </aside>
  );
}
