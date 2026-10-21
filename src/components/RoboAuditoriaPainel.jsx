import { useEffect, useMemo, useRef, useState } from 'react';
import { carregarSessao } from '../utils/authLocal';
import RoboProgressoAmd from './RoboProgressoAmd';
import { exportarExcelFormatado } from '../utils/exportarExcelFormatado';
import { getSupabaseClient } from '../lib/supabaseClient';
import { listarControleBoletos } from '../services/boletoControleService';
import { aprovarLaudosRobo, DECISAO, gravarPreferenciaPesoMaisProximo, lerPreferenciaPesoMaisProximo, listarRoboTransportadoras, STATUS_ROBO_AUDITA, desfazerAprovacaoLaudoRobo, marcarLaudoEnviadoRobo, reavaliarFaturaRobo } from '../services/auditorRoboService';

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
  { id: 'tratada', rotulo: 'Tratadas fora do robo', cor: '#64748b', acao: false, dica: 'Laudo ou revisao que o auditor/gestao ja resolveu pela tela da fatura.' },
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
  if (e.decisao === DECISAO.ENVIAR_LAUDO && f.status === 'AGUARDANDO_TRANSPORTADORA') return 'transportadora';
  if (!STATUS_ROBO_AUDITA.includes(f.status)) return 'tratada';
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

export default function RoboAuditoriaPainel({ state, onAbrirFatura, onAbrirConsolidado, onEnviarEmail, resultadosEmail = [], onLimparResultadosEmail }) {
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
  const [lote, setLote] = useState(null); // { atual, total, enviadas, numero, faseId, ctAtual, ctTotal }
  const [progUm, setProgUm] = useState(null); // reavaliacao de uma fatura so
  const [pesoMaisProximo, setPesoMaisProximo] = useState(() => lerPreferenciaPesoMaisProximo());
  const [cfgs, setCfgs] = useState([]);
  useEffect(() => { listarRoboTransportadoras().then(({ lista }) => setCfgs(lista)).catch(() => {}); }, []);
  const cfgDe = (nome) => cfgs.find((c) => String(c.transportadora || '').trim().toLowerCase() === String(nome || '').trim().toLowerCase());
  const parar = useRef(false);

  const recarregar = async () => {
    try {
      const [ex, { lista }] = await Promise.all([carregarExecucoes(), listarControleBoletos()]);
      setExecucoes(ex);
      setBoletoIds(new Set(lista.map((c) => String(c.fatura_id))));
      setErro('');
    } catch (e) { setErro(e.message); setExecucoes([]); }
  };
  useEffect(() => { recarregar(); }, [resultadosEmail.length]);

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

  // Excel formatado com exatamente o que a tela mostra (filtros de etapa, auditor e busca).
  const [exportando, setExportando] = useState(false);
  const exportarExcel = async () => {
    if (!visiveis.length || exportando) return;
    setExportando(true);
    try {
      const STATUS_FATURA = {
        RECEBIDA: 'Recebida', PRE_AUDITADA_VERUM: 'Pre-auditada Verum', REAUDITADA_CENTRAL: 'Reauditada', COM_DIVERGENCIA: 'Com divergencia',
        AGUARDANDO_APROVACAO_GESTAO: 'Aguardando a gestao', PRONTA_PARA_PAGAMENTO: 'Liberada p/ pagamento', LIBERADA_COM_DESCONTO: 'Liberada com desconto',
        ENVIADA_AO_FINANCEIRO: 'No financeiro', PAGA: 'Paga', PAGA_COM_DESCONTO: 'Paga', PAGA_COM_DIVERGENCIA: 'Paga',
        AGUARDANDO_TRANSPORTADORA: 'Aguardando transportadora', AGUARDANDO_NOVA_FATURA: 'Aguardando nova fatura', CANCELADA: 'Cancelada', SUBSTITUIDA: 'Substituida',
      };
      const DEC = { ENVIAR_APROVACAO: 'Enviar para a gestao', ENVIAR_LAUDO: 'Laudo com desconto', REVISAO_AUDITOR: 'Revisar' };
      await exportarExcelFormatado({
        nomeArquivo: `robo-auditor-${etapaSel || 'todas-etapas'}${auditorSel ? `-${auditorSel.split(' ')[0].toLowerCase()}` : ''}-${new Date().toISOString().slice(0, 10)}.xlsx`,
        aba: 'Robo Auditor',
        colunas: [
          { titulo: 'Fatura', largura: 12 },
          { titulo: 'Transportadora', largura: 32 },
          { titulo: 'Auditor', largura: 26 },
          { titulo: 'Etapa (robo)', largura: 28 },
          { titulo: 'Decisao do robo', largura: 20 },
          { titulo: 'Status da fatura', largura: 24 },
          { titulo: 'Valor fatura', largura: 16, tipo: 'moeda' },
          { titulo: 'A descontar', largura: 15, tipo: 'moeda' },
          { titulo: 'Emissao', largura: 12, tipo: 'data' },
          { titulo: 'Vencimento', largura: 12, tipo: 'data' },
          { titulo: 'Entrou no sistema', largura: 16, tipo: 'datahora' },
          { titulo: 'Analisada pelo robo', largura: 18, tipo: 'datahora' },
          { titulo: 'Dias desde a analise', largura: 10, tipo: 'inteiro' },
          { titulo: 'Reavaliacoes', largura: 10, tipo: 'inteiro' },
          { titulo: 'Laudo aprovado por', largura: 22 },
          { titulo: 'Laudo aprovado em', largura: 16, tipo: 'datahora' },
          { titulo: 'Enviado para', largura: 30 },
          { titulo: 'Detalhe / motivo', largura: 80 },
        ],
        linhas: visiveis.map(({ e, f, etapa, auditor }) => [
          String(f.numero_fatura || ''),
          f.transportadora || '',
          auditor,
          ETAPA[etapa]?.rotulo || etapa,
          DEC[e.decisao] || e.decisao,
          STATUS_FATURA[f.status] || f.status,
          Number(f.valor_fatura || 0),
          Number(e.valor_descontar || 0) > 0 ? Number(e.valor_descontar) : '',
          f.data_emissao || '',
          f.data_vencimento || '',
          f.created_at || '',
          e.executado_em || '',
          diasDesde(e.executado_em) ?? '',
          Math.max(Number(e.tentativas || 1) - 1, 0),
          e.aprovado_auditor_por || '',
          e.aprovado_auditor_em || '',
          e.destinatarios || '',
          e.motivo || '',
        ]),
        resumo: [
          ['Gerado em', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })],
          ['Gerado por', sessao?.nome || sessao?.email || ''],
          ['Etapa', etapaSel ? ETAPA[etapaSel]?.rotulo : 'Todas'],
          ['Auditor', auditorSel || 'Todos'],
          ['Busca', busca || '(nenhuma)'],
          ['Faturas exportadas', String(visiveis.length)],
        ],
      });
    } catch (ex) { setErro(`Erro ao exportar: ${ex.message || ex}`); } finally { setExportando(false); }
  };

  const aprovar = async (ids) => {
    if (!ids.length || busy) return;
    if (ids.length > 1 && !window.confirm(`Aprovar o laudo de ${ids.length} fatura(s)?`)) return;
    setBusy(true); setErro('');
    try {
      await aprovarLaudosRobo(ids, sessao?.nome || sessao?.email || 'auditor');
      await recarregar();
      // Transportadoras com "e-mail automatico": o laudo aprovado segue sozinho por e-mail (um por transportadora).
      const grupos = new Map();
      ids.forEach((id) => {
        const l = linhas.find((x) => String(x.e.fatura_id) === String(id));
        if (!l) return;
        const cfg = cfgDe(l.f.transportadora);
        if (!cfg?.email_automatico) return;
        const g = grupos.get(l.f.transportadora) || { transportadora: l.f.transportadora, ids: [] };
        g.ids.push(String(l.f.id));
        grupos.set(l.f.transportadora, g);
      });
      if (grupos.size && onEnviarEmail) {
        setAviso(`Laudo aprovado. Enviando por e-mail: ${[...grupos.values()].map((g) => `${g.transportadora} (${g.ids.length})`).join(', ')}...`);
        onEnviarEmail([...grupos.values()], 'auto');
      }
    } catch (e) { setErro(e.message); } finally { setBusy(false); }
  };
  const reavaliar = async (e, f) => {
    if (reavaliando) return;
    setReavaliando(String(f.id)); setErro(''); setAviso('');
    setProgUm({ numero: f.numero_fatura, faseId: 'lendo', ctAtual: 0, ctTotal: 0 });
    try {
      const reg = await reavaliarFaturaRobo(f, e, {
        usuario: sessao?.nome || sessao?.email || 'auditor',
        pesoMaisProximo,
        aoProgredir: (p) => setProgUm({ numero: f.numero_fatura, faseId: p.fase, ctAtual: p.atual || 0, ctTotal: p.total || 0 }),
      });
      setAviso(reg.acao_executada
        ? `Fatura ${f.numero_fatura}: estava correta e foi enviada para a aprovacao da gestao.`
        : `Fatura ${f.numero_fatura} reavaliada: ${reg.motivo}`);
      await recarregar();
    } catch (ex) { setErro(ex.message); setAviso(''); } finally { setReavaliando(''); setProgUm(null); }
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
      setLote({ atual: i + 1, total: alvo.length, enviadas, numero: f.numero_fatura, faseId: 'lendo', ctAtual: 0, ctTotal: 0 });
      try {
        const reg = await reavaliarFaturaRobo(f, e, {
          usuario,
          pesoMaisProximo,
          aoProgredir: (p) => setLote({ atual: i + 1, total: alvo.length, enviadas, numero: f.numero_fatura, faseId: p.fase, ctAtual: p.atual || 0, ctTotal: p.total || 0 }),
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

  // Laudos ja enviados (ou so baixados) agrupados por transportadora, para REENVIAR aos e-mails cadastrados.
  const paraReenviar = useMemo(() => {
    const mapa = new Map();
    linhas.filter((l) => l.etapa === 'transportadora' && (!auditorSel || l.auditor === auditorSel)).forEach((l) => {
      const k = l.f.transportadora || 'SEM TRANSPORTADORA';
      const r = mapa.get(k) || { transportadora: k, faturas: [], descontar: 0, auditores: new Set() };
      r.faturas.push(l.f); r.descontar += Number(l.e.valor_descontar || 0); r.auditores.add(l.auditor);
      mapa.set(k, r);
    });
    return [...mapa.values()].sort((a, b) => b.descontar - a.descontar);
  }, [linhas, auditorSel]);
  const emailsCadastrados = (nome) => String(cfgDe(nome)?.emails_transportadora || '').split(/[;,\s]+/).map((e) => e.trim()).filter((e) => e.includes('@'));
  const soEmailDeTeste = (lista) => lista.length > 0 && lista.every((e) => /aldomdias@gmail\.com/i.test(e));
  const reenviar = (c) => {
    const emails = emailsCadastrados(c.transportadora);
    if (!emails.length) { setErro(`${c.transportadora}: nenhum e-mail cadastrado na lista do robo.`); return; }
    if (!window.confirm(`Reenviar por e-mail o laudo consolidado de ${c.transportadora} (${c.faturas.length} fatura(s))?\n\nPara: ${emails.join(', ')}\nJunto: auditor responsavel e fatura@cantustore.com.br.`)) return;
    onEnviarEmail?.([{ transportadora: c.transportadora, ids: c.faturas.map((f) => String(f.id)) }], 'manual', { reenvio: true });
  };

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
      {resultadosEmail.length > 0 && (
        <div className="hint-box compact" style={{ borderLeft: `4px solid ${resultadosEmail.every((r) => r.ok) ? '#14733b' : '#b91c1c'}` }}>
          <strong>Envio de laudo por e-mail:</strong>
          {resultadosEmail.map((r, i) => (
            <div key={i}>
              {r.ok
                ? `✓ ${r.transportadora}: ${r.faturas} fatura(s) enviada(s) para ${(r.para || []).join(', ')}${(r.copia || []).length ? ` (auditor em copia: ${r.copia.join(', ')})` : ''}.`
                : `✗ ${r.transportadora}: nao enviado — ${r.erro}`}
            </div>
          ))}
          <button type="button" className="btn-secondary audit-small-button" style={{ marginTop: 6 }} onClick={() => { onLimparResultadosEmail?.(); recarregar(); }}>Fechar aviso</button>
        </div>
      )}
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
              Laudos aprovados agrupados: um clique em "Gerar laudo consolidado" cria o laudo unico da transportadora (todas as faturas) e baixa o e-mail (.eml) pronto.
              Envie uma vez e depois marque as faturas como enviadas.
            </div>
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead><tr><th>Transportadora</th><th>Faturas</th><th>Valor das faturas</th><th>A descontar</th><th>Envio</th><th /></tr></thead>
                <tbody>
                  {consolidados.map((c) => (
                    <tr key={c.transportadora}>
                      <td>{c.transportadora}</td>
                      <td>{c.faturas.length}: {c.faturas.slice(0, 6).map((f) => f.numero_fatura).join(', ')}{c.faturas.length > 6 ? ` +${c.faturas.length - 6}` : ''}</td>
                      <td>{dinheiro(c.total)}</td>
                      <td style={{ fontWeight: 700, color: '#b45309' }}>{dinheiro(c.descontar)}</td>
                      <td style={{ fontSize: 12 }}>{cfgDe(c.transportadora)?.email_automatico ? 'E-mail automatico' : 'Manual'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn-primary audit-small-button" disabled={!onEnviarEmail}
                          onClick={() => { if (window.confirm(`Enviar por e-mail o laudo consolidado de ${c.transportadora} (${c.faturas.length} fatura(s))? Vai para os e-mails cadastrados no robo, com o auditor em copia.`)) onEnviarEmail([{ transportadora: c.transportadora, ids: c.faturas.map((f) => String(f.id)) }], 'manual'); }}
                          title="Gera o laudo consolidado e envia por e-mail para a transportadora (auditor em copia).">
                          Enviar por e-mail
                        </button>{' '}
                        <button type="button" className="btn-primary audit-small-button" onClick={() => onAbrirConsolidado?.(c.transportadora, c.faturas)}
                          title="Gera sozinho o laudo consolidado desta transportadora (todas as faturas num so) e o e-mail (.eml) para enviar uma vez.">
                          Gerar laudo consolidado
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

      {etapaSel === 'transportadora' && paraReenviar.length > 0 && (
        <div className="table-card" style={{ borderLeft: '4px solid #475569' }}>
          <div className="panel-title audit-table-title">Reenviar laudo por e-mail — um e-mail por transportadora, auditor junto</div>
          <div style={{ padding: '0 12px 12px' }}>
            <div className="hint-box compact" style={{ marginBottom: 8 }}>
              Laudos que ja sairam (ou so foram baixados). O reenvio gera o laudo consolidado e manda para os e-mails cadastrados da transportadora,
              com o auditor responsavel e o grupo fatura@cantustore.com.br sempre juntos.
            </div>
            <div className="sim-analise-tabela-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
              <table className="sim-analise-tabela">
                <thead><tr><th>Transportadora</th><th>Faturas</th><th>A descontar</th><th>Auditor</th><th>E-mails cadastrados</th><th /></tr></thead>
                <tbody>
                  {paraReenviar.map((c) => {
                    const emails = emailsCadastrados(c.transportadora);
                    const teste = soEmailDeTeste(emails);
                    return (
                      <tr key={c.transportadora}>
                        <td>{c.transportadora}</td>
                        <td>{c.faturas.length}</td>
                        <td style={{ fontWeight: 700, color: '#b45309' }}>{dinheiro(c.descontar)}</td>
                        <td style={{ fontSize: 12 }}>{[...c.auditores].join(' / ')}</td>
                        <td style={{ fontSize: 12, maxWidth: 360, color: !emails.length ? '#b91c1c' : teste ? '#b45309' : undefined }}>
                          {!emails.length ? 'Sem e-mail cadastrado' : teste ? `${emails.join(', ')} (e-mail de teste)` : emails.join(', ')}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button type="button" className="btn-primary audit-small-button" disabled={!emails.length || !onEnviarEmail} onClick={() => reenviar(c)}>
                            Reenviar por e-mail
                          </button>
                        </td>
                      </tr>
                    );
                  })}
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

          <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12 }}
            title="Ao reavaliar: calcula cada CT-e com o peso do CT-e e com o peso do Tracking (cubagem x fator da tabela) e fica com o mais proximo do valor cobrado.">
            <input type="checkbox" checked={pesoMaisProximo} onChange={(ev) => { setPesoMaisProximo(ev.target.checked); gravarPreferenciaPesoMaisProximo(ev.target.checked); }} />
            Reavaliar com peso Tracking quando mais proximo
          </label>
          <button type="button" className="btn-secondary audit-small-button" disabled={!visiveis.length || exportando} onClick={exportarExcel}
            title="Baixa um Excel formatado com as faturas que estao na lista (respeita os filtros de etapa, auditor e busca).">
            {exportando ? 'Gerando Excel...' : `Exportar Excel (${visiveis.length})`}
          </button>
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
      <RoboProgressoAmd ativo={Boolean(lote)} {...(lote || {})} onParar={() => { parar.current = true; }} />
      <RoboProgressoAmd ativo={Boolean(progUm) && !lote} atual={1} total={1} {...(progUm || {})} />
    </div>
  );
}
