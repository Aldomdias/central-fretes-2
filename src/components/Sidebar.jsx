import logoMdlog from '../assets/mdlog-logo.png';

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
    <aside className="sidebar-app">
      <div className="brand-box brand-box-mdlog">
        <img src={logoMdlog} alt="MDLog" className="brand-logo-image" />
        <div>
          <div className="brand-title">MDLog Freight Suite</div>
          <div className="brand-subtitle">Operação, importação e simulação de fretes</div>
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
        Tema visual MDLog aplicado para consolidar a identidade do sistema.
      </div>
    </aside>
  );
}
