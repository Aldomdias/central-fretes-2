import React, { useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarBaseCompletaDb } from '../services/freteDatabaseService';
import { normalizarTransportadoras, processarCte } from '../services/auditoriaCteProcessamentoService';
import { filtrarCpComercialCte } from '../services/cteBasePolicy';

const ORIGENS_ALTERNATIVAS = [
  { label: 'Itajaí / SC', cidade: 'ITAJAI', uf: 'SC', ibge: '4208302' },
];

const PAGE_SIZE = 200;
const TOLERANCIA = 0.05;

function safeNum(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function fmt(v) { return safeNum(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function fmtN(v) { return safeNum(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function pct(v) { return `${safeNum(v).toFixed(1).replace('.', ',')}%`; }
function fmtData(v) { return v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-'; }

async function carregarCtes({ competencia, dataInicio, dataFim, canal, limite = 5000, onProgress }) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const supabase = getSupabaseClient();
  const acumulado = [];
  let from = 0;
  const PAGE = 1000;

  while (acumulado.length < limite) {
    let q = supabase.from('realizado_local_ctes').select('*').order('data_emissao', { ascending: false }).range(from, from + PAGE - 1);
    if (dataInicio || dataFim) {
      if (dataInicio) q = q.gte('data_emissao', dataInicio);
      if (dataFim) q = q.lte('data_emissao', dataFim);
    } else if (competencia) {
      q = q.eq('competencia', competencia);
    }
    if (canal) q = q.ilike('canal', `%${canal}%`);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao carregar CT-es: ${error.message}`);
    const lote = data || [];
    acumulado.push(...lote);
    onProgress?.({ carregados: acumulado.length });
    if (lote.length < PAGE) break;
    from += PAGE;
  }
  return filtrarCpComercialCte(acumulado).slice(0, limite);
}

function simularDeOrigem(cte, transportadoras, origemAlt) {
  // Cria um CTe "fantasma" com a origem trocada para o CD alternativo
  // e tenta calcular com cada transportadora para achar a mais barata
  const cteAlt = {
    ...cte,
    cidade_origem: origemAlt.cidade,
    uf_origem: origemAlt.uf,
    ibge_origem: origemAlt.ibge || '',
    ibge_corrigido_origem: origemAlt.ibge || '',
  };

  let melhor = null;

  for (const transp of transportadoras) {
    // Remove o nome da transportadora do CTe para forçar o motor a testar todas
    const cteTestando = { ...cteAlt, transportadora: transp.nome, nome_transportadora: transp.nome };
    const resultado = processarCte(cteTestando, transportadoras);

    if (resultado.status_calculo !== 'CALCULADO') continue;
    const total = safeNum(resultado.valor_calculado);
    if (total <= 0) continue;

    if (!melhor || total < melhor.total) {
      melhor = {
        total,
        transportadora: transp.nome,
        prazo: safeNum(resultado.detalhes_calculo?.prazo ?? resultado.prazo_entrega ?? 0),
        detalhes: resultado.detalhes_calculo,
      };
    }
  }

  return melhor;
}

function Card({ label, valor, sub, cor, destaque }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${destaque ? cor : '#e2e8f0'}`, borderLeft: `4px solid ${cor}`, borderRadius: 10, padding: '12px 18px', minWidth: 160 }}>
      <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '1.45rem', fontWeight: 800, color: destaque ? cor : '#1e293b' }}>{valor}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Barra({ valor, maximo, cor = '#9153F0' }) {
  const p = maximo > 0 ? Math.min((valor / maximo) * 100, 100) : 0;
  return <div style={{ background: '#f1f5f9', borderRadius: 99, height: 8, minWidth: 80 }}><div style={{ background: cor, height: '100%', borderRadius: 99, width: `${p}%` }} /></div>;
}

export default function OportunidadeOrigemPage() {
  const [competencia, setCompetencia] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [canal, setCanal] = useState('B2C');
  const [origemAltKey, setOrigemAltKey] = useState(0);
  const [limiteInput, setLimiteInput] = useState('2000');

  const [status, setStatus] = useState('idle');
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState(null);

  const [pagina, setPagina] = useState(0);
  const [aba, setAba] = useState('ranking');
  const [soComOp, setSoComOp] = useState(true);
  const [ordem, setOrdem] = useState({ campo: 'economia', dir: 'desc' });

  const podeCarregar = Boolean(competencia || dataInicio || dataFim);
  const origemAlt = ORIGENS_ALTERNATIVAS[origemAltKey];

  async function processar() {
    if (!podeCarregar) { setErro('Informe a competência ou um período.'); return; }
    setStatus('carregando'); setErro(''); setResultado(null); setPagina(0);

    try {
      setProgresso('Carregando tabelas de frete...');
      const base = normalizarTransportadoras(await carregarBaseCompletaDb());
      if (!base.length) throw new Error('Nenhuma tabela de frete cadastrada.');

      setProgresso('Carregando CT-es...');
      const ctes = await carregarCtes({
        competencia,
        dataInicio: dataInicio || undefined,
        dataFim: dataFim || undefined,
        canal: canal || undefined,
        limite: Number(limiteInput) || 2000,
        onProgress: ({ carregados }) => setProgresso(`Carregando CT-es... ${carregados}`),
      });
      if (!ctes.length) throw new Error('Nenhum CT-e encontrado para este recorte.');

      // Exclui os que já saíram do CD alternativo
      const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const cidadeAltNorm = norm(origemAlt.cidade);
      const ctesAlvo = ctes.filter((c) => {
        const cidade = norm(c.cidade_origem || c.origem || '');
        return !cidade.includes(cidadeAltNorm) && !cidadeAltNorm.includes(cidade.slice(0, 5));
      });

      setProgresso(`Simulando ${fmtN(ctesAlvo.length)} CT-es saindo de ${origemAlt.label}...`);

      const casos = [];
      for (let i = 0; i < ctesAlvo.length; i++) {
        const cte = ctesAlvo[i];
        const valorPago = safeNum(cte.valor_cte || cte.frete_pago || cte.valor_frete);
        const prazoReal = safeNum(cte.prazo_entrega || cte.prazo);

        const simulado = simularDeOrigem(cte, base, origemAlt);
        const temOp = Boolean(simulado && simulado.total > 0 && simulado.total < valorPago - TOLERANCIA);

        casos.push({
          chaveCte: cte.chave_cte || cte.chave || '',
          numeroCte: cte.numero_cte || cte.numero || cte.nro_cte || '',
          emissao: cte.data_emissao || '',
          canal: cte.canal || '',
          cidadeOrigem: cte.cidade_origem || cte.origem || '',
          ufOrigem: cte.uf_origem || '',
          cidadeDestino: cte.cidade_destino || cte.destino || '',
          ufDestino: cte.uf_destino || '',
          transportadoraReal: cte.transportadora || cte.nome_transportadora || '',
          peso: safeNum(cte.peso_declarado || cte.peso),
          valorNf: safeNum(cte.valor_nf || cte.nf_venda),
          valorPago,
          prazoReal,
          temOp,
          valorAlt: simulado?.total ?? null,
          transpAlt: simulado?.transportadora ?? null,
          prazoAlt: simulado?.prazo ?? null,
          economia: temOp ? Math.round((valorPago - simulado.total) * 100) / 100 : 0,
          economiaPrazo: temOp && simulado.prazo > 0 ? prazoReal - simulado.prazo : 0,
        });

        if (i % 100 === 0 || i === ctesAlvo.length - 1) {
          const p = Math.round(((i + 1) / ctesAlvo.length) * 100);
          setProgresso(`Simulando... ${i + 1}/${ctesAlvo.length} (${p}%)`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      const comOp = casos.filter((c) => c.temOp);
      const totalEconomia = Math.round(comOp.reduce((s, c) => s + c.economia, 0) * 100) / 100;

      // Ranking por destino
      const mapaDestino = new Map();
      for (const c of comOp) {
        const k = `${c.cidadeDestino}/${c.ufDestino}`;
        const v = mapaDestino.get(k) || { chave: k, ctes: 0, economia: 0, economiaPrazoTotal: 0 };
        v.ctes += 1; v.economia += c.economia; v.economiaPrazoTotal += c.economiaPrazo;
        mapaDestino.set(k, v);
      }
      const rankingDestino = Array.from(mapaDestino.values())
        .map((v) => ({ ...v, economia: Math.round(v.economia * 100) / 100, prazoMedio: v.ctes > 0 ? v.economiaPrazoTotal / v.ctes : 0 }))
        .sort((a, b) => b.economia - a.economia).slice(0, 20);

      // Ranking por transportadora alternativa
      const mapaTransp = new Map();
      for (const c of comOp) {
        const k = c.transpAlt || 'Desconhecida';
        const v = mapaTransp.get(k) || { chave: k, ctes: 0, economia: 0 };
        v.ctes += 1; v.economia += c.economia;
        mapaTransp.set(k, v);
      }
      const rankingTransp = Array.from(mapaTransp.values())
        .map((v) => ({ ...v, economia: Math.round(v.economia * 100) / 100 }))
        .sort((a, b) => b.economia - a.economia);

      setResultado({ casos, totalCtes: ctesAlvo.length, totalOp: comOp.length, totalEconomia, rankingDestino, rankingTransp, origemAlt });
      setStatus('concluido'); setProgresso('');
    } catch (e) {
      setErro(e.message || 'Erro ao processar.');
      setStatus('erro'); setProgresso('');
    }
  }

  const casosVisiveis = useMemo(() => {
    if (!resultado) return [];
    const lista = soComOp ? resultado.casos.filter((c) => c.temOp) : resultado.casos;
    const { campo, dir } = ordem;
    return [...lista].sort((a, b) => {
      const va = a[campo] ?? 0; const vb = b[campo] ?? 0;
      return dir === 'desc' ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
    });
  }, [resultado, soComOp, ordem]);

  const totalPags = Math.ceil(casosVisiveis.length / PAGE_SIZE);
  const pagAtual = casosVisiveis.slice(pagina * PAGE_SIZE, (pagina + 1) * PAGE_SIZE);
  const maxDestino = resultado?.rankingDestino?.[0]?.economia || 1;
  const maxTransp = resultado?.rankingTransp?.[0]?.economia || 1;

  const Th = ({ campo, label }) => (
    <th style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      onClick={() => { setOrdem((p) => ({ campo, dir: p.campo === campo && p.dir === 'desc' ? 'asc' : 'desc' })); setPagina(0); }}>
      {label} {ordem.campo === campo ? (ordem.dir === 'desc' ? '▼' : '▲') : ''}
    </th>
  );

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Análise</div>
        <h1>Oportunidade de Origem</h1>
        <p>Simula quanto custaria despachar cada CT-e a partir de um CD alternativo — mostra a economia potencial por falta de estoque no local mais próximo do destino.</p>
      </div>

      {erro && <div className="sim-alert error">{erro}</div>}

      <section className="sim-card">
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
          <label>Competência (mês)<input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} /></label>
          <label>Período — início<input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} /></label>
          <label>Período — fim<input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></label>
          <label>Canal
            <select value={canal} onChange={(e) => setCanal(e.target.value)} style={{ width: '100%' }}>
              <option value="">Todos</option>
              <option value="B2C">B2C</option>
              <option value="ATACADO">ATACADO</option>
              <option value="INTERCOMPANY">INTERCOMPANY</option>
              <option value="REVERSA">REVERSA</option>
            </select>
          </label>
        </div>
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end', marginBottom: 16 }}>
          <label>CD alternativo (simular saída de)
            <select value={origemAltKey} onChange={(e) => setOrigemAltKey(Number(e.target.value))} style={{ width: '100%' }}>
              {ORIGENS_ALTERNATIVAS.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
            </select>
          </label>
          <label>Limite de CT-es
            <input type="number" value={limiteInput} onChange={(e) => setLimiteInput(e.target.value)} min={100} max={20000} step={500} />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="primary" type="button" onClick={processar} disabled={status === 'carregando' || !podeCarregar}>
              {status === 'carregando' ? 'Processando...' : 'Analisar oportunidade'}
            </button>
            {resultado && <button className="sim-tab" type="button" onClick={() => { setResultado(null); setStatus('idle'); }}>Limpar</button>}
          </div>
        </div>

        {progresso && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #93c5fd', borderTop: '2px solid #1d4ed8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            {progresso}
          </div>
        )}
      </section>

      {resultado && (
        <>
          <div className="summary-strip" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <Card label="CT-es analisados" valor={fmtN(resultado.totalCtes)} sub={`saíram fora de ${origemAlt.label}`} cor="#9153F0" />
            <Card label="Com oportunidade" valor={fmtN(resultado.totalOp)} sub={pct(resultado.totalCtes > 0 ? (resultado.totalOp / resultado.totalCtes) * 100 : 0)} cor="#e67e22" />
            <Card label="Economia potencial" valor={fmt(resultado.totalEconomia)} sub="se tivesse estoque no CD alt." cor="#9b1111" destaque={resultado.totalEconomia > 0} />
            <Card label="Economia média / CTe" valor={fmt(resultado.totalOp > 0 ? resultado.totalEconomia / resultado.totalOp : 0)} sub="casos com oportunidade" cor="#04C7A4" />
          </div>

          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 16px', marginBottom: '1rem', fontSize: '0.84rem', color: '#166534' }}>
            <strong>Como ler:</strong> Para cada CT-e que saiu de outra origem, simulamos o mesmo frete saindo de <strong>{origemAlt.label}</strong> com todas as transportadoras disponíveis.
            A coluna <em>Economia</em> mostra quanto custaria a menos — a perda por falta de estoque no CD.
          </div>

          <div style={{ display: 'flex', gap: 4, marginBottom: '0.5rem', borderBottom: '2px solid #eee', paddingBottom: '0.25rem', flexWrap: 'wrap' }}>
            {[
              { id: 'ranking', label: `Por destino (${resultado.rankingDestino.length})` },
              { id: 'transportadora', label: `Por transportadora alt. (${resultado.rankingTransp.length})` },
              { id: 'detalhes', label: `CT-es (${casosVisiveis.length.toLocaleString('pt-BR')})` },
            ].map((a) => (
              <button key={a.id} onClick={() => { setAba(a.id); setPagina(0); }}
                style={{ padding: '4px 14px', border: 'none', borderRadius: '4px 4px 0 0', cursor: 'pointer', background: aba === a.id ? '#9153F0' : '#f0f0f0', color: aba === a.id ? '#fff' : '#555', fontWeight: aba === a.id ? 700 : 400, fontSize: '0.85rem' }}>
                {a.label}
              </button>
            ))}
          </div>

          {aba === 'ranking' && (
            <div className="panel-card">
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>Top 20 destinos — onde mais economizaria saindo de {origemAlt.label}</div>
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead><tr><th>#</th><th>Destino</th><th>CT-es</th><th>Economia total</th><th>Economia / CTe</th><th>Ganho prazo médio</th><th style={{ minWidth: 120 }}>Visual</th></tr></thead>
                  <tbody>
                    {resultado.rankingDestino.map((r, i) => (
                      <tr key={r.chave}>
                        <td style={{ fontWeight: 700, color: '#9153F0' }}>#{i + 1}</td>
                        <td><strong>{r.chave}</strong></td>
                        <td>{fmtN(r.ctes)}</td>
                        <td className="negativo" style={{ fontWeight: 700 }}>{fmt(r.economia)}</td>
                        <td>{fmt(r.ctes > 0 ? r.economia / r.ctes : 0)}</td>
                        <td style={{ color: r.prazoMedio > 0 ? '#04C7A4' : '#94a3b8' }}>{r.prazoMedio > 0 ? `-${r.prazoMedio.toFixed(1)}d` : '—'}</td>
                        <td><Barra valor={r.economia} maximo={maxDestino} cor="#9b1111" /></td>
                      </tr>
                    ))}
                    {!resultado.rankingDestino.length && <tr><td colSpan={7}>Nenhuma oportunidade encontrada. Verifique se há tabelas cadastradas para {origemAlt.label}.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {aba === 'transportadora' && (
            <div className="panel-card">
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>Transportadoras que ganhariam volume saindo de {origemAlt.label}</div>
              <p style={{ fontSize: '0.84rem', color: '#64748b', marginBottom: 12 }}>Quem seria a mais barata nos fretes simulados — mostra quais parceiros têm boa cobertura a partir deste CD.</p>
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead><tr><th>#</th><th>Transportadora</th><th>CT-es</th><th>Economia gerada</th><th style={{ minWidth: 120 }}>Visual</th></tr></thead>
                  <tbody>
                    {resultado.rankingTransp.map((r, i) => (
                      <tr key={r.chave}>
                        <td style={{ fontWeight: 700, color: '#9153F0' }}>#{i + 1}</td>
                        <td><strong>{r.chave}</strong></td>
                        <td>{fmtN(r.ctes)}</td>
                        <td className="negativo" style={{ fontWeight: 700 }}>{fmt(r.economia)}</td>
                        <td><Barra valor={r.economia} maximo={maxTransp} cor="#04C7A4" /></td>
                      </tr>
                    ))}
                    {!resultado.rankingTransp.length && <tr><td colSpan={5}>—</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {aba === 'detalhes' && (
            <div className="panel-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <div className="panel-title" style={{ margin: 0 }}>CT-e a CT-e</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={soComOp} onChange={(e) => { setSoComOp(e.target.checked); setPagina(0); }} />
                  Apenas com oportunidade
                </label>
              </div>
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead>
                    <tr>
                      <th>CT-e</th><th>Emissão</th><th>Canal</th>
                      <th>Origem real → Destino</th>
                      <th>Transp. real</th>
                      <Th campo="valorPago" label="Pago (real)" />
                      <th>Transp. de {origemAlt.cidade}</th>
                      <Th campo="valorAlt" label={`Custo de ${origemAlt.cidade}`} />
                      <Th campo="economia" label="Economia" />
                      <th>Prazo (real → alt)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagAtual.map((c) => (
                      <tr key={c.chaveCte || c.numeroCte} style={{ background: c.temOp ? undefined : '#f8fff8' }}>
                        <td style={{ fontSize: '0.78rem', color: '#666' }}>{c.numeroCte || c.chaveCte?.slice(-8) || '-'}</td>
                        <td>{fmtData(c.emissao)}</td>
                        <td>{c.canal || '-'}</td>
                        <td><span style={{ color: '#e67e22' }}>{c.cidadeOrigem}/{c.ufOrigem}</span> → {c.cidadeDestino}/{c.ufDestino}</td>
                        <td>{c.transportadoraReal}</td>
                        <td>{fmt(c.valorPago)}</td>
                        <td style={{ color: '#04C7A4', fontWeight: 600 }}>{c.transpAlt || '—'}</td>
                        <td>{c.valorAlt != null ? fmt(c.valorAlt) : '—'}</td>
                        <td className={c.temOp ? 'negativo' : ''} style={{ fontWeight: c.temOp ? 700 : 400 }}>{c.temOp ? fmt(c.economia) : '—'}</td>
                        <td style={{ whiteSpace: 'nowrap', color: c.economiaPrazo > 0 ? '#04C7A4' : c.economiaPrazo < 0 ? '#e67e22' : '#94a3b8' }}>
                          {c.prazoReal > 0 ? `${c.prazoReal}d` : '?'} → {c.prazoAlt > 0 ? `${c.prazoAlt}d` : '?'}
                          {c.economiaPrazo !== 0 && c.prazoAlt > 0 && <span> ({c.economiaPrazo > 0 ? `-${c.economiaPrazo}d` : `+${Math.abs(c.economiaPrazo)}d`})</span>}
                        </td>
                      </tr>
                    ))}
                    {!pagAtual.length && <tr><td colSpan={10}>Nenhum CT-e.</td></tr>}
                  </tbody>
                </table>
              </div>
              {totalPags > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: '0.75rem' }}>
                  <button className="btn-secondary" onClick={() => setPagina(0)} disabled={pagina === 0}>«</button>
                  <button className="btn-secondary" onClick={() => setPagina((p) => p - 1)} disabled={pagina === 0}>‹</button>
                  <span style={{ fontSize: '0.85rem', color: '#555' }}>Página {pagina + 1} de {totalPags} · {casosVisiveis.length.toLocaleString('pt-BR')} registros</span>
                  <button className="btn-secondary" onClick={() => setPagina((p) => p + 1)} disabled={pagina >= totalPags - 1}>›</button>
                  <button className="btn-secondary" onClick={() => setPagina(totalPags - 1)} disabled={pagina >= totalPags - 1}>»</button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
