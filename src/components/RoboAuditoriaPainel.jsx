import { useEffect, useMemo, useRef, useState } from 'react';
import { carregarSessao } from '../utils/authLocal';
import { getSupabaseClient } from '../lib/supabaseClient';
import { listarControleBoletos } from '../services/boletoControleService';
import { aprovarLaudosRobo, DECISAO, desfazerAprovacaoLaudoRobo, marcarLaudoEnviadoRobo, reavaliarFaturaRobo } from '../services/auditorRoboService';

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const diasDesde = (iso) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86400000));
};
const LIBERADAS = new Set(['PRONTA_PARA_PAGAMENTO', 'LIBERADA_COM_DESCONTO', 'ENVIADA_AO_FINANCEIRO', 'PAGA', 'PAGA_COM_DESCONTO', 'PAGA_COM_DIVERGENCIA']);

// Etapas do trabalho do robo, na ordem do fluxo. `acao` = o que o auditor precisa fazer.
const ETAPAS = [
  { id: 'laudo_ok', rotulo: 'Laudos para aprovar', cor: '#b45309', acao: true, dica: 'Robo calculou desconto: confira e aprove o laudo.' },
  { id: 'revisar', rotulo: 'Para revisar', cor: '#b91c1c', acao: true, dica: 'Robo nao conseguiu fechar (sem calculo, sem entrega...). Ele reavalia sozinho a cada execucao.' },
  { id: 'laudo_aprovado', rotulo: 'Laudo aprovado, aguardando envio', cor: '#0e7490', acao: true, dica: 'Voce aprovou; falta enviar ao transportador.' },
  { id: 'transportadora', rotulo: 'Laudo enviado, aguardando transportadora', cor: '#475569', acao: false, dica: 'Laudo aprovado e enviado ao transportador; aguarda a resposta dele.' },
  { id: 'gestao', rotulo: 'Aguardando a gestao', cor: '#7c3aed', acao: false, dica: 'Enviadas pelo robo, na fila de aprovacao da gestao.' },
  { id: 'erp', rotulo: 'Liberadas, aguardando ERP', cor: '#c2410c', acao: true, dica: 'Liberadas para pagamento; falta enviar ao ERP.' },
  { id: 'boleto', rotulo: 'Aguardando boleto', cor: '#0369a1', acao: true, dica: 'No ERP; falta o boleto na pasta do financeiro.' },
  { id: 'concluida', rotulo: '100% concluidas', cor: '#14733b', acao: false, dica: 'Gestao, ERP e boleto concluidos.' },
];
const ETAPA = Object.fromEntries(ETAPAS.map((e) => [e.id, e]));

function etapaDe(e, f, boletoIds) {
  if (e.acao_executada && e.decisao === DECISAO.ENVIAR_LAUDO) return 'transportadora';
  if (e.acao_executada) {
    if (!LIBERADAS.has(f.status)) return ['CANCELADA', 'SUBSTITUIDA'].includes(f.status) ? null : 'gestao';
    if (!f.data_envio_erp) return 'erp';
    if (!boletoIds.has(String(f.id))) return 'boleto';
    return 'concluida';
  }
  if (e.decisao === DECISAO.ENVIAR_LAUDO) return e.aprovado_auditor_em ? 'laudo_aprovado' : 'laudo_ok';
  if (e.decisao === DECISAO.REVISAO_AUDITOR) return 'revisar';
  return null;
}

async function carregarExecucoes() {
  const { data, error } = await getSupabaseClient().from('auditor_robo_execucoes').select('*')
    .order('executado_em', { ascending: false }).limit(5000);
  if (error) throw new Error(error.message);
  return data || [];
}

export default function RoboAuditoriaPainel({ state, onAbrirFatura, onAbrirConsolidado }) {
  const sessao = carregarSessao();
  const [execucoes, setExecucoes] = useState(null);
  const [boletoIds, setBoletoIds] = useState(new Set());
  const [erro, setErro] = useState('');
  const [etapaSel, setEtapaSel] = useState('');
  const [auditorSel, setAuditorSel] = useState('');
  const [busca, setBusca] = useState('');
  const [busy, setBusy] = useState(false);
  const [reavaliando, setReavaliando] = useState('');
  const [aviso, setAviso] = useState('');
  const [lote, setLote] = useState(null); // { atual, total, enviadas }
  const parar = useRef(false);

  const recarregar = async () => {
    try {
      const [ex, { lista }] = await Promise.all([carregarExecucoes(), listarControleBoletos()]);
      setExecucoes(ex);
      setBoletoIds(new Set(lista.map((c) => String(c.fatura_id))));
      setErro('');
    } catch (e) { setErro(e.message); setExecucoes([]); }
  };
  useEffect(() => { recarregar(); }, []);

  const linhas = useMemo(() => {
    const porId = new Map((state?.faturas || []).map((f) => [String(f.id), f]));
    return (execucoes || []).map((e) => {
      const f = porId.get(String(e.fatura_id));
      if (!f) return null;
      const etapa = etapaDe(e, f, boletoIds);
      if (!etapa) return null;
      return { e, f, etapa, auditor: f.auditor_nome || e.auditor_nome || 'SEM AUDITOR' };
    }).filter(Boolean);
  }, [execucoes, state?.faturas, boletoIds]);

  const contEtapa = (id, base) => base.filter((l) => l.etapa === id).length;
  const porAuditor = useMemo(() => {
    const mapa = new Map();
    linhas.forEach((l) => {
      const r = mapa.get(l.auditor) || { nome: l.auditor, total: 0, acao: 0, porEtapa: {} };
      r.porEtapa[l.etapa] = (r.porEtapa[l.etapa] || 0) + 1;
      if (l.etapa !== 'concluida') r.total += 1;
      if (ETAPA[l.etapa].acao) r.acao += 1;
      mapa.set(l.auditor, r);
    });
    return [...mapa.values()].sort((a, b) => b.acao - a.acao || b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [linhas]);

  // Cards de etapa contam dentro do auditor escolhido; cards de auditor, dentro da etapa escolhida.
  const baseEtapa = linhas.filter((l) => !auditorSel || l.auditor === auditorSel);
  const visiveis = linhas
    .filter((l) => !auditorSel || l.auditor === auditorSel)
    .filter((l) => !etapaSel || l.etapa === etapaSel)
    .filter((l) => {
      const t = busca.trim().toLowerCase();
      return !t || [l.f.numero_fatura, l.f.transportadora, l.auditor].some((v) => String(v || '').toLowerCase().includes(t));
    })
    .sort((a, b) => ETAPAS.findIndex((x) => x.id === a.etapa) - ETAPAS.findIndex((x) => x.id === b.etapa)
      || String(a.e.executado_em).localeCompare(String(b.e.executado_em)));

  const aprovar = async (ids) => {
    if (!ids.length || busy) return;
    if (ids.length > 1 && !window.confirm(`Aprovar o laudo de ${ids.length} fatura(s)?`)) return;
    setBusy(true); setErro('');
    try { await aprovarLaudosRobo(ids, sessao?.nome || sessao?.email || 'auditor'); await recarregar(); } catch (e) { setErro(e.message); } finally { setBusy(false); }
  };
  const reavaliar = async (e, f) => {
    if (reavaliando) return;
    setReavaliando(String(f.id)); setErro(''); setAviso('');
    try {
      const reg = await reavaliarFaturaRobo(f, e, {
        usuario: sessao?.nome || sessao?.email || 'auditor',
        aoProgredir: (p) => setAviso(`Fatura ${f.numero_fatura}: ${p.fase === 'calculando' ? `calculando ${p.atual}/${p.total} CT-es` : p.fase === 'apurando' ? 'apurando desconto e entrega' : 'lendo CT-es'}...`),
      });
      setAviso(reg.acao_executada
        ? `Fatura ${f.numero_fatura}: estava correta e foi enviada para a aprovacao da gestao.`
        : `Fatura ${f.numero_fatura} reavaliada: ${reg.motivo}`);
      await recarregar();
    } catch (ex) { setErro(ex.message); setAviso(''); } finally { setReavaliando(''); }
  };

  // Reavalia, uma por vez, todas as faturas listadas que ainda nao foram para a gestao.
  const reavaliarTodas = async () => {
    const alvo = visiveis.filter((l) => !l.e.acao_executada && l.etapa !== 'laudo_aprovado');
    if (!alvo.length || reavaliando || lote) return;
    if (!window.confirm(`Reavaliar ${alvo.length} fatura(s) agora? Cada uma e refeita (calculo e entrega); as corretas vao para a gestao.`)) return;
    parar.current = false;
    setErro(''); setAviso('');
    const usuario = sessao?.nome || sessao?.email || 'auditor';
    let enviadas = 0; let ok = 0; const falhas = [];
    for (let i = 0; i < alvo.length; i += 1) {
      if (parar.current) break;
      const { e, f } = alvo[i];
      setLote({ atual: i + 1, total: alvo.length, enviadas, numero: f.numero_fatura, fase: 'lendo CT-es' });
      try {
        const reg = await reavaliarFaturaRobo(f, e, {
          usuario,
          aoProgredir: (p) => setLote({ atual: i + 1, total: alvo.length, enviadas, numero: f.numero_fatura, fase: p.fase === 'calculando' ? `calculando ${p.atual}/${p.total} CT-es` : p.fase === 'apurando' ? 'apurando desconto e entrega' : 'lendo CT-es' }),
        });
        ok += 1;
        if (reg.acao_executada) enviadas += 1;
      } catch (ex) { falhas.push(`${f.numero_fatura}: ${ex.message || ex}`); }
    }
    const interrompido = parar.current;
    setLote(null);
    setAviso(`${ok} reavaliada(s), ${enviadas} enviada(s) para a gestao${interrompido ? ` (interrompido; restam ${alvo.length - ok - falhas.length})` : ''}${falhas.length ? `; ${falhas.length} falharam` : ''}.`);
    if (falhas.length) setErro(falhas.slice(0, 5).join(' | '));
    await recarregar();
  };

  // Laudos aprovados agrupados por transportadora: um e-mail/laudo unico por transportadora.
  const consolidados = useMemo(() => {
    const mapa = new Map();
    linhas.filter((l) => l.etapa === 'laudo_aprovado' && (!auditorSel || l.auditor === auditorSel)).forEach((l) => {
      const k = l.f.transportadora || 'SEM TRANSPORTADORA';
      const r = mapa.get(k) || { transportadora: k, faturas: [], total: 0, descontar: 0 };
      r.faturas.push(l.f); r.total += Number(l.f.valor_fatura || 0); r.descontar += Number(l.e.valor_descontar || 0);
      mapa.set(k, r);
    });
    return [...mapa.values()].sort((a, b) => b.faturas.length - a.faturas.length);
  }, [linhas, auditorSel]);

  const marcarConsolidadoEnviado = async (c) => {
    if (!window.confirm(`Confirmar que o laudo consolidado de ${c.transportadora} (${c.faturas.length} fatura(s)) ja foi enviado?`)) return;
    try { await marcarLaudoEnviadoRobo(c.faturas.map((f) => f.id), sessao?.nome || sessao?.email || 'auditor'); await recarregar(); } catch (ex) { setErro(ex.message); }
  };

  const marcarEnviado = async (f) => {
    if (!window.confirm(`Confirmar que o laudo da fatura ${f.numero_fatura} ja foi enviado ao transportador?`)) return;
    try { await marcarLaudoEnviadoRobo(f.id, sessao?.nome || sessao?.email || 'auditor'); await recarregar(); } catch (ex) { setErro(ex.message); }
  };

  const desfazer = async (id) => {
    try { await desfazerAprovacaoLaudoRobo(id); await recarregar(); } catch (e) { setErro(e.message); }
  };

  const cartao = (ativo, cor) => ({
    textAlign: 'left', cursor: 'pointer', background: ativo ? cor : '#fff', color: ativo ? '#fff' : '#0f172a',
    border: `2px solid ${ativo ? cor : '#e2e8f0'}`, borderRadius: 12, padding: '10px 14px', minWidth: 150, flex: '1 1 150px',
  });
  const laudosVisiveis = visiveis.filter((l) => l.etapa === 'laudo_ok');

  if (execucoes === null) return <div className="panel-card">Carregando o trabalho do robo...</div>;

  return (
    <div className="page-stack">
      {erro && <div className="hint-box compact" style={{ borderLeft: '4px solid #b91c1c' }}>{erro}</div>}
      {aviso && <div className="hint-box compact" style={{ borderLeft: '4px solid #14733b' }}>{aviso}</div>}
      <div className="hint-box compact">
        Tudo o que o <strong>Robo Auditor</strong> fez, por etapa e por auditor. Clique num card para filtrar; clique de novo para limpar.
        As etapas em destaque pedem acao do auditor.
      </div>

      <div>
        <div style={{ fontWeight: 700, fontSize: 13, margin: '4px 0 6px' }}>Por etapa{auditorSel ? ` — ${auditorSel}` : ''}</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {ETAPAS.map((et) => {
            const qtd = contEtapa(et.id, baseEtapa);
            const ativo = etapaSel === et.id;
            return (
              <button key={et.id} type="button" title={et.dica} style={{ ...cartao(ativo, et.cor), opacity: qtd ? 1 : 0.55 }} onClick={() => setEtapaSel(ativo ? '' : et.id)}>
                <div style={{ fontSize: 12, opacity: 0.9 }}>{et.rotulo}{et.acao ? ' •' : ''}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: ativo ? '#fff' : et.cor }}>{qtd}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontWeight: 700, fontSize: 13, margin: '10px 0 6px' }}>Por auditor{etapaSel ? ` — ${ETAPA[etapaSel].rotulo}` : ''}</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {porAuditor.map((a) => {
            const qtd = etapaSel ? (a.porEtapa[etapaSel] || 0) : a.acao;
            const ativo = auditorSel === a.nome;
            return (
              <button key={a.nome} type="button" style={{ ...cartao(ativo, '#071d49'), opacity: qtd || ativo ? 1 : 0.6 }} onClick={() => setAuditorSel(ativo ? '' : a.nome)}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{a.nome}</div>
                <div style={{ fontSize: 26, fontWeight: 800 }}>{qtd}</div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>
                  {etapaSel ? ETAPA[etapaSel].rotulo : 'aguardando acao'} · {a.total} em andamento
                </div>
              </button>
            );
          })}
          {!porAuditor.length && <div style={{ color: '#64748b' }}>O robo ainda nao tem faturas registradas.</div>}
        </div>
      </div>

      {consolidados.length > 0 && (
        <div className="table-card" style={{ borderLeft: '4px solid #0e7490' }}>
          <div className="panel-title audit-table-title">Laudo consolidado por transportadora — um e-mail so por transportadora</div>
          <div style={{ padding: '0 12px 12px' }}>
            <div className="hint-box compact" style={{ marginBottom: 8 }}>
              Laudos aprovados agrupados: em vez de um e-mail por fatura, abra o consolidado, gere o laudo da transportadora (todas as faturas num so) e envie uma vez.
              Depois marque as faturas como enviadas.
            </div>
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead><tr><th>Transportadora</th><th>Faturas</th><th>Valor das faturas</th><th>A descontar</th><th /></tr></thead>
                <tbody>
                  {consolidados.map((c) => (
                    <tr key={c.transportadora}>
                      <td>{c.transportadora}</td>
                      <td>{c.faturas.length}: {c.faturas.slice(0, 6).map((f) => f.numero_fatura).join(', ')}{c.faturas.length > 6 ? ` +${c.faturas.length - 6}` : ''}</td>
                      <td>{dinheiro(c.total)}</td>
                      <td style={{ fontWeight: 700, color: '#b45309' }}>{dinheiro(c.descontar)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn-primary audit-small-button" onClick={() => onAbrirConsolidado?.(c.transportadora, c.faturas)}
                          title="Abre as faturas com todas selecionadas; use 'Laudo transportador lote' para gerar um laudo e e-mail unicos.">
                          Abrir laudo consolidado
                        </button>{' '}
                        <button type="button" className="btn-secondary audit-small-button" onClick={() => marcarConsolidadoEnviado(c)}>Marcar {c.faturas.length} como enviadas</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="table-card">
        <div className="panel-title audit-table-title" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>{visiveis.length} fatura(s)</span>
          <input type="search" placeholder="Buscar fatura, transportadora ou auditor" value={busca} onChange={(ev) => setBusca(ev.target.value)} style={{ minWidth: 260 }} />
          {laudosVisiveis.length > 0 && (
            <button type="button" className="btn-primary audit-small-button" disabled={busy} onClick={() => aprovar(laudosVisiveis.map((l) => String(l.e.fatura_id)))}>
              Aprovar os {laudosVisiveis.length} laudo(s) listados
            </button>
          )}
          {!lote && (
            <button type="button" className="btn-primary audit-small-button" disabled={busy || Boolean(reavaliando) || !visiveis.some((l) => !l.e.acao_executada && l.etapa !== 'laudo_aprovado')} onClick={reavaliarTodas}
              title="Refaz a analise de todas as faturas listadas (que ainda nao foram para a gestao).">
              Reavaliar todas as listadas ({visiveis.filter((l) => !l.e.acao_executada && l.etapa !== 'laudo_aprovado').length})
            </button>
          )}
          {lote && (
            <>
              <span style={{ fontWeight: 400, fontSize: 12 }}>Reavaliando {lote.atual} de {lote.total} · fatura {lote.numero}: {lote.fase} · {lote.enviadas} enviada(s) para a gestao</span>
              <button type="button" className="btn-secondary audit-small-button" onClick={() => { parar.current = true; }}>Parar apos esta fatura</button>
            </>
          )}
          <button type="button" className="btn-secondary audit-small-button" disabled={Boolean(lote)} onClick={recarregar}>Atualizar</button>
        </div>
        <div className="sim-analise-tabela-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
          <table className="sim-analise-tabela">
            <thead>
              <tr><th>Fatura</th><th>Transportadora</th><th>Auditor</th><th>Valor</th><th>A descontar</th><th>Etapa</th><th>Detalhe</th><th>Dias</th><th /></tr>
            </thead>
            <tbody>
              {visiveis.slice(0, 500).map(({ e, f, etapa, auditor }) => (
                <tr key={e.fatura_id}>
                  <td><button type="button" className="link-button" onClick={() => onAbrirFatura?.(f)}>{f.numero_fatura}</button></td>
                  <td>{f.transportadora}</td>
                  <td>{auditor}</td>
                  <td>{dinheiro(f.valor_fatura)}</td>
                  <td>{Number(e.valor_descontar) > 0 ? dinheiro(e.valor_descontar) : '-'}</td>
                  <td style={{ color: ETAPA[etapa].cor, fontWeight: 700 }}>{ETAPA[etapa].rotulo}</td>
                  <td style={{ fontSize: 12, maxWidth: 380 }}>{e.motivo}{e.tentativas > 1 ? ` (reavaliada ${e.tentativas - 1}x)` : ''}</td>
                  <td>{diasDesde(e.executado_em) ?? '-'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {etapa === 'laudo_ok' && <button type="button" className="btn-primary audit-small-button" disabled={busy} onClick={() => aprovar([String(e.fatura_id)])}>Aprovar laudo</button>}
                    {etapa === 'laudo_aprovado' && (
                      <>
                        <button type="button" className="btn-primary audit-small-button" onClick={() => marcarEnviado(f)} title="Depois de enviar o laudo ao transportador pelo fluxo da fatura, marque aqui.">Marcar como enviado</button>{' '}
                        <button type="button" className="btn-secondary audit-small-button" onClick={() => desfazer(e.fatura_id)}>Desfazer OK</button>
                      </>
                    )}
                    {!e.acao_executada && (
                      <button type="button" className="btn-secondary audit-small-button" disabled={Boolean(reavaliando) || Boolean(lote)} onClick={() => reavaliar(e, f)}
                        title="Refaz a analise desta fatura agora (calculo e entrega). Se estiver correta, vai para a gestao.">
                        {reavaliando === String(f.id) ? 'Reavaliando...' : 'Reavaliar agora'}
                      </button>
                    )}
                    {' '}
                    <button type="button" className="btn-secondary audit-small-button" onClick={() => onAbrirFatura?.(f)}>Abrir</button>
                  </td>
                </tr>
              ))}
              {!visiveis.length && <tr><td colSpan={9} style={{ color: '#14733b', fontWeight: 700 }}>✓ Nada neste filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
