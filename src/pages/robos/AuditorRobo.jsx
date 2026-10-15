import { useEffect, useMemo, useState } from 'react';
import { carregarSessao } from '../../utils/authLocal';
import { getSupabaseClient } from '../../lib/supabaseClient';
import {
  classificarFatura, DECISAO, gravarExecucoesRobo, limparSimulacoesRobo, listarExecucoesRobo, listarFaturasEmAuditoria, ROBO_DATA_INICIO,
  listarNomesTransportadoras, listarRoboTransportadoras, normNome, removerRoboTransportadora, salvarRoboTransportadora,
} from '../../services/auditorRoboService';

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 16).replace('T', ' ').split(' ').map((p, i) => (i === 0 ? p.split('-').reverse().join('/') : p)).join(' ') : '-');

const ROTULO = {
  [DECISAO.ENVIAR_LAUDO]: { texto: 'Enviaria laudo ao transportador', cor: '#b45309' },
  [DECISAO.ENVIAR_APROVACAO]: { texto: 'Enviaria para aprovacao', cor: '#14733b' },
  [DECISAO.REVISAO_AUDITOR]: { texto: 'Fila do auditor (revisar)', cor: '#b91c1c' },
};

const LIMITE_POR_EXECUCAO = 20;
const LIMITE_REAVALIAR = 10;
const vazio = { transportadora: '', emails_transportadora: '', email_aprovacao: '' };

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
        const { f, anterior } = fila[i];
        const prefixo = `${anterior ? 'Reavaliando' : 'Fatura'} ${f.numero_fatura} (${i + 1} de ${fila.length})`;
        setMsg(`${prefixo}...`);
        try {
          const registro = await analisarFaturaRobo(db, f, {
            cfg: ativas.get(normNome(f.transportadora)), emailsAuditores, usuario, origem: `manual - ${usuario}`, anterior,
            aoProgredir: (p) => {
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
    } catch (ex) { setErro(ex.message); } finally { setRodando(false); }
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
          <button type="button" className="btn-primary" onClick={adicionar}>Incluir</button>
        </div>
        {lista.length > 0 && (
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead><tr><th>Transportadora</th><th>Auditor</th><th>E-mails laudo</th><th>Aprovacao</th><th>Modo</th><th>Ativo</th><th /></tr></thead>
              <tbody>
                {lista.map((r) => (
                  <tr key={r.id} style={{ opacity: r.ativo ? 1 : 0.55 }}>
                    <td>{r.transportadora}</td>
                    <td style={{ color: '#64748b', fontSize: 12 }}>Da carteira da fatura</td>
                    <td>{r.emails_transportadora || '-'}</td>
                    <td>{r.email_aprovacao || '-'}</td>
                    <td>{r.modo}</td>
                    <td><input type="checkbox" checked={r.ativo} onChange={() => alternarAtivo(r)} /></td>
                    <td><button type="button" className="btn-secondary audit-small-button" onClick={() => remover(r)}>Remover</button></td>
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
        {execucoes.length > 0 && (
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead><tr><th>Quando</th><th>Fatura</th><th>Transportadora</th><th>Valor</th><th>Decisao</th><th>A descontar</th><th>Para</th><th>Copia</th><th>Motivo</th></tr></thead>
              <tbody>
                {execucoes.slice(0, 300).map((e) => (
                  <tr key={e.id}>
                    <td>{dataBr(e.executado_em)}</td>
                    <td>{e.numero_fatura}</td>
                    <td>{e.transportadora}</td>
                    <td>{dinheiro(e.valor_fatura)}</td>
                    <td style={{ color: ROTULO[e.decisao]?.cor, fontWeight: 700 }}>{ROTULO[e.decisao]?.texto || e.decisao}{e.acao_executada ? '' : ' (simulado)'}</td>
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
    </div>
  );
}
