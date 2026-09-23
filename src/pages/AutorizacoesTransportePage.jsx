import { useEffect, useMemo, useState } from 'react';
import { carregarSessao } from '../utils/authLocal';
import {
  decidirAutorizacao,
  desativarAutorizacao,
  lancarSaldoAntecipado,
  listarAutorizacoes,
} from '../services/transporteAutorizacoesService';

const dinheiro = (valor) => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = (valor) => (valor ? new Date(valor).toLocaleString('pt-BR') : '-');
const rotulo = (canal) => (canal === 'B2C' ? 'B2C' : 'Atacado');

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
  const [form, setForm] = useState({ chave: '', pedido: '', valor: '', observacao: '' });

  const carregar = async () => {
    setCarregando(true);
    setErro('');
    try {
      setItens(await listarAutorizacoes({ canal }));
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
    setProcessando(item.id);
    setMensagem('');
    try {
      await decidirAutorizacao({
        id: item.id, autorizar, valorAutorizado, observacao: campo(item.id, 'obs', ''), usuarioNome,
      });
      setMensagem(autorizar
        ? `Autorizado ${dinheiro(valorAutorizado)} — na proxima reauditoria da fatura a divergencia desse CT-e sai.`
        : 'Solicitacao recusada.');
      await carregar();
    } catch (error) {
      setMensagem(error.message || String(error));
    } finally {
      setProcessando('');
    }
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
        <button className="btn-secondary" onClick={carregar} disabled={carregando}>{carregando ? 'Atualizando...' : '↻ Atualizar'}</button>
      </div>
      <div className="summary-strip audit-summary-grid">
        <div className="summary-card audit-kpi" style={{ borderLeft: '4px solid #9b1111' }}><span>Aguardando decisao</span><strong>{pendentes.length}</strong></div>
        <div className="summary-card audit-kpi" style={{ borderLeft: '4px solid #14733b' }}><span>Total autorizado</span><strong>{dinheiro(totalAutorizado)}</strong></div>
      </div>
      {erro && <div className="hint-box compact error-text">{erro}</div>}
      {mensagem && <div className="hint-box compact">{mensagem}</div>}

      {aba === 'fila' && (
        <div className="table-card"><div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead><tr><th>Pedido</th><th>Chave CT-e</th><th>Chave NF</th><th>Origem → Destino</th><th>Transportadora</th><th>Valor CT-e</th><th>Calculado</th><th>Divergente</th><th>Obs. auditoria</th><th>Valor autorizado</th><th>Sua observacao</th><th /></tr></thead>
            <tbody>
              {pendentes.map((item) => (
                <tr key={item.id}>
                  <td>{item.numero_pedido || '-'}</td>
                  <td style={{ fontSize: 11 }}>{item.chave_cte || '-'}</td>
                  <td style={{ fontSize: 11 }}>{item.chave_nfe || '-'}</td>
                  <td>{item.cidade_origem || '-'} → {item.cidade_destino || '-'}</td>
                  <td>{item.transportadora || '-'}</td>
                  <td>{dinheiro(item.valor_cte)}</td>
                  <td>{dinheiro(item.valor_calculado)}</td>
                  <td><strong style={{ color: '#9b1111' }}>{dinheiro(item.valor_divergente)}</strong></td>
                  <td>{item.observacao_auditoria || '-'}</td>
                  <td><input style={{ width: 90 }} value={campo(item.id, 'valor', String(item.valor_divergente ?? ''))} onChange={(e) => editar(item.id, 'valor', e.target.value)} /></td>
                  <td><input value={campo(item.id, 'obs', '')} onChange={(e) => editar(item.id, 'obs', e.target.value)} placeholder="Observacao" /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-primary" disabled={processando === item.id} onClick={() => decidir(item, true)}>Autorizar</button>{' '}
                    <button className="btn-secondary" disabled={processando === item.id} onClick={() => decidir(item, false)}>Recusar</button>
                  </td>
                </tr>
              ))}
              {!pendentes.length && <tr><td colSpan={12}>{carregando ? 'Carregando...' : 'Nenhum CT-e aguardando decisao.'}</td></tr>}
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
        <div className="table-card"><div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead><tr><th>Decidido em</th><th>Origem</th><th>Status</th><th>Pedido</th><th>Chave CT-e</th><th>Chave NF</th><th>Valor autorizado</th><th>Observacao</th><th>Por</th><th /></tr></thead>
            <tbody>
              {decididas.map((item) => (
                <tr key={item.id}>
                  <td>{dataHora(item.decidido_em)}</td>
                  <td>{item.origem === 'GESTOR' ? 'Lancado pelo gestor' : 'Fila da auditoria'}</td>
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
