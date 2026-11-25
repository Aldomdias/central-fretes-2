import { useEffect, useMemo, useRef, useState } from 'react';
import {
  blocosEfetivos,
  incluirPaginaNaArea,
  paginaNaArea,
  paginasDoUsuario,
  removerPaginaDaArea,
  resolverBloco,
} from '../utils/areaTrabalho';

function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Menu rapido: Alt+M (ou Ctrl+K) em qualquer tela abre os itens da Minha Area
// de Trabalho e a busca de todas as telas. A estrela inclui/remove a tela da
// area (sempre no fim da fila; nunca substitui outro bloco).
export default function MenuRapido({ usuario, preferencias, onPreferencias, paginaAtual, onMudarPagina, aberto, onAbrir, onFechar }) {
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState(0);
  const inputRef = useRef(null);
  const listaRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      const tecla = String(event.key).toLowerCase();
      const altM = event.altKey && !event.ctrlKey && !event.metaKey && tecla === 'm';
      const ctrlK = (event.ctrlKey || event.metaKey) && !event.altKey && tecla === 'k';
      if (altM || ctrlK) {
        event.preventDefault();
        if (aberto) onFechar(); else onAbrir();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberto, onAbrir, onFechar]);

  useEffect(() => {
    if (!aberto) return;
    setBusca('');
    setSelecionado(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [aberto]);

  const area = useMemo(() => blocosEfetivos(usuario, preferencias), [usuario, preferencias]);
  const paginas = useMemo(() => paginasDoUsuario(usuario), [usuario]);

  const itens = useMemo(() => {
    const termo = normalizar(busca.trim());
    const daArea = area.map((id) => {
      const bloco = resolverBloco(id);
      return { chave: bloco.pagina, label: bloco.titulo, grupo: 'Minha área', naArea: true };
    });
    if (!termo) return daArea;
    const casa = (item) => normalizar(`${item.label} ${item.grupo}`).includes(termo);
    const areaFiltrada = daArea.filter(casa);
    const outras = paginas
      .filter((p) => !paginaNaArea(area, p.chave))
      .map((p) => ({ chave: p.chave, label: p.label, grupo: p.grupo, naArea: false }))
      .filter(casa);
    return [...areaFiltrada, ...outras];
  }, [busca, area, paginas]);

  useEffect(() => { setSelecionado(0); }, [busca]);
  useEffect(() => {
    listaRef.current?.querySelector('[data-selecionado="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [selecionado]);

  if (!aberto) return null;

  const salvarArea = (lista) => {
    const { fixados: _antigo, ...resto } = preferencias;
    onPreferencias({ ...resto, blocos: lista });
  };
  const alternarArea = (chave) => {
    salvarArea(paginaNaArea(area, chave) ? removerPaginaDaArea(area, chave) : incluirPaginaNaArea(area, chave));
  };
  const abrir = (chave) => {
    onFechar();
    onMudarPagina(chave);
  };

  const atualNaArea = paginaAtual && paginas.some((p) => p.chave === paginaAtual) ? paginaNaArea(area, paginaAtual) : null;
  const labelAtual = paginas.find((p) => p.chave === paginaAtual)?.label;

  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); onFechar(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelecionado((i) => Math.min(i + 1, itens.length - 1)); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelecionado((i) => Math.max(i - 1, 0)); return; }
    if (event.key === 'Enter' && itens[selecionado]) { event.preventDefault(); abrir(itens[selecionado].chave); }
  };

  return (
    <div className="menu-rapido-fundo" onMouseDown={(event) => { if (event.target === event.currentTarget) onFechar(); }}>
      <div className="menu-rapido" role="dialog" aria-modal="true" aria-label="Menu rápido" onKeyDown={onKeyDown}>
        <div className="menu-rapido-topo">
          <input
            ref={inputRef}
            type="search"
            placeholder="Ir para… (digite o nome da tela)"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            aria-label="Buscar tela"
          />
          <kbd>Esc</kbd>
        </div>

        {atualNaArea !== null && (
          <button type="button" className="menu-rapido-atual" onClick={() => alternarArea(paginaAtual)}>
            {atualNaArea ? '★ Remover esta tela da área' : '☆ Incluir esta tela na área'}
            <span>{labelAtual}</span>
          </button>
        )}

        <div className="menu-rapido-lista" ref={listaRef} role="listbox">
          {!busca && <div className="menu-rapido-secao">Minha área de trabalho</div>}
          {itens.map((item, indice) => (
            <div
              key={item.chave}
              role="option"
              aria-selected={indice === selecionado}
              data-selecionado={indice === selecionado}
              className={`menu-rapido-item ${indice === selecionado ? 'is-selected' : ''} ${item.chave === paginaAtual ? 'is-current' : ''}`}
              onMouseEnter={() => setSelecionado(indice)}
              onClick={() => abrir(item.chave)}
            >
              <span className="menu-rapido-label">{item.label}</span>
              <span className="menu-rapido-grupo">{item.grupo}</span>
              <button
                type="button"
                className={`menu-rapido-estrela ${item.naArea ? 'on' : ''}`}
                title={item.naArea ? 'Remover da área de trabalho' : 'Incluir na área de trabalho (vai para o fim)'}
                aria-label={item.naArea ? `Remover ${item.label} da área` : `Incluir ${item.label} na área`}
                onClick={(event) => { event.stopPropagation(); alternarArea(item.chave); }}
              >
                {item.naArea ? '★' : '☆'}
              </button>
            </div>
          ))}
          {itens.length === 0 && (
            <div className="menu-rapido-vazio">
              {busca ? 'Nenhuma tela encontrada.' : 'Sua área está vazia. Digite para buscar uma tela e clique na ☆ para incluir.'}
            </div>
          )}
        </div>

        <div className="menu-rapido-rodape">
          <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
          <span><kbd>Enter</kbd> abrir</span>
          <span>☆ incluir na área</span>
          <span><kbd>Alt+M</kbd> ou <kbd>Ctrl+K</kbd> abre/fecha</span>
        </div>
      </div>
    </div>
  );
}
