import { useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import DashboardPage from './pages/DashboardPage';
import SimuladorPage from './pages/SimuladorPage';
import TransportadorasPage from './pages/TransportadorasPage';
import ImportacaoPage from './pages/ImportacaoPage';
import FormatacaoPage from './pages/FormatacaoPage';
import ImportarTemplatePage from './pages/ImportarTemplatePage';
import RealizadoPage from './pages/RealizadoPage';
import RealizadoLocalPage from './pages/RealizadoLocalPage';
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
import { useFreteStore } from './data/store';
import { carregarSessao, sairLocal, usuarioTemAcesso } from './utils/authLocal';

function primeiraPaginaPermitida(usuario) {
  const candidatas = ['dashboard', 'simulador', 'realizado-local', 'tracking', 'torre-controle', 'reajustes', 'realizado', 'importacao', 'formatacao', 'importar-template', 'lotacao', 'lotacao-operacao', 'lotacao-auditoria', 'consulta-ibge', 'ferramentas', 'transportadoras', 'usuarios', 'minha-senha'];
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
    mudarPagina('dashboard');
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
    content = <SimuladorPage transportadoras={transportadorasMemo} onAbrirTransportadoras={abrirTransportadoras} />;
  }

  if (paginaAtual === 'importacao') {
    content = <ImportacaoPage store={store} transportadoras={transportadorasMemo} onAbrirTransportadoras={abrirTransportadoras} />;
  }

  if (paginaAtual === 'formatacao') {
    content = <FormatacaoPage store={store} transportadoras={transportadorasMemo} />;
  }

  if (paginaAtual === 'importar-template') {
    content = <ImportarTemplatePage store={store} transportadoras={transportadorasMemo} />;
  }

  if (paginaAtual === 'realizado') {
    content = <RealizadoPage transportadoras={transportadorasMemo} />;
  }

  if (paginaAtual === 'realizado-local') {
    content = <RealizadoLocalPage transportadoras={transportadorasMemo} />;
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

  if (paginaAtual === 'consulta-ibge') {
    content = <ConsultaIbgePage />;
  }

  if (paginaAtual === 'ferramentas') {
    content = <FerramentasPage />;
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
      <main className="app-content">{content}</main>
    </div>
  );
}
