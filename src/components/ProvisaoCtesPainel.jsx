import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { carregarCtesCompetencia, carregarFaturasLancadasDosCtes, carregarLancamentosPorCnpj } from '../services/lancamentosCteSapService';
import { classificarProvisao, resumirProvisao, serieDaChave, SITUACOES_PROVISAO } from '../utils/lancamentosCteSap';

// Numero do CT-e com a serie (da chave de acesso), ex.: 18484198-30.
const numeroSerie = (c) => { const serie = serieDaChave(c.chave_cte); return serie ? `${c.numero_cte}-${serie}` : String(c.numero_cte || ''); };

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const num = (v) => Number(v || 0).toLocaleString('pt-BR');
const PAGINA = 200;

const CORES = { NO_MES: '#15803d', FATURA: '#0f766e', APOS_MES: '#c2410c', FATURA_APOS: '#b45309', NAO_LANCADO: '#b91c1c' };

function competenciaAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const cartao = (ativo, cor) => ({
  minWidth: 170, padding: '10px 14px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
  border: `1px solid ${ativo ? cor : '#e2e8f0'}`, background: ativo ? cor : '#fff', color: ativo ? '#fff' : '#0f172a',
});

export default function ProvisaoCtesPainel() {
  const [aberto, setAberto] = useState(true);
  const [competencia, setCompetencia] = useState(competenciaAnterior());
  const [itens, setItens] = useState(null);
  const [calculadaPara, setCalculadaPara] = useState('');
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState('PROVISAO');
  const [transportadora, setTransportadora] = useState('');
  const [visiveis, setVisiveis] = useState(PAGINA);

  const calcular = async () => {
    if (!/^\d{4}-\d{2}$/.test(competencia)) return;
    setErro('');
    setItens(null);
    try {
      const ctes = await carregarCtesCompetencia(competencia, setProgresso);
      const lancamentos = await carregarLancamentosPorCnpj(ctes.map((c) => c.cnpj_transportadora), competencia, setProgresso);
      const parcial = classificarProvisao(ctes, lancamentos, new Map(), competencia);
      const semLancamento = parcial.filter((c) => c.situacao === 'NAO_LANCADO').map((c) => c.chave_cte);
      const faturas = await carregarFaturasLancadasDosCtes(semLancamento, setProgresso);
      setItens(classificarProvisao(ctes, lancamentos, faturas, competencia));
      setCalculadaPara(competencia);
      setTransportadora('');
      setVisiveis(PAGINA);
    } catch (error) {
      setErro(error.message || String(error));
    } finally {
      setProgresso('');
    }
  };

  const resumo = useMemo(() => (itens ? resumirProvisao(itens) : null), [itens]);

  const lista = useMemo(() => {
    if (!itens) return [];
    return itens
      .filter((c) => (filtro === 'PROVISAO' ? c.provisao : filtro === 'TODOS' ? true : c.situacao === filtro))
      .filter((c) => !transportadora || (c.transportadora || '(sem nome)') === transportadora)
      .sort((a, b) => String(a.data_emissao).localeCompare(String(b.data_emissao)));
  }, [itens, filtro, transportadora]);

  const exportar = () => {
    if (!itens || !resumo) return;
    const wb = XLSX.utils.book_new();
    const linhasResumo = resumo.porTransportadora.map((t) => ({
      Transportadora: t.nome,
      'CT-es emitidos': t.geral.qtd, 'Valor emitido': Number(t.geral.valor.toFixed(2)),
      ...Object.fromEntries(Object.entries(SITUACOES_PROVISAO).flatMap(([k, rot]) => [[`${rot} (qtd)`, t[k].qtd], [`${rot} (valor)`, Number(t[k].valor.toFixed(2))]])),
      'Provisão (qtd)': t.provisao.qtd, 'Provisão (valor)': Number(t.provisao.valor.toFixed(2)),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasResumo), 'Resumo');
    const detalhe = (filtroFn) => itens.filter(filtroFn).map((c) => ({
      'Chave CT-e': c.chave_cte, 'Número CT-e': numeroSerie(c), Transportadora: c.transportadora, CNPJ: c.cnpj_transportadora,
      Emissão: String(c.data_emissao || '').slice(0, 10), 'Valor CT-e': Number(c.valor_cte || 0), Canal: c.canal || '',
      Origem: `${c.cidade_origem || ''}${c.uf_origem ? `/${c.uf_origem}` : ''}`, Destino: `${c.cidade_destino || ''}${c.uf_destino ? `/${c.uf_destino}` : ''}`,
      Situação: SITUACOES_PROVISAO[c.situacao], 'Entra na provisão': c.provisao ? 'Sim' : 'Não',
      'Data lançamento': c.data_lancamento || '', 'Lançamento contábil': c.lancamento_contabil || '', Fatura: c.numero_fatura || '',
      'Teve estorno sem relançar': c.estornado ? 'Sim' : '',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalhe((c) => c.provisao)), 'Provisão');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalhe(() => true)), 'Todos os CT-es');
    XLSX.writeFile(wb, `PROVISAO_CTES_${calculadaPara}.xlsx`);
  };

  const valorLista = lista.reduce((acc, c) => acc + Number(c.valor_cte || 0), 0);
  const cards = resumo ? [
    { id: 'TODOS', rotulo: 'Emitidos na competência', cor: '#1e3a8a', dado: resumo.total.geral },
    ...Object.entries(SITUACOES_PROVISAO).map(([id, rotulo]) => ({ id, rotulo, cor: CORES[id], dado: resumo.total[id] })),
    { id: 'PROVISAO', rotulo: 'Provisão (após o mês + não lançado)', cor: '#7c3aed', dado: resumo.total.provisao },
  ] : [];

  return (
    <div className="table-card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="panel-title audit-table-title" style={{ margin: 0 }}>Provisão de CT-es por competência</div>
        <button type="button" className="btn-secondary" onClick={() => setAberto((v) => !v)}>{aberto ? 'Recolher' : 'Abrir'}</button>
      </div>
      {aberto && (
        <>
          <p style={{ margin: '6px 0 10px', fontSize: 13, color: '#64748b' }}>
            Cruza os CT-es emitidos no mês (base de CT-es) com os lançamentos de CT-e do relatório SAP importado acima
            (CNPJ do emitente + número + série). CT-e sem lançamento próprio conta como lançado pela data de lançamento da fatura em que está.
            Para ver o que foi lançado depois da virada, importe também o relatório SAP do mês seguinte.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
            <label className="field" style={{ width: 180 }}>Competência (emissão)
              <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
            </label>
            <button type="button" className="btn-primary" disabled={Boolean(progresso)} onClick={calcular}>{progresso ? 'Calculando...' : 'Calcular provisão'}</button>
            {itens && <button type="button" className="btn-secondary" onClick={exportar}>Exportar (Excel)</button>}
          </div>
          {progresso && <div className="hint-box compact">{progresso}</div>}
          {erro && <div className="hint-box compact error-text">{erro}</div>}
          {resumo && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                {cards.map((c) => (
                  <button key={c.id} type="button" style={cartao(filtro === c.id, c.cor)} onClick={() => { setFiltro(c.id); setVisiveis(PAGINA); }}>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>{c.rotulo}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: filtro === c.id ? '#fff' : c.cor }}>{num(c.dado.qtd)}</div>
                    <div style={{ fontSize: 12 }}>{dinheiro(c.dado.valor)}{resumo.total.geral.qtd ? ` · ${((c.dado.qtd / resumo.total.geral.qtd) * 100).toFixed(1)}%` : ''}</div>
                  </button>
                ))}
              </div>

              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Por transportadora (clique para filtrar os CT-es)</div>
              <div className="sim-analise-tabela-wrap" style={{ maxHeight: 300, overflow: 'auto', marginBottom: 12 }}>
                <table className="sim-analise-tabela">
                  <thead>
                    <tr><th>Transportadora</th><th>Emitidos</th><th>Lançado no mês</th><th>Via fatura</th><th>Após o mês</th><th>Não lançado</th><th>Provisão (valor)</th></tr>
                  </thead>
                  <tbody>
                    {resumo.porTransportadora.map((t) => (
                      <tr key={t.nome} style={transportadora === t.nome ? { background: '#eff6ff' } : undefined}>
                        <td><button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => { setTransportadora(transportadora === t.nome ? '' : t.nome); setVisiveis(PAGINA); }}>{t.nome}</button></td>
                        <td>{num(t.geral.qtd)}</td>
                        <td>{num(t.NO_MES.qtd)}</td>
                        <td>{num(t.FATURA.qtd)}</td>
                        <td>{num(t.APOS_MES.qtd + t.FATURA_APOS.qtd)}</td>
                        <td style={{ color: t.NAO_LANCADO.qtd ? '#b91c1c' : undefined, fontWeight: t.NAO_LANCADO.qtd ? 700 : 400 }}>{num(t.NAO_LANCADO.qtd)}</td>
                        <td><strong>{dinheiro(t.provisao.valor)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                {num(lista.length)} CT-e(s) · {dinheiro(valorLista)}{transportadora ? ` · ${transportadora}` : ''}
              </div>
              <div className="sim-analise-tabela-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
                <table className="sim-analise-tabela">
                  <thead><tr><th>CT-e</th><th>Transportadora</th><th>Emissão</th><th>Valor CT-e</th><th>Situação</th><th>Data lançamento</th><th>Lançamento / fatura</th></tr></thead>
                  <tbody>
                    {!lista.length && <tr><td colSpan={7}>Nenhum CT-e nesse recorte.</td></tr>}
                    {lista.slice(0, visiveis).map((c) => (
                      <tr key={c.id}>
                        <td style={{ fontSize: 12 }}>{numeroSerie(c)}</td>
                        <td>{c.transportadora}</td>
                        <td>{dataBr(c.data_emissao)}</td>
                        <td>{dinheiro(c.valor_cte)}</td>
                        <td style={{ color: CORES[c.situacao], fontWeight: 700 }}>{SITUACOES_PROVISAO[c.situacao]}{c.estornado ? ' (estornado)' : ''}</td>
                        <td>{dataBr(c.data_lancamento)}</td>
                        <td style={{ fontSize: 12 }}>{[c.lancamento_contabil, c.numero_fatura ? `Fatura ${c.numero_fatura}` : ''].filter(Boolean).join(' · ') || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {lista.length > visiveis && (
                <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={() => setVisiveis((v) => v + PAGINA)}>Mostrar mais</button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
