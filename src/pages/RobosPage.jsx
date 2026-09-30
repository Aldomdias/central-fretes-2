import { useState } from 'react';
import ReprocessarCteRobo from './robos/ReprocessarCteRobo';
import LancamentoNfseRobo from './robos/LancamentoNfseRobo';
import LancamentoCteRobo from './robos/LancamentoCteRobo';

const ROBOS = [
  { chave: 'reprocessar-cte', titulo: 'Reprocessar CT-e', descricao: 'Exporta os CT-e com erro de saldo do SAP e reprocessa em lotes. Substitui a planilha “Reprocessar Cte”.', componente: ReprocessarCteRobo },
  { chave: 'lancamento-nfse', titulo: 'Lançamento NFS-e', descricao: 'Cria o pedido (ME21N) e a MIRO das notas de serviço das transportadoras. Substitui a planilha “Lançamento NFS-e”.', componente: LancamentoNfseRobo },
  { chave: 'lancamento-cte', titulo: 'Lançamento CT-e', descricao: 'Lê os XMLs dos CT-e, acha o centro de custo no SAP e cria o pedido (ME21N) e a MIRO. Substitui a planilha “Lançamento CT-e”.', componente: LancamentoCteRobo },
];

export default function RobosPage() {
  const [ativo, setAtivo] = useState(ROBOS[0].chave);
  const robo = ROBOS.find((r) => r.chave === ativo) || ROBOS[0];
  const Componente = robo.componente;

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <h1>Automação</h1>
          <p>Robôs que substituem planilhas e rotinas manuais. Cada robô prepara os dados aqui e gera o script que roda no seu computador.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {ROBOS.map((r) => (
          <button key={r.chave} type="button" onClick={() => setAtivo(r.chave)} className={r.chave === ativo ? 'btn-primary' : 'btn-secondary'} title={r.descricao}>{r.titulo}</button>
        ))}
        <button type="button" className="btn-secondary" disabled title="Novos robôs entram aqui">+ Novo robô (em breve)</button>
      </div>

      <p style={{ margin: '0 0 12px', color: '#475569' }}>{robo.descricao}</p>
      <Componente />
    </div>
  );
}
