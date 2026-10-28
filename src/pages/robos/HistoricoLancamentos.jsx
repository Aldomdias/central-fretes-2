import { useEffect, useMemo, useState } from 'react';
import { listarLancamentos } from '../../services/robosLancamentosService';
import { descartarDaFila, listarPendentesFila } from '../../services/robosFilaService';
import { mandarParaLote, tamanhoLoteSalvo } from '../../utils/robos/filaRobo';
import { carregarSessao } from '../../utils/authLocal';
import { TIPOS_LANCAMENTO, agregarPorMes, anosDisponiveis, registrosVisiveis } from '../../utils/robos/historicoLancamentos';
import { baixarXlsx, isoParaBr } from '../../utils/robos/lancamentoComum';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const moeda = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', fontSize: 12, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' };

const CABECALHO = ['Tipo', 'Documento', 'Transportadora', 'CNPJ Transp', 'Empresa', 'Centro', 'C.Custo', 'Valor', 'Emissão', 'Vencimento', 'Fatura', 'Pedido', 'MIRO', 'Lançado em', 'Lançado por'];

// Acompanhamento dos lancamentos feitos pelos robos: quantas notas por mes, valor e detalhe.
const CABECALHO_PENDENTES = ['Tipo', 'Documento', 'Transportadora', 'CNPJ Transp', 'Valor', 'Pedido', 'Motivo', 'Atualizado em', 'Por'];
const ROBO_DO_TIPO = { NFSE: 'lancamento-nfse', CTE: 'lancamento-cte' };

// onAbrirRobo(chave): troca para a aba do robo (RobosPage).
export default function HistoricoLancamentos({ onAbrirRobo }) {
  const [dados, setDados] = useState({ registros: [], onde: '' });
  const [carregando, setCarregando] = useState(true);
  const [tipo, setTipo] = useState('');
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const [busca, setBusca] = useState('');
  const [versao, setVersao] = useState(0);

  const [fila, setFila] = useState({ itens: [], onde: '' });
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    listarLancamentos().then((r) => { if (vivo) { setDados(r); setCarregando(false); } });
    listarPendentesFila().then((r) => { if (vivo) setFila(r); });
    return () => { vivo = false; };
  }, [versao]);

  const pendentes = useMemo(() => fila.itens.filter((i) => !tipo || i.tipo === tipo), [fila.itens, tipo]);
  const pendentesPorTipo = (t) => fila.itens.filter((i) => i.tipo === t);

  // Manda as sem MIRO de volta para a tela do robo (substitui o lote salvo dela) e abre a aba.
  function mandarParaRobo(t) {
    const itens = pendentesPorTipo(t);
    if (!itens.length) return;
    const atual = tamanhoLoteSalvo(t);
    const nome = t === 'CTE' ? 'CT-e' : 'NFS-e';
    if (atual && !window.confirm(`A tela do robo de ${nome} tem um lote com ${atual} documento(s). Substituir por estes ${itens.length} sem MIRO?`)) return;
    try {
      mandarParaLote(t, itens);
    } catch (e) {
      setAviso(`Nao consegui carregar o lote: ${e.message}`);
      return;
    }
    if (onAbrirRobo) onAbrirRobo(ROBO_DO_TIPO[t]);
  }

  async function descartar(item) {
    if (!window.confirm(`Tirar ${item.documento} da lista de sem MIRO? (use quando a nota nao vai ser lancada)`)) return;
    const sessao = carregarSessao();
    await descartarDaFila([item], sessao?.nome || sessao?.email || '');
    setVersao((v) => v + 1);
  }

  function linhaPendente(i) {
    return {
      Tipo: TIPOS_LANCAMENTO[i.tipo] || i.tipo, Documento: i.documento, Transportadora: i.transportadora, 'CNPJ Transp': i.cnpj_transp, Valor: Number(i.valor) || 0,
      Pedido: i.pedido, Motivo: i.motivo, 'Atualizado em': isoParaBr(String(i.atualizado_em || '').slice(0, 10)), Por: i.atualizado_por,
    };
  }

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
    return registrosVisiveis(dados.registros)
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
        <p>Cada nota ou CT-e que recebe pedido ou MIRO entra aqui automaticamente (quando você traz o resultado do SAP para a tela). Os que só têm pedido aparecem como “sem MIRO” na lista e não entram na contagem do mês até a MIRO sair.</p>
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

      <div className="panel-card">
        <div className="panel-title">Sem MIRO — o que falta lançar ({fmt(pendentes.length)})</div>
        <p style={{ marginTop: 0 }}>Notas e CT-e mandados para o robô (de qualquer computador) que ainda não têm MIRO, com o motivo quando o SAP recusou. Mande de volta para o robô sem importar nada de novo: o lote da tela é trocado por estes e quem já tem pedido vai só para a MIRO.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <button type="button" className="btn-primary" disabled={!pendentesPorTipo('NFSE').length} onClick={() => mandarParaRobo('NFSE')}>Mandar NFS-e para o robô ({fmt(pendentesPorTipo('NFSE').length)})</button>
          <button type="button" className="btn-primary" disabled={!pendentesPorTipo('CTE').length} onClick={() => mandarParaRobo('CTE')}>Mandar CT-e para o robô ({fmt(pendentesPorTipo('CTE').length)})</button>
          <button type="button" className="btn-secondary" disabled={!pendentes.length} onClick={() => baixarXlsx('sem-miro.xlsx', pendentes.map(linhaPendente), CABECALHO_PENDENTES)}>Baixar lista (.xlsx)</button>
        </div>
        {aviso ? <div style={{ color: '#b91c1c', fontSize: 12, marginBottom: 6 }}>{aviso}</div> : null}
        {fila.onde === 'navegador' ? <div style={{ marginBottom: 6, fontSize: 12, color: '#b45309' }}>O banco ainda não tem a tabela da fila (migration pendente): esta lista está guardada só neste navegador.</div> : null}
        {fila.onde === 'erro' ? <div style={{ marginBottom: 6, fontSize: 12, color: '#b91c1c' }}>Não consegui ler a fila: {fila.erro}</div> : null}
        {pendentes.length ? (
          <div style={{ overflow: 'auto', maxHeight: 320 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>{['Tipo', 'Documento', 'Transportadora', 'Valor', 'Pedido', 'Motivo', 'Atualizado em', 'Por', ''].map((c) => <th key={c} style={th}>{c}</th>)}</tr></thead>
              <tbody>
                {pendentes.slice(0, 300).map((i) => (
                  <tr key={`${i.tipo}-${i.chave}`}>
                    <td style={td}>{TIPOS_LANCAMENTO[i.tipo] || i.tipo}</td><td style={td}>{i.documento}</td><td style={td}>{i.transportadora}</td>
                    <td style={td}>{moeda(i.valor)}</td><td style={td}>{i.pedido || <span style={{ color: '#64748b' }}>sem pedido</span>}</td>
                    <td style={{ ...td, whiteSpace: 'normal', minWidth: 220, color: i.motivo ? '#b45309' : '#64748b' }}>{i.motivo || '—'}</td>
                    <td style={td}>{isoParaBr(String(i.atualizado_em || '').slice(0, 10))}</td><td style={td}>{i.atualizado_por}</td>
                    <td style={td}><button type="button" className="btn-link" onClick={() => descartar(i)}>descartar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div style={{ fontSize: 12, color: '#64748b' }}>Nada pendente{tipo ? ' neste tipo' : ''}. As notas mandadas para o robô a partir de agora aparecem aqui até a MIRO sair.</div>}
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
                  <td style={td}>{moeda(r.valor)}</td><td style={td}>{r.fatura}</td><td style={td}>{r.pedido}</td><td style={td}>{r.miro || <span style={{ color: '#b45309' }}>sem MIRO</span>}</td>
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
