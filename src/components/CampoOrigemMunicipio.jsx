import { useEffect, useRef, useState } from 'react';
import { consultarMunicipiosIbge } from '../services/ibgeService';

function semAcento(valor) {
  return String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

function distancia(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Campo de cidade de origem com sugestao de municipios do IBGE (nome correto + UF + codigo IBGE).
// Tolera erro de digitacao ("Ribeirao Pretto" sugere Ribeirao Preto). Ao escolher chama
// onSelect({ cidade, uf, ibge }); digitar livremente chama onTexto(texto).
export default function CampoOrigemMunicipio({ value, uf, onTexto, onSelect, placeholder }) {
  const [opcoes, setOpcoes] = useState([]);
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [confirmada, setConfirmada] = useState(null);
  const caixaRef = useRef(null);
  const reqRef = useRef(0);
  const escolhidoRef = useRef('');

  useEffect(() => {
    const texto = String(value || '').trim();
    if (texto.length < 3) {
      setOpcoes([]); setAberto(false); setConfirmada(null);
      return undefined;
    }
    const id = reqRef.current + 1;
    reqRef.current = id;
    const t = setTimeout(async () => {
      setCarregando(true);
      try {
        const ufFiltro = String(uf || '').trim().toUpperCase();
        let linhas = await consultarMunicipiosIbge({ termo: texto, uf: ufFiltro, limite: 15, usarOficialSeVazio: true });
        const chave = semAcento(texto);
        if (!linhas?.length && chave.length >= 4) {
          // Sem resultado: provavelmente erro de digitacao. Busca pelo comeco e ordena por semelhanca.
          const amplas = await consultarMunicipiosIbge({ termo: chave.slice(0, 4), uf: ufFiltro, limite: 200, usarOficialSeVazio: true });
          linhas = (amplas || [])
            .map((item) => ({ item, d: distancia(chave, semAcento(item.cidade)) }))
            .filter((x) => x.d <= Math.max(2, Math.floor(chave.length / 4)))
            .sort((a, b) => a.d - b.d)
            .slice(0, 8)
            .map((x) => x.item);
        }
        if (reqRef.current !== id) return;
        const exato = (linhas || []).find((item) => semAcento(item.cidade) === chave && (!ufFiltro || item.uf === ufFiltro));
        setConfirmada(exato || false);
        setOpcoes(linhas || []);
        setAberto(texto !== escolhidoRef.current && !exato);
      } catch {
        if (reqRef.current === id) { setOpcoes([]); setConfirmada(null); }
      } finally {
        if (reqRef.current === id) setCarregando(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [value, uf]);

  useEffect(() => {
    const fora = (ev) => { if (caixaRef.current && !caixaRef.current.contains(ev.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  const escolher = (item) => {
    escolhidoRef.current = item.cidade;
    setAberto(false);
    setOpcoes([]);
    onSelect({ cidade: item.cidade, uf: item.uf, ibge: item.ibge });
  };

  return (
    <div ref={caixaRef} style={{ position: 'relative' }}>
      <input
        value={value || ''}
        placeholder={placeholder || 'Digite a cidade (ex.: Ribeirão Preto)'}
        onChange={(ev) => { escolhidoRef.current = ''; onTexto(ev.target.value); }}
        onFocus={() => { if (opcoes.length && !confirmada) setAberto(true); }}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') setAberto(false);
          if (ev.key === 'Enter' && aberto && opcoes.length) { ev.preventDefault(); escolher(opcoes[0]); }
        }}
        autoComplete="off"
      />
      {confirmada ? (
        <div style={{ fontSize: 12, color: '#14733b', marginTop: 2 }}>✔ {confirmada.cidade}/{confirmada.uf} · IBGE {confirmada.ibge}</div>
      ) : null}
      {confirmada === false && !carregando ? (
        <div style={{ fontSize: 12, color: '#b45309', marginTop: 2 }}>Nome não confere com o IBGE. Escolha uma das sugestões.</div>
      ) : null}
      {aberto ? (
        <div style={{ position: 'absolute', zIndex: 50, left: 0, right: 0, top: '100%', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, boxShadow: '0 8px 20px rgba(15,23,42,.15)', maxHeight: 260, overflowY: 'auto' }}>
          {carregando ? <div style={{ padding: 8, fontSize: 12, color: '#64748b' }}>Buscando...</div> : null}
          {!carregando && !opcoes.length ? <div style={{ padding: 8, fontSize: 12, color: '#64748b' }}>Nenhuma cidade encontrada.</div> : null}
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
      ) : null}
    </div>
  );
}
