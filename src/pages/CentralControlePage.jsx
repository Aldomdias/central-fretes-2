import { useEffect, useState } from 'react';
import ProdutividadeDiaFaturas from '../components/ProdutividadeDiaFaturas';
import EvolucaoProdutividade from '../components/EvolucaoProdutividade';
import EnviosErpPainel from '../components/EnviosErpPainel';
import PainelDescontosObtidosPage from './PainelDescontosObtidosPage';
import { carregarFaturasParaControle } from '../services/auditoriaFretesService';

const ABAS = [
  ['descontos', 'Descontos obtidos'],
  ['produtividade', 'Produtividade Auditoria'],
];

function ProdutividadeAuditoria() {
  const [state, setState] = useState({ faturas: [] });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      setState({ faturas: await carregarFaturasParaControle() });
    } catch (error) {
      setErro(error.message || String(error));
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  if (carregando) return <div className="hint-box compact">Carregando faturas...</div>;
  if (erro) {
    return (
      <div className="sim-alert error">
        {erro} <button type="button" className="btn-secondary" onClick={carregar}>Tentar de novo</button>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <ProdutividadeDiaFaturas />
      <EvolucaoProdutividade />
      <EnviosErpPainel state={state} onState={setState} />
    </div>
  );
}

export default function CentralControlePage() {
  const [aba, setAba] = useState('descontos');
  return (
    <div className="page-stack">
      <div className="tabs-row audit-main-tabs">
        {ABAS.map(([id, label]) => (
          <button key={id} type="button" className={`toggle-btn ${aba === id ? 'active' : ''}`} onClick={() => setAba(id)}>{label}</button>
        ))}
      </div>
      {aba === 'produtividade' ? <ProdutividadeAuditoria /> : <PainelDescontosObtidosPage />}
    </div>
  );
}
