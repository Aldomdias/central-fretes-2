import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { carregarSessao } from '../../utils/authLocal';
import { getSupabaseClient } from '../../lib/supabaseClient';
import RoboProgressoAmd from '../../components/RoboProgressoAmd';
import {
  classificarFatura, DECISAO, STATUS_ROBO_AUDITA, gravarExecucoesRobo, limparSimulacoesRobo, listarExecucoesRobo, listarFaturasEmAuditoria, ROBO_DATA_INICIO,
  listarNomesTransportadoras, listarRoboTransportadoras, normNome, removerRoboTransportadora, salvarRoboTransportadora,
} from '../../services/auditorRoboService';

const FaturaDetalheModal = lazy(() => import('../CentralAuditoriaFretesPage').then((m) => ({ default: m.FaturaDetalheModal })));
const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 16).replace('T', ' ').split(' ').map((p, i) => (i === 0 ? p.split('-').reverse().join('/') : p)).join(' ') : '-');

const ROTULO = {
  [DECISAO.ENVIAR_LAUDO]: { texto: 'Enviaria laudo ao transportador', cor: '#b45309' },
  [DECISAO.ENVIAR_APROVACAO]: { texto: 'Enviaria para aprovacao', cor: '#14733b' },
  [DECISAO.REVISAO_AUDITOR]: { texto: 'Fila do auditor (revisar)', cor: '#b91c1c' },
};

const LIMITE_POR_EXECUCAO = 20;
const LIMITE_REAVALIAR = 10;
const soma0 = (arr) => arr.reduce((a, e) => a + Number(e.valor_descontar || 0), 0);
const vazio = { transportadora: '', emails_transportadora: '', email_aprovacao: '', email_automatico: false };

export default function AuditorRobo() {
  const sessao = carregarSessao();
  const [lista, setLista] = useState([]);
  const [semTabela, setSemTabela] = useState(false);
  const [faturas, setFaturas] = useState([]);
  const [nomesCadastro, setNomesCadastro] = useState([]);
  const [execucoes, setExecucoes] = useState([]);
  const [form, setForm] = useState(vazio);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [rodando, setRodando] = useState(false);

  const carregar = async () => {
    try {
      const [{ lista: l, semTabela: s }, f, e] = await Promise.all([listarRoboTransportadoras(), listarFaturasEmAuditoria(), listarExecucoesRobo()]);
      setLista(l); setSemTabela(s); setFaturas(f); setExecucoes(e); setErro('');
    } catch (ex) { setErro(ex.message); }
  };
  useEffect(() => { carregar(); listarNomesTransportadoras().then(setNomesCadastro).catch(() => {}); }, []);

  const nomesTransportadora = useMemo(() => {
    const mapa = new Map();
    [...nomesCadastro, ...faturas.map((f) => f.transportadora)].filter(Boolean).forEach((n) => { const k = normNome(n); if (!mapa.has(k)) mapa.set(k, String(n).trim()); });
    return [...mapa.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [nomesCadastro, faturas]);

  const adicionar = async () => {
    if (!form.transportadora.trim()) { setErro('Informe a transportadora.'); return; }
    if (lista.some((r) => normNome(r.transportadora) === normNome(form.transportadora))) { setErro('Transportadora ja esta na lista.'); return; }
    try {
      await salvarRoboTransportadora({ ...form, transportadora: form.transportadora.trim(), id: crypto.randomUUID(), ativo: true, modo: 'SOMBRA', created_by: sessao?.nome || sessao?.email || '' });
      setForm(vazio);
      await carregar();
    } catch (ex) { setErro(ex.message); }
  };

  const alternarEmail = async (r, automatico) => {
    if (automatico && !String(r.emails_transportadora || '').trim()) {
      setErro('Preencha os e-mails da transportadora que recebem o laudo antes de ligar o e-mail automatico (exclua e inclua de novo com os e-mails).');
      return;
    }
    try { await salvarRoboTransportadora({ ...r, email_automatico: automatico }); await carregar(); } catch (ex) { setErro(ex.message); await carregar(); }
  };

  const alternarAtivo = async (r) => {
    try { await salvarRoboTransportadora({ ...r, ativo: !r.ativo }); await carregar(); } catch (ex) { setErro(ex.message); }
  };
  const remover = async (r) => {
    if (!window.confirm(`Tirar ${r.transportadora} da lista do robo?`)) return;
    try { await removerRoboTransportadora(r.id); await carregar(); } catch (ex) { setErro(ex.message); }
  };

  const jaProcessadas = useMemo(() => new Set(execucoes.map((e) => String(e.fatura_id))), [execucoes]);
  const ativas = useMemo(() => new Map(lista.filter((r) => r.ativo).map((r) => [normNome(r.transportadora), r])), [lista]);
  const novas = useMemo(() => faturas.filter((f) => ativas.has(normNome(f.transportadora)) && !jaProcessadas.has(String(f.id))), [faturas, ativas, jaProcessadas]);

  const qtdReavaliar = useMemo(() => execucoes.filter((e) => !e.acao_executada && [DECISAO.REVISAO_AUDITOR, DECISAO.ENVIAR_LAUDO].includes(e.decisao)
    && faturas.some((f) => String(f.id) === String(e.fatura_id) && ativas.has(normNome(f.transportadora)))).length, [execucoes, faturas, ativas]);

  const executarSombra = async () => {
    const reavaliar = execucoes
      .filter((e) => !e.acao_executada && [DECISAO.REVISAO_AUDITOR, DECISAO.ENVIAR_LAUDO].includes(e.decisao))
      .map((e) => ({ f: faturas.find((x) => String(x.id) === String(e.fatura_id)), anterior: e }))
      .filter((x) => x.f && ativas.has(normNome(x.f.transportadora)))
      .sort((a, b) => String(a.anterior.reavaliado_em || a.anterior.executado_em).localeCompare(String(b.anterior.reavaliado_em || b.anterior.executado_em)))
      .slice(0, LIMITE_REAVALIAR);
    const lote = novas.slice(0, LIMITE_POR_EXECUCAO);
    if (!lote.length && !reavaliar.length) { setMsg('Nada para analisar agora.'); return; }
    setRodando(true); setErro(''); setMsg('');
    pararAmd.current = false;
    try {
      // Fatura por fatura: calcula, decide, envia (se correta) e GRAVA na hora. Se a tela
      // recarregar no meio, o que ja foi analisado fica salvo e a proxima execucao continua.
      const { analisarFaturaRobo, carregarEmailsAuditores } = await import('../../utils/auditoriaRoboCore');
      const db = getSupabaseClient();
      const emailsAuditores = await carregarEmailsAuditores(db);
      const usuario = sessao?.nome || sessao?.email || 'usuario';
      const fila = [...lote.map((f) => ({ f, anterior: null })), ...reavaliar];
      let analisadas = 0; let reavaliadas = 0; let enviadas = 0;
      const falhas = [];
      for (let i = 0; i < fila.length; i += 1) {
        if (pararAmd.current) break;
        const { f, anterior } = fila[i];
        setProgAmd({ atual: i + 1, total: fila.length, numero: f.numero_fatura, faseId: 'lendo', ctAtual: 0, ctTotal: 0, enviadas });
        const prefixo = `${anterior ? 'Reavaliando' : 'Fatura'} ${f.numero_fatura} (${i + 1} de ${fila.length})`;
        setMsg(`${prefixo}...`);
        try {
          const registro = await analisarFaturaRobo(db, f, {
            cfg: ativas.get(normNome(f.transportadora)), emailsAuditores, usuario, origem: `manual - ${usuario}`, anterior,
            aoProgredir: (p) => {
              setProgAmd({ atual: i + 1, total: fila.length, numero: f.numero_fatura, faseId: p.fase, ctAtual: p.atual || 0, ctTotal: p.total || 0, enviadas });
              const fase = p.fase === 'calculando' ? `calculando ${p.atual}/${p.total} CT-es` : p.fase === 'apurando' ? 'apurando desconto e entrega' : 'lendo CT-es';
              setMsg(`${prefixo}: ${fase} — ${analisadas + reavaliadas} concluida(s), ${enviadas} enviada(s) para a gestao.`);
            },
          });
          await gravarExecucoesRobo([registro]);
          if (anterior) reavaliadas += 1; else analisadas += 1;
          if (registro.acao_executada) enviadas += 1;
          if ((analisadas + reavaliadas) % 3 === 0) await carregar();
        } catch (exFatura) {
          falhas.push(`${f.numero_fatura}: ${exFatura.message || exFatura}`);
        }
      }
      setMsg(`${analisadas} nova(s) e ${reavaliadas} reavaliada(s); ${enviadas} enviada(s) para a gestao${novas.length > lote.length ? ` (restam ${novas.length - lote.length} novas, execute de novo)` : ''}${falhas.length ? `; ${falhas.length} falharam e serao tentadas de novo` : ''}. Nenhum e-mail foi enviado.`);
      if (falhas.length) setErro(falhas.slice(0, 5).join(' | '));
      await carregar();
    } catch (ex) { setErro(ex.message); } finally { setRodando(false); setProgAmd(null); }
  };

  const prontasParaGestao = useMemo(() => {
    const emAuditoria = new Map(faturas.map((f) => [String(f.id), f]));
    return execucoes.filter((e) => e.decisao === DECISAO.ENVIAR_APROVACAO && !e.acao_executada && emAuditoria.has(String(e.fatura_id)))
      .map((e) => emAuditoria.get(String(e.fatura_id)));
  }, [execucoes, faturas]);

  const enviarProntas = async () => {
    if (!prontasParaGestao.length) return;
    if (!window.confirm(`Enviar ${prontasParaGestao.length} fatura(s) correta(s) para a aprovacao da gestao (via robo)?`)) return;
    setRodando(true); setErro(''); setMsg('');
    try {
      const { apurarFaturaRobo, enviarFaturaParaGestaoRobo, carregarEmailsAuditores, emailDoAuditor } = await import('../../utils/auditoriaRoboCore');
      const db = getSupabaseClient();
      const emailsAuditores = await carregarEmailsAuditores(db);
      let enviadas = 0; let puladas = 0;
      for (let i = 0; i < prontasParaGestao.length; i += 1) {
        const f = prontasParaGestao[i];
        setMsg(`Conferindo e enviando ${i + 1} de ${prontasParaGestao.length}...`);
        const resumo = await apurarFaturaRobo(f);
        const c = classificarFatura(resumo, Boolean(f.auditoria_considerar_menor));
        if (c.decisao !== DECISAO.ENVIAR_APROVACAO) { puladas += 1; continue; }
        const r = await enviarFaturaParaGestaoRobo(db, f, resumo, { origem: `manual - ${sessao?.nome || sessao?.email || 'usuario'}` });
        if (!r.enviada) { puladas += 1; continue; }
        enviadas += 1;
        await gravarExecucoesRobo([{ fatura_id: String(f.id), numero_fatura: f.numero_fatura, transportadora: f.transportadora, modo: 'GESTAO', decisao: c.decisao, motivo: `${c.motivo} Enviada para aprovacao da gestao (via robo).`, valor_fatura: Number(f.valor_fatura || 0), valor_descontar: 0, auditor_nome: f.auditor_nome || '', auditor_email: emailDoAuditor(f, emailsAuditores), destinatarios: '', copia: emailDoAuditor(f, emailsAuditores), acao_executada: true, executado_por: sessao?.nome || sessao?.email || '', executado_em: new Date().toISOString() }]);
      }
      setMsg(`${enviadas} fatura(s) enviada(s) para a aprovacao da gestao${puladas ? `; ${puladas} nao estavam mais prontas e ficaram com o auditor` : ''}.`);
      await carregar();
    } catch (ex) { setErro(ex.message); } finally { setRodando(false); }
  };

  const limpar = async () => {
    if (!window.confirm('Apagar as simulacoes registradas para o robo reanalisar? (nada foi enviado, so os registros de teste)')) return;
    try { await limparSimulacoesRobo(); setMsg('Simulacoes apagadas.'); await carregar(); } catch (ex) { setErro(ex.message); }
  };

  const ultimaAuto = useMemo(() => execucoes.find((e) => String(e.executado_por || '').startsWith('Robo')), [execucoes]);

  // Status ATUAL de cada fatura que o robo registrou (a decisao do robo nao muda quando a gestao aprova).
  const [statusFat, setStatusFat] = useState(() => new Map());
  const idsExec = useMemo(() => [...new Set(execucoes.map((e) => String(e.fatura_id)))], [execucoes]);
  useEffect(() => {
    if (!idsExec.length) return undefined;
    let ativo = true;
    (async () => {
      const mapa = new Map();
      const client = getSupabaseClient();
      for (let i = 0; i < idsExec.length; i += 150) {
        const { data } = await client.from('faturas').select('id,status,data_envio_erp').in('id', idsExec.slice(i, i + 150));
        (data || []).forEach((f) => mapa.set(String(f.id), f));
      }
      if (ativo) setStatusFat(mapa);
    })().catch(() => {});
    return () => { ativo = false; };
  }, [idsExec.join('|')]);
  const emAuditoria = (e) => { const f = statusFat.get(String(e.fatura_id)); return !f || STATUS_ROBO_AUDITA.includes(f.status); };
  const LIBERADAS = ['PRONTA_PARA_PAGAMENTO', 'LIBERADA_COM_DESCONTO', 'ENVIADA_AO_FINANCEIRO', 'PAGA', 'PAGA_COM_DESCONTO', 'PAGA_COM_DIVERGENCIA'];
  const situacao = (e) => {
    const f = statusFat.get(String(e.fatura_id));
    if (!f) return '-';
    return ({
      RECEBIDA: 'Em auditoria', PRE_AUDITADA_VERUM: 'Em auditoria', REAUDITADA_CENTRAL: 'Em auditoria', COM_DIVERGENCIA: 'Com divergencia',
      AGUARDANDO_APROVACAO_GESTAO: 'Aguardando a gestao', PRONTA_PARA_PAGAMENTO: 'Aprovada / liberada', LIBERADA_COM_DESCONTO: 'Liberada com desconto',
      ENVIADA_AO_FINANCEIRO: 'No financeiro', PAGA: 'Paga', PAGA_COM_DESCONTO: 'Paga', PAGA_COM_DIVERGENCIA: 'Paga',
      AGUARDANDO_TRANSPORTADORA: 'Aguardando transportadora', AGUARDANDO_NOVA_FATURA: 'Aguardando nova fatura', CANCELADA: 'Cancelada', SUBSTITUIDA: 'Substituida',
    })[f.status] || f.status;
  };

  const [faturaAbertaId, setFaturaAbertaId] = useState(null);
  const [progAmd, setProgAmd] = useState(null);
  const pararAmd = useRef(false);
  const [periodo, setPeriodo] = useState('7');
  const [transpSel, setTranspSel] = useState('');
  const mesmaTransp = (nome) => !transpSel || normNome(nome) === normNome(transpSel);
  const painel = useMemo(() => {
    const corte = periodo === 'todos' ? 0 : Date.now() - Number(periodo) * 86400000;
    const listaPeriodo = execucoes.filter((e) => !corte || new Date(e.reavaliado_em || e.executado_em).getTime() >= corte);
    const lista = listaPeriodo.filter((e) => mesmaTransp(e.transportadora));
    const soma = (arr, f) => arr.reduce((a, e) => a + Number(f(e) || 0), 0);
    const gestao = lista.filter((e) => e.decisao === DECISAO.ENVIAR_APROVACAO && e.acao_executada);
    const liberadas = gestao.filter((e) => LIBERADAS.includes(statusFat.get(String(e.fatura_id))?.status));
    const noErp = liberadas.filter((e) => statusFat.get(String(e.fatura_id))?.data_envio_erp);
    // Laudo/revisao so contam como pendentes se a fatura ainda esta em auditoria; as que a gestao
    // ou o auditor ja trataram por fora saem daqui (aparecem em "Tratadas fora do robo").
    const laudos = lista.filter((e) => e.decisao === DECISAO.ENVIAR_LAUDO);
    // Laudo ja gerado/enviado: marcado pelo auditor OU a fatura ja esta "Aguardando transportadora" (o laudo muda o status).
    const laudosEnviados = laudos.filter((e) => e.acao_executada || statusFat.get(String(e.fatura_id))?.status === 'AGUARDANDO_TRANSPORTADORA');
    const laudosAprovados = laudos.filter((e) => !e.acao_executada && e.aprovado_auditor_em && emAuditoria(e));
    const laudosOk = laudos.filter((e) => !e.acao_executada && !e.aprovado_auditor_em && emAuditoria(e));
    const revisar = lista.filter((e) => e.decisao === DECISAO.REVISAO_AUDITOR && !e.acao_executada && emAuditoria(e));
    // Laudos que o robo enviou por e-mail (cada envio grava o mesmo horario em todas as faturas do e-mail).
    const laudosEmail = lista.filter((e) => e.modo === 'EMAIL_ENVIADO');
    const emailsEnviados = new Set(laudosEmail.map((e) => `${e.transportadora}|${e.executado_em}`)).size;
    const tratadas = lista.filter((e) => !e.acao_executada && [DECISAO.ENVIAR_LAUDO, DECISAO.REVISAO_AUDITOR].includes(e.decisao) && !emAuditoria(e) && !laudosEnviados.includes(e));
    const causa = { semCalculo: 0, semEntrega: 0, outros: 0 };
    revisar.forEach((e) => {
      const m = String(e.motivo || '').toLowerCase();
      if (m.includes('sem calculo')) causa.semCalculo += 1;
      else if (m.includes('sem entrega')) causa.semEntrega += 1;
      else causa.outros += 1;
    });
    const automaticas = lista.filter((e) => String(e.executado_por || '').startsWith('Robo'));
    const ordenar = (a, b) => String(b.reavaliado_em || b.executado_em).localeCompare(String(a.reavaliado_em || a.executado_em));
    const ultima = [...execucoes].sort(ordenar)[0];
    const ultimaAuto = [...execucoes].filter((e) => String(e.executado_por || '').startsWith('Robo')).sort(ordenar)[0];
    const porTransp = new Map();
    listaPeriodo.forEach((e) => {
      const r = porTransp.get(e.transportadora) || { nome: e.transportadora, analisadas: 0, gestao: 0, laudos: 0, revisar: 0, descontar: 0 };
      r.analisadas += 1;
      if (e.decisao === DECISAO.ENVIAR_APROVACAO && e.acao_executada) r.gestao += 1;
      if (e.decisao === DECISAO.ENVIAR_LAUDO) { r.laudos += 1; r.descontar += Number(e.valor_descontar || 0); }
      if (e.decisao === DECISAO.REVISAO_AUDITOR && !e.acao_executada) r.revisar += 1;
      porTransp.set(e.transportadora, r);
    });
    return {
      lista, gestao, liberadas, noErp, tratadas, laudosEmail, emailsEnviados, laudos, laudosEnviados, laudosAprovados, laudosOk, revisar, causa, automaticas, ultima, ultimaAuto,
      valorGestao: soma(gestao, (e) => e.valor_fatura),
      descontarTotal: soma(laudos, (e) => e.valor_descontar),
      reavaliacoes: soma(lista, (e) => Math.max(Number(e.tentativas || 1) - 1, 0)),
      taxa: lista.length ? Math.round((gestao.length / lista.length) * 100) : 0,
      porTransp: [...porTransp.values()].sort((a, b) => b.analisadas - a.analisadas),
    };
  }, [execucoes, periodo, statusFat, transpSel]);

  const [cardSel, setCardSel] = useState('');
  const novasFiltradas = useMemo(() => novas.filter((f) => mesmaTransp(f.transportadora)), [novas, transpSel]);
  const registrosCard = useMemo(() => {
    const por = {
      analisadas: painel.lista,
      gestao: painel.gestao,
      liberadas: painel.liberadas,
      tratadas: painel.tratadas,
      laudosEmail: painel.laudosEmail,
      laudos: painel.laudos,
      laudosOk: painel.laudosOk,
      laudosAprovados: painel.laudosAprovados,
      laudosEnviados: painel.laudosEnviados,
      revisar: painel.revisar,
      reavaliacoes: painel.lista.filter((e) => Number(e.tentativas || 1) > 1),
    };
    const base = cardSel && por[cardSel] ? por[cardSel] : painel.lista;
    return base;
  }, [painel, cardSel]);
  const ROTULO_CARD = {
    analisadas: 'Faturas analisadas', liberadas: 'Aprovadas pela gestao', tratadas: 'Tratadas fora do robo', laudosEmail: 'Laudos enviados por e-mail', novas: 'Novas aguardando', gestao: 'Enviadas para a gestao', laudos: 'Laudos com desconto',
    laudosOk: 'Laudos aguardando seu OK', laudosAprovados: 'Laudos aprovados, a enviar', laudosEnviados: 'Laudos enviados',
    revisar: 'Para revisar', reavaliacoes: 'Reavaliacoes feitas',
  };

  const resumo = useMemo(() => execucoes.reduce((acc, e) => { acc[e.decisao] = (acc[e.decisao] || 0) + 1; return acc; }, {}), [execucoes]);

  return (
    <div className="page-stack">
      {semTabela && (
        <div className="hint-box compact" style={{ borderLeft: '4px solid #b91c1c' }}>
          Tabelas do robo ainda nao existem. Aplique <code>supabase/migrations/20261014_002_auditor_robo.sql</code> no Supabase.
        </div>
      )}
      {erro && <div className="hint-box compact" style={{ borderLeft: '4px solid #b91c1c' }}>{erro}</div>}
      {msg && <div className="hint-box compact" style={{ borderLeft: '4px solid #14733b' }}>{msg}</div>}

      <div className="table-card">
        <div className="panel-title audit-table-title" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Painel do robo</span>
          <select value={transpSel} onChange={(e) => { setTranspSel(e.target.value); }} title="Filtrar o painel por transportadora">
            <option value="">Todas as transportadoras</option>
            {[...new Set([...lista.map((r) => r.transportadora), ...execucoes.map((e) => e.transportadora)].filter(Boolean))]
              .sort((a, b) => a.localeCompare(b, 'pt-BR')).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            <option value="1">Ultimas 24h</option>
            <option value="7">Ultimos 7 dias</option>
            <option value="30">Ultimos 30 dias</option>
            <option value="todos">Desde o inicio</option>
          </select>
          <span style={{ fontWeight: 400, fontSize: 12, color: '#475569' }}>
            Ultima execucao automatica: {painel.ultimaAuto ? dataBr(painel.ultimaAuto.executado_em) : 'ainda nao rodou'}
            {painel.ultima ? ` · ultima atividade: ${dataBr(painel.ultima.reavaliado_em || painel.ultima.executado_em)} (${painel.ultima.executado_por || '-'})` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '0 12px 12px' }}>
          {[
            ['analisadas', 'Faturas analisadas', painel.lista.length, `${painel.automaticas.length} pelo robo automatico`, '#071d49'],
            ['novas', 'Novas aguardando', novasFiltradas.length, 'ainda nao analisadas', '#475569'],
            ['gestao', 'Enviadas para a gestao', painel.gestao.length, `${painel.gestao.length - painel.liberadas.length} aguardando · ${painel.liberadas.length} aprovadas · ${painel.taxa}% sem intervencao`, '#7c3aed'],
            ['liberadas', 'Aprovadas pela gestao', painel.liberadas.length, `${dinheiro(painel.liberadas.reduce((a, e) => a + Number(e.valor_fatura || 0), 0))} liberados · ${painel.noErp.length} ja no ERP`, '#0f766e'],
            ['laudos', 'Laudos com desconto', painel.laudos.length, `${dinheiro(painel.descontarTotal)} a descontar no total`, '#b45309'],
            ['laudosOk', 'Laudos aguardando seu OK', painel.laudosOk.length, `${dinheiro(soma0(painel.laudosOk))} a descontar`, '#c2410c'],
            ['laudosAprovados', 'Laudos aprovados, a enviar', painel.laudosAprovados.length, `${dinheiro(soma0(painel.laudosAprovados))} a descontar`, '#0e7490'],
            ['laudosEmail', 'Laudos enviados por e-mail', painel.laudosEmail.length, `${painel.emailsEnviados} e-mail(s) · ${dinheiro(soma0(painel.laudosEmail))} a descontar`, '#0369a1'],
            ['laudosEnviados', 'Laudos enviados', painel.laudosEnviados.length, `${dinheiro(soma0(painel.laudosEnviados))} a descontar`, '#14733b'],
            ['revisar', 'Para revisar', painel.revisar.length, `${painel.causa.semCalculo} sem calculo · ${painel.causa.semEntrega} sem entrega · ${painel.causa.outros} outros`, '#b91c1c'],
            ['tratadas', 'Tratadas fora do robo', painel.tratadas.length, 'laudo/revisao ja resolvidos pelo auditor ou gestao', '#64748b'],
            ['reavaliacoes', 'Reavaliacoes feitas', painel.reavaliacoes, 'casos em que o robo voltou a olhar', '#475569'],
          ].map(([id, rotulo, valor, sub, cor]) => {
            const ativo = cardSel === id;
            return (
              <button
                key={id} type="button" onClick={() => setCardSel(ativo ? '' : id)}
                title="Clique para ver as faturas deste card na tabela abaixo"
                style={{
                  flex: '1 1 190px', textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: '8px 12px',
                  border: `2px solid ${cor}`, background: ativo ? cor : '#fff', color: ativo ? '#fff' : '#0f172a',
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.9 }}>{rotulo}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: ativo ? '#fff' : cor }}>{valor}</div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>{sub}</div>
              </button>
            );
          })}
        </div>
        {painel.porTransp.length > 0 && (
          <div className="sim-analise-tabela-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="sim-analise-tabela">
              <thead><tr><th>Transportadora</th><th>Analisadas</th><th>Enviadas a gestao</th><th>Laudos</th><th>A descontar</th><th>Para revisar</th></tr></thead>
              <tbody>
                {painel.porTransp.map((r) => (
                  <tr key={r.nome} onClick={() => setTranspSel(normNome(transpSel) === normNome(r.nome) ? '' : r.nome)} style={{ cursor: 'pointer', background: normNome(transpSel) === normNome(r.nome) ? '#eef2ff' : undefined }}>
                    <td>{r.nome}</td><td>{r.analisadas}</td><td>{r.gestao}</td><td>{r.laudos}</td>
                    <td>{r.descontar > 0 ? dinheiro(r.descontar) : '-'}</td>
                    <td style={{ color: r.revisar ? '#b91c1c' : undefined, fontWeight: r.revisar ? 700 : 400 }}>{r.revisar}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="hint-box compact">
        <strong>O que o robo faz hoje:</strong> faturas corretas (calculadas, sem desconto e todas entregues) vao direto para a
        <strong> aprovacao da gestao, marcadas "via robo"</strong>; o auditor acompanha no Meu Painel. Faturas com desconto ficam
        registradas como "enviaria laudo" e as duvidosas vao para a fila do auditor. <strong>Nenhum e-mail e enviado ainda</strong>.
        <br /><strong>Como funciona:</strong> considera as faturas que entraram a partir de {ROBO_DATA_INICIO.split('-').reverse().join('/')}.
        Para cada uma, o robo calcula os CT-es (se ainda nao calculados), apura o valor a descontar e a entrega, e decide:
        com desconto → laudo; correta e toda entregue → aprovacao; qualquer duvida → fila do auditor.
      </div>

      <div className="table-card">
        <div className="panel-title audit-table-title">Transportadoras monitoradas</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: 12 }}>
          <input list="robo-transportadoras" placeholder="Transportadora" value={form.transportadora}
            onChange={(e) => setForm((p) => ({ ...p, transportadora: e.target.value }))} style={{ minWidth: 220 }} />
          <datalist id="robo-transportadoras">{nomesTransportadora.map((n) => <option key={n} value={n} />)}</datalist>
          <input placeholder="E-mails da transportadora que recebem o laudo" value={form.emails_transportadora} onChange={(e) => setForm((p) => ({ ...p, emails_transportadora: e.target.value }))} style={{ minWidth: 240 }} />
          <input placeholder="E-mail de aprovacao (financeiro)" value={form.email_aprovacao} onChange={(e) => setForm((p) => ({ ...p, email_aprovacao: e.target.value }))} />
          <select value={form.email_automatico ? 'auto' : 'manual'} onChange={(e) => setForm((p) => ({ ...p, email_automatico: e.target.value === 'auto' }))}
            title="Automatico: depois que o auditor aprova o laudo, o e-mail sai sozinho para a transportadora. Manual: o auditor envia.">
            <option value="manual">Laudo: o auditor envia (manual)</option>
            <option value="auto">Laudo: e-mail automatico apos o OK do auditor</option>
          </select>
          <button type="button" className="btn-primary" onClick={adicionar}>Incluir</button>
        </div>
        {lista.length > 0 && (
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead><tr><th>Transportadora</th><th>Auditor</th><th>E-mails laudo</th><th>Aprovacao</th><th>Envio do laudo</th><th>Modo</th><th>Ativo</th><th /></tr></thead>
              <tbody>
                {lista.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => { setTranspSel(normNome(transpSel) === normNome(r.transportadora) ? '' : r.transportadora); }}
                    title="Clique para filtrar o painel e a lista por esta transportadora"
                    style={{ opacity: r.ativo ? 1 : 0.55, cursor: 'pointer', background: normNome(transpSel) === normNome(r.transportadora) ? '#eef2ff' : undefined }}
                  >
                    <td>{r.transportadora}</td>
                    <td style={{ color: '#64748b', fontSize: 12 }}>Da carteira da fatura</td>
                    <td>{r.emails_transportadora || '-'}</td>
                    <td>{r.email_aprovacao || '-'}</td>
                    <td onClick={(ev) => ev.stopPropagation()}>
                      <select value={r.email_automatico ? 'auto' : 'manual'} onChange={(e) => alternarEmail(r, e.target.value === 'auto')} style={{ fontSize: 12 }}>
                        <option value="manual">Manual</option>
                        <option value="auto">E-mail automatico</option>
                      </select>
                    </td>
                    <td>{r.modo}</td>
                    <td onClick={(ev) => ev.stopPropagation()}><input type="checkbox" checked={r.ativo} onChange={() => alternarAtivo(r)} /></td>
                    <td onClick={(ev) => ev.stopPropagation()}><button type="button" className="btn-secondary audit-small-button" onClick={() => remover(r)}>Remover</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="table-card">
        <div className="panel-title audit-table-title" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Execucao</span>
          <span style={{ fontWeight: 400, fontSize: 12, color: '#475569' }}>{novas.length} nova(s) para analisar · {qtdReavaliar} em revisao/laudo sendo reavaliada(s)</span>
          <span style={{ fontWeight: 400, fontSize: 12, color: '#475569' }}>
            Automatico (1x por dia): {ultimaAuto ? `ultima analise em ${dataBr(ultimaAuto.executado_em)}` : 'aguardando a primeira execucao'}
          </span>
          <button type="button" className="btn-primary audit-small-button" disabled={rodando || (!novas.length && !qtdReavaliar)} onClick={executarSombra}>
            {rodando ? 'Trabalhando...' : 'Executar agora'}
          </button>
          <button type="button" className="btn-primary audit-small-button" disabled={rodando || !prontasParaGestao.length} onClick={enviarProntas}
            title="Faturas corretas ja analisadas, ainda em auditoria: enviar todas para a aprovacao da gestao (via robo).">
            Enviar prontas para a gestao ({prontasParaGestao.length})
          </button>
          <button type="button" className="btn-secondary audit-small-button" disabled={rodando || !execucoes.length} onClick={limpar}>Limpar simulacoes</button>
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '0 12px 8px', fontSize: 13 }}>
          {Object.values(DECISAO).map((d) => <span key={d} style={{ color: ROTULO[d].cor, fontWeight: 700 }}>{ROTULO[d].texto}: {resumo[d] || 0}</span>)}
        </div>
        {(cardSel || transpSel) && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '0 12px 8px', fontSize: 13 }}>
            <strong>Filtro:</strong>
            {cardSel && <span>{ROTULO_CARD[cardSel]}</span>}
            {transpSel && <span>· {transpSel}</span>}
            <span style={{ color: '#475569' }}>({cardSel === 'novas' ? novasFiltradas.length : registrosCard.length} registro(s))</span>
            <button type="button" className="btn-secondary audit-small-button" onClick={() => { setCardSel(''); setTranspSel(''); }}>Limpar filtro</button>
          </div>
        )}
        {cardSel === 'novas' && (
          <div className="sim-analise-tabela-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="sim-analise-tabela">
              <thead><tr><th>Fatura</th><th>Transportadora</th><th>Valor</th><th>Auditor</th><th>Entrou em</th></tr></thead>
              <tbody>
                {novasFiltradas.slice(0, 500).map((f) => (
                  <tr key={f.id}>
                    <td><button type="button" className="link-button" onClick={() => setFaturaAbertaId(f.id)}>{f.numero_fatura}</button></td><td>{f.transportadora}</td><td>{dinheiro(f.valor_fatura)}</td>
                    <td>{f.auditor_nome || '-'}</td><td>{dataBr(f.importado_em || f.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {execucoes.length > 0 && cardSel !== 'novas' && (
          <div className="sim-analise-tabela-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table className="sim-analise-tabela">
              <thead><tr><th>Quando</th><th>Fatura</th><th>Transportadora</th><th>Valor</th><th>Decisao</th><th>Situacao atual</th><th>A descontar</th><th>Para</th><th>Copia</th><th>Motivo</th></tr></thead>
              <tbody>
                {(cardSel === 'novas' ? [] : registrosCard).slice(0, 500).map((e) => (
                  <tr key={e.id}>
                    <td>{dataBr(e.executado_em)}</td>
                    <td><button type="button" className="link-button" onClick={() => setFaturaAbertaId(e.fatura_id)}>{e.numero_fatura}</button></td>
                    <td>{e.transportadora}</td>
                    <td>{dinheiro(e.valor_fatura)}</td>
                    <td style={{ color: ROTULO[e.decisao]?.cor, fontWeight: 700 }}>{ROTULO[e.decisao]?.texto || e.decisao}{e.acao_executada ? '' : ' (simulado)'}</td>
                    <td style={{ fontWeight: 600 }}>{situacao(e)}</td>
                    <td>{e.valor_descontar > 0 ? dinheiro(e.valor_descontar) : '-'}</td>
                    <td>{e.destinatarios || '-'}</td>
                    <td>{e.copia || '-'}</td>
                    <td>{e.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {faturaAbertaId && (
        <Suspense fallback={<div className="panel-card">Abrindo a fatura...</div>}>
          <FaturaDetalheModal faturaId={faturaAbertaId} onClose={() => { setFaturaAbertaId(null); carregar(); }} />
        </Suspense>
      )}
      <RoboProgressoAmd ativo={Boolean(progAmd)} {...(progAmd || {})} onParar={() => { pararAmd.current = true; }} />
    </div>
  );
}
