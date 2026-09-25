import { analisarFrete, formatarPct } from '../services/transporteAutorizacoesService';

const dinheiro = (valor) => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Analise por CT-e pra quem vai decidir: valor da NF, frete atual (AMD) e % da NF,
// adicional cobrado e quanto o frete vira com ele (valor e % da NF).
// itens: { chave_cte, valor_nf, valor_calculado, valor_divergente, valor_cte }
export default function AnaliseFreteTabela({ itens = [] }) {
  const linhas = itens.map((item) => ({ item, ...analisarFrete(item) }));
  const total = linhas.reduce((acc, l) => ({
    nf: acc.nf + l.valorNf, atual: acc.atual + l.freteAtual, adicional: acc.adicional + l.adicional, comAdicional: acc.comAdicional + l.freteComAdicional,
  }), { nf: 0, atual: 0, adicional: 0, comAdicional: 0 });
  const pctTotal = (valor) => (total.nf > 0 ? formatarPct((valor / total.nf) * 100) : '-');
  return (
    <div className="sim-analise-tabela-wrap" style={{ maxHeight: 260, overflow: 'auto' }}>
      <table className="sim-analise-tabela">
        <thead>
          <tr><th>CT-e</th><th>Valor NF</th><th>Frete atual (AMD)</th><th>% da NF</th><th>Adicional</th><th>Frete com adicional</th><th>% da NF</th></tr>
        </thead>
        <tbody>
          {linhas.map(({ item, valorNf, freteAtual, adicional, freteComAdicional, pctAtual, pctComAdicional }, indice) => (
            <tr key={item.id || item.chave_cte || indice}>
              <td style={{ fontSize: 11 }}>{item.numero_cte || String(item.chave_cte || '').slice(-9) || '-'}</td>
              <td>{valorNf > 0 ? dinheiro(valorNf) : '-'}</td>
              <td>{dinheiro(freteAtual)}</td>
              <td>{formatarPct(pctAtual)}</td>
              <td><strong style={{ color: '#9b1111' }}>{dinheiro(adicional)}</strong></td>
              <td>{dinheiro(freteComAdicional)}</td>
              <td><strong>{formatarPct(pctComAdicional)}</strong></td>
            </tr>
          ))}
        </tbody>
        {linhas.length > 1 && (
          <tfoot>
            <tr>
              <td><strong>Total</strong></td>
              <td><strong>{dinheiro(total.nf)}</strong></td>
              <td><strong>{dinheiro(total.atual)}</strong></td>
              <td><strong>{pctTotal(total.atual)}</strong></td>
              <td><strong style={{ color: '#9b1111' }}>{dinheiro(total.adicional)}</strong></td>
              <td><strong>{dinheiro(total.comAdicional)}</strong></td>
              <td><strong>{pctTotal(total.comAdicional)}</strong></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
