import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { usuarioEhGestorAuditoria } from '../utils/authLocal';
import { diasAte } from '../utils/auditoriaFretesDomain';

const INTERVALO_MS = 5 * 60000;
const A_VENCER_DIAS = 10;
const ATRASO_MAX_DIAS = 60; // vencidas: so considera ate 2 meses para tras
const STATUS_FORA = '(PAGA,PAGA_COM_DESCONTO,PAGA_COM_DIVERGENCIA,CANCELADA,SUBSTITUIDA)';
const TAM_PAGINA = 1000;
const MAX_PAGINAS = 5;
const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataIso = (dias) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

function classificar(fatura) {
  if (String(fatura.status || '').startsWith('PAGA') || ['CANCELADA', 'SUBSTITUIDA'].includes(fatura.status)) return null;
  const dias = diasAte(fatura.data_vencimento);
  if (dias == null) return null;
  const lancada = Boolean(fatura.partida || fatura.lancamento_financeiro);
  if (dias >= 0 && dias <= A_VENCER_DIAS) return lancada ? null : 'A_VENCER'; // a vencer: so o que esta nao pago
  if (dias < 0 && dias >= -ATRASO_MAX_DIAS) return 'VENCIDA'; // vencida: qualquer uma nao paga
  return null;
}

function situacao(fatura) {
  if (fatura.status === 'AGUARDANDO_TRANSPORTADORA' || fatura.confirmacao_transportador_status === 'ENVIADO') return { texto: 'Aguardando transportador', cor: '#e67e22' };
  if (fatura.partida || fatura.lancamento_financeiro) return { texto: 'Lançada, aguardando pagto.', cor: '#b45309' };
  return { texto: 'Sem lançamento', cor: '#9b1111' };
}

// Avisos fixos (acima do de Suprimentos): (1) faturas nao pagas que vencem nos
// proximos 10 dias e (2) vencidas nao pagas dos ultimos 2 meses. Auditor ve as
// suas; gestor ve todas, com resumo por auditor. Clicar leva para as Faturas.
export default function AvisoPrazoFaturas({ sessao, onAbrir, minimizavel = false }) {
  const [faturas, setFaturas] = useState([]);
  const [antecipadasBrutas, setAntecipadasBrutas] = useState([]);
  const [expandido, setExpandido] = useState(false);
  const [aberto, setAberto] = useState(null); // null | 'A_VENCER' | 'VENCIDA' | 'ANTECIPADA'
  const gestor = usuarioEhGestorAuditoria(sessao);
  const meuEmail = String(sessao?.email || '').trim().toLowerCase();
  const meuNome = String(sessao?.nome || '').trim().toLowerCase();

  useEffect(() => {
    if (!isSupabaseConfigured()) return undefined;
    let ativo = true;
    const consultar = async () => {
      try {
        const client = getSupabaseClient();
        const todas = [];
        for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
          const { data, error } = await client
            .from('faturas')
            .select('id, numero_fatura, transportadora, status, auditor_nome, auditor_email, data_vencimento, valor_fatura, partida, lancamento_financeiro, confirmacao_transportador_status')
            .gte('data_vencimento', dataIso(-ATRASO_MAX_DIAS))
            .lte('data_vencimento', dataIso(A_VENCER_DIAS))
            .not('status', 'in', STATUS_FORA)
            .order('data_vencimento', { ascending: true })
            .order('id', { ascending: true })
            .range(pagina * TAM_PAGINA, (pagina + 1) * TAM_PAGINA - 1);
          if (error || !ativo) return;
          todas.push(...(data || []));
          if ((data || []).length < TAM_PAGINA) break;
        }
        if (ativo) setFaturas(todas);
        // Gestao: lancadas com vencimento a mais de 10 dias (lancamento antecipado).
        if (gestor) {
          const cedo = [];
          for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
            const { data, error } = await client
              .from('faturas')
              .select('id, numero_fatura, transportadora, status, auditor_nome, auditor_email, data_vencimento, valor_fatura, partida, lancamento_financeiro, confirmacao_transportador_status')
              .gte('data_vencimento', dataIso(A_VENCER_DIAS))
              .not('status', 'in', STATUS_FORA)
              .or('partida.not.is.null,lancamento_financeiro.not.is.null')
              .order('data_vencimento', { ascending: true })
              .order('id', { ascending: true })
              .range(pagina * TAM_PAGINA, (pagina + 1) * TAM_PAGINA - 1);
            if (error || !ativo) break;
            cedo.push(...(data || []));
            if ((data || []).length < TAM_PAGINA) break;
          }
          if (ativo) setAntecipadasBrutas(cedo);
        }
      } catch { /* aviso e opcional: falha aqui nao pode atrapalhar a tela */ }
    };
    consultar();
    const timer = window.setInterval(consultar, INTERVALO_MS);
    const aoVoltar = () => { if (document.visibilityState === 'visible') consultar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { ativo = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', aoVoltar); };
  }, [gestor]);

  const antecipadas = useMemo(() => antecipadasBrutas
    .filter((f) => (f.partida || f.lancamento_financeiro) && !String(f.status || '').startsWith('PAGA'))
    .map((f) => ({ ...f, tipo: 'ANTECIPADA', dias: diasAte(f.data_vencimento) }))
    .filter((f) => f.dias != null && f.dias >= A_VENCER_DIAS)
    .sort((a, b) => b.dias - a.dias), [antecipadasBrutas]);

  const itens = useMemo(() => faturas
    .filter((f) => {
      if (gestor) return true;
      const email = String(f.auditor_email || '').trim().toLowerCase();
      const nome = String(f.auditor_nome || '').trim().toLowerCase();
      return (!!meuEmail && email === meuEmail) || (!!meuNome && nome === meuNome);
    })
    .map((f) => ({ ...f, tipo: classificar(f), dias: diasAte(f.data_vencimento) }))
    .filter((f) => f.tipo), [faturas, gestor, meuEmail, meuNome]);

  const aVencer = useMemo(() => itens.filter((i) => i.tipo === 'A_VENCER').sort((a, b) => a.dias - b.dias), [itens]);
  const vencidas = useMemo(() => itens.filter((i) => i.tipo === 'VENCIDA').sort((a, b) => b.dias - a.dias), [itens]);

  // Abre as Faturas de um auditor inteiro (nao so uma fatura) no filtro escolhido.
  const abrirDoAuditor = (nome, filtroRapido) => {
    const semAuditor = nome === 'SEM AUDITOR DEFINIDO';
    setAberto(null);
    onAbrir?.({ visao: semAuditor ? 'sem_auditor' : 'todas', filtroRapido, ...(semAuditor ? {} : { auditorFiltro: nome }) });
  };

  const abrirFaturas = (filtros) => { setAberto(null); onAbrir?.({ visao: gestor ? 'todas' : 'minhas', ...filtros }); };

  const configs = [
    { chave: 'A_VENCER', lista: aVencer, cor: '#e67e22', bottom: 104, titulo: `A vencer nos próximos ${A_VENCER_DIAS} dias (não pagas)`, botao: `⏰ A vencer (${A_VENCER_DIAS}d): ${aVencer.length}`, filtroRapido: 'alerta_a_vencer' },
    { chave: 'VENCIDA', lista: vencidas, cor: '#9b1111', bottom: 150, titulo: 'Vencidas e não pagas (últimos 2 meses)', botao: `⚠ Vencidas: ${vencidas.length}`, filtroRapido: 'alerta_vencidas' },
    { chave: 'ANTECIPADA', lista: gestor ? antecipadas : [], cor: '#0369a1', bottom: 196, titulo: `Lançadas com ${A_VENCER_DIAS} dias ou mais para vencer (gestão)`, botao: `📅 Lançadas antecipadas: ${antecipadas.length}`, filtroRapido: 'alerta_antecipadas' },
  ].filter((c) => c.lista.length);
  if (!configs.length) return null;
  const total = configs.reduce((acc, c) => acc + c.lista.length, 0);
  // Em telas de trabalho (ex.: Faturas) fica so um botao pequeno; clicar mostra os tres.
  const recolhido = minimizavel && !expandido;
  const base = minimizavel ? 46 : 0;
  const ativa = recolhido ? null : configs.find((c) => c.chave === aberto);
  const listaAtiva = ativa ? ativa.lista : [];
  // Mesma tabela por auditor nos tres avisos (gestao): quantidade, valor e dias.
  const porAuditorPainel = (() => {
    if (!ativa || !gestor) return [];
    const mapa = new Map();
    ativa.lista.forEach((i) => {
      const nome = i.auditor_nome || 'SEM AUDITOR DEFINIDO';
      const atual = mapa.get(nome) || { nome, qtd: 0, valor: 0, somaDias: 0, maxDias: 0 };
      const dias = Math.abs(i.dias);
      atual.qtd += 1; atual.valor += Number(i.valor_fatura || 0); atual.somaDias += dias; atual.maxDias = Math.max(atual.maxDias, dias);
      mapa.set(nome, atual);
    });
    return [...mapa.values()].sort((a, b) => b.qtd - a.qtd);
  })();

  return (
    <>
      {ativa && (
        <div style={{ position: 'fixed', right: 16, bottom: 242 + base, zIndex: 9999, width: 480, maxWidth: 'calc(100vw - 32px)', maxHeight: '60vh', overflow: 'auto', background: '#fff', border: `1px solid ${ativa.cor}`, borderLeft: `5px solid ${ativa.cor}`, borderRadius: 10, padding: 12, boxShadow: '0 8px 26px rgba(0,0,0,.3)', fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{ativa.titulo} {gestor ? '· todos os auditores' : '· suas'}</strong>
            <button type="button" onClick={() => setAberto(null)} style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 16 }} aria-label="Fechar">×</button>
          </div>
          <div style={{ margin: '4px 0 8px', color: '#475569' }}>
            {listaAtiva.length} fatura(s) · {dinheiro(listaAtiva.reduce((acc, i) => acc + Number(i.valor_fatura || 0), 0))} · clique numa fatura para abri-la
          </div>
          {gestor && porAuditorPainel.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
              <thead><tr style={{ textAlign: 'left', color: '#475569' }}><th>Auditor (clique no número p/ abrir)</th><th>Faturas</th><th>Valor</th><th>Dias (média)</th><th>Máx.</th></tr></thead>
              <tbody>{porAuditorPainel.map((l) => (
                <tr key={l.nome} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td>{l.nome}</td>
                  <td><button type="button" onClick={() => abrirDoAuditor(l.nome, ativa.filtroRapido)} title={`Abrir as ${l.qtd} fatura(s) de ${l.nome}`} style={{ border: 0, background: 'none', font: 'inherit', cursor: 'pointer', textDecoration: 'underline', fontWeight: 700, color: ativa.cor }}>{l.qtd}</button></td>
                  <td>{dinheiro(l.valor)}</td><td>{Math.round(l.somaDias / l.qtd)}d</td><td>{l.maxDias}d</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left', color: '#475569' }}><th>Fatura</th><th>Transportadora</th><th>Prazo</th><th>Situação</th></tr></thead>
            <tbody>{listaAtiva.slice(0, 80).map((i) => {
              const sit = situacao(i);
              return (
                <tr key={i.id} onClick={() => abrirFaturas({ filtro: String(i.numero_fatura || '') })} title="Abrir esta fatura na tela de Faturas" style={{ borderTop: '1px solid #e2e8f0', cursor: 'pointer' }}>
                  <td>{i.numero_fatura}<div style={{ color: '#64748b', fontSize: 11 }}>{dinheiro(i.valor_fatura)}</div></td>
                  <td>{i.transportadora}</td>
                  <td style={{ color: i.dias < 0 ? '#9b1111' : undefined, fontWeight: 700 }}>{i.tipo === 'ANTECIPADA' ? `vence em ${i.dias}d` : i.dias < 0 ? `há ${-i.dias}d` : i.dias === 0 ? 'hoje' : `em ${i.dias}d`}</td>
                  <td style={{ color: sit.cor }}>{sit.texto}</td>
                </tr>
              );
            })}</tbody>
          </table>
          {listaAtiva.length > 80 && <div style={{ color: '#64748b', marginTop: 4 }}>+ {listaAtiva.length - 80} fatura(s) na tela de Faturas.</div>}
          <button type="button" onClick={() => abrirFaturas({ filtroRapido: ativa.filtroRapido })} style={{ marginTop: 10, cursor: 'pointer', border: 'none', background: '#071d49', color: '#fff', borderRadius: 8, padding: '8px 14px', fontWeight: 700 }}>Ver todas em Faturas</button>
        </div>
      )}
      {minimizavel && (
        <button type="button" onClick={() => { setExpandido((v) => !v); setAberto(null); }} title={expandido ? 'Recolher avisos de prazo' : 'Mostrar avisos de prazo'} style={{ position: 'fixed', right: 16, bottom: 104, zIndex: 9998, borderRadius: 999, padding: '6px 12px', cursor: 'pointer', border: '1px solid #071d49', background: '#fff', color: '#071d49', fontWeight: 700 }}>
          {expandido ? '✕ Faturas' : `⏰ Faturas (${total})`}
        </button>
      )}
      {!recolhido && configs.map((c) => (
        <button
          key={c.chave}
          type="button"
          onClick={() => setAberto((atual) => (atual === c.chave ? null : c.chave))}
          title={c.titulo}
          style={{ position: 'fixed', right: 16, bottom: c.bottom + base, zIndex: 9998, borderRadius: 999, padding: '8px 14px', cursor: 'pointer', border: 'none', background: c.cor, color: '#fff', fontWeight: 700 }}
        >
          {c.botao}
        </button>
      ))}
    </>
  );
}
