import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { carregarResultadosAuditoriaMes, enriquecerCtesComFaturas } from '../services/auditoriaCteProcessamentoService';

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const COLUNAS = 'id,chave_cte,numero_cte,transportadora,data_emissao,valor_cte,cidade_origem,uf_origem,cidade_destino,uf_destino,canal';
const PAGINA = 200;

const FAIXAS = [
  { id: 'sete', rotulo: '7 a 14 dias', cor: '#b45309', ok: (d) => d >= 7 && d <= 14 },
  { id: 'quinze', rotulo: '15 a 29 dias', cor: '#c2410c', ok: (d) => d >= 15 && d <= 29 },
  { id: 'trinta', rotulo: '30 dias ou mais', cor: '#b91c1c', ok: (d) => d >= 30 },
];

const cartao = (ativo, cor) => ({
  textAlign: 'left', cursor: 'pointer', background: ativo ? cor : '#fff', color: ativo ? '#fff' : '#0f172a',
  border: `2px solid ${ativo ? cor : '#e2e8f0'}`, borderRadius: 12, padding: '10px 14px', minWidth: 150, flex: '1 1 150px',
});

function diasDesde(data) {
  if (!data) return null;
  const base = new Date(`${String(data).slice(0, 10)}T12:00:00`).getTime();
  return Number.isNaN(base) ? null : Math.floor((Date.now() - base) / 86400000);
}

// CT-es emitidos que ainda nao entraram em nenhuma fatura: quem cobra a transportadora e o auditor da carteira.
// Carrega sob demanda (a base de CT-es e grande) e cruza com fatura_detalhes pela chave/numero.
export default function CtesSemFaturaPainel({ escopo, meuNome, meuEmail, mostrarAuditor, onAbrirTransportadora }) {
  const [janelaDias, setJanelaDias] = useState(60);
  const [ctes, setCtes] = useState(null);
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const [faixa, setFaixa] = useState('');
  const [transportadora, setTransportadora] = useState('');
  const [ordem, setOrdem] = useState('qtd');
  const [visiveis, setVisiveis] = useState(PAGINA);
  const [aberto, setAberto] = useState(false);

  const carregar = async () => {
    setErro(''); setCtes(null); setFaixa(''); setTransportadora(''); setVisiveis(PAGINA);
    try {
      const fim = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const inicio = new Date(Date.now() - janelaDias * 86400000).toISOString().slice(0, 10);
      setProgresso('Carregando CT-es emitidos...');
      const base = await carregarResultadosAuditoriaMes({
        dataInicio: inicio, dataFim: fim, colunas: COLUNAS,
        onProgress: ({ carregados }) => setProgresso(`Carregando CT-es emitidos... ${carregados.toLocaleString('pt-BR')}`),
      });
      const enriquecidos = [];
      for (let i = 0; i < base.length; i += 5000) {
        setProgresso(`Cruzando com as faturas... ${Math.min(i + 5000, base.length).toLocaleString('pt-BR')} de ${base.length.toLocaleString('pt-BR')}`);
        enriquecidos.push(...await enriquecerCtesComFaturas(base.slice(i, i + 5000)));
      }
      setCtes(enriquecidos.filter((c) => !c.tem_fatura).map((c) => ({ ...c, dias: diasDesde(c.data_emissao) })).filter((c) => c.dias != null && c.dias >= 7));
      setProgresso('');
    } catch (e) {
      setErro(e.message || String(e));
      setProgresso('');
    }
  };

  const doEscopo = useMemo(() => (ctes || []).filter((c) => {
    if (escopo === 'TODOS') return true;
    if (escopo === 'MINHAS') return (!!meuEmail && norm(c.auditor_email_carteira) === meuEmail) || (!!meuNome && norm(c.auditor_nome_carteira) === meuNome);
    return norm(c.auditor_nome_carteira || 'SEM AUDITOR') === norm(escopo);
  }), [ctes, escopo, meuNome, meuEmail]);

  const porTransportadora = useMemo(() => {
    const mapa = new Map();
    doEscopo.filter((c) => !faixa || FAIXAS.find((f) => f.id === faixa).ok(c.dias)).forEach((c) => {
      const nome = c.transportadora || 'SEM TRANSPORTADORA';
      const r = mapa.get(nome) || { nome, qtd: 0, valor: 0, maisAntigo: 0 };
      r.qtd += 1; r.valor += Number(c.valor_cte || 0); r.maisAntigo = Math.max(r.maisAntigo, c.dias);
      mapa.set(nome, r);
    });
    const chave = { qtd: 'qtd', valor: 'valor', antigo: 'maisAntigo' }[ordem];
    return [...mapa.values()].sort((a, b) => b[chave] - a[chave]);
  }, [doEscopo, faixa, ordem]);

  const lista = useMemo(() => doEscopo
    .filter((c) => !faixa || FAIXAS.find((f) => f.id === faixa).ok(c.dias))
    .filter((c) => !transportadora || (c.transportadora || 'SEM TRANSPORTADORA') === transportadora)
    .sort((a, b) => b.dias - a.dias), [doEscopo, faixa, transportadora]);

  const exportar = () => {
    const linhas = lista.map((c) => ({
      Transportadora: c.transportadora || '', 'Numero CT-e': c.numero_cte || '', 'Chave CT-e': c.chave_cte || '',
      Emissao: dataBr(c.data_emissao), 'Dias sem fatura': c.dias, Origem: `${c.cidade_origem || ''}/${c.uf_origem || ''}`,
      Destino: `${c.cidade_destino || ''}/${c.uf_destino || ''}`, 'Valor CT-e': Number(c.valor_cte || 0), Auditor: c.auditor_nome_carteira || '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'CT-es sem fatura');
    XLSX.writeFile(wb, `ctes_sem_fatura_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const valorLista = lista.reduce((acc, c) => acc + Number(c.valor_cte || 0), 0);

  return (
    <div className="table-card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="panel-title audit-table-title" style={{ margin: 0 }}>
          CT-es sem fatura (emitidos ha 7 dias ou mais){ctes ? ` — ${doEscopo.length.toLocaleString('pt-BR')} CT-e(s)` : ''}
        </div>
        <button type="button" className="btn-secondary" onClick={() => setAberto((v) => !v)}>{aberto ? 'Recolher' : 'Abrir'}</button>
      </div>
      {aberto && (
        <>
          <p style={{ margin: '6px 0 10px', fontSize: 13, color: '#64748b' }}>
            CT-es da base de auditoria que ainda nao aparecem em nenhuma fatura. Use para cobrar a transportadora o envio da fatura.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
            <label className="field" style={{ width: 200 }}>Emitidos nos ultimos
              <select value={janelaDias} onChange={(e) => setJanelaDias(Number(e.target.value))}>
                {[30, 60, 90, 120].map((n) => <option key={n} value={n}>{n} dias</option>)}
              </select>
            </label>
            <button type="button" className="btn-primary" disabled={Boolean(progresso)} onClick={carregar}>{ctes ? 'Recarregar' : 'Carregar CT-es sem fatura'}</button>
            {ctes && <button type="button" className="btn-secondary" onClick={exportar} disabled={!lista.length}>Exportar lista (Excel)</button>}
            {(faixa || transportadora) && <button type="button" className="btn-secondary" onClick={() => { setFaixa(''); setTransportadora(''); setVisiveis(PAGINA); }}>Limpar filtros</button>}
          </div>
          {progresso && <div className="hint-box compact">{progresso}</div>}
          {erro && <div className="hint-box compact error-text">{erro}</div>}
          {ctes && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                {FAIXAS.map((f) => {
                  const qtd = doEscopo.filter((c) => f.ok(c.dias)).length;
                  return (
                    <button key={f.id} type="button" style={cartao(faixa === f.id, f.cor)} onClick={() => { setFaixa(faixa === f.id ? '' : f.id); setVisiveis(PAGINA); }}>
                      <div style={{ fontSize: 12, opacity: 0.85 }}>{f.rotulo} sem fatura</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: faixa === f.id ? '#fff' : f.cor }}>{qtd.toLocaleString('pt-BR')}</div>
                    </button>
                  );
                })}
              </div>

              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Ranking por transportadora (clique para filtrar os CT-es)</div>
              <div className="sim-analise-tabela-wrap" style={{ maxHeight: 280, overflow: 'auto', marginBottom: 12 }}>
                <table className="sim-analise-tabela">
                  <thead>
                    <tr>
                      <th>Transportadora</th>
                      <th><button type="button" className="btn-secondary" style={{ padding: '0 6px', fontWeight: ordem === 'qtd' ? 800 : 400 }} onClick={() => setOrdem('qtd')}>CT-es {ordem === 'qtd' ? '▼' : ''}</button></th>
                      <th><button type="button" className="btn-secondary" style={{ padding: '0 6px', fontWeight: ordem === 'valor' ? 800 : 400 }} onClick={() => setOrdem('valor')}>Valor {ordem === 'valor' ? '▼' : ''}</button></th>
                      <th><button type="button" className="btn-secondary" style={{ padding: '0 6px', fontWeight: ordem === 'antigo' ? 800 : 400 }} onClick={() => setOrdem('antigo')}>CT-e mais antigo {ordem === 'antigo' ? '▼' : ''}</button></th>
                    </tr>
                  </thead>
                  <tbody>
                    {!porTransportadora.length && <tr><td colSpan={4}>Nenhum CT-e sem fatura nesse recorte.</td></tr>}
                    {porTransportadora.map((r) => (
                      <tr key={r.nome} style={transportadora === r.nome ? { background: '#eff6ff' } : undefined}>
                        <td><button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => { setTransportadora(transportadora === r.nome ? '' : r.nome); setVisiveis(PAGINA); }}>{r.nome}</button></td>
                        <td><strong>{r.qtd.toLocaleString('pt-BR')}</strong></td>
                        <td>{dinheiro(r.valor)}</td>
                        <td style={{ color: r.maisAntigo >= 30 ? '#b91c1c' : r.maisAntigo >= 15 ? '#c2410c' : undefined, fontWeight: 700 }}>{r.maisAntigo} dias</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                {lista.length.toLocaleString('pt-BR')} CT-e(s) · {dinheiro(valorLista)}{transportadora ? ` · ${transportadora}` : ''} (mais antigos primeiro)
              </div>
              <div className="sim-analise-tabela-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
                <table className="sim-analise-tabela">
                  <thead><tr><th>CT-e</th><th>Transportadora</th>{mostrarAuditor && <th>Auditor</th>}<th>Emissao</th><th>Sem fatura ha</th><th>Origem → Destino</th><th>Valor CT-e</th></tr></thead>
                  <tbody>
                    {!lista.length && <tr><td colSpan={mostrarAuditor ? 7 : 6}>Nenhum CT-e.</td></tr>}
                    {lista.slice(0, visiveis).map((c) => (
                      <tr key={c.id || c.chave_cte || c.numero_cte}>
                        <td style={{ fontSize: 12 }}>{c.numero_cte || String(c.chave_cte || '').slice(-9)}</td>
                        <td>{onAbrirTransportadora ? <button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => onAbrirTransportadora(c.transportadora)}>{c.transportadora}</button> : c.transportadora}</td>
                        {mostrarAuditor && <td>{c.auditor_nome_carteira || <strong className="error-text">SEM AUDITOR</strong>}</td>}
                        <td>{dataBr(c.data_emissao)}</td>
                        <td><strong style={{ color: c.dias >= 30 ? '#b91c1c' : c.dias >= 15 ? '#c2410c' : '#b45309' }}>{c.dias} dias</strong></td>
                        <td>{c.cidade_origem}/{c.uf_origem} → {c.cidade_destino}/{c.uf_destino}</td>
                        <td>{dinheiro(c.valor_cte)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {lista.length > visiveis && (
                <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={() => setVisiveis((v) => v + PAGINA)}>
                  Mostrar mais ({(lista.length - visiveis).toLocaleString('pt-BR')} restantes — a exportacao leva todos)
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
