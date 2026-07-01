import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { buscarBaseSimulacaoPorRotasDb, carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';
import { normalizarTransportadoras, processarCte } from '../services/auditoriaCteProcessamentoService';
import { categoriaCanalRealizado, montarMapasIbge, resolverIbgeLocal } from '../utils/realizadoLocalEngine';
import { filtrarCpComercialCte } from '../services/cteBasePolicy';
import { carregarReajustesSupabase } from '../services/reajustesSupabaseService';
import { REGIAO_POR_UF } from '../config/icmsBrasil';
import amdLogo from '../assets/amd-log.png';

const PAGE_SIZE = 200;
const TOLERANCIA = 0.5; // R$ — redução abaixo disto é ruído

const REGIAO_NOME = { N: 'NORTE', NE: 'NORDESTE', CO: 'CENTRO-OESTE', SE: 'SUDESTE', S: 'SUL' };
const ORDEM_REGIAO = ['NORTE', 'NORDESTE', 'CENTRO-OESTE', 'SUDESTE', 'SUL', 'OUTROS'];

const METRICAS = [
  { id: 'rs', label: 'R$ total' },
  { id: 'freteNf', label: 'Frete % s/ NF' },
  { id: 'rskg', label: 'R$ por kg' },
  { id: 'rscte', label: 'R$ por CT-e' },
];
const MODOS_CANDIDATA = [
  { id: 'qualquer', label: 'Qualquer tabela na origem', dica: 'Toda transportadora com tabela válida saindo desta origem.' },
  { id: 'area', label: 'Já operou a origem', dica: 'Só quem já rodou CT-e saindo desta mesma origem.' },
  { id: 'rota', label: 'Já operou a rota exata', dica: 'Só quem já rodou CT-e nesta rota origem → destino.' },
];
const MODOS_CENARIO = [
  { id: 'substituta', label: 'Uma transportadora substituta', dica: 'Uma única transportadora assume todo o volume da origem (troca de carteira).' },
  { id: 'cteacte', label: 'Menor preço CT-e a CT-e', dica: 'Para cada CT-e, a mais barata (pode misturar várias). Piso teórico.' },
];

const FILTROS_PADRAO = {
  regioes: [],
  ufsOrigem: [],
  transportadorasRealizadas: [],
  soComReducao: false,
};

// Transportadoras "sujeira" excluídas da análise. Fica salvo no navegador e
// persiste entre pesquisas (não é apagado pelo "Limpar filtros").
const EXCLUIDAS_OPORTUNIDADE_KEY = 'oportunidade_transp_excluidas_v1';
function carregarExcluidasOportunidade() {
  try {
    const salvo = JSON.parse(localStorage.getItem(EXCLUIDAS_OPORTUNIDADE_KEY) || '[]');
    return Array.isArray(salvo) ? salvo : [];
  } catch {
    return [];
  }
}

function safeNum(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function fmt(v) { return safeNum(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function fmtN(v) { return safeNum(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function pct(v) { return `${safeNum(v).toFixed(1).replace('.', ',')}%`; }
function norm(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Palavras genéricas de razão social que não identificam a transportadora —
// não podem ser a única base de um casamento (senão "TRANSPORTE" casa tudo).
const PALAVRAS_GENERICAS_TRANSP = new Set([
  'TRANSPORTE', 'TRANSPORTES', 'TRANSP', 'TRANSPORTADORA', 'LOGISTICA', 'LOG',
  'LTDA', 'ME', 'EIRELI', 'EPP', 'SA', 'CARGAS', 'CARGA', 'ENCOMENDAS', 'EXPRESS',
  'EXPRESSO', 'COMERCIO', 'SERVICOS', 'SERVICO', 'LIMITADA', 'RODOVIARIO',
  'RODOVIARIOS', 'DISTRIBUIDORA', 'DISTRIBUICAO',
]);
function tokensSignificativos(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length >= 3 && !PALAVRAS_GENERICAS_TRANSP.has(t));
}
// Mesma transportadora por casamento aproximado: cobre variações de razão social
// (ex.: "ATUAL CARGAS TRANSPORTES LTDA" x cadastro "ATUAL") sem casar por palavra
// genérica. Compara tokens significativos: os do nome menor têm de estar no maior.
function mesmaTransportadora(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const ta = tokensSignificativos(a);
  const tb = tokensSignificativos(b);
  if (!ta.length || !tb.length) return false;
  const [menor, maior] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  return menor.every((t) => maior.has(t));
}
function canalRealDe(cte) {
  return cte.canal_original && norm(cte.canal) === 'ADEFINIR'
    ? cte.canal_original
    : (cte.canal || cte.canal_original || '');
}
function regiaoDeUf(uf) {
  return REGIAO_NOME[REGIAO_POR_UF[String(uf || '').toUpperCase()]] || 'OUTROS';
}
function passaLista(valor, lista) {
  if (!lista || !lista.length) return true;
  return lista.includes(String(valor || '').trim());
}
function fmtMetrica(metrica, valor) {
  if (valor == null || !Number.isFinite(valor)) return '—';
  if (metrica === 'freteNf') return pct(valor);
  if (metrica === 'rskg') return `${fmt(valor)}/kg`;
  return fmt(valor); // rs, rscte
}
function dig7(v) { return String(v || '').replace(/\D/g, '').slice(0, 7); }
// Mesma normalização de cidade do Simulador (acentos fora, minúsculo).
function normalizeBuscaIbge(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
// Mapa cidade -> IBGE a partir da planilha de IBGE (ibge_municipios), chaveado
// por "cidade" e "cidade/uf" — igual o Simulador monta o municipioPorCidade.
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
// IBGE do CT-e seguindo a linha do Simulador: coluna gravada primeiro; senão,
// busca na planilha de IBGE por cidade/uf; por último, fallback do motor local.
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
// normalizeCompare do motor (minúsculo, sem acento, espaços) — p/ casar cidade igual a ele.
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

// Pré-indexa o cadastro p/ achar rápido só as transportadoras que podem atender
// uma origem/destino — evita rodar o motor contra TODAS (o gargalo em volume alto).
function indexarBase(base) {
  const porOrigemIbge = new Map();   // ibge7 origem -> Set(nome)
  const porDestinoIbge = new Map();  // ibge7 destino -> Set(nome)
  const origensCidade = [];          // [{ cidadeNorm, nome }] distintos (fallback por cidade)
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
// Nomes que atendem a origem (por IBGE da rota OU cidade compatível). Memoizado por origem.
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
function cotacaoDaRota(cotacao = {}, nomesRotas = new Set()) {
  if (!nomesRotas.size) return true;
  const rotaCotacao = normCmp(cotacao.rota || cotacao.nomeRota || cotacao.nome_rota);
  if (!rotaCotacao) return true;
  for (const rotaNome of nomesRotas) {
    if (rotaCotacao === rotaNome || rotaCotacao.includes(rotaNome) || rotaNome.includes(rotaCotacao)) return true;
  }
  return false;
}
function limitarTransportadoraParaCte(transp, ibgeOrigemReal, ibgeDestino, cidadeOrigemReal) {
  const origemKey = dig7(ibgeOrigemReal);
  const destinoKey = dig7(ibgeDestino);
  const origemCmp = normCmp(cidadeOrigemReal);
  const origens = [];

  for (const origem of transp.origens || []) {
    const rotas = (origem.rotas || []).filter((rota) => {
      const rotaOrigem = dig7(rota.ibgeOrigem || rota.ibge_origem);
      const rotaDestino = dig7(rota.ibgeDestino || rota.ibge_destino);
      const origemOk = rotaOrigem ? rotaOrigem === origemKey : cidadeBate(normCmp(origem.cidade), origemCmp);
      const destinoOk = rotaDestino ? rotaDestino === destinoKey : true;
      return origemOk && destinoOk;
    });
    if (!rotas.length) continue;

    const nomesRotas = new Set(rotas.map((rota) => normCmp(rota.nomeRota || rota.nome_rota || rota.rota)).filter(Boolean));
    origens.push({
      ...origem,
      rotas,
      cotacoes: (origem.cotacoes || []).filter((cotacao) => cotacaoDaRota(cotacao, nomesRotas)),
      taxasEspeciais: (origem.taxasEspeciais || []).filter((taxa) => !dig7(taxa.ibgeDestino || taxa.ibge_destino) || dig7(taxa.ibgeDestino || taxa.ibge_destino) === destinoKey),
    });
  }

  return { ...transp, origens };
}

// Carrega CT-es do realizado respeitando recorte (igual à Oportunidade de Origem).
const LIMITE_MAX_CT = 200000; // trava de segurança para evitar simulações longas demais no browser
const MSG_SEM_CTES = 'Nenhum CT-e encontrado para os filtros selecionados.';

function mensagemAmigavelErro(error) {
  const message = String(error?.message || error || '');
  if (/Nenhum CT-e encontrado/i.test(message)) return MSG_SEM_CTES;
  if (/column .* does not exist|Erro ao carregar CT-es|Supabase|SQL/i.test(message)) {
    return 'Nao foi possivel carregar os dados da analise. Revise os filtros e tente novamente.';
  }
  return message || 'Nao foi possivel concluir a analise.';
}

async function carregarCtes({ competencia, dataInicio, dataFim, canal, limite = 4000, onProgress }) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const supabase = getSupabaseClient();
  const teto = Math.max(100, Math.min(Number(limite) || 4000, LIMITE_MAX_CT));
  const acumulado = [];
  let from = 0;
  const PAGE = 1000;
  while (acumulado.length < teto) {
    let q = supabase.from('realizado_local_ctes').select('*').order('data_emissao', { ascending: false }).range(from, from + PAGE - 1);
    if (dataInicio || dataFim) {
      if (dataInicio) q = q.gte('data_emissao', dataInicio);
      if (dataFim) q = q.lte('data_emissao', dataFim);
    } else if (competencia) {
      q = q.eq('competencia', competencia);
    }
    if (canal) q = q.or(`canal_original.ilike.%${canal}%,canal.ilike.%${canal}%`);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao carregar CT-es: ${error.message}`);
    const lote = data || [];
    acumulado.push(...lote);
    onProgress?.({ carregados: acumulado.length });
    if (lote.length < PAGE) break;
    from += PAGE;
  }
  return filtrarCpComercialCte(acumulado).slice(0, teto);
}

// Recalcula o MESMO CT-e (mesma origem real, mesmo destino) com TODAS as
// transportadoras. Mantém só as cotações em que o motor usou de fato a origem
// real (descarta fallback p/ outra origem do cadastro).
function simularTodas(cte, candidatas, ibgeOrigemReal, ibgeDestino, cidadeOrigemReal) {
  const canalReal = canalRealDe(cte);
  const cteBase = {
    ...cte,
    canal: canalReal,
    canal_original: canalReal,
    ibge_origem: ibgeOrigemReal || '',
    ibge_corrigido_origem: ibgeOrigemReal || '',
    ibge_destino: ibgeDestino || '',
    ibge_corrigido_destino: ibgeDestino || '',
  };
  const origemRealCmp = normCmp(cidadeOrigemReal);
  const resultados = [];
  const statusCounts = { CALCULADO: 0, SEM_TABELA: 0, SEM_ORIGEM: 0, SEM_ROTA: 0, SEM_FAIXA: 0, ORIGEM_ERRADA: 0, OUTRO: 0 };
  for (const transp of candidatas) {
    const transpRecorte = limitarTransportadoraParaCte(transp, ibgeOrigemReal, ibgeDestino, cidadeOrigemReal);
    const teste = { ...cteBase, transportadora: transpRecorte.nome, nome_transportadora: transpRecorte.nome };
    let r;
    try { r = processarCte(teste, [transpRecorte]); } catch { statusCounts.OUTRO += 1; continue; }
    const st = r.status_calculo || 'OUTRO';
    statusCounts[st in statusCounts ? st : 'OUTRO'] += 1;
    if (st !== 'CALCULADO') continue;
    // só aceita cotação em que o motor usou de fato a origem real (mesma regra de cidade do motor)
    if (!cidadeBate(normCmp(r.detalhes_calculo?.origem_cidade), origemRealCmp)) {
      statusCounts.CALCULADO -= 1;
      statusCounts.ORIGEM_ERRADA += 1;
      continue;
    }
    const total = safeNum(r.valor_calculado);
    if (total <= 0) continue;
    const temDestinoEspecifico = !!(r.detalhes_calculo?.ibge_destino || r.detalhes_calculo?.rota_ibge_destino);
    // semGeneralidades: carrier calculou sem nenhuma taxa adicional (sem "generalidades" na tabela)
    const temTaxas = (transpRecorte.origens || []).some((o) => (o.taxasEspeciais || []).length > 0);
    resultados.push({ transportadora: transp.nome, total, prazo: safeNum(r.detalhes_calculo?.rota_prazo), temDestinoEspecifico, temTaxas });
  }
  resultados.sort((a, b) => a.total - b.total);
  return { resultados, statusCounts };
}

// Calcula o cenário de um grupo (transportadora × origem) já com as candidatas filtradas.
function calcularGrupo(casos, scenarioMode, transportadoraReal) {
  // A própria transportadora (com variação de razão social) não pode ser a
  // substituta — substituir uma transportadora por ela mesma não é troca.
  const ehPropria = (nome) => mesmaTransportadora(nome, transportadoraReal);

  let pagoTotal = 0, pesoTotal = 0, nfTotal = 0, prazoRealSoma = 0, prazoRealN = 0;
  for (const c of casos) {
    pagoTotal += c.valorPago; pesoTotal += c.peso; nfTotal += c.valorNf;
    if (c.prazoReal > 0) { prazoRealSoma += c.prazoReal; prazoRealN += 1; }
  }

  // Ranking de candidatas no grupo (mesma origem): total e cobertura.
  // Exclui a própria transportadora real (não é substituta).
  const carriersUnion = new Set();
  for (const c of casos) for (const q of c.candidatos) if (!ehPropria(q.transportadora)) carriersUnion.add(q.transportadora);
  const ranking = [];
  for (const nome of carriersUnion) {
    let total = 0, cobertos = 0, prazoSoma = 0, prazoN = 0, semEspecifico = 0, semTaxas = 0;
    for (const c of casos) {
      const q = c.candMap.get(nome);
      if (q && q.total > 0) {
        total += q.total; cobertos += 1;
        if (q.prazo > 0) { prazoSoma += q.prazo; prazoN += 1; }
        if (!q.temDestinoEspecifico) semEspecifico += 1;
        if (!q.temTaxas) semTaxas += 1;
      } else { total += c.valorPago; if (c.prazoReal > 0) { prazoSoma += c.prazoReal; prazoN += 1; } }
    }
    ranking.push({
      transportadora: nome, total, cobertos,
      prazoMedio: prazoN > 0 ? prazoSoma / prazoN : null,
      semGranularidade: cobertos > 0 && semEspecifico === cobertos,
      semGeneralidades: cobertos > 0 && semTaxas === cobertos,
    });
  }
  ranking.sort((a, b) => a.total - b.total);

  // Cobertura combinada (greedy CT-e a CT-e): quem cobre o quê quando usamos a mais barata para cada entrega
  const chainMap = new Map(); // transportadora -> { ctes, custo, prazoSoma, prazoN, nfSoma }
  let chainSemAtendimento = 0, chainCustoSemAtend = 0, chainNfSemAtend = 0;
  let chainPrazoSomaGlobal = 0, chainPrazoNGlobal = 0; // prazo ponderado de toda a cadeia
  for (const c of casos) {
    const best = c.candidatos.find((q) => !ehPropria(q.transportadora));
    if (best && best.total > 0) {
      const e = chainMap.get(best.transportadora) || { ctes: 0, custo: 0, prazoSoma: 0, prazoN: 0, nfSoma: 0 };
      e.ctes += 1; e.custo += best.total; e.nfSoma += c.valorNf;
      if (best.prazo > 0) { e.prazoSoma += best.prazo; e.prazoN += 1; chainPrazoSomaGlobal += best.prazo; chainPrazoNGlobal += 1; }
      chainMap.set(best.transportadora, e);
    } else {
      chainSemAtendimento += 1;
      chainCustoSemAtend += c.valorPago;
      chainNfSemAtend += c.valorNf;
      // sem candidata: usa o prazo real do CT-e na média global
      if (c.prazoReal > 0) { chainPrazoSomaGlobal += c.prazoReal; chainPrazoNGlobal += 1; }
    }
  }
  const coverageChain = [...chainMap.entries()]
    .map(([nome, e]) => ({ transportadora: nome, ctes: e.ctes, custo: e.custo, nfSoma: e.nfSoma, prazoMedio: e.prazoN > 0 ? e.prazoSoma / e.prazoN : null }))
    .sort((a, b) => b.ctes - a.ctes);
  const chainCustoTotal = coverageChain.reduce((s, e) => s + e.custo, 0) + chainCustoSemAtend;
  const chainNfTotal = coverageChain.reduce((s, e) => s + e.nfSoma, 0) + chainNfSemAtend;
  const chainPrazoMedio = chainPrazoNGlobal > 0 ? chainPrazoSomaGlobal / chainPrazoNGlobal : null;

  let melhorTotal = pagoTotal, substituta = null, cobertura = 0, prazoMelhorSoma = 0, prazoMelhorN = 0;

  if (scenarioMode === 'cteacte') {
    melhorTotal = 0;
    const mix = new Map();
    for (const c of casos) {
      const best = c.candidatos.find((q) => !ehPropria(q.transportadora)) || null; // melhor diferente (asc)
      if (best && best.total > 0 && best.total < c.valorPago - 0.001) {
        melhorTotal += best.total;
        mix.set(best.transportadora, (mix.get(best.transportadora) || 0) + 1);
        cobertura += 1;
        if (best.prazo > 0) { prazoMelhorSoma += best.prazo; prazoMelhorN += 1; }
      } else {
        melhorTotal += c.valorPago;
        if (c.prazoReal > 0) { prazoMelhorSoma += c.prazoReal; prazoMelhorN += 1; }
      }
    }
    substituta = [...mix.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  } else {
    // substituta: a melhor única transportadora (não cobertos ficam no pago)
    const melhor = ranking[0] || null;
    if (melhor && melhor.total < pagoTotal - 0.001) {
      melhorTotal = melhor.total;
      substituta = melhor.transportadora;
      cobertura = melhor.cobertos;
      // prazo médio do cenário substituto
      for (const c of casos) {
        const q = c.candMap.get(melhor.transportadora);
        const p = (q && q.prazo > 0) ? q.prazo : c.prazoReal;
        if (p > 0) { prazoMelhorSoma += p; prazoMelhorN += 1; }
      }
    } else {
      melhorTotal = pagoTotal;
      prazoMelhorSoma = prazoRealSoma; prazoMelhorN = prazoRealN;
    }
  }

  const reducaoRs = Math.round((pagoTotal - melhorTotal) * 100) / 100;
  return {
    ctes: casos.length,
    pagoTotal, melhorTotal, pesoTotal, nfTotal,
    freteNfPctAtual: nfTotal > 0 ? (pagoTotal / nfTotal) * 100 : null,
    freteNfPctMelhor: nfTotal > 0 ? (melhorTotal / nfTotal) * 100 : null,
    reducaoRs,
    reducaoPct: pagoTotal > 0 ? (reducaoRs / pagoTotal) * 100 : 0,
    substituta, cobertura,
    prazoRealMedio: prazoRealN > 0 ? prazoRealSoma / prazoRealN : null,
    prazoMelhorMedio: prazoMelhorN > 0 ? prazoMelhorSoma / prazoMelhorN : null,
    ranking: ranking.slice(0, 8),
    coverageChain,
    chainSemAtendimento,
    chainCustoTotal,
    chainPrazoMedio,
    chainNfPct: chainNfTotal > 0 ? (chainCustoTotal / chainNfTotal) * 100 : null,
  };
}

function gerarHtmlEmail({ resultado, scenarioMode, filtros, dataInicio, dataFim, competencia, canal }) {
  const periodoDesc = dataInicio || dataFim ? `${dataInicio || '?'} a ${dataFim || '?'}` : competencia || 'Todos os períodos';
  const cenarioDesc = scenarioMode === 'cteacte' ? 'Menor preço CT-e a CT-e' : 'Uma transportadora substituta';
  const linhasTodas = resultado.regioes.flatMap((r) => r.linhas);
  const semSubstituta = linhasTodas.filter((l) => !l.substituta);
  const cobParcial = linhasTodas.filter((l) => l.substituta && l.cobertura < l.ctes);

  const corPurple = '#4E008F';
  const corVerde = '#047857';
  const corVermelho = '#9b1111';
  const corCinza = '#64748b';

  const linhasHtml = resultado.regioes.map((reg) => {
    const regNfPct = reg.pagoTotal > 0 ? (reg.reducaoRs / reg.pagoTotal) * 100 : 0;
    const subTotal = `
      <tr>
        <td colspan="2" style="background:#ede9fe;padding:6px 10px;font-weight:800;color:${corPurple};letter-spacing:0.04em;font-size:11px">${reg.regiao}</td>
        <td style="background:#ede9fe;padding:6px 10px;text-align:right;font-weight:700;color:${corCinza};font-size:11px">${fmt(reg.pagoTotal)}</td>
        <td style="background:#ede9fe;padding:6px 10px;text-align:center;color:${corCinza};font-size:10px">—</td>
        <td style="background:#ede9fe;padding:6px 10px;text-align:right;font-weight:700;color:${corVerde};font-size:11px">${fmt(reg.melhorTotal)}</td>
        <td style="background:#ede9fe;padding:6px 10px;text-align:center;color:${corVerde};font-size:10px">—</td>
        <td style="background:#ede9fe;padding:6px 10px;text-align:right;font-weight:700;color:${corVermelho};font-size:11px">${fmt(reg.reducaoRs)}</td>
        <td style="background:#ede9fe;padding:6px 10px;text-align:center;font-weight:700;color:${corVermelho};font-size:11px">${pct(regNfPct)}</td>
        <td colspan="3" style="background:#ede9fe;padding:6px 10px;color:${corCinza};font-size:10px">${reg.linhas.length} linhas</td>
      </tr>`;
    const detalhes = reg.linhas.map((l) => {
      const semSub = !l.substituta;
      const parcial = l.substituta && l.cobertura < l.ctes;
      const bgRow = semSub ? '#fff7ed' : parcial ? '#fefce8' : '#ffffff';
      const alertaBadge = semSub
        ? `<span style="background:#fed7aa;color:#9a3412;border-radius:3px;padding:1px 6px;font-size:9px;font-weight:700;margin-left:6px">SEM SUBSTITUTA</span>`
        : parcial
          ? `<span style="background:#fef08a;color:#854d0e;border-radius:3px;padding:1px 6px;font-size:9px;font-weight:700;margin-left:6px">PARCIAL ${l.cobertura}/${l.ctes}</span>`
          : '';
      const prazo = `${l.prazoRealMedio != null ? l.prazoRealMedio.toFixed(1) + 'd' : '?'} → ${l.chainPrazoMedio != null ? l.chainPrazoMedio.toFixed(1) + 'd' : (l.prazoMelhorMedio != null ? l.prazoMelhorMedio.toFixed(1) + 'd' : '?')}`;
      const simPct = l.chainNfPct ?? l.freteNfPctMelhor;
      const deltaAtual = l.freteNfPctRef != null && l.freteNfPctAtual != null ? (l.freteNfPctAtual - l.freteNfPctRef) : null;
      const deltaSim = l.freteNfPctRef != null && simPct != null ? (simPct - l.freteNfPctRef) : null;
      const fmtDelta = (d) => d == null ? '—' : `<b style="color:${d > 0 ? corVermelho : corVerde}">${d > 0 ? '▲' : '▼'} ${d > 0 ? '+' : ''}${d.toFixed(1)}pp</b>`;
      return `<tr style="background:${bgRow}">
        <td style="padding:5px 10px;font-size:11px;font-weight:600;border-bottom:1px solid #f1f5f9">${l.transportadoraReal || '—'}</td>
        <td style="padding:5px 10px;font-size:11px;color:${corCinza};border-bottom:1px solid #f1f5f9">${l.cidadeOrigem || '—'} / ${l.ufOrigem}</td>
        <td style="padding:5px 10px;font-size:11px;text-align:center;background:#eff6ff;border-bottom:1px solid #f1f5f9">${l.freteNfPctRef != null ? `<b style="color:#1e3a5f">${pct(l.freteNfPctRef)}</b>` : '—'}</td>
        <td style="padding:5px 10px;font-size:11px;text-align:right;border-bottom:1px solid #f1f5f9">${fmt(l.pagoTotal)}</td>
        <td style="padding:5px 10px;font-size:11px;text-align:center;border-bottom:1px solid #f1f5f9">${l.freteNfPctAtual != null ? `<b style="color:${corCinza}">${pct(l.freteNfPctAtual)}</b>` : '—'}</td>
        <td style="padding:5px 10px;font-size:11px;text-align:center;border-bottom:1px solid #f1f5f9">${fmtDelta(deltaAtual)}</td>
        <td style="padding:5px 10px;font-size:11px;text-align:right;color:${corVerde};font-weight:600;border-bottom:1px solid #f1f5f9">${fmt(l.chainCustoTotal ?? l.melhorTotal)}</td>
        <td style="padding:5px 10px;font-size:11px;text-align:center;border-bottom:1px solid #f1f5f9">${simPct != null ? `<b style="color:${corVerde}">${pct(simPct)}</b>` : '—'}</td>
        <td style="padding:5px 10px;font-size:11px;text-align:center;border-bottom:1px solid #f1f5f9">${fmtDelta(deltaSim)}</td>
        <td style="padding:5px 10px;font-size:11px;text-align:right;color:${corVermelho};font-weight:700;border-bottom:1px solid #f1f5f9">${fmt(l.reducaoRs)}</td>
        <td style="padding:5px 10px;font-size:11px;border-bottom:1px solid #f1f5f9">${l.substituta || '—'}${alertaBadge}</td>
        <td style="padding:5px 10px;font-size:11px;text-align:center;color:${corCinza};border-bottom:1px solid #f1f5f9">${l.ctes > 1 ? `${l.cobertura}/${l.ctes}` : (l.substituta ? '1/1' : '—')}</td>
        <td style="padding:5px 10px;font-size:11px;text-align:center;color:${corCinza};border-bottom:1px solid #f1f5f9">${prazo}</td>
      </tr>`;
    }).join('');
    return subTotal + detalhes;
  }).join('');

  const alertasHtml = (semSubstituta.length + cobParcial.length) > 0 ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px">
      <tr><td style="background:#fff7ed;border-left:4px solid #f97316;border-radius:4px;padding:10px 16px">
        <div style="font-weight:700;color:#9a3412;font-size:11px;margin-bottom:6px">⚠ Casos sem cobertura total</div>
        ${semSubstituta.length ? `<div style="font-size:10px;color:#9a3412;margin-bottom:4px"><b>Sem substituta (${semSubstituta.length}):</b> ${semSubstituta.slice(0, 8).map((l) => `${l.transportadoraReal} / ${l.cidadeOrigem}-${l.ufOrigem}`).join(' · ')}${semSubstituta.length > 8 ? ` + ${semSubstituta.length - 8} outros` : ''}</div>` : ''}
        ${cobParcial.length ? `<div style="font-size:10px;color:#854d0e"><b>Cobertura parcial (${cobParcial.length}):</b> ${cobParcial.slice(0, 6).map((l) => `${l.transportadoraReal} / ${l.cidadeOrigem}-${l.ufOrigem} (${l.cobertura}/${l.ctes})`).join(' · ')}${cobParcial.length > 6 ? ` + ${cobParcial.length - 6} outros` : ''}</div>` : ''}
      </td></tr>
    </table>` : '';

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Oportunidade por Transportadora</title></head>
<body style="margin:0;padding:20px;font-family:Arial,Helvetica,sans-serif;background:#f8fafc;color:#1e293b">
<table width="680" cellpadding="0" cellspacing="0" style="margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
  <tr><td style="background:${corPurple};padding:22px 28px">
    <div style="font-size:18px;font-weight:800;color:#fff;margin-bottom:4px">Oportunidade por Transportadora</div>
    <div style="font-size:11px;color:#c4b5fd">Central de Fretes · ${new Date().toLocaleDateString('pt-BR')}</div>
  </td></tr>
  <tr><td style="padding:20px 28px">

    <!-- Filtros -->
    <div style="font-size:10px;color:${corCinza};margin-bottom:16px">
      Período: <b>${periodoDesc}</b> &nbsp;·&nbsp; Canal: <b>${canal || 'Todos'}</b> &nbsp;·&nbsp; Cenário: <b>${cenarioDesc}</b>
      ${filtros.regioes.length ? ` &nbsp;·&nbsp; Regiões: <b>${filtros.regioes.join(', ')}</b>` : ''}
      ${filtros.ufsOrigem.length ? ` &nbsp;·&nbsp; UFs: <b>${filtros.ufsOrigem.join(', ')}</b>` : ''}
    </div>

    <!-- Cards de resumo -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px">
      <tr>
        <td width="25%" style="padding-right:8px">
          <div style="border:1px solid #e2e8f0;border-left:4px solid ${corPurple};border-radius:6px;padding:10px 14px">
            <div style="font-size:9px;color:${corCinza};font-weight:700;text-transform:uppercase;margin-bottom:3px">Frete atual</div>
            <div style="font-size:16px;font-weight:800;color:#1e293b">${fmt(resultado.pagoTotal)}</div>
            <div style="font-size:9px;color:#94a3b8">${fmtN(resultado.totalCtes)} CT-es</div>
          </div>
        </td>
        <td width="25%" style="padding-right:8px">
          <div style="border:1px solid #e2e8f0;border-left:4px solid ${corVerde};border-radius:6px;padding:10px 14px">
            <div style="font-size:9px;color:${corCinza};font-weight:700;text-transform:uppercase;margin-bottom:3px">Melhor cenário</div>
            <div style="font-size:16px;font-weight:800;color:${corVerde}">${fmt(resultado.melhorTotal)}</div>
            <div style="font-size:9px;color:#94a3b8">${cenarioDesc}</div>
          </div>
        </td>
        <td width="25%" style="padding-right:8px">
          <div style="border:1px solid #e2e8f0;border-left:4px solid ${corVermelho};border-radius:6px;padding:10px 14px">
            <div style="font-size:9px;color:${corCinza};font-weight:700;text-transform:uppercase;margin-bottom:3px">Redução potencial</div>
            <div style="font-size:16px;font-weight:800;color:${corVermelho}">${fmt(resultado.reducaoTotal)}</div>
            <div style="font-size:9px;color:#94a3b8">${pct(resultado.reducaoPct)} do frete atual</div>
          </div>
        </td>
        <td width="25%">
          <div style="border:1px solid #e2e8f0;border-left:4px solid #94a3b8;border-radius:6px;padding:10px 14px">
            <div style="font-size:9px;color:${corCinza};font-weight:700;text-transform:uppercase;margin-bottom:3px">Linhas</div>
            <div style="font-size:16px;font-weight:800;color:#1e293b">${fmtN(resultado.totalLinhas)}</div>
            <div style="font-size:9px;color:#94a3b8">${semSubstituta.length} sem sub · ${cobParcial.length} parcial</div>
          </div>
        </td>
      </tr>
    </table>

    ${alertasHtml}

    <!-- Tabela de detalhamento -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:11px">
      <thead>
        <tr style="background:${corPurple}">
          <th style="padding:7px 10px;text-align:left;color:#fff;font-size:10px;font-weight:700">Transportadora</th>
          <th style="padding:7px 10px;text-align:left;color:#fff;font-size:10px;font-weight:700">Origem</th>
          <th style="padding:7px 10px;text-align:center;color:#93c5fd;font-size:10px;font-weight:700">% NF jan/26</th>
          <th style="padding:7px 10px;text-align:right;color:#fff;font-size:10px;font-weight:700">Frete atual (R$)</th>
          <th style="padding:7px 10px;text-align:center;color:#fff;font-size:10px;font-weight:700">% NF atual</th>
          <th style="padding:7px 10px;text-align:center;color:#fff;font-size:10px;font-weight:700">Δ jan→atual</th>
          <th style="padding:7px 10px;text-align:right;color:#fff;font-size:10px;font-weight:700">Simulado (R$)</th>
          <th style="padding:7px 10px;text-align:center;color:#fff;font-size:10px;font-weight:700">% NF sim.</th>
          <th style="padding:7px 10px;text-align:center;color:#fff;font-size:10px;font-weight:700">Δ jan→sim.</th>
          <th style="padding:7px 10px;text-align:right;color:#fff;font-size:10px;font-weight:700">Redução R$</th>
          <th style="padding:7px 10px;text-align:left;color:#fff;font-size:10px;font-weight:700">Substituta</th>
          <th style="padding:7px 10px;text-align:center;color:#fff;font-size:10px;font-weight:700">Cobertura</th>
          <th style="padding:7px 10px;text-align:center;color:#fff;font-size:10px;font-weight:700">Prazo</th>
        </tr>
      </thead>
      <tbody>${linhasHtml}</tbody>
    </table>

    <div style="margin-top:12px;font-size:9px;color:#94a3b8">
      🟡 Amarelo = cobertura parcial &nbsp;·&nbsp; 🟠 Laranja = sem substituta encontrada
    </div>
  </td></tr>
  <tr><td style="background:#f8fafc;padding:12px 28px;font-size:9px;color:#94a3b8;border-top:1px solid #e2e8f0">
    Central de Fretes · gerado em ${new Date().toLocaleString('pt-BR')}
  </td></tr>
</table>
</body></html>`;
  return html;
}

function exportarExcel({ resultado, scenarioMode, filtros, dataInicio, dataFim, competencia, canal }) {
  const periodoDesc = dataInicio || dataFim
    ? `${dataInicio || '?'} a ${dataFim || '?'}`
    : competencia || 'Todos';
  const cenarioDesc = scenarioMode === 'cteacte' ? 'CT-e a CT-e' : 'Substituta';

  const linhasTodas = resultado.regioes.flatMap((r) => r.linhas);

  // Aba principal — uma linha por transportadora × origem
  const dados = linhasTodas.map((l) => {
    const semSub = !l.substituta;
    const cobParcial = l.substituta && l.cobertura < l.ctes;
    const alerta = semSub ? 'SEM SUBSTITUTA' : cobParcial ? `COBERTURA PARCIAL (${l.cobertura}/${l.ctes})` : '';
    return {
      Região: l.regiao,
      Transportadora: l.transportadoraReal || '',
      Origem: l.cidadeOrigem || '',
      UF: l.ufOrigem,
      'CT-es': l.ctes,
      '% NF referência (jan)': l.freteNfPctRef != null ? l.freteNfPctRef / 100 : '',
      'Frete atual (R$)': l.pagoTotal,
      'Frete % NF atual': l.freteNfPctAtual != null ? l.freteNfPctAtual / 100 : '',
      'Δ jan→atual (pp)': l.freteNfPctRef != null && l.freteNfPctAtual != null ? (l.freteNfPctAtual - l.freteNfPctRef) / 100 : '',
      'Melhor cenário (R$)': l.melhorTotal,
      'Frete % NF melhor': l.freteNfPctMelhor != null ? l.freteNfPctMelhor / 100 : '',
      'Combinado (R$)': l.chainCustoTotal != null ? l.chainCustoTotal : '',
      'Frete % NF combinado': l.chainNfPct != null ? l.chainNfPct / 100 : '',
      'Δ jan→simulado (pp)': (() => { const s = l.chainNfPct ?? l.freteNfPctMelhor; return l.freteNfPctRef != null && s != null ? (s - l.freteNfPctRef) / 100 : ''; })(),
      'Sem atendimento (CT-es)': l.chainSemAtendimento || 0,
      'Redução (R$)': l.reducaoRs,
      'Redução (%)': l.reducaoPct / 100,
      Substituta: l.substituta || '',
      'Cobertura substituta': l.substituta ? `${l.cobertura}/${l.ctes}` : '',
      Alerta: alerta,
      'Prazo real (d)': l.prazoRealMedio != null ? l.prazoRealMedio : '',
      'Prazo melhor (d)': l.prazoMelhorMedio != null ? l.prazoMelhorMedio : '',
    };
  });

  const ws = XLSX.utils.json_to_sheet(dados);

  // Formata colunas de moeda e percentual
  // Colunas (0-based): 0=Região,1=Transp,2=Origem,3=UF,4=CTes,5=FreteAtualR$,6=FreteNFAtual%,7=MelhorR$,8=MelhorNF%,9=CombinadoR$,10=CombinadoNF%,11=SemAtend,12=ReducaoR$,13=Reducao%,...
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const colMoeda = [5, 7, 9, 12];
  const colPct   = [6, 8, 10, 13];
  for (let R = range.s.r + 1; R <= range.e.r; R++) {
    for (const C of colMoeda) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (ws[addr]) ws[addr].z = 'R$ #,##0.00';
    }
    for (const C of colPct) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (ws[addr]) ws[addr].z = '0.0%';
    }
  }

  // Largura das colunas
  ws['!cols'] = [
    { wch: 12 }, { wch: 40 }, { wch: 24 }, { wch: 5 }, { wch: 8 },
    { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
    { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 10 },
    { wch: 36 }, { wch: 18 }, { wch: 26 }, { wch: 12 }, { wch: 14 },
  ];

  // Aba de resumo
  const resumo = [
    ['Oportunidade por Transportadora — Resumo'],
    [],
    ['Período', periodoDesc],
    ['Canal', canal || 'Todos'],
    ['Cenário', cenarioDesc],
    ['Filtro regiões', filtros.regioes.join(', ') || 'Todos'],
    ['Filtro UFs', filtros.ufsOrigem.join(', ') || 'Todas'],
    [],
    ['Frete atual (R$)', resultado.pagoTotal],
    ['Melhor cenário (R$)', resultado.melhorTotal],
    ['Redução potencial (R$)', resultado.reducaoTotal],
    ['Redução potencial (%)', resultado.reducaoPct / 100],
    [],
    ['Linhas analisadas', resultado.totalLinhas],
    ['Sem substituta', linhasTodas.filter((l) => !l.substituta).length],
    ['Cobertura parcial', linhasTodas.filter((l) => l.substituta && l.cobertura < l.ctes).length],
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
  wsResumo['!cols'] = [{ wch: 26 }, { wch: 30 }];
  // formato moeda/pct nas células de valor
  [[8,1],[9,1],[10,1]].forEach(([r,c]) => { const a = XLSX.utils.encode_cell({r,c}); if (wsResumo[a]) wsResumo[a].z = 'R$ #,##0.00'; });
  [[11,1]].forEach(([r,c]) => { const a = XLSX.utils.encode_cell({r,c}); if (wsResumo[a]) wsResumo[a].z = '0.0%'; });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');
  XLSX.utils.book_append_sheet(wb, ws, 'Detalhamento');

  const dataArq = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `oportunidade-transportadora-${dataArq}.xlsx`);
}

function valorMetrica(metrica, totalRs, pesoTotal, nfTotal, ctes) {
  if (metrica === 'rs') return totalRs;
  if (metrica === 'freteNf') return nfTotal > 0 ? (totalRs / nfTotal) * 100 : null;
  if (metrica === 'rskg') return pesoTotal > 0 ? totalRs / pesoTotal : null;
  if (metrica === 'rscte') return ctes > 0 ? totalRs / ctes : null;
  return totalRs;
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

function Segmentado({ opcoes, valor, onChange }) {
  return (
    <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, background: '#f1f5f9', borderRadius: 8, padding: 3 }}>
      {opcoes.map((o) => (
        <button key={o.id} type="button" title={o.dica || ''} onClick={() => onChange(o.id)}
          style={{ border: 'none', cursor: 'pointer', borderRadius: 6, padding: '5px 12px', fontSize: '0.8rem', fontWeight: valor === o.id ? 700 : 500, background: valor === o.id ? '#9153F0' : 'transparent', color: valor === o.id ? '#fff' : '#475569' }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MultiFiltro({ label, opcoes, selecionados, onChange }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const sel = selecionados.length;
  const toggle = (op) => onChange(selecionados.includes(op) ? selecionados.filter((x) => x !== op) : [...selecionados, op]);
  const buscaNorm = busca.trim().toLowerCase();
  const filtradas = buscaNorm ? opcoes.filter((o) => String(o || '').toLowerCase().includes(buscaNorm)) : opcoes;
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setAberto((v) => !v)}
        style={{ width: '100%', textAlign: 'left', padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: sel ? '#f5f3ff' : '#fff', fontSize: '0.82rem', cursor: 'pointer', color: '#334155' }}>
        {label}: <strong>{sel ? `${sel} de ${opcoes.length}` : 'Todos'}</strong> {aberto ? '▲' : '▼'}
      </button>
      {aberto && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 6 }}>
          <input
            type="text"
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar transportadora..."
            style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '0.8rem', marginBottom: 6 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 6, borderBottom: '1px solid #eee', paddingBottom: 6 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => onChange([...new Set([...selecionados, ...filtradas])])} style={{ fontSize: '0.72rem', cursor: 'pointer', border: 'none', background: 'none', color: '#9153F0' }}>Marcar listados</button>
              <button type="button" onClick={() => onChange([])} style={{ fontSize: '0.72rem', cursor: 'pointer', border: 'none', background: 'none', color: '#9153F0' }}>Limpar</button>
            </div>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{fmtN(filtradas.length)}{sel ? ` · ${sel} marcadas` : ''}</span>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {filtradas.slice(0, 400).map((op) => {
              const marcada = selecionados.includes(op);
              return (
                <label key={op} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', textAlign: 'left', gap: 8, padding: '4px 6px', fontSize: '0.8rem', cursor: 'pointer', borderRadius: 4, background: marcada ? '#f5f3ff' : 'transparent' }}>
                  <input type="checkbox" checked={marcada} onChange={() => toggle(op)} style={{ margin: 0, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: marcada ? 700 : 500, color: marcada ? '#6d28d9' : '#334155' }}>{op || '(vazio)'}</span>
                </label>
              );
            })}
            {!filtradas.length && <div style={{ fontSize: '0.78rem', color: '#94a3b8', padding: 4 }}>Nada encontrado.</div>}
            {filtradas.length > 400 && <div style={{ fontSize: '0.72rem', color: '#94a3b8', padding: 4 }}>Mostrando 400 de {fmtN(filtradas.length)}. Refine a busca.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OportunidadeTransportadoraPage() {
  const [competencia, setCompetencia] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [canal, setCanal] = useState('');
  const [limiteInput, setLimiteInput] = useState('4000');
  const [refCompetencia, setRefCompetencia] = useState('2026-01'); // período de referência (ex: antes dos reajustes)
  const [mostrarSimulado, setMostrarSimulado] = useState(true);

  const [status, setStatus] = useState('idle');
  const [progresso, setProgresso] = useState('');
  const [processamentoUi, setProcessamentoUi] = useState({ titulo: '', mensagem: '', percentual: 0 });
  const [erro, setErro] = useState('');
  const [bruto, setBruto] = useState(null); // { casos, carriersByOrigin, carriersByRoute, totalCtes, diagTotal }

  const [candidateMode, setCandidateMode] = useState('qualquer');
  const [scenarioMode, setScenarioMode] = useState('substituta');
  const [metrica, setMetrica] = useState('rs');
  const [filtros, setFiltros] = useState(FILTROS_PADRAO);
  const [excluidas, setExcluidas] = useState(carregarExcluidasOportunidade);
  const [expandido, setExpandido] = useState(null);
  const [buscaVinculo, setBuscaVinculo] = useState('');

  // Persiste a lista de transportadoras excluídas (sujeira) no navegador.
  useEffect(() => {
    try { localStorage.setItem(EXCLUIDAS_OPORTUNIDADE_KEY, JSON.stringify(excluidas)); } catch { /* ignora */ }
  }, [excluidas]);

  const excluidasSet = useMemo(() => new Set(excluidas.map((n) => norm(n))), [excluidas]);

  const setF = (k, v) => setFiltros((p) => ({ ...p, [k]: v }));

  async function processar() {
    setStatus('carregando'); setErro(''); setBruto(null); setExpandido(null);
    setFiltros((p) => ({ ...FILTROS_PADRAO, soComReducao: p.soComReducao }));
    setProcessamentoUi({
      titulo: 'Oportunidade por Transportadora',
      mensagem: 'Preparando analise de custo realizado versus melhor cenario...',
      percentual: 8,
    });
    try {
      setProgresso('Carregando planilha de IBGE...');
      setProcessamentoUi((p) => ({ ...p, mensagem: 'Carregando base de municipios e codigos IBGE...', percentual: 14 }));
      const municipios = await carregarMunicipiosIbgeDb().catch(() => []);
      const mapasIbge = montarMapasIbge(municipios);
      const municipioPorCidade = montarMunicipioPorCidade(municipios);

      setProgresso('Carregando CT-es...');
      setProcessamentoUi((p) => ({ ...p, mensagem: 'Buscando CT-es realizados para o recorte selecionado...', percentual: 24 }));
      const ctes = await carregarCtes({
        competencia,
        dataInicio: dataInicio || undefined,
        dataFim: dataFim || undefined,
        canal: canal || undefined,
        limite: Number(limiteInput) || 4000,
        onProgress: ({ carregados }) => {
          setProgresso(`Carregando CT-es... ${carregados}`);
          setProcessamentoUi((p) => ({
            ...p,
            mensagem: `Buscando CT-es realizados... ${fmtN(carregados)} carregados`,
            percentual: Math.min(45, 24 + Math.floor(carregados / 500)),
          }));
        },
      });
      if (!ctes.length) throw new Error(MSG_SEM_CTES);

      const routeKeys = montarRouteKeysCtes(ctes, municipioPorCidade, mapasIbge, canal || '');
      if (!routeKeys.length) throw new Error('CT-es encontrados, mas sem IBGE de origem e destino para buscar as tabelas.');

      setProgresso(`Carregando tabelas de frete para ${fmtN(routeKeys.length)} rota(s)...`);
      setProcessamentoUi((p) => ({
        ...p,
        mensagem: `Carregando tabelas de frete para ${fmtN(routeKeys.length)} rota(s) do recorte...`,
        percentual: 48,
      }));
      const base = normalizarTransportadoras(await buscarBaseSimulacaoPorRotasDb({ routeKeys, canal: canal || '' }));
      if (!base.length) throw new Error('CT-es encontrados, mas nenhuma tabela de frete foi localizada para as rotas do recorte.');
      const idx = indexarBase(base);
      const mapBaseByNome = new Map(base.map((t) => [t.nome, t]));
      const origemCache = new Map();

      const casos = [];
      const carriersByOrigin = new Map();
      const carriersByRoute = new Map();
      const diagTotal = { CALCULADO: 0, SEM_TABELA: 0, SEM_ORIGEM: 0, SEM_ROTA: 0, SEM_FAIXA: 0, ORIGEM_ERRADA: 0, OUTRO: 0, SEM_IBGE: 0 };

      setProgresso(`Simulando ${fmtN(ctes.length)} CT-es contra as transportadoras de cada origem...`);
      setProcessamentoUi((p) => ({
        ...p,
        mensagem: `Simulando ${fmtN(ctes.length)} CT-es contra as transportadoras da mesma origem...`,
        percentual: 58,
      }));
      const t0 = Date.now();
      for (let i = 0; i < ctes.length; i++) {
        const cte = ctes[i];
        const cidadeOrigem = cte.cidade_origem || cte.origem || '';
        const ufOrigem = String(cte.uf_origem || '').toUpperCase();
        const cidadeDestino = cte.cidade_destino || cte.destino || '';
        const ufDestino = String(cte.uf_destino || '').toUpperCase();
        const transportadoraReal = (cte.transportadora || cte.nome_transportadora || '').trim();
        const valorPago = safeNum(cte.valor_cte || cte.frete_pago || cte.valor_frete);

        const ibgeDestino = ibgeDoCte(cte, 'destino', municipioPorCidade, mapasIbge);
        const ibgeOrigemReal = ibgeDoCte(cte, 'origem', municipioPorCidade, mapasIbge);

        const originKey = `${norm(cidadeOrigem)}|${ufOrigem}`;
        const routeKey = `${originKey}=>${norm(cidadeDestino)}|${ufDestino}`;
        if (transportadoraReal) {
          if (!carriersByOrigin.has(originKey)) carriersByOrigin.set(originKey, new Set());
          carriersByOrigin.get(originKey).add(norm(transportadoraReal));
          if (!carriersByRoute.has(routeKey)) carriersByRoute.set(routeKey, new Set());
          carriersByRoute.get(routeKey).add(norm(transportadoraReal));
        }

        let custos = [];
        if (!ibgeDestino || !ibgeOrigemReal) {
          diagTotal.SEM_IBGE += 1;
        } else {
          // só roda o motor nas transportadoras que atendem origem E têm rota pro destino
          const setOrigem = nomesPorOrigem(idx, dig7(ibgeOrigemReal), normCmp(cidadeOrigem), origemCache);
          const setDestino = idx.porDestinoIbge.get(dig7(ibgeDestino));
          const candidatas = [];
          if (setDestino) for (const nome of setOrigem) if (setDestino.has(nome)) { const t = mapBaseByNome.get(nome); if (t) candidatas.push(t); }
          const { resultados, statusCounts } = simularTodas(cte, candidatas, ibgeOrigemReal, ibgeDestino, cidadeOrigem);
          for (const [k, v] of Object.entries(statusCounts)) diagTotal[k] = (diagTotal[k] || 0) + v;
          custos = resultados;
        }

        casos.push({
          transportadoraReal, cidadeOrigem, ufOrigem, cidadeDestino, ufDestino,
          regiao: regiaoDeUf(ufOrigem),
          originKey, routeKey,
          peso: safeNum(cte.peso_declarado || cte.peso),
          valorNf: safeNum(cte.valor_nf || cte.nf_venda),
          valorPago,
          prazoReal: safeNum(custos.find((c) => mesmaTransportadora(c.transportadora, transportadoraReal))?.prazo),
          custos,
        });

        if (i % 100 === 0 || i === ctes.length - 1) {
          const feitos = i + 1;
          const pctFeito = Math.round((feitos / ctes.length) * 100);
          const decorrido = (Date.now() - t0) / 1000;
          const restante = feitos > 0 ? (decorrido / feitos) * (ctes.length - feitos) : 0;
          const tempo = (s) => (s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.round(s)}s`);
          setProgresso(`Simulando... ${fmtN(feitos)}/${fmtN(ctes.length)} (${pctFeito}%) · ${tempo(decorrido)} decorridos${restante > 0 ? ` · ~${tempo(restante)} restantes` : ''}`);
          setProcessamentoUi((p) => ({
            ...p,
            mensagem: `Simulando... ${fmtN(feitos)}/${fmtN(ctes.length)} (${pctFeito}%)`,
            percentual: Math.min(96, 58 + Math.floor(pctFeito * 0.38)),
          }));
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      setProcessamentoUi((p) => ({ ...p, mensagem: 'Montando resultado por transportadora e origem...', percentual: 100 }));
      const baseNomes = base.map((t) => t.nome).sort((a, b) => a.localeCompare(b, 'pt-BR'));

      // Carrega CT-es de referência para comparar % NF antes dos reajustes
      let refMap = new Map(); // "normTransp|originKey" -> { pagoTotal, nfTotal, ctes }
      if (refCompetencia) {
        setProcessamentoUi((p) => ({ ...p, mensagem: `Carregando período de referência (${refCompetencia})...`, percentual: 97 }));
        const ctesRef = await carregarCtes({ competencia: refCompetencia, canal: canal || undefined, limite: 8000 }).catch(() => []);
        for (const c of ctesRef) {
          const transpNorm = norm(c.transportadora || c.nome_transportadora || '');
          const cidadeOrigem = c.cidade_origem || c.origem || '';
          const ufOrigem = String(c.uf_origem || '').toUpperCase();
          const originKey = `${norm(cidadeOrigem)}|${ufOrigem}`;
          const k = `${transpNorm}|${originKey}`;
          const e = refMap.get(k) || { pagoTotal: 0, nfTotal: 0, ctes: 0 };
          e.pagoTotal += safeNum(c.valor_cte || c.frete_pago || c.valor_frete);
          e.nfTotal += safeNum(c.valor_nf || c.nf_venda);
          e.ctes += 1;
          refMap.set(k, e);
        }
      }

      // Carrega reajustes para cruzar com o realizado
      const reajustesRaw = await carregarReajustesSupabase().catch(() => []);
      // Lista de nomes de transportadoras com reajuste (para usar mesmaTransportadora)
      const reajustesNomes = [...new Set(
        reajustesRaw.flatMap((r) => [r.transportadoraSistema, r.transportadoraInformada].filter(Boolean))
      )];
      // Mapa nome -> lista de reajustes para mostrar detalhes no hover
      const reajustesMap = new Map();
      for (const r of reajustesRaw) {
        for (const nome of [r.transportadoraSistema, r.transportadoraInformada].filter(Boolean)) {
          const k = norm(nome);
          if (!reajustesMap.has(k)) reajustesMap.set(k, []);
          reajustesMap.get(k).push(r);
        }
      }
      // Set lazy: checagem real usa mesmaTransportadora no render, aqui guardamos os nomes brutos
      const reajustesSet = reajustesNomes;

      setBruto({ casos, carriersByOrigin, carriersByRoute, totalCtes: ctes.length, diagTotal, baseNomes, reajustesSet, reajustesMap, refMap, refCompetencia });
      setStatus('concluido'); setProgresso(''); setProcessamentoUi({ titulo: '', mensagem: '', percentual: 0 });
    } catch (e) {
      console.error('[OportunidadeTransportadora]', e);
      setErro(mensagemAmigavelErro(e));
      setStatus('erro'); setProgresso(''); setProcessamentoUi({ titulo: '', mensagem: '', percentual: 0 });
    }
  }

  const opcoes = useMemo(() => {
    if (!bruto) return { regioes: [], ufsOrigem: [], transpReal: [] };
    const reg = new Set(), uf = new Set(), tr = new Set();
    for (const c of bruto.casos) {
      if (c.regiao) reg.add(c.regiao);
      if (c.ufOrigem) uf.add(c.ufOrigem);
      if (c.transportadoraReal) tr.add(c.transportadoraReal);
    }
    return {
      regioes: ORDEM_REGIAO.filter((r) => reg.has(r)),
      ufsOrigem: Array.from(uf).sort(),
      transpReal: Array.from(tr).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    };
  }, [bruto]);

  const resultado = useMemo(() => {
    if (!bruto) return null;

    // 1) filtra casos e monta candidatas por modo
    const grupos = new Map();
    for (const c of bruto.casos) {
      if (excluidasSet.has(norm(c.transportadoraReal))) continue;
      if (!passaLista(c.regiao, filtros.regioes)) continue;
      if (!passaLista(c.ufOrigem, filtros.ufsOrigem)) continue;
      if (!passaLista(c.transportadoraReal, filtros.transportadorasRealizadas)) continue;

      let candidatos = c.custos;
      if (candidateMode === 'area') {
        const set = bruto.carriersByOrigin.get(c.originKey);
        candidatos = set ? candidatos.filter((q) => set.has(norm(q.transportadora))) : [];
      } else if (candidateMode === 'rota') {
        const set = bruto.carriersByRoute.get(c.routeKey);
        candidatos = set ? candidatos.filter((q) => set.has(norm(q.transportadora))) : [];
      }
      const candMap = new Map();
      for (const q of candidatos) candMap.set(q.transportadora, q);
      const caso = { ...c, candidatos, candMap };

      const key = `${c.transportadoraReal}|${c.originKey}`;
      if (!grupos.has(key)) grupos.set(key, { key, transportadoraReal: c.transportadoraReal, cidadeOrigem: c.cidadeOrigem, ufOrigem: c.ufOrigem, regiao: c.regiao, originKey: c.originKey, casos: [] });
      grupos.get(key).casos.push(caso);
    }

    // 2) calcula cada grupo
    const refMap = bruto.refMap || new Map();
    let linhas = Array.from(grupos.values()).map((g) => {
      const calc = calcularGrupo(g.casos, scenarioMode, g.transportadoraReal);
      // % NF de referência: busca pelo nome normalizado da transportadora × mesma origem
      const transpNorm = norm(g.transportadoraReal);
      const refKey = `${transpNorm}|${g.originKey}`;
      const refEntry = refMap.get(refKey);
      const freteNfPctRef = refEntry && refEntry.nfTotal > 0 ? (refEntry.pagoTotal / refEntry.nfTotal) * 100 : null;
      return {
        ...g,
        ...calc,
        freteNfPctRef,
        refCtes: refEntry?.ctes || 0,
        custoAtual: valorMetrica(metrica, calc.pagoTotal, calc.pesoTotal, calc.nfTotal, calc.ctes),
        custoMelhor: valorMetrica(metrica, calc.melhorTotal, calc.pesoTotal, calc.nfTotal, calc.ctes),
      };
    });
    if (filtros.soComReducao) linhas = linhas.filter((l) => l.reducaoRs > TOLERANCIA);
    linhas.sort((a, b) => b.reducaoRs - a.reducaoRs);

    // 3) agrupa por região (com subtotais)
    const porRegiao = new Map();
    for (const l of linhas) {
      if (!porRegiao.has(l.regiao)) porRegiao.set(l.regiao, { regiao: l.regiao, linhas: [], pagoTotal: 0, melhorTotal: 0, reducaoRs: 0 });
      const r = porRegiao.get(l.regiao);
      r.linhas.push(l); r.pagoTotal += l.pagoTotal; r.melhorTotal += l.melhorTotal; r.reducaoRs += l.reducaoRs;
    }
    const regioes = ORDEM_REGIAO.filter((r) => porRegiao.has(r)).map((r) => porRegiao.get(r));

    const pagoTotal = linhas.reduce((s, l) => s + l.pagoTotal, 0);
    const melhorTotal = linhas.reduce((s, l) => s + l.melhorTotal, 0);
    const reducaoTotal = Math.round((pagoTotal - melhorTotal) * 100) / 100;

    return {
      regioes, totalLinhas: linhas.length, totalCtes: bruto.totalCtes,
      pagoTotal, melhorTotal, reducaoTotal,
      reducaoPct: pagoTotal > 0 ? (reducaoTotal / pagoTotal) * 100 : 0,
      diagTotal: bruto.diagTotal,
      reajustesSet: bruto.reajustesSet || new Set(),
      reajustesMap: bruto.reajustesMap || new Map(),
      refCompetencia: bruto.refCompetencia || '',
    };
  }, [bruto, filtros, excluidasSet, candidateMode, scenarioMode, metrica]);

  const filtrosAtivos = filtros.regioes.length || filtros.ufsOrigem.length || filtros.transportadorasRealizadas.length;
  const metricaLabel = METRICAS.find((m) => m.id === metrica)?.label || '';

  function abrirRelatorio() {
    if (!resultado) return;
    exportarExcel({ resultado, scenarioMode, filtros, dataInicio, dataFim, competencia, canal });
  }

  function abrirHtmlEmail() {
    if (!resultado) return;
    const html = gerarHtmlEmail({ resultado, scenarioMode, filtros, dataInicio, dataFim, competencia, canal });
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  }

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Análise</div>
        <h1>Oportunidade por Transportadora</h1>
        <p>Custo realizado vs. melhor cenário simulado, por transportadora e origem — mesma origem, trocando quem opera. Alvo de redução para a negociação puxada pela baixa do diesel.</p>
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
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
          <label>Limite de CT-es <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.72rem' }}>(só sem mês/período)</span>
            <input type="number" value={limiteInput} onChange={(e) => setLimiteInput(e.target.value)} min={100} max={200000} step={1000} />
          </label>
          <label>Referência (% NF antes reajuste) <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.72rem' }}>mês base</span>
            <input type="month" value={refCompetencia} onChange={(e) => setRefCompetencia(e.target.value)} />
          </label>
          <label style={{ cursor: 'pointer', userSelect: 'none' }}>
            <span style={{ fontWeight: 500, fontSize: '0.82rem' }}>Exibir colunas simulado</span>
            <div style={{ marginTop: 6 }}>
              <input type="checkbox" checked={mostrarSimulado} onChange={(e) => setMostrarSimulado(e.target.checked)} style={{ marginRight: 6, cursor: 'pointer' }} />
              <span style={{ fontSize: '0.8rem', color: mostrarSimulado ? '#4E008F' : '#94a3b8' }}>{mostrarSimulado ? 'Visível' : 'Oculto'}</span>
            </div>
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="primary" type="button" onClick={processar} disabled={status === 'carregando'}>
              {status === 'carregando' ? 'Processando...' : 'Analisar oportunidade'}
            </button>
            {bruto && <button className="sim-tab" type="button" onClick={() => { setBruto(null); setStatus('idle'); }}>Limpar</button>}
          </div>
        </div>

        {status === 'carregando' && (
          <div className="sim-processing-strip" aria-live="polite" style={{ marginTop: 12 }}>
            <div>
              <strong>{processamentoUi.titulo || 'Oportunidade por Transportadora'}</strong>
              <span>{processamentoUi.mensagem || progresso || 'Processando análise...'}</span>
            </div>
            <strong>{Math.max(1, Math.min(processamentoUi.percentual || 1, 100))}%</strong>
          </div>
        )}
      </section>

      {status === 'carregando' && (
        <div className="brand-processing-overlay" role="status" aria-live="polite">
          <div className="brand-processing-card">
            <div className="brand-processing-logo-wrap">
              <img src={amdLogo} alt="AMD LOG" />
            </div>
            <strong>{processamentoUi.titulo || 'Oportunidade por Transportadora'}</strong>
            <span>{processamentoUi.mensagem || progresso || 'Processando análise...'}</span>
            <div className="brand-processing-bar" aria-hidden="true">
              <div style={{ width: `${Math.max(6, Math.min(processamentoUi.percentual || 6, 100))}%` }} />
            </div>
            <em>{Math.max(1, Math.min(processamentoUi.percentual || 1, 100))}%</em>
            <small>A análise pode levar mais tempo quando houver muitos CT-es, rotas e transportadoras candidatas.</small>
          </div>
        </div>
      )}

      {resultado && (
        <>
          {/* Painel de controle do cenário */}
          <section className="sim-card" style={{ marginBottom: '1rem' }}>
            <strong style={{ fontSize: '0.9rem', color: '#334155', display: 'block', marginBottom: 10 }}>Painel de cenário</strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: '#64748b', width: 120 }}>Quem pode substituir</span>
                <Segmentado opcoes={MODOS_CANDIDATA} valor={candidateMode} onChange={setCandidateMode} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: '#64748b', width: 120 }}>Melhor cenário</span>
                <Segmentado opcoes={MODOS_CENARIO} valor={scenarioMode} onChange={setScenarioMode} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: '#64748b', width: 120 }}>Métrica exibida</span>
                <Segmentado opcoes={METRICAS} valor={metrica} onChange={setMetrica} />
              </div>
            </div>
          </section>

          {/* Filtros */}
          <section className="sim-card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <strong style={{ fontSize: '0.9rem', color: '#334155' }}>Filtros</strong>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={filtros.soComReducao} onChange={(e) => setF('soComReducao', e.target.checked)} />
                  Apenas com redução
                </label>
                {filtrosAtivos ? <button type="button" className="sim-tab" onClick={() => setFiltros((p) => ({ ...FILTROS_PADRAO, soComReducao: p.soComReducao }))}>Limpar filtros</button> : null}
              </div>
            </div>
            <div className="sim-form-grid sim-grid-4" style={{ gap: 10 }}>
              <MultiFiltro label="Região" opcoes={opcoes.regioes} selecionados={filtros.regioes} onChange={(v) => setF('regioes', v)} />
              <MultiFiltro label="UF origem" opcoes={opcoes.ufsOrigem} selecionados={filtros.ufsOrigem} onChange={(v) => setF('ufsOrigem', v)} />
              <MultiFiltro label="Transportadora realizada" opcoes={opcoes.transpReal} selecionados={filtros.transportadorasRealizadas} onChange={(v) => setF('transportadorasRealizadas', v)} />
              <MultiFiltro
                label={`Excluir transportadora (sujeira)${excluidas.length ? ` · ${excluidas.length} salva(s)` : ''}`}
                opcoes={opcoes.transpReal}
                selecionados={excluidas}
                onChange={setExcluidas}
              />
              {excluidas.length ? (
                <button type="button" className="sim-tab" onClick={() => setExcluidas([])} style={{ alignSelf: 'flex-end' }}>
                  Limpar exclusões ({excluidas.length})
                </button>
              ) : null}
            </div>
          </section>

          <div className="summary-strip" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <Card label="Linhas (transp. × origem)" valor={fmtN(resultado.totalLinhas)} sub={`de ${fmtN(resultado.totalCtes)} CT-es`} cor="#9153F0" />
            <Card label="Custo atual (total)" valor={fmt(resultado.pagoTotal)} sub="frete pago no recorte" cor="#1e293b" />
            <Card label="Melhor cenário (total)" valor={fmt(resultado.melhorTotal)} sub={MODOS_CENARIO.find((m) => m.id === scenarioMode)?.label} cor="#04C7A4" />
            <Card label="Redução potencial" valor={fmt(resultado.reducaoTotal)} sub={pct(resultado.reducaoPct)} cor="#9b1111" destaque={resultado.reducaoTotal > 0} />
          </div>

          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 16px', marginBottom: '1rem', fontSize: '0.84rem', color: '#166534' }}>
            <strong>Diagnóstico simulação:</strong> {fmtN(resultado.diagTotal?.CALCULADO || 0)} cotações válidas (mesma origem) · {fmtN(resultado.diagTotal?.ORIGEM_ERRADA || 0)} descartadas (origem diferente) · {fmtN(resultado.diagTotal?.SEM_ROTA || 0)} sem rota · {fmtN(resultado.diagTotal?.SEM_FAIXA || 0)} sem faixa de peso · {fmtN(resultado.diagTotal?.SEM_IBGE || 0)} CT-es sem IBGE.
          </div>

          <div className="panel-card">
            <div className="panel-title" style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span>
                Transportadora × Origem — métrica: {metricaLabel}
                <span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#94a3b8' }}> · clique na linha para ver as candidatas</span>
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={abrirRelatorio}
                  style={{ padding: '6px 14px', background: '#4E008F', color: '#fff', border: 'none', borderRadius: 7, fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  Exportar Excel
                </button>
                <button type="button" onClick={abrirHtmlEmail}
                  style={{ padding: '6px 14px', background: '#fff', color: '#4E008F', border: '1.5px solid #4E008F', borderRadius: 7, fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  HTML p/ e-mail
                </button>
              </div>
            </div>
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead>
                  <tr>
                    <th>Transportadora</th>
                    <th>Origem</th>
                    <th>UF</th>
                    <th>CT-es</th>
                    {resultado.refCompetencia && <th style={{ background: '#1e3a5f', color: '#93c5fd' }} title="% frete sobre NF no período de referência (antes dos reajustes)">% NF {resultado.refCompetencia}</th>}
                    <th title="Total do frete pago no período e % frete sobre NF (média ponderada pelo volume de NF)">Atual — total / % NF</th>
                    {mostrarSimulado && <th title="Melhor cenário simulado — total do período e % NF combinado (CT-e a CT-e)">Simulado — total / % NF</th>}
                    {mostrarSimulado && <th>Redução R$</th>}
                    {mostrarSimulado && <th>Redução %</th>}
                    {mostrarSimulado && <th>Substituta</th>}
                    {mostrarSimulado && <th>Prazo (real→melhor)</th>}
                  </tr>
                </thead>
                <tbody>
                  {resultado.regioes.map((reg) => (
                    <React.Fragment key={reg.regiao}>
                      <tr style={{ background: '#f1f5f9' }}>
                        <td colSpan={mostrarSimulado ? 6 : (resultado.refCompetencia ? 5 : 4)} style={{ fontWeight: 800, color: '#4E008F', letterSpacing: '0.03em' }}>{reg.regiao}</td>
                        {mostrarSimulado && <td className="negativo" style={{ fontWeight: 700 }}>{fmt(reg.reducaoRs)}</td>}
                        {mostrarSimulado && <td>{pct(reg.pagoTotal > 0 ? (reg.reducaoRs / reg.pagoTotal) * 100 : 0)}</td>}
                        <td colSpan={mostrarSimulado ? 2 : 1} style={{ fontSize: '0.76rem', color: '#64748b' }}>{reg.linhas.length} linhas</td>
                      </tr>
                      {reg.linhas.map((l) => {
                        const id = l.key;
                        const aberto = expandido === id;
                        return (
                          <React.Fragment key={id}>
                            {(() => {
                              const reajNomeMatch = (resultado.reajustesSet || []).find((n) => mesmaTransportadora(n, l.transportadoraReal));
                              const temReajuste = !!reajNomeMatch;
                              const reajustesLinha = temReajuste ? (resultado.reajustesMap.get(norm(reajNomeMatch)) || []) : [];
                              const tooltipReajuste = reajustesLinha.length
                                ? reajustesLinha.map((r) => `${r.status || '?'} · ${r.reajusteSolicitado ? '+' + (r.reajusteSolicitado * 100).toFixed(2).replace('.', ',') + '%' : ''} · ${r.dataSolicitacao ? new Date(r.dataSolicitacao).toLocaleDateString('pt-BR') : ''}`.trim()).join(' | ')
                                : '';
                              return (
                            <tr onClick={() => setExpandido(aberto ? null : id)} style={{ cursor: 'pointer' }}>
                              <td style={{ fontWeight: 600 }}>
                                {aberto ? '▼ ' : '▶ '}{l.transportadoraReal || '—'}
                                {temReajuste && (() => {
                                  const pctReaj = reajustesLinha.map((r) => r.reajusteSolicitado).filter((v) => v > 0);
                                  const maxPct = pctReaj.length ? Math.max(...pctReaj) : null;
                                  const maxPctDisplay = maxPct != null ? (maxPct * 100).toFixed(1).replace('.', ',') : null;
                                  return (
                                    <span title={tooltipReajuste || 'Transportadora com reajuste registrado'} style={{ marginLeft: 6, background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 4, padding: '1px 6px', fontSize: '0.68rem', fontWeight: 700, cursor: 'help', whiteSpace: 'nowrap' }}>
                                      ⚠ REAJUSTE{maxPctDisplay != null ? ` +${maxPctDisplay}%` : ''}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td>{l.cidadeOrigem || '—'}</td>
                              <td>{l.ufOrigem}</td>
                              <td>{fmtN(l.ctes)}</td>
                              {resultado.refCompetencia && (
                                <td style={{ background: '#eff6ff', textAlign: 'center', fontWeight: 600, color: l.freteNfPctRef != null ? '#1e3a5f' : '#94a3b8' }} title={l.refCtes ? `${l.refCtes} CT-es em ${resultado.refCompetencia}` : 'Sem dados no período de referência'}>
                                  {l.freteNfPctRef != null ? pct(l.freteNfPctRef) : '—'}
                                  {l.freteNfPctRef != null && l.freteNfPctAtual != null && (
                                    <span style={{ display: 'block', fontSize: '0.65rem', fontWeight: 400, color: l.freteNfPctAtual > l.freteNfPctRef ? '#9b1111' : '#047857' }}>
                                      {l.freteNfPctAtual > l.freteNfPctRef ? `▲ +${(l.freteNfPctAtual - l.freteNfPctRef).toFixed(1)}pp` : `▼ ${(l.freteNfPctAtual - l.freteNfPctRef).toFixed(1)}pp`}
                                    </span>
                                  )}
                                </td>
                              )}
                              <td>
                                {fmtMetrica(metrica, l.custoAtual)}
                                {metrica !== 'freteNf' && l.freteNfPctAtual != null && (
                                  <>
                                    <span style={{ display: 'block', fontSize: '0.68rem', color: '#64748b' }}>{pct(l.freteNfPctAtual)} NF</span>
                                    {l.freteNfPctRef != null && (
                                      <span style={{ display: 'block', fontSize: '0.65rem', fontWeight: 400, color: l.freteNfPctAtual > l.freteNfPctRef ? '#9b1111' : '#047857' }}>
                                        {l.freteNfPctAtual > l.freteNfPctRef ? `▲ +${(l.freteNfPctAtual - l.freteNfPctRef).toFixed(1)}pp vs jan` : `▼ ${(l.freteNfPctAtual - l.freteNfPctRef).toFixed(1)}pp vs jan`}
                                      </span>
                                    )}
                                  </>
                                )}
                              </td>
                              {mostrarSimulado && <td style={{ color: '#04C7A4', fontWeight: 600 }}>
                                {fmtMetrica(metrica, l.custoMelhor)}
                                {metrica !== 'freteNf' && (() => {
                                  const simPct = l.chainNfPct ?? l.freteNfPctMelhor;
                                  if (simPct == null) return null;
                                  return (
                                    <>
                                      <span style={{ display: 'block', fontSize: '0.68rem', color: '#047857' }}>{pct(simPct)} NF</span>
                                      {l.freteNfPctRef != null && (
                                        <span style={{ display: 'block', fontSize: '0.65rem', fontWeight: 400, color: simPct > l.freteNfPctRef ? '#9b1111' : '#047857' }}>
                                          {simPct > l.freteNfPctRef ? `▲ +${(simPct - l.freteNfPctRef).toFixed(1)}pp vs jan` : `▼ ${(simPct - l.freteNfPctRef).toFixed(1)}pp vs jan`}
                                        </span>
                                      )}
                                    </>
                                  );
                                })()}
                              </td>}
                              {mostrarSimulado && <td className={l.reducaoRs > TOLERANCIA ? 'negativo' : ''} style={{ fontWeight: l.reducaoRs > TOLERANCIA ? 700 : 400 }}>{l.reducaoRs > TOLERANCIA ? fmt(l.reducaoRs) : '—'}</td>}
                              {mostrarSimulado && <td style={{ fontWeight: 600, color: l.reducaoPct > 0 ? '#9b1111' : '#94a3b8' }}>{l.reducaoPct > 0 ? pct(l.reducaoPct) : '—'}</td>}
                              {mostrarSimulado && <td style={{ fontSize: '0.8rem' }}>
                                {l.substituta ? (
                                  <span>{mesmaTransportadora(l.substituta, l.transportadoraReal) ? `${l.substituta} (própria tabela)` : l.substituta}
                                    {l.ctes > 1 && <span style={{ color: '#94a3b8' }}> · {fmtN(l.cobertura)}/{fmtN(l.ctes)}</span>}
                                  </span>
                                ) : '—'}
                              </td>}
                              {mostrarSimulado && <td style={{ whiteSpace: 'nowrap', color: '#64748b' }}>
                                {l.prazoRealMedio != null ? `${l.prazoRealMedio.toFixed(1)}d` : '?'} → {l.prazoMelhorMedio != null ? `${l.prazoMelhorMedio.toFixed(1)}d` : '?'}
                              </td>}
                            </tr>
                              );
                            })()}
                            {aberto && (
                              <tr>
                                <td colSpan={mostrarSimulado ? 10 : 5} style={{ background: '#faf5ff', padding: '14px 16px' }}>

                                  {/* % frete/NF atual vs melhor */}
                                  <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                                    {[
                                      resultado.refCompetencia && l.freteNfPctRef != null
                                        ? { label: `% NF referência (${resultado.refCompetencia})`, val: l.freteNfPctRef, cor: '#1e3a5f', sub: `${l.refCtes} CT-es` }
                                        : null,
                                      { label: 'Frete % NF atual', val: l.freteNfPctAtual, cor: '#64748b',
                                        sub: resultado.refCompetencia && l.freteNfPctRef != null && l.freteNfPctAtual != null
                                          ? (l.freteNfPctAtual > l.freteNfPctRef ? `▲ +${(l.freteNfPctAtual - l.freteNfPctRef).toFixed(1)}pp vs ref` : `▼ ${(l.freteNfPctAtual - l.freteNfPctRef).toFixed(1)}pp vs ref`)
                                          : null },
                                      { label: 'Frete % NF melhor cenário', val: l.freteNfPctMelhor, cor: '#047857' },
                                      { label: 'Frete % NF combinado (CT-e a CT-e)', val: l.chainNfPct, cor: '#4E008F' },
                                    ].filter(Boolean).map(({ label, val, cor, sub }) => val != null && (
                                      <div key={label} style={{ background: '#fff', border: `1px solid #e2e8f0`, borderLeft: `3px solid ${cor}`, borderRadius: 6, padding: '6px 12px', minWidth: 140 }}>
                                        <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600, marginBottom: 1 }}>{label}</div>
                                        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: cor }}>{pct(val)}</div>
                                        {sub && <div style={{ fontSize: '0.65rem', color: cor, marginTop: 1 }}>{sub}</div>}
                                      </div>
                                    ))}
                                    {l.chainSemAtendimento > 0 && (
                                      <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderLeft: '3px solid #f97316', borderRadius: 6, padding: '6px 12px', minWidth: 140 }}>
                                        <div style={{ fontSize: '0.68rem', color: '#9a3412', fontWeight: 600, marginBottom: 1 }}>Sem atendimento (combinado)</div>
                                        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#9a3412' }}>{l.chainSemAtendimento} CT-e{l.chainSemAtendimento > 1 ? 's' : ''}</div>
                                      </div>
                                    )}
                                  </div>

                                  {/* Cobertura combinada (cadeia greedy CT-e a CT-e) */}
                                  {l.coverageChain && l.coverageChain.length > 0 && (
                                    <div style={{ marginBottom: 12 }}>
                                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4E008F', marginBottom: 6 }}>
                                        Cobertura combinada (cada CT-e vai para a mais barata disponível)
                                        {l.chainSemAtendimento > 0 && <span style={{ color: '#9a3412', marginLeft: 8 }}>· {l.chainSemAtendimento} CT-e{l.chainSemAtendimento > 1 ? 's' : ''} sem nenhuma candidata</span>}
                                      </div>
                                      <table style={{ fontSize: '0.78rem', borderCollapse: 'collapse', width: '100%', maxWidth: 600 }}>
                                        <thead>
                                          <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                                            <th style={{ padding: '2px 8px' }}>Transportadora</th>
                                            <th style={{ padding: '2px 8px', textAlign: 'center' }}>CT-es</th>
                                            <th style={{ padding: '2px 8px', textAlign: 'right' }}>Custo</th>
                                            <th style={{ padding: '2px 8px', textAlign: 'center' }}>Prazo médio</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {l.coverageChain.map((ch) => (
                                            <tr key={ch.transportadora} style={{ background: '#f5f3ff' }}>
                                              <td style={{ padding: '3px 8px', fontWeight: 600 }}>{ch.transportadora}</td>
                                              <td style={{ padding: '3px 8px', textAlign: 'center' }}>{ch.ctes}/{l.ctes}</td>
                                              <td style={{ padding: '3px 8px', textAlign: 'right', color: '#047857' }}>{fmt(ch.custo)}</td>
                                              <td style={{ padding: '3px 8px', textAlign: 'center', color: '#64748b' }}>{ch.prazoMedio != null ? `${ch.prazoMedio.toFixed(1)}d` : '—'}</td>
                                            </tr>
                                          ))}
                                          {l.chainSemAtendimento > 0 && (
                                            <tr style={{ background: '#fff7ed' }}>
                                              <td style={{ padding: '3px 8px', color: '#9a3412', fontStyle: 'italic' }}>Sem candidata</td>
                                              <td style={{ padding: '3px 8px', textAlign: 'center', color: '#9a3412', fontWeight: 700 }}>{l.chainSemAtendimento}/{l.ctes}</td>
                                              <td style={{ padding: '3px 8px', textAlign: 'right', color: '#94a3b8' }}>custo atual mantido</td>
                                              <td style={{ padding: '3px 8px' }}></td>
                                            </tr>
                                          )}
                                          <tr style={{ background: '#e0e7ff', fontWeight: 700 }}>
                                            <td style={{ padding: '3px 8px', color: '#4E008F' }}>TOTAL combinado</td>
                                            <td style={{ padding: '3px 8px', textAlign: 'center', color: '#4E008F' }}>{l.ctes - l.chainSemAtendimento}/{l.ctes} cobertos</td>
                                            <td style={{ padding: '3px 8px', textAlign: 'right', color: '#4E008F' }}>{fmt(l.chainCustoTotal)}</td>
                                            <td style={{ padding: '3px 8px', textAlign: 'center', color: '#4E008F' }}>
                                              {l.chainNfPct != null ? pct(l.chainNfPct) + ' NF' : '—'}
                                              {l.chainPrazoMedio != null && <span style={{ marginLeft: 8, fontWeight: 400, color: '#6d28d9' }}>· {l.chainPrazoMedio.toFixed(1)}d (prazo médio pond.)</span>}
                                            </td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  )}

                                  {/* Candidatas — ranking por custo total */}
                                  <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 6 }}>
                                    Candidatas para <strong>{l.cidadeOrigem}/{l.ufOrigem}</strong> — ranking por custo total (não cobertos ficam no pago atual):
                                  </div>
                                  <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                                    <thead>
                                      <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                                        <th style={{ padding: '2px 8px' }}>#</th>
                                        <th style={{ padding: '2px 8px' }}>Transportadora</th>
                                        <th style={{ padding: '2px 8px', textAlign: 'right' }}>Custo total</th>
                                        <th style={{ padding: '2px 8px', textAlign: 'right' }}>vs. pago</th>
                                        <th style={{ padding: '2px 8px', textAlign: 'center' }}>Cobertura</th>
                                        <th style={{ padding: '2px 8px', textAlign: 'center' }}>Prazo médio</th>
                                        <th style={{ padding: '2px 8px' }}>Obs</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr style={{ background: '#fff' }}>
                                        <td style={{ padding: '2px 8px' }}>—</td>
                                        <td style={{ padding: '2px 8px', fontWeight: 700 }}>{l.transportadoraReal} (pago real)</td>
                                        <td style={{ padding: '2px 8px', textAlign: 'right' }}>{fmt(l.pagoTotal)}</td>
                                        <td style={{ padding: '2px 8px' }}>—</td>
                                        <td style={{ padding: '2px 8px', textAlign: 'center' }}>{fmtN(l.ctes)}/{fmtN(l.ctes)}</td>
                                        <td style={{ padding: '2px 8px', textAlign: 'center' }}>{l.prazoRealMedio != null ? `${l.prazoRealMedio.toFixed(1)}d` : '—'}</td>
                                        <td style={{ padding: '2px 8px' }}></td>
                                      </tr>
                                      {l.ranking.map((r, i) => {
                                        const dif = l.pagoTotal - r.total;
                                        const coberturaOk = r.cobertos >= l.ctes;
                                        return (
                                          <tr key={r.transportadora} style={{ background: i === 0 ? '#ecfdf5' : 'transparent' }}>
                                            <td style={{ padding: '2px 8px' }}>{i + 1}</td>
                                            <td style={{ padding: '2px 8px', fontWeight: i === 0 ? 700 : 400 }}>{r.transportadora}</td>
                                            <td style={{ padding: '2px 8px', textAlign: 'right' }}>{fmt(r.total)}</td>
                                            <td style={{ padding: '2px 8px', textAlign: 'right', color: dif > 0 ? '#04C7A4' : '#9b1111' }}>{dif > 0 ? `−${fmt(dif)}` : `+${fmt(-dif)}`}</td>
                                            <td style={{ padding: '2px 8px', textAlign: 'center', color: coberturaOk ? '#047857' : '#9a3412', fontWeight: coberturaOk ? 400 : 700 }}>{fmtN(r.cobertos)}/{fmtN(l.ctes)}</td>
                                            <td style={{ padding: '2px 8px', textAlign: 'center', color: '#64748b' }}>{r.prazoMedio != null ? `${r.prazoMedio.toFixed(1)}d` : '—'}</td>
                                            <td style={{ padding: '2px 8px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                              {r.semGranularidade && <span title="Calculado sem rota específica por IBGE de destino — preço pode não ser real" style={{ background: '#fef3c7', color: '#92400e', borderRadius: 3, padding: '1px 5px', fontSize: '0.68rem', fontWeight: 700, cursor: 'help' }}>⚠ SEM ROTA IBGE</span>}
                                              {r.semGeneralidades && <span title="Tabela sem taxas adicionais (generalidades) — verificar se está completa" style={{ background: '#fce7f3', color: '#9d174d', borderRadius: 3, padding: '1px 5px', fontSize: '0.68rem', fontWeight: 700, cursor: 'help' }}>⚠ SEM GENERALIDADES</span>}
                                              {!coberturaOk && !r.semGranularidade && !r.semGeneralidades && <span style={{ color: '#94a3b8', fontSize: '0.68rem' }}>cobre parcial</span>}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                      {!l.ranking.length && <tr><td colSpan={7} style={{ padding: '4px 8px', color: '#94a3b8' }}>Nenhuma candidata com tabela na mesma origem para este modo.</td></tr>}
                                    </tbody>
                                  </table>
                                  <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 6 }}>
                                    ⚠ SEM ROTA IBGE = calculado sem código IBGE de destino (tarifa geral) · ⚠ SEM GENERALIDADES = tabela sem taxas adicionais, verificar se está completa.
                                  </div>

                                  {/* Painel de vínculo — busca transportadora no cadastro de tabelas */}
                                  <div style={{ marginTop: 14, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
                                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                                      Buscar transportadora no cadastro de tabelas
                                      <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 8 }}>— útil quando a transportadora do CT-e não aparece nas candidatas</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                      <input
                                        type="text"
                                        placeholder={`Buscar (ex: ${l.transportadoraReal.split(' ')[0]})`}
                                        value={expandido === l.key ? buscaVinculo : ''}
                                        onChange={(e) => setBuscaVinculo(e.target.value)}
                                        style={{ padding: '5px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '0.8rem', width: 260 }}
                                      />
                                      {buscaVinculo && (
                                        <button type="button" onClick={() => setBuscaVinculo('')} style={{ border: 'none', background: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem' }}>✕ limpar</button>
                                      )}
                                    </div>
                                    {buscaVinculo.length >= 2 && (() => {
                                      const bNorm = norm(buscaVinculo);
                                      const matches = (bruto?.baseNomes || []).filter((n) => norm(n).includes(bNorm) || bNorm.includes(norm(n).slice(0, 4)));
                                      return matches.length > 0 ? (
                                        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                          {matches.slice(0, 20).map((n) => {
                                            const jaCandidato = l.ranking.some((r) => mesmaTransportadora(r.transportadora, n));
                                            return (
                                              <span key={n} title={jaCandidato ? 'Já aparece como candidata' : 'Encontrada no cadastro — verifique o nome da tabela'} style={{ background: jaCandidato ? '#dcfce7' : '#f1f5f9', color: jaCandidato ? '#166534' : '#334155', border: `1px solid ${jaCandidato ? '#86efac' : '#cbd5e1'}`, borderRadius: 4, padding: '2px 8px', fontSize: '0.75rem', cursor: 'default' }}>
                                                {jaCandidato ? '✓ ' : ''}{n}
                                              </span>
                                            );
                                          })}
                                          {matches.length > 20 && <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>+{matches.length - 20} mais — refine a busca</span>}
                                        </div>
                                      ) : (
                                        <div style={{ marginTop: 6, fontSize: '0.78rem', color: '#9a3412' }}>Nenhuma transportadora com "{buscaVinculo}" no cadastro de tabelas. Pode ser necessário importar a tabela.</div>
                                      );
                                    })()}</div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  ))}
                  {!resultado.regioes.length && <tr><td colSpan={10}>Nenhuma linha com os filtros atuais.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
