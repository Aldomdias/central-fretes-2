import { useEffect, useMemo, useState } from 'react';
import { atualizarContabil, listarLancamentos } from '../../services/robosLancamentosService';
import { casarContabil, lerRelatorioContabil } from '../../utils/robos/contabilHana';
import { descartarDaFila, listarPendentesFila, sincronizarHistoricoDaFila } from '../../services/robosFilaService';
import { aguardandoResultado, mandarParaLote, tamanhoLoteSalvo } from '../../utils/robos/filaRobo';
import { TextoAguardando } from './AvisoFila';
import { carregarSessao } from '../../utils/authLocal';
import { TIPOS_LANCAMENTO, agregarPorMes, anosDisponiveis, registrosVisiveis } from '../../utils/robos/historicoLancamentos';
import { abaParaMatriz, baixarXlsx, isoParaBr, lerPlanilhaArquivo } from '../../utils/robos/lancamentoComum';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const moeda = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', fontSize: 12, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' };

const CABECALHO = ['Tipo', 'Documento', 'Transportadora', 'CNPJ Transp', 'Empresa', 'Centro', 'C.Custo', 'Valor', 'Emissão', 'Vencimento', 'Fatura', 'Pedido', 'MIRO', 'Lançamento contábil', 'Compensação (HANA)', 'Doc. compensação', 'Data compensação', 'Vencimento líq.', 'Lançado em', 'Lançado por'];
const CABECALHO_SEM_HISTORICO = ['Referência', 'CNPJ', 'Fornecedor', 'Empresa', 'Valor', 'Lançamento contábil', 'Compensação (HANA)', 'Doc. compensação', 'Data compensação'];
// So informativo (vem do relatorio do HANA importado aqui): nao tem relacao com o controle de pagamentos.
const textoPagamento = (r) => (r.situacao_pagamento === 'pago' ? `Compensado${r.data_compensacao ? ` ${isoParaBr(r.data_compensacao)}` : ''}` : r.situacao_pagamento === 'aberto' ? 'Em aberto' : '');

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
  const [contabil, setContabil] = useState({ texto: '', erro: '', semHistorico: [] });

  // Relatorio de partidas do fornecedor do SAP HANA: casa Referencia + CNPJ com o historico e grava o
  // lancamento contabil e o pagamento (compensacao).
  async function importarContabil(arquivo) {
    if (!arquivo) return;
    setContabil({ texto: 'Lendo o relatorio…', erro: '', semHistorico: [] });
    try {
      const XLSX = await import('xlsx');
      const wb = await lerPlanilhaArquivo(arquivo);
      const porNota = lerRelatorioContabil(abaParaMatriz(XLSX, wb.Sheets[wb.SheetNames[0]]));
      const { atualizar, iguais, semHistorico } = casarContabil(dados.registros, porNota);
      const r = await atualizarContabil(atualizar);
      if (!r.ok) { setContabil({ texto: '', erro: r.erro || 'Nao consegui gravar.', semHistorico }); return; }
      const pagos = atualizar.filter((a) => a.situacao_pagamento === 'pago').length;
      setContabil({
        texto: `${fmt(porNota.size)} nota(s) no relatorio. ${fmt(atualizar.length)} documento(s) do historico atualizados (${fmt(pagos)} compensados, ${fmt(atualizar.length - pagos)} em aberto); ${fmt(iguais)} ja estavam iguais. ${fmt(semHistorico.length)} nota(s) do relatorio nao estao no historico (lancadas fora do robo).`,
        erro: '',
        semHistorico,
      });
      setVersao((v) => v + 1);
    } catch (e) {
      setContabil({ texto: '', erro: e.message || 'Nao consegui ler o relatorio.', semHistorico: [] });
    }
  }

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    // MIRO que a planilha do robo mandou direto para a fila entra no historico antes de listar
    sincronizarHistoricoDaFila().catch(() => null).then(() => listarLancamentos()).then((r) => { if (vivo) { setDados(r); setCarregando(false); } });
    listarPendentesFila().then((r) => { if (vivo) setFila(r); });
    return () => { vivo = false; };
  }, [versao]);

  // filtro por quem lancou e marcacao das notas que vao para o robo (so as marcadas seguem; o resto fica na fila)
  const [filtroPor, setFiltroPor] = useState('');
  const [marcados, setMarcados] = useState(() => new Set());
  const chaveItem = (i) => `${i.tipo}|${i.chave}`;
  const pessoas = useMemo(() => [...new Set(fila.itens.map((i) => i.atualizado_por || '').filter(Boolean))].sort((a, b) => a.localeCompare(b)), [fila.itens]);
  const pendentes = useMemo(() => fila.itens.filter((i) => (!tipo || i.tipo === tipo) && (!filtroPor || (i.atualizado_por || '') === filtroPor)), [fila.itens, tipo, filtroPor]);
  const marcadosPorTipo = (t) => fila.itens.filter((i) => i.tipo === t && marcados.has(chaveItem(i)));
  const aguardando = useMemo(() => aguardandoResultado(pendentes), [pendentes]);
  const marcarVisiveis = (ligar) => setMarcados((a) => {
    const n = new Set(a);
    pendentes.slice(0, 300).forEach((i) => { if (ligar) n.add(chaveItem(i)); else n.delete(chaveItem(i)); });
    return n;
  });
  const alternar = (i) => setMarcados((a) => { const n = new Set(a); const k = chaveItem(i); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // Manda as marcadas de volta para a tela do robo (substitui o lote salvo dela) e abre a aba.
  function mandarParaRobo(t) {
    const itens = marcadosPorTipo(t);
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
      .filter((r) => !t || [r.documento, r.transportadora, r.cnpj_transp, r.fatura, r.pedido, r.miro, r.empresa, r.lancamento_contabil].some((c) => String(c ?? '').toLowerCase().includes(t)));
  }, [dados.registros, tipo, ano, busca]);

  function linhaXlsx(r) {
    return {
      Tipo: TIPOS_LANCAMENTO[r.tipo] || r.tipo, Documento: r.documento, Transportadora: r.transportadora, 'CNPJ Transp': r.cnpj_transp, Empresa: r.empresa, Centro: r.centro,
      'C.Custo': r.centro_custo, Valor: Number(r.valor) || 0, Emissão: isoParaBr(r.data_emissao), Vencimento: isoParaBr(r.vencimento), Fatura: r.fatura, Pedido: r.pedido, MIRO: r.miro,
      'Lançamento contábil': r.lancamento_contabil, 'Compensação (HANA)': textoPagamento(r), 'Doc. compensação': r.compensacao, 'Data compensação': isoParaBr(r.data_compensacao), 'Vencimento líq.': isoParaBr(r.vencimento_liquido),
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
          <label className="btn-secondary" style={{ cursor: 'pointer' }} title="Relatorio de partidas do fornecedor exportado do SAP HANA (Referencia, N ID fiscal 1, Lancamento contabil, Lancto.compensacao...)">
            Importar lançamento contábil (HANA)
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => { importarContabil(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        {contabil.texto ? <div style={{ marginTop: 8, fontSize: 13, color: '#166534' }}>{contabil.texto}</div> : null}
        {contabil.erro ? <div style={{ marginTop: 8, fontSize: 13, color: '#b91c1c' }}>{contabil.erro}</div> : null}
        {contabil.semHistorico.length ? (
          <button type="button" className="btn-link" style={{ marginTop: 4 }} onClick={() => baixarXlsx('hana-fora-do-historico.xlsx', contabil.semHistorico.map((i) => ({ Referência: i.referencia, CNPJ: i.cnpj, Fornecedor: i.fornecedor, Empresa: i.empresa, Valor: i.montante, 'Lançamento contábil': i.lancamento_contabil, 'Compensação (HANA)': textoPagamento(i), 'Doc. compensação': i.compensacao, 'Data compensação': isoParaBr(i.data_compensacao) })), CABECALHO_SEM_HISTORICO)}>
            Baixar as {fmt(contabil.semHistorico.length)} nota(s) do relatório que não estão no histórico
          </button>
        ) : null}
        {dados.onde === 'navegador' ? <div style={{ marginTop: 8, fontSize: 12, color: '#b45309' }}>O banco ainda não tem a tabela de histórico (migration pendente): estes registros estão guardados só neste navegador.</div> : null}
      </div>

      <div className="panel-card">
        <div className="panel-title">Sem MIRO — o que falta lançar ({fmt(pendentes.length)})</div>
        <p style={{ marginTop: 0 }}>Notas e CT-e mandados para o robô (de qualquer computador) que ainda não têm MIRO, com o motivo quando o SAP recusou. Filtre por quem lançou, marque só as que quer e mande para o robô sem importar nada de novo: o lote da tela é trocado pelas marcadas (as outras ficam aqui) e quem já tem pedido vai só para a MIRO.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12 }}>Lançado por{' '}
            <select value={filtroPor} onChange={(e) => setFiltroPor(e.target.value)}>
              <option value="">Todos</option>
              {pessoas.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <button type="button" className="btn-secondary" disabled={!pendentes.length} onClick={() => marcarVisiveis(true)}>Marcar todas da lista</button>
          <button type="button" className="btn-secondary" disabled={!marcados.size} onClick={() => setMarcados(new Set())}>Limpar marcação ({fmt(marcados.size)})</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <button type="button" className="btn-primary" disabled={!marcadosPorTipo('NFSE').length} onClick={() => mandarParaRobo('NFSE')} title="Só as NFS-e marcadas vão para o robô; as outras ficam na fila">Mandar NFS-e marcadas para o robô ({fmt(marcadosPorTipo('NFSE').length)})</button>
          <button type="button" className="btn-primary" disabled={!marcadosPorTipo('CTE').length} onClick={() => mandarParaRobo('CTE')} title="Só os CT-e marcados vão para o robô; os outros ficam na fila">Mandar CT-e marcados para o robô ({fmt(marcadosPorTipo('CTE').length)})</button>
          <button type="button" className="btn-secondary" disabled={!pendentes.length} onClick={() => baixarXlsx('sem-miro.xlsx', pendentes.map(linhaPendente), CABECALHO_PENDENTES)}>Baixar lista (.xlsx)</button>
        </div>
        {aviso ? <div style={{ color: '#b91c1c', fontSize: 12, marginBottom: 6 }}>{aviso}</div> : null}
        {aguardando.length ? (
          <div style={{ padding: 10, borderRadius: 8, background: '#fef3c7', color: '#92400e', fontSize: 13, marginBottom: 8 }}>
            Resultado ainda não voltou para a Central (o robô rodou e ninguém importou, ou ainda está rodando):
            <TextoAguardando grupos={aguardando} />
          </div>
        ) : null}
        {fila.onde === 'navegador' ? <div style={{ marginBottom: 6, fontSize: 12, color: '#b45309' }}>O banco ainda não tem a tabela da fila (migration pendente): esta lista está guardada só neste navegador.</div> : null}
        {fila.onde === 'erro' ? <div style={{ marginBottom: 6, fontSize: 12, color: '#b91c1c' }}>Não consegui ler a fila: {fila.erro}</div> : null}
        {pendentes.length ? (
          <div style={{ overflow: 'auto', maxHeight: 320 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={th}><input type="checkbox" title="Marcar / desmarcar todas da lista" checked={pendentes.slice(0, 300).every((i) => marcados.has(chaveItem(i)))} onChange={(e) => marcarVisiveis(e.target.checked)} /></th>{['Tipo', 'Documento', 'Transportadora', 'Valor', 'Pedido', 'Motivo', 'Atualizado em', 'Por', ''].map((c) => <th key={c} style={th}>{c}</th>)}</tr></thead>
              <tbody>
                {pendentes.slice(0, 300).map((i) => (
                  <tr key={`${i.tipo}-${i.chave}`} style={{ background: marcados.has(chaveItem(i)) ? '#eff6ff' : undefined }}>
                    <td style={td}><input type="checkbox" checked={marcados.has(chaveItem(i))} onChange={() => alternar(i)} /></td>
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
            <thead><tr>{['Tipo', 'Documento', 'Transportadora', 'Emp', 'Valor', 'Fatura', 'Pedido', 'MIRO', 'Lanç. contábil', 'Compensação', 'Lançado em', 'Por'].map((c) => <th key={c} style={th}>{c}</th>)}</tr></thead>
            <tbody>
              {detalhe.slice(0, 300).map((r) => (
                <tr key={`${r.tipo}-${r.miro}-${r.documento}`}>
                  <td style={td}>{TIPOS_LANCAMENTO[r.tipo] || r.tipo}</td><td style={td}>{r.documento}</td><td style={td}>{r.transportadora}</td><td style={td}>{r.empresa}</td>
                  <td style={td}>{moeda(r.valor)}</td><td style={td}>{r.fatura}</td><td style={td}>{r.pedido}</td><td style={td}>{r.miro || <span style={{ color: '#b45309' }}>sem MIRO</span>}</td>
                  <td style={td}>{r.lancamento_contabil}</td><td style={{ ...td, color: r.situacao_pagamento === 'pago' ? '#166534' : '#b45309' }}>{textoPagamento(r)}</td>
                  <td style={td}>{isoParaBr(String(r.lancado_em || '').slice(0, 10))}</td><td style={td}>{r.lancado_por}</td>
                </tr>
              ))}
              {!detalhe.length ? <tr><td style={{ ...td, padding: 14, color: '#64748b' }} colSpan={12}>Nenhum lançamento registrado neste período.</td></tr> : null}
            </tbody>
          </table>
        </div>
        {detalhe.length > 300 ? <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Mostrando os 300 mais recentes. Baixe o .xlsx para ver todos.</div> : null}
      </div>
    </div>
  );
}
