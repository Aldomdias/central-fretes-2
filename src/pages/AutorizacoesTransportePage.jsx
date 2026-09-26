import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { carregarSessao } from '../utils/authLocal';
import {
  analisarFrete,
  buscarCanalPorCte,
  completarVinculosPendentes,
  decidirAutorizacao,
  desativarAutorizacao,
  formatarPct,
  salvarChaveNfe,
  fonteAutorizacao,
  importarAprovacoesPlanilha,
  lancarSaldoAntecipado,
  listarAutorizacoes,
  transferirParaTransporte,
} from '../services/transporteAutorizacoesService';

const dinheiro = (valor) => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = (valor) => (valor ? new Date(valor).toLocaleString('pt-BR') : '-');
const rotulo = (canal) => (canal === 'B2C' ? 'B2C' : canal === 'SUPRIMENTOS' ? 'Suprimentos' : 'Atacado');

// Um modulo por canal (B2C / Atacado): cada gestor so ve a fila do seu.
export default function AutorizacoesTransportePage({ canal = 'B2C' }) {
  const sessao = carregarSessao();
  const usuarioNome = sessao?.nome || sessao?.email || '';
  const [aba, setAba] = useState('fila');
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [edicao, setEdicao] = useState({});
  const [processando, setProcessando] = useState('');
  const [marcados, setMarcados] = useState([]);
  const [justificativaMassa, setJustificativaMassa] = useState('');
  const [canaisReais, setCanaisReais] = useState(new Map());
  const [destinoTransferencia, setDestinoTransferencia] = useState('');
  const [filtroFonte, setFiltroFonte] = useState('');
  const [importando, setImportando] = useState('');
  const arquivoRef = useRef(null);
  const [form, setForm] = useState({ chave: '', pedido: '', valor: '', observacao: '' });

  // Recarrega a fila e, de quebra, busca no tracking o pedido (Marketplace) e a
  // chave da NF que faltarem nos itens — quem autoriza precisa ver isso.
  const carregar = async (avisar = false) => {
    setCarregando(true);
    setErro('');
    try {
      let lista = await listarAutorizacoes({ canal });
      const preenchidos = await completarVinculosPendentes(lista.filter((item) => item.status === 'PENDENTE'));
      if (preenchidos) lista = await listarAutorizacoes({ canal });
      // Aprovacao de Gestao fica no estado da gestao: continua valendo na auditoria, mas nao aparece aqui.
      setItens(canal === 'SUPRIMENTOS' ? lista : lista.filter((item) => fonteAutorizacao(item) !== 'GESTAO'));
      setCanaisReais(await buscarCanalPorCte(lista.filter((item) => item.status === 'PENDENTE').map((item) => item.chave_cte)));
      if (avisar) setMensagem(preenchidos ? `${preenchidos} item(ns) atualizado(s) com pedido/chave da NF.` : 'Fila atualizada — nada novo pra completar.');
    } catch (error) {
      setErro(error.message || String(error));
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, [canal]);

  const pendentes = useMemo(() => itens.filter((item) => item.status === 'PENDENTE'), [itens]);
  const decididas = useMemo(() => itens.filter((item) => item.status !== 'PENDENTE'), [itens]);
  const totalAutorizado = decididas.filter((item) => item.status === 'AUTORIZADA').reduce((acc, item) => acc + Number(item.valor_autorizado || 0), 0);

  const campo = (id, chave, padrao) => edicao[id]?.[chave] ?? padrao;
  const editar = (id, chave, valor) => setEdicao((prev) => ({ ...prev, [id]: { ...prev[id], [chave]: valor } }));

  const decidir = async (item, autorizar) => {
    const valorAutorizado = Number(String(campo(item.id, 'valor', item.valor_divergente)).replace(',', '.')) || 0;
    if (autorizar && !(valorAutorizado > 0)) { setMensagem('Informe um valor autorizado maior que zero.'); return; }
    // Sem contexto nao da pra autorizar nem recusar: justificativa obrigatoria.
    if (!String(campo(item.id, 'obs', '')).trim()) { setMensagem('Informe a justificativa (obrigatoria) para autorizar ou recusar.'); return; }
    setProcessando(item.id);
    setMensagem('');
    try {
      await decidirAutorizacao({
        id: item.id, autorizar, valorAutorizado, observacao: campo(item.id, 'obs', ''), usuarioNome, item,
      });
      setMensagem(autorizar
        ? `Autorizado ${dinheiro(valorAutorizado)} — na proxima reauditoria da fatura a divergencia desse CT-e sai.${item.protocolo_amd ? ` Chamado ${item.protocolo_amd} assumido por voce: corrija a tabela na Central de Solicitacoes.` : ''}`
        : 'Solicitacao recusada.');
      await carregar();
    } catch (error) {
      setMensagem(error.message || String(error));
    } finally {
      setProcessando('');
    }
  };

  // Suprimentos -> transporte (B2C/Atacado): vale pra um item (justificativa da linha)
  // ou pra todos os marcados (justificativa em massa).
  const transferir = async (alvo, motivo) => {
    if (!alvo.length) { setMensagem('Marque ao menos um CT-e.'); return; }
    if (!destinoTransferencia) { setMensagem('Escolha o destino da transferencia (B2C ou Atacado).'); return; }
    if (!String(motivo).trim()) { setMensagem('Informe a justificativa (obrigatoria) para transferir.'); return; }
    if (!window.confirm(`Transferir ${alvo.length} CT-e(s) para o transporte ${destinoTransferencia === 'B2C' ? 'B2C' : 'Atacado'}?`)) return;
    setProcessando('transferir');
    setMensagem('');
    try {
      const res = await transferirParaTransporte(alvo, { destino: destinoTransferencia, motivo, usuarioNome });
      setMensagem(`${res.transferidos} CT-e(s) transferido(s) para a fila do transporte ${res.destino === 'B2C' ? 'B2C' : 'Atacado'}.`);
      setMarcados([]);
      setJustificativaMassa('');
      await carregar();
    } catch (error) {
      setMensagem(error.message || String(error));
    } finally {
      setProcessando('');
    }
  };

  const todosMarcados = pendentes.length > 0 && pendentes.every((item) => marcados.includes(item.id));
  const alternarMarcado = (id) => setMarcados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const alternarTodos = () => setMarcados(todosMarcados ? [] : pendentes.map((item) => item.id));

  // Decide varios de uma vez com a mesma justificativa. O valor autorizado de
  // cada item continua sendo o do campo da linha (padrao: o adicional).
  const decidirEmMassa = async (autorizar) => {
    const alvo = pendentes.filter((item) => marcados.includes(item.id));
    if (!alvo.length) { setMensagem('Marque ao menos um CT-e.'); return; }
    if (!justificativaMassa.trim()) { setMensagem('Informe a justificativa em massa (obrigatoria).'); return; }
    if (!window.confirm(`${autorizar ? 'Autorizar' : 'Recusar'} ${alvo.length} CT-e(s) com a mesma justificativa?`)) return;
    setProcessando('massa');
    setMensagem('');
    let ok = 0;
    const falhas = [];
    for (const item of alvo) {
      const valorAutorizado = Number(String(campo(item.id, 'valor', item.valor_divergente)).replace(',', '.')) || 0;
      if (autorizar && !(valorAutorizado > 0)) { falhas.push(`${item.chave_cte?.slice(25, 34) || item.id}: valor zerado`); continue; }
      try {
        await decidirAutorizacao({ id: item.id, autorizar, valorAutorizado, observacao: justificativaMassa.trim(), usuarioNome, item });
        ok += 1;
      } catch (error) {
        falhas.push(`${item.chave_cte?.slice(25, 34) || item.id}: ${error.message || error}`);
      }
    }
    setMensagem(`${autorizar ? 'Autorizados' : 'Recusados'} ${ok} de ${alvo.length} CT-e(s).${falhas.length ? ` Falharam: ${falhas.slice(0, 5).join(' | ')}` : ''}`);
    setMarcados([]);
    setJustificativaMassa('');
    setProcessando('');
    await carregar();
  };

  const lancar = async () => {
    setProcessando('lancar');
    setMensagem('');
    try {
      const chave = form.chave.replace(/\D/g, '');
      const resultado = await lancarSaldoAntecipado({
        canal,
        chaveCte: chave.length === 44 && chave.slice(20, 22) === '57' ? chave : '',
        chaveNfe: chave.length === 44 && chave.slice(20, 22) !== '57' ? chave : '',
        numeroPedido: form.pedido,
        valor: Number(String(form.valor).replace(',', '.')),
        observacao: form.observacao,
        usuarioNome,
      });
      setForm({ chave: '', pedido: '', valor: '', observacao: '' });
      setMensagem(resultado.vinculadoCte
        ? `Saldo lancado e vinculado ao CT-e ${resultado.chaveCte}${resultado.pedido ? ` (pedido ${resultado.pedido})` : ''}.`
        : 'Saldo lancado, mas nao achei o CT-e dessa chave na base ainda — vai valer quando a NF for vinculada ao CT-e.');
      await carregar();
    } catch (error) {
      setMensagem(error.message || String(error));
    } finally {
      setProcessando('');
    }
  };

  const importarPlanilha = async (evento) => {
    const arquivo = evento.target.files?.[0];
    evento.target.value = '';
    if (!arquivo) return;
    setErro(''); setMensagem(''); setImportando('Lendo planilha...');
    try {
      const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
      const r = await importarAprovacoesPlanilha(linhas, { canal, usuarioNome, onProgress: (feito, total) => setImportando('Importando ' + feito + ' de ' + total + '...') });
      const partes = [r.importadas + ' importada(s)'];
      if (r.atualizadas) partes.push(r.atualizadas + ' da fila decidida(s)');
      if (r.jaExistiam) partes.push(r.jaExistiam + ' ja existiam');
      if (r.foraDoCanal) partes.push(r.foraDoCanal + ' de outro canal');
      if (r.pendentes) partes.push(r.pendentes + ' sem decisao');
      if (r.semVinculo.length) partes.push(r.semVinculo.length + ' sem CT-e/NF na base (' + r.semVinculo.slice(0, 5).join('; ') + (r.semVinculo.length > 5 ? '...' : '') + ')');
      if (r.erros.length) partes.push(r.erros.length + ' com erro (' + r.erros.slice(0, 2).join('; ') + ')');
      setMensagem('Importacao: ' + partes.join(', ') + '.');
      await carregar();
    } catch (error) {
      setErro('Falha ao importar: ' + (error.message || error));
    } finally {
      setImportando('');
    }
  };

  const informarChaveNfe = async (item) => {
    const chave = String(campo(item.id, 'chaveNfe', '')).replace(/\D/g, '');
    if (chave.length !== 44) { setMensagem('A chave da NF precisa ter 44 digitos.'); return; }
    setProcessando('nfe-' + item.id);
    try { await salvarChaveNfe(item, chave); setMensagem('Chave da NF salva.'); await carregar(); } catch (error) { setMensagem(error.message || String(error)); } finally { setProcessando(''); }
  };

  const remover = async (item) => {
    if (!window.confirm('Remover esta autorizacao? O saldo deixa de valer na auditoria.')) return;
    try { await desativarAutorizacao(item.id); await carregar(); } catch (error) { setMensagem(error.message || String(error)); }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Autorizacoes de transporte — {rotulo(canal)}</h1>
        <p>
          Fila de CT-es com divergencia enviados pela auditoria e lancamento antecipado de saldo autorizado (chave do CT-e ou da nota).
          O valor autorizado soma ao calculado na auditoria e tira a divergencia — o motor de calculo nao muda.
        </p>
      </div>
      <div className="tabs-row">
        {[['fila', `Fila (${pendentes.length})`], ['lancar', 'Lancar saldo autorizado'], ['historico', `Historico (${decididas.length})`]].map(([id, label]) => (
          <button key={id} className={`toggle-btn ${aba === id ? 'active' : ''}`} onClick={() => setAba(id)}>{label}</button>
        ))}
        <input ref={arquivoRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={importarPlanilha} />
        <button className="btn-secondary" onClick={() => arquivoRef.current?.click()} disabled={Boolean(importando)} title="Importa a planilha de aprovacoes (custos-aprovado): NF, OP, Custo, Status...">{importando || '⬆ Importar aprovacoes (planilha)'}</button>
        <button className="btn-secondary" onClick={() => carregar(true)} disabled={carregando} title="Recarrega a fila e busca o pedido e a chave da NF que faltarem">{carregando ? 'Atualizando...' : '↻ Atualizar e buscar pedido/NF'}</button>
      </div>
      <div className="summary-strip audit-summary-grid">
        <div className="summary-card audit-kpi" style={{ borderLeft: '4px solid #9b1111' }}><span>Aguardando decisao</span><strong>{pendentes.length}</strong></div>
        <div className="summary-card audit-kpi" style={{ borderLeft: '4px solid #14733b' }}><span>Total autorizado</span><strong>{dinheiro(totalAutorizado)}</strong></div>
      </div>
      {erro && <div className="hint-box compact error-text">{erro}</div>}
      {mensagem && <div className="hint-box compact">{mensagem}</div>}

      {aba === 'fila' && (
        <div className="table-card">
          {pendentes.length > 0 && (
            <div className="audit-action-bar" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{marcados.length} de {pendentes.length} marcado(s)</span>
              <input style={{ flex: '1 1 320px' }} value={justificativaMassa} onChange={(e) => setJustificativaMassa(e.target.value)} placeholder="Justificativa em massa (obrigatoria) — vale para todos os marcados" />
              <button className="btn-primary" disabled={processando === 'massa' || !marcados.length} onClick={() => decidirEmMassa(true)}>Autorizar marcados</button>
              <button className="btn-secondary" disabled={processando === 'massa' || !marcados.length} onClick={() => decidirEmMassa(false)}>Recusar marcados</button>
              {canal === 'SUPRIMENTOS' && (
                <>
                  <select value={destinoTransferencia} onChange={(e) => setDestinoTransferencia(e.target.value)} title="Destino da transferencia">
                    <option value="">Transferir para...</option>
                    <option value="B2C">Transporte B2C</option>
                    <option value="ATACADO">Transporte Atacado</option>
                  </select>
                  <button className="btn-secondary" disabled={processando === 'transferir' || !marcados.length} onClick={() => transferir(pendentes.filter((item) => marcados.includes(item.id)), justificativaMassa)} title="Nao e de Suprimentos: passa os marcados para a fila do transporte">Transferir para transporte</button>
                </>
              )}
            </div>
          )}
          <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead><tr><th><input type="checkbox" checked={todosMarcados} onChange={alternarTodos} title="Marcar todos" /></th><th>Pedido</th><th>Canal</th>{canal === 'SUPRIMENTOS' && <th>Chamado AMD</th>}<th>Chave CT-e</th><th>Chave NF</th><th>Origem → Destino</th><th>Transportadora</th><th>Valor NF</th><th>Valor CT-e</th><th>Frete atual (AMD)</th><th>% NF atual</th><th>Adicional</th><th>Frete c/ adicional</th><th>% NF c/ adicional</th><th>Obs. auditoria</th><th>Valor autorizado</th><th>Justificativa *</th><th /></tr></thead>
            <tbody>
              {pendentes.map((item) => (
                <tr key={item.id}>
                  <td><input type="checkbox" checked={marcados.includes(item.id)} onChange={() => alternarMarcado(item.id)} /></td>
                  <td>{item.numero_pedido || '-'}</td>
                  <td><strong>{canaisReais.get(String(item.chave_cte || '').replace(/\D/g, '')) || (item.canal === 'SUPRIMENTOS' ? '-' : rotulo(item.canal))}</strong></td>
                  {canal === 'SUPRIMENTOS' && <td>{item.protocolo_amd || '-'}<br /><small>{item.tipo_ajuste || ''}</small>{(item.anexos || []).map((a) => <div key={a.path}><a href={a.url} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>📎 {a.nome}</a></div>)}</td>}
                  <td style={{ fontSize: 11 }}>{item.chave_cte || '-'}</td>
                  <td style={{ fontSize: 11 }}>{item.chave_nfe || (
                    <div style={{ display: 'flex', gap: 4, minWidth: 190 }}>
                      <input style={{ width: 150, fontSize: 11 }} placeholder="Chave NF (44 dig.)" value={campo(item.id, 'chaveNfe', '')} onChange={(e) => editar(item.id, 'chaveNfe', e.target.value.replace(/\D/g, '').slice(0, 44))} />
                      <button className="btn-secondary" disabled={processando === 'nfe-' + item.id} onClick={() => informarChaveNfe(item)}>Salvar</button>
                    </div>
                  )}</td>
                  <td>{item.cidade_origem || '-'} → {item.cidade_destino || '-'}</td>
                  <td>{item.transportadora || '-'}</td>
                  <td>{Number(item.valor_nf) > 0 ? dinheiro(item.valor_nf) : '-'}</td>
                  <td>{dinheiro(item.valor_cte)}</td>
                  <td>{dinheiro(item.valor_calculado)}</td>
                  <td>{formatarPct(analisarFrete(item).pctAtual)}</td>
                  <td><strong style={{ color: '#9b1111' }}>{dinheiro(item.valor_divergente)}</strong></td>
                  <td>{dinheiro(analisarFrete(item).freteComAdicional)}</td>
                  <td><strong>{formatarPct(analisarFrete(item).pctComAdicional)}</strong></td>
                  <td>{item.observacao_auditoria || '-'}</td>
                  <td><input style={{ width: 90 }} value={campo(item.id, 'valor', String(item.valor_divergente ?? ''))} onChange={(e) => editar(item.id, 'valor', e.target.value)} /></td>
                  <td><input value={campo(item.id, 'obs', '')} onChange={(e) => editar(item.id, 'obs', e.target.value)} placeholder="Justificativa (obrigatoria)" /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-primary" disabled={processando === item.id} onClick={() => decidir(item, true)}>Autorizar</button>{' '}
                    <button className="btn-secondary" disabled={processando === item.id} onClick={() => decidir(item, false)}>Recusar</button>
                    {canal === 'SUPRIMENTOS' && <>{' '}<button className="btn-secondary" disabled={processando === 'transferir'} onClick={() => transferir([item], campo(item.id, 'obs', ''))} title="Nao e de Suprimentos: passa para o transporte (destino escolhido na barra acima)">Transferir p/ transporte</button></>}
                  </td>
                </tr>
              ))}
              {!pendentes.length && <tr><td colSpan={18}>{carregando ? 'Carregando...' : 'Nenhum CT-e aguardando decisao.'}</td></tr>}
            </tbody>
          </table>
        </div></div>
      )}

      {aba === 'lancar' && (
        <div className="hint-box">
          <p style={{ marginTop: 0 }}>Informe a chave (CT-e ou nota fiscal, 44 digitos) <strong>ou</strong> o numero do pedido, e o valor que voce autorizou. O sistema ja procura o CT-e na base e vincula. Se a auditoria ainda nao rodou, o CT-e nem precisa vir pra fila.</p>
          <div className="form-grid three">
            <label className="field">Chave do CT-e ou da NF<input value={form.chave} onChange={(e) => setForm((f) => ({ ...f, chave: e.target.value }))} placeholder="44 digitos" /></label>
            <label className="field">Numero do pedido<input value={form.pedido} onChange={(e) => setForm((f) => ({ ...f, pedido: e.target.value }))} placeholder="Ex.: 7031847" /></label>
            <label className="field">Valor autorizado (R$)<input value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} placeholder="150,00" /></label>
            <label className="field">Observacao<input value={form.observacao} onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))} /></label>
          </div>
          <button className="btn-primary" disabled={processando === 'lancar'} onClick={lancar}>Lancar saldo autorizado</button>
        </div>
      )}

      {aba === 'historico' && (
        <div className="table-card">
          <div style={{ padding: '8px 0' }}>
            <select value={filtroFonte} onChange={(e) => setFiltroFonte(e.target.value)}>
              <option value="">Todas as fontes</option>
              <option value="IMPORTADO">Importado (planilha atacado)</option>
              <option value="LANCADO">Lancado pelo gestor</option>
              <option value="AUDITORIA">Fila da auditoria</option>
            </select>
          </div>
          <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead><tr><th>Decidido em</th><th>Fonte</th><th>Status</th><th>Pedido</th><th>Chave CT-e</th><th>Chave NF</th><th>Valor autorizado</th><th>Observacao</th><th>Por</th><th /></tr></thead>
            <tbody>
              {decididas.filter((item) => !filtroFonte || fonteAutorizacao(item) === filtroFonte).map((item) => (
                <tr key={item.id}>
                  <td>{dataHora(item.decidido_em)}</td>
                  <td>{{ IMPORTADO: 'Importado (planilha atacado)', GESTAO: 'Aprovacao de Gestao', LANCADO: 'Lancado pelo gestor', AUDITORIA: 'Fila da auditoria' }[fonteAutorizacao(item)]}</td>
                  <td>{item.status}</td>
                  <td>{item.numero_pedido || '-'}</td>
                  <td style={{ fontSize: 11 }}>{item.chave_cte || '-'}</td>
                  <td style={{ fontSize: 11 }}>{item.chave_nfe || '-'}</td>
                  <td>{dinheiro(item.valor_autorizado)}</td>
                  <td>{item.observacao_gestor || '-'}</td>
                  <td>{item.decidido_por || '-'}</td>
                  <td>{item.status === 'AUTORIZADA' && <button className="btn-secondary" onClick={() => remover(item)}>Remover</button>}</td>
                </tr>
              ))}
              {!decididas.length && <tr><td colSpan={10}>Nada decidido ainda.</td></tr>}
            </tbody>
          </table>
        </div></div>
      )}
    </div>
  );
}
