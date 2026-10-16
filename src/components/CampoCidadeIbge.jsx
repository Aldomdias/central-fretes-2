import { useEffect, useRef, useState } from 'react';
import { consultarMunicipiosIbge } from '../services/ibgeService';

// Campo "CEP ou IBGE" com busca por cidade: digitou o nome (ex.: "recife", "recife pe"), aparece a
// lista de municipios e, ao escolher, o campo recebe o codigo IBGE. CEP/IBGE digitados continuam
// funcionando como antes (so numeros nao disparam a busca por nome).
export default function CampoCidadeIbge({ value, onChange, placeholder }) {
  const [opcoes, setOpcoes] = useState([]);
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [escolhido, setEscolhido] = useState('');
  const [rotulo, setRotulo] = useState('');
  const caixaRef = useRef(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const texto = String(value || '').trim();
    // So busca por nome quando ha letras (numeros = CEP/IBGE) e pelo menos 2 caracteres.
    if (texto.length < 2 || !/[A-Za-zÀ-ÿ]/.test(texto) || texto === escolhido) {
      setOpcoes([]); setAberto(false);
      return undefined;
    }
    let termo = texto;
    let uf = '';
    const m = texto.match(/^(.+?)[\s,/-]+([A-Za-z]{2})$/);
    if (m) { termo = m[1].trim(); uf = m[2].toUpperCase(); }
    const id = reqRef.current + 1;
    reqRef.current = id;
    const t = setTimeout(async () => {
      setCarregando(true);
      try {
        const linhas = await consultarMunicipiosIbge({ termo, uf, limite: 12, usarOficialSeVazio: true });
        if (reqRef.current === id) { setOpcoes(linhas || []); setAberto(true); }
      } catch {
        if (reqRef.current === id) setOpcoes([]);
      } finally {
        if (reqRef.current === id) setCarregando(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    const fora = (ev) => { if (caixaRef.current && !caixaRef.current.contains(ev.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  const escolher = (item) => {
    setEscolhido(String(item.ibge));
    setAberto(false);
    setOpcoes([]);
    onChange(String(item.ibge));
    setRotulo(`${item.cidade} - ${item.uf} (IBGE ${item.ibge})`);
  };

  return (
    <div ref={caixaRef} style={{ position: 'relative' }}>
      <input
        value={value || ''}
        placeholder={placeholder || 'Cidade, CEP ou IBGE (ex.: Recife, 88300000 ou 4208203)'}
        onChange={(ev) => { setRotulo(''); setEscolhido(''); onChange(ev.target.value); }}
        onFocus={() => { if (opcoes.length) setAberto(true); }}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') setAberto(false);
          if (ev.key === 'Enter' && aberto && opcoes.length) { ev.preventDefault(); escolher(opcoes[0]); }
        }}
        autoComplete="off"
      />
      {rotulo && <div style={{ fontSize: 12, color: '#14733b', marginTop: 2 }}>{rotulo}</div>}
      {aberto && (
        <div style={{ position: 'absolute', zIndex: 50, left: 0, right: 0, top: '100%', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, boxShadow: '0 8px 20px rgba(15,23,42,.15)', maxHeight: 260, overflowY: 'auto' }}>
          {carregando && <div style={{ padding: 8, fontSize: 12, color: '#64748b' }}>Buscando...</div>}
          {!carregando && !opcoes.length && <div style={{ padding: 8, fontSize: 12, color: '#64748b' }}>Nenhuma cidade encontrada.</div>}
          {opcoes.map((item) => (
            <button
              key={item.ibge} type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => escolher(item)}
              style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 12, padding: '7px 10px', border: 0, borderBottom: '1px solid #f1f5f9', background: '#fff', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}
            >
              <span>{item.cidade} - {item.uf}</span>
              <strong>{item.ibge}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
