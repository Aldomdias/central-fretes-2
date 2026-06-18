import React, { useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarBaseCompletaDb } from '../services/freteDatabaseService';
import { calcularFreteFaixaPeso, calcularFretePercentual } from '../services/freteCalcEngine';
import { filtrarCpComercialCte } from '../services/cteBasePolicy';

// Origens alternativas disponíveis para simulação.
// Cada uma representa um CD que poderia ter despachado no lugar da origem real.
const ORIGENS_ALTERNATIVAS = [
  { label: 'Itajaí / SC', cidade: 'ITAJAI', uf: 'SC' },
];

const PAGE_SIZE = 200;
const TOLERANCIA_PERDA = 0.05; // R$0,05

function safeNum(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(v) {
  return safeNum(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtN(v) {
  return safeNum(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function pct(v) {
  return `${safeNum(v).toFixed(1).replace('.', ',')}%`;
}

function fmtData(v) {
  if (!v) return '-';
  return String(v).slice(0, 10).split('-').reverse().join('/');
}

function normText(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

// ── motor de cálculo ──────────────────────────────────────────────────────────

function pick(obj, keys) {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  return null;
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const t = String(v).trim().includes(',')
    ? String(v).replace(/\./g, '').replace(',', '.')
    : String(v);
  const n = Number(t.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normalizeCompare(v) {
  return normText(String(v || '')).replace(/[^A-Z0-9]/g, '');
}

function cidadeCompativel(a, b) {
  const na = normalizeCompare(a);
  const nb = normalizeCompare(b);
  if (!na || !nb) return false;
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

function localizarTransportadora(transportadoras, nome) {
  const n = normalizeCompare(nome);
  if (!n) return null;
  return transportadoras.find((t) => normalizeCompare(t.nome) === n)
    || transportadoras.find((t) => normalizeCompare(t.nome).includes(n) || n.includes(normalizeCompare(t.nome)));
}

function localizarOrigem(transportadora, cte) {
  const cidadeOrigem = pick(cte, ['cidade_origem', 'origem']);
  const canal = normText(pick(cte, ['canal', 'canal_original']) || '');
  const origens = transportadora.origens || [];
  const compativel = origens.filter((o) => cidadeCompativel(o.cidade, cidadeOrigem));
  if (!compativel.length) return null;
  // tenta casar canal
  const comCanal = compativel.find((o) => normText(o.canal || '').includes(canal) || canal.includes(normText(o.canal || '')));
  return comCanal || compativel[0];
}

function localizarRota(origem, cte) {
  const ibgeDest = String(pick(cte, ['ibge_destino', 'codigo_ibge_destino', 'ibgeDestino']) || '').replace(/\D/g, '').slice(0, 7);
  const cidadeDest = pick(cte, ['cidade_destino', 'destino']) || '';
  const ufDest = String(pick(cte, ['uf_destino', 'ufDestino']) || '').toUpperCase();
  const rotas = origem.rotas || [];

  if (ibgeDest) {
    const porIbge = rotas.find((r) => {
      const ri = String(r.ibge_destino || r.ibgeDestino || '').replace(/\D/g, '').slice(0, 7);
      return ri && ri === ibgeDest;
    });
    if (porIbge) return { ...porIbge, nomeRota: porIbge.rota || porIbge.nome_rota || porIbge.nomeRota || '' };
  }

  const porCidade = rotas.find((r) => {
    const rc = normText(r.rota || r.nome_rota || r.nomeRota || r.cidade_destino || '');
    const nc = normText(cidadeDest);
    return nc && (rc === nc || rc.includes(nc) || nc.includes(rc));
  });
  if (porCidade) return { ...porCidade, nomeRota: porCidade.rota || porCidade.nome_rota || porCidade.nomeRota || '' };

  if (ufDest) {
    const porUf = rotas.find((r) => normText(r.uf_destino || r.ufDestino || r.uf || '') === ufDest);
    if (porUf) return { ...porUf, nomeRota: porUf.rota || porUf.nome_rota || porUf.nomeRota || '' };
  }

  return null;
}

function getCotacaoPorRota(origem, nomeRota, peso) {
  const cotacoes = (origem.cotacoes || []).filter((c) => {
    const cr = normText(c.rota || c.nome_rota || c.nomeRota || '');
    const nr = normText(nomeRota);
    return cr === nr || cr.includes(nr) || nr.includes(cr);
  });
  if (!cotacoes.length) return null;
  // filtra por faixa de peso
  const comFaixa = cotacoes.find((c) => {
    const ini = toNum(c.peso_inicial ?? c.pesoInicial ?? c.peso_de ?? 0);
    const fim = toNum(c.peso_final ?? c.pesoFinal ?? c.peso_ate ?? 99999);
    return peso >= ini && peso <= fim;
  });
  return comFaixa || cotacoes[0];
}

function getTipoCalculo(origem, cotacao) {
  const tipo = normText(cotacao?.tipo_calculo || cotacao?.tipoCalculo || origem?.generalidades?.tipo_calculo || '');
  if (tipo.includes('PERCENT') || tipo.includes('AD VALOREM')) return 'PERCENTUAL';
  return 'FAIXA_DE_PESO';
}

function getTaxaDestino(origem, ibgeDestino) {
  if (!ibgeDestino) return null;
  return (origem.taxas || []).find((t) => {
    const ti = String(t.ibge_destino || t.ibgeDestino || '').replace(/\D/g, '').slice(0, 7);
    return ti && ti === String(ibgeDestino).replace(/\D/g, '').slice(0, 7);
  }) || null;
}

function simularFreteOrigem(cte, transportadoras, origemAlt) {
  // Substitui cidade/UF de origem pelo CD alternativo e tenta calcular
  const cteAlt = {
    ...cte,
    cidade_origem: origemAlt.cidade,
    uf_origem: origemAlt.uf,
    // mantém transportadora original para ver se ela atende de lá
  };

  // Tenta todas as transportadoras (não só a que carregou) para achar a mais barata de origemAlt
  let melhor = null;

  for (const transp of transportadoras) {
    const origem = localizarOrigem(transp, cteAlt);
    if (!origem) continue;
    const rota = localizarRota(origem, cteAlt);
    if (!rota) continue;

    const pesoDecl = toNum(pick(cte, ['peso_declarado', 'pesoDeclarado', 'peso']));
    const pesoCub = toNum(pick(cte, ['peso_cubado', 'pesoCubado']));
    const peso = Math.max(pesoDecl, pesoCub, toNum(pick(cte, ['peso'])));
    const valorNf = toNum(pick(cte, ['valor_nf', 'valorNF', 'nf_venda', 'valor_nota']));

    const cotacao = getCotacaoPorRota(origem, rota.nomeRota, peso);
    if (!cotacao) continue;

    const tipoCalculo = getTipoCalculo(origem, cotacao);
    const taxaDestino = getTaxaDestino(origem, rota.ibgeDestino);
    const generalidades = origem.generalidades || {};

    try {
      const calc = tipoCalculo === 'FAIXA_DE_PESO'
        ? calcularFreteFaixaPeso({ rota, cotacao, generalidades, taxaDestino, pesoKg: peso, valorNf })
        : calcularFretePercentual({ rota, cotacao, generalidades, taxaDestino, pesoKg: peso, valorNf });

      const total = safeNum(calc.total ?? calc.valorTotal ?? calc.subtotal);
      if (total <= 0) continue;

      if (!melhor || total < melhor.total) {
        melhor = {
          total,
          transportadora: transp.nome,
          prazo: safeNum(rota.prazo || rota.dias || cotacao.prazo),
          detalhe: calc,
          rota: rota.nomeRota,
          origem_cidade: origemAlt.cidade,
          origem_uf: origemAlt.uf,
        };
      }
    } catch {
      // ignora erros de cálculo individuais
    }
  }

  return melhor;
}

// ── carga de dados ────────────────────────────────────────────────────────────

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

    if (canal) q = q.eq('canal', canal);

    const { data, error } = await q;
    if (error) throw new Error(`Erro ao carregar CT-es: ${error.message}`);
    const lote = data || [];
    acumulado.push(...lote);
    onProgress?.({ etapa: 'carregando_ctes', carregados: acumulado.length });
    if (lote.length < PAGE) break;
    from += PAGE;
  }

  return filtrarCpComercialCte(acumulado);
}

function normalizarTransportadoras(base) {
  return (base || []).map((t) => ({
    ...t,
    origens: (t.origens || []).map((o) => ({
      ...o,
      __cidadeNorm: normalizeCompare(o.cidade),
      __canalNorm: normText(o.canal || ''),
    })),
  }));
}

// ── componentes ───────────────────────────────────────────────────────────────

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
  const pctVal = maximo > 0 ? Math.min((valor / maximo) * 100, 100) : 0;
  return <div style={{ background: '#f1f5f9', borderRadius: 99, height: 8, minWidth: 80 }}><div style={{ background: cor, height: '100%', borderRadius: 99, width: `${pctVal}%` }} /></div>;
}

// ── página principal ──────────────────────────────────────────────────────────

export default function OportunidadeOrigemPage() {
  const [competencia, setCompetencia] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [canal, setCanal] = useState('B2C');
  const [origemAltKey, setOrigemAltKey] = useState(0); // índice em ORIGENS_ALTERNATIVAS
  const [limiteCtesInput, setLimiteCtesInput] = useState('2000');

  const [status, setStatus] = useState('idle'); // idle | carregando | concluido | erro
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState(null); // { casos, totalCtes, totalOportunidade, totalEconomia, ... }

  const [pagina, setPagina] = useState(0);
  const [aba, setAba] = useState('ranking');
  const [soComOportunidade, setSoComOportunidade] = useState(true);
  const [ordem, setOrdem] = useState({ campo: 'economia', dir: 'desc' });

  const podeCarregar = Boolean(competencia || dataInicio || dataFim);
  const origemAlt = ORIGENS_ALTERNATIVAS[origemAltKey];

  async function processar() {
    if (!podeCarregar) { setErro('Informe a competência ou um período.'); return; }
    setStatus('carregando');
    setErro('');
    setResultado(null);
    setPagina(0);

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
        limite: Number(limiteCtesInput) || 2000,
        onProgress: ({ carregados }) => setProgresso(`Carregando CT-es... ${carregados} carregados`),
      });

      if (!ctes.length) throw new Error('Nenhum CT-e encontrado para este recorte.');

      // Filtra apenas CTes que NÃO saíram da origem alternativa
      const ctesAlvo = ctes.filter((c) => {
        const cidadeReal = normText(pick(c, ['cidade_origem', 'origem']) || '');
        return !cidadeCompativel(cidadeReal, origemAlt.cidade);
      });

      setProgresso(`Simulando ${fmtN(ctesAlvo.length)} CT-es saindo de ${origemAlt.label}...`);

      const casos = [];
      for (let i = 0; i < ctesAlvo.length; i++) {
        const cte = ctesAlvo[i];
        const simulado = simularFreteOrigem(cte, base, origemAlt);

        const valorPago = toNum(pick(cte, ['valor_cte', 'frete_pago', 'valor_frete']));
        const prazoReal = toNum(pick(cte, ['prazo', 'prazo_entrega']));

        casos.push({
          chaveCte: pick(cte, ['chave_cte', 'chave', 'key']) || '',
          numeroCte: pick(cte, ['numero_cte', 'numero', 'nro_cte']) || '',
          emissao: pick(cte, ['data_emissao', 'emissao']) || '',
          canal: pick(cte, ['canal', 'canal_original']) || '',
          cidadeOrigem: pick(cte, ['cidade_origem', 'origem']) || '',
          ufOrigem: pick(cte, ['uf_origem']) || '',
          cidadeDestino: pick(cte, ['cidade_destino', 'destino']) || '',
          ufDestino: pick(cte, ['uf_destino']) || '',
          transportadoraReal: pick(cte, ['transportadora', 'nome_transportadora']) || '',
          peso: toNum(pick(cte, ['peso_declarado', 'peso', 'peso_cubado'])),
          valorNf: toNum(pick(cte, ['valor_nf', 'nf_venda', 'valor_nota'])),
          valorPago,
          prazoReal,
          // simulado de origemAlt
          temOportunidade: Boolean(simulado && simulado.total > 0 && simulado.total < valorPago - TOLERANCIA_PERDA),
          valorAlt: simulado?.total ?? null,
          transpAlt: simulado?.transportadora ?? null,
          prazoAlt: simulado?.prazo ?? null,
          rotaAlt: simulado?.rota ?? null,
          economia: simulado ? Math.max(0, valorPago - (simulado.total ?? valorPago)) : 0,
          economiaPrazo: simulado ? prazoReal - (simulado.prazo ?? prazoReal) : 0,
          detalheAlt: simulado?.detalhe ?? null,
        });

        if (i % 200 === 0 || i === ctesAlvo.length - 1) {
          const pctVal = Math.round(((i + 1) / ctesAlvo.length) * 100);
          setProgresso(`Simulando... ${i + 1}/${ctesAlvo.length} (${pctVal}%)`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      const comOp = casos.filter((c) => c.temOportunidade);
      const totalEconomia = Math.round(comOp.reduce((s, c) => s + c.economia, 0) * 100) / 100;
      const totalOportunidade = comOp.length;

      // Ranking por cidade de destino
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

      setResultado({ casos, totalCtes: ctesAlvo.length, totalOportunidade, totalEconomia, rankingDestino, rankingTransp, origemAlt });
      setStatus('concluido');
      setProgresso('');
    } catch (e) {
      setErro(e.message || 'Erro ao processar.');
      setStatus('erro');
      setProgresso('');
    }
  }

  // Detalhes filtrados e ordenados
  const casosVisiveis = useMemo(() => {
    if (!resultado) return [];
    const lista = soComOportunidade ? resultado.casos.filter((c) => c.temOportunidade) : resultado.casos;
    const { campo, dir } = ordem;
    return [...lista].sort((a, b) => {
      const va = a[campo] ?? 0; const vb = b[campo] ?? 0;
      return dir === 'desc' ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
    });
  }, [resultado, soComOportunidade, ordem]);

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
        <p>
          Simula quanto custaria despachar cada CT-e a partir de um CD alternativo.
          Mostra a economia potencial por falta de estoque no local mais próximo do destino.
        </p>
      </div>

      {erro && <div className="sim-alert error">{erro}</div>}

      {/* Filtros de carga */}
      <section className="sim-card">
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
          <label>
            Competência (mês)
            <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
          </label>
          <label>
            Período — início
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </label>
          <label>
            Período — fim
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </label>
          <label>
            Canal
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
          <label>
            CD alternativo (simular saída de)
            <select value={origemAltKey} onChange={(e) => setOrigemAltKey(Number(e.target.value))} style={{ width: '100%' }}>
              {ORIGENS_ALTERNATIVAS.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
            </select>
          </label>
          <label>
            Limite de CT-es
            <input type="number" value={limiteCtesInput} onChange={(e) => setLimiteCtesInput(e.target.value)} min={100} max={20000} step={500} />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="primary" type="button" onClick={processar} disabled={status === 'carregando' || !podeCarregar}>
              {status === 'carregando' ? 'Processando...' : 'Analisar oportunidade'}
            </button>
            {resultado && (
              <button className="sim-tab" type="button" onClick={() => { setResultado(null); setStatus('idle'); }}>
                Limpar
              </button>
            )}
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
          {/* Cards resumo */}
          <div className="summary-strip" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <Card label="CT-es analisados" valor={fmtN(resultado.totalCtes)} sub={`saíram fora de ${origemAlt.label}`} cor="#9153F0" />
            <Card label="Com oportunidade" valor={fmtN(resultado.totalOportunidade)} sub={pct(resultado.totalCtes > 0 ? (resultado.totalOportunidade / resultado.totalCtes) * 100 : 0)} cor="#e67e22" />
            <Card label="Economia potencial" valor={fmt(resultado.totalEconomia)} sub="se tivesse estoque no CD alt." cor="#9b1111" destaque={resultado.totalEconomia > 0} />
            <Card label="Economia média / CTe" valor={fmt(resultado.totalOportunidade > 0 ? resultado.totalEconomia / resultado.totalOportunidade : 0)} sub="casos com oportunidade" cor="#04C7A4" />
          </div>

          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 16px', marginBottom: '1rem', fontSize: '0.84rem', color: '#166534' }}>
            <strong>Como ler:</strong> Para cada CT-e que saiu de {resultado.casos[0]?.cidadeOrigem || 'outra origem'} (e outras origens), simulamos o mesmo frete saindo de <strong>{origemAlt.label}</strong> com todas as transportadoras disponíveis.
            A coluna <em>Economia</em> mostra quanto custaria a menos — que representa a perda por falta de estoque no CD.
          </div>

          {/* Abas */}
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
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>
                Top 20 destinos — onde mais economizaria saindo de {origemAlt.label}
              </div>
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
                        <td style={{ color: r.prazoMedio > 0 ? '#04C7A4' : '#94a3b8' }}>
                          {r.prazoMedio > 0 ? `-${r.prazoMedio.toFixed(1)}d` : '—'}
                        </td>
                        <td><Barra valor={r.economia} maximo={maxDestino} cor="#9b1111" /></td>
                      </tr>
                    ))}
                    {!resultado.rankingDestino.length && <tr><td colSpan={7}>Nenhuma oportunidade encontrada.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {aba === 'transportadora' && (
            <div className="panel-card">
              <div className="panel-title" style={{ marginBottom: '0.75rem' }}>
                Transportadoras que ganhariam volume saindo de {origemAlt.label}
              </div>
              <p style={{ fontSize: '0.84rem', color: '#64748b', marginBottom: 12 }}>
                Quem seria a mais barata nos fretes simulados — mostra quais parceiros têm boa cobertura a partir deste CD.
              </p>
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead><tr><th>#</th><th>Transportadora (mais barata de {origemAlt.label})</th><th>CT-es ganhos</th><th>Economia gerada</th><th style={{ minWidth: 120 }}>Visual</th></tr></thead>
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
                    {!resultado.rankingTransp.length && <tr><td colSpan={5}>Nenhuma transportadora alternativa encontrada.</td></tr>}
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
                  <input type="checkbox" checked={soComOportunidade} onChange={(e) => { setSoComOportunidade(e.target.checked); setPagina(0); }} />
                  Apenas com oportunidade
                </label>
              </div>
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead>
                    <tr>
                      <th>CT-e</th>
                      <th>Emissão</th>
                      <th>Canal</th>
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
                      <tr key={c.chaveCte} style={{ background: c.temOportunidade ? undefined : '#f8fff8' }}>
                        <td style={{ fontSize: '0.78rem', color: '#666' }}>{c.numeroCte || c.chaveCte?.slice(-8) || '-'}</td>
                        <td>{fmtData(c.emissao)}</td>
                        <td>{c.canal || '-'}</td>
                        <td><span style={{ color: '#e67e22' }}>{c.cidadeOrigem}/{c.ufOrigem}</span> → {c.cidadeDestino}/{c.ufDestino}</td>
                        <td>{c.transportadoraReal}</td>
                        <td>{fmt(c.valorPago)}</td>
                        <td style={{ color: '#04C7A4', fontWeight: 600 }}>{c.transpAlt || '—'}</td>
                        <td>{c.valorAlt != null ? fmt(c.valorAlt) : '—'}</td>
                        <td className={c.temOportunidade ? 'negativo' : ''} style={{ fontWeight: c.temOportunidade ? 700 : 400 }}>
                          {c.temOportunidade ? fmt(c.economia) : '—'}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', color: c.economiaPrazo > 0 ? '#04C7A4' : c.economiaPrazo < 0 ? '#e67e22' : '#94a3b8' }}>
                          {c.prazoReal > 0 ? `${c.prazoReal}d` : '?'} → {c.prazoAlt > 0 ? `${c.prazoAlt}d` : '?'}
                          {c.economiaPrazo !== 0 && c.prazoAlt > 0 && (
                            <span> ({c.economiaPrazo > 0 ? `-${c.economiaPrazo}d` : `+${Math.abs(c.economiaPrazo)}d`})</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!pagAtual.length && <tr><td colSpan={10}>Nenhum CT-e com esses filtros.</td></tr>}
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
