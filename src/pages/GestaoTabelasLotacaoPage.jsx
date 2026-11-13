import { useEffect, useState } from 'react';
import LotacaoCotacaoPage from './LotacaoCotacaoPage';
import LotacaoPage from './LotacaoPage';
import GestaoTabelasLotacaoManutencao from '../components/GestaoTabelasLotacaoManutencao';

// Gestao de tabelas lotacao: um lugar so para as tabelas de lotacao.
// - Cotacao / portal: envio da cotacao, propostas, referencias e a REGRA da ANTT.
// - Gestao: incluir tabelas que chegaram fora do portal (mesmo modelo do portal,
//   uma ou varias de uma vez) e editar rota a rota.
// - Tabelas vigentes: tabelas oficiais das transportadoras (o que as ferramentas
//   de operacao, alocacao e auditoria leem), comparativos e reajuste.
// A ANTT e uma so: a regra cadastrada na aba Cotacao vale para tudo.
const ABAS = [
  { id: 'cotacao', label: 'Cotação / portal', permissao: 'lotacao-cotacao' },
  { id: 'gestao', label: 'Gestão (incluir / editar tabelas)', permissao: 'lotacao' },
  { id: 'tabelas', label: 'Tabelas vigentes', permissao: 'lotacao' },
];

export default function GestaoTabelasLotacaoPage({ abaInicial = 'cotacao', podeAcessar = () => true }) {
  const abas = ABAS.filter((aba) => podeAcessar(aba.permissao));
  const [aba, setAba] = useState(abaInicial);
  useEffect(() => { setAba(abaInicial); }, [abaInicial]);
  const atual = abas.some((a) => a.id === aba) ? aba : abas[0]?.id;

  return (
    <div>
      <div style={{ padding: '16px 24px 0' }}>
        <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Central de Fretes · Lotação</div>
        <h1 style={{ margin: '2px 0 4px', fontSize: 24, color: '#06183d' }}>Gestão de tabelas lotação</h1>
        <p style={{ margin: '0 0 12px', color: '#475569', fontSize: 13 }}>
          Entrada única das tabelas de lotação: cotação com os transportadores, tabelas vigentes e a regra da ANTT (uma só para todas as ferramentas).
        </p>
        <div style={{ display: 'flex', gap: 6, borderBottom: '2px solid #dbe3ef' }}>
          {abas.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAba(a.id)}
              style={{
                border: 0,
                borderBottom: atual === a.id ? '3px solid #185FA5' : '3px solid transparent',
                background: 'transparent',
                padding: '8px 14px',
                fontWeight: 700,
                fontSize: 14,
                color: atual === a.id ? '#185FA5' : '#475569',
                cursor: 'pointer',
                marginBottom: -2,
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      {atual === 'cotacao' && <LotacaoCotacaoPage />}
      {atual === 'gestao' && <GestaoTabelasLotacaoManutencao />}
      {atual === 'tabelas' && (
        <LotacaoPage
          onAbrirCotacao={abas.some((a) => a.id === 'cotacao') ? () => setAba('cotacao') : undefined}
          onAbrirGestao={() => setAba('gestao')}
        />
      )}
    </div>
  );
}
