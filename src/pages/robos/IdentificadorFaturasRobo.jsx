import { useEffect, useMemo, useState } from 'react';
import { carregarSessao } from '../../utils/authLocal';
import { getSupabaseClient } from '../../lib/supabaseClient';
import { listarNomesTransportadoras, normNome } from '../../services/auditorRoboService';

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const dataHoraBr = (v) => (v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '-');
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const PERIODOS = [['SEMANAL', 'Semanal'], ['QUINZENAL', 'Quinzenal'], ['MENSAL', 'Mensal']];
const SITUACAO = {
  SEM_FATURA_NO_PERIODO: { texto: 'Sem fatura no período', cor: '#b91c1c' },
  CONFERIR_CTES: { texto: 'Conferir CT-es sem fatura', cor: '#b45309' },
  OK: { texto: 'Em dia', cor: '#14733b' },
  SEM_CTES: { texto: 'Sem CT-es a faturar', cor: '#64748b' },
  ERRO: { texto: 'Erro', cor: '#b91c1c' },
};
const CONFIG_PADRAO = { ativo: true, horas: [8], dias_semana: [2], enviar_emails: false, janela_cte_dias: 30 };
const vazio = { id: '', transportadora: '', nao_cadastrada: false, periodicidade: 'SEMANAL', emails_transportadora: '', emails_copia: '', auditor_nome: '', auditor_email: '' };
const ausente = (e) => ['42P01', 'PGRST205'].includes(e?.code) || /does not exist|schema cache/i.test(e?.message || '');
const caixa = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 14 };
const campo = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, minWidth: 180, flex: '1 1 200px' };

export default function IdentificadorFaturasRobo() {
  const sessao = carregarSessao();
  const quem = sessao?.nome || sessao?.email || '';
  const [lista, setLista] = useState([]);
  const [execucoes, setExecucoes] = useState([]);
  const [config, setConfig] = useState(CONFIG_PADRAO);
  const [nomes, setNomes] = useState([]);
  const [carteiras, setCarteiras] = useState([]);
  const [robo, setRobo] = useState([]);
  const [form, setForm] = useState({ ...vazio, auditor_nome: sessao?.nome || '', auditor_email: sessao?.email || '' });
  const [semTabela, setSemTabela] = useState(false);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [rodando, setRodando] = useState(false);

  const carregar = async () => {
    const db = getSupabaseClient();
    try {
      const [t, e, c] = await Promise.all([
        db.from('robo_faturas_transportadoras').select('*').order('transportadora'),
        db.from('robo_faturas_execucoes').select('*').order('executado_em', { ascending: false }).limit(300),
        db.from('robo_faturas_config').select('*').eq('id', 1).maybeSingle(),
      ]);
      const falha = t.error || e.error || c.error;
      if (falha) { if (ausente(falha)) { setSemTabela(true); return; } throw new Error(falha.message); }
      setSemTabela(false);
      setLista(t.data || []); setExecucoes(e.data || []); setConfig({ ...CONFIG_PADRAO, ...(c.data || {}) });
    } catch (ex) { setErro(ex.message || String(ex)); }
  };

  useEffect(() => {
    carregar();
    listarNomesTransportadoras().then((n) => setNomes(n.sort((a, b) => a.localeCompare(b, 'pt-BR')))).catch(() => {});
    const db = getSupabaseClient();
    db.from('auditoria_carteiras').select('transportadora,auditor_nome,auditor_email').limit(5000).then(({ data }) => setCarteiras(data || [])).catch(() => {});
    db.from('auditor_robo_transportadoras').select('transportadora,emails_transportadora').limit(2000).then(({ data }) => setRobo(data || [])).catch(() => {});
  }, []);

  const ultimaPorTransp = useMemo(() => {
    const m = new Map();
    execucoes.forEach((x) => { if (!m.has(String(x.transportadora_id))) m.set(String(x.transportadora_id), x); });
    return m;
  }, [execucoes]);
  const naoCadastradas = lista.filter((t) => t.nao_cadastrada);

  const escolher = (nome) => {
    const existe = nomes.find((n) => normNome(n) === normNome(nome));
    const carteira = carteiras.find((c) => normNome(c.transportadora) === normNome(nome));
    const dadosRobo = robo.find((r) => normNome(r.transportadora) === normNome(nome));
    setForm((f) => ({
      ...f, transportadora: existe || nome,
      ...(existe && carteira ? { auditor_nome: carteira.auditor_nome || f.auditor_nome, auditor_email: carteira.auditor_email || f.auditor_email } : {}),
      ...(existe && dadosRobo?.emails_transportadora && !f.emails_transportadora ? { emails_transportadora: dadosRobo.emails_transportadora } : {}),
    }));
  };

  const salvar = async () => {
    setErro(''); setMsg('');
    const nome = form.transportadora.trim();
    if (!nome) { setErro('Informe a transportadora.'); return; }
    const noCadastro = nomes.some((n) => normNome(n) === normNome(nome));
    const naoCad = form.nao_cadastrada || !noCadastro;
    if (naoCad && !form.nao_cadastrada && !window.confirm(`"${nome}" não está no cadastro de transportadoras. Incluir mesmo assim? Ela vai para a fila de cadastro do administrador.`)) return;
    const payload = {
      transportadora: nome, nao_cadastrada: naoCad, periodicidade: form.periodicidade,
      emails_transportadora: form.emails_transportadora.trim() || null, emails_copia: form.emails_copia.trim() || null,
      auditor_nome: form.auditor_nome.trim() || null, auditor_email: form.auditor_email.trim().toLowerCase() || null,
      updated_at: new Date().toISOString(),
    };
    const db = getSupabaseClient();
    const { error } = form.id
      ? await db.from('robo_faturas_transportadoras').update(payload).eq('id', form.id)
      : await db.from('robo_faturas_transportadoras').insert({ ...payload, created_by: quem });
    if (error) { setErro(/duplicate|unique/i.test(error.message) ? 'Essa transportadora já está na lista.' : error.message); return; }
    setMsg(`${nome} ${form.id ? 'atualizada' : 'cadastrada'}.`);
    setForm({ ...vazio, auditor_nome: sessao?.nome || '', auditor_email: sessao?.email || '' });
    carregar();
  };

  const alternar = async (t) => { await getSupabaseClient().from('robo_faturas_transportadoras').update({ ativo: !t.ativo, updated_at: new Date().toISOString() }).eq('id', t.id); carregar(); };
  const remover = async (t) => {
    if (!window.confirm(`Remover ${t.transportadora} do robô?`)) return;
    await getSupabaseClient().from('robo_faturas_transportadoras').delete().eq('id', t.id); carregar();
  };
  const marcarCadastrada = async (t) => { await getSupabaseClient().from('robo_faturas_transportadoras').update({ nao_cadastrada: false }).eq('id', t.id); carregar(); };

  const salvarConfig = async () => {
    setErro(''); setMsg('');
    const payload = {
      id: 1, ativo: Boolean(config.ativo), enviar_emails: Boolean(config.enviar_emails),
      horas: [...new Set((config.horas || []).map(Number).filter((h) => h >= 0 && h <= 23))].sort((a, b) => a - b),
      dias_semana: [...new Set((config.dias_semana || []).map(Number))].sort((a, b) => a - b),
      janela_cte_dias: Math.min(Math.max(Number(config.janela_cte_dias) || 30, 7), 90),
      atualizado_por: quem, atualizado_em: new Date().toISOString(),
    };
    const { error } = await getSupabaseClient().from('robo_faturas_config').upsert(payload);
    if (error) setErro(error.message); else setMsg('Agendamento salvo.');
  };

  const rodar = async (simular) => {
    if (!simular && !config.enviar_emails) { setErro('O envio de e-mails está desligado. Ligue "Enviar e-mails de verdade" e salve antes de rodar valendo.'); return; }
    if (!simular && !window.confirm('Rodar agora e ENVIAR e-mails aos transportadores que estiverem com pendência?')) return;
    setRodando(true); setErro(''); setMsg('');
    try {
      const resp = await fetch(`/api/robo-faturas-ausentes?agora=1${simular ? '&simular=1' : ''}`);
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(dados.error || `HTTP ${resp.status}`);
      if (!dados.ok) throw new Error('O servidor não respondeu como o robô. Localmente (vite) o robô não existe; rode no deploy da Vercel ou com "vercel dev".');
      setMsg(dados.motivo || `${dados.simulado ? 'Simulação' : 'Execução'} concluída: ${dados.analisadas} transportadora(s) analisada(s), ${dados.emailsEnviados} e-mail(s) enviado(s), ${dados.erros} erro(s).`);
      carregar();
    } catch (ex) { setErro(`Não foi possível rodar: ${ex.message || ex}`); } finally { setRodando(false); }
  };

  const alternarItem = (chave, valor) => setConfig((c) => {
    const atual = new Set((c[chave] || []).map(Number));
    if (atual.has(valor)) atual.delete(valor); else atual.add(valor);
    return { ...c, [chave]: [...atual] };
  });

  if (semTabela) {
    return (
      <div style={{ ...caixa, borderColor: '#f59e0b', background: '#fffbeb' }}>
        <b>Falta aplicar a migration no Supabase:</b> <code>supabase/migrations/20261118_003_robo_identificador_faturas.sql</code>. Depois recarregue esta tela.
      </div>
    );
  }

  return (
    <div>
      {erro && <div style={{ ...caixa, borderColor: '#fca5a5', background: '#fef2f2', color: '#991b1b' }}>{erro}</div>}
      {msg && <div style={{ ...caixa, borderColor: '#86efac', background: '#f0fdf4', color: '#166534' }}>{msg}</div>}

      {naoCadastradas.length > 0 && (
        <div style={{ ...caixa, borderColor: '#f59e0b', background: '#fffbeb' }}>
          <b>Transportadoras informadas que não estão no cadastro ({naoCadastradas.length}) — cadastrar:</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {naoCadastradas.map((t) => (
              <li key={t.id}>{t.transportadora} <span style={{ color: '#64748b' }}>(por {t.created_by || '-'}, {dataBr(t.created_at)})</span> <button type="button" className="btn-secondary" style={{ marginLeft: 8, padding: '2px 8px' }} onClick={() => marcarCadastrada(t)}>Já cadastrei</button></li>
            ))}
          </ul>
        </div>
      )}

      <div style={caixa}>
        <h3 style={{ margin: '0 0 10px' }}>{form.id ? 'Editar transportadora' : 'Cadastrar transportadora sem fatura'}</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ ...campo, flex: '2 1 280px' }}>Transportadora
            <input list="lista-transp-faturas" value={form.transportadora} onChange={(e) => escolher(e.target.value)} placeholder="Digite para pesquisar no cadastro" />
            <datalist id="lista-transp-faturas">{nomes.map((n) => <option key={n} value={n} />)}</datalist>
          </label>
          <label style={campo}>Tipo de faturamento
            <select value={form.periodicidade} onChange={(e) => setForm({ ...form, periodicidade: e.target.value })}>{PERIODOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select>
          </label>
          <label style={campo}>E-mail(s) do transportador (faturas)
            <input value={form.emails_transportadora} onChange={(e) => setForm({ ...form, emails_transportadora: e.target.value })} placeholder="vazio = usa o do Robô Auditor" />
          </label>
          <label style={campo}>E-mail em cópia (opcional)
            <input value={form.emails_copia} onChange={(e) => setForm({ ...form, emails_copia: e.target.value })} placeholder="separe por ;" />
          </label>
          <label style={campo}>Auditor responsável
            <input value={form.auditor_nome} onChange={(e) => setForm({ ...form, auditor_nome: e.target.value })} />
          </label>
          <label style={campo}>E-mail do auditor (vai em cópia)
            <input value={form.auditor_email} onChange={(e) => setForm({ ...form, auditor_email: e.target.value })} />
          </label>
        </div>
        <label style={{ display: 'block', marginTop: 8, fontSize: 13 }}>
          <input type="checkbox" checked={form.nao_cadastrada} onChange={(e) => setForm({ ...form, nao_cadastrada: e.target.checked })} /> Não achei na lista — incluir como nova (vai para a fila de cadastro do administrador)
        </label>
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <button type="button" className="btn-primary" onClick={salvar}>{form.id ? 'Salvar alterações' : 'Cadastrar'}</button>
          {form.id && <button type="button" className="btn-secondary" onClick={() => setForm({ ...vazio, auditor_nome: sessao?.nome || '', auditor_email: sessao?.email || '' })}>Cancelar</button>}
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b' }}>Auditor e e-mails vêm do cadastro quando a transportadora é encontrada; pode ajustar. O grupo padrão da auditoria vai sempre em cópia.</p>
      </div>

      <div style={caixa}>
        <h3 style={{ margin: '0 0 10px' }}>Agendamento (roda na Vercel)</h3>
        <label style={{ marginRight: 16 }}><input type="checkbox" checked={Boolean(config.ativo)} onChange={(e) => setConfig({ ...config, ativo: e.target.checked })} /> Robô ligado</label>
        <label><input type="checkbox" checked={Boolean(config.enviar_emails)} onChange={(e) => setConfig({ ...config, enviar_emails: e.target.checked })} /> <b>Enviar e-mails de verdade</b> (desligado = só registra o que enviaria)</label>
        <div style={{ margin: '10px 0', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>Dias:</span>
          {DIAS.map((d, i) => <label key={d}><input type="checkbox" checked={(config.dias_semana || []).map(Number).includes(i)} onChange={() => alternarItem('dias_semana', i)} /> {d}</label>)}
          <label>Horário (Brasília, hora cheia):
            <input type="number" min={0} max={23} style={{ width: 60, marginLeft: 6 }} value={(config.horas || [])[0] ?? 8} onChange={(e) => setConfig({ ...config, horas: [Number(e.target.value)] })} />h
          </label>
          <label>Olhar CT-es dos últimos
            <input type="number" min={7} max={90} style={{ width: 60, margin: '0 6px' }} value={config.janela_cte_dias} onChange={(e) => setConfig({ ...config, janela_cte_dias: e.target.value })} />dias
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn-primary" onClick={salvarConfig}>Salvar agendamento</button>
          <button type="button" className="btn-secondary" disabled={rodando} onClick={() => rodar(true)}>{rodando ? 'Rodando...' : 'Rodar agora (simulação, sem e-mail)'}</button>
          <button type="button" className="btn-secondary" disabled={rodando} onClick={() => rodar(false)}>Rodar agora e enviar e-mails</button>
        </div>
      </div>

      <div style={caixa}>
        <h3 style={{ margin: '0 0 10px' }}>Transportadoras monitoradas ({lista.length})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left', background: '#f1f5f9' }}>
              <th style={{ padding: 6 }}>Transportadora</th><th>Faturamento</th><th>Auditor</th><th>Última checagem</th><th>Faturas no período</th><th>CT-es sem fatura</th><th>Situação</th><th />
            </tr></thead>
            <tbody>
              {lista.map((t) => {
                const u = ultimaPorTransp.get(String(t.id));
                const s = SITUACAO[u?.situacao];
                return (
                  <tr key={t.id} style={{ borderTop: '1px solid #e2e8f0', opacity: t.ativo ? 1 : 0.5 }}>
                    <td style={{ padding: 6 }}>{t.transportadora}{t.nao_cadastrada && <span style={{ color: '#b45309' }}> (não cadastrada)</span>}</td>
                    <td>{PERIODOS.find(([v]) => v === t.periodicidade)?.[1]}</td>
                    <td>{t.auditor_nome || '-'}</td>
                    <td>{u ? dataHoraBr(u.executado_em) : '-'}</td>
                    <td>{u ? u.faturas_no_periodo : '-'}</td>
                    <td>{u ? `${u.ctes_sem_fatura} (${dinheiro(u.valor_sem_fatura)})` : '-'}</td>
                    <td style={{ color: s?.cor }}>{s?.texto || '-'}{u?.email_enviado ? ' · e-mail enviado' : ''}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => { setForm({ ...vazio, ...t, emails_transportadora: t.emails_transportadora || '', emails_copia: t.emails_copia || '', auditor_nome: t.auditor_nome || '', auditor_email: t.auditor_email || '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Editar</button>{' '}
                      <button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => alternar(t)}>{t.ativo ? 'Pausar' : 'Ativar'}</button>{' '}
                      <button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => remover(t)}>Remover</button>
                    </td>
                  </tr>
                );
              })}
              {!lista.length && <tr><td colSpan={8} style={{ padding: 12, color: '#64748b' }}>Nenhuma transportadora cadastrada ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={caixa}>
        <h3 style={{ margin: '0 0 10px' }}>Histórico de execuções</h3>
        <div style={{ overflowX: 'auto', maxHeight: 320 }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left', background: '#f1f5f9' }}><th style={{ padding: 6 }}>Quando</th><th>Transportadora</th><th>Período</th><th>Faturas</th><th>CT-es sem fatura</th><th>Situação</th><th>E-mail</th><th>Observação</th></tr></thead>
            <tbody>
              {execucoes.map((x) => (
                <tr key={x.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: 6 }}>{dataHoraBr(x.executado_em)}</td><td>{x.transportadora}</td>
                  <td>{dataBr(x.periodo_inicio)} a {dataBr(x.periodo_fim)}</td><td>{x.faturas_no_periodo ?? '-'}</td>
                  <td>{x.ctes_sem_fatura ?? '-'}</td><td style={{ color: SITUACAO[x.situacao]?.cor }}>{SITUACAO[x.situacao]?.texto || x.situacao}</td>
                  <td>{x.email_enviado ? `Enviado: ${x.destinatarios}` : '-'}</td><td>{x.observacao || ''}</td>
                </tr>
              ))}
              {!execucoes.length && <tr><td colSpan={8} style={{ padding: 12, color: '#64748b' }}>Sem execuções ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
