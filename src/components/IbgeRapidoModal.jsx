import { useEffect, useRef, useState } from 'react';
import { consultarMunicipiosIbge } from '../services/ibgeService';

const UFS = ['', 'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const estilo = {
  botao: { position: 'fixed', right: 16, bottom: 16, zIndex: 9998, borderRadius: 999, padding: '8px 14px', cursor: 'pointer', border: '1px solid #cbd5e1', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,.2)', fontWeight: 600 },
  painel: { position: 'fixed', right: 16, bottom: 104, zIndex: 9999, width: 420, maxWidth: 'calc(100vw - 32px)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', background: '#fff', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,.3)', padding: 12 },
  linha: { display: 'flex', gap: 6, marginBottom: 8 },
  input: { flex: '1 1 auto', width: 'auto', minWidth: 0, height: 36, padding: '0 10px', border: '1px solid #cbd5e1', borderRadius: 8, boxSizing: 'border-box', background: '#fff', color: '#0f172a' },
  select: { flex: '0 0 84px', width: 84, height: 36, padding: '0 6px', border: '1px solid #cbd5e1', borderRadius: 8, boxSizing: 'border-box', background: '#fff', color: '#0f172a' },
  buscar: { flex: '0 0 auto', height: 36, padding: '0 12px', border: 'none', borderRadius: 8, background: '#1d4ed8', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  lista: { overflowY: 'auto', flex: 1 },
  item: { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 4px', borderBottom: '1px solid #e2e8f0', cursor: 'pointer', fontSize: 13 },
};

export default function IbgeRapidoModal() {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const [uf, setUf] = useState('');
  const [resultados, setResultados] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [msg, setMsg] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && String(e.key).toLowerCase() === 'i') {
        e.preventDefault();
        setAberto((v) => !v);
      } else if (e.key === 'Escape') {
        setAberto(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (aberto) setTimeout(() => inputRef.current?.focus(), 0);
  }, [aberto]);

  async function pesquisar(e) {
    e?.preventDefault?.();
    if (!termo.trim() && !uf) return;
    setCarregando(true);
    setMsg('');
    try {
      const rows = await consultarMunicipiosIbge({ termo, uf, limite: 30, usarOficialSeVazio: true });
      setResultados(rows);
      if (!rows.length) setMsg('Nenhum município encontrado.');
    } catch (err) {
      setMsg(err.message || 'Erro ao consultar IBGE.');
    } finally {
      setCarregando(false);
    }
  }

  async function copiar(item) {
    try {
      await navigator.clipboard.writeText(String(item.ibge));
      setMsg(`IBGE ${item.ibge} copiado.`);
    } catch {
      setMsg('Não foi possível copiar.');
    }
  }

  return (
    <>
      <button type="button" style={estilo.botao} onClick={() => setAberto((v) => !v)} title="Consulta IBGE rápida (Alt+I)">
        IBGE (Alt+I)
      </button>
      {aberto ? (
        <div style={estilo.painel} role="dialog" aria-label="Consulta IBGE rápida">
          <div style={{ ...estilo.linha, justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Consulta IBGE</strong>
            <button type="button" onClick={() => setAberto(false)} style={{ cursor: 'pointer' }} aria-label="Fechar">✕</button>
          </div>
          <form style={estilo.linha} onSubmit={pesquisar}>
            <input ref={inputRef} style={estilo.input} value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Cidade, IBGE ou CEP" />
            <select style={estilo.select} value={uf} onChange={(e) => setUf(e.target.value)}>
              {UFS.map((u) => <option key={u || 'todas'} value={u}>{u || 'UF'}</option>)}
            </select>
            <button type="submit" style={estilo.buscar} disabled={carregando}>{carregando ? '...' : 'Buscar'}</button>
          </form>
          {msg ? <div style={{ fontSize: 12, marginBottom: 6 }}>{msg}</div> : null}
          <div style={estilo.lista}>
            {resultados.map((item) => (
              <div key={`${item.ibge}-${item.uf}`} style={estilo.item} onClick={() => copiar(item)} title="Clique para copiar o código IBGE">
                <span>{item.cidade} - {item.uf}</span>
                <strong>{item.ibge}</strong>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>Clique num resultado para copiar o IBGE. Esc fecha.</div>
        </div>
      ) : null}
    </>
  );
}
