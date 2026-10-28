import { useEffect, useState } from 'react';
import { listarLancamentosComFatura } from '../services/robosLancamentosService';
import { lancamentoDaFatura, normalizarNumeroFatura, resumirLancamentosFatura, etapaLancamento } from '../utils/robos/historicoLancamentos';

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');

export const ROTULO_ETAPA_LANCAMENTO = {
  pedido: { texto: 'So pedido (sem MIRO)', cor: '#b45309' },
  miro: { texto: 'MIRO lancada', cor: '#0369a1' },
  partida: { texto: 'Partida contabil', cor: '#7c3aed' },
  pago: { texto: 'Paga', cor: '#14733b' },
};

// Notas lancadas pelos robos (NFS-e / CT-e) com o numero desta fatura: quando a fatura e de
// nota fiscal de servico nao ha CT-e para auditar, entao mostra o que ja foi lancado no SAP.
export default function LancamentosRoboFatura({ fatura }) {
  const [registros, setRegistros] = useState(null);

  useEffect(() => {
    let vivo = true;
    const bruto = String(fatura?.numero_fatura || '').trim();
    if (!bruto) { setRegistros([]); return undefined; }
    const numeros = [...new Set([bruto, normalizarNumeroFatura(bruto)])].filter(Boolean);
    setRegistros(null);
    listarLancamentosComFatura({ numeros })
      .then(({ registros: lista }) => { if (vivo) setRegistros(lista.filter((r) => lancamentoDaFatura(r, fatura))); })
      .catch(() => { if (vivo) setRegistros([]); });
    return () => { vivo = false; };
  }, [fatura?.id, fatura?.numero_fatura, fatura?.cnpj_transportadora, fatura?.transportadora]);

  if (!registros || !registros.length) return null;
  const resumo = resumirLancamentosFatura(registros);
  const etapa = ROTULO_ETAPA_LANCAMENTO[resumo.etapa];
  const nfse = resumo.registros.filter((r) => r.tipo === 'NFSE').length;
  const diferenca = Math.round(((Number(fatura.valor_fatura) || 0) - resumo.valor) * 100) / 100;

  return (
    <div className="hint-box compact" style={{ marginBottom: 10, borderColor: '#c4b5fd', background: '#faf5ff', color: '#3b0764' }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <strong>🤖 Lancada pelo robo: {resumo.total} nota(s){nfse ? ` (${nfse} NFS-e)` : ''} · {dinheiro(resumo.valor)}</strong>
        <span style={{ fontWeight: 700, color: etapa.cor }}>{etapa.texto}</span>
        <span style={{ fontSize: 12 }}>
          {resumo.etapas.pago} paga(s) · {resumo.etapas.partida} com partida · {resumo.etapas.miro} so MIRO · {resumo.etapas.pedido} so pedido
        </span>
        {Math.abs(diferenca) >= 0.01 && (
          <span style={{ fontSize: 12, color: '#b45309' }}>Diferenca para o valor da fatura: {dinheiro(diferenca)}</span>
        )}
      </div>
      <div className="sim-analise-tabela-wrap" style={{ marginTop: 6, maxHeight: 240, overflowY: 'auto' }}>
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Tipo</th><th>Nota</th><th>Valor</th><th>Emissao</th><th>Vencimento</th><th>Pedido</th><th>MIRO</th>
              <th>Partida (lanc. contabil)</th><th>Pagamento</th><th>Lancada em</th>
            </tr>
          </thead>
          <tbody>
            {resumo.registros.map((r) => {
              const et = ROTULO_ETAPA_LANCAMENTO[etapaLancamento(r)];
              return (
                <tr key={r.id || `${r.tipo}|${r.miro}|${r.documento}`}>
                  <td>{r.tipo === 'NFSE' ? 'NFS-e' : 'CT-e'}</td>
                  <td>{r.documento}</td>
                  <td>{dinheiro(r.valor)}</td>
                  <td>{dataBr(r.data_emissao)}</td>
                  <td>{dataBr(r.vencimento_liquido || r.vencimento)}</td>
                  <td>{r.pedido || '-'}</td>
                  <td>{r.miro || '-'}</td>
                  <td>{r.lancamento_contabil || '-'}</td>
                  <td style={{ color: et.cor, fontWeight: 700 }}>
                    {r.situacao_pagamento === 'pago' ? `Paga${r.data_compensacao ? ` ${dataBr(r.data_compensacao)}` : ''}` : r.lancamento_contabil ? 'Em aberto' : '-'}
                  </td>
                  <td>{dataBr(r.lancado_em)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
