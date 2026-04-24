import { useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import DashboardPage from './pages/DashboardPage';
import SimuladorPage from './pages/SimuladorPage';
import TransportadorasPage from './pages/TransportadorasPage';
import ImportacaoPage from './pages/ImportacaoPage';
import FormatacaoPage from './pages/FormatacaoPage';
import { useFreteStore } from './data/store';

export default function App() {
  const store = useFreteStore();
  const [paginaAtual, setPaginaAtual] = useState('dashboard');
  const [transportadoraSelecionadaId, setTransportadoraSelecionadaId] = useState(null);
  const [origemSelecionadaId, setOrigemSelecionadaId] = useState(null);

  const transportadorasMemo = useMemo(() => store.transportadoras, [store.transportadoras]);

  let content = null;
  if (paginaAtual === 'dashboard') {
    content = (
      <DashboardPage
        transportadoras={transportadorasMemo}
        onAbrirSimulador={() => setPaginaAtual('simulador')}
        onAbrirTransportadoras={() => setPaginaAtual('transportadoras')}
        onAbrirImportacao={() => setPaginaAtual('importacao')}
        onResetarBase={store.resetarBase}
        syncStatus={store.syncStatus}
        onAtualizarBase={store.carregarDoBanco}
        onSincronizarAgora={store.sincronizarAgora}
      />
    );
  }
  if (paginaAtual === 'simulador') content = <SimuladorPage transportadoras={transportadorasMemo} onAbrirTransportadoras={() => setPaginaAtual('transportadoras')} />;
  if (paginaAtual === 'importacao') content = <ImportacaoPage store={store} transportadoras={transportadorasMemo} onAbrirTransportadoras={() => setPaginaAtual('transportadoras')} />;
  if (paginaAtual === 'formatacao') content = <FormatacaoPage store={store} transportadoras={transportadorasMemo} />;
  if (paginaAtual === 'transportadoras') {
    content = (
      <TransportadorasPage
        transportadoras={transportadorasMemo}
        transportadoraSelecionadaId={transportadoraSelecionadaId}
        origemSelecionadaId={origemSelecionadaId}
        onOpenTransportadora={setTransportadoraSelecionadaId}
        onOpenOrigem={setOrigemSelecionadaId}
        onVoltar={() => setPaginaAtual('dashboard')}
        store={store}
      />
    );
  }

  return (
    <div className="app-layout">
      <Sidebar paginaAtual={paginaAtual} onMudarPagina={setPaginaAtual} />
      <main className="app-content">{content}</main>
    </div>
  );
}
