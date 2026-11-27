import { useEffect, useMemo, useState } from 'react';
import {
  carregarFornecedoresCompras,
  formatarCnpj,
  lerFornecedoresColados,
  removerFornecedorCompras,
  salvarFornecedorCompras,
  salvarFornecedoresEmLote,
  soDigitosCnpj,
} from '../services/fornecedoresComprasService';
import { carregarSessao } from '../utils/authLocal';

const VAZIO = { codigo: '', nome: '', cnpj: '', ativo: true };

// Cadastro dos fornecedores de compras (CNPJ do expedidor/remetente). Usado no Diagnostico (modal) e em Ferramentas.
export default function FornecedoresComprasCadastro({ modal = false, onFechar }) {
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState(VAZIO);
  const [colado, setColado] = useState('');
  const [busca, setBusca] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [salvando, setSalvando] = useState(false);
  const usuario = carregarSessao()?.nome || '';

  const recarregar = async () => {
    try { setErr(''); setLista(await carregarFornecedoresCompras({ forcar: true })); } catch (e) { setErr(e.message || String(e)); }
  };
  useEffect(() => { recarregar(); }, []);
  useEffect(() => {
    if (!modal) return undefined;
    const esc = (e) => { if (e.key === 'Escape') onFechar?.(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [modal, onFechar]);

  const filtrada = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const d = soDigitosCnpj(busca);
    if (!t) return lista;
    return lista.filter((f) => String(f.nome || '').toLowerCase().includes(t) || String(f.codigo || '').includes(t) || (d && String(f.cnpj).includes(d)));
  }, [lista, busca]);
  const previa = useMemo(() => lerFornecedoresColados(colado), [colado]);

  const executar = async (fn, ok) => {
    setSalvando(true); setMsg(''); setErr('');
    try { const r = await fn(); setMsg(typeof ok === 'function' ? ok(r) : ok); await recarregar(); } catch (e) { setErr(e.message || String(e)); } finally { setSalvando(false); }
  };
  const salvar = (e) => {
    e.preventDefault();
    executar(async () => { await salvarFornecedorCompras(form, usuario); setForm(VAZIO); }, form.id ? 'Fornecedor atualizado.' : 'Fornecedor incluído. O Diagnóstico já reconfere as faturas.');
  };
  const importarColado = () => executar(async () => { const n = await salvarFornecedoresEmLote(previa, usuario); setColado(''); return n; }, (n) => `${n} fornecedor(es) gravado(s). CNPJ já cadastrado foi atualizado.`);
  const alternarAtivo = (f) => executar(() => salvarFornecedorCompras({ ...f, ativo: !f.ativo }, usuario), f.ativo ? 'Marcado como inativo.' : 'Marcado como ativo.');
  const remover = (f) => {
    if (!window.confirm(`Remover ${f.nome} (${formatarCnpj(f.cnpj)}) da lista de fornecedores de compras?`)) return;
    executar(() => removerFornecedorCompras(f.id), 'Fornecedor removido.');
  };

  const corpo = (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="compact" style={{ color: '#475569' }}>
        Nas compras o expedidor/remetente do CT-e é o fornecedor. Fatura com pelo menos um CT-e de um destes CNPJs entra no card
        <strong> Compras (CT-e de fornecedor)</strong> do Diagnóstico. Ativos e inativos contam (CT-e antigo de fornecedor inativo continua sendo compra).
      </div>
      {err && <div style={{ color: '#9b1111', fontWeight: 600 }}>{err}</div>}
      {msg && <div style={{ color: '#14733b', fontWeight: 600 }}>{msg}</div>}

      <form onSubmit={salvar} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 190px auto auto', gap: 8, alignItems: 'end' }}>
        <label className="field">Código<input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="SAP" /></label>
        <label className="field">Nome<input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: PIRELLI" /></label>
        <label className="field">CNPJ<input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" /></label>
        <label className="compact" style={{ display: 'flex', gap: 4, alignItems: 'center', paddingBottom: 8 }}><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Ativo</label>
        <span style={{ display: 'flex', gap: 6 }}>
          <button type="submit" className="btn-primary" disabled={salvando}>{form.id ? 'Salvar' : 'Incluir'}</button>
          {form.id && <button type="button" className="btn-secondary" onClick={() => setForm(VAZIO)}>Cancelar</button>}
        </span>
      </form>

      <details>
        <summary style={{ cursor: 'pointer' }}>Colar vários da planilha (código, nome, CNPJ, status)</summary>
        <textarea value={colado} onChange={(e) => setColado(e.target.value)} rows={5} style={{ width: '100%', marginTop: 6, fontFamily: 'monospace', fontSize: 12 }} placeholder={'18741\tBRIDGESTONE\t57.497.539/0001-15\tATIVO'} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <span className="compact">{previa.length} CNPJ(s) reconhecido(s)</span>
          <button type="button" className="btn-primary" disabled={!previa.length || salvando} onClick={importarColado}>Gravar colados</button>
        </div>
      </details>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar por nome, código ou CNPJ" style={{ flex: 1 }} />
        <span className="compact">{filtrada.length} de {lista.length} · {lista.filter((f) => f.ativo).length} ativo(s)</span>
      </div>
      <div style={{ maxHeight: modal ? '45vh' : 420, overflow: 'auto' }}>
        <table className="data-table compact">
          <thead><tr><th>Código</th><th>Fornecedor</th><th>CNPJ</th><th>Status</th><th>Incluído por</th><th /></tr></thead>
          <tbody>
            {filtrada.map((f) => (
              <tr key={f.id}>
                <td>{f.codigo || '-'}</td>
                <td>{f.nome}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatarCnpj(f.cnpj)}</td>
                <td><button type="button" className="btn-secondary" disabled={salvando} onClick={() => alternarAtivo(f)} style={{ color: f.ativo ? '#14733b' : '#64748b', fontWeight: 600 }} title="Clique para alternar">{f.ativo ? 'Ativo' : 'Inativo'}</button></td>
                <td>{f.criado_por || '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn-secondary" onClick={() => setForm({ id: f.id, codigo: f.codigo || '', nome: f.nome, cnpj: formatarCnpj(f.cnpj), ativo: f.ativo })}>Editar</button>{' '}
                  <button type="button" className="btn-secondary" disabled={salvando} onClick={() => remover(f)}>Remover</button>
                </td>
              </tr>
            ))}
            {!filtrada.length && <tr><td colSpan={6}>{lista.length ? 'Nenhum fornecedor neste filtro.' : 'Nenhum fornecedor cadastrado.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (!modal) return <div style={{ padding: 20 }}>{corpo}</div>;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar?.(); }}>
      <div className="panel-card" role="dialog" aria-label="Fornecedores de compras" style={{ width: 'min(920px, 94vw)', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong>Fornecedores de compras</strong>
          <button type="button" className="btn-secondary" onClick={onFechar}>Fechar</button>
        </div>
        {corpo}
      </div>
    </div>
  );
}
