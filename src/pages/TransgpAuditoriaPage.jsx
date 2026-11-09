import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { getSupabaseClient } from '../lib/supabaseClient';

// Auditoria de fretes da TransGP (API do painel deles), sincronizada de hora em hora pelo /api/transgp-auditoria
// em transgp_auditoria_ctes (um CT-e por linha) e gravada no fluxo de lotacao (lotacao_cargas).
// Aqui: o que veio da API, agrupado por DIST, com a situacao deles e se a carga ja esta no fluxo.

const SITUACOES = {
  AUTORIZADO_AUTOMATICO: { txt: 'Autorizado automático', cor: '#166534', fundo: '#dcfce7' },
  AUTORIZADO_AUDITORIA: { txt: 'Autorizado pela auditoria', cor: '#166534', fundo: '#dcfce7' },
  REPROVADO: { txt: 'Reprovado', cor: '#991b1b', fundo: '#fee2e2' },
  DIVERGENTE: { txt: 'Divergente', cor: '#b45309', fundo: '#fef3c7' },
  AGUARDANDO_CTE: { txt: 'Aguardando CT-e', cor: '#475569', fundo: '#f1f5f9' },
  CTE_SEM_VALOR: { txt: 'CT-e sem valor', cor: '#475569', fundo: '#f1f5f9' },
  SEM_FRETE_CONTRATADO: { txt: 'Sem frete contratado', cor: '#475569', fundo: '#f1f5f9' },
  SEM_TRANSPORTADORA: { txt: 'Sem transportadora', cor: '#475569', fundo: '#f1f5f9' },
};
const PAGE = 1000;
const brl = (v) => (v == null || v === '' ? '-' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBr = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : '-');
const dataHoraBr = (v) => (v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

const card = { background: '#fff', border: '1px solid #dbe3ef', borderRadius: 14, padding: 18, marginBottom: 16 };
const btn = { background: '#185FA5', color: '#fff', border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' };
const btnSec = { ...btn, background: '#fff', color: '#185FA5', border: '1px solid #185FA5' };
const inp = { border: '1px solid #cbd5e1', borderRadius: 8, padding: '7px 9px', fontSize: 13 };
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: '#475569', borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap', background: '#f8fafc', position: 'sticky', top: 0 };
const td = { padding: '7px 10px', fontSize: 13, borderBottom: '1px solid #eef2f7', verticalAlign: 'top' };

function Selo({ situacao }) {
  const s = SITUACOES[situacao] || { txt: situacao || '-', cor: '#475569', fundo: '#f1f5f9' };
  return <span style={{ background: s.fundo, color: s.cor, borderRadius: 999, padding: '2px 9px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{s.txt}</span>;
}

function Kpi({ titulo, valor, sub, cor = '#06183d', ativo, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{ textAlign: 'left', background: ativo ? '#eff6ff' : '#fff', border: `1px solid ${ativo ? '#185FA5' : '#dbe3ef'}`, borderRadius: 12, padding: '10px 14px', minWidth: 170, cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ fontSize: 12, color: '#64748b' }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: cor }}>{valor}</div>
      {sub && <div style={{ fontSize: 12, color: '#64748b' }}>{sub}</div>}
    </button>
  );
}

async function lerTudo(supabase, tabela, colunas, filtro = (q) => q) {
  const linhas = [];
  for (let pagina = 0; ; pagina += 1) {
    const { data, error } = await filtro(supabase.from(tabela).select(colunas)).range(pagina * PAGE, (pagina + 1) * PAGE - 1);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...(data || []));
    if ((data || []).length < PAGE) break;
  }
  return linhas;
}

export default function TransgpAuditoriaPage() {
  const [linhas, setLinhas] = useState([]);
  const [log, setLog] = useState([]);
  const [noFluxo, setNoFluxo] = useState(new Set());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [sincronizando, setSincronizando] = useState(false);
  const [filtroSituacao, setFiltroSituacao] = useState('');
  const [busca, setBusca] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [aberta, setAberta] = useState(null);

  const carregar = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) { setErro('Banco não configurado.'); setCarregando(false); return; }
    setCarregando(true); setErro('');
    try {
      const [ctes, logs] = await Promise.all([
        lerTudo(supabase, 'transgp_auditoria_ctes', '*'),
        supabase.from('transgp_auditoria_sync_log').select('*').order('id', { ascending: false }).limit(10).then((r) => r.data || []),
      ]);
      setLinhas(ctes);
      setLog(logs);
      const dists = [...new Set(ctes.map((c) => c.dist).filter(Boolean))];
      const achadas = new Set();
      for (let i = 0; i < dists.length; i += 200) {
        const { data } = await supabase.from('lotacao_cargas').select('dist').in('dist', dists.slice(i, i + 200));
        (data || []).forEach((r) => achadas.add(norm(r.dist)));
      }
      setNoFluxo(achadas);
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const sincronizar = async () => {
    setSincronizando(true); setAviso(''); setErro('');
    try {
      const resp = await fetch('/api/transgp-auditoria?manual=1');
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok || !corpo.ok) throw new Error(corpo.erro || `Falha ${resp.status}`);
      setAviso(`Sincronizado: ${corpo.dists} DISTs, ${corpo.ctes} CT-es. Fluxo: ${corpo.fluxo?.atualizadas || 0} atualizadas, ${corpo.fluxo?.inseridas || 0} novas.`);
      await carregar();
    } catch (e) {
      setErro(`Sincronização: ${e.message || e}`);
    } finally {
      setSincronizando(false);
    }
  };

  // Uma linha por DIST (a API repete os dados da DIST em cada CT-e).
  const dists = useMemo(() => {
    const mapa = new Map();
    linhas.forEach((l) => {
      const k = norm(l.dist);
      if (!mapa.has(k)) mapa.set(k, { ...l, ctes: [] });
      if (!String(l.chave_cte || '').endsWith('|SEM_CTE')) mapa.get(k).ctes.push(l); // linha so da DIST (sem CT-e)
    });
    return [...mapa.values()].sort((a, b) => String(b.coleta_planejada || '').localeCompare(String(a.coleta_planejada || '')));
  }, [linhas]);

  const doPeriodo = useMemo(() => dists.filter((d) => {
    const dia = String(d.coleta_planejada || '').slice(0, 10);
    if (de && (!dia || dia < de)) return false;
    if (ate && (!dia || dia > ate)) return false;
    return true;
  }), [dists, de, ate]);

  const filtradas = useMemo(() => {
    const termo = norm(busca);
    return doPeriodo.filter((d) => {
      if (filtroSituacao === 'LIBERADOS' && !d.liberado_pagamento) return false;
      if (filtroSituacao === 'FORA_FLUXO' && noFluxo.has(norm(d.dist))) return false;
      if (filtroSituacao && !['LIBERADOS', 'FORA_FLUXO'].includes(filtroSituacao) && d.situacao !== filtroSituacao) return false;
      if (!termo) return true;
      return [d.dist, d.transportadora, d.origem, d.destinos, ...d.ctes.map((c) => c.numero_cte)].some((v) => norm(v).includes(termo));
    });
  }, [doPeriodo, busca, filtroSituacao, noFluxo]);

  const resumo = useMemo(() => {
    const r = { total: doPeriodo.length, liberados: 0, valorLiberado: 0, porSituacao: {}, foraFluxo: 0 };
    doPeriodo.forEach((d) => {
      if (d.liberado_pagamento) { r.liberados += 1; r.valorLiberado += Number(d.cte_total) || 0; }
      const s = r.porSituacao[d.situacao] || (r.porSituacao[d.situacao] = { qtd: 0, valor: 0 });
      s.qtd += 1; s.valor += Number(d.cte_total) || 0;
      if (!noFluxo.has(norm(d.dist))) r.foraFluxo += 1;
    });
    return r;
  }, [doPeriodo, noFluxo]);

  const exportar = () => {
    const rows = filtradas.map((d) => ({
      DIST: d.dist, Operacao: d.operacao, Transportadora: d.transportadora, Origem: d.origem, Destinos: d.destinos,
      'Coleta planejada': dataBr(d.coleta_planejada), 'Status carga': d.status_carga,
      'Frete contratado': Number(d.frete_contratado) || 0, Pedagio: Number(d.pedagio) || 0, 'Total contratado': Number(d.total_contratado) || 0,
      'CT-es': d.ctes.map((c) => c.numero_cte).join('; '), 'Chaves CT-e': d.ctes.map((c) => c.chave_cte).join('; '),
      'Total CT-es': Number(d.cte_total) || 0, Diferenca: Number(d.diferenca_total) || 0,
      Situacao: SITUACOES[d.situacao]?.txt || d.situacao, 'Liberado p/ pagamento': d.liberado_pagamento ? 'Sim' : 'Nao',
      'Liberado em': dataHoraBr(d.liberado_em), 'No fluxo': noFluxo.has(norm(d.dist)) ? 'Sim' : 'Nao',
      'Decisao auditoria': d.decisao_auditoria ? JSON.stringify(d.decisao_auditoria) : '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Auditoria TransGP');
    XLSX.writeFile(wb, `auditoria-transgp-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const ultima = log[0];
  const ultimaOk = log.find((l) => l.ok);

  return (
    <div style={{ padding: 24, maxWidth: 1500, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: '#06183d' }}>Auditoria TransGP (API)</h1>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
            DISTs e CT-es auditados no painel da TransGP. Sincroniza sozinho de hora em hora (últimos 120 dias de coleta) e grava as cargas no fluxo de lotação.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={btnSec} onClick={carregar} disabled={carregando}>Atualizar tela</button>
          <button type="button" style={btnSec} onClick={exportar} disabled={!filtradas.length}>Exportar Excel</button>
          <button type="button" style={btn} onClick={sincronizar} disabled={sincronizando}>{sincronizando ? 'Sincronizando...' : 'Sincronizar agora'}</button>
        </div>
      </div>

      <div style={{ ...card, padding: '10px 16px', display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
        <span><b>Última sincronização:</b> {ultima ? `${dataHoraBr(ultima.iniciado_em)} — ${ultima.ok ? 'ok' : 'com erro'}` : 'nenhuma ainda'}</span>
        {ultima && <span><b>Trouxe:</b> {ultima.dists} DISTs / {ultima.ctes} CT-es</span>}
        {ultima && !ultima.ok && <span style={{ color: '#991b1b' }}><b>Erro:</b> {ultima.erro}</span>}
        {ultima && !ultima.ok && ultimaOk && <span><b>Última com sucesso:</b> {dataHoraBr(ultimaOk.iniciado_em)}</span>}
      </div>

      {erro && <div style={{ ...card, background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}>{erro}</div>}
      {aviso && <div style={{ ...card, background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534' }}>{aviso}</div>}

      {!carregando && !linhas.length && !erro && (
        <div style={card}>
          Nenhum dado da TransGP ainda. Confira se a variável <b>TRANSGP_API_KEY</b> está cadastrada no Vercel e clique em <b>Sincronizar agora</b>.
        </div>
      )}

      {!!linhas.length && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <Kpi titulo="DISTs no período" valor={resumo.total.toLocaleString('pt-BR')} ativo={!filtroSituacao} onClick={() => setFiltroSituacao('')} />
            <Kpi titulo="Liberadas p/ pagamento" valor={resumo.liberados.toLocaleString('pt-BR')} sub={brl(resumo.valorLiberado)} cor="#166534" ativo={filtroSituacao === 'LIBERADOS'} onClick={() => setFiltroSituacao('LIBERADOS')} />
            {['DIVERGENTE', 'REPROVADO', 'AGUARDANDO_CTE', 'SEM_TRANSPORTADORA'].map((s) => (
              <Kpi key={s} titulo={SITUACOES[s].txt} valor={(resumo.porSituacao[s]?.qtd || 0).toLocaleString('pt-BR')} sub={brl(resumo.porSituacao[s]?.valor || 0)} cor={SITUACOES[s].cor} ativo={filtroSituacao === s} onClick={() => setFiltroSituacao(s)} />
            ))}
            <Kpi titulo="Fora do fluxo de lotação" valor={resumo.foraFluxo.toLocaleString('pt-BR')} cor={resumo.foraFluxo ? '#b45309' : '#166534'} ativo={filtroSituacao === 'FORA_FLUXO'} onClick={() => setFiltroSituacao('FORA_FLUXO')} />
          </div>

          <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '12px 16px' }}>
            <input style={{ ...inp, minWidth: 280 }} placeholder="Buscar DIST, CT-e, transportadora, cidade..." value={busca} onChange={(e) => setBusca(e.target.value)} />
            <label style={{ fontSize: 13 }}>Coleta de <input type="date" style={inp} value={de} onChange={(e) => setDe(e.target.value)} /></label>
            <label style={{ fontSize: 13 }}>até <input type="date" style={inp} value={ate} onChange={(e) => setAte(e.target.value)} /></label>
            <select style={inp} value={filtroSituacao} onChange={(e) => setFiltroSituacao(e.target.value)}>
              <option value="">Todas as situações</option>
              <option value="LIBERADOS">Liberadas p/ pagamento</option>
              <option value="FORA_FLUXO">Fora do fluxo de lotação</option>
              {Object.entries(SITUACOES).map(([k, v]) => <option key={k} value={k}>{v.txt}</option>)}
            </select>
            <span style={{ fontSize: 13, color: '#64748b' }}>{filtradas.length.toLocaleString('pt-BR')} DIST(s)</span>
          </div>

          <div style={{ ...card, padding: 0, overflow: 'auto', maxHeight: '65vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['DIST', 'Transportadora', 'Origem → Destino', 'Coleta', 'Status carga', 'Contratado', 'CT-es', 'Cobrado', 'Diferença', 'Situação TransGP', 'Liberado', 'No fluxo'].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {filtradas.slice(0, 1000).map((d) => {
                  const k = norm(d.dist);
                  const dif = Number(d.diferenca_total) || 0;
                  return [
                    <tr key={k} onClick={() => setAberta(aberta === k ? null : k)} style={{ cursor: 'pointer', background: aberta === k ? '#f8fafc' : undefined }}>
                      <td style={{ ...td, fontWeight: 700 }}>{d.dist}</td>
                      <td style={td}>{d.transportadora || '-'}</td>
                      <td style={td}>{d.origem || '-'} → {d.destinos || '-'}</td>
                      <td style={td}>{dataBr(d.coleta_planejada)}</td>
                      <td style={td}>{d.status_carga || '-'}</td>
                      <td style={td}>{brl(d.total_contratado)}</td>
                      <td style={td}>{d.ctes.map((c) => c.numero_cte).filter(Boolean).join(', ') || '-'}</td>
                      <td style={td}>{brl(d.cte_total)}</td>
                      <td style={{ ...td, color: dif > 0.01 ? '#991b1b' : dif < -0.01 ? '#166534' : undefined, fontWeight: Math.abs(dif) > 0.01 ? 700 : 400 }}>{brl(dif)}</td>
                      <td style={td}><Selo situacao={d.situacao} /></td>
                      <td style={td}>{d.liberado_pagamento ? `Sim${d.liberado_em ? ` (${dataBr(d.liberado_em)})` : ''}` : 'Não'}</td>
                      <td style={td}>{noFluxo.has(k) ? 'Sim' : <span style={{ color: '#b45309', fontWeight: 700 }}>Não</span>}</td>
                    </tr>,
                    aberta === k && (
                      <tr key={`${k}-det`}>
                        <td colSpan={12} style={{ ...td, background: '#f8fafc' }}>
                          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontSize: 13, marginBottom: 8 }}>
                            <span><b>Operação:</b> {d.operacao || '-'}</span>
                            <span><b>Frete:</b> {brl(d.frete_contratado)}</span>
                            <span><b>Pedágio:</b> {brl(d.pedagio)}</span>
                            <span><b>Sincronizado em:</b> {dataHoraBr(d.sincronizado_em)}</span>
                          </div>
                          {d.decisao_auditoria && (
                            <div style={{ fontSize: 13, marginBottom: 8 }}><b>Decisão da auditoria TransGP:</b> {typeof d.decisao_auditoria === 'object' ? Object.entries(d.decisao_auditoria).map(([a, b]) => `${a}: ${b}`).join(' · ') : String(d.decisao_auditoria)}</div>
                          )}
                          <table style={{ borderCollapse: 'collapse' }}>
                            <thead><tr>{['CT-e', 'Série', 'Chave', 'Valor'].map((h) => <th key={h} style={{ ...th, position: 'static' }}>{h}</th>)}</tr></thead>
                            <tbody>
                              {d.ctes.map((c) => (
                                <tr key={c.chave_cte}>
                                  <td style={td}>{c.numero_cte || '-'}</td>
                                  <td style={td}>{c.serie || '-'}</td>
                                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{/^\d{44}$/.test(c.chave_cte) ? c.chave_cte : <span style={{ color: '#b45309' }}>sem chave completa</span>}</td>
                                  <td style={td}>{brl(c.valor_cte)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
            {filtradas.length > 1000 && <div style={{ padding: 10, fontSize: 12, color: '#64748b' }}>Mostrando 1.000 de {filtradas.length.toLocaleString('pt-BR')}; use os filtros ou exporte para ver tudo.</div>}
          </div>
        </>
      )}
      {carregando && <div style={card}>Carregando...</div>}
    </div>
  );
}
