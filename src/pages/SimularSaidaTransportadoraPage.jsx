import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import BaseCtesStatus from '../components/BaseCtesStatus';
import { buscarBaseSimulacaoPorRotasDb, carregarCadastroCnpjTransportadorasDb, carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';
import { normalizarTransportadoras, processarCte } from '../services/auditoriaCteProcessamentoService';
import { categoriaCanalRealizado, montarMapasIbge, resolverIbgeLocal } from '../utils/realizadoLocalEngine';
import { aplicarPoliticaBaseCte, isCpsLogCte, isEbazarCte } from '../services/cteBasePolicy';
import { intervaloEmissao, janelasEmissao, localPadronizado, montarMunicipioPorIbge, pesoComoSimuladorRealizado, rotuloLocal } from '../utils/saidaTransportadoraRecorte';
import { carregarVinculosTransportadoras, criarMapaVinculosTransportadoras } from '../services/vinculosTransportadorasService';
import { aplicarVinculoTransportadora as aplicarVinculoPuro } from '../services/vinculosTransportadorasPuro';
import { unificarTransportadorasCtes } from '../utils/unificarTransportadorasCte';
import { carregarDetalhesNegociacaoParaSimulacao, listarCapasNegociacaoParaSimulacao } from '../services/tabelasNegociacaoService';
import { converterTabelasNegociacaoParaSimulador, labelTabelaNegociacaoSimulador, marcarDesambiguacaoNegociacoesSimulador } from '../utils/tabelasNegociacaoSimuladorAdapter';
import { buscarTrackingParaRealizado, enriquecerRealizadoComTracking } from '../services/realizadoTrackingEnrichment';
import { consumirHandoffSaidaTransportadora, escolherGrupoTransportadora } from '../utils/saidaTransportadoraHandoff';
import { abrirLaudoSaida, analisarRota, exportarExcelLaudoSaida, RECOMENDACAO_ORIGEM, resumirPorOrigem } from '../utils/laudoSaidaTransportadora';

const LIMITE_MAX_CT = 200000;
const TOLERANCIA = 0.5; // R$ — diferença abaixo disto é ruído

function safeNum(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function fmt(v) { return safeNum(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function fmtN(v) { return safeNum(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function pct(v) { return `${safeNum(v).toFixed(1).replace('.', ',')}%`; }
function fmtDias(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const txt = Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
  return `${txt} d`;
}
function chaveCurta(chave) {
  const s = String(chave || '');
  return s.length > 12 ? `…${s.slice(-10)}` : (s || '—');
}
function fmtData(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString('pt-BR');
}
function norm(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function dig7(v) { return String(v || '').replace(/\D/g, '').slice(0, 7); }
function normalizeBuscaIbge(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function normCmp(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().toLowerCase();
}
function cidadeBate(cidadeTabelaNorm, cidadeCteNorm) {
  if (!cidadeCteNorm) return true;
  if (!cidadeTabelaNorm) return false;
  return cidadeTabelaNorm === cidadeCteNorm
    || (cidadeTabelaNorm.length >= 5 && cidadeCteNorm.includes(cidadeTabelaNorm))
    || (cidadeCteNorm.length >= 5 && cidadeTabelaNorm.includes(cidadeCteNorm));
}
function canalRealDe(cte) {
  return cte.canal_original && norm(cte.canal) === 'ADEFINIR'
    ? cte.canal_original
    : (cte.canal || cte.canal_original || '');
}

function montarMunicipioPorCidade(municipios = []) {
  const mapa = new Map();
  for (const item of (municipios || [])) {
    const ibge = dig7(item.ibge || item.codigo_ibge || item.codigo);
    const cidade = item.cidade || item.nome || item.municipio || '';
    const uf = item.uf || item.estado || '';
    if (!ibge || !cidade) continue;
    const kCidade = normalizeBuscaIbge(cidade);
    const kCidadeUf = normalizeBuscaIbge(`${cidade}/${uf}`);
    if (kCidade && !mapa.has(kCidade)) mapa.set(kCidade, ibge);
    if (kCidadeUf && !mapa.has(kCidadeUf)) mapa.set(kCidadeUf, ibge);
  }
  return mapa;
}
function ibgeDoCte(cte, tipo, municipioPorCidade, mapasIbge) {
  const direto = dig7(tipo === 'origem'
    ? (cte.ibge_corrigido_origem || cte.ibge_origem || cte.ibgeOrigem)
    : (cte.ibge_corrigido_destino || cte.ibge_destino || cte.ibgeDestino));
  if (direto) return direto;
  const cidade = tipo === 'origem' ? (cte.cidade_origem || cte.origem || '') : (cte.cidade_destino || cte.destino || '');
  const uf = tipo === 'origem' ? (cte.uf_origem || '') : (cte.uf_destino || '');
  const viaPlanilha = municipioPorCidade.get(normalizeBuscaIbge(`${cidade}/${uf}`)) || municipioPorCidade.get(normalizeBuscaIbge(cidade));
  if (viaPlanilha) return viaPlanilha;
  return resolverIbgeLocal(cidade, uf, mapasIbge) || '';
}

// Monta as chaves de rota (canal|ibgeOrigem-ibgeDestino) só dos CT-es passados,
// pra buscar no banco apenas as tabelas de frete relevantes a essas rotas —
// evita puxar a base inteira (rotas tem ~1,3M linhas) quando só interessa o
// que a transportadora avaliada realmente roda.
function montarRouteKeysCtes(ctes = [], municipioPorCidade, mapasIbge, canalFiltro = '') {
  const keys = new Set();
  for (const cte of ctes || []) {
    const ibgeOrigem = ibgeDoCte(cte, 'origem', municipioPorCidade, mapasIbge);
    const ibgeDestino = ibgeDoCte(cte, 'destino', municipioPorCidade, mapasIbge);
    if (!ibgeOrigem || !ibgeDestino) continue;
    const pairKey = `${ibgeOrigem}-${ibgeDestino}`;
    const canalCte = categoriaCanalRealizado(canalRealDe(cte));
    if (canalCte) keys.add(`${canalCte}|${pairKey}`);
    if (canalFiltro) keys.add(`${categoriaCanalRealizado(canalFiltro) || canalFiltro}|${pairKey}`);
    if (!canalCte && !canalFiltro) keys.add(pairKey);
  }
  return Array.from(keys);
}

function indexarBase(base) {
  const porOrigemIbge = new Map();
  const porDestinoIbge = new Map();
  const origensCidade = [];
  const vistos = new Set();
  for (const t of base) {
    const nome = t.nome;
    for (const origem of (t.origens || [])) {
      const cidadeNorm = origem.__cidadeNorm || normCmp(origem.cidade);
      const ck = `${nome}|${cidadeNorm}`;
      if (cidadeNorm && !vistos.has(ck)) { vistos.add(ck); origensCidade.push({ cidadeNorm, nome }); }
      for (const rota of (origem.rotas || [])) {
        const io = dig7(rota.ibgeOrigem);
        if (io) { if (!porOrigemIbge.has(io)) porOrigemIbge.set(io, new Set()); porOrigemIbge.get(io).add(nome); }
        const id = dig7(rota.ibgeDestino);
        if (id) { if (!porDestinoIbge.has(id)) porDestinoIbge.set(id, new Set()); porDestinoIbge.get(id).add(nome); }
      }
    }
  }
  return { porOrigemIbge, porDestinoIbge, origensCidade };
}
function nomesPorOrigem(idx, ibgeOrigem7, cidadeCteNorm, cache) {
  const key = `${ibgeOrigem7}|${cidadeCteNorm}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const set = new Set(idx.porOrigemIbge.get(ibgeOrigem7) || []);
  for (const o of idx.origensCidade) {
    if (!set.has(o.nome) && cidadeBate(o.cidadeNorm, cidadeCteNorm)) set.add(o.nome);
  }
  cache.set(key, set);
  return set;
}

// Igual ao motor da Oportunidade Transportadora, mas SEM a transportadora que está saindo.
// nomesExcluir: Set com norm() de todos os nomes da transportadora que está saindo
// (nome unificado, variações do CT-e e nomes de tabela com a mesma raiz de CNPJ).
// Mesmo critério de peso do Simulador do realizado (padrão "usar peso do
// CT-e"): sem peso cubado e sem cair no peso_declarado (bruto da NF) quando o
// CT-e tem peso. Sem isto, aqui o motor usava max(peso_declarado, peso_cubado)
// e os valores das substitutas saíam maiores que no simulador.
const OPCOES_MOTOR = { ignorarCubagem: true, percentualContingenciaPeso: 0, semComparativoPesos: true };
function cteComPesoSimulador(cte) {
  const peso = pesoComoSimuladorRealizado(cte);
  return { ...cte, peso, peso_declarado: peso, pesoDeclarado: peso, peso_cubado: 0, pesoCubado: 0 };
}

function simularSubstitutas(cte, base, candidatas, ibgeOrigemReal, ibgeDestino, cidadeOrigemReal, nomesExcluir) {
  const canalReal = canalRealDe(cte);
  const cteBase = {
    ...cteComPesoSimulador(cte),
    canal: canalReal,
    canal_original: canalReal,
    ibge_origem: ibgeOrigemReal || '',
    ibge_corrigido_origem: ibgeOrigemReal || '',
    ibge_destino: ibgeDestino || '',
    ibge_corrigido_destino: ibgeDestino || '',
  };
  const origemRealCmp = normCmp(cidadeOrigemReal);
  const resultados = [];
  for (const transp of candidatas) {
    if (nomesExcluir.has(norm(transp.nome))) continue;
    const teste = { ...cteBase, transportadora: transp.nome, nome_transportadora: transp.nome };
    let r;
    try { r = processarCte(teste, base, null, transp.nome, OPCOES_MOTOR); } catch { continue; }
    if (r.status_calculo !== 'CALCULADO') continue;
    if (!cidadeBate(normCmp(r.detalhes_calculo?.origem_cidade), origemRealCmp)) continue;
    const total = safeNum(r.valor_calculado);
    if (total <= 0) continue;
    resultados.push({ transportadora: transp.nome, total, prazo: safeNum(r.detalhes_calculo?.rota_prazo) });
  }
  resultados.sort((a, b) => a.total - b.total);
  return resultados;
}

// Roda o motor para UMA transportadora específica (a atual) — usado para pegar
// o prazo de tabela e o valor que a própria transportadora deveria cobrar.
function calcComTransportadora(cte, base, nome, ibgeOrigemReal, ibgeDestino, cidadeOrigemReal) {
  const canalReal = canalRealDe(cte);
  const cteBase = {
    ...cteComPesoSimulador(cte),
    canal: canalReal,
    canal_original: canalReal,
    ibge_origem: ibgeOrigemReal || '',
    ibge_corrigido_origem: ibgeOrigemReal || '',
    ibge_destino: ibgeDestino || '',
    ibge_corrigido_destino: ibgeDestino || '',
    transportadora: nome,
    nome_transportadora: nome,
  };
  let r;
  try { r = processarCte(cteBase, base, null, nome, OPCOES_MOTOR); } catch { return null; }
  if (r.status_calculo !== 'CALCULADO') return null;
  if (!cidadeBate(normCmp(r.detalhes_calculo?.origem_cidade), normCmp(cidadeOrigemReal))) return null;
  const total = safeNum(r.valor_calculado);
  return { total, prazo: r.detalhes_calculo?.rota_prazo != null ? safeNum(r.detalhes_calculo.rota_prazo) : null };
}

const LIMITES_PADRAO = '6000';

// Política de base igual à do Simulador do realizado (padrão da tela): só os
// tomadores aceitos, sem EBAZAR, sem CPS LOG e sem CP COMERCIAL.
const OPCOES_POLITICA_BASE = { ocultarEbazar: true, incluirCpsLog: false, incluirCpComercial: false, incluirTodosTomadores: false };

// Segunda barreira, como no Simulador do realizado: depois do vínculo/unificação
// o nome pode virar CPS LOG (ou EBAZAR) — esses saem da base.
function nomeExcluidoDaBase(nome) {
  const row = { transportadora: nome };
  return isCpsLogCte(row) || isEbazarCte(row);
}
function aplicarSegundaBarreira(rows, aplicarVinculo) {
  return rows.filter((r) => !nomeExcluidoDaBase(aplicarVinculo(String(r.transportadora || '').trim())));
}

// Busca paginada em realizado_local_ctes por janelas de data de emissão.
// `nomes`: quando informado, só os CT-es com esses nomes de transportadora
// (exatamente como gravados no banco).
async function buscarCtesPaginado({ intervalo, canal, nomes = null, teto, diasPorJanela = 1, onProgress }) {
  const supabase = getSupabaseClient();
  const temPeriodo = Boolean(intervalo.inicio || intervalo.fimExclusivo);
  const janelas = temPeriodo ? janelasEmissao(intervalo, diasPorJanela) : [intervalo];
  const acumulado = [];
  const PAGE = 1000;
  for (const janela of janelas) {
    let from = 0;
    while (acumulado.length < teto) {
      let q = supabase.from('realizado_local_ctes').select('*').order('data_emissao', { ascending: false }).order('id', { ascending: true }).range(from, from + PAGE - 1);
      if (janela.inicio) q = q.gte('data_emissao', janela.inicio);
      if (janela.fimExclusivo) q = q.lt('data_emissao', janela.fimExclusivo);
      if (nomes) q = q.in('transportadora', nomes);
      if (canal) q = q.or(`canal_original.ilike.%${canal}%,canal.ilike.%${canal}%`);
      let resp = await q;
      if (resp.error) resp = await q; // uma nova tentativa em instabilidade/timeout
      const { data, error } = resp;
      if (error) throw new Error(`Erro ao carregar CT-es${janela.inicio ? ` (${janela.inicio})` : ''}: ${error.message}`);
      const lote = data || [];
      acumulado.push(...lote);
      onProgress?.({ carregados: acumulado.length });
      if (lote.length < PAGE) break;
      from += PAGE;
    }
    if (acumulado.length >= teto) break;
  }
  return { linhas: acumulado.slice(0, teto), truncado: acumulado.length >= teto };
}

// Modo antigo (sem mês/período, ou banco sem a função de resumo): baixa os CT-es
// de todas as transportadoras para montar o seletor.
async function carregarCtes({ competencia, dataInicio, dataFim, canal, limite, onProgress }) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const intervalo = intervaloEmissao({ competencia, dataInicio, dataFim });
  const temPeriodo = Boolean(intervalo.inicio || intervalo.fimExclusivo);
  // Com mês/período o recorte vem INTEIRO (como no Simulador do realizado).
  const teto = temPeriodo ? LIMITE_MAX_CT : Math.max(100, Math.min(Number(limite) || 6000, LIMITE_MAX_CT));
  const { linhas, truncado } = await buscarCtesPaginado({ intervalo, canal, teto, diasPorJanela: 1, onProgress });
  const ctes = aplicarPoliticaBaseCte(linhas, OPCOES_POLITICA_BASE);
  return { ctes, brutos: linhas.length, truncado, temPeriodo };
}

// Modo rápido: só o resumo (transportadora × raiz CNPJ × tomador) do período,
// sem baixar CT-es. Retorna null se a função não existir no banco.
async function carregarResumoTransportadoras({ intervalo, canal, onProgress }) {
  const supabase = getSupabaseClient();
  const PAGE = 1000;
  const linhas = [];
  let from = 0;
  for (;;) {
    const q = supabase.rpc('saida_transportadora_resumo', {
      p_inicio: intervalo.inicio, p_fim_exclusivo: intervalo.fimExclusivo, p_canal: canal || null,
    }).range(from, from + PAGE - 1);
    let resp = await q;
    if (resp.error && !funcaoResumoAusente(resp.error)) resp = await q;
    if (resp.error) {
      if (funcaoResumoAusente(resp.error)) return null;
      throw new Error(`Erro ao listar transportadoras do período: ${resp.error.message}`);
    }
    const lote = resp.data || [];
    linhas.push(...lote);
    onProgress?.({ linhas: linhas.length });
    if (lote.length < PAGE) break;
    from += PAGE;
  }
  return linhas.map((r) => ({
    transportadora: r.transportadora,
    cnpj_transportadora: r.raiz_cnpj || '',
    tomador_servico: r.tomador_servico,
    cnpj_tomador: r.cnpj_tomador,
    __qtdCtes: safeNum(r.ctes),
    __valorCte: safeNum(r.valor_cte),
  }));
}
function funcaoResumoAusente(error) {
  const txt = `${error?.code || ''} ${error?.message || ''}`;
  return /PGRST202|42883|saida_transportadora_resumo|could not find the function/i.test(txt);
}

// Lista de transportadoras com busca por nome e ordenação (valor, CT-es, A-Z).
function SeletorTransportadora({ grupos, totais, valor, onChange }) {
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState('valor');
  const linhas = useMemo(() => {
    const termo = normCmp(busca);
    const lista = grupos
      .filter((g) => !termo || normCmp(g.nome).includes(termo) || g.variantes.some((v) => normCmp(v).includes(termo)))
      .map((g) => ({ ...g, total: totais?.get(g.nome) || { ctes: g.ctes || 0, valor: 0 } }));
    if (ordem === 'valor') lista.sort((a, b) => (b.total.valor - a.total.valor) || a.nome.localeCompare(b.nome, 'pt-BR'));
    else if (ordem === 'ctes') lista.sort((a, b) => (b.total.ctes - a.total.ctes) || a.nome.localeCompare(b.nome, 'pt-BR'));
    else lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return lista;
  }, [grupos, totais, busca, ordem]);
  const thS = { textAlign: 'left', padding: '6px 10px', fontSize: '0.72rem', color: '#64748b', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, background: '#f8fafc' };
  const tdS = { padding: '6px 10px', fontSize: '0.82rem', borderBottom: '1px solid #f1f5f9' };
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
        <input
          type="search"
          placeholder="Buscar transportadora (nome ou nome no CT-e)..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ flex: '1 1 280px', minWidth: 220 }}
        />
        <select value={ordem} onChange={(e) => setOrdem(e.target.value)} style={{ width: 'auto' }}>
          <option value="valor">Maior valor pago</option>
          <option value="ctes">Mais CT-es</option>
          <option value="nome">Nome (A-Z)</option>
        </select>
        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{fmtN(linhas.length)} de {fmtN(grupos.length)}</span>
      </div>
      <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thS}>Transportadora</th>
              <th style={{ ...thS, textAlign: 'right' }}>CT-es</th>
              <th style={{ ...thS, textAlign: 'right' }}>Valor pago</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((g) => {
              const sel = g.nome === valor;
              return (
                <tr
                  key={g.nome}
                  onClick={() => onChange(g.nome)}
                  style={{ cursor: 'pointer', background: sel ? '#e0f2fe' : undefined }}
                >
                  <td style={{ ...tdS, fontWeight: sel ? 700 : 400 }}>
                    {g.nome}
                    {g.variantes.length > 1 && <span style={{ marginLeft: 6, fontSize: '0.7rem', color: '#94a3b8' }}>{g.variantes.length} nomes no CT-e</span>}
                  </td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{fmtN(g.total.ctes)}</td>
                  <td style={{ ...tdS, textAlign: 'right' }}>{fmt(g.total.valor)}</td>
                </tr>
              );
            })}
            {!linhas.length && (
              <tr><td colSpan={3} style={{ ...tdS, color: '#94a3b8' }}>Nenhuma transportadora encontrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, valor, sub, cor, destaque, onClick, ativo }) {
  const clicavel = typeof onClick === 'function';
  return (
    <div
      onClick={onClick}
      role={clicavel ? 'button' : undefined}
      tabIndex={clicavel ? 0 : undefined}
      onKeyDown={clicavel ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      title={clicavel ? (ativo ? 'Clique para mostrar todas as rotas' : 'Clique para ver só estas rotas') : undefined}
      style={{
        background: ativo ? '#eff6ff' : '#fff',
        border: `${ativo ? 2 : 1}px solid ${ativo ? '#1d4ed8' : (destaque ? cor : '#e2e8f0')}`,
        borderLeft: `4px solid ${cor}`, borderRadius: 10, padding: '12px 18px', minWidth: 0,
        cursor: clicavel ? 'pointer' : 'default', boxShadow: ativo ? '0 0 0 3px #bfdbfe' : undefined,
      }}
    >
      <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '1.45rem', fontWeight: 800, color: destaque ? cor : '#1e293b' }}>{valor}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Agrega os CT-es simulados em rotas, aplicando o conjunto de substitutas excluídas.
// Pura: roda na hora quando muda a exclusão ou o reajuste, sem reprocessar o motor.
// usarTabelaNova: o custo "mantendo a transportadora" de cada CT-e é o valor
// pago × (tabela nova ÷ tabela atual), com as duas calculadas do mesmo jeito —
// o aumento real da tabela naquela rota/peso, aplicado ao que se paga hoje.
// (Comparar a tabela nova direto com o pago mistura o aumento com a diferença
// que já existe entre pago e tabela.) CT-e sem as duas tabelas usa o percentual.
function agregarRotas(ctesSimulados, exclusoesSet, pctReajuste, usarTabelaNova = false) {
  const fatorPct = 1 + safeNum(pctReajuste) / 100;
  const tn = { ctes: 0, pago: 0, nova: 0, atualTabela: 0, novaComAtual: 0, ctesComNova: 0, pagoComNova: 0, novaBruta: 0 };
  const porRota = new Map();
  for (const c of ctesSimulados) {
    if (!porRota.has(c.rotaKey)) {
      porRota.set(c.rotaKey, {
        rotaKey: c.rotaKey, cidadeOrigem: c.cidadeOrigem, ufOrigem: c.ufOrigem, cidadeDestino: c.cidadeDestino, ufDestino: c.ufDestino,
        ctes: 0, valorPagoTotal: 0, melhorTotal: 0, semSubstituto: 0, candidatosUsados: new Map(),
        prazoAtualSoma: 0, prazoAtualN: 0, prazoSubSoma: 0, prazoSubN: 0, viagens: [], substitutosRota: new Map(),
        valorReajustadoTotal: 0, ctesTabelaNova: 0,
      });
    }
    const rota = porRota.get(c.rotaKey);
    rota.ctes += 1;
    rota.valorPagoTotal += c.valorPago;
    const temNova = usarTabelaNova && c.valorNovaTabela != null && c.valorTabelaAtual != null && c.valorTabelaAtual > 0;
    const fatorTabela = temNova ? c.valorNovaTabela / c.valorTabelaAtual : null;
    const valorReajustado = temNova ? c.valorPago * fatorTabela : c.valorPago * fatorPct;
    rota.valorReajustadoTotal += valorReajustado;
    if (usarTabelaNova && c.valorNovaTabela != null) { tn.ctesComNova += 1; tn.pagoComNova += c.valorPago; tn.novaBruta += c.valorNovaTabela; }
    if (temNova) {
      rota.ctesTabelaNova += 1;
      tn.ctes += 1; tn.pago += c.valorPago; tn.nova += valorReajustado;
      tn.atualTabela += c.valorTabelaAtual; tn.novaComAtual += c.valorNovaTabela;
    }
    if (c.prazoAtual != null) { rota.prazoAtualSoma += c.prazoAtual; rota.prazoAtualN += 1; }

    const disponiveis = exclusoesSet.size
      ? c.resultados.filter((r) => !exclusoesSet.has(norm(r.transportadora)))
      : c.resultados;
    for (const res of disponiveis) {
      const cur = rota.substitutosRota.get(res.transportadora)
        || { transportadora: res.transportadora, ctesCobertos: 0, somaTotal: 0, prazoSoma: 0, prazoN: 0 };
      cur.ctesCobertos += 1; cur.somaTotal += res.total;
      if (res.prazo != null) { cur.prazoSoma += res.prazo; cur.prazoN += 1; }
      rota.substitutosRota.set(res.transportadora, cur);
    }
    const melhor = disponiveis[0] || null;
    if (melhor) {
      rota.melhorTotal += melhor.total;
      rota.candidatosUsados.set(melhor.transportadora, (rota.candidatosUsados.get(melhor.transportadora) || 0) + 1);
      if (melhor.prazo != null) { rota.prazoSubSoma += melhor.prazo; rota.prazoSubN += 1; }
    } else {
      rota.melhorTotal += c.valorPago;
      rota.semSubstituto += 1;
    }
    rota.viagens.push({
      chave: c.chave, data: c.data, nf: c.nf, peso: c.peso, valorPago: c.valorPago,
      valorTabelaAtual: c.valorTabelaAtual, prazoAtual: c.prazoAtual,
      valorReajustado, valorNovaTabela: temNova ? c.valorNovaTabela : null,
      substituta: melhor ? melhor.transportadora : null,
      valorSub: melhor ? melhor.total : null,
      prazoSub: melhor ? melhor.prazo : null,
    });
  }

  const linhas = Array.from(porRota.values()).map((r) => {
    const substitutos = [...r.substitutosRota.values()].map((s) => ({
      transportadora: s.transportadora, ctesCobertos: s.ctesCobertos,
      custoMedio: s.ctesCobertos ? s.somaTotal / s.ctesCobertos : 0,
      prazoMedio: s.prazoN ? s.prazoSoma / s.prazoN : null,
    })).sort((a, b) => (b.ctesCobertos - a.ctesCobertos) || (a.custoMedio - b.custoMedio));
    return {
      ...r,
      diferenca: r.melhorTotal - r.valorPagoTotal,
      substitutoPrincipal: [...r.candidatosUsados.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      prazoAtualMedio: r.prazoAtualN ? r.prazoAtualSoma / r.prazoAtualN : null,
      prazoSubMedio: r.prazoSubN ? r.prazoSubSoma / r.prazoSubN : null,
      substitutos, qtdSubstitutos: substitutos.length,
    };
  });
  linhas.sort((a, b) => b.valorPagoTotal - a.valorPagoTotal);

  const custoAtual = linhas.reduce((s, l) => s + l.valorPagoTotal, 0);
  const custoComSubstitutos = linhas.reduce((s, l) => s + l.melhorTotal, 0);
  const rotasSemSubstituto = linhas.filter((l) => l.semSubstituto > 0).length;
  const pctR = safeNum(pctReajuste);
  const custoComReajuste = linhas.reduce((s, l) => s + l.valorReajustadoTotal, 0);
  const pctReajusteEfetivo = custoAtual > 0 ? (custoComReajuste / custoAtual - 1) * 100 : pctR;
  const aumentoPctSubstitutos = custoAtual > 0 ? ((custoComSubstitutos - custoAtual) / custoAtual) * 100 : 0;
  const economiaVsReajuste = custoComReajuste - custoComSubstitutos;
  const prazoAtualSomaTot = linhas.reduce((s, l) => s + l.prazoAtualSoma, 0);
  const prazoAtualNTot = linhas.reduce((s, l) => s + l.prazoAtualN, 0);
  const prazoSubSomaTot = linhas.reduce((s, l) => s + l.prazoSubSoma, 0);
  const prazoSubNTot = linhas.reduce((s, l) => s + l.prazoSubN, 0);

  return {
    linhas, totalRotas: linhas.length, rotasSemSubstituto,
    custoAtual, custoComSubstitutos, custoComReajuste, aumentoPctSubstitutos, economiaVsReajuste, pctReajuste: pctR, pctReajusteEfetivo,
    tabelaNova: usarTabelaNova ? {
      ...tn,
      // aumento aplicado (pago × nova/atual), aumento tabela × tabela e, só
      // para referência, a tabela nova crua contra o valor pago
      pctAplicado: tn.pago > 0 ? (tn.nova / tn.pago - 1) * 100 : null,
      pctSobreTabelaAtual: tn.atualTabela > 0 ? (tn.novaComAtual / tn.atualTabela - 1) * 100 : null,
      pctNovaCruaSobrePago: tn.pagoComNova > 0 ? (tn.novaBruta / tn.pagoComNova - 1) * 100 : null,
    } : null,
    prazoAtualMedioGeral: prazoAtualNTot ? prazoAtualSomaTot / prazoAtualNTot : null,
    prazoSubMedioGeral: prazoSubNTot ? prazoSubSomaTot / prazoSubNTot : null,
  };
}

// Situações das rotas (mesmas do laudo) — usadas pelos cards clicáveis.
const SITUACOES_ROTA = {
  sem: { rotulo: 'Sem substituto', teste: (l) => l.qtdSubstitutos === 0 || l.semSubstituto > 0 },
  cara: { rotulo: 'Substituta mais cara', teste: (l) => l.qtdSubstitutos > 0 && !l.semSubstituto && l.diferenca > TOLERANCIA },
  barata: { rotulo: 'Substituta mais barata', teste: (l) => l.qtdSubstitutos > 0 && !l.semSubstituto && l.diferenca < -TOLERANCIA },
  prazo: { rotulo: 'Prazo maior', teste: (l) => l.prazoAtualMedio != null && l.prazoSubMedio != null && l.prazoSubMedio - l.prazoAtualMedio > 0.05 },
  unica: { rotulo: 'Substituta única', teste: (l) => l.qtdSubstitutos === 1 },
};

// Totais de um conjunto de rotas (para os cards de valor seguirem a seleção).
function totaisDasRotas(linhas, pctReajuste) {
  let ctes = 0; let atual = 0; let sub = 0; let paS = 0; let paN = 0; let psS = 0; let psN = 0;
  for (const l of linhas) {
    ctes += l.ctes; atual += l.valorPagoTotal; sub += l.melhorTotal;
    paS += l.prazoAtualSoma; paN += l.prazoAtualN; psS += l.prazoSubSoma; psN += l.prazoSubN;
  }
  const reajuste = linhas.reduce((acc, l) => acc + (l.valorReajustadoTotal ?? l.valorPagoTotal * (1 + safeNum(pctReajuste) / 100)), 0);
  return {
    rotas: linhas.length, ctes, custoAtual: atual, custoComSubstitutos: sub, custoComReajuste: reajuste,
    economiaVsReajuste: reajuste - sub,
    aumentoPctSubstitutos: atual > 0 ? ((sub - atual) / atual) * 100 : 0,
    prazoAtual: paN ? paS / paN : null, prazoSub: psN ? psS / psN : null,
  };
}

function FiltroExcluir({ opcoes, exclusoes, onToggle, onLimpar }) {
  if (!opcoes.length) return null;
  return (
    <details className="sst-filtro">
      <summary className="sim-tab" style={{ cursor: 'pointer', listStyle: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        Excluir substitutas{exclusoes.size ? ` · ${exclusoes.size}` : ''} ▾
      </summary>
      <div className="sst-filtro-pop">
        <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 6 }}>
          Marque quem você NÃO quer como substituta. A simulação recalcula com a próxima melhor opção.
        </div>
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {opcoes.map((nome) => (
            <label key={nome} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 2px', fontSize: '0.8rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={exclusoes.has(norm(nome))} onChange={() => onToggle(nome)} />
              {nome}
            </label>
          ))}
        </div>
        {exclusoes.size > 0 && (
          <button type="button" className="sim-tab" onClick={onLimpar} style={{ marginTop: 8, fontSize: '0.75rem', padding: '2px 10px' }}>Limpar exclusões</button>
        )}
      </div>
    </details>
  );
}

function DetalheRota({ linha }) {
  const MAX_VIAGENS = 200;
  const viagens = linha.viagens || [];
  const mostradas = viagens.slice(0, MAX_VIAGENS);
  const thStyle = { textAlign: 'left', padding: '4px 8px', fontSize: '0.72rem', color: '#64748b', borderBottom: '1px solid #e2e8f0' };
  const tdStyle = { padding: '4px 8px', fontSize: '0.78rem', borderBottom: '1px solid #f1f5f9' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#334155', marginBottom: 6 }}>
          Transportadoras que cobrem esta rota ({linha.qtdSubstitutos})
        </div>
        {linha.qtdSubstitutos === 0
          ? <div style={{ fontSize: '0.8rem', color: '#9b1111' }}>Nenhuma transportadora cadastrada cobre esta rota.</div>
          : (
            <table style={{ width: '100%', maxWidth: 680, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Transportadora</th>
                  <th style={thStyle}>Cobertura</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Custo médio/CT-e</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Prazo</th>
                </tr>
              </thead>
              <tbody>
                {linha.substitutos.map((s) => {
                  const principal = s.transportadora === linha.substitutoPrincipal;
                  const full = s.ctesCobertos >= linha.ctes;
                  return (
                    <tr key={s.transportadora}>
                      <td style={{ ...tdStyle, fontWeight: principal ? 700 : 400 }}>
                        {s.transportadora}
                        {principal && <span style={{ marginLeft: 6, color: '#04C7A4', fontSize: '0.68rem', fontWeight: 700 }}>★ principal</span>}
                      </td>
                      <td style={{ ...tdStyle, color: full ? '#047857' : '#b45309' }}>{fmtN(s.ctesCobertos)}/{fmtN(linha.ctes)} CT-es</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(s.custoMedio)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtDias(s.prazoMedio)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </div>

      <div>
        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#334155', marginBottom: 6 }}>
          Viagens ({fmtN(viagens.length)}{viagens.length > MAX_VIAGENS ? ` — mostrando as ${MAX_VIAGENS} primeiras` : ''})
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Emissão</th>
                <th style={thStyle}>CT-e</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>NF</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Peso</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Pago</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Tabela atual</th>
                <th style={thStyle}>Substituta</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Valor subst.</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Prazo at./sub.</th>
              </tr>
            </thead>
            <tbody>
              {mostradas.map((v, i) => (
                <tr key={v.chave || i}>
                  <td style={tdStyle}>{fmtData(v.data)}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.72rem' }}>{chaveCurta(v.chave)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(v.nf)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtN(v.peso)} kg</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(v.valorPago)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: '#94a3b8' }}>{v.valorTabelaAtual != null ? fmt(v.valorTabelaAtual) : '—'}</td>
                  <td style={tdStyle}>{v.substituta || <span style={{ color: '#9b1111' }}>nenhum</span>}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: v.valorSub != null && v.valorSub < v.valorPago ? '#047857' : '#1e293b', fontWeight: 600 }}>{v.valorSub != null ? fmt(v.valorSub) : '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtDias(v.prazoAtual)} / {fmtDias(v.prazoSub)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function SimularSaidaTransportadoraPage() {
  const [competencia, setCompetencia] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [canal, setCanal] = useState('');
  const [limiteInput, setLimiteInput] = useState(LIMITES_PADRAO);

  const [statusCarga, setStatusCarga] = useState('idle');
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const [base, setBase] = useState(null); // { ctes, municipioPorCidade, mapasIbge, mapaVinculos }

  const [transportadora, setTransportadora] = useState('');
  const [reajustePct, setReajustePct] = useState('20');
  // Comparar com: 'pct' (percentual informado) ou 'tabela' (tabela em negociação cadastrada).
  const [modoReajuste, setModoReajuste] = useState('pct');
  const [capasNeg, setCapasNeg] = useState(null);
  const [carregandoCapas, setCarregandoCapas] = useState(false);
  const [negSelecionadas, setNegSelecionadas] = useState(() => new Set());
  const [mostrarTodasNeg, setMostrarTodasNeg] = useState(false);
  // Reajuste dos CT-es sem cálculo nas duas tabelas (modo tabela nova).
  // Vazio = automático: o aumento médio que a tabela nova deu nos CT-es que calculou.
  const [pctForaTabela, setPctForaTabela] = useState('');
  const [statusSim, setStatusSim] = useState('idle');
  const [simulacao, setSimulacao] = useState(null); // { transportadora, ctesSimulados, semIbge }
  const [exclusoes, setExclusoes] = useState(() => new Set()); // norm(nome) das substitutas excluídas
  const [rotasAbertas, setRotasAbertas] = useState(() => new Set());

  function toggleRota(rotaKey) {
    setRotasAbertas((prev) => {
      const next = new Set(prev);
      if (next.has(rotaKey)) next.delete(rotaKey); else next.add(rotaKey);
      return next;
    });
  }

  function toggleExcluir(nome) {
    setExclusoes((prev) => {
      const next = new Set(prev);
      const k = norm(nome);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  // Filtros de origem/destino sobre o resultado: cards, rotas e laudo seguem o recorte.
  const [filtroRota, setFiltroRota] = useState({ ufOrigem: '', origem: '', ufDestino: '', destino: '' });
  const filtroAtivo = Boolean(filtroRota.ufOrigem || filtroRota.origem || filtroRota.ufDestino || filtroRota.destino);
  const opcoesFiltroRota = useMemo(() => {
    const ufO = new Set(); const ufD = new Set(); const cidO = new Map(); const cidD = new Map();
    for (const c of simulacao?.ctesSimulados || []) {
      if (c.ufOrigem) ufO.add(c.ufOrigem);
      if (c.ufDestino) ufD.add(c.ufDestino);
      if (!filtroRota.ufOrigem || c.ufOrigem === filtroRota.ufOrigem) cidO.set(rotuloLocal(c.cidadeOrigem, c.ufOrigem), true);
      if (!filtroRota.ufDestino || c.ufDestino === filtroRota.ufDestino) cidD.set(rotuloLocal(c.cidadeDestino, c.ufDestino), true);
    }
    const ord = (arr) => [...arr].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return { ufOrigem: ord(ufO), ufDestino: ord(ufD), origem: ord(cidO.keys()), destino: ord(cidD.keys()) };
  }, [simulacao, filtroRota.ufOrigem, filtroRota.ufDestino]);
  const ctesFiltrados = useMemo(() => {
    const lista = simulacao?.ctesSimulados || [];
    if (!filtroAtivo) return lista;
    return lista.filter((c) => (
      (!filtroRota.ufOrigem || c.ufOrigem === filtroRota.ufOrigem)
      && (!filtroRota.origem || rotuloLocal(c.cidadeOrigem, c.ufOrigem) === filtroRota.origem)
      && (!filtroRota.ufDestino || c.ufDestino === filtroRota.ufDestino)
      && (!filtroRota.destino || rotuloLocal(c.cidadeDestino, c.ufDestino) === filtroRota.destino)
    ));
  }, [simulacao, filtroRota, filtroAtivo]);
  const descricaoFiltroRota = [
    filtroRota.origem ? `Origem ${filtroRota.origem}` : (filtroRota.ufOrigem ? `Origem UF ${filtroRota.ufOrigem}` : ''),
    filtroRota.destino ? `Destino ${filtroRota.destino}` : (filtroRota.ufDestino ? `Destino UF ${filtroRota.ufDestino}` : ''),
  ].filter(Boolean).join(' • ');

  const [filtroCard, setFiltroCard] = useState('');
  // Aumento médio tabela nova × tabela atual em todos os CT-es simulados (sem
  // filtros de tela, para o padrão não mudar ao filtrar origem/destino).
  const pctMediaTabelaNova = useMemo(() => {
    if (!simulacao?.tabelaNova) return null;
    let atual = 0; let nova = 0;
    for (const c of simulacao.ctesSimulados) {
      if (c.valorNovaTabela != null && c.valorTabelaAtual > 0) { atual += c.valorTabelaAtual; nova += c.valorNovaTabela; }
    }
    return atual > 0 ? (nova / atual - 1) * 100 : null;
  }, [simulacao]);
  const pctForaAutomatico = String(pctForaTabela).trim() === '';
  const pctForaEfetivo = pctForaAutomatico ? (pctMediaTabelaNova ?? safeNum(reajustePct)) : safeNum(pctForaTabela);
  const resultado = useMemo(() => {
    if (!simulacao) return null;
    return {
      ...agregarRotas(ctesFiltrados, exclusoes, simulacao.tabelaNova ? pctForaEfetivo : reajustePct, Boolean(simulacao.tabelaNova)),
      totalCtes: ctesFiltrados.length,
      totalCtesSemFiltro: simulacao.ctesSimulados.length,
      semIbge: simulacao.semIbge,
      pesoTrackingInfo: simulacao.pesoTrackingInfo || null,
    };
  }, [simulacao, ctesFiltrados, exclusoes, reajustePct, pctForaEfetivo]);

  const contagemSituacoes = useMemo(() => {
    const out = {};
    for (const [k, def] of Object.entries(SITUACOES_ROTA)) {
      const lista = (resultado?.linhas || []).filter(def.teste);
      out[k] = { rotas: lista.length, ctes: lista.reduce((acc, l) => acc + l.ctes, 0), valor: lista.reduce((acc, l) => acc + l.valorPagoTotal, 0) };
    }
    return out;
  }, [resultado]);
  const linhasVisiveis = useMemo(() => {
    const linhas = resultado?.linhas || [];
    const def = SITUACOES_ROTA[filtroCard];
    return def ? linhas.filter(def.teste) : linhas;
  }, [resultado, filtroCard]);
  const totaisSel = useMemo(() => totaisDasRotas(linhasVisiveis, reajustePct), [linhasVisiveis, reajustePct]);
  // Mesmo cálculo do laudo: por origem, trocar tudo × trocar só onde compensa × reajuste.
  const porOrigem = useMemo(
    () => resumirPorOrigem((resultado?.linhas || []).map((l) => analisarRota(l, reajustePct))),
    [resultado, reajustePct],
  );
  const alternarOrigem = (origem) => setFiltroRota((f) => (
    f.origem === origem ? { ...f, origem: '' } : { ...f, ufOrigem: '', origem }
  ));
  const alternarCard = (k) => setFiltroCard((atual) => (atual === k ? '' : k));

  const opcoesExcluir = useMemo(() => {
    if (!simulacao) return [];
    const set = new Set();
    for (const c of simulacao.ctesSimulados) for (const r of c.resultados) set.add(r.transportadora);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [simulacao]);

  const [exportando, setExportando] = useState('');

  function contextoLaudo() {
    const r = simulacao?.recorte || {};
    const periodo = (r.dataInicio || r.dataFim)
      ? `${r.dataInicio ? fmtData(`${r.dataInicio}T12:00:00`) : '…'} a ${r.dataFim ? fmtData(`${r.dataFim}T12:00:00`) : '…'}`
      : (r.competencia ? `Competência ${r.competencia.slice(5, 7)}/${r.competencia.slice(0, 4)}` : 'Últimos CT-es carregados (sem filtro de período)');
    return {
      transportadora: simulacao?.transportadora || transportadora,
      variantes: simulacao?.variantes || [],
      periodo,
      canal: r.canal || '',
      reajustePct: reajustePct,
      exclusoes: opcoesExcluir.filter((n) => exclusoes.has(norm(n))),
      filtroRotas: descricaoFiltroRota,
      reajusteRotulo: simulacao?.tabelaNova
        ? `tabela nova ${simulacao.tabelaNova.rotulos.join(' + ')}${resultado?.tabelaNova?.pctSobreTabelaAtual != null ? ` (${resultado.tabelaNova.pctSobreTabelaAtual >= 0 ? '+' : ''}${pct(resultado.tabelaNova.pctSobreTabelaAtual)} sobre a tabela atual, aplicado ao valor pago de cada CT-e)` : ''}${resultado?.tabelaNova && resultado.tabelaNova.ctes < resultado.totalCtes ? `; CT-es sem cálculo nas duas tabelas com ${pctForaEfetivo >= 0 ? '+' : ''}${pct(pctForaEfetivo)}${pctForaAutomatico ? ' (média da tabela nova)' : ''}` : ''}`
        : '',
      geradoEm: new Date().toISOString(),
    };
  }

  async function exportarLaudo(tipo) {
    if (!resultado) return;
    setExportando(tipo); setErro('');
    try {
      if (tipo === 'pdf') abrirLaudoSaida(resultado, contextoLaudo());
      else await exportarExcelLaudoSaida(resultado, contextoLaudo());
    } catch (e) {
      console.error('[SimularSaidaTransportadora] exportar laudo', e);
      setErro(e?.message || 'Falha ao gerar o laudo.');
    } finally {
      setExportando('');
    }
  }

  async function carregar() {
    setStatusCarga('carregando'); setErro(''); setBase(null); setSimulacao(null); setExclusoes(new Set()); setTransportadora('');
    try {
      setProgresso('Carregando planilha de IBGE...');
      const municipios = await carregarMunicipiosIbgeDb().catch(() => []);
      const mapasIbge = montarMapasIbge(municipios);
      const municipioPorCidade = montarMunicipioPorCidade(municipios);
      const municipioPorIbge = montarMunicipioPorIbge(municipios);

      // vínculos: unificam o nome da transportadora executada (ex.: 3 "Brasil Web" viram 1)
      const vinculos = await carregarVinculosTransportadoras().catch(() => []);
      const mapaVinculos = criarMapaVinculosTransportadoras(vinculos);
      // cadastro com raízes de CNPJ: une nomes diferentes da mesma empresa no CT-e
      const cadastro = await carregarCadastroCnpjTransportadorasDb().catch((e) => { console.warn('[SimularSaidaTransportadora] cadastro CNPJ indisponível', e); return []; });

      const aplicarVinculo = (n) => aplicarVinculoPuro(n, mapaVinculos);
      const intervalo = intervaloEmissao({ competencia, dataInicio, dataFim });
      const temPeriodo = Boolean(intervalo.inicio && intervalo.fimExclusivo);

      // Modo rápido: com mês/período, lista as transportadoras pelo resumo do
      // banco (sem baixar CT-es). Os CT-es só vêm depois, os da escolhida.
      if (temPeriodo) {
        setProgresso('Listando transportadoras do período...');
        const resumoBruto = await carregarResumoTransportadoras({
          intervalo,
          canal: canal || '',
          onProgress: ({ linhas }) => setProgresso(`Listando transportadoras do período... ${fmtN(linhas)} grupo(s)`),
        });
        if (resumoBruto) {
          const resumoPolitica = aplicarSegundaBarreira(aplicarPoliticaBaseCte(resumoBruto, OPCOES_POLITICA_BASE), aplicarVinculo);
          const unificacaoPolitica = unificarTransportadorasCtes(resumoPolitica, { aplicarVinculo, cadastro });
          const resumo = resumoPolitica.filter((r) => !nomeExcluidoDaBase(unificacaoPolitica.nomeDoCte(r)));
          if (!resumo.length) throw new Error('Nenhum CT-e encontrado para este recorte.');
          const unificacao = unificarTransportadorasCtes(resumo, { aplicarVinculo, cadastro });
          // nomes exatamente como estão no banco, por transportadora unificada —
          // é por eles que os CT-es da escolhida são buscados depois.
          const nomesBancoPorGrupo = new Map();
          const totaisPorGrupo = new Map();
          for (const row of resumo) {
            const nome = unificacao.nomeDoCte(row);
            if (!nomesBancoPorGrupo.has(nome)) nomesBancoPorGrupo.set(nome, new Set());
            nomesBancoPorGrupo.get(nome).add(row.transportadora);
            const t = totaisPorGrupo.get(nome) || { ctes: 0, valor: 0 };
            t.ctes += row.__qtdCtes; t.valor += row.__valorCte;
            totaisPorGrupo.set(nome, t);
          }
          const totalCtes = resumo.reduce((acc, r) => acc + r.__qtdCtes, 0);
          const brutos = resumoBruto.reduce((acc, r) => acc + r.__qtdCtes, 0);
          setBase({
            modo: 'resumo', intervalo, municipioPorCidade, municipioPorIbge, mapasIbge, mapaVinculos, unificacao,
            nomesBancoPorGrupo, totaisPorGrupo,
            carga: { totalCtes, brutos, truncado: false, temPeriodo: true },
          });
          setStatusCarga('concluido'); setProgresso('');
          return;
        }
        console.warn('[SimularSaidaTransportadora] função saida_transportadora_resumo ausente — usando carga completa.');
      }

      setProgresso('Carregando CT-es...');
      const carga = await carregarCtes({
        competencia,
        dataInicio: dataInicio || undefined,
        dataFim: dataFim || undefined,
        canal: canal || undefined,
        limite: Number(limiteInput) || 6000,
        onProgress: ({ carregados }) => setProgresso(`Carregando CT-es... ${fmtN(carregados)}`),
      });
      const ctesPolitica = aplicarSegundaBarreira(carga.ctes, aplicarVinculo);
      const unificacaoPolitica = unificarTransportadorasCtes(ctesPolitica, { aplicarVinculo, cadastro });
      const ctes = ctesPolitica.filter((c) => !nomeExcluidoDaBase(unificacaoPolitica.nomeDoCte(c)));
      if (!ctes.length) throw new Error('Nenhum CT-e encontrado para este recorte.');

      // A tabela de frete só é buscada depois, quando a transportadora a
      // avaliar for escolhida — aí sim buscamos só as rotas dela (ver
      // simularSaida), em vez de carregar a base inteira (rotas tem ~1,3M
      // linhas e isso deixava a tela lenta/travando com timeout).
      const unificacao = unificarTransportadorasCtes(ctes, { aplicarVinculo, cadastro });
      const totaisPorGrupo = new Map();
      for (const c of ctes) {
        const nome = unificacao.nomeDoCte(c);
        const t = totaisPorGrupo.get(nome) || { ctes: 0, valor: 0 };
        t.ctes += 1; t.valor += safeNum(c.valor_cte || c.frete_pago || c.valor_frete);
        totaisPorGrupo.set(nome, t);
      }
      setBase({ modo: 'completo', ctes, municipioPorCidade, municipioPorIbge, mapasIbge, mapaVinculos, unificacao, totaisPorGrupo, carga: { ...carga, totalCtes: ctes.length } });
      setStatusCarga('concluido'); setProgresso('');
    } catch (e) {
      console.error('[SimularSaidaTransportadora]', e);
      setErro(e?.message || 'Falha ao carregar os CT-es (possível instabilidade no Supabase). Tente novamente.');
      setStatusCarga('erro'); setProgresso('');
    }
  }

  // Uma entrada por empresa: nomes do CT-e unificados pela raiz do CNPJ (cadastro
  // da tabela + chave do CT-e) e pelos vínculos (ex.: "LTSL BAHIA ..." + "LTSL ENCOMENDAS").
  const transportadoras = useMemo(() => (base?.unificacao?.grupos || []), [base]);
  const grupoSelecionado = useMemo(
    () => transportadoras.find((g) => g.nome === transportadora) || null,
    [transportadoras, transportadora],
  );

  // Tabelas em negociação (capas) — carregadas uma vez, quando o usuário
  // escolhe comparar com uma tabela nova.
  async function garantirCapasNegociacao() {
    if (capasNeg || carregandoCapas) return;
    setCarregandoCapas(true);
    try {
      const capas = await listarCapasNegociacaoParaSimulacao({ tipoTabela: 'FRACIONADO', incluirTodas: true });
      setCapasNeg(marcarDesambiguacaoNegociacoesSimulador(capas || []));
    } catch (e) {
      console.error('[SimularSaidaTransportadora] negociações', e);
      setErro(`Não foi possível carregar as tabelas em negociação: ${e?.message || e}`);
      setCapasNeg([]);
    } finally {
      setCarregandoCapas(false);
    }
  }
  // Negociações da transportadora escolhida (nome da negociação ou nome base
  // batendo com o nome unificado, nomes do CT-e ou nomes de tabela dela).
  const capasDaTransportadora = useMemo(() => {
    const lista = capasNeg || [];
    if (mostrarTodasNeg || !transportadora) return lista;
    const nomes = [transportadora, ...(grupoSelecionado?.nomesTabela || []), ...(grupoSelecionado?.variantes || [])]
      .map(norm).filter((n) => n.length >= 3);
    const bate = (nome) => {
      const n = norm(nome);
      if (n.length < 3) return false;
      return nomes.some((x) => x === n || (n.length >= 4 && x.startsWith(n)) || (x.length >= 4 && n.startsWith(x)));
    };
    return lista.filter((c) => bate(c.transportadora) || bate(c.transportadora_base_nome));
  }, [capasNeg, mostrarTodasNeg, transportadora, grupoSelecionado]);
  function toggleNeg(id) {
    setNegSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Vindo do Simulador (botão "Simular saída da transportadora"): roda sozinho
  // carregar período -> escolher transportadora -> marcar a tabela nova -> simular.
  const autoRef = useRef(null); // { etapa, transportadoras: [nomes], negociacaoId, negociacaoLabel }
  const [autoAviso, setAutoAviso] = useState('');
  useEffect(() => {
    const h = consumirHandoffSaidaTransportadora();
    if (!h) return;
    autoRef.current = { etapa: 'carregar', nomes: [h.transportadora].filter(Boolean), negociacaoId: h.negociacaoId || '', negociacaoLabel: h.negociacaoLabel || '' };
    setCompetencia(''); setDataInicio(h.dataInicio || ''); setDataFim(h.dataFim || ''); setCanal(h.canal || '');
    setAutoAviso(`Aberto pelo Simulador: ${h.transportadora || 'transportadora'}${h.negociacaoLabel ? ` × ${h.negociacaoLabel}` : ''}${h.dataInicio ? ` · ${h.dataInicio} a ${h.dataFim}` : ''}${h.canal ? ` · ${h.canal}` : ''}.`);
  }, []);
  useEffect(() => {
    const auto = autoRef.current;
    if (!auto) return;
    if (auto.etapa === 'carregar' && statusCarga === 'idle' && (dataInicio || dataFim)) {
      auto.etapa = 'escolher';
      carregar();
      return;
    }
    if (auto.etapa === 'escolher' && statusCarga === 'erro') { autoRef.current = null; return; }
    if (auto.etapa === 'escolher' && statusCarga === 'concluido' && base) {
      const nomesNeg = (capasNeg || []).filter((c) => c.id === auto.negociacaoId).flatMap((c) => [c.transportadora, c.transportadora_base_nome]);
      const grupo = escolherGrupoTransportadora(transportadoras, [...auto.nomes, ...nomesNeg], norm);
      if (!grupo) {
        if (!capasNeg && auto.negociacaoId) { garantirCapasNegociacao(); return; }
        setAutoAviso((a) => `${a} Não encontrei a transportadora no período — escolha na lista abaixo.`);
        autoRef.current = null;
        return;
      }
      auto.etapa = 'tabela';
      setTransportadora(grupo.nome);
      if (auto.negociacaoId) {
        setModoReajuste('tabela');
        setNegSelecionadas(new Set([auto.negociacaoId]));
        garantirCapasNegociacao();
      }
      return;
    }
    if (auto.etapa === 'tabela' && transportadora && (!auto.negociacaoId || (capasNeg && negSelecionadas.has(auto.negociacaoId)))) {
      if (auto.negociacaoId && !(capasNeg || []).some((c) => c.id === auto.negociacaoId)) {
        setAutoAviso((a) => `${a} A tabela em negociação não está disponível aqui — marque-a manualmente.`);
        autoRef.current = null;
        return;
      }
      autoRef.current = null;
      simularSaida();
    }
  }, [statusCarga, base, dataInicio, dataFim, transportadoras, transportadora, capasNeg, negSelecionadas]);

  async function simularSaida() {
    if (!base || !transportadora) return;
    setStatusSim('carregando'); setErro(''); setSimulacao(null); setExclusoes(new Set()); setRotasAbertas(new Set());
    setFiltroRota({ ufOrigem: '', origem: '', ufDestino: '', destino: '' });
    setFiltroCard('');
    try {
      const { municipioPorCidade, mapasIbge, mapaVinculos, unificacao } = base;
      const municipioPorIbge = base.municipioPorIbge || new Map();
      let ctesDaTransp;
      if (base.modo === 'resumo') {
        // Só os CT-es da escolhida: todos os nomes do grupo (CNPJ/vínculo), no
        // mesmo período/canal e com a mesma política de base do resumo.
        const nomesBanco = [...(base.nomesBancoPorGrupo.get(transportadora) || [])];
        if (!nomesBanco.length) throw new Error('Transportadora sem CT-es no resumo do período.');
        setProgresso(`Carregando CT-es de ${transportadora}...`);
        const { linhas, truncado } = await buscarCtesPaginado({
          intervalo: base.intervalo, canal: canal || '', nomes: nomesBanco, teto: LIMITE_MAX_CT, diasPorJanela: 7,
          onProgress: ({ carregados }) => setProgresso(`Carregando CT-es de ${transportadora}... ${fmtN(carregados)}`),
        });
        if (truncado) console.warn('[SimularSaidaTransportadora] teto de CT-es atingido para', transportadora);
        ctesDaTransp = aplicarSegundaBarreira(aplicarPoliticaBaseCte(linhas, OPCOES_POLITICA_BASE), (n) => aplicarVinculoPuro(n, mapaVinculos));
      } else {
        // compara pelo nome unificado: pega todos os CT-es das variações (CNPJ/vínculo) da transportadora escolhida
        ctesDaTransp = base.ctes.filter((c) => norm(unificacao.nomeDoCte(c)) === norm(transportadora));
      }
      const grupo = unificacao.grupos.find((g) => g.nome === transportadora);
      const nomesProprios = [transportadora, ...(grupo?.nomesTabela || []), ...(grupo?.variantes || [])];
      const nomesExcluir = new Set(nomesProprios.flatMap((n) => [norm(n), norm(aplicarVinculoPuro(n, mapaVinculos))]));
      const nomesTabelaProprios = [...new Set([transportadora, ...(grupo?.nomesTabela || [])])];
      if (!ctesDaTransp.length) throw new Error('Nenhum CT-e desta transportadora no recorte carregado.');

      // Mesmo critério do Simulador do realizado: CT-e sem peso usa o peso do
      // Tracking (o enriquecimento grava em pesoDeclarado, que o Simulador usa
      // quando o peso do CT-e é 0). Sem isto, esses CT-es eram calculados com
      // 0 kg (só % NF/mínimo), puxando a tabela nova e as substitutas para baixo.
      const pesoTrackingInfo = { semPeso: 0, recuperados: 0 };
      const semPesoCte = ctesDaTransp.filter((c) => !(pesoComoSimuladorRealizado(c) > 0));
      pesoTrackingInfo.semPeso = semPesoCte.length;
      if (semPesoCte.length) {
        setProgresso(`Buscando no Tracking o peso de ${fmtN(semPesoCte.length)} CT-e(s) sem peso...`);
        const linhasTracking = semPesoCte.map((c) => ({
          chaveCte: c.chave_cte || '', chaveNfe: c.chave_nfe || '', notaFiscal: c.nota_fiscal || '', numeroCte: c.numero_cte || '',
          peso: 0, pesoDeclarado: 0,
        }));
        try {
          const mapas = await buscarTrackingParaRealizado(linhasTracking);
          const enriquecidas = enriquecerRealizadoComTracking(linhasTracking, mapas).linhas || [];
          const pesoPorCte = new Map();
          enriquecidas.forEach((l, i) => { if (l.trackingMatch && safeNum(l.pesoDeclarado) > 0) pesoPorCte.set(semPesoCte[i], safeNum(l.pesoDeclarado)); });
          pesoTrackingInfo.recuperados = pesoPorCte.size;
          ctesDaTransp = ctesDaTransp.map((c) => (pesoPorCte.has(c) ? { ...c, peso_declarado: pesoPorCte.get(c), peso_origem: 'tracking' } : c));
        } catch (e) {
          console.warn('[SimularSaidaTransportadora] falha ao buscar peso no Tracking', e);
        }
      }

      // Busca só as tabelas de frete das rotas que ESTA transportadora roda —
      // não a base inteira — pra achar quem mais cobre essas mesmas rotas.
      const routeKeys = montarRouteKeysCtes(ctesDaTransp, municipioPorCidade, mapasIbge, canal || '');
      if (!routeKeys.length) throw new Error('CT-es encontrados, mas sem IBGE de origem/destino resolvido para buscar as tabelas.');

      setProgresso(`Carregando tabelas de frete para ${fmtN(routeKeys.length)} rota(s) de ${transportadora}...`);
      const baseFrete = normalizarTransportadoras(await buscarBaseSimulacaoPorRotasDb({ routeKeys, canal: canal || '' }));
      if (!baseFrete.length) throw new Error('Nenhuma tabela de frete encontrada para as rotas desta transportadora.');
      const idx = indexarBase(baseFrete);
      const mapBaseByNome = new Map(baseFrete.map((t) => [t.nome, t]));

      // Tabela em negociação (modo "comparar com tabela nova"): carrega só os
      // destinos que esta transportadora rodou e calcula cada CT-e nela.
      let baseNova = [];
      let rotulosTabelaNova = [];
      const capasEscolhidas = modoReajuste === 'tabela'
        ? (capasNeg || []).filter((c) => negSelecionadas.has(c.id))
        : [];
      if (modoReajuste === 'tabela' && !capasEscolhidas.length) throw new Error('Escolha ao menos uma tabela em negociação para comparar (ou volte para "Percentual").');
      if (capasEscolhidas.length) {
        const ibgesDestino = new Set();
        for (const c of ctesDaTransp) { const ib = ibgeDoCte(c, 'destino', municipioPorCidade, mapasIbge); if (ib) ibgesDestino.add(dig7(ib)); }
        const recorte = { ibgesDestino: [...ibgesDestino] };
        const detalhadas = [];
        for (let k = 0; k < capasEscolhidas.length; k++) {
          const capa = capasEscolhidas[k];
          setProgresso(`Carregando tabela em negociação ${k + 1}/${capasEscolhidas.length} (${labelTabelaNegociacaoSimulador(capa)})...`);
          detalhadas.push(await carregarDetalhesNegociacaoParaSimulacao(capa, recorte, (feitos, total) => {
            setProgresso(`Carregando tabela em negociação ${k + 1}/${capasEscolhidas.length}... ${fmtN(feitos)}/${fmtN(total)} destino(s)`);
          }));
        }
        // a negociação pode não estar marcada para o simulador; aqui ela foi escolhida explicitamente
        baseNova = normalizarTransportadoras(converterTabelasNegociacaoParaSimulador(
          detalhadas.map((d) => ({ ...d, incluir_simulacao: true })),
          { canal: canal || '' },
        ));
        rotulosTabelaNova = capasEscolhidas.map((c) => labelTabelaNegociacaoSimulador(c));
        if (!baseNova.length) throw new Error('A tabela em negociação escolhida não tem rotas para os destinos desta transportadora (confira canal e origem da tabela).');
      }

      const origemCache = new Map();
      const ctesSimulados = [];
      let semIbge = 0;

      setProgresso(`Simulando substitutas para ${fmtN(ctesDaTransp.length)} CT-es de ${transportadora}...`);
      const t0 = Date.now();
      for (let i = 0; i < ctesDaTransp.length; i++) {
        const cte = ctesDaTransp[i];
        const cidadeOrigem = cte.cidade_origem || cte.origem || '';
        const ufOrigem = String(cte.uf_origem || '').toUpperCase();
        const cidadeDestino = cte.cidade_destino || cte.destino || '';
        const ufDestino = String(cte.uf_destino || '').toUpperCase();
        const valorPago = safeNum(cte.valor_cte || cte.frete_pago || cte.valor_frete);

        const ibgeDestino = ibgeDoCte(cte, 'destino', municipioPorCidade, mapasIbge);
        const ibgeOrigemReal = ibgeDoCte(cte, 'origem', municipioPorCidade, mapasIbge);
        // Nome/UF padronizados pelo IBGE só para exibir e agrupar rotas; o
        // cálculo continua usando o texto original do CT-e.
        const origemPad = localPadronizado({ cidade: cidadeOrigem, uf: ufOrigem, ibge: ibgeOrigemReal }, municipioPorIbge);
        const destinoPad = localPadronizado({ cidade: cidadeDestino, uf: ufDestino, ibge: ibgeDestino }, municipioPorIbge);
        const rotaKey = `${norm(origemPad.cidade)}|${origemPad.uf}=>${norm(destinoPad.cidade)}|${destinoPad.uf}`;

        // prazo/tabela da própria transportadora atual (referência para auditar)
        let atual = null;
        if (ibgeDestino && ibgeOrigemReal) {
          for (const nomeTab of nomesTabelaProprios) {
            atual = calcComTransportadora(cte, baseFrete, nomeTab, ibgeOrigemReal, ibgeDestino, cidadeOrigem);
            if (atual) break;
          }
        }

        // valor na tabela em negociação (se houver) — a primeira que calcular
        let valorNovaTabela = null;
        if (baseNova.length && ibgeDestino && ibgeOrigemReal) {
          for (const entrada of baseNova) {
            const r = calcComTransportadora(cte, baseNova, entrada.nome, ibgeOrigemReal, ibgeDestino, cidadeOrigem);
            if (r && r.total > 0) { valorNovaTabela = r.total; break; }
          }
        }

        let resultados = [];
        if (!ibgeDestino || !ibgeOrigemReal) {
          semIbge += 1;
        } else {
          const setOrigem = nomesPorOrigem(idx, dig7(ibgeOrigemReal), normCmp(cidadeOrigem), origemCache);
          const setDestino = idx.porDestinoIbge.get(dig7(ibgeDestino));
          const candidatas = [];
          if (setDestino) for (const nome of setOrigem) if (setDestino.has(nome)) { const t = mapBaseByNome.get(nome); if (t) candidatas.push(t); }
          resultados = simularSubstitutas(cte, baseFrete, candidatas, ibgeOrigemReal, ibgeDestino, cidadeOrigem, nomesExcluir);
        }

        ctesSimulados.push({
          rotaKey,
          cidadeOrigem: origemPad.cidade, ufOrigem: origemPad.uf,
          cidadeDestino: destinoPad.cidade, ufDestino: destinoPad.uf,
          valorPago,
          nf: safeNum(cte.valor_nf || cte.nf_venda),
          peso: safeNum(cte.peso_declarado || cte.peso),
          chave: cte.chave_cte || '',
          data: cte.data_emissao || '',
          prazoAtual: atual?.prazo ?? null,
          valorTabelaAtual: atual ? atual.total : null,
          valorNovaTabela,
          resultados,
        });

        if (i % 50 === 0 || i === ctesDaTransp.length - 1) {
          const feitos = i + 1;
          const decorrido = (Date.now() - t0) / 1000;
          setProgresso(`Simulando... ${fmtN(feitos)}/${fmtN(ctesDaTransp.length)} · ${decorrido.toFixed(0)}s`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      setSimulacao({
        transportadora, variantes: grupo?.variantes || [], ctesSimulados, semIbge, pesoTrackingInfo, recorte: { competencia, dataInicio, dataFim, canal },
        tabelaNova: rotulosTabelaNova.length ? { rotulos: rotulosTabelaNova } : null,
      });
      setStatusSim('concluido'); setProgresso('');
    } catch (e) {
      console.error('[SimularSaidaTransportadora]', e);
      setErro(`${e.message || e}`);
      setStatusSim('erro'); setProgresso('');
    }
  }

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Análise</div>
        <h1>Simular Saída de Transportadora</h1>
        <p>Se esta transportadora saísse hoje, quanto custaria rodar as rotas dela com as melhores substitutas disponíveis — e como isso se compara a aceitar um reajuste.</p>
        <BaseCtesStatus />
      </div>
      {autoAviso && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 16px', margin: '0 0 1rem', fontSize: '0.84rem', color: '#1e3a8a' }}>
          {autoAviso}
        </div>
      )}

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
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
          <label>Limite de CT-es <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.72rem' }}>(só sem mês/período)</span>
            <input type="number" value={limiteInput} onChange={(e) => setLimiteInput(e.target.value)} min={100} max={200000} step={1000} />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="primary" type="button" onClick={carregar} disabled={statusCarga === 'carregando'}>
              {statusCarga === 'carregando' ? 'Carregando...' : (competencia || dataInicio || dataFim ? 'Listar transportadoras' : 'Carregar CT-es')}
            </button>
            {base && <button className="sim-tab" type="button" onClick={() => { setBase(null); setSimulacao(null); setExclusoes(new Set()); setStatusCarga('idle'); }}>Limpar</button>}
          </div>
        </div>

        {progresso && (
          <div style={{ marginTop: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #93c5fd', borderTop: '2px solid #1d4ed8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            {progresso}
          </div>
        )}
      </section>

      {base && (
        <section className="sim-card" style={{ marginTop: '1rem' }}>
          {base.carga && (
            <div style={{ fontSize: '0.78rem', color: base.carga.truncado ? '#b45309' : '#64748b', marginBottom: 10 }}>
              {fmtN(base.carga.totalCtes)} CT-es no recorte (de {fmtN(base.carga.brutos)}; mesmos filtros de tomador/EBAZAR/CPS LOG/CP COMERCIAL do Simulador do realizado).
              {base.modo === 'resumo' ? ' Os CT-es são baixados só da transportadora escolhida.' : ''}
              {base.carga.truncado && (base.carga.temPeriodo
                ? ` Atenção: atingiu o teto de ${fmtN(LIMITE_MAX_CT)} CT-es — reduza o período para comparar com o simulador.`
                : ' Sem mês/período: só os CT-es mais recentes até o limite entraram — informe o mês para comparar com o simulador.')}
            </div>
          )}
          <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Transportadora a avaliar</div>
              <SeletorTransportadora
                grupos={transportadoras}
                totais={base.totaisPorGrupo}
                valor={transportadora}
                onChange={setTransportadora}
              />
              {grupoSelecionado && grupoSelecionado.variantes.length > 1 && (
                <span style={{ display: 'block', fontWeight: 400, fontSize: '0.72rem', color: '#64748b', marginTop: 4 }}>
                  Unificado (CNPJ/vínculo): {grupoSelecionado.variantes.join(' · ')}
                </span>
              )}
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Comparar a saída com</div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, fontWeight: 400, whiteSpace: 'nowrap' }}>
                  <input type="radio" name="modoReajuste" checked={modoReajuste === 'pct'} onChange={() => setModoReajuste('pct')} />
                  Percentual de reajuste
                </label>
                <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, fontWeight: 400, whiteSpace: 'nowrap' }}>
                  <input type="radio" name="modoReajuste" checked={modoReajuste === 'tabela'} onChange={() => { setModoReajuste('tabela'); garantirCapasNegociacao(); }} />
                  Tabela em negociação (tabela nova cadastrada)
                </label>
                {modoReajuste === 'pct' ? (
                  <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, fontWeight: 400, whiteSpace: 'nowrap' }}>
                    Reajuste proposto
                    <input type="number" value={reajustePct} onChange={(e) => setReajustePct(e.target.value)} style={{ width: 80 }} step={0.5} />
                    <span>%</span>
                  </label>
                ) : (
                  <label
                    style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, fontWeight: 400, whiteSpace: 'nowrap' }}
                    title="Usado só nos CT-es que não calculam nas duas tabelas (origem sem tabela nova marcada, destino fora da tabela nova ou fora da tabela atual). Vazio = aumento médio da própria tabela nova."
                  >
                    Reajuste p/ CT-es sem cálculo na tabela nova
                    <input
                      type="number"
                      value={pctForaTabela}
                      onChange={(e) => setPctForaTabela(e.target.value)}
                      placeholder={pctMediaTabelaNova != null ? pct(pctMediaTabelaNova) : 'auto'}
                      style={{ width: 90 }}
                      step={0.5}
                    />
                    <span>%</span>
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                      {pctForaAutomatico
                        ? (pctMediaTabelaNova != null ? `automático: média da tabela nova (${pct(pctMediaTabelaNova)})` : 'vazio = média da tabela nova')
                        : <button type="button" className="sim-tab" onClick={() => setPctForaTabela('')} style={{ padding: '0 8px', fontSize: '0.72rem' }}>voltar ao automático</button>}
                    </span>
                  </label>
                )}
              </div>
              {modoReajuste === 'tabela' && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', background: '#f8fafc' }}>
                  {carregandoCapas && <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Carregando tabelas em negociação...</div>}
                  {!carregandoCapas && capasNeg && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                          Marque a(s) tabela(s) nova(s) desta transportadora (uma por origem, se for o caso). Cada CT-e é calculado nela, no lugar do percentual.
                        </span>
                        <label style={{ fontSize: '0.75rem', fontWeight: 400, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <input type="checkbox" checked={mostrarTodasNeg} onChange={(e) => setMostrarTodasNeg(e.target.checked)} />
                          mostrar de todas as transportadoras
                        </label>
                      </div>
                      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                        {capasDaTransportadora.map((c) => (
                          <label key={c.id} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, padding: '3px 2px', fontSize: '0.8rem', fontWeight: 400, cursor: 'pointer' }}>
                            <input type="checkbox" checked={negSelecionadas.has(c.id)} onChange={() => toggleNeg(c.id)} />
                            {labelTabelaNegociacaoSimulador(c)}
                            <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
                              {[c.canal, c.status, c.data_inicio_vigencia || c.data_inicio_prevista].filter(Boolean).join(' · ')}
                            </span>
                          </label>
                        ))}
                        {!capasDaTransportadora.length && (
                          <div style={{ fontSize: '0.8rem', color: '#9b1111' }}>
                            Nenhuma tabela em negociação encontrada para {transportadora || 'esta transportadora'}. Marque "mostrar de todas" para procurar pelo nome.
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <button className="primary" type="button" onClick={simularSaida} disabled={!transportadora || statusSim === 'carregando'}>
                {statusSim === 'carregando' ? 'Simulando...' : 'Simular saída'}
              </button>
            </div>
          </div>
        </section>
      )}

      {resultado && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10, margin: '1rem 0 0.5rem' }}>
            {[
              ['ufOrigem', 'UF origem', opcoesFiltroRota.ufOrigem, (v) => ({ ufOrigem: v, origem: '' })],
              ['origem', 'Cidade origem', opcoesFiltroRota.origem, (v) => ({ origem: v })],
              ['ufDestino', 'UF destino', opcoesFiltroRota.ufDestino, (v) => ({ ufDestino: v, destino: '' })],
              ['destino', 'Cidade destino', opcoesFiltroRota.destino, (v) => ({ destino: v })],
            ].map(([campo, rotulo, opcoes, montar]) => (
              <label key={campo} style={{ fontSize: '0.75rem', color: '#64748b', minWidth: campo.startsWith('uf') ? 110 : 200 }}>
                {rotulo}
                <select value={filtroRota[campo]} onChange={(e) => setFiltroRota((f) => ({ ...f, ...montar(e.target.value) }))} style={{ width: '100%' }}>
                  <option value="">Todas</option>
                  {opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            ))}
            {filtroAtivo && (
              <button type="button" className="sim-tab" onClick={() => setFiltroRota({ ufOrigem: '', origem: '', ufDestino: '', destino: '' })}>Limpar filtros</button>
            )}
            {filtroAtivo && (
              <span style={{ fontSize: '0.78rem', color: '#1d4ed8' }}>
                Mostrando {fmtN(resultado.totalCtes)} de {fmtN(resultado.totalCtesSemFiltro)} CT-es — cards, rotas e laudo seguem o filtro.
              </span>
            )}
          </div>

          <div style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.5rem 0 0.35rem' }}>
            Clique numa situação para ver só essas rotas — os valores abaixo e a tabela passam a mostrar a seleção.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.6rem', marginBottom: '0.75rem' }}>
            <Card label="Todas as rotas" valor={fmtN(resultado.totalRotas)} sub={`${fmtN(resultado.totalCtes)} CT-es · ${fmt(resultado.custoAtual)}`} cor="#1e293b" onClick={() => setFiltroCard('')} ativo={!filtroCard} />
            {[
              ['sem', '#9b1111', 'sem tabela alternativa'],
              ['cara', '#b45309', 'custa mais que hoje'],
              ['barata', '#04C7A4', 'custa menos que hoje'],
              ['prazo', '#b45309', 'prazo de tabela maior'],
              ['unica', '#64748b', 'só 1 transportadora cobre'],
            ].map(([k, cor, desc]) => (
              <Card
                key={k}
                label={SITUACOES_ROTA[k].rotulo}
                valor={fmtN(contagemSituacoes[k]?.rotas || 0)}
                sub={`${desc} · ${fmtN(contagemSituacoes[k]?.ctes || 0)} CT-es`}
                cor={cor}
                destaque={k === 'sem' && (contagemSituacoes.sem?.rotas || 0) > 0}
                onClick={() => alternarCard(k)}
                ativo={filtroCard === k}
              />
            ))}
          </div>

          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
            {filtroCard
              ? `Valores das rotas "${SITUACOES_ROTA[filtroCard].rotulo}" — ${fmtN(totaisSel.rotas)} rota(s), ${fmtN(totaisSel.ctes)} CT-es`
              : `Valores de todas as rotas — ${fmtN(totaisSel.rotas)} rota(s), ${fmtN(totaisSel.ctes)} CT-es`}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem', marginBottom: '1rem' }}>
            <Card label="Custo atual" valor={fmt(totaisSel.custoAtual)} sub="frete pago a esta transportadora" cor="#1e293b" />
            <Card
              label={resultado.tabelaNova
                ? `Custo c/ tabela nova (${totaisSel.custoAtual > 0 ? `${totaisSel.custoComReajuste >= totaisSel.custoAtual ? '+' : ''}${pct((totaisSel.custoComReajuste / totaisSel.custoAtual - 1) * 100)}` : '—'})`
                : `Custo c/ reajuste (+${pct(resultado.pctReajuste)})`}
              valor={fmt(totaisSel.custoComReajuste)}
              sub={`${totaisSel.custoComReajuste >= totaisSel.custoAtual ? '+' : '−'}${fmt(Math.abs(totaisSel.custoComReajuste - totaisSel.custoAtual))} vs. hoje`}
              cor="#9b1111"
            />
            <Card label="Custo c/ substitutas" valor={fmt(totaisSel.custoComSubstitutos)} sub={`${totaisSel.aumentoPctSubstitutos >= 0 ? '+' : ''}${pct(totaisSel.aumentoPctSubstitutos)} vs. custo atual`} cor={totaisSel.custoComSubstitutos <= totaisSel.custoAtual ? '#04C7A4' : '#b45309'} />
            <Card label="Economia vs. aceitar reajuste" valor={fmt(totaisSel.economiaVsReajuste)} sub={totaisSel.economiaVsReajuste >= 0 ? 'substitutas saem mais baratas' : 'reajuste sai mais barato'} cor={totaisSel.economiaVsReajuste >= 0 ? '#04C7A4' : '#9b1111'} destaque />
            {(() => {
              const pa = totaisSel.prazoAtual, ps = totaisSel.prazoSub;
              const delta = (pa != null && ps != null) ? ps - pa : null;
              const corPrazo = delta == null ? '#1e293b' : (delta <= 0 ? '#04C7A4' : '#9b1111');
              const sub = delta == null ? 'prazo de tabela'
                : Math.abs(delta) < 0.05 ? 'mesmo prazo'
                : (delta < 0 ? `${fmtDias(-delta)} mais rápido` : `${fmtDias(delta)} mais lento`);
              return <Card label="Prazo médio (atual → subst.)" valor={`${fmtDias(pa)} → ${fmtDias(ps)}`} sub={sub} cor={corPrazo} />;
            })()}
          </div>

          {(porOrigem.length > 1 || filtroRota.origem) && (
            <div className="panel-card" style={{ marginBottom: '1rem' }}>
              <div className="panel-title" style={{ marginBottom: 4 }}>Por origem</div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 8 }}>
                Uma origem pode valer a pena trocar e outra não. Clique numa origem para filtrar a tela por ela (clique de novo para voltar).
              </div>
              <div className="sim-analise-tabela-wrap">
                <table className="sim-analise-tabela">
                  <thead>
                    <tr>
                      <th>Origem</th><th>Rotas</th><th>CT-es</th><th>Pago hoje</th><th>{resultado.tabelaNova ? 'Com tabela nova' : 'Com reajuste'}</th>
                      <th>Trocando tudo</th><th>Trocando só onde compensa</th><th>Economia vs. reajuste</th><th>Sem substituta</th><th>Recomendação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porOrigem.map((o) => {
                      const sel = filtroRota.origem === o.origem;
                      const corRec = o.recomendacao === RECOMENDACAO_ORIGEM.TROCAR ? '#047857' : (o.recomendacao === RECOMENDACAO_ORIGEM.PARCIAL ? '#b45309' : '#9b1111');
                      return (
                        <tr key={o.origem} onClick={() => alternarOrigem(o.origem)} style={{ cursor: 'pointer', background: sel ? '#eff6ff' : undefined }} title={sel ? 'Clique para ver todas as origens' : 'Clique para filtrar por esta origem'}>
                          <td style={{ fontWeight: sel ? 700 : 600 }}>{o.origem}</td>
                          <td>{fmtN(o.rotas)}</td>
                          <td>{fmtN(o.ctes)}</td>
                          <td>{fmt(o.custoAtual)}</td>
                          <td>{fmt(o.custoReajuste)}</td>
                          <td>{fmt(o.custoSaidaTotal)}</td>
                          <td>{fmt(o.custoHibrido)}</td>
                          <td style={{ color: o.economiaHibrido >= 0 ? '#047857' : '#9b1111', fontWeight: 600 }}>{fmt(o.economiaHibrido)}</td>
                          <td style={{ color: o.rotasSem ? '#9b1111' : '#64748b' }}>{fmtN(o.rotasSem)}</td>
                          <td style={{ color: corRec, fontWeight: 700 }}>
                            {o.recomendacao}
                            {o.recomendacao === RECOMENDACAO_ORIGEM.PARCIAL && <span style={{ fontWeight: 400, fontSize: '0.75rem', color: '#64748b' }}> ({fmtN(o.rotasMigrar)} de {fmtN(o.rotas)} rotas)</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
            <button type="button" className="primary" onClick={() => exportarLaudo('pdf')} disabled={!!exportando || !resultado.linhas.length}>
              {exportando === 'pdf' ? 'Gerando laudo...' : 'Laudo (PDF)'}
            </button>
            <button type="button" className="sim-tab" onClick={() => exportarLaudo('excel')} disabled={!!exportando || !resultado.linhas.length}>
              {exportando === 'excel' ? 'Gerando Excel...' : 'Exportar Excel detalhado'}
            </button>
            <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
              Laudo: parecer, números, resumo por situação, listas de sem substituta, mais cara, mais barata, prazo maior, substituta única e quem assumiria. Excel: detalhe por rota e CT-e. Ambos seguem reajuste, exclusões e filtros de origem/destino.
            </span>
          </div>

          {resultado.semIbge > 0 && (
            <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 16px', marginBottom: '1rem', fontSize: '0.84rem', color: '#854d0e' }}>
              {fmtN(resultado.semIbge)} CT-e(s) sem IBGE de origem/destino resolvido — entraram no custo atual sem buscar substituto.
            </div>
          )}

          {resultado.pesoTrackingInfo?.semPeso > 0 && (
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 16px', marginBottom: '1rem', fontSize: '0.84rem', color: '#1e3a8a' }}>
              {fmtN(resultado.pesoTrackingInfo.semPeso)} CT-e(s) vieram sem peso: {fmtN(resultado.pesoTrackingInfo.recuperados)} tiveram o peso buscado no Tracking (mesmo critério do Simulador)
              {resultado.pesoTrackingInfo.semPeso - resultado.pesoTrackingInfo.recuperados > 0
                ? <> e <strong>{fmtN(resultado.pesoTrackingInfo.semPeso - resultado.pesoTrackingInfo.recuperados)}</strong> continuam sem peso (calculados só por % NF/mínimo).</>
                : '.'}
            </div>
          )}

          {resultado.tabelaNova && (
            <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '10px 16px', marginBottom: '1rem', fontSize: '0.84rem', color: '#4c1d95', lineHeight: 1.5 }}>
              <strong>Tabela nova:</strong> {simulacao.tabelaNova.rotulos.join(' + ')}<br />
              Aumento da tabela nova sobre a tabela atual: <strong>{resultado.tabelaNova.pctSobreTabelaAtual != null ? `${resultado.tabelaNova.pctSobreTabelaAtual >= 0 ? '+' : ''}${pct(resultado.tabelaNova.pctSobreTabelaAtual)}` : '—'}</strong>
              {' '}em {fmtN(resultado.tabelaNova.ctes)} de {fmtN(resultado.totalCtes)} CT-es — aplicado CT-e a CT-e sobre o valor pago
              {resultado.tabelaNova.pctAplicado != null && <> (resultado: <strong>{resultado.tabelaNova.pctAplicado >= 0 ? '+' : ''}{pct(resultado.tabelaNova.pctAplicado)}</strong> sobre o pago)</>}.
              {resultado.tabelaNova.pctNovaCruaSobrePago != null && (
                <><br /><span style={{ fontSize: '0.78rem', color: '#6d28d9' }}>Referência: a tabela nova calculada direto contra o valor pago daria {resultado.tabelaNova.pctNovaCruaSobrePago >= 0 ? '+' : ''}{pct(resultado.tabelaNova.pctNovaCruaSobrePago)} — a diferença é o quanto o pago hoje já fica abaixo/acima da tabela atual.</span></>
              )}
              {resultado.tabelaNova.ctes < resultado.totalCtes && <><br />Os {fmtN(resultado.totalCtes - resultado.tabelaNova.ctes)} CT-es sem cálculo nas duas tabelas usam {pctForaEfetivo >= 0 ? '+' : ''}{pct(pctForaEfetivo)}{pctForaAutomatico ? ' — o aumento médio da própria tabela nova' : ' — valor informado'}.</>}
            </div>
          )}

          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 16px', marginBottom: '1rem', fontSize: '0.84rem', color: '#1d4ed8' }}>
            Os valores de substituta são preço de tabela. Capacidade real e SLA de quem assumiria o volume é avaliação da operação, não deste cálculo.
          </div>

          <div className="panel-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: '0.5rem', flexWrap: 'wrap' }}>
              <div className="panel-title" style={{ margin: 0 }}>
                Rotas de {simulacao?.transportadora || transportadora} — substituta por rota
                {filtroCard && (
                  <span style={{ marginLeft: 8, fontSize: '0.78rem', fontWeight: 600, color: '#1d4ed8' }}>
                    · {SITUACOES_ROTA[filtroCard].rotulo} ({fmtN(linhasVisiveis.length)})
                    <button type="button" className="sim-tab" onClick={() => setFiltroCard('')} style={{ marginLeft: 6, padding: '1px 8px', fontSize: '0.72rem' }}>mostrar todas</button>
                  </span>
                )}
              </div>
              <FiltroExcluir opcoes={opcoesExcluir} exclusoes={exclusoes} onToggle={toggleExcluir} onLimpar={() => setExclusoes(new Set())} />
            </div>
            {exclusoes.size > 0 && (
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '8px 12px', marginBottom: '0.6rem', fontSize: '0.8rem', color: '#9a3412', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <strong>Excluindo como substitutas:</strong>
                {opcoesExcluir.filter((n) => exclusoes.has(norm(n))).map((n) => (
                  <button key={n} type="button" onClick={() => toggleExcluir(n)} title="Clique para reincluir"
                    style={{ background: '#ffedd5', border: '1px solid #fdba74', borderRadius: 12, padding: '1px 8px', fontSize: '0.74rem', color: '#9a3412', cursor: 'pointer' }}>
                    {n} ✕
                  </button>
                ))}
                <span style={{ color: '#c2410c' }}>— a simulação assume a próxima melhor opção.</span>
              </div>
            )}
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead>
                  <tr>
                    <th>Origem</th>
                    <th>Destino</th>
                    <th>CT-es</th>
                    <th>Custo atual</th>
                    <th>Custo c/ substituta</th>
                    <th>Diferença</th>
                    <th>Prazo (atual → subst.)</th>
                    <th>Substitutas</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {linhasVisiveis.map((l) => {
                    const aberta = rotasAbertas.has(l.rotaKey);
                    const deltaPrazo = (l.prazoAtualMedio != null && l.prazoSubMedio != null) ? l.prazoSubMedio - l.prazoAtualMedio : null;
                    const corPrazo = deltaPrazo == null ? '#64748b' : (deltaPrazo <= 0 ? '#04C7A4' : '#9b1111');
                    return (
                      <React.Fragment key={l.rotaKey}>
                        <tr style={aberta ? { background: '#f8fafc' } : undefined}>
                          <td>{rotuloLocal(l.cidadeOrigem, l.ufOrigem)}</td>
                          <td>{rotuloLocal(l.cidadeDestino, l.ufDestino)}</td>
                          <td>{fmtN(l.ctes)}</td>
                          <td>{fmt(l.valorPagoTotal)}</td>
                          <td style={{ color: l.diferenca <= TOLERANCIA ? '#04C7A4' : '#9b1111', fontWeight: 600 }}>{fmt(l.melhorTotal)}</td>
                          <td style={{ color: l.diferenca <= TOLERANCIA ? '#04C7A4' : '#9b1111' }}>
                            {l.diferenca > TOLERANCIA ? `+${fmt(l.diferenca)}` : (l.diferenca < -TOLERANCIA ? `−${fmt(-l.diferenca)}` : '—')}
                          </td>
                          <td style={{ fontSize: '0.82rem' }}>
                            {fmtDias(l.prazoAtualMedio)} → <span style={{ color: corPrazo, fontWeight: 600 }}>{fmtDias(l.prazoSubMedio)}</span>
                          </td>
                          <td style={{ fontSize: '0.8rem' }}>
                            {l.qtdSubstitutos === 0
                              ? <span style={{ color: '#9b1111', fontWeight: 600 }}>nenhum encontrado</span>
                              : (
                                <span>
                                  <span style={{ fontWeight: 600 }}>{l.substitutoPrincipal || '—'}</span>
                                  {l.qtdSubstitutos === 1
                                    ? <span style={{ marginLeft: 6, color: '#b45309', background: '#fef3c7', borderRadius: 6, padding: '1px 6px', fontSize: '0.72rem', fontWeight: 600 }}>única opção</span>
                                    : <button type="button" onClick={() => toggleRota(l.rotaKey)} style={{ marginLeft: 6, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '1px 6px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}>+{l.qtdSubstitutos - 1} outras</button>}
                                  {l.semSubstituto > 0 && <span style={{ marginLeft: 6, color: '#9b1111', fontSize: '0.72rem' }}>({l.semSubstituto} CT-e sem cobertura)</span>}
                                </span>
                              )}
                          </td>
                          <td>
                            <button type="button" className="sim-tab" onClick={() => toggleRota(l.rotaKey)} style={{ padding: '2px 10px', fontSize: '0.78rem' }}>
                              {aberta ? 'Fechar' : 'Detalhes'}
                            </button>
                          </td>
                        </tr>
                        {aberta && (
                          <tr>
                            <td colSpan={9} style={{ background: '#f8fafc', padding: '12px 16px' }}>
                              <DetalheRota linha={l} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {!linhasVisiveis.length && <tr><td colSpan={9}>Sem rotas para exibir.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .sst-filtro { position: relative; }
        .sst-filtro > summary { white-space: nowrap; }
        .sst-filtro > summary::-webkit-details-marker { display: none; }
        .sst-filtro[open] > summary { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
        .sst-filtro-pop {
          position: absolute; right: 0; top: calc(100% + 6px); z-index: 30;
          background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
          box-shadow: 0 8px 24px rgba(15,23,42,0.12); padding: 12px; width: 320px; max-width: 80vw;
        }
      `}</style>
    </div>
  );
}
