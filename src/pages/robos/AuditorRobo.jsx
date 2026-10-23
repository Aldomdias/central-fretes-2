import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { carregarSessao } from '../../utils/authLocal';
import { getSupabaseClient } from '../../lib/supabaseClient';
import RoboProgressoAmd from '../../components/RoboProgressoAmd';
import HistoricoRodadasRobo from '../../components/HistoricoRodadasRobo';
import StatusServidorRobo from '../../components/StatusServidorRobo';
import {
  classificarFatura, DECISAO, STATUS_ROBO_AUDITA, gravarExecucoesRobo, limparSimulacoesRobo, listarExecucoesRobo, listarFaturasEmAuditoria, dataInicioRobo, dataEntradaFatura,
  carregarConfigRobo, salvarConfigRobo, listarNomesTransportadoras, listarRoboTransportadoras, registrarRodadaRobo, normNome, removerRoboTransportadora, salvarRoboTransportadora, laudoResolvidoFora,
} from '../../services/auditorRoboService';

const FaturaDetalheModal = lazy(() => import('../CentralAuditoriaFretesPage').then((m) => ({ default: m.FaturaDetalheModal })));
const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
// Timestamp (UTC no banco) -> data e hora de Brasilia; so data (YYYY-MM-DD) -> dd/mm/aaaa.
const dataBr = (v) => {
  if (!v) return '-';
  const texto = String(v);
  if (!texto.includes('T')) return texto.slice(0, 10).split('-').reverse().join('/');
  const d = new Date(texto);
  if (Number.isNaN(d.getTime())) return texto.slice(0, 16).replace('T', ' ');
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
};

const ROTULO = {
  [DECISAO.ENVIAR_LAUDO]: { texto: 'Enviaria laudo ao transportador', cor: '#b45309' },
  [DECISAO.ENVIAR_APROVACAO]: { texto: 'Enviaria para aprovacao', cor: '#14733b' },
  [DECISAO.REVISAO_AUDITOR]: { texto: 'Fila do auditor (revisar)', cor: '#b91c1c' },
};

// Navegador: sem limite de tempo nem custo de servidor; o botao "Parar apos esta fatura" interrompe quando quiser.
const LIMITE_POR_EXECUCAO = 1000;
const LIMITE_REAVALIAR = 200;
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

  const alterarDataInicio = async (r, data) => {
    try {
      await salvarRoboTransportadora({ ...r, data_inicio: data || null });
      setMsg(data ? `${r.transportadora}: o robo considera faturas que entraram no sistema desde ${data.split('-').reverse().join('/')}.` : `${r.transportadora}: data de inicio voltou ao padrao (um dia antes da inclusao).`);
      await carregar();
    } catch (ex) { setErro(ex.message); await carregar(); }
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
  const novas = useMemo(() => faturas.filter((f) => ativas.has(normNome(f.transportadora))
    && dataEntradaFatura(f) >= dataInicioRobo(ativas.get(normNome(f.transportadora)))
    && !jaProcessadas.has(String(f.id)))
    // Mais antigas primeiro: o que ficou para depois e o proximo da fila, nunca esquecido.
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))), [faturas, ativas, jaProcessadas]);

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
      let analisadas = 0; let reavaliadas = 0; let enviadas = 0; let laudos = 0; let revisar = 0;
      const falhas = [];
      const resumoFaturas = [];
      const inicioRodada = Date.now();
      for (let i = 0; i < fila.length; i += 1) {
        if (pararAmd.current) break;
        const { f, anterior } = fila[i];
        setProgAmd({ atual: i + 1, total: fila.length, numero: f.numero_fatura, faseId: 'lendo', ctAtual: 0, ctTotal: 0, enviadas });
        const prefixo = `${anterior ? 'Reavaliando' : 'Fatura'} ${f.numero_fatura} (${i + 1} de ${fila.length})`;
        setMsg(`${prefixo}...`);
        try {
          const registro = await analisarFaturaRobo(db, f, {
            cfg: ativas.get(normNome(f.transportadora)), emailsAuditores, usuario, origem: `manual - ${usuario}`, anterior, recalcularTudo: Boolean(anterior),
            aoProgredir: (p) => {
              setProgAmd({ atual: i + 1, total: fila.length, numero: f.numero_fatura, faseId: p.fase, ctAtual: p.atual || 0, ctTotal: p.total || 0, enviadas });
              const fase = p.fase === 'calculando' ? `calculando ${p.atual}/${p.total} CT-es` : p.fase === 'apurando' ? 'apurando desconto e entrega' : 'lendo CT-es';
              setMsg(`${prefixo}: ${fase} — ${analisadas + reavaliadas} concluida(s), ${enviadas} enviada(s) para a gestao.`);
            },
          });
          await gravarExecucoesRobo([registro]);
          if (anterior) reavaliadas += 1; else analisadas += 1;
          if (registro.acao_executada) enviadas += 1;
          if (registro.decisao === DECISAO.ENVIAR_LAUDO) laudos += 1;
          if (registro.decisao === DECISAO.REVISAO_AUDITOR) revisar += 1;
          resumoFaturas.push({
            numero: f.numero_fatura, transportadora: f.transportadora, tipo: anterior ? 'reavaliada' : 'nova',
            decisao: registro.decisao, enviada: Boolean(registro.acao_executada), valor_descontar: registro.valor_descontar || 0,
            motivo: String(registro.motivo || '').slice(0, 220),
          });
          if ((analisadas + reavaliadas) % 3 === 0) await carregar();
        } catch (exFatura) {
          falhas.push(`${f.numero_fatura}: ${exFatura.message || exFatura}`);
        }
      }
      setMsg(`${analisadas} nova(s) e ${reavaliadas} reavaliada(s); ${enviadas} enviada(s) para a gestao${novas.length > lote.length ? ` (restam ${novas.length - lote.length} novas, execute de novo)` : ''}${falhas.length ? `; ${falhas.length} falharam e serao tentadas de novo` : ''}. Nenhum e-mail foi enviado.`);
      if (falhas.length) setErro(falhas.slice(0, 5).join(' | '));
      await registrarRodadaRobo({
        cadeia_id: globalThis.crypto.randomUUID(), origem: 'navegador', iniciado_em: new Date(inicioRodada).toISOString(),
        finalizado_em: new Date().toISOString(), duracao_ms: Date.now() - inicioRodada, calcular_nuvem: null,
        novas_encontradas: novas.length, analisadas, reavaliadas, enviadas_gestao: enviadas, laudos, revisar,
        // O que ficou de fato pendente: todas as novas que havia menos as analisadas, mais as reavaliacoes nao feitas.
        restantes: Math.max(novas.length - analisadas, 0) + Math.max(reavaliar.length - reavaliadas, 0), estourou_tempo: false, erros: falhas.slice(0, 50),
        faturas: resumoFaturas, executado_por: usuario,
      });
      setHistoricoVersao((v) => v + 1);
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
        const { data } = await client.from('faturas').select('id,status,data_envio_erp,partida,lancamento_financeiro,data_pagamento,valor_pago').in('id', idsExec.slice(i, i + 150));
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
  const [historicoVersao, setHistoricoVersao] = useState(0);
  const [cfgRobo, setCfgRobo] = useState(null);
  const [cfgSemTabela, setCfgSemTabela] = useState(false);
  const [cfgAberta, setCfgAberta] = useState(false);
  const [cfgSalvando, setCfgSalvando] = useState(false);
  useEffect(() => { carregarConfigRobo().then(({ config, semTabela }) => { setCfgRobo(config); setCfgSemTabela(semTabela); }).catch((e) => setErro(e.message)); }, []);
  const salvarCfg = async () => {
    setCfgSalvando(true); setErro(''); setMsg('');
    try {
      const salvo = await salvarConfigRobo(cfgRobo, sessao?.nome || sessao?.email || '');
      setCfgRobo((a) => ({ ...a, ...salvo }));
      setMsg('Configuracao do robo salva. Vale a partir da proxima hora cheia.');
    } catch (ex) { setErro(ex.message); } finally { setCfgSalvando(false); }
  };
  // Clicar numa hora/dia/opcao ja grava no banco (vale na proxima hora cheia), sem botao de salvar.
  const aplicarCfg = async (novo, texto = 'Configuracao salva.') => {
    const anterior = cfgRobo;
    setCfgRobo(novo);
    setErro('');
    try {
      const salvo = await salvarConfigRobo(novo, sessao?.nome || sessao?.email || '');
      setCfgRobo((a) => ({ ...a, ...salvo }));
      setMsg(`${texto} Vale a partir da proxima hora cheia.`);
    } catch (ex) { setCfgRobo(anterior); setErro(ex.message); }
  };
  const alternarNaLista = (campo, valor) => {
    const atual = new Set(cfgRobo[campo] || []);
    if (atual.has(valor)) atual.delete(valor); else atual.add(valor);
    aplicarCfg({ ...cfgRobo, [campo]: [...atual].sort((x, y) => x - y) }, campo === 'horas' ? 'Horarios atualizados.' : 'Dias atualizados.');
  };
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
    // Ja resolvido por fora (baixado, lancado no ERP ou pago): sai das listas de laudo e vai para "Tratadas fora do robo".
    const resolvidoFora = (e) => laudoResolvidoFora(e, statusFat.get(String(e.fatura_id)));
    // Laudo ja gerado/enviado: marcado pelo auditor OU a fatura ja esta "Aguardando transportadora" (o laudo muda o status).
    const laudosEnviados = laudos.filter((e) => !resolvidoFora(e) && (e.acao_executada || statusFat.get(String(e.fatura_id))?.status === 'AGUARDANDO_TRANSPORTADORA'));
    const laudosAprovados = laudos.filter((e) => !resolvidoFora(e) && !e.acao_executada && e.aprovado_auditor_em && emAuditoria(e));
    const laudosOk = laudos.filter((e) => !resolvidoFora(e) && !e.acao_executada && !e.aprovado_auditor_em && emAuditoria(e));
    const revisar = lista.filter((e) => e.decisao === DECISAO.REVISAO_AUDITOR && !e.acao_executada && emAuditoria(e));
    // Laudos que o robo enviou por e-mail (cada envio grava o mesmo horario em todas as faturas do e-mail).
    const laudosEmail = lista.filter((e) => e.modo === 'EMAIL_ENVIADO');
    const emailsEnviados = new Set(laudosEmail.map((e) => `${e.transportadora}|${e.executado_em}`)).size;
    const tratadas = lista.filter((e) => resolvidoFora(e) || (!e.acao_executada && [DECISAO.ENVIAR_LAUDO, DECISAO.REVISAO_AUDITOR].includes(e.decisao) && !emAuditoria(e) && !laudosEnviados.includes(e)));
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

      <StatusServidorRobo config={cfgRobo} />

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

      <HistoricoRodadasRobo key={historicoVersao} />

      <div className="hint-box compact">
        <strong>O que o robo faz hoje:</strong> faturas corretas (calculadas, sem desconto e todas entregues) vao direto para a
        <strong> aprovacao da gestao, marcadas "via robo"</strong>; o auditor acompanha no Meu Painel. Faturas com desconto ficam
        registradas como "enviaria laudo" e as duvidosas vao para a fila do auditor. <strong>Nenhum e-mail e enviado ainda</strong>.
        <br /><strong>Como funciona:</strong> considera, para cada transportadora, as faturas que entraram a partir de <strong>um dia antes de ela ser incluida</strong> na lista (coluna "Considera desde").
        Para cada uma, o robo calcula os CT-es (se ainda nao calculados), apura o valor a descontar e a entrega, e decide:
        com desconto → laudo; correta e toda entregue → aprovacao; qualquer duvida → fila do auditor.
      </div>

      <div className="table-card">
        <div className="panel-title audit-table-title" style={{ cursor: 'pointer', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }} onClick={() => setCfgAberta((v) => !v)}>
          <span>{cfgAberta ? '▾' : '▸'} Configuracao do robo (horarios e limites)</span>
          {cfgRobo && (
            <span style={{ fontWeight: 400, fontSize: 12, color: cfgRobo.ativo ? '#14733b' : '#b91c1c' }}>
              {cfgRobo.ativo ? `Ligado · ${(cfgRobo.horas || []).map((h) => `${String(h).padStart(2, '0')}h`).join(', ') || 'sem horarios'}` : 'DESLIGADO'}
            </span>
          )}
          {cfgRobo && (
            <span style={{ display: 'inline-flex', gap: 8, marginLeft: 'auto' }} onClick={(ev) => ev.stopPropagation()}>
              <button
                type="button" onClick={() => aplicarCfg({ ...cfgRobo, ativo: !cfgRobo.ativo }, cfgRobo.ativo ? 'Robo desligado.' : 'Robo ligado.')}
                title="Liga ou desliga o robo automatico na nuvem (o botao Executar agora continua funcionando)"
                style={{ padding: '3px 10px', borderRadius: 999, cursor: 'pointer', fontWeight: 700, fontSize: 12, border: `1px solid ${cfgRobo.ativo ? '#14733b' : '#b91c1c'}`, background: cfgRobo.ativo ? '#ecfdf3' : '#fef2f2', color: cfgRobo.ativo ? '#14733b' : '#b91c1c' }}
              >
                {cfgRobo.ativo ? 'Robo: LIGADO' : 'Robo: DESLIGADO'}
              </button>
              <button
                type="button" onClick={() => aplicarCfg({ ...cfgRobo, calcular_nuvem: cfgRobo.calcular_nuvem === false }, cfgRobo.calcular_nuvem === false ? 'Calculo na nuvem ligado.' : 'Calculo na nuvem desligado (economiza).')}
                title="COM calculo: o robo calcula os CT-es na nuvem (usa mais tempo de funcao). SEM calculo: so decide sobre o que ja esta calculado (custo minimo)."
                style={{ padding: '3px 10px', borderRadius: 999, cursor: 'pointer', fontWeight: 700, fontSize: 12, border: `1px solid ${cfgRobo.calcular_nuvem === false ? '#b45309' : '#0369a1'}`, background: cfgRobo.calcular_nuvem === false ? '#fffbeb' : '#eff6ff', color: cfgRobo.calcular_nuvem === false ? '#b45309' : '#0369a1' }}
              >
                {cfgRobo.calcular_nuvem === false ? 'SEM calculo de CT-es (economia)' : 'COM calculo de CT-es'}
              </button>
            </span>
          )}
        </div>
        {cfgAberta && cfgRobo && (
          <div style={{ padding: '0 12px 12px', display: 'grid', gap: 12 }}>
            {cfgSemTabela && (
              <div className="hint-box compact" style={{ borderLeft: '4px solid #b91c1c' }}>
                Aplique a migration <code>supabase/migrations/20261016_002_auditor_robo_config.sql</code> no Supabase para poder salvar esta configuracao (enquanto isso vale o padrao: 06h, 12h e 19h).
              </div>
            )}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
              <input type="checkbox" checked={Boolean(cfgRobo.ativo)} onChange={(e) => aplicarCfg({ ...cfgRobo, ativo: e.target.checked }, e.target.checked ? 'Robo ligado.' : 'Robo desligado.')} />
              Robo automatico ligado
            </label>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Horarios de execucao (horario de Brasilia)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Array.from({ length: 24 }, (_, h) => h).map((h) => {
                  const on = (cfgRobo.horas || []).includes(h);
                  return (
                    <button key={h} type="button" onClick={() => alternarNaLista('horas', h)}
                      style={{ minWidth: 44, padding: '4px 6px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${on ? '#071d49' : '#cbd5e1'}`, background: on ? '#071d49' : '#fff', color: on ? '#fff' : '#334155', fontWeight: 700 }}>
                      {String(h).padStart(2, '0')}h
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Dias da semana</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'].map((nome, d) => {
                  const on = (cfgRobo.dias_semana || []).includes(d);
                  return (
                    <button key={nome} type="button" onClick={() => alternarNaLista('dias_semana', d)}
                      style={{ minWidth: 52, padding: '4px 6px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${on ? '#071d49' : '#cbd5e1'}`, background: on ? '#071d49' : '#fff', color: on ? '#fff' : '#334155', fontWeight: 700 }}>
                      {nome}
                    </button>
                  );
                })}
              </div>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={cfgRobo.calcular_nuvem !== false} onChange={(e) => aplicarCfg({ ...cfgRobo, calcular_nuvem: e.target.checked }, 'Calculo na nuvem atualizado.')} />
              Calcular os CT-es na nuvem (se desligado, o robo so decide sobre o que ja esta calculado)
            </label>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <label className="field" style={{ maxWidth: 200 }}>Faturas novas por rodada
                <input type="number" min="1" max="300" value={cfgRobo.max_faturas} onChange={(e) => setCfgRobo((a) => ({ ...a, max_faturas: e.target.value }))} />
              </label>
              <label className="field" style={{ maxWidth: 200 }}>CT-es por bloco de calculo
                <input type="number" min="1" max="50" value={cfgRobo.bloco_ctes} onChange={(e) => setCfgRobo((a) => ({ ...a, bloco_ctes: e.target.value }))} />
              </label>
              <label className="field" style={{ maxWidth: 220 }}>Limite por bloco (segundos)
                <input type="number" min="20" max="240" value={cfgRobo.limite_bloco_seg} onChange={(e) => setCfgRobo((a) => ({ ...a, limite_bloco_seg: e.target.value }))} />
              </label>
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              A Vercel acorda o robo toda hora cheia e ele so trabalha nas horas e dias marcados. As mudancas valem na proxima hora cheia.
              {cfgRobo.atualizado_por ? ` Ultima alteracao: ${cfgRobo.atualizado_por}${cfgRobo.atualizado_em ? ` em ${dataBr(cfgRobo.atualizado_em)}` : ''}.` : ''}
            </div>
            <div><button type="button" className="btn-secondary" disabled={cfgSalvando} onClick={salvarCfg}>{cfgSalvando ? 'Salvando...' : 'Salvar limites (numeros)'}</button> <span style={{ fontSize: 12, color: '#64748b' }}>Horarios, dias e liga/desliga salvam ao clicar; os numeros salvam por este botao.</span></div>
          </div>
        )}
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
              <thead><tr><th>Transportadora</th><th>Auditor</th><th>E-mails laudo</th><th>Aprovacao</th><th>Envio do laudo</th><th>Considera desde</th><th>Modo</th><th>Ativo</th><th /></tr></thead>
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
                    <td onClick={(ev) => ev.stopPropagation()} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      <input
                        type="date" value={dataInicioRobo(r)} style={{ fontSize: 12, padding: '2px 4px' }}
                        title="Faturas que entraram no sistema a partir desta data entram no robo. Padrao: um dia antes da inclusao."
                        onChange={(e) => alterarDataInicio(r, e.target.value)}
                      />
                      {r.data_inicio
                        ? <button type="button" className="link-button" style={{ fontSize: 11, marginLeft: 4 }} title="Voltar para o padrao (um dia antes da inclusao)" onClick={() => alterarDataInicio(r, null)}>padrao</button>
                        : <span style={{ fontSize: 11, color: '#64748b', marginLeft: 4 }}>(padrao)</span>}
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
            Automatico (conforme a configuracao): {ultimaAuto ? `ultima analise em ${dataBr(ultimaAuto.executado_em)}` : 'aguardando a primeira execucao'}
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
