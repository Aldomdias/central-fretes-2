const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');

// Aviso bem visivel de por que o OMS bloqueou o envio e o que o auditor deve fazer.
// itens: [{ numero, explicacoes: [{ codigo, titulo, explicacao, acao }], duplicadas?: [{ numero_fatura, status, transportadora, valor_fatura, data_pagamento, ctes }] }]
export default function AlertaBloqueioOms({ itens = [], onFechar }) {
  if (!itens.length) return null;
  return (
    <div role="alert" style={{ marginTop: 10, padding: '12px 14px', border: '2px solid #b91c1c', borderRadius: 10, background: '#fef2f2', color: '#7f1d1d' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong style={{ fontSize: 15 }}>⛔ O OMS bloqueou {itens.length === 1 ? 'esta fatura' : `${itens.length} faturas`} — não foi enviada ao SAP</strong>
        {onFechar && <button type="button" className="btn-secondary audit-small-button" onClick={onFechar}>Fechar aviso</button>}
      </div>
      {itens.map((item) => (
        <div key={item.numero} style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed #fca5a5' }}>
          <div style={{ fontWeight: 700 }}>Fatura {item.numero}</div>
          {(item.explicacoes || []).map((x) => (
            <div key={x.codigo} style={{ marginTop: 4 }}>
              <div><strong>{x.titulo}</strong> <span style={{ opacity: 0.7 }}>({x.codigo})</span></div>
              <div>{x.explicacao}</div>
              {(x.codigo === 'CTE_ALREADY_BILLED') && (
                <div style={{ margin: '4px 0', padding: '6px 8px', background: '#fff', borderRadius: 6, border: '1px solid #fca5a5' }}>
                  {(item.duplicadas || []).length
                    ? (item.duplicadas || []).map((d) => (
                      <div key={d.id || d.numero_fatura}>
                        CT-e {d.ctes?.join(', ')} também está na fatura <strong>{d.numero_fatura}</strong> ({d.transportadora || '-'}, {dinheiro(d.valor_fatura)}) — situação: <strong>{String(d.status || '').replaceAll('_', ' ')}</strong>{d.data_pagamento ? `, paga em ${dataBr(d.data_pagamento)}` : ''}.
                      </div>
                    ))
                    : <div>Não achei a outra fatura na base do AMD: o CT-e pode ter sido cobrado em uma fatura de fora do AMD. Veja no OMS.</div>}
                </div>
              )}
              <div style={{ background: '#7f1d1d', color: '#fff', borderRadius: 6, padding: '6px 10px', marginTop: 4 }}><strong>O que fazer:</strong> {x.acao}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
