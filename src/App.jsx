import { useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import DashboardPage from './pages/DashboardPage';
import SimuladorPage from './pages/SimuladorPage';
import TransportadorasPage from './pages/TransportadorasPage';
import ImportacaoPage from './pages/ImportacaoPage';
import FormatacaoPage from './pages/FormatacaoPage';
import ImportarTemplatePage from './pages/ImportarTemplatePage';
import ImportacaoIaTabelasPage from './pages/ImportacaoIaTabelasPage';
import LotacaoPage from './pages/LotacaoPage';
import LotacaoOperacaoPage from './pages/LotacaoOperacaoPage';
import LotacaoAuditoriaPage from './pages/LotacaoAuditoriaPage';
import ConsultaIbgePage from './pages/ConsultaIbgePage';
import LoginPage from './pages/LoginPage';
import UserManagementPage from './pages/UserManagementPage';
import PainelUsuariosAtivosPage from './pages/PainelUsuariosAtivosPage';
import MinhaSenhaPage from './pages/MinhaSenhaPage';
import FerramentasPage from './pages/FerramentasPage';
import TrackingPage from './pages/TrackingPage';
import TorreControlePage from './pages/TorreControlePage';
import ReajustesPage from './pages/ReajustesPage';
import AvaliacaoPrazosPage from './pages/AvaliacaoPrazosPage';
import PrazoPagamentoPage from './pages/PrazoPagamentoPage';
import CtePage from './pages/CtePage';
import TabelasNegociacaoPageWithEditor from './pages/TabelasNegociacaoPageWithEditor';
import AuditoriaCtePage from './pages/AuditoriaCtePage';
import CentralAuditoriaFretesPage from './pages/CentralAuditoriaFretesPage';
import TratativasPage from './pages/TratativasPage';
import PainelAuditoriaPage from './pages/PainelAuditoriaPage';
import PainelOperacaoPage from './pages/PainelOperacaoPage';
import PerdaRealizadoPage from './pages/PerdaRealizadoPage';
import OportunidadeOrigemPage from './pages/OportunidadeOrigemPage';
import OportunidadeTransportadoraPage from './pages/OportunidadeTransportadoraPage';
import SimularSaidaTransportadoraPage from './pages/SimularSaidaTransportadoraPage';
import GestaoBaseCtePage from './pages/GestaoBaseCtePage';
import VisualConceptPage from './pages/VisualConceptPage';
import IcmsUfPage from './pages/IcmsUfPage';
import AuditoriaEcommercePage from './pages/AuditoriaEcommercePage';
import { useFreteStore } from './data/store';
import { carregarSessao, MODULOS_SISTEMA, sairLocal, usuarioTemAcesso } from './utils/authLocal';
import { lerEstadoUrlNegociacao, sincronizarPaginaAppNaUrl } from './utils/negociacaoUrlState';
import { entrarPresenca, sairPresenca } from './services/presencaService';
import { sairSupabaseAuth } from './services/biometriaService';

const PAGINAS_PERMITIDAS = [
  'dashboard', 'conceito-app', 'simulador', 'tabelas-negociacao', 'cte', 'auditoria-cte', 'tracking',
  'torre-controle', 'reajustes', 'avaliacao-prazos', 'importacao', 'formatacao', 'importar-template',
  'importacao-ia-tabelas',
  'lotacao', 'lotacao-operacao', 'lotacao-auditoria', 'painel-auditoria', 'painel-operacao',
  'faturas', 'gestao-auditoria-fretes', 'financeiro-auditoria', 'tratativas', 'prazo-pagamento',
  'perda-realizado', 'oportunidade-origem', 'oportunidade-transportadora', 'simular-saida-transportadora', 'gestao-base-cte', 'consulta-ibge', 'ferramentas', 'transportadoras', 'usuarios', 'minha-senha',
  'icms-uf', 'auditoria-ecommerce', 'usuarios-ativos',
];

function primeiraPaginaPermitida(usuario) {
  return PAGINAS_PERMITIDAS.find((pagina) => usuarioTemAcesso(usuario, pagina)) || 'dashboard';
}

export default function App() {
  const [sessao, setSessao] = useState(() => carregarSessao());
  const store = useFreteStore(sessao);
  const [paginaAtual, setPaginaAtual] = useState('dashboard');
  const [sidebarRecolhida, setSidebarRecolhida] = useState(true);
  const [menuMobileAberto, setMenuMobileAberto] = useState(false);
  const [transportadoraSelecionadaId, setTransportadoraSelecionadaId] = useState(null);
  const [origemSelecionadaId, setOrigemSelecionadaId] = useState(null);
  const transportadorasMemo = useMemo(() => store.transportadoras, [store.transportadoras]);

  useEffect(() => {
    if (!sessao) return;
    const paginaUrl = lerEstadoUrlNegociacao().page;
    if (paginaUrl && usuarioTemAcesso(sessao, paginaUrl)) setPaginaAtual(paginaUrl);
  }, [sessao]);

  useEffect(() => {
    if (sessao && !usuarioTemAcesso(sessao, paginaAtual)) setPaginaAtual(primeiraPaginaPermitida(sessao));
  }, [sessao, paginaAtual]);

  useEffect(() => {
    if (!sessao) return undefined;
    const paginaLabel = MODULOS_SISTEMA.find((modulo) => modulo.chave === paginaAtual)?.label || paginaAtual;
    entrarPresenca(sessao, paginaAtual, paginaLabel);
  }, [sessao, paginaAtual]);

  useEffect(() => {
    if (sessao) return undefined;
    sairPresenca();
    return undefined;
  }, [sessao]);

  useEffect(() => () => sairPresenca(), []);

  useEffect(() => {
    if (!sessao?.expiraEm) return undefined;
    const tempoRestante = new Date(sessao.expiraEm).getTime() - Date.now();
    if (!Number.isFinite(tempoRestante) || tempoRestante <= 0) {
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

  if (!sessao) return <LoginPage onLogin={setSessao} />;

  const mudarPagina = (pagina) => {
    if (!usuarioTemAcesso(sessao, pagina)) return;
    setPaginaAtual(pagina);
    setMenuMobileAberto(false);
    sincronizarPaginaAppNaUrl(pagina);
    if (pagina !== 'transportadoras') {
      setTransportadoraSelecionadaId(null);
      setOrigemSelecionadaId(null);
    }
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

  const voltarTransportadoras = () => {
    if (origemSelecionadaId) return setOrigemSelecionadaId(null);
    if (transportadoraSelecionadaId) return setTransportadoraSelecionadaId(null);
    return mudarPagina('dashboard');
  };

  const sair = () => {
    sairPresenca();
    sairLocal();
    void sairSupabaseAuth();
    setSessao(null);
  };

  const paginas = {
    dashboard: <DashboardPage transportadoras={transportadorasMemo} onAbrirSimulador={abrirSimulador} onAbrirTransportadoras={abrirTransportadoras} onAbrirImportacao={abrirImportacao} onAbrirFormatacaoTabelas={() => mudarPagina('formatacao')} onMudarPagina={mudarPagina} onAtualizarBase={store.atualizarResumo} onConferirBase={store.conferirBase} syncStatus={store.syncStatus} />,
    'conceito-app': <VisualConceptPage />,
    simulador: <SimuladorPage transportadoras={transportadorasMemo} onAbrirTransportadoras={abrirTransportadoras} />,
    'tabelas-negociacao': <TabelasNegociacaoPageWithEditor />,
    cte: <CtePage transportadoras={transportadorasMemo} />,
    'auditoria-cte': <AuditoriaCtePage onMudarPagina={mudarPagina} onAbrirTransportadoras={abrirTransportadoras} />,
    importacao: <ImportacaoPage store={store} transportadoras={transportadorasMemo} onAbrirTransportadoras={abrirTransportadoras} />,
    formatacao: <FormatacaoPage store={store} transportadoras={transportadorasMemo} />,
    'importar-template': <ImportarTemplatePage store={store} transportadoras={transportadorasMemo} />,
    'importacao-ia-tabelas': <ImportacaoIaTabelasPage />,
    tracking: <TrackingPage />,
    'auditoria-ecommerce': <AuditoriaEcommercePage />,
    'torre-controle': <TorreControlePage />,
    reajustes: <ReajustesPage transportadoras={transportadorasMemo} />,
    'avaliacao-prazos': <AvaliacaoPrazosPage />,
    'prazo-pagamento': <PrazoPagamentoPage />,
    lotacao: <LotacaoPage />,
    'lotacao-operacao': <LotacaoOperacaoPage onRespostaConcluida={() => mudarPagina('lotacao-auditoria')} />,
    'lotacao-auditoria': <LotacaoAuditoriaPage />,
    'painel-auditoria': <PainelAuditoriaPage />,
    'painel-operacao': <PainelOperacaoPage />,
    faturas: <CentralAuditoriaFretesPage initialTab="faturas" onMudarPagina={mudarPagina} onAbrirTransportadoras={abrirTransportadoras} />,
    'gestao-auditoria-fretes': <CentralAuditoriaFretesPage initialTab="gestao" onMudarPagina={mudarPagina} onAbrirTransportadoras={abrirTransportadoras} />,
    'financeiro-auditoria': <CentralAuditoriaFretesPage initialTab="financeiro" onMudarPagina={mudarPagina} onAbrirTransportadoras={abrirTransportadoras} />,
    tratativas: <TratativasPage />,
    'perda-realizado': <PerdaRealizadoPage />,
    'oportunidade-origem': <OportunidadeOrigemPage />,
    'oportunidade-transportadora': <OportunidadeTransportadoraPage />,
    'simular-saida-transportadora': <SimularSaidaTransportadoraPage />,
    'gestao-base-cte': <GestaoBaseCtePage />,
    'consulta-ibge': <ConsultaIbgePage />,
    'icms-uf': <IcmsUfPage />,
    ferramentas: <FerramentasPage transportadoras={transportadorasMemo} />,
    usuarios: <UserManagementPage usuarioAtual={sessao} />,
    'usuarios-ativos': <PainelUsuariosAtivosPage />,
    'minha-senha': <MinhaSenhaPage usuarioAtual={sessao} onSenhaAlterada={setSessao} />,
    transportadoras: <TransportadorasPage transportadoras={transportadorasMemo} transportadoraSelecionadaId={transportadoraSelecionadaId} origemSelecionadaId={origemSelecionadaId} onOpenTransportadora={abrirTransportadora} onOpenOrigem={setOrigemSelecionadaId} onVoltar={voltarTransportadoras} store={store} sessao={sessao} />,
  };

  const content = paginas[paginaAtual] || (
    <div className="panel-card">
      <div className="panel-title">Sem acesso</div>
      <p>Seu perfil não tem permissão para acessar esta tela.</p>
    </div>
  );

  return (
    <div className={`app-layout ${sidebarRecolhida ? 'sidebar-collapsed' : ''}`}>
      <button
        type="button"
        className="mobile-menu-button"
        onClick={() => setMenuMobileAberto(true)}
        aria-label="Abrir menu"
      >
        <span />
        <span />
        <span />
      </button>
      <Sidebar
        paginaAtual={paginaAtual}
        onMudarPagina={mudarPagina}
        usuario={sessao}
        onLogout={sair}
        recolhida={sidebarRecolhida}
        menuMobileAberto={menuMobileAberto}
        onFecharMobile={() => setMenuMobileAberto(false)}
      />
      <main className="app-content">{content}</main>
    </div>
  );
}
