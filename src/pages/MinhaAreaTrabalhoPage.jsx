import { useEffect, useMemo, useState } from 'react';
import { BLOCOS, MODELOS, blocoPermitido, blocosEfetivos, incluirPaginaNaArea, modeloParaPerfil, paginaNaArea, paginasDoUsuario, resolverBloco } from '../utils/areaTrabalho';
import { salvarPreferenciasInterface } from '../utils/preferenciasInterface';
import MonitorAtualizacoes from '../components/MonitorAtualizacoes';

export default function MinhaAreaTrabalhoPage({ usuario, preferencias, onPreferencias, onMudarPagina, onAbrirPainelGeral, onAbrirMenuRapido }) {
  const paginasUsuario = useMemo(() => paginasDoUsuario(usuario), [usuario]);
  const modeloInicial = preferencias.modeloArea || modeloParaPerfil(usuario?.perfil);
  const [editando, setEditando] = useState(false);
  const [blocos, setBlocos] = useState(() => blocosEfetivos(usuario, preferencias));
  const [arrastando, setArrastando] = useState(null);
  const [buscaAdicionar, setBuscaAdicionar] = useState('');

  useEffect(() => {
    // "fixados" virou so ordem: salva a lista ja convertida e descarta o campo.
    const { fixados: _antigo, ...resto } = preferencias;
    const nova = { ...resto, blocos, modeloArea: preferencias.modeloArea || modeloInicial };
    salvarPreferenciasInterface(usuario, nova);
    onPreferencias(nova);
  // O pai mantem a identidade do objeto sincronizada; persistimos apenas quando a composicao muda.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocos]);

  // O menu rapido (Alt+M) tambem inclui/remove telas: acompanha a mudanca vinda de fora.
  useEffect(() => {
    const externos = blocosEfetivos(usuario, preferencias);
    if (externos.join('|') !== blocos.join('|') && preferencias.blocos?.length) setBlocos(externos);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferencias.blocos]);

  const aplicarModelo = (id) => {
    const lista = MODELOS[id].blocos.filter((item) => blocoPermitido(usuario, item));
    const { fixados: _antigo, ...resto } = preferencias;
    const nova = { ...resto, modeloArea: id, blocos: lista };
    setBlocos(lista);
    salvarPreferenciasInterface(usuario, nova);
    onPreferencias(nova);
  };

  const mover = (id, direcao) => {
    setBlocos((atual) => {
      const origem = atual.indexOf(id);
      const destino = origem + direcao;
      if (origem < 0 || destino < 0 || destino >= atual.length) return atual;
      const proximo = [...atual];
      [proximo[origem], proximo[destino]] = [proximo[destino], proximo[origem]];
      return proximo;
    });
  };

  const moverPara = (origemId, destinoId) => {
    if (!origemId || !destinoId || origemId === destinoId) return;
    setBlocos((atual) => {
      const origem = atual.indexOf(origemId);
      const destino = atual.indexOf(destinoId);
      if (origem < 0 || destino < 0) return atual;
      const proximo = [...atual];
      const [movido] = proximo.splice(origem, 1);
      proximo.splice(destino, 0, movido);
      return proximo;
    });
  };

  const moverPeloPonteiro = (event, origemId) => {
    const alvo = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-workspace-block]');
    if (alvo?.dataset.workspaceBlock) moverPara(origemId, alvo.dataset.workspaceBlock);
  };

  const termo = buscaAdicionar.trim().toLowerCase();
  const ausentes = paginasUsuario
    .filter((p) => !paginaNaArea(blocos, p.chave))
    .filter((p) => !termo || `${p.label} ${p.grupo}`.toLowerCase().includes(termo));

  return (
    <div className="workspace-page page-shell">
      <header className="workspace-hero">
        <div>
          <span className="workspace-eyebrow">Minha Área de Trabalho</span>
          <h1>Olá, {usuario?.nome?.split(' ')[0] || 'usuário'}.</h1>
          <p>Seus fluxos mais importantes, organizados conforme seu acesso.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {onAbrirMenuRapido && !editando ? (
            <button type="button" className="btn-secondary" onClick={onAbrirMenuRapido} title="Abre de qualquer tela com Alt+M (ou Ctrl+K)">Menu rápido <kbd className="workspace-kbd">Alt+M</kbd></button>
          ) : null}
          {onAbrirPainelGeral && !editando ? (
            <button type="button" className="btn-secondary" onClick={onAbrirPainelGeral}>Painel geral e importações</button>
          ) : null}
          <button type="button" className="btn-secondary" onClick={() => setEditando((valor) => !valor)} aria-pressed={editando}>
            {editando ? 'Concluir personalização' : 'Personalizar área'}
          </button>
        </div>
      </header>

      <MonitorAtualizacoes usuario={usuario} onMudarPagina={onMudarPagina} />

      {editando && (
        <section className="workspace-editor" aria-label="Personalização da área de trabalho">
          <div className="workspace-models">
            <strong>Modelos iniciais</strong>
            {Object.entries(MODELOS).map(([id, modelo]) => (
              <button type="button" key={id} onClick={() => aplicarModelo(id)}>{modelo.nome}</button>
            ))}
            <button type="button" onClick={() => aplicarModelo(modeloParaPerfil(usuario?.perfil))}>Restaurar padrão do perfil</button>
          </div>
          <div className="workspace-add">
            <strong>Incluir tela</strong>
            <input
              type="search"
              className="workspace-add-busca"
              placeholder="Buscar tela…"
              value={buscaAdicionar}
              onChange={(event) => setBuscaAdicionar(event.target.value)}
            />
            {ausentes.map((p) => {
              const rico = Object.values(BLOCOS).find((b) => b.pagina === p.chave);
              return <button type="button" key={p.chave} title={p.grupo} onClick={() => setBlocos((lista) => incluirPaginaNaArea(lista, p.chave))}>+ {rico?.titulo || p.label}</button>;
            })}
            {ausentes.length === 0 && <span className="workspace-help">{termo ? 'Nenhuma tela encontrada.' : 'Todas as suas telas já estão na área.'}</span>}
          </div>
          <p className="workspace-help">Telas incluídas entram sempre no fim. Arraste pela alça ⠿ (ou use as setas) para mudar a posição.</p>
        </section>
      )}

      <section className="workspace-grid" aria-label="Blocos da área de trabalho">
        {blocos.map((id, indice) => {
          const bloco = resolverBloco(id);
          if (!bloco) return null;
          return (
            <article
              className={`workspace-card tone-${bloco.tom} ${editando ? '' : 'is-clickable'} ${arrastando === id ? 'is-dragging' : ''}`}
              key={id}
              role={editando ? undefined : 'button'}
              tabIndex={editando ? undefined : 0}
              onClick={editando ? undefined : () => onMudarPagina(bloco.pagina)}
              onKeyDown={editando ? undefined : (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onMudarPagina(bloco.pagina);
                }
              }}
              aria-label={editando ? undefined : `Abrir ${bloco.titulo}`}
              data-workspace-block={id}
              draggable={editando}
              onDragStart={editando ? (event) => {
                setArrastando(id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', id);
              } : undefined}
              onDragOver={editando ? (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } : undefined}
              onDrop={editando ? (event) => {
                event.preventDefault();
                moverPara(event.dataTransfer.getData('text/plain') || arrastando, id);
                setArrastando(null);
              } : undefined}
              onDragEnd={editando ? () => setArrastando(null) : undefined}
            >
              {editando && (
                <button
                  type="button"
                  className="workspace-drag-handle"
                  aria-label={`Arrastar ${bloco.titulo}`}
                  title="Arraste para mudar a posição"
                  onPointerDown={(event) => {
                    setArrastando(id);
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) moverPeloPonteiro(event, id);
                  }}
                  onPointerUp={(event) => {
                    event.currentTarget.releasePointerCapture?.(event.pointerId);
                    setArrastando(null);
                  }}
                  onPointerCancel={() => setArrastando(null)}
                >
                  <span aria-hidden="true">⠿</span> Arrastar
                </button>
              )}
              <div className="workspace-card-mark" aria-hidden="true" />
              <div className="workspace-card-copy">
                <span>{bloco.tom}</span>
                <h2>{bloco.titulo}</h2>
                <p>{bloco.descricao}</p>
              </div>
              {editando ? (
                <div className="workspace-card-controls" aria-label={`Organizar ${bloco.titulo}`}>
                  <button type="button" onClick={() => mover(id, -1)} disabled={indice === 0} aria-label={`Mover ${bloco.titulo} para cima`}>↑</button>
                  <button type="button" onClick={() => mover(id, 1)} disabled={indice === blocos.length - 1} aria-label={`Mover ${bloco.titulo} para baixo`}>↓</button>
                  <button type="button" className="danger" onClick={() => setBlocos((lista) => lista.filter((item) => item !== id))}>Remover</button>
                </div>
              ) : (
                <span className="workspace-open">Abrir <span aria-hidden="true">→</span></span>
              )}
            </article>
          );
        })}
      </section>

      {blocos.length === 0 && <div className="workspace-empty"><strong>Sua área está vazia.</strong><p>Use “Personalizar área” para adicionar um bloco ou restaurar um modelo.</p></div>}
    </div>
  );
}
