import { useEffect, useRef, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const INTERVALO_MS = 60000;
const POSICAO_PADRAO = { right: 16, bottom: 58 };
const LIMIAR_ARRASTE_PX = 5;

const chavePosicao = (usuarioId) => `aviso_suprimentos_pos_v1:${usuarioId || 'local'}`;

function lerPosicao(usuarioId) {
  try {
    const salva = JSON.parse(localStorage.getItem(chavePosicao(usuarioId)) || 'null');
    if (salva && Number.isFinite(salva.right) && Number.isFinite(salva.bottom)) return salva;
  } catch { /* sem posicao salva: usa a padrao */ }
  return POSICAO_PADRAO;
}

// Mantem o botao inteiro dentro da janela (largura/altura aproximadas do botao).
function limitarPosicao({ right, bottom }) {
  const maxRight = Math.max(0, window.innerWidth - 260);
  const maxBottom = Math.max(0, window.innerHeight - 44);
  return { right: Math.min(Math.max(0, right), maxRight), bottom: Math.min(Math.max(0, bottom), maxBottom) };
}

// Aviso fixo no canto direito (acima do IBGE) com quantas aprovacoes de
// Suprimentos estao aguardando decisao. Aparece ao entrar no sistema e quando
// chega uma nova, sem precisar abrir a tela de Autorizacoes Suprimentos.
// `movivel`: so quem pode reposicionar (admin e negociacao) arrasta o botao; a
// posicao fica salva por usuario neste navegador. Os demais seguem com o padrao.
export default function AvisoAprovacoesSuprimentos({ onAbrir, oculto = false, movivel = false, usuarioId = '' }) {
  const [total, setTotal] = useState(0);
  const [novas, setNovas] = useState(0);
  const anterior = useRef(null);
  const [posicao, setPosicao] = useState(() => (movivel ? limitarPosicao(lerPosicao(usuarioId)) : POSICAO_PADRAO));
  const arraste = useRef(null);
  const arrastou = useRef(false);

  useEffect(() => {
    if (!movivel) return undefined;
    const aoRedimensionar = () => setPosicao((atual) => limitarPosicao(atual));
    window.addEventListener('resize', aoRedimensionar);
    return () => window.removeEventListener('resize', aoRedimensionar);
  }, [movivel]);

  const iniciarArraste = (evento) => {
    if (!movivel || (evento.button !== undefined && evento.button !== 0)) return;
    arrastou.current = false;
    arraste.current = { x: evento.clientX, y: evento.clientY, right: posicao.right, bottom: posicao.bottom };
    evento.currentTarget.setPointerCapture?.(evento.pointerId);
  };
  const moverArraste = (evento) => {
    const base = arraste.current;
    if (!base) return;
    const dx = evento.clientX - base.x;
    const dy = evento.clientY - base.y;
    if (!arrastou.current && Math.hypot(dx, dy) < LIMIAR_ARRASTE_PX) return;
    arrastou.current = true;
    // right/bottom crescem no sentido contrario ao movimento do mouse.
    setPosicao(limitarPosicao({ right: base.right - dx, bottom: base.bottom - dy }));
  };
  const terminarArraste = (evento) => {
    if (!arraste.current) return;
    arraste.current = null;
    evento.currentTarget.releasePointerCapture?.(evento.pointerId);
    if (arrastou.current) {
      try { localStorage.setItem(chavePosicao(usuarioId), JSON.stringify(posicao)); } catch { /* ok */ }
    }
  };
  const restaurarPosicao = () => {
    if (!movivel) return;
    setPosicao(POSICAO_PADRAO);
    try { localStorage.removeItem(chavePosicao(usuarioId)); } catch { /* ok */ }
  };

  useEffect(() => {
    if (!isSupabaseConfigured()) return undefined;
    let ativo = true;
    let esconder = null;
    const consultar = async () => {
      try {
        const { count, error } = await getSupabaseClient()
          .from('transporte_autorizacoes')
          .select('id', { count: 'exact', head: true })
          .eq('ativo', true).eq('canal', 'SUPRIMENTOS').eq('status', 'PENDENTE');
        if (error || !ativo) return;
        const atual = count || 0;
        const antes = anterior.current;
        // Primeira leitura: avisa tudo que ja esta pendente; depois, so o que chegou.
        const chegaram = antes === null ? atual : Math.max(atual - antes, 0);
        anterior.current = atual;
        setTotal(atual);
        if (chegaram > 0) {
          setNovas(chegaram);
          window.clearTimeout(esconder);
          esconder = window.setTimeout(() => setNovas(0), 12000);
        }
      } catch { /* aviso e opcional: falha aqui nao pode atrapalhar a tela */ }
    };
    consultar();
    const timer = window.setInterval(consultar, INTERVALO_MS);
    const aoVoltar = () => { if (document.visibilityState === 'visible') consultar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      ativo = false;
      window.clearInterval(timer);
      window.clearTimeout(esconder);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, []);

  if (!total || oculto) return null;

  return (
    <>
      <style>{'@keyframes aviso-pulso{0%,100%{box-shadow:0 0 0 0 rgba(155,17,17,.55)}50%{box-shadow:0 0 0 10px rgba(155,17,17,0)}}'}</style>
      {novas > 0 && (
        <div style={{ position: 'fixed', right: posicao.right, bottom: posicao.bottom + 52, zIndex: 9997, maxWidth: 280, background: '#fff', border: '1px solid #9b1111', borderLeft: '5px solid #9b1111', borderRadius: 10, padding: '10px 12px', boxShadow: '0 6px 20px rgba(0,0,0,.25)', fontSize: 13 }}>
          <strong>{novas === 1 ? 'Nova aprovação de Suprimentos' : `${novas} aprovações de Suprimentos`}</strong>
          <div style={{ color: '#475569', marginTop: 2 }}>Aguardando decisão. Clique no botão vermelho para abrir.</div>
        </div>
      )}
      <button
        type="button"
        onClick={() => { if (arrastou.current) { arrastou.current = false; return; } setNovas(0); onAbrir?.(); }}
        onPointerDown={iniciarArraste}
        onPointerMove={moverArraste}
        onPointerUp={terminarArraste}
        onPointerCancel={terminarArraste}
        onDoubleClick={restaurarPosicao}
        title={movivel ? 'Abrir Autorizações Suprimentos — arraste para mover; duplo clique volta ao lugar original' : 'Abrir Autorizações Suprimentos'}
        style={{ position: 'fixed', right: posicao.right, bottom: posicao.bottom, zIndex: 9998, touchAction: movivel ? 'none' : undefined, userSelect: 'none', borderRadius: 999, padding: '8px 14px', cursor: movivel ? 'grab' : 'pointer', border: 'none', background: '#9b1111', color: '#fff', fontWeight: 700, animation: 'aviso-pulso 2s infinite' }}
      >
        🔔 Suprimentos: {total} aguardando
      </button>
    </>
  );
}
