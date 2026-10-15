import { useEffect, useMemo, useState } from 'react';
import { carregarSessao } from '../utils/authLocal';
import {
  aprovarLaudosRobo, DECISAO, desfazerAprovacaoLaudoRobo, listarFilaAuditorRobo, reavaliarFaturaRobo,
} from '../services/auditorRoboService';

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const diasDesde = (iso) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

// O que o robo deixou para o auditor: laudos para dar o OK e casos para revisar.
// faturas = faturas do recorte atual (por auditor) ja carregadas na Auditoria.
export default function FilaRoboAuditor({ faturas, onAbrirFatura }) {
  const sessao = carregarSessao();
  const [fila, setFila] = useState(null);
  const [aba, setAba] = useState('laudos');
  const [aberto, setAberto] = useState(true);
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = () => listarFilaAuditorRobo().then(setFila).catch((e) => { setErro(e.message); setFila([]); });
  useEffect(() => { carregar(); }, []);

  const porId = useMemo(() => new Map((faturas || []).map((f) => [String(f.id), f])), [faturas]);
  // So casos cuja fatura ainda esta em auditoria e dentro do recorte do auditor.
  const itens = useMemo(() => (fila || []).map((e) => ({ e, f: porId.get(String(e.fatura_id)) })).filter((x) => x.f), [fila, porId]);
  const laudos = itens.filter((x) => x.e.decisao === DECISAO.ENVIAR_LAUDO);
  const aguardandoOk = laudos.filter((x) => !x.e.aprovado_auditor_em);
  const aprovados = laudos.filter((x) => x.e.aprovado_auditor_em);
  const revisar = itens.filter((x) => x.e.decisao === DECISAO.REVISAO_AUDITOR);

  const alternar = (id) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const aprovar = async (ids) => {
    if (!ids.length || busy) return;
    if (ids.length > 1 && !window.confirm(`Aprovar o laudo de ${ids.length} fatura(s)?`)) return;
    setBusy(true); setErro('');
    try {
      await aprovarLaudosRobo(ids, sessao?.nome || sessao?.email || 'auditor');
      setSel(new Set());
      await carregar();
    } catch (e) { setErro(e.message); } finally { setBusy(false); }
  };
  const [reavaliando, setReavaliando] = useState('');
  const [aviso, setAviso] = useState('');
  const reavaliar = async (e, f) => {
    if (reavaliando) return;
    setReavaliando(String(f.id)); setErro(''); setAviso('');
    try {
      const reg = await reavaliarFaturaRobo(f, e, { usuario: sessao?.nome || sessao?.email || 'auditor' });
      setAviso(reg.acao_executada ? `Fatura ${f.numero_fatura}: correta, enviada para a aprovacao da gestao.` : `Fatura ${f.numero_fatura} reavaliada: ${reg.motivo}`);
      await carregar();
    } catch (ex) { setErro(ex.message); } finally { setReavaliando(''); }
  };
  const desfazer = async (id) => {
    try { await desfazerAprovacaoLaudoRobo(id); await carregar(); } catch (e) { setErro(e.message); }
  };

  if (fila && !itens.length && !erro) return null;

  const abaBtn = (id, rotulo, qtd, cor) => (
    <button type="button" className={aba === id ? 'btn-primary audit-small-button' : 'btn-secondary audit-small-button'} onClick={() => setAba(id)} style={aba === id ? undefined : { borderColor: cor }}>
      {rotulo} ({qtd})
    </button>
  );

  return (
    <div className="table-card" style={{ marginBottom: 14, borderLeft: '4px solid #b45309' }}>
      <div className="panel-title audit-table-title" style={{ cursor: 'pointer', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }} onClick={() => setAberto((v) => !v)}>
        <span>{aberto ? '▾' : '▸'} Robo: aguardando voce</span>
        <span style={{ fontWeight: 800, color: '#b45309' }}>{aguardandoOk.length} laudo(s) para aprovar</span>
        <span style={{ fontWeight: 800, color: '#b91c1c' }}>{revisar.length} para revisar</span>
      </div>
      {aberto && (
        <div style={{ padding: '0 12px 12px' }}>
          {erro && <div className="hint-box compact" style={{ borderLeft: '4px solid #b91c1c', marginBottom: 8 }}>{erro}</div>}
          {aviso && <div className="hint-box compact" style={{ borderLeft: '4px solid #14733b', marginBottom: 8 }}>{aviso}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {abaBtn('laudos', 'Laudos para aprovar', aguardandoOk.length, '#b45309')}
            {abaBtn('aprovados', 'Aprovados (aguardando envio)', aprovados.length, '#14733b')}
            {abaBtn('revisar', 'Para revisar', revisar.length, '#b91c1c')}
          </div>

          {aba === 'laudos' && (
            <>
              <div className="hint-box compact" style={{ marginBottom: 8 }}>
                O robo calculou cobranca acima da tabela. Confira o laudo (abra a fatura) e aprove: depois do seu OK o laudo segue para a transportadora.
              </div>
              <div style={{ marginBottom: 8 }}>
                <button type="button" className="btn-primary audit-small-button" disabled={busy || !sel.size} onClick={() => aprovar([...sel])}>
                  Aprovar selecionados ({sel.size})
                </button>
              </div>
              {!aguardandoOk.length ? <div style={{ color: '#14733b', fontWeight: 700 }}>✓ Nenhum laudo aguardando seu OK.</div> : (
                <div className="sim-analise-tabela-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
                  <table className="sim-analise-tabela">
                    <thead><tr><th /><th>Fatura</th><th>Transportadora</th><th>Valor</th><th>A descontar</th><th>Detalhe</th><th>Vencimento</th><th /></tr></thead>
                    <tbody>
                      {aguardandoOk.map(({ e, f }) => (
                        <tr key={e.fatura_id}>
                          <td><input type="checkbox" checked={sel.has(String(e.fatura_id))} onChange={() => alternar(String(e.fatura_id))} /></td>
                          <td><button type="button" className="link-button" onClick={() => onAbrirFatura?.(f)}>{f.numero_fatura}</button></td>
                          <td>{f.transportadora}</td>
                          <td>{dinheiro(f.valor_fatura)}</td>
                          <td style={{ fontWeight: 700, color: '#b45309' }}>{dinheiro(e.valor_descontar)}</td>
                          <td style={{ fontSize: 12, maxWidth: 420 }}>{e.motivo}</td>
                          <td>{dataBr(f.data_vencimento)}</td>
                          <td><button type="button" className="btn-primary audit-small-button" disabled={busy} onClick={() => aprovar([String(e.fatura_id)])}>Aprovar laudo</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {aba === 'aprovados' && (
            <>
              <div className="hint-box compact" style={{ marginBottom: 8 }}>
                Laudos que voce aprovou. O envio automatico por e-mail ao transportador ainda nao esta ativo: por enquanto abra a fatura e envie
                o laudo pelo fluxo atual. Assim que o envio for ligado, estes saem sozinhos.
              </div>
              {!aprovados.length ? <div style={{ color: '#475569' }}>Nenhum laudo aprovado aguardando envio.</div> : (
                <div className="sim-analise-tabela-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
                  <table className="sim-analise-tabela">
                    <thead><tr><th>Fatura</th><th>Transportadora</th><th>A descontar</th><th>Aprovado por</th><th>Quando</th><th /></tr></thead>
                    <tbody>
                      {aprovados.map(({ e, f }) => (
                        <tr key={e.fatura_id}>
                          <td><button type="button" className="link-button" onClick={() => onAbrirFatura?.(f)}>{f.numero_fatura}</button></td>
                          <td>{f.transportadora}</td>
                          <td>{dinheiro(e.valor_descontar)}</td>
                          <td>{e.aprovado_auditor_por || '-'}</td>
                          <td>{dataBr(e.aprovado_auditor_em)}</td>
                          <td><button type="button" className="btn-secondary audit-small-button" onClick={() => desfazer(e.fatura_id)}>Desfazer</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {aba === 'revisar' && (
            <>
              <div className="hint-box compact" style={{ marginBottom: 8 }}>
                O robo nao conseguiu fechar estas faturas. <strong>Ele continua monitorando</strong>: assim que o calculo for concluido ou a entrega
                comprovada, a fatura vai sozinha para a aprovacao da gestao e sai desta lista.
              </div>
              {!revisar.length ? <div style={{ color: '#14733b', fontWeight: 700 }}>✓ Nada para revisar.</div> : (
                <div className="sim-analise-tabela-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
                  <table className="sim-analise-tabela">
                    <thead><tr><th>Fatura</th><th>Transportadora</th><th>Valor</th><th>Motivo</th><th>Parada ha</th><th>Reavaliada</th><th /></tr></thead>
                    <tbody>
                      {revisar.map(({ e, f }) => (
                        <tr key={e.fatura_id}>
                          <td><button type="button" className="link-button" onClick={() => onAbrirFatura?.(f)}>{f.numero_fatura}</button></td>
                          <td>{f.transportadora}</td>
                          <td>{dinheiro(f.valor_fatura)}</td>
                          <td style={{ fontSize: 12, maxWidth: 420 }}>{e.motivo}</td>
                          <td>{diasDesde(e.executado_em) ?? '-'} dia(s)</td>
                          <td>{e.reavaliado_em ? `${e.tentativas || 1}x · ${dataBr(e.reavaliado_em)}` : 'ainda nao'}</td>
                          <td><button type="button" className="btn-primary audit-small-button" disabled={Boolean(reavaliando)} onClick={() => reavaliar(e, f)}>{reavaliando === String(f.id) ? 'Reavaliando...' : 'Reavaliar agora'}</button>{' '}<button type="button" className="btn-secondary audit-small-button" onClick={() => onAbrirFatura?.(f)}>Abrir fatura</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
