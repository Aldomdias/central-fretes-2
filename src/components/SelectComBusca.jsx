import { useEffect, useMemo, useRef, useState } from 'react';

const normalizar = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Campo de seleção com busca: digita parte do nome e escolhe na lista filtrada.
 * opcoes: [{ value, label, extra? (texto adicional que também entra na busca), title? }]
 */
export default function SelectComBusca({ value, onChange, opcoes = [], placeholder = 'Digite para buscar…', rotuloVazio = 'Todas', style }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [destaque, setDestaque] = useState(0);
  const caixaRef = useRef(null);
  const listaRef = useRef(null);

  const selecionada = opcoes.find((o) => o.value === value);

  const filtradas = useMemo(() => {
    const termo = normalizar(busca).trim();
    const base = [{ value: '', label: rotuloVazio }, ...opcoes];
    if (!termo) return base;
    const partes = termo.split(/\s+/);
    return opcoes.filter((o) => {
      const alvo = normalizar(`${o.label} ${o.extra || ''}`);
      return partes.every((p) => alvo.includes(p));
    });
  }, [busca, opcoes, rotuloVazio]);

  useEffect(() => {
    if (!aberto) return undefined;
    const fechar = (e) => { if (caixaRef.current && !caixaRef.current.contains(e.target)) { setAberto(false); setBusca(''); } };
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [aberto]);

  useEffect(() => { setDestaque(0); }, [busca]);

  useEffect(() => {
    const el = listaRef.current?.children?.[destaque];
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [destaque]);

  function escolher(op) {
    onChange(op.value);
    setAberto(false);
    setBusca('');
  }

  function teclado(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAberto(true); setDestaque((d) => Math.min(d + 1, filtradas.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setDestaque((d) => Math.max(d - 1, 0)); }
    else if (e.key === 'Enter') { if (aberto && filtradas[destaque]) { e.preventDefault(); escolher(filtradas[destaque]); } }
    else if (e.key === 'Escape') { setAberto(false); setBusca(''); }
  }

  return (
    <div ref={caixaRef} style={{ position: 'relative', ...style }}>
      <input
        type="text"
        value={aberto ? busca : (selecionada?.label || '')}
        placeholder={aberto ? (selecionada?.label || placeholder) : (value ? '' : rotuloVazio)}
        onFocus={() => { setAberto(true); setBusca(''); }}
        onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
        onKeyDown={teclado}
        title={selecionada?.title}
        style={{ width: '100%', paddingRight: value ? 26 : undefined }}
        autoComplete="off"
      />
      {value && !aberto && (
        <button type="button" onClick={() => onChange('')} title="Limpar" aria-label="Limpar"
          style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 0, background: 'transparent', cursor: 'pointer', color: '#64748b', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
      )}
      {aberto && (
        <ul ref={listaRef} role="listbox"
          style={{ position: 'absolute', zIndex: 50, left: 0, right: 0, top: '100%', marginTop: 2, maxHeight: 280, overflowY: 'auto', listStyle: 'none', padding: 0, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, boxShadow: '0 6px 18px rgba(15,23,42,.15)' }}>
          {filtradas.length === 0 && <li style={{ padding: '6px 10px', color: '#64748b', fontSize: 13 }}>Nenhuma encontrada</li>}
          {filtradas.map((o, i) => (
            <li key={o.value || '__vazio'} role="option" aria-selected={o.value === value} title={o.title}
              onMouseDown={(e) => { e.preventDefault(); escolher(o); }}
              onMouseEnter={() => setDestaque(i)}
              style={{ padding: '6px 10px', fontSize: 13, cursor: 'pointer', background: i === destaque ? '#e8eefc' : o.value === value ? '#f1f5f9' : '#fff', fontWeight: o.value === value ? 600 : 400, color: '#0f172a' }}>
              {o.label}{o.sufixo ? <span style={{ color: '#64748b' }}>{o.sufixo}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
