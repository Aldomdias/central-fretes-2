import { useEffect, useRef, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const INTERVALO_MS = 60000;

// Aviso fixo no canto direito (acima do IBGE) com quantas aprovacoes de
// Suprimentos estao aguardando decisao. Aparece ao entrar no sistema e quando
// chega uma nova, sem precisar abrir a tela de Autorizacoes Suprimentos.
export default function AvisoAprovacoesSuprimentos({ onAbrir }) {
  const [total, setTotal] = useState(0);
  const [novas, setNovas] = useState(0);
  const [minimizado, setMinimizado] = useState(false);
  const anterior = useRef(null);

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

  if (!total) return null;

  // Minimizado: so uma bolinha pequena, pra nao tampar outros botoes fixos (IBGE
  // etc.) atras dela. Clicar de novo expande a pilula normal.
  if (minimizado) {
    return (
      <button
        type="button"
        onClick={() => setMinimizado(false)}
        title={`${total} aprovação(ões) de Suprimentos aguardando — clique para expandir`}
        style={{ position: 'fixed', right: 16, bottom: 58, zIndex: 9998, width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', border: 'none', background: '#9b1111', color: '#fff', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {total}
      </button>
    );
  }

  return (
    <>
      <style>{'@keyframes aviso-pulso{0%,100%{box-shadow:0 0 0 0 rgba(155,17,17,.55)}50%{box-shadow:0 0 0 10px rgba(155,17,17,0)}}'}</style>
      {novas > 0 && (
        <div style={{ position: 'fixed', right: 16, bottom: 110, zIndex: 9997, maxWidth: 280, background: '#fff', border: '1px solid #9b1111', borderLeft: '5px solid #9b1111', borderRadius: 10, padding: '10px 12px', boxShadow: '0 6px 20px rgba(0,0,0,.25)', fontSize: 13 }}>
          <strong>{novas === 1 ? 'Nova aprovação de Suprimentos' : `${novas} aprovações de Suprimentos`}</strong>
          <div style={{ color: '#475569', marginTop: 2 }}>Aguardando decisão. Clique no botão vermelho para abrir.</div>
        </div>
      )}
      <div style={{ position: 'fixed', right: 16, bottom: 58, zIndex: 9998, display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          onClick={() => { setNovas(0); onAbrir?.(); }}
          title="Abrir Autorizações Suprimentos"
          style={{ borderRadius: 999, padding: '8px 14px', cursor: 'pointer', border: 'none', background: '#9b1111', color: '#fff', fontWeight: 700, animation: 'aviso-pulso 2s infinite' }}
        >
          🔔 Suprimentos: {total} aguardando
        </button>
        <button
          type="button"
          onClick={() => setMinimizado(true)}
          title="Minimizar"
          style={{ width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', border: '1px solid #9b1111', background: '#fff', color: '#9b1111', fontWeight: 700, fontSize: 12, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
        >
          −
        </button>
      </div>
    </>
  );
}
