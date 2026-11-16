import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import { listarDecisoesNaoVistasAuditor, marcarCienciaAuditor } from '../services/transporteAutorizacoesService';
import { ACOES_RESPOSTA_TRANSPORTADORA, listarRespostasLaudoCteNaoVistas, listarRespostasTransportadoraNaoVistas, marcarCienciaRespostasLaudoCte, marcarCienciaRespostasTransportadora } from '../services/avisosAuditorService';

const INTERVALO_MS = 60000;
const NOME_CANAL = { SUPRIMENTOS: 'Suprimentos', B2C: 'Transporte B2C', ATACADO: 'Transporte Atacado', LOTACAO: 'Lotação' };
const moeda = (valor) => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const finalChave = (chave) => (chave ? `…${String(chave).slice(-9)}` : '-');
const resumir = (texto, max = 260) => { const t = String(texto || ''); return t.length > max ? `${t.slice(0, max)}…` : t; };

// Junta as duas fontes num formato so: decisoes de Suprimentos/Transporte sobre
// CT-es que o auditor enviou, e respostas da transportadora pelo portal nas
// faturas do auditor.
function normalizar(decisoes = [], respostas = [], laudosCte = []) {
  const a = decisoes.map((item) => ({
    chave: `D:${item.id}`,
    tipo: 'DECISAO',
    id: item.id,
    quando: item.decidido_em,
    positivo: item.status === 'AUTORIZADA',
    fatura: item.fatura,
    item,
  }));
  const b = respostas.map((item) => ({
    chave: `T:${item.id}`,
    tipo: 'TRANSPORTADORA',
    id: item.id,
    quando: item.created_at,
    positivo: ACOES_RESPOSTA_TRANSPORTADORA[item.acao]?.positivo ?? true,
    fatura: item.fatura,
    item,
  }));
  const c = laudosCte.map((grupo) => ({
    chave: `C:${grupo.id}`,
    tipo: 'LAUDO_CTE',
    id: grupo.id,
    quando: grupo.respondido_em,
    positivo: grupo.positivo,
    fatura: null,
    item: grupo,
  }));
  return [...a, ...b, ...c].sort((x, y) => String(y.quando || '').localeCompare(String(x.quando || '')));
}

// Aviso pro auditor de tudo que voltou pra ele e ja pode seguir:
//  - CT-e enviado pra aprovacao (Suprimentos, B2C, Atacado, Lotacao) foi decidido;
//  - a transportadora respondeu pelo portal numa fatura dele.
// Fica piscando no canto ate ele marcar "Ciente".
export default function AvisoDecisoesAuditor({ usuarioId = '', usuarioNome = '', usuarioEmail = '', oculto = false, onAbrirFatura, onAbrirAuditoriaCte }) {
  const [avisos, setAvisos] = useState([]);
  const [aberto, setAberto] = useState(false);
  const [novas, setNovas] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const vistos = useRef(null);

  const consultar = useCallback(async () => {
    if (!isSupabaseConfigured() || (!usuarioNome && !usuarioEmail)) return;
    // Cada fonte e independente: se uma falhar (ex.: migration nao aplicada), a outra segue.
    const [decisoes, respostas, laudosCte] = await Promise.all([
      listarDecisoesNaoVistasAuditor(usuarioNome).catch(() => []),
      listarRespostasTransportadoraNaoVistas({ nome: usuarioNome, email: usuarioEmail }).catch(() => []),
      listarRespostasLaudoCteNaoVistas({ id: usuarioId, nome: usuarioNome }).catch(() => []),
    ]);
    const lista = normalizar(decisoes, respostas, laudosCte);
    const antes = vistos.current;
    const chegaram = antes === null ? lista.length : lista.filter((aviso) => !antes.has(aviso.chave)).length;
    vistos.current = new Set(lista.map((aviso) => aviso.chave));
    setAvisos(lista);
    if (chegaram > 0) setNovas(chegaram);
  }, [usuarioId, usuarioNome, usuarioEmail]);

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

  const darCiencia = async (lista) => {
    setSalvando(true);
    try {
      const decisoes = lista.filter((a) => a.tipo === 'DECISAO').map((a) => a.id);
      const respostas = lista.filter((a) => a.tipo === 'TRANSPORTADORA').map((a) => a.id);
      const laudosCte = lista.filter((a) => a.tipo === 'LAUDO_CTE').flatMap((a) => a.item.ids);
      await Promise.all([
        laudosCte.length ? marcarCienciaRespostasLaudoCte(laudosCte) : null,
        decisoes.length ? marcarCienciaAuditor(decisoes) : null,
        respostas.length ? marcarCienciaRespostasTransportadora(respostas, usuarioNome) : null,
      ]);
      const chaves = new Set(lista.map((a) => a.chave));
      const restantes = avisos.filter((a) => !chaves.has(a.chave));
      setAvisos(restantes);
      if (!restantes.length) setAberto(false);
    } catch (error) {
      window.alert(error?.message || 'Nao foi possivel marcar como ciente.');
    } finally {
      setSalvando(false);
    }
  };

  const abrirFatura = (aviso) => {
    if (!onAbrirFatura) return;
    setAberto(false);
    onAbrirFatura(aviso.fatura || null);
  };

  if (!avisos.length || oculto) return null;

  const decisoes = avisos.filter((a) => a.tipo === 'DECISAO');
  const transportadora = avisos.filter((a) => a.tipo !== 'DECISAO');
  const cor = avisos.some((a) => a.positivo) ? '#15803d' : '#b45309';
  const partes = [
    decisoes.length ? `${decisoes.length} de Suprimentos/Transporte` : '',
    transportadora.length ? `${transportadora.length} da transportadora` : '',
  ].filter(Boolean).join(' · ');

  const renderDecisao = ({ item }) => {
    const aprovado = item.status === 'AUTORIZADA';
    return (
      <>
        <div>
          <span style={{ fontWeight: 700, color: aprovado ? '#15803d' : '#b91c1c' }}>{aprovado ? `✔ Aprovado ${moeda(item.valor_autorizado)}` : '✖ Recusado'}</span>
          {' · '}{NOME_CANAL[item.canal] || item.canal}
          {item.protocolo_amd ? ` · AMD ${item.protocolo_amd}` : ''}
        </div>
        <div style={{ color: '#334155' }}>
          {item.transportadora || '-'} · CT-e <span title={item.chave_cte || item.chave_nfe || ''}>{finalChave(item.chave_cte || item.chave_nfe)}</span>
          {item.numero_pedido ? ` · Pedido ${item.numero_pedido}` : ''}
          {item.fatura?.numero_fatura ? ` · Fatura ${item.fatura.numero_fatura}` : ''} · diferença {moeda(item.valor_divergente)}
        </div>
        <div style={{ color: '#64748b' }}>Por {item.decidido_por || '-'} em {dataHora(item.decidido_em)}</div>
        {item.observacao_gestor && <div style={{ color: '#475569', fontStyle: 'italic', marginTop: 2 }}>“{resumir(item.observacao_gestor)}”</div>}
      </>
    );
  };

  const renderResposta = ({ item }) => {
    const info = ACOES_RESPOSTA_TRANSPORTADORA[item.acao] || { rotulo: item.acao, cor: '#334155' };
    return (
      <>
        <div><span style={{ fontWeight: 700, color: info.cor }}>📨 {info.rotulo}</span></div>
        <div style={{ color: '#334155' }}>
          {item.fatura?.transportadora || '-'} · Fatura {item.fatura?.numero_fatura || '-'}
          {item.fatura?.valor_fatura ? ` · ${moeda(item.fatura.valor_fatura)}` : ''}
        </div>
        <div style={{ color: '#64748b' }}>Por {item.usuario_nome || 'portal'} em {dataHora(item.created_at)}</div>
        {item.descricao && <div style={{ color: '#475569', fontStyle: 'italic', marginTop: 2 }}>{resumir(item.descricao)}</div>}
      </>
    );
  };

  const renderLaudoCte = ({ item }) => (
    <>
      <div><span style={{ fontWeight: 700, color: item.positivo ? '#15803d' : '#b45309' }}>📋 Transportadora respondeu o laudo de CT-e</span></div>
      <div style={{ color: '#334155' }}>
        {item.transportadora || '-'}{item.processo?.codigo ? ` · Laudo ${item.processo.codigo}` : ''}
        {item.processo?.competencia ? ` · Competência ${item.processo.competencia}` : ''} · {item.ids.length} CT-e{item.ids.length === 1 ? '' : 's'}
      </div>
      <div style={{ color: '#334155' }}>{item.resumo}{item.valorProposto ? ` · desconto proposto ${moeda(item.valorProposto)}` : ''}</div>
      <div style={{ color: '#64748b' }}>Por {item.respondido_por || 'portal'} em {dataHora(item.respondido_em)} · aguardando sua validação</div>
    </>
  );

  return (
    <>
      <style>{'@keyframes aviso-pulso-auditor{0%,100%{box-shadow:0 0 0 0 rgba(21,128,61,.6);transform:scale(1)}50%{box-shadow:0 0 0 12px rgba(21,128,61,0);transform:scale(1.04)}}'}</style>
      {novas > 0 && !aberto && (
        <div style={{ position: 'fixed', right: 16, bottom: 334, zIndex: 9997, maxWidth: 300, background: '#fff', border: `1px solid ${cor}`, borderLeft: `5px solid ${cor}`, borderRadius: 10, padding: '10px 12px', boxShadow: '0 6px 20px rgba(0,0,0,.25)', fontSize: 13 }}>
          <strong>{novas === 1 ? 'Chegou uma resposta pra você' : `Chegaram ${novas} respostas pra você`}</strong>
          <div style={{ color: '#475569', marginTop: 2 }}>Aprovação ou resposta da transportadora — já dá pra seguir. Clique no botão verde.</div>
        </div>
      )}
      {aberto && (
        <div style={{ position: 'fixed', right: 16, bottom: 334, zIndex: 9999, width: 580, maxWidth: 'calc(100vw - 32px)', maxHeight: '60vh', overflow: 'auto', background: '#fff', border: `1px solid ${cor}`, borderLeft: `5px solid ${cor}`, borderRadius: 10, padding: 12, boxShadow: '0 8px 26px rgba(0,0,0,.3)', fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <strong>Respostas pra você seguir ({avisos.length})</strong>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn-secondary" disabled={salvando} onClick={() => darCiencia(avisos)}>Ciente de todas</button>
              <button type="button" className="btn-secondary" onClick={() => setAberto(false)} aria-label="Fechar">✕</button>
            </div>
          </div>
          {avisos.map((aviso) => (
            <div key={aviso.chave} style={{ borderTop: '1px solid #e2e8f0', padding: '8px 0', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {aviso.tipo === 'DECISAO' ? renderDecisao(aviso) : aviso.tipo === 'LAUDO_CTE' ? renderLaudoCte(aviso) : renderResposta(aviso)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {aviso.tipo === 'LAUDO_CTE' && onAbrirAuditoriaCte && (
                  <button type="button" className="btn-secondary" onClick={() => { setAberto(false); onAbrirAuditoriaCte(); }}>Validar respostas</button>
                )}
                {onAbrirFatura && (aviso.fatura?.numero_fatura || aviso.tipo === 'DECISAO') && (
                  <button type="button" className="btn-secondary" onClick={() => abrirFatura(aviso)}>{aviso.fatura?.numero_fatura ? 'Abrir fatura' : 'Ir p/ Faturas'}</button>
                )}
                <button type="button" className="btn-secondary" disabled={salvando} onClick={() => darCiencia([aviso])}>Ciente</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => { setNovas(0); setAberto((v) => !v); }}
        title="Aprovações de Suprimentos/Transporte e respostas da transportadora (faturas e laudo de CT-e) que voltaram pra você"
        style={{ position: 'fixed', right: 16, bottom: 286, zIndex: 9998, borderRadius: 999, padding: '8px 14px', cursor: 'pointer', border: 'none', background: cor, color: '#fff', fontWeight: 700, animation: aberto ? undefined : 'aviso-pulso-auditor 1.6s infinite' }}
      >
        🔔 Pra seguir: {partes}
      </button>
    </>
  );
}
