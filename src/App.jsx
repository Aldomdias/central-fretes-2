import { useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import DashboardPage from './pages/DashboardPage';
import SimuladorPage from './pages/SimuladorPage';
import TransportadorasPage from './pages/TransportadorasPage';
import ImportacaoPage from './pages/ImportacaoPage';
import { useFreteStore } from './data/store';

export default function App() {
  const store = useFreteStore();
  const [paginaAtual, setPaginaAtual] = useState('dashboard');
  const [transportadoraSelecionadaId, setTransportadoraSelecionadaId] = useState(null);
  const [origemSelecionadaId, setOrigemSelecionadaId] = useState(null);

  const transportadorasMemo = useMemo(() => store.transportadoras, [store.transportadoras]);

  const abrirTransportadoras = () => {
    setPaginaAtual('transportadoras');
    setTransportadoraSelecionadaId(null);
    setOrigemSelecionadaId(null);
  };

  const abrirSimulador = () => {
    setPaginaAtual('simulador');
    setTransportadoraSelecionadaId(null);
    setOrigemSelecionadaId(null);
  };

  const abrirImportacao = () => {
    setPaginaAtual('importacao');
    setTransportadoraSelecionadaId(null);
    setOrigemSelecionadaId(null);
  };

  const abrirTransportadora = (id) => {
    setPaginaAtual('transportadoras');
    setTransportadoraSelecionadaId(id);
    setOrigemSelecionadaId(null);
  };

  const abrirOrigem = (id) => setOrigemSelecionadaId(id);

  const voltarTransportadoras = () => {
    if (origemSelecionadaId) return setOrigemSelecionadaId(null);
    if (transportadoraSelecionadaId) return setTransportadoraSelecionadaId(null);
    setPaginaAtual('dashboard');
  };

  let content = null;
  if (paginaAtual === 'dashboard') {
    content = (
      <DashboardPage
        transportadoras={transportadorasMemo}
        onAbrirSimulador={abrirSimulador}
        onAbrirTransportadoras={abrirTransportadoras}
        onAbrirImportacao={abrirImportacao}
        onResetarBase={store.resetarBase}
        syncStatus={store.syncStatus}
        onSincronizarAgora={store.sincronizarAgora}
      />
    );
  }

  if (paginaAtual === 'simulador') {
    content = <SimuladorPage transportadoras={transportadorasMemo} onAbrirTransportadoras={abrirTransportadoras} />;
  }

  if (paginaAtual === 'importacao') {
    content = <ImportacaoPage store={store} transportadoras={transportadorasMemo} onAbrirTransportadoras={abrirTransportadoras} />;
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

  return (
    <div className="app-layout">
      <Sidebar paginaAtual={paginaAtual} onMudarPagina={(pagina) => {
        setPaginaAtual(pagina);
        if (pagina !== 'transportadoras') {
          setTransportadoraSelecionadaId(null);
          setOrigemSelecionadaId(null);
        }
      }} />
      <main className="app-content">{content}</main>
    </div>
  );
}
