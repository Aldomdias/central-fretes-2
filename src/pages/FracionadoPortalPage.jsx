import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { buscarCnpjRaizesPorNome } from '../services/lotacaoCotacaoService';
import { CDS_B2C } from '../utils/tabelaPadraoB2c';
import {
  baixarAnexoFracionado, carregarAnexosFracionado, cancelarConviteFracionado, carregarAtendimentoFracionado, carregarRespostasFracionado, excluirConviteFracionado, gerarConviteFracionado,
  gerarVolumetriaPronta, linkConviteFracionado, listarConvitesFracionado, listarOrigensCadastradas, listarEnviosFracionado, reabrirConviteFracionado, renovarConviteFracionado, statusVolumetriaConvite,
} from '../services/fracionadoCotacaoService';
import {
  CANAIS_FRACIONADO, FAIXAS_PADRAO_FRACIONADO, MODALIDADES_FRACIONADO, REGIOES_FRACIONADO, UFS_FRACIONADO,
  baixarExcelFracionado, canaisDoConviteFracionado, faixasDoConviteFracionado, origensDoConviteFracionado, parseFaixasFracionado,
} from '../utils/fracionadoModelo';

// Origem/CD: aceita minúsculo, maiúsculo, com ou sem acento; grava MAIÚSCULO sem acento (ex.: "itajaí / sc" -> "ITAJAI/SC").
const padronizarOrigem = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
const dataBr = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : '-');
const dataHoraBr = (v) => (v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const fmtCnpj = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') || '-';
const num = (v, d = 2) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: 4 }));

const STATUS_COR = { PENDENTE: '#6B7280', EM_PREENCHIMENTO: '#D97706', ENVIADO: '#1D9E75', CANCELADO: '#B91C1C', EXPIRADO: '#7C3AED' };
const STATUS_TXT = { PENDENTE: 'Não acessou', EM_PREENCHIMENTO: 'Preenchendo', ENVIADO: 'Enviado', CANCELADO: 'Cancelado', EXPIRADO: 'Expirado' };

const card = { background: '#fff', border: '1px solid #dbe3ef', borderRadius: 14, padding: 20, marginBottom: 18 };
const h2 = { margin: '0 0 4px', fontSize: 18, color: '#06183d' };
const btn = { background: '#185FA5', color: '#fff', border: 0, borderRadius: 8, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' };
const btnSec = { ...btn, background: '#fff', color: '#185FA5', border: '1px solid #185FA5', padding: '5px 9px', fontSize: 12 };
const inp = { padding: '9px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 };
const th = { padding: '8px 6px', background: '#1E3A5F', color: '#fff', fontSize: 12, textAlign: 'center', position: 'sticky', top: 0, whiteSpace: 'nowrap' };
const td = { padding: '6px', borderTop: '1px solid #e5e7eb', fontSize: 12 };
const lbl = { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, fontWeight: 700, color: '#334155' };

const statusEfetivo = (cv) => (cv.status !== 'CANCELADO' && cv.status !== 'ENVIADO' && cv.expira_em && new Date(cv.expira_em).getTime() < Date.now() ? 'EXPIRADO' : cv.status);

// Volumetria pronta do convite: gerada aqui uma vez (lendo a base de CT-es dia a dia) e gravada;
// o transportador so baixa o arquivo pronto no portal. auto = gera sozinho o que faltar (logo apos criar o link).
function VolumetriaConvite({ convite, auto = false }) {
  const [itens, setItens] = useState(null);
  const [rodando, setRodando] = useState('');
  const [prog, setProg] = useState('');
  const [erro, setErro] = useState('');
  const carregar = useCallback(async () => {
    try { setItens(await statusVolumetriaConvite(convite)); setErro(''); } catch (e) { setErro(e.message); setItens([]); }
  }, [convite]);
  const gerar = useCallback(async (lista) => {
    for (const a of lista) {
      const rotulo = `${CANAIS_FRACIONADO[a.canal]}${a.origem ? ` / ${a.origem}` : ''}`;
      setRodando(rotulo);
      setProg('');
      try {
        const r = await gerarVolumetriaPronta(a, { onProgresso: ({ feitos, total, lidas }) => setProg(`${feitos} de ${total} dias · ${lidas.toLocaleString('pt-BR')} CT-es lidos`) });
        setProg(`${rotulo}: ${r.notas.toLocaleString('pt-BR')} notas em ${r.linhas.toLocaleString('pt-BR')} linhas.`);
      } catch (e) { setErro(`${rotulo}: ${e.message}`); break; }
    }
    setRodando('');
    await carregar();
  }, [carregar]);
  useEffect(() => {
    let vivo = true;
    statusVolumetriaConvite(convite).then((l) => {
      if (!vivo) return;
      setItens(l);
      if (auto) { const falta = l.filter((x) => !x.atual); if (falta.length) gerar(falta); }
    }).catch((e) => { if (vivo) { setErro(e.message); setItens([]); } });
    return () => { vivo = false; };
  }, [convite, auto, gerar]);
  if (convite.modalidade === 'PROPRIA') return null;
  return (
    <div style={{ margin: '10px 0', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#f8fafc' }}>
      <b style={{ color: '#06183d' }}>📊 Volumetria para o transportador</b>{' '}
      <small style={{ color: '#64748b' }}>Gerada aqui uma vez e gravada pronta; no portal ele só baixa (rápido). Atualize quando virar o mês.</small>
      {itens === null ? <div><small>Carregando…</small></div> : (
        <table style={{ borderCollapse: 'collapse', marginTop: 6 }}>
          <tbody>
            {itens.map((a) => (
              <tr key={a.base}>
                <td style={td}>{CANAIS_FRACIONADO[a.canal]}{a.origem ? ` / ${a.origem}` : ''}</td>
                <td style={td}>{dataBr(a.periodo.inicio + 'T12:00')} a {dataBr(a.periodo.fim + 'T12:00')}</td>
                <td style={td}>{a.atual
                  ? <span style={{ color: '#166534', fontWeight: 700 }}>✓ Pronta · {Number(a.pronta.notas || 0).toLocaleString('pt-BR')} notas · gerada {dataHoraBr(a.pronta.gerado_em)}</span>
                  : a.pronta ? <span style={{ color: '#b45309', fontWeight: 700 }}>Desatualizada (período {dataBr(a.pronta.periodo_inicio + 'T12:00')} a {dataBr(a.pronta.periodo_fim + 'T12:00')}) — o portal entrega esta até atualizar</span>
                    : <span style={{ color: '#b91c1c', fontWeight: 700 }}>Não gerada — o transportador ainda não consegue baixar</span>}</td>
                <td style={td}><button style={btnSec} disabled={!!rodando} onClick={() => gerar([a])}>{a.pronta ? 'Atualizar' : 'Gerar'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rodando ? <div style={{ marginTop: 6, fontSize: 13, color: '#185FA5', fontWeight: 700 }}>Gerando {rodando}… {prog} (pode levar alguns minutos; não feche esta tela)</div> : prog ? <div style={{ marginTop: 6, fontSize: 13, color: '#166534' }}>{prog}</div> : null}
      {erro ? <div style={{ marginTop: 6, fontSize: 13, color: '#b91c1c', fontWeight: 700 }}>{erro}</div> : null}
    </div>
  );
}

// Campo de origens: só aceita origens das tabelas cadastradas (B2C + Atacado). Digita um pedaço do nome
// (com ou sem acento, maiúsculo ou minúsculo) e escolhe na lista; pode marcar várias. Cada origem vira uma tabela no portal.
function OrigensSelect({ valor, onChange, opcoes, canal }) {
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState(false);
  const n = padronizarOrigem(busca);
  const lista = (opcoes || []).filter((o) => (canal === 'AMBOS' || !o.canais.length || o.canais.includes(canal)) && !valor.includes(o.valor) && (!n || o.valor.includes(n))).slice(0, 60);
  const add = (v) => { onChange([...valor, v]); setBusca(''); };
  return (
    <div style={{ position: 'relative', marginTop: 4 }}>
      <div style={{ ...inp, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', minHeight: 40, cursor: 'text' }} onClick={() => setAberta(true)}>
        {valor.map((v) => (
          <span key={v} style={{ background: '#dbeafe', color: '#1e3a8a', borderRadius: 99, padding: '3px 4px 3px 10px', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {v}
            <button type="button" title="Remover" onClick={(e) => { e.stopPropagation(); onChange(valor.filter((x) => x !== v)); }} style={{ border: 0, background: 'transparent', color: '#1e3a8a', cursor: 'pointer', fontWeight: 900, fontSize: 13 }}>×</button>
          </span>
        ))}
        <input
          value={busca}
          onChange={(e) => { setBusca(e.target.value); setAberta(true); }}
          onFocus={() => setAberta(true)}
          onBlur={() => setTimeout(() => setAberta(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (lista[0]) add(lista[0].valor); }
            else if (e.key === 'Backspace' && !busca && valor.length) onChange(valor.slice(0, -1));
          }}
          placeholder={opcoes ? (valor.length ? 'Adicionar outra origem…' : 'Digite parte do nome da cidade (ex.: itaj)') : 'Carregando origens…'}
          style={{ border: 0, outline: 0, flex: 1, minWidth: 180, fontSize: 14, padding: 2, background: 'transparent' }}
        />
      </div>
      {aberta && opcoes && (
        <div style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', maxHeight: 260, overflow: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, boxShadow: '0 8px 20px rgba(0,0,0,.12)' }}>
          {lista.length ? lista.map((o) => (
            <div
              key={o.valor}
              onMouseDown={(e) => { e.preventDefault(); add(o.valor); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#eff6ff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
              style={{ padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 8 }}
            >
              <b>{o.valor}</b><span style={{ color: '#64748b', fontWeight: 400 }}>{o.canais.join(' + ') || '-'} · {o.transportadoras} transp.</span>
            </div>
          )) : <div style={{ padding: 10, fontSize: 13, color: '#64748b', fontWeight: 400 }}>Nenhuma origem cadastrada com “{busca}”{canal !== 'AMBOS' ? ` no canal ${CANAIS_FRACIONADO[canal]}` : ''}.</div>}
        </div>
      )}
    </div>
  );
}

function Kpi({ titulo, valor, cor, ativo, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer', border: `2px solid ${ativo ? '#185FA5' : '#dbe3ef'}`, borderRadius: 12, padding: '10px 14px', background: ativo ? '#eff6ff' : '#f8fafc' }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{titulo}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: cor || '#06183d' }}>{valor}</div>
    </button>
  );
}

// Questionário + termo aceito no portal (dados_gerais.QUESTIONARIO). "Não" aparece em vermelho com a explicação.
const PERGUNTAS_RESUMO = [
  ['edi', 'EDI (OCOREN/CONEMB/DOCCOB) ajustado'],
  ['cubagem', 'Ciente: só a cubagem da NF vale'],
  ['recusa', 'Ciente: sem recusa por evento'],
  ['divergencia', 'Ciente: divergência via negociação/desconto na fatura'],
  ['whats', 'Possui WhatsApp'],
  ['devolucao', 'Trabalha com devolução / coleta reversa (NFD)'],
];
function QuestionarioResumo({ convite }) {
  const q = convite.dados_gerais?.QUESTIONARIO;
  const c = convite.dados_gerais?.CADASTRO || {};
  if (!q?.aceite_em) return <div style={{ fontSize: 13, color: '#b91c1c', fontWeight: 700, margin: '8px 0' }}>📝 Questionário e termo: ainda não aceitos pela transportadora.</div>;
  const contato = (p) => [c[`${p}_nome`], c[`${p}_tel`], c[`${p}_whats`] && `WhatsApp ${c[`${p}_whats`]}`, c[`${p}_email`]].filter(Boolean).join(' · ') || '-';
  return (
    <div style={{ border: '1px solid #cbd5e1', background: '#f8fafc', borderRadius: 10, padding: 12, margin: '10px 0', fontSize: 13 }}>
      <b style={{ color: '#06183d' }}>📝 Questionário e termo</b> — aceito em {dataHoraBr(q.aceite_em)} por <b>{q.aceite_nome}</b> (termo {q.versao_termo}{q.aceite_ip ? ` · IP ${q.aceite_ip}` : ''})
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2px 16px', marginTop: 6 }}>
        {PERGUNTAS_RESUMO.map(([k, rot]) => {
          const r = q.respostas?.[k];
          const obs = k === 'devolucao' ? q.devolucao_obs : q.obs?.[k];
          const ruim = r === 'NAO' && k !== 'whats' && k !== 'devolucao';
          return (
            <div key={k} style={{ color: ruim ? '#b91c1c' : '#334155', fontWeight: ruim ? 700 : 400 }}>
              {r === 'SIM' ? '✅' : '❌'} {rot}: <b>{r === 'SIM' ? 'Sim' : r === 'NAO' ? 'Não' : '-'}</b>{obs ? ` — ${obs}` : ''}
            </div>
          );
        })}
        <div>🗓 Faturamento: <b>{q.faturamento ? q.faturamento.toLowerCase() : '-'}</b></div>
      </div>
      <div style={{ marginTop: 6 }}><b>EDI:</b> {contato('edi')} · <b>Banco:</b> {[c.bco_banco, c.bco_agencia && `ag ${c.bco_agencia}`, c.bco_conta && `cc ${c.bco_conta}`, c.bco_tipo, c.bco_pix && `PIX ${c.bco_pix}`].filter(Boolean).join(' · ') || '-'}{c.fin_obs ? ` · Regulação financeira: ${c.fin_obs}` : ''}</div>
    </div>
  );
}

// Pré-cadastro informado pela transportadora no portal (dados_gerais.CADASTRO).
function CadastroResumo({ convite }) {
  const c = convite.dados_gerais?.CADASTRO;
  if (!c || !Object.keys(c).length) return <div style={{ fontSize: 13, color: '#64748b', margin: '8px 0' }}>🪪 Dados cadastrais: ainda não preenchidos pela transportadora.</div>;
  const contato = (p) => [c[`${p}_nome`], c[`${p}_tel`] && `tel ${c[`${p}_tel`]}`, c[`${p}_whats`] && `WhatsApp ${c[`${p}_whats`]}`, c[`${p}_email`]].filter(Boolean).join(' · ') || '-';
  return (
    <div style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 10, padding: 12, margin: '10px 0', fontSize: 13 }}>
      <b style={{ color: '#166534' }}>🪪 Dados cadastrais (pré-cadastro)</b>
      <div style={{ marginTop: 4 }}><b>{c.razao || '-'}</b>{c.fantasia ? ` (${c.fantasia})` : ''} · IE {c.ie || '-'} · {c.endereco || 'endereço não informado'}</div>
      <div><b>CNPJ emissor por origem:</b> {Object.entries(c.cnpj_origem || {}).map(([o, v]) => `${o || 'geral'}: ${fmtCnpj(v)}`).join(' · ') || '-'}</div>
      <div><b>Comercial:</b> {contato('com')}</div>
      <div><b>Operacional:</b> {contato('op')}</div>
      <div><b>Financeiro:</b> {contato('fin')}</div>
    </div>
  );
}

function PreviaPropria({ convite, anexos }) {
  const canais = canaisDoConviteFracionado(convite);
  return (
    <div style={{ marginTop: 12 }}>
      {canais.map((c) => {
        const g = convite.dados_gerais?.[c] || {};
        const arqs = anexos.filter((a) => a.canal === c);
        return (
          <div key={c} style={{ border: '1px solid #dbe3ef', borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <b>{CANAIS_FRACIONADO[c]}</b>
            <div style={{ fontSize: 13, margin: '6px 0' }}>
              Faturamento {g.faturamento ? g.faturamento.toLowerCase() : '-'} · Prazo pgto {g.prazo ?? '-'} d · ICMS incluso: <b>{g.icms_incluso === 'SIM' ? 'Sim' : g.icms_incluso === 'NAO' ? 'Não (por fora)' : 'não informado'}</b> · Vigência {g.vigencia ? dataBr(g.vigencia) : '-'}
              {(g.taxas || []).map((t) => ` · ${t.n} ${num(t.v)}${t.u === '%' ? '%' : t.u === 'R$/KG' ? ' R$/kg' : ''}`).join('')}
            </div>
            <div style={{ fontSize: 13, margin: '6px 0' }}>
              {['TABELA', 'DESTINOS', 'GENERALIDADES'].map((cat) => {
                const doTipo = arqs.filter((a) => (a.categoria || 'TABELA') === cat);
                return (
                  <div key={cat} style={{ margin: '4px 0' }}>
                    <b>{cat === 'TABELA' ? 'Tabela de frete' : cat === 'DESTINOS' ? 'Destinos atendidos' : 'Generalidades (arquivo)'}:</b>{' '}
                    {doTipo.length ? doTipo.map((a) => (
                      <button key={a.id} style={{ ...btnSec, marginRight: 6 }} onClick={() => baixarAnexoFracionado(a.id).catch(() => {})}>
                        ⬇ {String(a.nome).replace(/^\[(DESTINOS|GENERALIDADES)\] /, '')}{a.leitura?.linhas ? ` (~${a.leitura.linhas} linhas)` : ''}
                      </button>
                    )) : <small style={{ color: cat === 'GENERALIDADES' ? '#64748b' : '#b91c1c', fontWeight: 700 }}>{cat === 'GENERALIDADES' ? 'nenhum (opcional)' : 'não anexado'}</small>}
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Observações / generalidades digitadas (a avaliar se entram no escopo):</div>
            <div style={{ whiteSpace: 'pre-wrap', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: 10, fontSize: 13, marginTop: 4 }}>{g.generalidades || 'Não informadas.'}</div>
          </div>
        );
      })}
    </div>
  );
}

function PreviaResposta({ convite, respostas, atendimento, anexos = [] }) {
  if (convite.modalidade === 'PROPRIA') return <PreviaPropria convite={convite} anexos={anexos} />;
  const canais = canaisDoConviteFracionado(convite);
  const origens = origensDoConviteFracionado(convite);
  const [canal, setCanal] = useState(canais[0]);
  const [origem, setOrigem] = useState(origens[0]);
  const pct = convite.modalidade !== 'FAIXA_PESO';
  const doCanal = respostas.filter((r) => r.canal === canal && (r.origem || '') === origem);
  const cidades = atendimento.filter((a) => a.canal === canal && (a.origem || '') === origem);
  const cidadesOk = cidades.filter((a) => a.regiao && a.prazo_dias);
  const prazoMedio = cidadesOk.length ? cidadesOk.reduce((t, a) => t + Number(a.prazo_dias), 0) / cidadesOk.length : null;
  const g = convite.dados_gerais?.[canal] || {};
  const ufs = new Set(doCanal.map((r) => r.uf_destino));
  const faixas = faixasDoConviteFracionado(convite, canal);
  const [uf, setUf] = useState('');
  const ufAtiva = uf && ufs.has(uf) ? uf : UFS_FRACIONADO.find((u) => ufs.has(u)) || '';
  const mapa = new Map(doCanal.map((r) => [`${r.uf_destino}|${r.regiao}|${r.faixa || ''}`, r]));
  const regioesUsadas = REGIOES_FRACIONADO.filter((r) => doCanal.some((x) => x.regiao === r));

  return (
    <div style={{ marginTop: 12 }}>
      {canais.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {canais.map((c) => <button key={c} style={{ ...btnSec, background: c === canal ? '#185FA5' : '#fff', color: c === canal ? '#fff' : '#185FA5' }} onClick={() => setCanal(c)}>{CANAIS_FRACIONADO[c]}</button>)}
        </div>
      )}
      {origens.length > 1 && (
        <label style={{ ...lbl, width: 260, marginBottom: 8 }}>Origem
          <select style={inp} value={origem} onChange={(e) => setOrigem(e.target.value)}>{origens.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        </label>
      )}
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        <b>{cidadesOk.length}</b> cidades atendidas (com região e prazo) em <b>{new Set(cidadesOk.map((a) => a.uf)).size}</b> UFs{prazoMedio ? <> · prazo médio <b>{prazoMedio.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</b> dias</> : null}
      </div>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        <b>{doCanal.length}</b> células · <b>{ufs.size}</b> de {UFS_FRACIONADO.length} UFs ·
        {' '}Faturamento {g.faturamento ? g.faturamento.toLowerCase() : '-'} · Prazo pgto {g.prazo ?? '-'} d · GRIS {num(g.gris) || '-'}% (mín. R$ {num(g.gris_min) || '-'}) · Ad valorem {num(g.advalorem) || '-'}% (mín. R$ {num(g.advalorem_min) || '-'}) · Pedágio {num(g.pedagio) || '-'}/100 kg · TAS {num(g.tas) || '-'} · CTRC {num(g.ctrc) || '-'} · Cubagem {g.cubagem ?? '-'} kg/m³ · Emergencial {num(g.emergencial) || '-'}% · Mín. geral R$ {num(g.frete_min) || '-'}{g.composicao ? ` · Composição ${g.composicao === 'PESO_MAIS_PERCENTUAL' ? 'peso + %' : 'maior valor'}` : ''}{(g.taxas || []).map((t) => ` · ${t.n} ${num(t.v)}${t.u === '%' ? '%' : t.u === 'R$/KG' ? ' R$/kg' : t.u === 'R$/FRACAO' ? ` R$/${t.fr || '?'} kg` : ''}${t.min ? ` mín. ${num(t.min)}` : ''}${t.u === 'R$/KG' && t.fr ? ` franquia ${t.fr} kg` : ''}${t.ufs ? ` (${t.ufs})` : ''}`).join('')} ·{g.observacoes ? <> Obs.: {g.observacoes} ·</> : null}
        {' '}ICMS incluso: <b>{g.icms_incluso === 'SIM' ? 'Sim' : g.icms_incluso === 'NAO' ? 'Não (por fora)' : 'não informado'}</b> · Vigência {g.vigencia ? dataBr(g.vigencia) : '-'}
      </div>
      {!doCanal.length ? <small>Nenhum valor salvo neste canal ainda.</small> : pct ? (
        <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={th}>UF</th>{regioesUsadas.map((r) => <th key={r} style={th}>{r}<br /><small>% / mín. R$ / kg garantia</small></th>)}</tr></thead>
            <tbody>
              {UFS_FRACIONADO.filter((u) => ufs.has(u)).map((u) => (
                <tr key={u}><td style={{ ...td, fontWeight: 700 }}>{u}</td>
                  {regioesUsadas.map((r) => { const x = mapa.get(`${u}|${r}|`); return <td key={r} style={{ ...td, textAlign: 'right' }}>{x ? `${num(x.frete_percentual) || '-'} / ${num(x.frete_minimo) || '-'}${x.frete_kg != null ? ` / ${num(x.frete_kg)}` : ''}` : ''}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <label style={{ ...lbl, width: 200, marginBottom: 6 }}>UF destino
            <select style={inp} value={ufAtiva} onChange={(e) => setUf(e.target.value)}>
              {UFS_FRACIONADO.filter((u) => ufs.has(u)).map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={th}>Faixa</th>{regioesUsadas.map((r) => <th key={r} style={th}>{r}</th>)}</tr></thead>
              <tbody>
                {faixas.map((f) => (
                  <tr key={f.label}><td style={{ ...td, fontWeight: 700 }}>{f.max == null ? `${f.label} (R$/kg)` : f.label}</td>
                    {regioesUsadas.map((r) => <td key={r} style={{ ...td, textAlign: 'right' }}>{num(mapa.get(`${ufAtiva}|${r}|${f.label}`)?.frete_valor)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function FracionadoPortalPage() {
  const [convites, setConvites] = useState([]);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [ocupado, setOcupado] = useState(false);
  const [filtro, setFiltro] = useState('TODOS');
  const [nomesTransp, setNomesTransp] = useState([]);

  const [transportadora, setTransportadora] = useState('');
  const [campanha, setCampanha] = useState('');
  const [origensSel, setOrigensSel] = useState([]);
  const [opcoesOrigem, setOpcoesOrigem] = useState(null);
  const [canal, setCanal] = useState('AMBOS');
  const [modalidade, setModalidade] = useState('PERCENTUAL');
  const [faixasTxt, setFaixasTxt] = useState({ ...FAIXAS_PADRAO_FRACIONADO });
  const [dias, setDias] = useState(5);
  const [ultimo, setUltimo] = useState(null);

  const [aberto, setAberto] = useState(null);
  const [detalhe, setDetalhe] = useState({ respostas: [], atendimento: [], envios: [], anexos: [] });

  const aviso = (texto, tipo = 'ok') => setMsg({ tipo, texto });

  const recarregar = useCallback(async () => {
    try { setConvites(await listarConvitesFracionado()); } catch (e) { aviso(e.message, 'erro'); }
  }, []);
  useEffect(() => { recarregar(); }, [recarregar]);
  useEffect(() => {
    listarOrigensCadastradas().then(setOpcoesOrigem)
      .catch((e) => { setOpcoesOrigem([]); setMsg({ tipo: 'erro', texto: `Não consegui carregar as origens cadastradas: ${e.message}` }); });
  }, []);
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    getSupabaseClient().from('transportadoras').select('nome').order('nome').limit(2000)
      .then(({ data }) => setNomesTransp(Array.from(new Set((data || []).map((t) => t.nome).filter(Boolean))))).catch(() => {});
  }, []);

  const contagem = useMemo(() => {
    const c = { TODOS: convites.length, PENDENTE: 0, EM_PREENCHIMENTO: 0, ENVIADO: 0, EXPIRADO: 0, CANCELADO: 0 };
    convites.forEach((cv) => { c[statusEfetivo(cv)] += 1; });
    return c;
  }, [convites]);
  const lista = useMemo(() => convites.filter((cv) => filtro === 'TODOS' || statusEfetivo(cv) === filtro), [convites, filtro]);

  const faixasValidas = useMemo(() => (canal === 'AMBOS' ? ['B2C', 'ATACADO'] : [canal]).every((c) => parseFaixasFracionado(faixasTxt[c]).length > 0), [canal, faixasTxt]);

  const gerar = async () => {
    if (!transportadora.trim()) { aviso('Informe a transportadora.', 'erro'); return; }
    if (modalidade === 'FAIXA_PESO' && !faixasValidas) { aviso('Faixas de peso inválidas. Use o formato 0-2, 2-5, 100+ (a última com + é o excedente por kg).', 'erro'); return; }
    setOcupado(true);
    try {
      const cnpjRaizes = await buscarCnpjRaizesPorNome(transportadora.trim());
      const cv = await gerarConviteFracionado({
        transportadora: transportadora.trim(), campanha: campanha.trim(), origens: origensSel, canal, modalidade, faixas: faixasTxt, dias, cnpjRaizes,
      });
      setUltimo(cv);
      setTransportadora('');
      await recarregar();
      aviso(`Link gerado para ${cv.transportadora}, válido por ${dias} dias.${cnpjRaizes.length ? ` O CNPJ será conferido com o cadastro (${cnpjRaizes.length} raiz/raízes).` : ' Transportadora sem CNPJ no cadastro: o portal aceita qualquer CNPJ válido e registra o informado.'}`);
    } catch (e) { aviso(e.message, 'erro'); } finally { setOcupado(false); }
  };

  const copiar = (cv) => navigator.clipboard?.writeText(linkConviteFracionado(cv.token)).then(() => aviso('Link copiado.'));
  const email = (cv) => {
    const canalTxt = CANAIS_FRACIONADO[cv.canal] || cv.canal;
    const modTxt = MODALIDADES_FRACIONADO[cv.modalidade] || cv.modalidade;
    const assunto = encodeURIComponent(`Tabela de frete fracionado — ${canalTxt}${cv.campanha ? ` — ${cv.campanha}` : ''}`);
    const ate = cv.expira_em ? `\nO link vale até ${dataBr(cv.expira_em)}.` : '';
    const corpo = encodeURIComponent(`Olá, ${cv.transportadora}!\n\nSegue o link para preenchimento da nossa tabela de frete fracionado (${canalTxt} · ${modTxt}):\n${linkConviteFracionado(cv.token)}\n\n${cv.modalidade === 'PROPRIA' ? 'Anexe a sua tabela e descreva as generalidades no portal (elas serão avaliadas pela nossa equipe para ver se entram no escopo).' : 'Você pode preencher direto no portal ou baixar o modelo em Excel, preencher e importar de volta.'} No primeiro acesso informe o CNPJ da transportadora (obrigatório).${ate}\n\nObrigado!`);
    window.location.href = `mailto:?subject=${assunto}&body=${corpo}`;
  };

  const executar = async (fn, ok) => {
    setOcupado(true);
    try { await fn(); await recarregar(); aviso(ok); } catch (e) { aviso(e.message, 'erro'); } finally { setOcupado(false); }
  };

  const abrir = async (cv) => {
    if (aberto?.id === cv.id) { setAberto(null); return; }
    setOcupado(true);
    try {
      const [respostas, atendimento, envios, anexos] = await Promise.all([carregarRespostasFracionado(cv.id), carregarAtendimentoFracionado(cv.id), listarEnviosFracionado(cv.id), carregarAnexosFracionado(cv.id)]);
      setDetalhe({ respostas, atendimento, envios, anexos });
      setAberto(cv);
    } catch (e) { aviso(e.message, 'erro'); } finally { setOcupado(false); }
  };

  const exportar = async (cv, canalExp, origemExp) => {
    try {
      const usa = aberto?.id === cv.id;
      const respostas = usa ? detalhe.respostas : await carregarRespostasFracionado(cv.id);
      const atendimento = usa ? detalhe.atendimento : await carregarAtendimentoFracionado(cv.id);
      await baixarExcelFracionado({ convite: cv, canal: canalExp, origem: origemExp, respostas, atendimento });
    } catch (e) { aviso(`Erro ao exportar: ${e.message}`, 'erro'); }
  };

  return (
    <div style={{ padding: 20, maxWidth: 1500, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 24, color: '#06183d' }}>Portal de tabelas — frete fracionado</h1>
      <p style={{ margin: '0 0 16px', color: '#475569' }}>
        Gere um link com validade para a transportadora preencher (ou importar em Excel) a tabela no nosso modelo padrão. Você escolhe o canal e a modalidade de cada envio e acompanha o recebimento abaixo.
      </p>
      {msg.texto ? <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, background: msg.tipo === 'erro' ? '#fee2e2' : '#dcfce7', color: msg.tipo === 'erro' ? '#991b1b' : '#166534' }}>{msg.texto}</div> : null}

      <div style={card}>
        <h2 style={h2}>Gerar link para a transportadora</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginTop: 10 }}>
          <label style={lbl}>Transportadora
            <input style={inp} list="frac-transp" value={transportadora} onChange={(e) => setTransportadora(e.target.value)} placeholder="Nome da transportadora" />
            <datalist id="frac-transp">{nomesTransp.map((n) => <option key={n} value={n} />)}</datalist>
          </label>
          <label style={lbl}>Canal
            <select style={inp} value={canal} onChange={(e) => setCanal(e.target.value)}>
              {Object.entries(CANAIS_FRACIONADO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label style={lbl}>Modalidade da tabela
            <select style={inp} value={modalidade} onChange={(e) => setModalidade(e.target.value)}>
              {Object.entries(MODALIDADES_FRACIONADO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <div style={{ ...lbl, gridColumn: 'span 2' }}>Origens / CDs (opcional — escolha na lista; pode marcar várias)
            <OrigensSelect valor={origensSel} onChange={setOrigensSel} opcoes={opcoesOrigem} canal={canal} />
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
              <button type="button" style={btnSec} onClick={() => setOrigensSel(Array.from(new Set([...origensSel, ...CDS_B2C.map((cd) => (opcoesOrigem || []).find((o) => o.uf === cd.uf && cd.cidades.map(padronizarOrigem).includes(o.cidade))?.valor || padronizarOrigem(`${cd.cidades[0]}/${cd.uf}`))])))}>Usar todos os CDs B2C</button>
              {origensSel.length ? <button type="button" style={btnSec} onClick={() => setOrigensSel([])}>Limpar</button> : null}
              <small style={{ fontWeight: 400, color: '#64748b' }}>Só origens das tabelas cadastradas (B2C e Atacado). Cada origem vira uma tabela no portal. Vazio = tabela única.</small>
            </span>
          </div>
          <label style={lbl}>Campanha / rótulo (opcional)
            <input style={inp} value={campanha} onChange={(e) => setCampanha(e.target.value)} placeholder="ex.: Reajuste 2027" />
          </label>
          <label style={lbl}>Validade do link (dias)
            <input style={inp} type="number" min={1} max={60} value={dias} onChange={(e) => setDias(e.target.value)} />
          </label>
        </div>
        {modalidade === 'PROPRIA' && (
          <div style={{ marginTop: 12, padding: 10, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 13 }}>
            Neste modo o transportador anexa a tabela dele e escreve as generalidades. O portal avisa que as generalidades serão avaliadas pela Suprimentos para ver se entram no escopo.
          </div>
        )}
        {modalidade === 'FAIXA_PESO' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 12 }}>
            {(canal === 'AMBOS' ? ['B2C', 'ATACADO'] : [canal]).map((c) => (
              <label key={c} style={lbl}>Faixas de peso (kg) — {CANAIS_FRACIONADO[c]}
                <input style={{ ...inp, borderColor: parseFaixasFracionado(faixasTxt[c]).length ? '#cbd5e1' : '#dc2626' }} value={faixasTxt[c]} onChange={(e) => setFaixasTxt({ ...faixasTxt, [c]: e.target.value })} />
                <small style={{ fontWeight: 400, color: '#64748b' }}>Separe por vírgula. A última com “+” (ex.: 100+) é a faixa aberta: o transportador informa o R$/kg excedente.</small>
              </label>
            ))}
          </div>
        )}
        <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={btn} disabled={ocupado} onClick={gerar}>Gerar link</button>
          {ultimo && (
            <>
              <input readOnly style={{ ...inp, flex: 1, minWidth: 320 }} value={linkConviteFracionado(ultimo.token)} onFocus={(e) => e.target.select()} />
              <button style={btnSec} onClick={() => copiar(ultimo)}>Copiar</button>
              <button style={btnSec} onClick={() => email(ultimo)}>E-mail</button>
            </>
          )}
        </div>
        {ultimo && <VolumetriaConvite key={ultimo.id} convite={ultimo} auto />}
      </div>

      <div style={card}>
        <h2 style={h2}>Controle de recebimento</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, margin: '10px 0 14px' }}>
          {['TODOS', 'PENDENTE', 'EM_PREENCHIMENTO', 'ENVIADO', 'EXPIRADO', 'CANCELADO'].map((k) => (
            <Kpi key={k} titulo={k === 'TODOS' ? 'Todos os links' : STATUS_TXT[k]} valor={contagem[k]} cor={STATUS_COR[k]} ativo={filtro === k} onClick={() => setFiltro(k)} />
          ))}
        </div>
        <div style={{ overflow: 'auto', maxHeight: 560 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Transportadora', 'Canal', 'Modalidade', 'Origem', 'Campanha', 'Status', 'Validade', 'Último acesso', 'Enviado em', 'Envios', 'Respondente', 'Ações'].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {lista.map((cv) => {
                const st = statusEfetivo(cv);
                return (
                  <tr key={cv.id} style={{ background: aberto?.id === cv.id ? '#eff6ff' : undefined }}>
                    <td style={{ ...td, fontWeight: 700 }}>{cv.transportadora}</td>
                    <td style={td}>{CANAIS_FRACIONADO[cv.canal] || cv.canal}</td>
                    <td style={td}>{MODALIDADES_FRACIONADO[cv.modalidade] || cv.modalidade}</td>
                    <td style={td}>{origensDoConviteFracionado(cv).filter(Boolean).join(', ') || '-'}</td>
                    <td style={td}>{cv.campanha || '-'}</td>
                    <td style={td}><span style={{ background: STATUS_COR[st], color: '#fff', borderRadius: 99, padding: '2px 9px', fontSize: 11, fontWeight: 700 }}>{STATUS_TXT[st]}</span></td>
                    <td style={td}>{dataBr(cv.expira_em)}</td>
                    <td style={td}>{dataHoraBr(cv.ultimo_acesso_em)}</td>
                    <td style={td}>{dataHoraBr(cv.enviado_em)}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{cv.qtd_envios || 0}</td>
                    <td style={td}>{cv.respondente_nome ? <>{cv.respondente_nome}<br /><small>{cv.respondente_email} · {fmtCnpj(cv.respondente_cnpj)}</small></> : '-'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button style={btnSec} onClick={() => abrir(cv)}>{aberto?.id === cv.id ? 'Fechar' : 'Ver'}</button>{' '}
                      <button style={btnSec} onClick={() => copiar(cv)}>Link</button>{' '}
                      <button style={btnSec} onClick={() => email(cv)}>E-mail</button>{' '}
                      {st !== 'CANCELADO' && <button style={btnSec} disabled={ocupado} onClick={() => executar(() => renovarConviteFracionado(cv.id, 5), 'Validade renovada por mais 5 dias.')}>+5 dias</button>}{' '}
                      {st === 'CANCELADO'
                        ? <button style={btnSec} disabled={ocupado} onClick={() => executar(() => reabrirConviteFracionado(cv.id, !!cv.enviado_em), 'Link reativado.')}>Reativar</button>
                        : <button style={btnSec} disabled={ocupado} onClick={() => window.confirm(`Cancelar o link de ${cv.transportadora}? Ele deixa de aceitar acessos.`) && executar(() => cancelarConviteFracionado(cv.id), 'Link cancelado.')}>Cancelar</button>}{' '}
                      <button style={{ ...btnSec, color: '#b91c1c', borderColor: '#b91c1c' }} disabled={ocupado} onClick={() => window.confirm(`Excluir o link de ${cv.transportadora} e tudo o que ela preencheu? Não dá para desfazer.`) && executar(async () => { await excluirConviteFracionado(cv.id); if (aberto?.id === cv.id) setAberto(null); }, 'Link excluído.')}>Excluir</button>
                    </td>
                  </tr>
                );
              })}
              {!lista.length && <tr><td colSpan={12} style={{ ...td, textAlign: 'center', color: '#64748b', padding: 20 }}>Nenhum link {filtro === 'TODOS' ? 'gerado ainda' : 'neste status'}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {aberto && (
        <div style={card}>
          <h2 style={h2}>{aberto.transportadora} — {CANAIS_FRACIONADO[aberto.canal]} · {MODALIDADES_FRACIONADO[aberto.modalidade]}</h2>
          {aberto.modalidade !== 'PROPRIA' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
            {canaisDoConviteFracionado(aberto).flatMap((c) => origensDoConviteFracionado(aberto).map((o) => (
              <button key={`${c}|${o}`} style={btn} onClick={() => exportar(aberto, c, o)}>⬇ Excel padrão — {CANAIS_FRACIONADO[c]}{o ? ` / ${o}` : ''}</button>
            )))}
          </div>}
          <VolumetriaConvite key={`vol-${aberto.id}`} convite={aberto} />
          {aberto.modalidade !== 'PROPRIA' && <small style={{ color: '#64748b' }}>O Excel exportado segue o modelo padrão (FICHA DE CADASTRO + TABELA + ATENDIMENTO) e pode ser importado em Importar Template.</small>}
          <QuestionarioResumo convite={aberto} />
          <CadastroResumo convite={aberto} />
          <PreviaResposta key={aberto.id} convite={aberto} respostas={detalhe.respostas} atendimento={detalhe.atendimento} anexos={detalhe.anexos} />
          <h3 style={{ margin: '16px 0 4px', fontSize: 15, color: '#06183d' }}>Histórico de envios</h3>
          {detalhe.envios.length ? (
            <table style={{ borderCollapse: 'collapse' }}>
              <thead><tr>{['Data', 'Respondente', 'E-mail', 'CNPJ', 'Células', 'Origem'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{detalhe.envios.map((e) => (
                <tr key={e.id}><td style={td}>{dataHoraBr(e.enviado_em)}</td><td style={td}>{e.respondente_nome}</td><td style={td}>{e.respondente_email}</td><td style={td}>{fmtCnpj(e.respondente_cnpj)}</td><td style={{ ...td, textAlign: 'right' }}>{e.qtd_linhas}</td><td style={td}>{e.origem_envio}</td></tr>
              ))}</tbody>
            </table>
          ) : <small>Nenhum envio concluído ainda (só rascunho, se houver).</small>}
        </div>
      )}
    </div>
  );
}
