import { useEffect, useMemo, useState } from 'react';
import { listarLancamentos } from '../../services/robosLancamentosService';
import { TIPOS_LANCAMENTO, agregarPorMes, anosDisponiveis } from '../../utils/robos/historicoLancamentos';
import { baixarXlsx, isoParaBr } from '../../utils/robos/lancamentoComum';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const moeda = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', fontSize: 12, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' };

const CABECALHO = ['Tipo', 'Documento', 'Transportadora', 'CNPJ Transp', 'Empresa', 'Centro', 'C.Custo', 'Valor', 'Emissão', 'Vencimento', 'Fatura', 'Pedido', 'MIRO', 'Lançado em', 'Lançado por'];

// Acompanhamento dos lancamentos feitos pelos robos: quantas notas por mes, valor e detalhe.
export default function HistoricoLancamentos() {
  const [dados, setDados] = useState({ registros: [], onde: '' });
  const [carregando, setCarregando] = useState(true);
  const [tipo, setTipo] = useState('');
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const [busca, setBusca] = useState('');
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    listarLancamentos().then((r) => { if (vivo) { setDados(r); setCarregando(false); } });
    return () => { vivo = false; };
  }, [versao]);

  const anos = useMemo(() => anosDisponiveis(dados.registros), [dados.registros]);
  const meses = useMemo(() => agregarPorMes(dados.registros, ano, tipo), [dados.registros, ano, tipo]);
  const maxMes = Math.max(1, ...meses.map((m) => m.total));
  const mesAtual = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const anterior = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  const todosMeses = useMemo(() => [...agregarPorMes(dados.registros, String(new Date().getFullYear()), tipo), ...agregarPorMes(dados.registros, String(new Date().getFullYear() - 1), tipo)], [dados.registros, tipo]);
  const doMes = todosMeses.find((m) => m.mes === mesAtual);
  const doAnterior = todosMeses.find((m) => m.mes === anterior);
  const totalAno = meses.reduce((s, m) => s + m.total, 0);

  const detalhe = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return dados.registros
      .filter((r) => (!tipo || r.tipo === tipo) && String(r.lancado_em || '').startsWith(ano))
      .filter((r) => !t || [r.documento, r.transportadora, r.cnpj_transp, r.fatura, r.pedido, r.miro, r.empresa].some((c) => String(c ?? '').toLowerCase().includes(t)));
  }, [dados.registros, tipo, ano, busca]);

  function linhaXlsx(r) {
    return {
      Tipo: TIPOS_LANCAMENTO[r.tipo] || r.tipo, Documento: r.documento, Transportadora: r.transportadora, 'CNPJ Transp': r.cnpj_transp, Empresa: r.empresa, Centro: r.centro,
      'C.Custo': r.centro_custo, Valor: Number(r.valor) || 0, Emissão: isoParaBr(r.data_emissao), Vencimento: isoParaBr(r.vencimento), Fatura: r.fatura, Pedido: r.pedido, MIRO: r.miro,
      'Lançado em': isoParaBr(String(r.lancado_em || '').slice(0, 10)), 'Lançado por': r.lancado_por,
    };
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="panel-card">
        <div className="panel-title">Acompanhamento de lançamentos</div>
        <p>Cada nota ou CT-e que recebe número de MIRO entra aqui automaticamente (quando você traz o resultado do SAP para a tela). Serve para acompanhar quantos documentos estão sendo lançados por mês.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field"><label>Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option><option value="NFSE">NFS-e</option><option value="CTE">CT-e</option>
            </select>
          </div>
          <div className="field"><label>Ano</label>
            <select value={ano} onChange={(e) => setAno(e.target.value)}>{anos.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          </div>
          <button type="button" className="btn-secondary" onClick={() => setVersao((v) => v + 1)}>Atualizar</button>
          <button type="button" className="btn-secondary" disabled={!detalhe.length} onClick={() => baixarXlsx(`lancamentos-${ano}.xlsx`, detalhe.map(linhaXlsx), CABECALHO)}>Baixar {ano} (.xlsx)</button>
        </div>
        {dados.onde === 'navegador' ? <div style={{ marginTop: 8, fontSize: 12, color: '#b45309' }}>O banco ainda não tem a tabela de histórico (migration pendente): estes registros estão guardados só neste navegador.</div> : null}
      </div>

      <div className="summary-strip">
        <div className="summary-card"><span>Lançados neste mês</span><strong>{fmt(doMes?.total)}</strong></div>
        <div className="summary-card"><span>Mês anterior</span><strong>{fmt(doAnterior?.total)}</strong></div>
        <div className="summary-card"><span>Valor do mês</span><strong style={{ fontSize: 15 }}>{moeda(doMes?.valor)}</strong></div>
        <div className="summary-card"><span>Total em {ano}</span><strong>{fmt(totalAno)}</strong></div>
      </div>

      <div className="panel-card">
        <div className="panel-title">Por mês — {ano}</div>
        {carregando ? <p>Carregando…</p> : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={th}>Mês</th><th style={th}>NFS-e</th><th style={th}>CT-e</th><th style={th}>Total</th><th style={th}>Valor</th><th style={th}>Transportadoras</th><th style={{ ...th, width: '30%' }}></th></tr></thead>
            <tbody>
              {meses.map((m, i) => (
                <tr key={m.mes}>
                  <td style={td}><b>{MESES[i]}</b></td>
                  <td style={td}>{fmt(m.nfse)}</td>
                  <td style={td}>{fmt(m.cte)}</td>
                  <td style={td}><b>{fmt(m.total)}</b></td>
                  <td style={td}>{moeda(m.valor)}</td>
                  <td style={td}>{fmt(m.transportadoras)}</td>
                  <td style={td}><div style={{ height: 10, borderRadius: 5, background: '#0f172a', width: `${(m.total / maxMes) * 100}%`, minWidth: m.total ? 4 : 0 }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel-card">
        <div className="panel-title">Documentos lançados em {ano} ({fmt(detalhe.length)})</div>
        <div className="field" style={{ maxWidth: 320, marginBottom: 8 }}>
          <label>Buscar (nota, transportadora, fatura, pedido, MIRO…)</label>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div style={{ overflow: 'auto', maxHeight: 420 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>{['Tipo', 'Documento', 'Transportadora', 'Emp', 'Valor', 'Fatura', 'Pedido', 'MIRO', 'Lançado em', 'Por'].map((c) => <th key={c} style={th}>{c}</th>)}</tr></thead>
            <tbody>
              {detalhe.slice(0, 300).map((r) => (
                <tr key={`${r.tipo}-${r.miro}-${r.documento}`}>
                  <td style={td}>{TIPOS_LANCAMENTO[r.tipo] || r.tipo}</td><td style={td}>{r.documento}</td><td style={td}>{r.transportadora}</td><td style={td}>{r.empresa}</td>
                  <td style={td}>{moeda(r.valor)}</td><td style={td}>{r.fatura}</td><td style={td}>{r.pedido}</td><td style={td}>{r.miro}</td>
                  <td style={td}>{isoParaBr(String(r.lancado_em || '').slice(0, 10))}</td><td style={td}>{r.lancado_por}</td>
                </tr>
              ))}
              {!detalhe.length ? <tr><td style={{ ...td, padding: 14, color: '#64748b' }} colSpan={10}>Nenhum lançamento registrado neste período.</td></tr> : null}
            </tbody>
          </table>
        </div>
        {detalhe.length > 300 ? <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Mostrando os 300 mais recentes. Baixe o .xlsx para ver todos.</div> : null}
      </div>
    </div>
  );
}
