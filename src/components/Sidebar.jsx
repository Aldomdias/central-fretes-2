import { usuarioTemAcesso, nomePerfil } from '../utils/authLocal';

const ICONS = {
  dashboard: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />,
  simulador: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />,
  'cte': <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  'realizado-local': <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  tracking: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />,
  'torre-controle': <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
  reajustes: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />,
  realizado: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  importacao: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />,
  formatacao: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />,
  'importar-template': <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />,
  lotacao: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18" />,
  'lotacao-operacao': <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />,
  'lotacao-auditoria': <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />,
  'consulta-ibge': <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />,
  ferramentas: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />,
  transportadoras: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />,
  usuarios: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />,
  'minha-senha': <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />,
};

const menuPrincipal = [
  { chave: 'dashboard', label: 'Dashboard' },
  { chave: 'simulador', label: 'Simulador' },
  { chave: 'cte', label: 'CT-e' },
  { chave: 'tracking', label: 'Tracking' },
  { chave: 'torre-controle', label: 'Torre de Controle' },
  { chave: 'reajustes', label: 'Reajustes' },
  { chave: 'importacao', label: 'Importação' },
  { chave: 'formatacao', label: 'Formatação de Tabelas' },
  { chave: 'importar-template', label: 'Importar Template' },
  { chave: 'lotacao', label: 'Lotação Tabelas' },
  { chave: 'lotacao-operacao', label: 'Lotação Operação' },
  { chave: 'lotacao-auditoria', label: 'Auditoria Lotação' },
  { chave: 'consulta-ibge', label: 'Consulta IBGE' },
  { chave: 'ferramentas', label: 'Ferramentas' },
];

const menuCadastros = [
  { chave: 'transportadoras', label: 'Transportadoras' },
  { chave: 'usuarios', label: 'Gestão de Usuários' },
];

const menuConta = [
  { chave: 'minha-senha', label: 'Alterar Senha' },
];

function Icon({ chave }) {
  return (
    <svg style={{ width: 16, height: 16, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {ICONS[chave] || <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
    </svg>
  );
}

function BotaoMenu({ item, paginaAtual, onMudarPagina }) {
  const ativo = paginaAtual === item.chave;
  return (
    <button
      onClick={() => onMudarPagina(item.chave)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '9px 12px',
        borderRadius: 8,
        marginBottom: 2,
        border: 'none',
        background: ativo ? 'rgba(255,255,255,0.10)' : 'transparent',
        color: ativo ? '#ffffff' : 'rgba(255,255,255,0.50)',
        fontSize: 13,
        fontWeight: 500,
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={e => { if (!ativo) { e.currentTarget.style.color = '#ffffff'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; } }}
      onMouseLeave={e => { if (!ativo) { e.currentTarget.style.color = 'rgba(255,255,255,0.50)'; e.currentTarget.style.background = 'transparent'; } }}
    >
      <Icon chave={item.chave} />
      <span>{item.label}</span>
    </button>
  );
}

function SecaoLabel({ texto }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.08em',
      color: 'rgba(255,255,255,0.25)',
      padding: '4px 12px 6px',
      marginTop: 16,
    }}>
      {texto}
    </div>
  );
}

export default function Sidebar({ paginaAtual, onMudarPagina, usuario, onLogout }) {
  const principais = menuPrincipal.filter(i => usuarioTemAcesso(usuario, i.chave));
  const cadastros  = menuCadastros.filter(i => usuarioTemAcesso(usuario, i.chave));
  const conta      = menuConta.filter(i => usuarioTemAcesso(usuario, i.chave));
  const inicial    = (usuario?.nome || 'A')[0].toUpperCase();

  return (
    <aside style={{
      position: 'fixed',
      left: 0, top: 0,
      height: '100vh',
      width: 224,
      display: 'flex',
      flexDirection: 'column',
      background: '#0F2347',
      zIndex: 30,
    }}>

      {/* Logo */}
      <div style={{ padding: '20px 20px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: '#CC2020', borderRadius: 8, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M1 11.5V17H3.5V19H7.5V17H16.5V19H20.5V17H23V11.5L20 4H4L1 11.5Z" fill="white"/>
              <circle cx="6.5" cy="18" r="1.8" fill="#CC2020"/>
              <circle cx="17.5" cy="18" r="1.8" fill="#CC2020"/>
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, lineHeight: 1, color: '#fff' }}>
              AMD<span style={{ color: '#CC2020' }}>LOG</span>
            </div>
            <div style={{ fontSize: 11, marginTop: 2, color: 'rgba(255,255,255,0.35)' }}>Central de Fretes</div>
          </div>
        </div>
      </div>

      {/* Menu */}
      <nav style={{ flex: 1, padding: '12px 12px', overflowY: 'auto' }}>
        <SecaoLabel texto="OPERAÇÃO" />
        {principais.map(item => (
          <BotaoMenu key={item.chave} item={item} paginaAtual={paginaAtual} onMudarPagina={onMudarPagina} />
        ))}

        {cadastros.length > 0 && (
          <>
            <SecaoLabel texto="CADASTROS" />
            {cadastros.map(item => (
              <BotaoMenu key={item.chave} item={item} paginaAtual={paginaAtual} onMudarPagina={onMudarPagina} />
            ))}
          </>
        )}

        {conta.length > 0 && (
          <>
            <SecaoLabel texto="CONTA" />
            {conta.map(item => (
              <BotaoMenu key={item.chave} item={item} paginaAtual={paginaAtual} onMudarPagina={onMudarPagina} />
            ))}
          </>
        )}
      </nav>

      {/* Usuário + logout */}
      <div style={{ padding: '14px 16px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: '#CC2020',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0,
          }}>
            {inicial}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {usuario?.nome || 'Usuário'}
            </div>
            <button
              onClick={onLogout}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, color: 'rgba(255,255,255,0.35)', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.color = '#ff8080'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.35)'}
            >
              Sair do sistema
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
