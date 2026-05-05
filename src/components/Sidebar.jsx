import logoAmd from '../assets/amd-log.png';
import { nomePerfil, usuarioTemAcesso } from '../utils/authLocal';

const menuPrincipal = [
  { chave: 'dashboard', label: 'Dashboard', icon: '▦' },
  { chave: 'simulador', label: 'Simulador', icon: '▣' },
  { chave: 'realizado-local', label: 'Realizado Local', icon: '▤' },
  { chave: 'realizado', label: 'Realizado CT-e', icon: '▥' },
  { chave: 'importacao', label: 'Importação', icon: '⇪' },
  { chave: 'formatacao', label: 'Formatação de Tabelas', icon: '🧩' },
  { chave: 'importar-template', label: 'Importar Template', icon: '⇩' },
  { chave: 'lotacao', label: 'Lotação Tabelas', icon: '▧' },
  { chave: 'lotacao-operacao', label: 'Lotação Operação', icon: '🚚' },
  { chave: 'lotacao-auditoria', label: 'Auditoria Lotação', icon: '☑' },
  { chave: 'consulta-ibge', label: 'Consulta IBGE', icon: '⌖' },
];

const menuCadastros = [
  { chave: 'transportadoras', label: 'Transportadoras', icon: '🏢' },
  { chave: 'usuarios', label: 'Gestão de usuários', icon: '👤' },
];

function BotaoMenu({ item, paginaAtual, onMudarPagina }) {
  return (
    <button
      key={item.chave}
      className={paginaAtual === item.chave ? 'nav-item active' : 'nav-item'}
      onClick={() => onMudarPagina(item.chave)}
    >
      <span className="nav-icon">{item.icon}</span>
      <span>{item.label}</span>
    </button>
  );
}

export default function Sidebar({ paginaAtual, onMudarPagina, usuario, onLogout }) {
  const principais = menuPrincipal.filter((item) => usuarioTemAcesso(usuario, item.chave));
  const cadastros = menuCadastros.filter((item) => usuarioTemAcesso(usuario, item.chave));

  return (
    <aside className="sidebar-app">
      <div className="brand-box amd-brand-box">
        <div className="amd-brand-logo-wrap">
          <img src={logoAmd} alt="AMD Log" className="amd-brand-logo" />
        </div>
        <div className="amd-brand-meta">
          <div className="amd-brand-title">AMD Log</div>
          <div className="amd-brand-subtitle">Plataforma de Fretes</div>
        </div>
      </div>

      <div className="sidebar-user-box">
        <strong>{usuario?.nome || 'Usuário'}</strong>
        <span>{nomePerfil(usuario?.perfil)}</span>
      </div>

      <div className="menu-section">
        <div className="menu-section-title">PRINCIPAL</div>
        {principais.map((item) => <BotaoMenu key={item.chave} item={item} paginaAtual={paginaAtual} onMudarPagina={onMudarPagina} />)}
      </div>

      {cadastros.length > 0 && (
        <div className="menu-section">
          <div className="menu-section-title">CADASTROS</div>
          {cadastros.map((item) => <BotaoMenu key={item.chave} item={item} paginaAtual={paginaAtual} onMudarPagina={onMudarPagina} />)}
        </div>
      )}

      <div className="sidebar-footer-note">
        <button type="button" className="logout-button" onClick={onLogout}>Sair do sistema</button>
        <span>Visual AMD Log com foco em leitura e sem invadir o conteúdo.</span>
      </div>
    </aside>
  );
}
