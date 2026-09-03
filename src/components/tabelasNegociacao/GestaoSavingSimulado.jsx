import React, { useMemo, useState } from 'react';
import { calcularSavingSimuladoPorTabela } from '../../utils/savingSimuladoMalha';
import { gestaoStyles } from './GestaoStyles';

const ELEGIVEIS = ['APROVADA_GESTOR', 'PUBLICADA_OFICIAL'];
const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => v ? new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';

export default function GestaoSavingSimulado({ tabelas = [] }) {
  const [resultados, setResultados] = useState({});
  const [carregando, setCarregando] = useState({});
  const [progresso, setProgresso] = useState({});
  const [erros, setErros] = useState({});
  const [abertos, setAbertos] = useState({});
  const [verNaoVencidos, setVerNaoVencidos] = useState({});
  const negociacoes = useMemo(() => tabelas
    .filter((t) => ELEGIVEIS.includes(t.status_gestao) && t.transportadora && t.aprovado_em)
    .filter((t) => !String(t.tipo_negociacao || t.tipo_tabela || '').toUpperCase().includes('LOTACAO'))
    .sort((a, b) => String(b.aprovado_em).localeCompare(String(a.aprovado_em))), [tabelas]);

  async function calcular(tabela) {
    const id = tabela.id;
    setCarregando((p) => ({ ...p, [id]: true })); setErros((p) => ({ ...p, [id]: '' }));
    setProgresso((p) => ({ ...p, [id]: { pct: 5, etapa: 'Buscando CT-es carregados' } }));
    try {
      const resultado = await calcularSavingSimuladoPorTabela(tabela, tabelas, {
        onProgress: ({ pct, etapa }) => setProgresso((p) => ({ ...p, [id]: { pct, etapa } })),
      });
      setResultados((p) => ({ ...p, [id]: resultado }));
      setAbertos((p) => ({ ...p, [id]: true }));
    } catch (e) { setErros((p) => ({ ...p, [id]: e?.message || 'Erro ao calcular saving simulado.' })); }
    finally { setCarregando((p) => ({ ...p, [id]: false })); }
  }

  return <section className="sim-card">
    <h2 style={{ marginTop: 0 }}>Saving simulado</h2>
    <p style={{ color: '#64748b', fontSize: 13 }}>Simula cada CT-e efetivamente carregado contra as tabelas oficiais. O saving é a diferença entre a transportadora vencedora e a melhor alternativa válida.</p>
    <div className="sim-alert info" style={{ marginBottom: 12 }}>Independente do Savings pós-aprovação. O saving é líquido: soma o que a RPA economizou nas rotas que venceu e desconta o que pagou a mais nas que não venceu — pode dar negativo. O detalhe de cada lado fica em "Vitórias" e "Oportunidade perdida".</div>
    <div style={gestaoStyles.tabelaWrap}><table className="sim-table" style={{ minWidth: 1100 }}>
      <thead><tr><th>Transportadora</th><th>Negociação</th><th>Origem</th><th>Canal</th><th>Período</th><th>CT-es</th><th>Vitórias</th><th>Saving simulado</th><th></th></tr></thead>
      <tbody>{negociacoes.map((t) => { const r = resultados[t.id]; const p = progresso[t.id]; return <React.Fragment key={t.id}>
        <tr><td><strong>{t.transportadora}</strong></td><td>{t.descricao || t.nome_negociacao || t.transportadora}</td><td>{t.origem || '—'}</td><td>{t.canal || '—'}</td><td>{r ? `${dataBr(r.janela.inicioAtual)} a ${dataBr(r.janela.fimAtual)}` : dataBr(t.data_referencia_saving || t.aprovado_em)}</td><td>{r ? `${r.simulados}/${r.totalCtes}` : '—'}</td><td>{r ? r.vencedores : '—'}</td><td style={{ color: r && r.saving < 0 ? '#c1121f' : '#087f3f', fontWeight: 800 }}>{r ? moeda(r.saving) : '—'}</td><td><button type="button" className="sim-tab" disabled={carregando[t.id]} onClick={() => r ? setAbertos((x) => ({ ...x, [t.id]: !x[t.id] })) : calcular(t)}>{carregando[t.id] ? 'Calculando…' : r ? (abertos[t.id] ? 'Ocultar' : 'Ver detalhe') : 'Calcular'}</button>{r ? <button type="button" className="sim-tab" style={{ marginLeft: 5 }} onClick={() => calcular(t)}>Recalcular</button> : null}</td></tr>
        {carregando[t.id] ? <tr><td colSpan={9}><progress value={p?.pct || 5} max="100" style={{ width: '100%' }} /><small>{p?.etapa}</small></td></tr> : null}
        {erros[t.id] ? <tr><td colSpan={9} style={{ color: '#c1121f' }}>{erros[t.id]}</td></tr> : null}
        {r && abertos[t.id] ? <tr><td colSpan={9}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}><strong>Vitórias: {r.vencedores}</strong><span>Não venceu: {r.naoVencedores}</span><span>Sem cobertura: {r.semCobertura}</span><span>Sem alternativa: {r.semAlternativa}</span><span>Custo vencedor: {moeda(r.valorVencedor)}</span><span>Melhor alternativa: {moeda(r.valorAlternativa)}</span><span>Pago − tabela: {moeda(r.divergenciaCobrada)}</span><span style={{ color: '#c1121f' }}>Oportunidade perdida (não venceu): {moeda(r.oportunidadePerdida)}</span></div>
          <div style={{ maxHeight: 320, overflow: 'auto' }}><table className="sim-table" style={{ minWidth: 900 }}><thead><tr><th>CT-e</th><th>Destino</th><th>Tabela (RPA)</th><th>2º lugar</th><th>Valor 2º lugar</th><th>Saving</th></tr></thead><tbody>{r.vencedoresDetalhe.slice(0, 500).map((x, i) => <tr key={`${x.cte}-${i}`}><td>{x.cte}</td><td>{x.destino}</td><td>{moeda(x.rpa)}</td><td>{x.segundoNome || '—'}</td><td>{x.segundoValor ? moeda(x.segundoValor) : '—'}</td><td style={{ color: '#087f3f', fontWeight: 700 }}>{moeda(x.saving)}</td></tr>)}</tbody></table></div>
          <div style={{ marginTop: 10 }}>
            <button type="button" className="sim-tab" onClick={() => setVerNaoVencidos((x) => ({ ...x, [t.id]: !x[t.id] }))}>{verNaoVencidos[t.id] ? 'Ocultar não vencidos' : `Ver não vencidos (${r.naoVencedores})`}</button>
          </div>
          {verNaoVencidos[t.id] ? <div style={{ maxHeight: 320, overflow: 'auto', marginTop: 8 }}><table className="sim-table" style={{ minWidth: 900 }}><thead><tr><th>CT-e</th><th>Destino</th><th>Ranking</th><th>Tabela (RPA)</th><th>Vencedor</th><th>Valor vencedor</th><th>Pago</th><th>Oportunidade</th></tr></thead><tbody>{r.naoVencedoresDetalhe.slice(0, 500).map((x, i) => <tr key={`${x.cte}-${i}`}><td>{x.cte}</td><td>{x.destino}</td><td>{x.ranking || '—'}</td><td>{moeda(x.rpa)}</td><td>{x.vencedorNome || '—'}</td><td>{x.vencedorValor ? moeda(x.vencedorValor) : '—'}</td><td>{moeda(x.pago)}</td><td style={{ color: '#c1121f', fontWeight: 700 }}>{moeda(x.oportunidade)}</td></tr>)}</tbody></table></div> : null}
        </td></tr> : null}
      </React.Fragment>; })}</tbody>
    </table></div>
  </section>;
}
