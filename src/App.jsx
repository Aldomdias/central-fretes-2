import { useEffect, useMemo, useState } from 'react';
import React from 'react';
import Sidebar from './components/Sidebar';

// ─── Error Boundary global ────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { temErro: false, erro: null, stack: null };
  }
  static getDerivedStateFromError(error) {
    return { temErro: true, erro: error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Erro capturado na tela:', this.props.nomePagina, error, info);
    this.setState({ stack: info && info.componentStack ? info.componentStack : null });
  }
  render() {
    if (this.state.temErro) {
      return (
        <div style={{ padding: 32 }}>
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10, padding: 20 }}>
            <strong style={{ color: '#991b1b', fontSize: 16 }}>⚠ Erro nesta tela</strong>
            <p style={{ margin: '8px 0 0', color: '#7f1d1d', fontSize: 13 }}>
              Ocorreu um erro inesperado. Copie a mensagem abaixo e informe ao suporte.
            </p>
            <code style={{ display: 'block', marginTop: 12, background: '#fff1f1', padding: '8px 12px', borderRadius: 6, fontSize: 12, wordBreak: 'break-all' }}>
              {this.state.erro && this.state.erro.message ? this.state.erro.message : String(this.state.erro)}
            </code>
            {this.state.stack && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ fontSize: 12, color: '#6b7280', cursor: 'pointer' }}>Stack trace</summary>
                <pre style={{ fontSize: 11, marginTop: 6, overflow: 'auto', maxHeight: 200, background: '#f9fafb', padding: 8, borderRadius: 4 }}>{this.state.stack}</pre>
              </details>
            )}
            <button
              type="button"
              style={{ marginTop: 14, padding: '7px 16px', borderRadius: 6, background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13 }}
              onClick={() => this.setState({ temErro: false, erro: null, stack: null })}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
// ─────────────────────────────────────────────────────────────────────────────
import DashboardPage from './pages/DashboardPage';
import SimuladorPage from './pages/SimuladorPage';
import TransportadorasPage from './pages/TransportadorasPage';
import ImportacaoPage from './pages/ImportacaoPage';
import FormatacaoPage from './pages/FormatacaoPage';
import ImportarTemplatePage from './pages/ImportarTemplatePage';
import LotacaoPage from './pages/LotacaoPage';
import LotacaoOperacaoPage from './pages/LotacaoOperacaoPage';
import LotacaoAuditoriaPage from './pages/LotacaoAuditoriaPage';
import ConsultaIbgePage from './pages/ConsultaIbgePage';
import LoginPage from './pages/LoginPage';
import UserManagementPage from './pages/UserManagementPage';
import MinhaSenhaPage from './pages/MinhaSenhaPage';
import FerramentasPage from './pages/FerramentasPage';
import TrackingPage from './pages/TrackingPage';
import TorreControlePage from './pages/TorreControlePage';
import ReajustesPage from './pages/ReajustesPage';
import CtePage from './pages/CtePage';
import TabelasNegociacaoPage from './pages/TabelasNegociacaoPage';
import AuditoriaCtePage from './pages/AuditoriaCtePage';
import FaturasPage from './pages/FaturasPage';
import TratativasPage from './pages/TratativasPage';
import PainelAuditoriaPage from './pages/PainelAuditoriaPage';
import PainelOperacaoPage from './pages/PainelOperacaoPage';
import PerdaRealizadoPage from './pages/PerdaRealizadoPage';
import { useFreteStore } from './data/store';
import { carregarSessao, sairLocal, usuarioTemAcesso } from './utils/authLocal';

function primeiraPaginaPermitida(usuario) {
  const candidatas = [
    'dashboard',
    'simulador',
    'tabelas-negociacao',
    'cte',
    'auditoria-cte',
    'tracking',
    'torre-controle',
    'reajustes',
    'importacao',
    'formatacao',
    'importar-template',
    'lotacao',
    'lotacao-operacao',
    'lotacao-auditoria',
    'painel-auditoria',
    'painel-operacao',
    'faturas',
    'tratativas',
    'consulta-ibge',
    'ferramentas',
    'transportadoras',
    'usuarios',
    'minha-senha',
  ];

  return candidatas.find((pagina) => usuarioTemAcesso(usuario, pagina)) || 'dashboard';
}

export default function App() {
  const store = useFreteStore();
  const [sessao, setSessao] = useState(() => carregarSessao());
  const [paginaAtual, setPaginaAtual] = useState('dashboard');
  const [transportadoraSelecionadaId, setTransportadoraSelecionadaId] = useState(null);
  const [origemSelecionadaId, setOrigemSelecionadaId] = useState(null);

  const transportadorasMemo = useMemo(() => store.transportadoras, [store.transportadoras]);

  useEffect(() => {
    if (!sessao) return;
    if (!usuarioTemAcesso(sessao, paginaAtual)) setPaginaAtual(primeiraPaginaPermitida(sessao));
  }, [sessao, paginaAtual]);

  useEffect(() => {
    if (!sessao?.expiraEm) return undefined;

    const expiraEmMs = new Date(sessao.expiraEm).getTime();
    const tempoRestante = expiraEmMs - Date.now();

    if (!Number.isFinite(expiraEmMs) || tempoRestante <= 0) {
      sairLocal();
      setSessao(null);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      sairLocal();
      setSessao(null);
    }, tempoRestante);

    return () => window.clearTimeout(timer);
  }, [sessao?.expiraEm]);

  if (!sessao) {
    return <LoginPage onLogin={setSessao} />;
  }

  const mudarPagina = (pagina) => {
    if (!usuarioTemAcesso(sessao, pagina)) return;

    setPaginaAtual(pagina);

    if (pagina !== 'transportadoras') {
      setTransportadoraSelecionadaId(null);
      setOrigemSelecionadaId(null);
    }
  };

  const sair = () => {
    sairLocal();
    setSessao(null);
  };

  const abrirTransportadoras = () => {
    mudarPagina('transportadoras');
    setTransportadoraSelecionadaId(null);
    setOrigemSelecionadaId(null);
  };

  const abrirSimulador = () => {
    mudarPagina('simulador');
    setTransportadoraSelecionadaId(null);
    setOrigemSelecionadaId(null);
  };

  const abrirImportacao = () => {
    mudarPagina('importacao');
    setTransportadoraSelecionadaId(null);
    setOrigemSelecionadaId(null);
  };

  const abrirTransportadora = (id) => {
    mudarPagina('transportadoras');
    setTransportadoraSelecionadaId(id);
    setOrigemSelecionadaId(null);
  };

  const abrirOrigem = (id) => setOrigemSelecionadaId(id);

  const voltarTransportadoras = () => {
    if (origemSelecionadaId) return setOrigemSelecionadaId(null);
    if (transportadoraSelecionadaId) return setTransportadoraSelecionadaId(null);
    return mudarPagina('dashboard');
  };

  let content = null;

  if (paginaAtual === 'dashboard') {
    content = (
      <DashboardPage
        transportadoras={transportadorasMemo}
        onAbrirSimulador={abrirSimulador}
        onAbrirTransportadoras={abrirTransportadoras}
        onAbrirImportacao={abrirImportacao}
        onAbrirFormatacaoTabelas={() => mudarPagina('formatacao')}
        onAtualizarBase={store.atualizarResumo}
        onConferirBase={store.conferirBase}
        syncStatus={store.syncStatus}
      />
    );
  }

  if (paginaAtual === 'simulador') {
    content = (
      <SimuladorPage
        transportadoras={transportadorasMemo}
        onAbrirTransportadoras={abrirTransportadoras}
      />
    );
  }

  if (paginaAtual === 'tabelas-negociacao') {
    content = <TabelasNegociacaoPage />;
  }

  if (paginaAtual === 'cte') {
    content = <CtePage transportadoras={transportadorasMemo} />;
  }

  if (paginaAtual === 'auditoria-cte') {
    content = <AuditoriaCtePage />;
  }

  if (paginaAtual === 'importacao') {
    content = (
      <ImportacaoPage
        store={store}
        transportadoras={transportadorasMemo}
        onAbrirTransportadoras={abrirTransportadoras}
      />
    );
  }

  if (paginaAtual === 'formatacao') {
    content = <FormatacaoPage store={store} transportadoras={transportadorasMemo} />;
  }

  if (paginaAtual === 'importar-template') {
    content = <ImportarTemplatePage store={store} transportadoras={transportadorasMemo} />;
  }

  if (paginaAtual === 'tracking') {
    content = <TrackingPage />;
  }

  if (paginaAtual === 'torre-controle') {
    content = <TorreControlePage />;
  }

  if (paginaAtual === 'reajustes') {
    content = <ReajustesPage transportadoras={transportadorasMemo} />;
  }

  if (paginaAtual === 'lotacao') {
    content = <LotacaoPage />;
  }

  if (paginaAtual === 'lotacao-operacao') {
    content = <LotacaoOperacaoPage />;
  }

  if (paginaAtual === 'lotacao-auditoria') {
    content = <LotacaoAuditoriaPage />;
  }

  if (paginaAtual === 'painel-auditoria') {
    content = <PainelAuditoriaPage />;
  }

  if (paginaAtual === 'painel-operacao') {
    content = <PainelOperacaoPage />;
  }

  if (paginaAtual === 'faturas') {
    content = <FaturasPage />;
  }

  if (paginaAtual === 'tratativas') {
    content = <TratativasPage />;
  } else if (paginaAtual === 'perda-realizado') {
    content = <PerdaRealizadoPage />;
  }

  if (paginaAtual === 'consulta-ibge') {
    content = <ConsultaIbgePage />;
  }

  if (paginaAtual === 'ferramentas') {
    content = <FerramentasPage transportadoras={transportadorasMemo} />;
  }

  if (paginaAtual === 'usuarios') {
    content = <UserManagementPage usuarioAtual={sessao} />;
  }

  if (paginaAtual === 'minha-senha') {
    content = <MinhaSenhaPage usuarioAtual={sessao} onSenhaAlterada={setSessao} />;
  }

  if (paginaAtual === 'transportadoras') {
    content = (
      <TransportadorasPage
        transportadoras={transportadorasMemo}
        transportadoraSelecionadaId={transportadoraSelecionadaId}
        origemSelecionadaId={origemSelecionadaId}
        onOpenTransportadora={abrirTransportadora}
        onOpenOrigem={abrirOrigem}
        onVoltar={voltarTransportadoras}
        store={store}
      />
    );
  }

  if (!content) {
    content = (
      <div className="panel-card">
        <div className="panel-title">Sem acesso</div>
        <p>Seu perfil não tem permissão para acessar esta tela.</p>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar
        paginaAtual={paginaAtual}
        onMudarPagina={mudarPagina}
        usuario={sessao}
        onLogout={sair}
      />
      <main className="app-content">
        <ErrorBoundary nomePagina={paginaAtual} key={paginaAtual}>
          {content}
        </ErrorBoundary>
      </main>
    </div>
  );
}
