import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import { listarDecisoesNaoVistasAuditor, marcarCienciaAuditor } from '../services/transporteAutorizacoesService';

const INTERVALO_MS = 60000;
const NOME_CANAL = { SUPRIMENTOS: 'Suprimentos', B2C: 'Transporte B2C', ATACADO: 'Transporte Atacado', LOTACAO: 'Lotação' };
const moeda = (valor) => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const finalChave = (chave) => (chave ? `…${String(chave).slice(-9)}` : '-');

// Aviso pro auditor: os CT-es que ele mandou pra aprovacao (Suprimentos ou
// transporte B2C/Atacado/Lotacao) e que ja foram decididos. Fica no canto ate
// ele marcar "Ciente" — assim sabe que o assunto ja pode seguir.
export default function AvisoDecisoesAuditor({ usuarioNome = '', oculto = false, onAbrirFaturas }) {
  const [itens, setItens] = useState([]);
  const [aberto, setAberto] = useState(false);
  const [novas, setNovas] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const vistos = useRef(null);

  const consultar = useCallback(async () => {
    if (!isSupabaseConfigured() || !usuarioNome) return;
    try {
      const lista = await listarDecisoesNaoVistasAuditor(usuarioNome);
      const antes = vistos.current;
      const chegaram = antes === null ? lista.length : lista.filter((item) => !antes.has(item.id)).length;
      vistos.current = new Set(lista.map((item) => item.id));
      setItens(lista);
      if (chegaram > 0) setNovas(chegaram);
    } catch { /* aviso e opcional: falha aqui nao pode atrapalhar a tela */ }
  }, [usuarioNome]);

  useEffect(() => {
    vistos.current = null;
    consultar();
    const timer = window.setInterval(consultar, INTERVALO_MS);
    const aoVoltar = () => { if (document.visibilityState === 'visible') consultar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [consultar]);

  useEffect(() => {
    if (!novas) return undefined;
    const t = window.setTimeout(() => setNovas(0), 12000);
    return () => window.clearTimeout(t);
  }, [novas]);

  const darCiencia = async (ids) => {
    setSalvando(true);
    try {
      await marcarCienciaAuditor(ids);
      const restantes = itens.filter((item) => !ids.includes(item.id));
      setItens(restantes);
      if (!restantes.length) setAberto(false);
    } catch (error) {
      window.alert(error?.message || 'Nao foi possivel marcar como ciente.');
    } finally {
      setSalvando(false);
    }
  };

  if (!itens.length || oculto) return null;

  const aprovadas = itens.filter((item) => item.status === 'AUTORIZADA').length;
  const recusadas = itens.length - aprovadas;
  const cor = aprovadas ? '#15803d' : '#b45309';

  return (
    <>
      {novas > 0 && !aberto && (
        <div style={{ position: 'fixed', right: 16, bottom: 334, zIndex: 9997, maxWidth: 300, background: '#fff', border: `1px solid ${cor}`, borderLeft: `5px solid ${cor}`, borderRadius: 10, padding: '10px 12px', boxShadow: '0 6px 20px rgba(0,0,0,.25)', fontSize: 13 }}>
          <strong>{novas === 1 ? 'Uma solicitação sua foi decidida' : `${novas} solicitações suas foram decididas`}</strong>
          <div style={{ color: '#475569', marginTop: 2 }}>Suprimentos/Transporte já responderam. Clique no botão verde para ver e seguir.</div>
        </div>
      )}
      {aberto && (
        <div style={{ position: 'fixed', right: 16, bottom: 334, zIndex: 9999, width: 560, maxWidth: 'calc(100vw - 32px)', maxHeight: '60vh', overflow: 'auto', background: '#fff', border: `1px solid ${cor}`, borderLeft: `5px solid ${cor}`, borderRadius: 10, padding: 12, boxShadow: '0 8px 26px rgba(0,0,0,.3)', fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <strong>Suas solicitações decididas ({itens.length})</strong>
            <div style={{ display: 'flex', gap: 6 }}>
              {onAbrirFaturas && <button type="button" className="btn-secondary" onClick={() => { setAberto(false); onAbrirFaturas(); }}>Ir para Faturas</button>}
              <button type="button" className="btn-secondary" disabled={salvando} onClick={() => darCiencia(itens.map((item) => item.id))}>Ciente de todas</button>
              <button type="button" className="btn-secondary" onClick={() => setAberto(false)} aria-label="Fechar">✕</button>
            </div>
          </div>
          {itens.map((item) => {
            const aprovado = item.status === 'AUTORIZADA';
            return (
              <div key={item.id} style={{ borderTop: '1px solid #e2e8f0', padding: '8px 0', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>
                    <span style={{ fontWeight: 700, color: aprovado ? '#15803d' : '#b91c1c' }}>{aprovado ? `✔ Aprovado ${moeda(item.valor_autorizado)}` : '✖ Recusado'}</span>
                    {' · '}{NOME_CANAL[item.canal] || item.canal}
                    {item.protocolo_amd ? ` · AMD ${item.protocolo_amd}` : ''}
                  </div>
                  <div style={{ color: '#334155' }}>
                    {item.transportadora || '-'} · CT-e <span title={item.chave_cte || item.chave_nfe || ''}>{finalChave(item.chave_cte || item.chave_nfe)}</span>
                    {item.numero_pedido ? ` · Pedido ${item.numero_pedido}` : ''} · diferença {moeda(item.valor_divergente)}
                  </div>
                  <div style={{ color: '#64748b' }}>Por {item.decidido_por || '-'} em {dataHora(item.decidido_em)}</div>
                  {item.observacao_gestor && <div style={{ color: '#475569', fontStyle: 'italic', marginTop: 2 }}>“{item.observacao_gestor}”</div>}
                </div>
                <button type="button" className="btn-secondary" disabled={salvando} onClick={() => darCiencia([item.id])}>Ciente</button>
              </div>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={() => { setNovas(0); setAberto((v) => !v); }}
        title="CT-es que você enviou para aprovação e que já foram decididos"
        style={{ position: 'fixed', right: 16, bottom: 286, zIndex: 9998, borderRadius: 999, padding: '8px 14px', cursor: 'pointer', border: 'none', background: cor, color: '#fff', fontWeight: 700, animation: novas ? 'aviso-pulso-verde 2s infinite' : undefined }}
      >
        <style>{'@keyframes aviso-pulso-verde{0%,100%{box-shadow:0 0 0 0 rgba(21,128,61,.55)}50%{box-shadow:0 0 0 10px rgba(21,128,61,0)}}'}</style>
        ✅ Decididas: {aprovadas} aprovada{aprovadas === 1 ? '' : 's'}{recusadas ? ` · ${recusadas} recusada${recusadas === 1 ? '' : 's'}` : ''}
      </button>
    </>
  );
}
